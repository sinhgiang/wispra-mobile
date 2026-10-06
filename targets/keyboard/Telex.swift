import Foundation

/// Vietnamese typing in the Telex style, as most Vietnamese type on a phone:
/// - tones: s sắc, f huyền, r hỏi, x ngã, j nặng, z removes the tone
/// - letters: aa â, aw ă, ee ê, oo ô, ow ơ, uw ư (uow ươ), dd đ, w alone ư
/// - pressing the same key again undoes it: ass → as, aaa → aa, ddd → dd, ww → w
/// The tone goes where the traditional rules put it (hòa, thủy, của, người, được, quá, già).
/// Foundation only, so it is tested on its own (targets-tests/keyboard/TelexTests.swift).
enum Telex {
  enum Tone: Int {
    case none = 0, acute, grave, hook, tilde, dot
  }

  struct Letter: Equatable {
    var base: Character
    var upper: Bool
  }

  static let vowels: [Character: [Character]] = [
    "a": ["a", "á", "à", "ả", "ã", "ạ"], "ă": ["ă", "ắ", "ằ", "ẳ", "ẵ", "ặ"], "â": ["â", "ấ", "ầ", "ẩ", "ẫ", "ậ"],
    "e": ["e", "é", "è", "ẻ", "ẽ", "ẹ"], "ê": ["ê", "ế", "ề", "ể", "ễ", "ệ"], "i": ["i", "í", "ì", "ỉ", "ĩ", "ị"],
    "o": ["o", "ó", "ò", "ỏ", "õ", "ọ"], "ô": ["ô", "ố", "ồ", "ổ", "ỗ", "ộ"], "ơ": ["ơ", "ớ", "ờ", "ở", "ỡ", "ợ"],
    "u": ["u", "ú", "ù", "ủ", "ũ", "ụ"], "ư": ["ư", "ứ", "ừ", "ử", "ữ", "ự"], "y": ["y", "ý", "ỳ", "ỷ", "ỹ", "ỵ"],
  ]

  /// Every Vietnamese vowel with a tone, back to its letter and tone
  static let toned: [Character: (Character, Tone)] = {
    var map: [Character: (Character, Tone)] = [:]
    for (base, forms) in vowels {
      for (i, form) in forms.enumerated() {
        map[form] = (base, Tone(rawValue: i) ?? .none)
      }
    }
    return map
  }()

  static let toneKeys: [Character: Tone] = ["s": .acute, "f": .grave, "r": .hook, "x": .tilde, "j": .dot]
  static let marked: Set<Character> = ["ă", "â", "ê", "ô", "ơ", "ư"]

  static func isVowel(_ c: Character) -> Bool { vowels[c] != nil }

  private static func lower(_ c: Character) -> Character {
    Character(String(c).lowercased())
  }

  private static func isLetter(_ c: Character) -> Bool {
    let l = lower(c)
    return ("a"..."z").contains(l) || l == "đ" || toned[l] != nil
  }

  /// The word as letters and one tone; nil when it is not a word Telex can work on
  static func parse(_ word: String) -> (letters: [Letter], tone: Tone)? {
    var letters: [Letter] = []
    var tone = Tone.none
    for c in word {
      let l = lower(c)
      let upper = c != l
      if let (base, t) = toned[l] {
        if t != .none {
          if tone != .none { return nil }
          tone = t
        }
        letters.append(Letter(base: base, upper: upper))
      } else if isLetter(c) {
        letters.append(Letter(base: l, upper: upper))
      } else {
        return nil
      }
    }
    return (letters, tone)
  }

