import Foundation

// Tests of the Wispra keyboard's logic: Telex typing (targets/keyboard/Telex.swift) and the keys and
// typing rules (targets/keyboard/KeyboardLogic.swift). Run on GitHub's macOS machines by
// .github/workflows/ios.yml:
//   swiftc -parse-as-library targets/keyboard/Telex.swift targets/keyboard/KeyboardLogic.swift \
//     targets-tests/keyboard/KeyboardTests.swift -o keyboard-tests && ./keyboard-tests

@main
struct KeyboardTests {
  static var failed = 0
  static var passed = 0

  static func check(_ name: String, _ ok: Bool, _ detail: String = "") {
    if ok {
      passed += 1
    } else {
      failed += 1
      print("FAIL \(name) \(detail)")
    }
  }

  // Types the keys one by one, as the keyboard does
  static func type(_ keys: String) -> String {
    var word = ""
    for key in keys { word = Telex.apply(word, key: key) }
    return word
  }

  static func telex() {
    let cases: [(String, String)] = [
      // Tones
      ("as", "á"), ("af", "à"), ("ar", "ả"), ("ax", "ã"), ("aj", "ạ"), ("asz", "a"),
      // Letters
      ("aa", "â"), ("aw", "ă"), ("ee", "ê"), ("oo", "ô"), ("ow", "ơ"), ("uw", "ư"), ("dd", "đ"), ("w", "ư"),
      // The same key again undoes it
      ("ass", "as"), ("aaa", "aa"), ("ddd", "dd"), ("ww", "w"), ("oww", "ow"),
      // Words
      ("vieetj", "việt"), ("Vieetj", "Việt"), ("tieengs", "tiếng"), ("nguwowif", "người"), ("nguoiwf", "người"),
      ("dduwowcj", "được"), ("truwowngf", "trường"), ("chuyeenj", "chuyện"), ("cuar", "của"), ("muaf", "mùa"),
      ("hoaf", "hòa"), ("hoafn", "hoàn"), ("thuyr", "thủy"), ("khoer", "khỏe"), ("toans", "toán"),
      ("quas", "quá"), ("gif", "gì"), ("giaf", "già"), ("ngoaif", "ngoài"), ("muoois", "muối"),
      ("hocj", "học"), ("ddi", "đi"), ("did", "đi"), ("Ddaay", "Đây"), ("chieeuf", "chiều"), ("hopj", "họp"),
      ("cuwus", "cứu"), ("tooi", "tôi"), ("xin", "xin"), ("chaof", "chào"),
      // The tone moves when the word grows
      ("tieesng", "tiếng"), ("tiesng", "tiéng"),
    ]
    for (keys, expected) in cases {
      let got = type(keys)
      check("telex \(keys)", got == expected, "→ \(got), expected \(expected)")
    }
  }

  static func layout() {
    let letters = KeyboardLogic.rows(page: .letters, upper: false, showGlobe: false)
    check("letters: four rows", letters.count == 4)
    check("letters: q to p on top", letters[0].count == 10 && letters[0].first == .char("q") && letters[0].last == .char("p"))
    check("letters: shift and delete around z to m", letters[2].first == .shift && letters[2].last == .delete && letters[2].count == 9)
    check("letters: 123, VN/EN, space, return", letters[3] == [.page(.numbers), .language, .space, .enter])
    check("letters: capitals with shift", KeyboardLogic.rows(page: .letters, upper: true, showGlobe: false)[0].first == .char("Q"))
    check("globe only when iOS asks for it", KeyboardLogic.rows(page: .letters, upper: false, showGlobe: true)[3].contains(.globe))
    let numbers = KeyboardLogic.rows(page: .numbers, upper: false, showGlobe: false)
    check("numbers: 1 to 0", numbers[0].first == .char("1") && numbers[0].last == .char("0"))
    check("numbers: #+= then back to ABC", numbers[2].first == .page(.symbols) && numbers[3].first == .page(.letters))
  }

  static func rules() {
    check("capital at the start", KeyboardLogic.startsSentence(before: nil) && KeyboardLogic.startsSentence(before: ""))
    check("capital after a full stop and a space", KeyboardLogic.startsSentence(before: "Xin chào. "))
    check("capital after a new line", KeyboardLogic.startsSentence(before: "Chào\n"))
    check("no capital inside a sentence", !KeyboardLogic.startsSentence(before: "Xin chào ") && !KeyboardLogic.startsSentence(before: "Xin"))
    check("double space after a word makes a period", KeyboardLogic.doubleSpaceMakesPeriod(before: "chào "))
    check("not after punctuation or a second space", !KeyboardLogic.doubleSpaceMakesPeriod(before: "chào. ") && !KeyboardLogic.doubleSpaceMakesPeriod(before: "chào  "))
    check("the word being typed", KeyboardLogic.trailingWord("Hôm nay chúng") == "chúng")
    check("no word after a space", KeyboardLogic.trailingWord("Hôm nay ") == "")
    check("the word after punctuation", KeyboardLogic.trailingWord("(việt") == "việt")
  }

  static func main() {
    telex()
    layout()
    rules()
    print("\(passed)/\(passed + failed) passed")
    if failed > 0 { exit(1) }
  }
}
