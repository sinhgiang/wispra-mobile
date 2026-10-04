import ExpoModulesCore
import UIKit

/// The Wispra keyboard on iPhone has no microphone (Apple's rule for keyboards), so the app records
/// and transcribes, then leaves the words here for the keyboard to type
/// (targets/keyboard/KeyboardViewController.swift reads the same pasteboard).
public class WispraKeyboardBridgeModule: Module {
  static let pasteboardName = UIPasteboard.Name("com.sinhgiang.wispramobile.keyboard")

  public func definition() -> ModuleDefinition {
    Name("WispraKeyboardBridge")

    // { id, text, at }: at is milliseconds since 1970, so the keyboard ignores stale words
    AsyncFunction("handOff") { (id: String, text: String) -> Bool in
      guard let pasteboard = UIPasteboard(name: Self.pasteboardName, create: true) else { return false }
      let note: [String: Any] = ["id": id, "text": text, "at": Date().timeIntervalSince1970 * 1000]
      guard let data = try? JSONSerialization.data(withJSONObject: note),
            let json = String(data: data, encoding: .utf8) else { return false }
      pasteboard.setItems(
        // Plain text, which is what the keyboard reads with `pasteboard.string`
        [["public.utf8-plain-text": json]],
        options: [.expirationDate: Date().addingTimeInterval(15 * 60)]
      )
      return true
    }.runOnQueue(.main)
  }
}
