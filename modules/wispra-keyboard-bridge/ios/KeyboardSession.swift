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
      let input = engine.inputNode
      let format = input.outputFormat(forBus: 0)
      input.removeTap(onBus: 0)
      input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
        self?.received(buffer)
      }
      engine.prepare()
      try engine.start()
      running = true
    }
    observeKeyboard()
    self.minutes = max(1, minutes)
    until = Date().addingTimeInterval(self.minutes * 60)
    heartbeat?.invalidate()
    heartbeat = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
      guard let self = self else { return }
      if Date() >= self.until {
        self.end()
      } else {
        self.writeStatus()
      }
    }
    writeStatus()
    onState?(state)
  }

  func end() {
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
    guard running, until > Date() else { return }
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
      guard self.listening else { return }
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
  func deliver(utterance: String, index: Int, text: String, last: Bool) -> Bool {
    let json = Self.appendChunk(to: SharedChannel.read(.chunks), utterance: utterance, index: index, text: text, last: last, nowMs: Date().timeIntervalSince1970 * 1000)
    let stored = SharedChannel.write(.chunks, json)
    // Works only while Wispra is open; kept for keyboards of earlier builds
    UIPasteboard(name: Self.chunksPasteboard, create: true)?.setItems(
      [["public.utf8-plain-text": json]], options: [.expirationDate: Date().addingTimeInterval(15 * 60)])
    post("text")
    return stored
  }

  /// The list of pieces with this one added; the keyboard only needs the recent ones
  static func appendChunk(to old: String?, utterance: String, index: Int, text: String, last: Bool, nowMs: Double) -> String {
    var list: [[String: Any]] = []
    if let data = old?.data(using: .utf8), let parsed = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
      list = parsed
    }
    list.append(["u": utterance, "i": index, "text": text, "at": nowMs, "last": last])
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
    let status: [String: Any] = [
      "until": running ? until.timeIntervalSince1970 * 1000 : 0,
      "beat": Date().timeIntervalSince1970 * 1000,
      "listening": queue.sync { listening },
    ]
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
