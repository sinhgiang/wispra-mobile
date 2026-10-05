import UIKit

/// Runs the real Wispra keyboard (KeyboardViewController) inside a small app on the iOS simulator,
/// on GitHub's macOS machines: it loads, appears, lays out its keys and has every key tapped. A crash
/// anywhere in that code ends the app without the OK line, and the workflow step fails. It cannot
/// show the keyboard inside another app (iOS does that), but it runs the same code iOS runs then.
@main
final class HarnessApp: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds)
    let host = UIViewController()
    host.view.backgroundColor = .white
    window.rootViewController = host
    window.makeKeyAndVisible()
    self.window = window
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { Self.run(in: host) }
    return true
  }

  static func check(_ ok: Bool, _ what: String) {
    print(ok ? "ok: \(what)" : "FAILED: \(what)")
    if !ok { exit(1) }
  }

  static func buttons(in view: UIView) -> [UIView] {
    view.subviews.flatMap { [$0] + buttons(in: $0) }
  }

  static func keys(_ keyboard: UIViewController) -> [KeyButton] {
    buttons(in: keyboard.view).compactMap { $0 as? KeyButton }
  }

  static func run(in host: UIViewController) {
    let keyboard = KeyboardViewController()
    host.addChild(keyboard)
    let width = host.view.bounds.width
    keyboard.view.frame = CGRect(x: 0, y: host.view.bounds.height - 270, width: width, height: 270)
    host.view.addSubview(keyboard.view)
    keyboard.didMove(toParent: host)
    keyboard.beginAppearanceTransition(true, animated: false)
    keyboard.endAppearanceTransition()
    keyboard.view.layoutIfNeeded()

    let first = keys(keyboard)
    check(first.count >= 30, "the keyboard shows its keys (\(first.count))")
    check(first.allSatisfy { $0.frame.width > 8 && $0.frame.minX >= 0 && $0.frame.maxX <= width + 0.5 }, "every key is inside the keyboard")
    check(buttons(in: keyboard.view).contains { ($0 as? UIButton)?.accessibilityLabel == "Speak with Wispra" }, "the purple mic is there")

    // Every key once, on every page (the globe needs a real touch from iOS, and delete repeats on a timer)
    for round in 0..<3 {
      for key in keys(keyboard) {
        switch key.kind {
        case .globe, .delete: continue
        default: key.sendActions(for: .touchUpInside)
        }
        keyboard.view.layoutIfNeeded()
      }
      print("ok: round \(round) of key taps")
    }
    for key in keys(keyboard) where key.kind == .delete {
      key.sendActions(for: .touchDown)
      key.sendActions(for: .touchUpInside)
    }
    for button in buttons(in: keyboard.view).compactMap({ $0 as? UIButton }) where button.accessibilityLabel == "Speak with Wispra" {
      button.sendActions(for: .touchUpInside)
    }
    // The keyboard goes away and comes back, as when switching apps
    keyboard.beginAppearanceTransition(false, animated: false)
    keyboard.endAppearanceTransition()
    keyboard.beginAppearanceTransition(true, animated: false)
    keyboard.endAppearanceTransition()
    keyboard.view.layoutIfNeeded()
    check(keys(keyboard).count >= 30, "the keys are back after showing again")
    keyboard.beginAppearanceTransition(false, animated: false)
    keyboard.endAppearanceTransition()
    keyboard.willMove(toParent: nil)
    keyboard.view.removeFromSuperview()
    keyboard.removeFromParent()

    runWithFullAccess(in: host)
  }

  /// The same keyboard as on the owner's iPhone, where "Allow Full Access" is on: it writes the
  /// pasteboards, reads the listening session, turns the mic red and back, and types the pieces the
  /// app hands over (named pasteboards and Darwin notifications, as with the real app).
  static func runWithFullAccess(in host: UIViewController) {
    let getter = #selector(getter: UIInputViewController.hasFullAccess)
    guard let method = class_getInstanceMethod(UIInputViewController.self, getter) else {
      check(false, "hasFullAccess can be set for the test")
      return
    }
    let yes: @convention(block) (AnyObject) -> Bool = { _ in true }
    method_setImplementation(method, imp_implementationWithBlock(yes))

    let now = Date().timeIntervalSince1970 * 1000
    UIPasteboard(name: KeyboardViewController.sessionPasteboardName, create: true)?.string =
      "{\"until\": \(now + 10 * 60 * 1000), \"beat\": \(now)}"
    UIPasteboard(name: KeyboardViewController.chunksPasteboardName, create: true)?.string =
      "[{\"u\": \"t1\", \"i\": 0, \"text\": \"xin chào\", \"at\": \(now)}, {\"u\": \"t1\", \"i\": 1, \"text\": \"cả nhà\", \"at\": \(now), \"last\": true}]"

    let keyboard = KeyboardViewController()
    check(keyboard.hasFullAccess, "the keyboard runs with full access")
    host.addChild(keyboard)
    keyboard.view.frame = CGRect(x: 0, y: host.view.bounds.height - 270, width: host.view.bounds.width, height: 270)
    host.view.addSubview(keyboard.view)
    keyboard.didMove(toParent: host)
    keyboard.beginAppearanceTransition(true, animated: false)
    keyboard.endAppearanceTransition()
    keyboard.view.layoutIfNeeded()
    check(keys(keyboard).count >= 30, "with full access, the keyboard shows its keys")

    let seen = UIPasteboard(name: KeyboardViewController.seenPasteboardName, create: false)?.string ?? ""
    check(Double(seen) != nil, "it notes that it was on screen (Account shows In use)")

    let mic = buttons(in: keyboard.view).compactMap { $0 as? UIButton }.first { $0.accessibilityLabel == "Speak with Wispra" }
    check(mic != nil, "the purple mic is there")
    mic?.sendActions(for: .touchUpInside)
    check(mic?.accessibilityLabel == "Listening. Tap to type what you said", "a live session: the mic turns red")
    mic?.sendActions(for: .touchUpInside)
    check(mic?.accessibilityLabel == "Speak with Wispra", "tapped again: the mic is purple")

    // The app says a piece is ready, as it does after transcribing
    CFNotificationCenterPostNotification(
      CFNotificationCenterGetDarwinNotifyCenter(),
      CFNotificationName("\(KeyboardViewController.notifyPrefix).text" as CFString), nil, nil, true)
    keyboard.typeQueuedPieces()
    for key in keys(keyboard) where key.kind != .globe && key.kind != .delete {
      key.sendActions(for: .touchUpInside)
    }

    // No session any more: the mic opens the Wispra app (nothing answers here, which is fine)
    UIPasteboard(name: KeyboardViewController.sessionPasteboardName, create: true)?.string = ""
    mic?.sendActions(for: .touchUpInside)
    check(mic?.accessibilityLabel == "Speak with Wispra", "without a session the mic stays purple")

    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
      keyboard.beginAppearanceTransition(false, animated: false)
      keyboard.endAppearanceTransition()
      keyboard.willMove(toParent: nil)
      keyboard.view.removeFromSuperview()
      keyboard.removeFromParent()
      runThroughSharedKeychain(in: host)
    }
  }

  /// T-0163: during a session Wispra runs in the background, where iOS refuses it the pasteboard, so
  /// the status and the words go through the shared keychain. The app side here is the real one
  /// (KeyboardSession.deliver); the pasteboards are then emptied, as they are on the iPhone while
  /// Wispra is in the background, and the keyboard must still see the session and type the words.
  static func runThroughSharedKeychain(in host: UIViewController) {
    check(SharedChannel.accessGroup == "TEST.com.sinhgiang.wispramobile.shared", "the shared keychain group is named from the team prefix")
    let now = Date().timeIntervalSince1970 * 1000
    check(SharedChannel.write(.session, "{\"until\": \(now + 10 * 60 * 1000), \"beat\": \(now)}"), "the app writes the session status to the shared keychain")
    SharedChannel.remove(.chunks)
    check(KeyboardSession.shared.deliver(utterance: "t2", index: 0, text: "họp lúc", last: false), "the app hands over a piece through the shared keychain")
    check(KeyboardSession.shared.deliver(utterance: "t2", index: 1, text: "2 giờ", last: true), "and the last piece")
    let stored = ChunkQueue.parse(SharedChannel.read(.chunks)).filter { $0.utterance == "t2" }
    check(stored.map(\.text) == ["họp lúc", "2 giờ"] && stored.last?.last == true, "the keychain holds both pieces, in order")
    // What the keyboard finds while Wispra is in the background: no pasteboard at all
    for name in [KeyboardViewController.sessionPasteboardName, KeyboardViewController.chunksPasteboardName, KeyboardViewController.seenPasteboardName] {
      UIPasteboard(name: name, create: true)?.string = ""
    }
    SharedChannel.remove(.seen)

    let keyboard = KeyboardViewController()
    host.addChild(keyboard)
    keyboard.view.frame = CGRect(x: 0, y: host.view.bounds.height - 270, width: host.view.bounds.width, height: 270)
    host.view.addSubview(keyboard.view)
    keyboard.didMove(toParent: host)
    keyboard.beginAppearanceTransition(true, animated: false)
    keyboard.endAppearanceTransition()
    keyboard.view.layoutIfNeeded()

    check(Double(SharedChannel.read(.seen) ?? "") != nil, "the keyboard notes it was on screen in the shared keychain (Account: In use)")
    let undo = buttons(in: keyboard.view).compactMap { $0 as? UIButton }.first { $0.title(for: .normal) == "Hoàn tác" }
    check(undo?.isHidden == false, "the keyboard typed the pieces from the shared keychain (Undo shows)")
    let mic = buttons(in: keyboard.view).compactMap { $0 as? UIButton }.first { $0.accessibilityLabel == "Speak with Wispra" }
    mic?.sendActions(for: .touchUpInside)
    check(mic?.accessibilityLabel == "Listening. Tap to type what you said", "the session from the shared keychain is live: the mic turns red")
    mic?.sendActions(for: .touchUpInside)
    check(mic?.accessibilityLabel == "Speak with Wispra", "tapped again: purple, waiting for the words")

    keyboard.beginAppearanceTransition(false, animated: false)
    keyboard.endAppearanceTransition()
    print("KEYBOARD HARNESS OK")
    exit(0)
  }
}
