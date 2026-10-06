import AVFoundation
import Foundation
import UIKit

/// The listening session behind the Wispra keyboard's mic (T-0145, the owner's design).
///
/// Apple gives keyboards no microphone, and an app can only start the microphone while it is open.
/// So the user opens Wispra once per session; Wispra starts the microphone and keeps it running in
/// the background (UIBackgroundModes audio; iPhone shows the orange dot) until the session ends.
/// While the keyboard's mic is red, the audio is cut into short pieces at the pauses (Segmenter);
/// each piece goes to the app's JavaScript, which transcribes it with Wispra Cloud and hands the
/// words back to the keyboard. Audio outside red-mic moments is never kept or sent.
///
/// Keyboard → app: Darwin notifications ".start", ".stop", ".cancel" (no App Group needed).
/// App → keyboard: the shared keychain items "session" (status) and "chunks" (words), see
/// SharedChannel.swift, plus the Darwin notification ".text". Not the pasteboard: iOS refuses it to
/// an app in the background, which Wispra is during a session (T-0163). The pasteboards are still
/// written as well, for keyboards from earlier builds, and work while Wispra is open.
final class KeyboardSession {
  static let shared = KeyboardSession()

  static let notifyPrefix = "com.sinhgiang.wispramobile.dictation"
  static let sessionPasteboard = UIPasteboard.Name("com.sinhgiang.wispramobile.keyboard.session")
  static let chunksPasteboard = UIPasteboard.Name("com.sinhgiang.wispramobile.keyboard.chunks")

  /// A finished piece: { path, durationMs, utterance, index, last, voiced }
  var onChunk: (([String: Any]) -> Void)?
  /// The session changed: { active, until, listening }
  var onState: (([String: Any]) -> Void)?

  private let engine = AVAudioEngine()
  private let queue = DispatchQueue(label: "wispra.keyboard-session")
  private var running = false
  private var observing = false
  private var observingAudio = false
  private var restartAttempt = 0
  private var restartScheduled = false
  /// Another app (or iOS) has the audio: the way back is tried every few seconds, never counted as a
  /// failure and never ending the session, so a long call or a long video does not end it (T-0178 review)
  private var interrupted = false
  private var interruptRetryScheduled = false
  private var interruptTask: UIBackgroundTaskIdentifier = .invalid
  /// One line in the log for a run of failed tries, not one per try
  private var failureLogged = false
  private var lastBeatAt = Date()
  /// What is wrong with the microphone, told to the keyboard in the status (nil: nothing)
  private var problem: String?
  private var until = Date.distantPast
  /// How long a session lasts; each use of the keyboard's mic starts the count again
  private var minutes: Double = 60
  private var heartbeat: Timer?

  // Touched on `queue` only
  private var listening = false
  private var utterance = ""
  private var index = 0
  private var file: AVAudioFile?
  private var fileURL: URL?
  private var segmenter = Segmenter()

  private func log(_ text: String) { SharedLog.append("app", text) }

  /// If the last run ended while a session was on (no clean end), iOS closed Wispra: say so in the log
  /// (T-0178: in Messenger and Zalo the keyboard found no app to answer it)
  func noteUncleanEnd() {
    let defaults = UserDefaults.standard
    guard let beat = defaults.object(forKey: "sessionOpenSince") as? Date else { return }
    let last = defaults.object(forKey: "sessionLastBeat") as? Date ?? beat
    let gap = Int(Date().timeIntervalSince(last))
    // Not knowable from here: iOS closing Wispra, or the user closing it by hand
    log("Wispra was started again; the last run ended without ending its session (its last beat was \(gap) s ago): iOS closed Wispra, or it was closed by hand")
    defaults.removeObject(forKey: "sessionOpenSince")
  }

  var state: [String: Any] {
    [
      "active": running && until > Date(),
      "until": running ? until.timeIntervalSince1970 * 1000 : 0,
      "listening": queue.sync { listening },
    ]
  }

  // MARK: Session

