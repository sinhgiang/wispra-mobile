import Foundation
import Security

/// What the Wispra app and the Wispra keyboard share (T-0163): the listening session's status, the
/// words of each piece, and when the keyboard was last on screen.
///
/// It used to be named pasteboards, but iOS lets an app use the pasteboard only while it is in the
/// foreground (since iOS 9). During a listening session Wispra runs in the background, so every
/// status beat and every piece of words it wrote was lost, and the keyboard said "Đang viết…"
/// forever. The keychain works in the background: both sides use the shared access group
/// <team>.com.sinhgiang.wispramobile.shared (keychain-access-groups entitlement; the App Store
/// profiles allow <team>.* already, so nothing is registered with Apple). The keyboard reaches it
/// with full access, which the mic needs anyway.
///
/// The same file is in targets/keyboard and modules/wispra-keyboard-bridge/ios; CI checks that the
/// two copies are identical.
enum SharedChannel {
  static let service = "com.sinhgiang.wispramobile.keyboard"
  static let groupSuffix = "com.sinhgiang.wispramobile.shared"

  enum Key: String {
    case session, chunks, seen
  }

  /// <team>.com.sinhgiang.wispramobile.shared; nil when the build has no team (unsigned builds and
  /// tests), which uses the default access group
  static var accessGroup: String? {
    guard let prefix = Bundle.main.object(forInfoDictionaryKey: "AppIdentifierPrefix") as? String,
          !prefix.isEmpty, !prefix.contains("$") else { return nil }
    return prefix + groupSuffix
  }

  private static func query(_ key: Key) -> [String: Any] {
    var q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key.rawValue,
    ]
    if let group = accessGroup { q[kSecAttrAccessGroup as String] = group }
    return q
  }

  /// Saves the text; true when it is stored
  @discardableResult
  static func write(_ key: Key, _ text: String) -> Bool {
    let data = Data(text.utf8)
    let update: [String: Any] = [kSecValueData as String: data]
    let status = SecItemUpdate(query(key) as CFDictionary, update as CFDictionary)
    if status == errSecSuccess { return true }
    guard status == errSecItemNotFound else { return false }
    var add = query(key)
    add[kSecValueData as String] = data
    // Readable while the phone is locked after the first unlock (the app writes in the background),
    // and never copied to other devices
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
  }

  /// The text saved under the key, or nil
  static func read(_ key: Key) -> String? {
    var q = query(key)
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  static func remove(_ key: Key) {
    SecItemDelete(query(key) as CFDictionary)
  }
}
