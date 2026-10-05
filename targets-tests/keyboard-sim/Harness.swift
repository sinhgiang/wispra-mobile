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
    print("KEYBOARD HARNESS OK")
    exit(0)
  }
}