  /// Which letter carries the tone
  static func tonePosition(_ letters: [Letter]) -> Int? {
    let bases = letters.map { $0.base }
    var idx = bases.indices.filter { isVowel(bases[$0]) }
    if idx.isEmpty { return nil }
    // In "qu" and "gi" the u and the i belong to the consonant when another vowel follows
    if idx.count > 1, idx[0] == 1, (bases[0] == "q" && bases[1] == "u") || (bases[0] == "g" && bases[1] == "i") {
      idx.removeFirst()
    }
    if idx.count == 1 { return idx[0] }
    // A vowel with a hat, a breve or a horn takes it (for ươ, the ơ)
    if let m = idx.last(where: { marked.contains(bases[$0]) }) { return m }
    if idx.count >= 3 { return idx[1] }
    let hasFinal = idx[idx.count - 1] < bases.count - 1
    return hasFinal ? idx[1] : idx[0]
  }

  static func render(_ letters: [Letter], _ tone: Tone) -> String {
    let at = tone == .none ? nil : tonePosition(letters)
    var out = ""
    for (i, letter) in letters.enumerated() {
      var c = letter.base
      if i == at, let forms = vowels[c] { c = forms[tone.rawValue] }
      out += letter.upper ? String(c).uppercased() : String(c)
    }
    return out
  }

  /// The word after typing [key] at its end
  static func apply(_ word: String, key: Character) -> String {
    let k = lower(key)
    let upper = key != k
    guard ("a"..."z").contains(k), let parsed = parse(word) else { return word + String(key) }
    var letters = parsed.letters
    let tone = parsed.tone
    let plain = word + String(key)
    let hasVowel = letters.contains { isVowel($0.base) }

    if let t = toneKeys[k] {
      guard hasVowel else { return plain }
      // The same tone again: take it off and keep the key as a letter (ass → as)
      if tone == t { return render(letters, .none) + String(key) }
      return render(letters, t)
    }
    if k == "z" {
      guard tone != .none else { return plain }
      return render(letters, .none)
    }
    if k == "a" || k == "e" || k == "o" {
      let hat: Character = k == "a" ? "â" : (k == "e" ? "ê" : "ô")
      if let i = letters.lastIndex(where: { $0.base == k || $0.base == hat }) {
        if letters[i].base == hat {
          letters[i].base = k
          return render(letters, tone) + String(key)
        }
        // Only a vowel right before the key, or in the same vowel group, gets the hat
        if i >= letters.count - 3 {
          letters[i].base = hat
          return render(letters, tone)
        }
      }
      letters.append(Letter(base: k, upper: upper))
      return render(letters, tone)
    }
    if k == "w" {
      // uo, ưo, uơ → ươ
      if let i = letters.indices.dropLast().last(where: { ["u", "ư"].contains(letters[$0].base) && ["o", "ơ"].contains(letters[$0 + 1].base) }) {
        if letters[i].base == "ư" && letters[i + 1].base == "ơ" {
          letters[i].base = "u"
          letters[i + 1].base = "o"
          return render(letters, tone) + String(key)
        }
        letters[i].base = "ư"
        letters[i + 1].base = "ơ"
        return render(letters, tone)
      }
      let horn: [Character: Character] = ["a": "ă", "o": "ơ", "u": "ư"]
      if let i = letters.lastIndex(where: { horn[$0.base] != nil || horn.values.contains($0.base) }) {
        if let h = horn[letters[i].base] {
          letters[i].base = h
          return render(letters, tone)
        }
        // A w that started the word as ư, pressed again: just w (ww → w)
        if i == 0 && letters.count == 1 && letters[0].base == "ư" { return String(key) }
        let back: [Character: Character] = ["ă": "a", "ơ": "o", "ư": "u"]
        letters[i].base = back[letters[i].base] ?? letters[i].base
        return render(letters, tone) + String(key)
      }
      // w on its own is ư
      letters.append(Letter(base: "ư", upper: upper))
      return render(letters, tone)
    }
    if k == "d", let first = letters.first {
      if first.base == "d" {
        letters[0].base = "đ"
        return render(letters, tone)
      }
      if first.base == "đ" {
        letters[0].base = "d"
        return render(letters, tone) + String(key)
      }
    }
    letters.append(Letter(base: k, upper: upper))
    return render(letters, tone)
  }
}
