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

  /// <team>.com.sinhgiang.wispramobile.shared. The team prefix comes from Info.plist
  /// ("AppIdentifierPrefix", filled in at build time); if that is missing it is read from the keychain
  /// itself, so the app and the keyboard never end up writing and reading in two different default
  /// groups without a sign (T-0163 review). nil only when no team can be found at all.
  static var accessGroup: String? {
    if let prefix = teamPrefix { return prefix + groupSuffix }
    return nil
  }

  private static var cachedPrefix: String??

  /// "AY64ZULZ5R." (with the dot)
  static var teamPrefix: String? {
    if let cached = cachedPrefix { return cached }
    var prefix: String?
    if let plist = Bundle.main.object(forInfoDictionaryKey: "AppIdentifierPrefix") as? String, !plist.isEmpty, !plist.contains("$") {
      prefix = plist
    } else {
      prefix = prefixFromKeychain()
    }
    cachedPrefix = .some(prefix)
    return prefix
  }

  /// The team prefix of the access group the keychain gives an item saved without one (the first
  /// group of the entitlement: "<team>.<bundle id>" for the app, "<team>.com.sinhgiang…shared" for
  /// the keyboard)
  static func prefixFromKeychain() -> String? {
    let probe: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service + ".probe",
      kSecAttrAccount as String: "probe",
    ]
    var add = probe
    add[kSecValueData as String] = Data("1".utf8)
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let added = SecItemAdd(add as CFDictionary, nil)
    guard added == errSecSuccess || added == errSecDuplicateItem else { return nil }
    var read = probe
    read[kSecReturnAttributes as String] = true
    read[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(read as CFDictionary, &result) == errSecSuccess,
          let attributes = result as? [String: Any],
          let group = attributes[kSecAttrAccessGroup as String] as? String,
          let dot = group.firstIndex(of: ".") else { return nil }
    return String(group[...dot])
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