  func start(minutes: Double) throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .allowBluetooth, .defaultToSpeaker])
    try session.setActive(true)
    if !running {
      try startEngine()
      running = true
    }
    observeKeyboard()
    observeAudio()
    UserDefaults.standard.set(Date(), forKey: "sessionOpenSince")
    log("session started for \(Int(max(1, minutes))) min (engine running: \(engine.isRunning))")
    self.minutes = max(1, minutes)
    until = Date().addingTimeInterval(self.minutes * 60)
    heartbeat?.invalidate()
    lastBeatAt = Date()
    heartbeat = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
      guard let self = self else { return }
      // A beat that comes late means the app was not running: iOS had suspended it
      let late = Date().timeIntervalSince(self.lastBeatAt)
      if late > 15 { self.log("the app was not running for \(Int(late)) s (suspended by iOS), engine running: \(self.engine.isRunning)") }
      self.lastBeatAt = Date()
      UserDefaults.standard.set(Date(), forKey: "sessionLastBeat")
      if Date() >= self.until {
        self.log("session over (its time ran out)")
        self.end()
      } else {
        if !self.engine.isRunning { self.restartEngine() }
        self.writeStatus()
      }
    }
    writeStatus()
    onState?(state)
  }

  /// The microphone into the engine, and the engine running. Also the way back after an interruption.
  private func startEngine() throws {
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
      self?.received(buffer)
    }
    engine.prepare()
    try engine.start()
  }

  // MARK: Keeping it going (T-0178, point 3)

  /// A phone call, Siri, an alarm, another app taking the audio, headphones in or out: iOS stops the engine
  /// and tells us. Without this the session looked alive (the beat went on) and nothing was heard.
  private func observeAudio() {
    guard !observingAudio else { return }
    observingAudio = true
    let center = NotificationCenter.default
    center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
      guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt else { return }
      let reason = (note.userInfo?[AVAudioSessionInterruptionReasonKey] as? UInt).map(String.init) ?? "none"
      self?.log("audio \(raw == SessionRecovery.interruptionBegan ? "interrupted by another app or iOS" : "interruption ended") (reason \(reason))")
      if raw == SessionRecovery.interruptionBegan {
        // Zalo, Messenger or a call took the audio. Many apps never tell when they let it go (the interruption
        // never "ends"), and Wispra, with no audio, is suspended within seconds: so keep trying to take it back,
        // with background time to do it in
        self?.interrupted = true
        self?.problem = "microphone used by another app"
        self?.beginBackgroundTime()
        self?.writeStatus()
        self?.retryWhileInterrupted()
      }
      if SessionRecovery.shouldRestart(interruptionTypeRaw: raw) { self?.restartEngine() }
    }
    center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
      self?.log("audio route or settings changed")
      self?.restartEngine()
    }
    center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
      self?.log("iOS reset its audio services")
      self?.restartEngine()
    }
    center.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main) { [weak self] _ in
      self?.log("iOS warned that memory is short (it may close Wispra next)")
    }
    center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
      self?.log("Wispra went to the background (engine running: \(self?.engine.isRunning ?? false))")
    }
    center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
      self?.log("Wispra came to the front (engine running: \(self?.engine.isRunning ?? false))")
    }
  }

  /// Starts the engine again when the session is meant to be on. A try that fails is tried again after a
  /// growing wait; after six the session is ended, which the keyboard sees, so its mic asks the app to start one.
  private func restartEngine() {
    guard running, until > Date() else { return }
    do {
      try AVAudioSession.sharedInstance().setActive(true)
      if !engine.isRunning {
        try startEngine()
        log("the microphone was started again")
      }
      restartAttempt = 0
      failureLogged = false
      interrupted = false
      endBackgroundTime()
      problem = nil
      writeStatus()
    } catch {
      if !failureLogged {
        failureLogged = true
        log("could not start the microphone again: \(error.localizedDescription)")
      }
      problem = "microphone busy"
      writeStatus()
      // Another app has the audio: the retry loop goes on, nothing is counted and the session stays
      if interrupted { return }
      guard !restartScheduled else { return }
      guard let wait = SessionRecovery.retryDelay(attempt: restartAttempt) else {
        restartAttempt = 0
        end()
        return
      }
      restartAttempt += 1
      restartScheduled = true
      DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [weak self] in
        self?.restartScheduled = false
        self?.restartEngine()
      }
    }
  }

  /// Every few seconds while another app has the audio: take it back as soon as it can be
  private func retryWhileInterrupted() {
    guard interrupted, running, until > Date(), !interruptRetryScheduled else { return }
    interruptRetryScheduled = true
    DispatchQueue.main.asyncAfter(deadline: .now() + SessionRecovery.interruptedRetrySeconds) { [weak self] in
      guard let self = self else { return }
      self.interruptRetryScheduled = false
      guard self.interrupted, self.running else { return }
      self.restartEngine()
      self.retryWhileInterrupted()
    }
  }

  /// A little time to run in once Wispra is in the background without audio
  private func beginBackgroundTime() {
    guard interruptTask == .invalid else { return }
    interruptTask = UIApplication.shared.beginBackgroundTask(withName: "wispra-take-back-microphone") { [weak self] in
      self?.endBackgroundTime()
    }
  }

  private func endBackgroundTime() {
    guard interruptTask != .invalid else { return }
    UIApplication.shared.endBackgroundTask(interruptTask)
    interruptTask = .invalid
  }

  func end() {
    interrupted = false
    endBackgroundTime()
    if running { log("session ended") }
    UserDefaults.standard.removeObject(forKey: "sessionOpenSince")
    heartbeat?.invalidate()
    heartbeat = nil
    queue.sync {
      if listening { discardPiece() }
      listening = false
    }
    if running {
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
      running = false
    }
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    until = .distantPast
    writeStatus()
    onState?(state)
  }

  // MARK: The keyboard's mic

  func beginListening() {
    guard running, until > Date() else {
      log("the keyboard asked to listen, but no session is on")
      return
    }
    // The engine may have been stopped (another app took the audio): start it before listening
    if !engine.isRunning {
      log("the keyboard asked to listen, but the microphone was stopped: starting it")
      restartEngine()
    }
    // Still stopped: no red mic that records nothing. The status says so (engine false, problem), and
    // the keyboard tells the user within seconds.
    guard engine.isRunning else {
      log("the keyboard asked to listen, but the microphone could not be started: not listening")
      writeStatus()
      return
    }
    log("listening for the keyboard (engine running: \(engine.isRunning))")
    // A session in use goes on: the count starts again from now
    until = max(until, Date().addingTimeInterval(minutes * 60))
    queue.async {
      if self.listening { return }
      self.utterance = UUID().uuidString
      self.index = 0
      self.openPiece()
      self.listening = true
      DispatchQueue.main.async { self.writeStatus(); self.onState?(self.state) }
    }
  }

  func finishListening() {
    queue.async {
      guard self.listening else {
        SharedLog.append("app", "the keyboard asked to stop, but nothing was being listened to")
        return
      }
      self.closePiece(last: true)
      self.listening = false
      DispatchQueue.main.async { self.writeStatus(); self.onState?(self.state) }
    }
  }

  func cancelListening() {
    queue.async {
      guard self.listening else { return }
      self.discardPiece()
      self.listening = false
      DispatchQueue.main.async { self.writeStatus(); self.onState?(self.state) }
    }
  }

  // MARK: Words back to the keyboard

  /// Adds a transcribed piece to the list the keyboard reads, and wakes the keyboard. True when the
  /// words are stored where the keyboard reads them (the shared keychain).
  func deliver(utterance: String, index: Int, text: String, last: Bool, failed: Bool = false) -> Bool {
    let json = Self.appendChunk(to: SharedChannel.read(.chunks), utterance: utterance, index: index, text: text, last: last, failed: failed, nowMs: Date().timeIntervalSince1970 * 1000)
    let stored = SharedChannel.write(.chunks, json)
    log("words handed to the keyboard: piece \(index), \(text.count) letters, last \(last), failed \(failed), stored \(stored)")
    // Works only while Wispra is open; kept for keyboards of earlier builds
    UIPasteboard(name: Self.chunksPasteboard, create: true)?.setItems(
      [["public.utf8-plain-text": json]], options: [.expirationDate: Date().addingTimeInterval(15 * 60)])
    post("text")
    return stored
  }

  /// The list of pieces with this one added; the keyboard only needs the recent ones
  static func appendChunk(to old: String?, utterance: String, index: Int, text: String, last: Bool, failed: Bool = false, nowMs: Double) -> String {
    var list: [[String: Any]] = []
    if let data = old?.data(using: .utf8), let parsed = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
      list = parsed
    }
    list.append(["u": utterance, "i": index, "text": text, "at": nowMs, "last": last, "failed": failed])
    if list.count > 40 { list.removeFirst(list.count - 40) }
    guard let data = try? JSONSerialization.data(withJSONObject: list), let json = String(data: data, encoding: .utf8) else { return "[]" }
    return json
  }

  // MARK: Audio (on `queue`)

  private func received(_ buffer: AVAudioPCMBuffer) {
    guard let copy = Self.copy(buffer) else { return }
    queue.async {
      guard self.listening, let file = self.file else { return }
      do {
        try file.write(from: copy)
      } catch {
        return
      }
      let frames = Int(copy.frameLength)
      let level = copy.floatChannelData.map { Segmenter.level($0[0], count: frames) } ?? 0
      let duration = Double(frames) / copy.format.sampleRate
      if self.segmenter.feed(level: level, duration: duration) {
        self.closePiece(last: false)
        self.openPiece()
      }
    }
  }

  private func openPiece() {
    let format = engine.inputNode.outputFormat(forBus: 0)
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("wispra-keyboard-\(UUID().uuidString).m4a")
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: format.sampleRate,
      AVNumberOfChannelsKey: format.channelCount,
      AVEncoderBitRateKey: 64_000,
    ]
    file = try? AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
    fileURL = url
    segmenter.reset()
  }

  /// Ends the piece being written; it goes to JavaScript when something was said, or when it is the
  /// last one (so the keyboard knows the utterance ended)
  private func closePiece(last: Bool) {
    let voiced = segmenter.heardVoice
    let duration = segmenter.pieceLength
    file = nil
    guard let url = fileURL else { return }
    fileURL = nil
    if !voiced && !last {
      try? FileManager.default.removeItem(at: url)
      return
    }
    let info: [String: Any] = [
      "path": url.absoluteString,
      "durationMs": Int(duration * 1000),
      "utterance": utterance,
      "index": index,
      "last": last,
      "voiced": voiced,
    ]
    index += 1
    SharedLog.append("app", "piece \(info["index"] ?? "?") closed: \(Int(duration * 1000)) ms, voiced \(voiced), last \(last)")
    DispatchQueue.main.async { self.onChunk?(info) }
  }

  private func discardPiece() {
    file = nil
    if let url = fileURL { try? FileManager.default.removeItem(at: url) }
    fileURL = nil
  }

  private static func copy(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
    guard let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength),
          let src = buffer.floatChannelData, let dst = copy.floatChannelData else { return nil }
    copy.frameLength = buffer.frameLength
    for ch in 0..<Int(buffer.format.channelCount) {
      dst[ch].update(from: src[ch], count: Int(buffer.frameLength))
    }
    return copy
  }

  // MARK: Talking to the keyboard

  /// The beat the keyboard checks (every 5 seconds, in the background too): a session whose beat
  /// stops is over for the keyboard
  private func writeStatus() {
    var status: [String: Any] = [
      "until": running ? until.timeIntervalSince1970 * 1000 : 0,
      "beat": Date().timeIntervalSince1970 * 1000,
      "listening": queue.sync { listening },
      "engine": engine.isRunning,
    ]
    if let problem = problem { status["problem"] = problem }
    guard let data = try? JSONSerialization.data(withJSONObject: status), let json = String(data: data, encoding: .utf8) else { return }
    SharedChannel.write(.session, json)
    UIPasteboard(name: Self.sessionPasteboard, create: true)?.setItems([["public.utf8-plain-text": json]], options: [:])
  }

  private func post(_ name: String) {
    let center = CFNotificationCenterGetDarwinNotifyCenter()
    CFNotificationCenterPostNotification(center, CFNotificationName("\(Self.notifyPrefix).\(name)" as CFString), nil, nil, true)
  }

  private func observeKeyboard() {
    guard !observing else { return }
    observing = true
    let center = CFNotificationCenterGetDarwinNotifyCenter()
    for name in ["start", "stop", "cancel"] {
      CFNotificationCenterAddObserver(
        center,
        Unmanaged.passUnretained(self).toOpaque(),
        { _, _, name, _, _ in
          guard let raw = name?.rawValue as String? else { return }
          DispatchQueue.main.async {
            if raw.hasSuffix(".start") { KeyboardSession.shared.beginListening() }
            else if raw.hasSuffix(".stop") { KeyboardSession.shared.finishListening() }
            else if raw.hasSuffix(".cancel") { KeyboardSession.shared.cancelListening() }
          }
        },
        "\(Self.notifyPrefix).\(name)" as CFString,
        nil,
        .deliverImmediately
      )
    }
  }
}
