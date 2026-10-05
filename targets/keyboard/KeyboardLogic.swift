import Foundation

/// What the Wispra keyboard shows and the small typing rules of the Apple keyboard it follows.
/// Foundation only, so it is tested on its own (targets-tests/keyboard/KeyboardTests.swift).
enum KeyboardPage: Equatable {
  case letters, numbers, symbols
}

enum KeyKind: Equatable {
  case char(String)
  case shift
  case delete
  case page(KeyboardPage)
  case space
  case enter
  case globe
  /// Vietnamese (Telex) on or off
  case language
}

enum KeyboardLogic {
  /// The rows of keys, like the Apple keyboard on iPhone
  static func rows(page: KeyboardPage, upper: Bool, showGlobe: Bool) -> [[KeyKind]] {
    func chars(_ s: String) -> [KeyKind] { s.map { .char(upper ? String($0).uppercased() : String($0)) } }
    func plain(_ list: [String]) -> [KeyKind] { list.map { .char($0) } }
    var bottom: [KeyKind] = [.page(page == .letters ? .numbers : .letters)]
    if showGlobe { bottom.append(.globe) }
    bottom += [.language, .space, .enter]
    switch page {
    case .letters:
      return [chars("qwertyuiop"), chars("asdfghjkl"), [.shift] + chars("zxcvbnm") + [.delete], bottom]
    case .numbers:
      return [
        plain(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]),
        plain(["-", "/", ":", ";", "(", ")", "₫", "&", "@", "\""]),
        [.page(.symbols)] + plain([".", ",", "?", "!", "'"]) + [.delete],
        bottom,
      ]
    case .symbols:
      return [
        plain(["[", "]", "{", "}", "#", "%", "^", "*", "+", "="]),
        plain(["_", "\\", "|", "~", "<", ">", "$", "€", "£", "•"]),
        [.page(.numbers)] + plain([".", ",", "?", "!", "'"]) + [.delete],
        bottom,
      ]
    }
  }

  /// A capital letter comes next: at the start of the text, of a line, or after . ? ! and a space
  static func startsSentence(before: String?) -> Bool {
    guard let before = before, !before.isEmpty else { return true }
    if before.hasSuffix("\n") { return true }
    let trimmed = before.trimmingCharacters(in: .whitespaces)
    guard before.last == " ", let last = trimmed.last else { return trimmed.isEmpty }
    return [".", "?", "!"].contains(last)
  }

  /// Two spaces in a row after a word make ". " (as on the Apple keyboard)
  static func doubleSpaceMakesPeriod(before: String?) -> Bool {
    guard let before = before, before.hasSuffix(" "), before.count >= 2 else { return false }
    let prev = before[before.index(before.endIndex, offsetBy: -2)]
    return prev.isLetter || prev.isNumber
  }

  /// The word being typed: the letters just before the cursor
  static func trailingWord(_ before: String?) -> String {
    guard let before = before else { return "" }
    var word = ""
    for c in before.reversed() {
      guard c.isLetter else { break }
      word.insert(c, at: word.startIndex)
    }
    return word
  }
}
