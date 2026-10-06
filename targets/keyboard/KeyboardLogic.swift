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

/// One piece of what was said in a listening session, transcribed by the Wispra app and left in the
/// shared keychain (SharedChannel, "chunks") as a JSON list of { u: utterance id, i: index in it,
/// text, at: ms since 1970, last: true for its final piece, failed: true when it could not be
/// transcribed (as opposed to nothing said) }.
struct DictationChunk: Equatable {
  let utterance: String
  let index: Int
  let text: String
  let at: Double
  let last: Bool
  var failed = false

  var key: String { "\(utterance)#\(index)" }
}

enum ChunkQueue {
  static func parse(_ json: String?) -> [DictationChunk] {
    guard let data = json?.data(using: .utf8),
          let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
    return list.compactMap { item in
      guard let u = item["u"] as? String, let i = item["i"] as? Int, let text = item["text"] as? String,
            let at = item["at"] as? Double else { return nil }
      return DictationChunk(utterance: u, index: i, text: text, at: at, last: item["last"] as? Bool ?? false, failed: item["failed"] as? Bool ?? false)
    }
  }

  /// The pieces to type now, in order. Within one utterance, pieces go in index order; a piece that
  /// never came (transcription failed) is skipped once a later one has waited `gapWaitMs`. Pieces
  /// older than `maxAgeMs` are left alone.
  static func toType(_ chunks: [DictationChunk], typed: Set<String>, nowMs: Double, maxAgeMs: Double = 15 * 60 * 1000, gapWaitMs: Double = 6000) -> [DictationChunk] {
    var out: [DictationChunk] = []
    let fresh = chunks.filter { nowMs - $0.at < maxAgeMs }
    let utterances = Dictionary(grouping: fresh, by: { $0.utterance })
    // Utterances in the order they started
    let order = utterances.keys.sorted { (utterances[$0]?.map { $0.at }.min() ?? 0) < (utterances[$1]?.map { $0.at }.min() ?? 0) }
    for u in order {
      let pieces = (utterances[u] ?? []).sorted { $0.index < $1.index }
      let typedIndices = pieces.filter { typed.contains($0.key) }.map { $0.index }
      var next = (typedIndices.max() ?? -1) + 1
      for p in pieces where !typed.contains(p.key) && p.index >= next {
        if p.index == next || nowMs - p.at >= gapWaitMs {
          out.append(p)
          next = p.index + 1
        } else {
          break
        }
      }
    }
    return out
  }
}

/// While the mic is red, what the app's status says about its microphone (T-0178 review): the app writes
/// whether its engine runs. A microphone that stays stopped (another app has the audio) is no red mic that
/// records nothing: the keyboard says so once it has been down for two checks (about four seconds, so a short
/// blip is not reported).
enum MicCheck {
  enum Result: Equatable {
    case fine
    /// The app is not running
    case appStopped
    /// The app runs but cannot get the microphone
    case micBusy
  }

  static let downChecksLimit = 2

  /// The number of checks in a row that found the engine stopped; any other answer starts again
  static func nextDownChecks(engine: Bool?, current: Int) -> Int {
    engine == false ? current + 1 : 0
  }

  static func result(beatAgeMs: Double?, engine: Bool?, downChecks: Int) -> Result {
    if WordsWait.appStopped(beatAgeMs: beatAgeMs) { return .appStopped }
    if engine == false && downChecks >= downChecksLimit { return .micBusy }
    return .fine
  }
}

/// Never waiting for ever (T-0178). Words come back from the Wispra app, which iOS may stop while another app
/// (Messenger, Zalo) is in front: the app's beat then stops, and the keyboard said "Đang viết…" for ever,
/// even after the screen was locked and unlocked. These rules say, from how long it has waited and how long
/// ago the app last gave a sign of life, what to tell the user.
enum WordsWait {
  enum Outcome: Equatable {
    case waiting
    /// The app stopped giving signs of life: iOS stopped Wispra, so the words will not come
    case appStopped
    /// The app is alive but nothing came in time
    case timedOut
  }

  /// How long to wait for words after the red mic was tapped
  static let limitMs = 45_000.0
  /// The app writes its beat every 5 s; this long without one, it is not running
  static let deadBeatMs = 25_000.0
  /// With no session status at all, this long before it is called stopped
  static let noStatusGraceMs = 3_000.0

  static func appStopped(beatAgeMs: Double?) -> Bool {
    guard let age = beatAgeMs else { return true }
    return age > deadBeatMs
  }

  static func outcome(waitedMs: Double, beatAgeMs: Double?) -> Outcome {
    if waitedMs >= limitMs { return .timedOut }
    if appStopped(beatAgeMs: beatAgeMs) && waitedMs >= noStatusGraceMs { return .appStopped }
    return .waiting
  }
}

/// The listening session the Wispra app runs, as it reports it in the shared keychain
/// (SharedChannel, "session"): { until, beat } in ms since 1970
enum SessionStatus {
  /// On, and the app wrote recently (it writes every few seconds while the session runs)
  static func isLive(untilMs: Double, beatMs: Double, nowMs: Double) -> Bool {
    untilMs > nowMs && nowMs - beatMs < 20_000
  }

  static func minutesLeft(untilMs: Double, nowMs: Double) -> Int {
    max(0, Int(((untilMs - nowMs) / 60_000).rounded(.up)))
  }
}
