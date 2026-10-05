import UIKit

/// The Wispra keyboard on iPhone, following the owner's design (T-0145): a full keyboard that looks
/// like the Apple one (letters, numbers, symbols, Vietnamese Telex), meant to be the keyboard in
/// use, with a small purple mic at the left of a strip on its top edge, right under the text field.
///
/// Apple gives keyboards no microphone ("Custom keyboards ... have no access to the device
/// microphone"), so the mic hands over to the Wispra app, which records and transcribes with Wispra
/// Cloud, and the words come back through the keychain group the app and the keyboard share
/// (SharedChannel.swift; needs Allow Full Access) and are typed at the cursor. Typing letters works without full access, as App
/// Review guideline 4.4.1 requires.
final class KeyboardViewController: UIInputViewController {
  /// Same name as in modules/wispra-keyboard-bridge (the app writes, the keyboard reads)
  static let pasteboardName = UIPasteboard.Name("com.sinhgiang.wispramobile.keyboard")
  /// The keyboard notes here when it was last on screen, so the app knows it is set up and in use
  static let seenPasteboardName = UIPasteboard.Name("com.sinhgiang.wispramobile.keyboard.seen")
  /// Words older than this are not typed any more
  static let maxAgeSeconds: TimeInterval = 15 * 60
  /// The listening session the Wispra app runs (status) and the pieces it transcribed
  static let sessionPasteboardName = UIPasteboard.Name("com.sinhgiang.wispramobile.keyboard.session")
  static let chunksPasteboardName = UIPasteboard.Name("com.sinhgiang.wispramobile.keyboard.chunks")
  static let notifyPrefix = "com.sinhgiang.wispramobile.dictation"
  /// After the red mic is tapped, how long the keyboard waits for the words before it says they did
  /// not come (instead of "Đang viết…" forever)
  static var wordsWaitSeconds: TimeInterval = 45

  private enum Shift { case off, once, locked }

  // Layout, in points, like the Apple keyboard on iPhone
  private let stripHeight: CGFloat = 44
  private let keyHeight: CGFloat = 42
  private let rowGap: CGFloat = 11
  private let keyGap: CGFloat = 6
  private let sideMargin: CGFloat = 3

  private let strip = UIView()
  private let micButton = UIButton(type: .custom)
  private let statusLabel = UILabel()
  private let undoButton = UIButton(type: .system)
  private let keysView = UIView()
  private var keyButtons: [KeyButton] = []

  private var page = KeyboardPage.letters
  private var shift = Shift.once
  private var lastShiftTap = Date.distantPast
  private var lastSpaceTap = Date.distantPast
  private var vietnamese = UserDefaults.standard.object(forKey: "vietnamese") as? Bool ?? true
  private var deleteTimer: Timer?
  private var pollTimer: Timer?
  private var pollUntil = Date.distantPast
  /// What the keyboard typed last for Wispra, for Undo
  private var lastTyped: String?
  /// The mic is red: the app is listening for this keyboard
  private var listening = false
  /// The mic was tapped red → purple: words are on their way, until the last piece comes
  private var waitingForWords = false
  /// A piece of this utterance could not be transcribed (not the same as nothing said)
  private var piecesFailed = false
  /// When the red mic was tapped to finish, kept across locking the screen and reloading the keyboard
  /// (UserDefaults), so "Đang viết…" can never go on for ever (T-0178)
  private var waitingSince: Date? {
    get { UserDefaults.standard.object(forKey: "waitingSince") as? Date }
    set { UserDefaults.standard.set(newValue, forKey: "waitingSince") }
  }
  /// Watches the app while the mic is red: if iOS stops Wispra, the mic must not stay red
  private var listenTimer: Timer?
  /// A message about something that failed is on the strip: it stays until the next tap on the mic
  private var problemShown = false
  /// Pieces already typed (utterance#index), kept across keyboard loads
  private var typedPieces: [String] = UserDefaults.standard.stringArray(forKey: "typedPieces") ?? []
  private var observingText = false

