import Foundation

// Tests of the Wispra keyboard's logic: Telex typing (targets/keyboard/Telex.swift), the keys, typing
// rules, dictated pieces and the session status (targets/keyboard/KeyboardLogic.swift), and how the
// app cuts a listening session into pieces (modules/wispra-keyboard-bridge/ios/Segmenter.swift).
// Run on GitHub's macOS machines by .github/workflows/ios.yml with swiftc.

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


  static func segmenter() {
    var s = Segmenter()
    // Talk for a second, then a pause: the piece ends after 0.7 s of silence
    var cut = false
    for _ in 0..<8 { cut = s.feed(level: 0.1, duration: 0.125) }
    check("no cut while talking", !cut)
    var cutAt = 0
    for n in 1...10 where !cut {
      cut = s.feed(level: 0.001, duration: 0.125)
      if cut { cutAt = n }
    }
    check("cut after a 0.75 s pause", cut && cutAt == 6, "at \(cutAt)")
    s.reset()
    // Silence only: never cut early, and nothing heard
    for _ in 0..<20 { cut = s.feed(level: 0.001, duration: 0.1) }
    check("silence alone is no piece", !cut && !s.heardVoice)
    s.reset()
    // Talking without a pause: cut at 12 s
    var steps = 0
    repeat { steps += 1 } while !s.feed(level: 0.2, duration: 0.5)
    check("long talk cut at 12 s", steps == 24, "after \(steps)")
    // Level of samples
    let samples: [Float] = [0.5, -0.5, 0.5, -0.5]
    let level = samples.withUnsafeBufferPointer { Segmenter.level($0.baseAddress!, count: 4) }
    check("loudness", abs(level - 0.5) < 0.0001)
  }

  static func chunks() {
    func c(_ u: String, _ i: Int, _ at: Double, _ text: String = "x", last: Bool = false) -> DictationChunk {
      DictationChunk(utterance: u, index: i, text: text, at: at, last: last)
    }
    let now = 1_000_000.0
    // In order, as they come
    check("first piece", ChunkQueue.toType([c("a", 0, now)], typed: [], nowMs: now).map { $0.key } == ["a#0"])
    check("the next after typed ones", ChunkQueue.toType([c("a", 0, now), c("a", 1, now)], typed: ["a#0"], nowMs: now).map { $0.key } == ["a#1"])
    // Piece 1 came before piece 0: wait for 0
    check("waits for a missing piece", ChunkQueue.toType([c("a", 1, now - 1000)], typed: [], nowMs: now).isEmpty)
    // …unless piece 0 never comes
    check("skips a piece that never came", ChunkQueue.toType([c("a", 1, now - 7000)], typed: [], nowMs: now).map { $0.key } == ["a#1"])
    // Several utterances in the order they started; stale ones left alone
    let list = [c("b", 0, now - 100), c("a", 0, now - 200), c("a", 1, now - 150), c("old", 0, now - 16 * 60 * 1000)]
    check("utterances in order", ChunkQueue.toType(list, typed: [], nowMs: now).map { $0.key } == ["a#0", "a#1", "b#0"])
    // JSON from the app
    let json = "[{\"u\":\"a\",\"i\":0,\"text\":\"Xin chào\",\"at\":5,\"last\":true}]"
    check("reads the app's list", ChunkQueue.parse(json) == [c("a", 0, 5, "Xin chào", last: true)])
    check("ignores a broken list", ChunkQueue.parse("nope").isEmpty && ChunkQueue.parse(nil).isEmpty)
  }

  static func session() {
    let now = 1_000_000.0
    check("live while on and beating", SessionStatus.isLive(untilMs: now + 60_000, beatMs: now - 5000, nowMs: now))
    check("not live once over", !SessionStatus.isLive(untilMs: now - 1, beatMs: now, nowMs: now))
    check("not live when the app stopped writing", !SessionStatus.isLive(untilMs: now + 60_000, beatMs: now - 30_000, nowMs: now))
    check("minutes left", SessionStatus.minutesLeft(untilMs: now + 14 * 60_000 + 1, nowMs: now) == 15)
  }

  static func recovery() {
    check("restarts when an interruption ends", SessionRecovery.shouldRestart(interruptionTypeRaw: SessionRecovery.interruptionEnded))
    check("waits while the interruption goes on", !SessionRecovery.shouldRestart(interruptionTypeRaw: SessionRecovery.interruptionBegan))
    check("retries after 2, 4, 8, 16, 30 and 30 seconds", (0..<6).compactMap { SessionRecovery.retryDelay(attempt: $0) } == [2, 4, 8, 16, 30, 30])
    check("another app having the audio is tried every 3 s, not counted", SessionRecovery.interruptedRetrySeconds == 3)
    check("gives up after six tries", SessionRecovery.retryDelay(attempt: 6) == nil && SessionRecovery.retryDelay(attempt: -1) == nil)
  }

  static func wordsWait() {
    check("waits while the app beats", WordsWait.outcome(waitedMs: 10_000, beatAgeMs: 4_000) == .waiting)
    check("the app stopped: its beat is old", WordsWait.outcome(waitedMs: 10_000, beatAgeMs: 40_000) == .appStopped)
    check("the app stopped: no session status at all", WordsWait.outcome(waitedMs: 10_000, beatAgeMs: nil) == .appStopped)
    check("a moment of grace before saying it stopped", WordsWait.outcome(waitedMs: 1_000, beatAgeMs: nil) == .waiting)
    check("alive but nothing came in 45 s", WordsWait.outcome(waitedMs: 46_000, beatAgeMs: 3_000) == .timedOut)
    check("never waiting for ever, whatever the beat", WordsWait.outcome(waitedMs: 120_000, beatAgeMs: nil) == .timedOut && WordsWait.outcome(waitedMs: 120_000, beatAgeMs: 2_000) == .timedOut)
    check("the red mic: the app is gone when it stops beating", WordsWait.appStopped(beatAgeMs: 30_000) && !WordsWait.appStopped(beatAgeMs: 5_000))
  }

  static func micCheck() {
    // Red mic, the app beats: the microphone down for one check is a blip, for two it is reported
    check("a blip of one check is not reported", MicCheck.result(beatAgeMs: 3_000, engine: false, downChecks: 1) == .fine)
    check("two checks with the engine stopped: the microphone is busy", MicCheck.result(beatAgeMs: 3_000, engine: false, downChecks: 2) == .micBusy)
    check("engine running: fine, whatever the count", MicCheck.result(beatAgeMs: 3_000, engine: true, downChecks: 5) == .fine)
    check("an app of an earlier build writes no engine: fine", MicCheck.result(beatAgeMs: 3_000, engine: nil, downChecks: 0) == .fine)
    check("no beat at all wins over the engine: the app stopped", MicCheck.result(beatAgeMs: 40_000, engine: false, downChecks: 3) == .appStopped)
    check("the count goes on while the engine is down and starts again when it runs", MicCheck.nextDownChecks(engine: false, current: 1) == 2 && MicCheck.nextDownChecks(engine: true, current: 3) == 0 && MicCheck.nextDownChecks(engine: nil, current: 3) == 0)
  }

  static func sharedLog() {
    let old = (0..<SharedLog.maxLines).map { "l\($0)" }
    let next = SharedLog.appended(to: old, "new")
    check("the log keeps the newest lines", next.count == SharedLog.maxLines && next.last == "new" && next.first == "l1")
    check("the log reads back what it wrote", SharedLog.parse(SharedLog.serialize(["a", "b: c"])) == ["a", "b: c"])
    check("a broken log is empty", SharedLog.parse("nope").isEmpty && SharedLog.parse(nil).isEmpty)
    check("a line says when, who and what", SharedLog.line("app", "interrupted", at: Date(timeIntervalSince1970: 0)).hasSuffix(" app: interrupted"))
  }

  static func main() {
    telex()
    layout()
    rules()
    segmenter()
    chunks()
    session()
    recovery()
    wordsWait()
    micCheck()
    sharedLog()
    print("\(passed)/\(passed + failed) passed")
    if failed > 0 { exit(1) }
  }
}
