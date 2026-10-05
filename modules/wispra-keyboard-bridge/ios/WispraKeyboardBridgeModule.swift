import ExpoModulesCore
import UIKit

/// The Wispra keyboard on iPhone has no microphone (Apple's rule for keyboards), so the app records
/// and transcribes, then leaves the words here for the keyboard to type
/// (targets/keyboard/KeyboardViewController.swift reads the same pasteboard).
public class WispraKeyboardBridgeModule: Module {
  static let pasteboardName = UIPasteboard.Name("com.sinhgiang.wispramobile.keyboard")
  static let seenPasteboardName = UIPasteboard.Name("com.sinhgiang.wispramobile.keyboard.seen")
  static let keyboardBundleId = "com.sinhgiang.wispramobile.keyboard"

  public func definition() -> ModuleDefinition {
    Name("WispraKeyboardBridge")

    // The listening session behind the keyboard's mic (KeyboardSession)
    Events("onChunk", "onSession")

    OnCreate {
      KeyboardSession.shared.onChunk = { [weak self] info in self?.sendEvent("onChunk", info) }
      KeyboardSession.shared.onState = { [weak self] state in self?.sendEvent("onSession", state) }
    }

    AsyncFunction("startSession") { (minutes: Double) -> [String: Any] in
      try KeyboardSession.shared.start(minutes: minutes)
      return KeyboardSession.shared.state
    }.runOnQueue(.main)

    AsyncFunction("endSession") { () -> [String: Any] in
      KeyboardSession.shared.end()
      return KeyboardSession.shared.state
    }.runOnQueue(.main)

    AsyncFunction("sessionState") { () -> [String: Any] in
      KeyboardSession.shared.state
    }.runOnQueue(.main)

    // A transcribed piece for the keyboard, typed at the cursor in order
    AsyncFunction("deliverText") { (utterance: String, index: Int, text: String, last: Bool) -> Bool in
      KeyboardSession.shared.deliver(utterance: utterance, index: index, text: text, last: last)
    }.runOnQueue(.main)

    // Whether the Wispra keyboard is turned on in Settings (from the list of keyboards iOS keeps,
    // null when it cannot be read), and when it was last on screen (ms since 1970, null: never,
    // or full access is off)
    AsyncFunction("keyboardStatus") { () -> [String: Any] in
      var status: [String: Any] = ["enabled": NSNull(), "lastSeenAt": NSNull()]
      if let keyboards = UserDefaults.standard.object(forKey: "AppleKeyboards") as? [String] {
        status["enabled"] = keyboards.contains { $0.hasPrefix(Self.keyboardBundleId) }
      }
      if let pasteboard = UIPasteboard(name: Self.seenPasteboardName, create: false),
         let text = pasteboard.string, let at = Double(text) {
        status["lastSeenAt"] = at
      }
      return status
    }.runOnQueue(.main)

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
