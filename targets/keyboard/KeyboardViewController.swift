import UIKit

/// The Wispra keyboard on iPhone.
///
/// Apple gives keyboards no microphone ("Custom keyboards ... have no access to the device
/// microphone, so dictation input is not possible"), so the words are spoken in the Wispra app:
/// Speak opens Wispra, which records, transcribes with Wispra Cloud and leaves the words on a named
/// pasteboard shared by apps of the same team. Back in the other app, the keyboard types them at
/// the cursor. ABC (the globe) goes back to the usual keyboard.
final class KeyboardViewController: UIInputViewController {
  /// Same name as in modules/wispra-keyboard-bridge (the app writes, the keyboard reads)
  static let pasteboardName = UIPasteboard.Name("com.sinhgiang.wispramobile.keyboard")
  /// Words older than this are not typed any more
  static let maxAgeSeconds: TimeInterval = 15 * 60

  private let status = UILabel()
  private let speakButton = UIButton(type: .system)
  private let undoButton = UIButton(type: .system)
  private let globeButton = UIButton(type: .system)
  private let deleteButton = UIButton(type: .system)
  private let returnButton = UIButton(type: .system)

  private var pollTimer: Timer?
  private var pollUntil = Date.distantPast
  /// What the keyboard typed last, for Undo
  private var lastTyped: String?

  private let accent = UIColor(red: 0x63 / 255.0, green: 0x66 / 255.0, blue: 0xF1 / 255.0, alpha: 1)
  private let panel = UIColor(red: 0x15 / 255.0, green: 0x17 / 255.0, blue: 0x1D / 255.0, alpha: 1)
  private let keyColor = UIColor(red: 0x26 / 255.0, green: 0x2A / 255.0, blue: 0x33 / 255.0, alpha: 1)
  private let muted = UIColor(red: 0x88 / 255.0, green: 0x92 / 255.0, blue: 0xA4 / 255.0, alpha: 1)

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = panel

    status.textColor = muted
    status.font = .systemFont(ofSize: 12)
    status.numberOfLines = 2
    status.text = "Wispra keyboard"

    speakButton.backgroundColor = accent
    speakButton.tintColor = .white
    speakButton.layer.cornerRadius = 26
    speakButton.setImage(UIImage(systemName: "mic.fill"), for: .normal)
    speakButton.setTitle("  Speak", for: .normal)
    speakButton.titleLabel?.font = .boldSystemFont(ofSize: 16)
    speakButton.accessibilityLabel = "Speak with Wispra"
    speakButton.addTarget(self, action: #selector(speak), for: .touchUpInside)

    style(undoButton, title: "Undo")
    undoButton.addTarget(self, action: #selector(undo), for: .touchUpInside)
    style(globeButton, title: "ABC")
    globeButton.accessibilityLabel = "Next keyboard"
    globeButton.addTarget(self, action: #selector(handleInputModeList(from:with:)), for: .allTouchEvents)
    style(deleteButton, title: "⌫")
    deleteButton.accessibilityLabel = "Delete"
    deleteButton.addTarget(self, action: #selector(deleteBackwardOnce), for: .touchUpInside)
    style(returnButton, title: "return")
    returnButton.addTarget(self, action: #selector(insertReturn), for: .touchUpInside)

    let keys = UIStackView(arrangedSubviews: [globeButton, undoButton, deleteButton, returnButton])
    keys.axis = .horizontal
    keys.spacing = 8
    keys.distribution = .fillEqually

    let stack = UIStackView(arrangedSubviews: [status, speakButton, keys])
    stack.axis = .vertical
    stack.spacing = 10
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)

    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
      stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
      stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 10),
      stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -10),
      speakButton.heightAnchor.constraint(equalToConstant: 52),
      keys.heightAnchor.constraint(equalToConstant: 42),
    ])
    refreshButtons()
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    globeButton.isHidden = !needsInputModeSwitchKey
    // Coming back from Wispra: the words may already be waiting, or arrive in a moment
    typeWaitingWords()
    startPolling(seconds: 60)
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    pollTimer?.invalidate()
    pollTimer = nil
  }

  override func textDidChange(_ textInput: UITextInput?) {
    super.textDidChange(textInput)
    refreshButtons()
  }

  // MARK: Buttons

  @objc private func speak() {
    guard hasFullAccess else {
      status.text = "Turn on Allow Full Access: Settings > General > Keyboard > Keyboards > Wispra."
      return
    }
    guard let url = URL(string: "wispra://keyboard-dictation") else { return }
    if openContainingApp(url) {
      status.text = "Speak in Wispra and tap Done, then come back here. Your words are typed by themselves."
      startPolling(seconds: 300)
    } else {
      status.text = "Open the Wispra app, tap Dictate, then come back here."
    }
  }

  @objc private func undo() {
    guard let typed = lastTyped, let before = textDocumentProxy.documentContextBeforeInput, before.hasSuffix(typed) else {
      status.text = "Nothing to undo."
      lastTyped = nil
      refreshButtons()
      return
    }
    for _ in 0..<typed.count { textDocumentProxy.deleteBackward() }
    lastTyped = nil
    status.text = "Undone"
    refreshButtons()
  }

  @objc private func deleteBackwardOnce() {
    textDocumentProxy.deleteBackward()
    lastTyped = nil
    refreshButtons()
  }

  @objc private func insertReturn() {
    textDocumentProxy.insertText("\n")
    lastTyped = nil
    refreshButtons()
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
      if Date() > self.pollUntil {
        timer.invalidate()
        return
      }
      self.typeWaitingWords()
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
    status.text = "Typed by Wispra"
    refreshButtons()
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

  private func refreshButtons() {
    undoButton.isEnabled = lastTyped != nil
    undoButton.alpha = undoButton.isEnabled ? 1 : 0.4
  }

  private func style(_ button: UIButton, title: String) {
    button.setTitle(title, for: .normal)
    button.setTitleColor(.white, for: .normal)
    button.titleLabel?.font = .systemFont(ofSize: 15)
    button.backgroundColor = keyColor
    button.layer.cornerRadius = 10
  }
}