  private let purple = UIColor(red: 0x63 / 255.0, green: 0x66 / 255.0, blue: 0xF1 / 255.0, alpha: 1)
  private let lavender = UIColor(red: 0xC7 / 255.0, green: 0xC9 / 255.0, blue: 0xFA / 255.0, alpha: 1)

  private var dark: Bool {
    textDocumentProxy.keyboardAppearance == .dark || traitCollection.userInterfaceStyle == .dark
  }

  // MARK: Life cycle

  override func viewDidLoad() {
    super.viewDidLoad()

    var micImage = UIImage(systemName: "mic.fill")
    micImage = micImage?.withConfiguration(UIImage.SymbolConfiguration(pointSize: 14, weight: .semibold))
    micButton.setImage(micImage, for: .normal)
    micButton.tintColor = purple
    micButton.backgroundColor = lavender
    micButton.layer.cornerRadius = 8
    micButton.accessibilityLabel = "Speak with Wispra"
    micButton.addTarget(self, action: #selector(micTapped), for: .touchUpInside)

    statusLabel.font = .systemFont(ofSize: 13)
    statusLabel.text = "Wispra"

    undoButton.setTitle("Hoàn tác", for: .normal)
    undoButton.titleLabel?.font = .systemFont(ofSize: 14, weight: .medium)
    undoButton.addTarget(self, action: #selector(undo), for: .touchUpInside)
    undoButton.isHidden = true

    for v in [micButton, statusLabel, undoButton] {
      v.translatesAutoresizingMaskIntoConstraints = false
      strip.addSubview(v)
    }
    strip.translatesAutoresizingMaskIntoConstraints = false
    keysView.translatesAutoresizingMaskIntoConstraints = false
    observeWords()
    view.addSubview(strip)
    view.addSubview(keysView)

    let keysHeight = 4 * keyHeight + 3 * rowGap + 12
    let height = view.heightAnchor.constraint(equalToConstant: stripHeight + keysHeight)
    height.priority = UILayoutPriority(999)
    NSLayoutConstraint.activate([
      height,
      strip.topAnchor.constraint(equalTo: view.topAnchor),
      strip.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      strip.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      strip.heightAnchor.constraint(equalToConstant: stripHeight),
      micButton.leadingAnchor.constraint(equalTo: strip.leadingAnchor, constant: 10),
      micButton.centerYAnchor.constraint(equalTo: strip.centerYAnchor),
      micButton.widthAnchor.constraint(equalToConstant: 32),
      micButton.heightAnchor.constraint(equalToConstant: 32),
      statusLabel.leadingAnchor.constraint(equalTo: micButton.trailingAnchor, constant: 10),
      statusLabel.centerYAnchor.constraint(equalTo: strip.centerYAnchor),
      statusLabel.trailingAnchor.constraint(lessThanOrEqualTo: undoButton.leadingAnchor, constant: -8),
      undoButton.trailingAnchor.constraint(equalTo: strip.trailingAnchor, constant: -12),
      undoButton.centerYAnchor.constraint(equalTo: strip.centerYAnchor),
      keysView.topAnchor.constraint(equalTo: strip.bottomAnchor),
      keysView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      keysView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      keysView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    buildKeys()
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    markSeen()
    applyColors()
    buildKeys()
    updateShiftForContext()
    // Coming back from Wispra: the words may already be waiting, or arrive in a moment
    typeWaitingWords()
    typeQueuedPieces()
    // The screen was locked, or another app came and went, while waiting: say how it ended
    resumeWaitIfAny()
    startPolling(seconds: 60)
    showSession()
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    pollTimer?.invalidate()
    pollTimer = nil
    stopDeleteRepeat()
    // The field goes away: what was being said has nowhere to go
    if listening {
      SharedLog.append("keyboard", "the keyboard went away while listening: cancelled")
      post("cancel")
      listening = false
      listenTimer?.invalidate()
      paintMic()
    }
  }

  deinit {
    CFNotificationCenterRemoveEveryObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque())
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    layoutKeys()
  }

  override func textDidChange(_ textInput: UITextInput?) {
    super.textDidChange(textInput)
    applyColors()
    updateShiftForContext()
  }

  // MARK: Keys

  private func buildKeys() {
    keyButtons.forEach { $0.removeFromSuperview() }
    keyButtons = []
    let upper = page == .letters && shift != .off
    for (r, row) in KeyboardLogic.rows(page: page, upper: upper, showGlobe: needsInputModeSwitchKey).enumerated() {
      for kind in row {
        let button = KeyButton(kind: kind, row: r)
        configure(button)
        keysView.addSubview(button)
        keyButtons.append(button)
      }
    }
    applyColors()
    view.setNeedsLayout()
  }

  private func configure(_ button: KeyButton) {
    switch button.kind {
    case .char(let s):
      button.setTitle(s, for: .normal)
      button.titleLabel?.font = .systemFont(ofSize: page == .letters ? 23 : 21)
      button.addTarget(self, action: #selector(charTapped(_:)), for: .touchUpInside)
    case .shift:
      button.setImage(UIImage(systemName: shift == .locked ? "capslock.fill" : (shift == .once ? "shift.fill" : "shift")), for: .normal)
      button.accessibilityLabel = "Shift"
      button.addTarget(self, action: #selector(shiftTapped), for: .touchUpInside)
    case .delete:
      button.setImage(UIImage(systemName: "delete.left"), for: .normal)
      button.accessibilityLabel = "Delete"
      button.addTarget(self, action: #selector(deleteDown), for: .touchDown)
      button.addTarget(self, action: #selector(deleteUp), for: [.touchUpInside, .touchUpOutside, .touchCancel])
    case .page(let target):
      button.setTitle(target == .letters ? "ABC" : (target == .numbers ? "123" : "#+="), for: .normal)
      button.titleLabel?.font = .systemFont(ofSize: 16)
      button.addTarget(self, action: #selector(pageTapped(_:)), for: .touchUpInside)
    case .space:
      button.setTitle(vietnamese ? "Wispra · Tiếng Việt" : "Wispra", for: .normal)
      button.titleLabel?.font = .systemFont(ofSize: 15)
      button.accessibilityLabel = "Space"
      button.addTarget(self, action: #selector(spaceTapped), for: .touchUpInside)
    case .enter:
      button.setTitle("Nhập", for: .normal)
      button.titleLabel?.font = .systemFont(ofSize: 16)
      button.addTarget(self, action: #selector(enterTapped), for: .touchUpInside)
    case .globe:
      button.setImage(UIImage(systemName: "globe"), for: .normal)
      button.accessibilityLabel = "Next keyboard"
      button.addTarget(self, action: #selector(handleInputModeList(from:with:)), for: .allTouchEvents)
    case .language:
      button.setTitle(vietnamese ? "VN" : "EN", for: .normal)
      button.titleLabel?.font = .systemFont(ofSize: 15, weight: .medium)
      button.accessibilityLabel = vietnamese ? "Vietnamese Telex on" : "Vietnamese Telex off"
      button.addTarget(self, action: #selector(languageTapped), for: .touchUpInside)
    }
  }

  /// Letters keep one width; shift and delete sit at the edges; space takes what is left
  private func layoutKeys() {
    let width = keysView.bounds.width
    guard width > 0 else { return }
    let unit = (width - 2 * sideMargin - 9 * keyGap) / 10
    let rows = Dictionary(grouping: keyButtons, by: { $0.row })
    for r in 0..<4 {
      guard let row = rows[r] else { continue }
      let y = 8 + CGFloat(r) * (keyHeight + rowGap)
      func fixedWidth(_ kind: KeyKind) -> CGFloat? {
        switch kind {
        case .char: return page == .letters || r < 2 ? unit : nil
        case .space: return nil
        case .enter: return unit * 2.3
        case .shift, .delete: return unit * 1.35
        case .page: return r == 2 ? unit * 1.35 : unit * 1.25
        default: return unit * 1.25
        }
      }
      let fixed = row.compactMap { fixedWidth($0.kind) }.reduce(0, +)
      let flexCount = CGFloat(row.filter { fixedWidth($0.kind) == nil }.count)
      let gaps = CGFloat(row.count - 1) * keyGap
      if flexCount > 0 {
        let flex = (width - 2 * sideMargin - gaps - fixed) / flexCount
        var x = sideMargin
        for b in row {
          let w = fixedWidth(b.kind) ?? flex
          b.frame = CGRect(x: x, y: y, width: w, height: keyHeight)
          x += w + keyGap
        }
      } else if let first = row.first, let last = row.last, case .char = row[1].kind, first.kind != row[1].kind, !isChar(first.kind), !isChar(last.kind) {
        // Shift … delete: pinned to the edges, letters centred between them
        let fw = fixedWidth(first.kind) ?? unit
        first.frame = CGRect(x: sideMargin, y: y, width: fw, height: keyHeight)
        last.frame = CGRect(x: width - sideMargin - fw, y: y, width: fw, height: keyHeight)
        let middle = Array(row.dropFirst().dropLast())
        let mw = CGFloat(middle.count) * unit + CGFloat(middle.count - 1) * keyGap
        var x = (width - mw) / 2
        for b in middle {
          b.frame = CGRect(x: x, y: y, width: unit, height: keyHeight)
          x += unit + keyGap
        }
      } else {
        // A row of letters only: centred (a to l)
        let total = fixed + gaps
        var x = (width - total) / 2
        for b in row {
          let w = fixedWidth(b.kind) ?? unit
          b.frame = CGRect(x: x, y: y, width: w, height: keyHeight)
          x += w + keyGap
        }
      }
    }
  }

  private func isChar(_ kind: KeyKind) -> Bool {
    if case .char = kind { return true }
    return false
  }

  private func applyColors() {
    let background = dark ? UIColor(white: 0.17, alpha: 1) : UIColor(red: 0.82, green: 0.83, blue: 0.86, alpha: 1)
    view.backgroundColor = background
    strip.backgroundColor = background
    statusLabel.textColor = dark ? UIColor(white: 0.75, alpha: 1) : UIColor(white: 0.3, alpha: 1)
    undoButton.tintColor = purple
    for b in keyButtons { b.paint(dark: dark) }
  }

  // MARK: Typing

  @objc private func charTapped(_ sender: KeyButton) {
    guard case .char(let text) = sender.kind else { return }
    if vietnamese, page == .letters, text.count == 1, let key = text.first, key.isLetter {
      let word = KeyboardLogic.trailingWord(textDocumentProxy.documentContextBeforeInput)
      let next = Telex.apply(word, key: key)
      if next == word + text {
        textDocumentProxy.insertText(text)
      } else {
        for _ in 0..<word.count { textDocumentProxy.deleteBackward() }
        textDocumentProxy.insertText(next)
      }
    } else {
      textDocumentProxy.insertText(text)
    }
    lastTyped = nil
    if shift == .once {
      shift = .off
      buildKeys()
    }
    // After an apostrophe on the numbers page, back to letters, as the Apple keyboard does
    if page != .letters, text == "'" {
      page = .letters
      buildKeys()
    }
    refreshUndo()
  }

  @objc private func spaceTapped() {
    let before = textDocumentProxy.documentContextBeforeInput
    if Date().timeIntervalSince(lastSpaceTap) < 0.4, KeyboardLogic.doubleSpaceMakesPeriod(before: before) {
      textDocumentProxy.deleteBackward()
      textDocumentProxy.insertText(". ")
      lastSpaceTap = .distantPast
    } else {
      textDocumentProxy.insertText(" ")
      lastSpaceTap = Date()
    }
    if page != .letters {
      page = .letters
      buildKeys()
    }
    lastTyped = nil
    updateShiftForContext()
    refreshUndo()
  }

  @objc private func enterTapped() {
    textDocumentProxy.insertText("\n")
    lastTyped = nil
    updateShiftForContext()
    refreshUndo()
  }

  @objc private func shiftTapped() {
    let now = Date()
    if now.timeIntervalSince(lastShiftTap) < 0.3 {
      shift = .locked
    } else {
      shift = shift == .off ? .once : .off
    }
    lastShiftTap = now
    buildKeys()
  }

  @objc private func pageTapped(_ sender: KeyButton) {
    guard case .page(let target) = sender.kind else { return }
    page = target
    buildKeys()
  }

  @objc private func languageTapped() {
    vietnamese.toggle()
    UserDefaults.standard.set(vietnamese, forKey: "vietnamese")
    buildKeys()
  }

  @objc private func deleteDown() {
    deleteOnce()
    deleteTimer?.invalidate()
    deleteTimer = Timer.scheduledTimer(withTimeInterval: 0.45, repeats: false) { [weak self] _ in
      self?.deleteTimer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
        self?.deleteOnce()
      }
    }
  }

  @objc private func deleteUp() {
    stopDeleteRepeat()
    updateShiftForContext()
  }

  private func deleteOnce() {
    textDocumentProxy.deleteBackward()
    lastTyped = nil
    refreshUndo()
  }

  private func stopDeleteRepeat() {
    deleteTimer?.invalidate()
    deleteTimer = nil
  }

  /// Capital letter at the start of a sentence, like the Apple keyboard
  private func updateShiftForContext() {
    guard page == .letters, shift != .locked else { return }
    let wanted: Shift
    if textDocumentProxy.autocapitalizationType == UITextAutocapitalizationType.none {
      wanted = .off
    } else {
      wanted = KeyboardLogic.startsSentence(before: textDocumentProxy.documentContextBeforeInput) ? .once : .off
    }
    if wanted != shift {
      shift = wanted
      buildKeys()
    }
  }

  // MARK: Mic

  /// Purple: start speaking (or start a listening session in Wispra first). Red: done, type it.
  @objc private func micTapped() {
    problemShown = false
    guard hasFullAccess else {
      statusLabel.text = "Bật Cho phép truy cập đầy đủ để nói"
      return
    }
    if listening {
      // The app may have been stopped by iOS while the mic was red: then there is nothing to stop
      if WordsWait.appStopped(beatAgeMs: beatAgeMs()) {
        SharedLog.append("keyboard", "red mic tapped, but the app gave no sign of life for \(beatAgeText())")
        stopListeningBecauseAppStopped()
        return
      }
      SharedLog.append("keyboard", "red mic tapped: stop (app beat \(beatAgeText()) ago)")
      post("stop")
      listening = false
      listenTimer?.invalidate()
      waitingForWords = true
      waitingSince = Date()
      paintMic()
      statusLabel.text = "Đang viết…"
      startPolling(seconds: Self.wordsWaitSeconds)
      return
    }
    if let session = readSession(), SessionStatus.isLive(untilMs: session.until, beatMs: session.beat, nowMs: nowMs()) {
      SharedLog.append("keyboard", "purple mic tapped: session live (beat \(beatAgeText()) ago, \(SessionStatus.minutesLeft(untilMs: session.until, nowMs: nowMs())) min left): start")
      post("start")
      listening = true
      waitingSince = nil
      watchWhileListening()
      // A new utterance: whatever the last one still waited for is over
      waitingForWords = false
      piecesFailed = false
      lastTyped = nil
      refreshUndo()
      paintMic()
      statusLabel.text = "Đang nghe… bấm mic đỏ khi xong"
      return
    }
    // No session: Wispra starts one (Apple lets only the app start the microphone)
    SharedLog.append("keyboard", "purple mic tapped: no live session (\(sessionDescription())): opening Wispra")
    guard let url = URL(string: "wispra://keyboard-session") else { return }
    if openContainingApp(url) {
      statusLabel.text = "Bật phiên nghe trong Wispra, rồi bấm ◀ để quay lại"
    } else {
      statusLabel.text = "Mở Wispra để bật phiên nghe, rồi quay lại"
    }
  }

  // MARK: Never waiting for ever (T-0178)

  /// How long ago the app last wrote its beat; nil when there is no session status at all
  private func beatAgeMs() -> Double? {
    guard let session = readSession() else { return nil }
    return nowMs() - session.beat
  }

  private func beatAgeText() -> String {
    guard let age = beatAgeMs() else { return "no status" }
    return "\(Int(age / 1000)) s"
  }

  private func sessionDescription() -> String {
    guard let session = readSession() else { return "no session status" }
    let left = Int((session.until - nowMs()) / 60_000)
    return "beat \(Int((nowMs() - session.beat) / 1000)) s ago, \(left) min left"
  }

  static let appStoppedMessage = "Wispra đã bị iPhone dừng, chữ chưa tới. Mở Wispra rồi nói lại"

  /// The mic is red but the app is gone: back to purple, and say so
  private func stopListeningBecauseAppStopped() {
    listening = false
    listenTimer?.invalidate()
    waitingForWords = false
    waitingSince = nil
    paintMic()
    showProblem(Self.appStoppedMessage)
  }

  private func showProblem(_ text: String) {
    problemShown = true
    statusLabel.text = text
  }

  /// While the mic is red, look every 2 s whether the app still beats
  private func watchWhileListening() {
    listenTimer?.invalidate()
    listenTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] timer in
      guard let self = self, self.listening else {
        timer.invalidate()
        return
      }
      if WordsWait.appStopped(beatAgeMs: self.beatAgeMs()) {
        SharedLog.append("keyboard", "listening, but the app gave no sign of life for \(self.beatAgeText()): iOS stopped Wispra?")
        timer.invalidate()
        self.stopListeningBecauseAppStopped()
      }
    }
  }

  /// After the screen was locked or the keyboard reloaded: a wait that was going on is judged by how long ago
  /// it began
  private func resumeWaitIfAny() {
    guard waitingSince != nil else { return }
    waitingForWords = true
    checkWait()
  }

  /// Judges a wait for words: still waiting, the app stopped, or too long
  private func checkWait() {
    guard waitingForWords, let since = waitingSince else { return }
    let waited = Date().timeIntervalSince(since) * 1000
    switch WordsWait.outcome(waitedMs: waited, beatAgeMs: beatAgeMs()) {
    case .waiting:
      break
    case .appStopped:
      SharedLog.append("keyboard", "no words after \(Int(waited / 1000)) s and the app gave no sign of life for \(beatAgeText()): iOS stopped Wispra?")
      waitingForWords = false
      waitingSince = nil
      showProblem(Self.appStoppedMessage)
    case .timedOut:
      SharedLog.append("keyboard", "no words after \(Int(waited / 1000)) s (the app beats \(beatAgeText()) ago)")
      waitingForWords = false
      waitingSince = nil
      showProblem("Chưa nhận được chữ. Mở Wispra để xem bản ghi")
    }
  }

  private func paintMic() {
    micButton.backgroundColor = listening ? UIColor(red: 0xEF / 255.0, green: 0x44 / 255.0, blue: 0x44 / 255.0, alpha: 1) : lavender
    micButton.tintColor = listening ? .white : purple
    micButton.layer.cornerRadius = listening ? 16 : 8
    micButton.accessibilityLabel = listening ? "Listening. Tap to type what you said" : "Speak with Wispra"
  }

  private func showSession() {
    paintMic()
    // A message about a failure is not replaced by the idle text, whatever the keyboard reloaded for
    guard !listening, !problemShown, !waitingForWords else { return }
    if let session = readSession(), SessionStatus.isLive(untilMs: session.until, beatMs: session.beat, nowMs: nowMs()) {
      statusLabel.text = "Phiên nghe · còn \(SessionStatus.minutesLeft(untilMs: session.until, nowMs: nowMs())) phút"
    } else if lastTyped == nil {
      statusLabel.text = "Wispra"
    }
  }

  /// The session's status: from the shared keychain, which Wispra writes in the background too;
  /// the pasteboard only while Wispra was open (earlier builds)
  private func readSession() -> (until: Double, beat: Double)? {
    guard hasFullAccess else { return nil }
    let sources = [SharedChannel.read(.session), UIPasteboard(name: Self.sessionPasteboardName, create: false)?.string]
    let found = sources.compactMap { text -> (until: Double, beat: Double)? in
      guard let data = text?.data(using: .utf8),
            let status = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let until = status["until"] as? Double, let beat = status["beat"] as? Double else { return nil }
      return (until, beat)
    }
    // The freshest beat wins
    return found.max { $0.beat < $1.beat }
  }

  private func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

  private func post(_ name: String) {
    CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName("\(Self.notifyPrefix).\(name)" as CFString), nil, nil, true)
  }

  /// Wispra posts ".text" as soon as a piece is transcribed: typed right away
  private func observeWords() {
    guard !observingText else { return }
    observingText = true
    CFNotificationCenterAddObserver(
      CFNotificationCenterGetDarwinNotifyCenter(),
      Unmanaged.passUnretained(self).toOpaque(),
      { _, observer, _, _, _ in
        guard let observer = observer else { return }
        let keyboard = Unmanaged<KeyboardViewController>.fromOpaque(observer).takeUnretainedValue()
        DispatchQueue.main.async { keyboard.typeQueuedPieces() }
      },
      "\(Self.notifyPrefix).text" as CFString,
      nil,
      .deliverImmediately
    )
  }

  /// Types the pieces Wispra transcribed, in order, each once, where the cursor is
  func typeQueuedPieces() {
    guard hasFullAccess else { return }
    // The shared keychain (written in the background), then the pasteboard (earlier builds)
    let chunks = ChunkQueue.parse(SharedChannel.read(.chunks)) + ChunkQueue.parse(UIPasteboard(name: Self.chunksPasteboardName, create: false)?.string)
    let pieces = ChunkQueue.toType(chunks, typed: Set(typedPieces), nowMs: nowMs())
    guard !pieces.isEmpty else { return }
    for piece in pieces {
      typedPieces.append(piece.key)
      if piece.failed { piecesFailed = true }
      let words = piece.text.trimmingCharacters(in: .whitespacesAndNewlines)
      if !words.isEmpty {
        let commit = Self.spaced(before: textDocumentProxy.documentContextBeforeInput, words: words, after: textDocumentProxy.documentContextAfterInput)
        textDocumentProxy.insertText(commit)
        lastTyped = (lastTyped ?? "") + commit
      }
      if piece.last {
        if let since = waitingSince {
          SharedLog.append("keyboard", "words arrived after \(Int(Date().timeIntervalSince(since) * 1000)) ms")
        }
        waitingForWords = false
        waitingSince = nil
        statusLabel.text = piecesFailed
          ? "Không chép được lời. Bản ghi ở trong Wispra"
          : lastTyped == nil ? "Không nghe rõ, thử lại" : "Đã gõ bằng Wispra"
        piecesFailed = false
      }
    }
    if typedPieces.count > 200 { typedPieces.removeFirst(typedPieces.count - 200) }
    UserDefaults.standard.set(typedPieces, forKey: "typedPieces")
    refreshUndo()
  }

  @objc private func undo() {
    guard let typed = lastTyped, let before = textDocumentProxy.documentContextBeforeInput, before.hasSuffix(typed) else {
      lastTyped = nil
      refreshUndo()
      return
    }
    for _ in 0..<typed.count { textDocumentProxy.deleteBackward() }
    lastTyped = nil
    statusLabel.text = "Đã hoàn tác"
    refreshUndo()
  }

  private func refreshUndo() {
    undoButton.isHidden = lastTyped == nil
  }

  // MARK: Words from the Wispra app

  private func startPolling(seconds: TimeInterval) {
    pollUntil = Date().addingTimeInterval(seconds)
    pollTimer?.invalidate()
    pollTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] timer in
      guard let self = self else {
        timer.invalidate()
        return
      }
      self.typeWaitingWords()
      self.typeQueuedPieces()
      // Say what happened instead of "Đang viết…" for ever (the app stopped, or too long)
      self.checkWait()
      if Date() > self.pollUntil {
        timer.invalidate()
        if self.waitingForWords, let since = self.waitingSince {
          // The poll is over: whatever the beat says, the wait is
          SharedLog.append("keyboard", "no words after \(Int(Date().timeIntervalSince(since))) s")
          self.waitingForWords = false
          self.waitingSince = nil
          self.showProblem("Chưa nhận được chữ. Mở Wispra để xem bản ghi")
        }
      }
    }
  }

  /// Types the words Wispra left on the shared pasteboard, once
  private func typeWaitingWords() {
    guard hasFullAccess,
          let pasteboard = UIPasteboard(name: Self.pasteboardName, create: false),
          let json = pasteboard.string, !json.isEmpty,
          let data = json.data(using: .utf8),
          let note = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let id = note["id"] as? String,
          let text = note["text"] as? String,
          let at = note["at"] as? Double
    else { return }

    let defaults = UserDefaults.standard
    if defaults.string(forKey: "lastTypedId") == id { return }
    defaults.set(id, forKey: "lastTypedId")
    pasteboard.string = ""
    guard Date().timeIntervalSince1970 - at / 1000 < Self.maxAgeSeconds else { return }

    let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !words.isEmpty else { return }
    let commit = Self.spaced(before: textDocumentProxy.documentContextBeforeInput, words: words, after: textDocumentProxy.documentContextAfterInput)
    textDocumentProxy.insertText(commit)
    lastTyped = commit
    statusLabel.text = "Đã gõ bằng Wispra"
    refreshUndo()
  }

  /// Adds a space between the words already there and the new ones, as the Android keyboard does
  static func spaced(before: String?, words: String, after: String?) -> String {
    let noSpaceBefore: Set<Character> = [".", ",", "!", "?", ";", ":", ")", "]", "}", "…"]
    var out = words
    if let prev = before?.last, !prev.isWhitespace, let first = words.first, !noSpaceBefore.contains(first) {
      out = " " + out
    }
    if let next = after?.first, !next.isWhitespace, !noSpaceBefore.contains(next) {
      out += " "
    }
    return out
  }

  // MARK: Helpers

  /// Only possible with full access (keyboards without it cannot reach any pasteboard)
  private func markSeen() {
    guard hasFullAccess else { return }
    let at = String(Int(Date().timeIntervalSince1970 * 1000))
    SharedChannel.write(.seen, at)
    UIPasteboard(name: Self.seenPasteboardName, create: true)?.setItems([["public.utf8-plain-text": at]], options: [:])
  }

  /// Keyboards have no API to open their app. The usual way: find UIApplication in the responder
  /// chain and ask it to open the URL. `open(_:options:completionHandler:)` is marked unavailable
  /// in extensions, so it is called through the Objective-C runtime.
  private func openContainingApp(_ url: URL) -> Bool {
    typealias OpenURL = @convention(c) (AnyObject, Selector, NSURL, NSDictionary, AnyObject?) -> Void
    let selector = NSSelectorFromString("openURL:options:completionHandler:")
    var responder: UIResponder? = self
    while let current = responder {
      if current is UIApplication, current.responds(to: selector) {
        let implementation = current.method(for: selector)
        let open = unsafeBitCast(implementation, to: OpenURL.self)
        open(current, selector, url as NSURL, NSDictionary(), nil)
        return true
      }
      responder = current.next
    }
    return false
  }
}

/// One key, drawn like an Apple keyboard key
final class KeyButton: UIButton {
  let kind: KeyKind
  let row: Int

  init(kind: KeyKind, row: Int) {
    self.kind = kind
    self.row = row
    super.init(frame: .zero)
    layer.cornerRadius = 5
    layer.shadowOffset = CGSize(width: 0, height: 1)
    layer.shadowOpacity = 0.3
    layer.shadowRadius = 0
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not used")
  }

  /// Letter keys are light; shift, delete, 123 and the others darker, as on the Apple keyboard
  func paint(dark: Bool) {
    var isLetterKey = false
    switch kind {
    case .char, .space: isLetterKey = true
    default: isLetterKey = false
    }
    let face: UIColor
    if dark {
      face = isLetterKey ? UIColor(white: 0.42, alpha: 1) : UIColor(white: 0.27, alpha: 1)
    } else {
      face = isLetterKey ? .white : UIColor(red: 0.67, green: 0.69, blue: 0.73, alpha: 1)
    }
    backgroundColor = face
    let ink: UIColor = dark ? .white : .black
    setTitleColor(ink, for: .normal)
    tintColor = ink
    layer.shadowColor = UIColor.black.cgColor
  }

  override var isHighlighted: Bool {
    didSet { alpha = isHighlighted ? 0.6 : 1 }
  }
}
