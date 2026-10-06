package expo.modules.wispradictation

import java.text.Normalizer

/**
 * Cleans what Whisper returns, the same way as src/lib/transcript-filter.ts in the app and Wispra on
 * the computer (spetotext/src/main/transcribe.ts), so the mic button and the Android keyboard never
 * type words nobody said (T-0164 review 2: this was still the first version of the filter).
 *
 * - Looping segments (compression_ratio over 2.4) are collapsed, never dropped whole.
 * - The filters run segment by segment, with one shared count of repeated sentences, not on the
 *   joined text: Whisper often writes Vietnamese without a full stop, and one outro joined to 30 s
 *   of real speech would be one sentence and take it all.
 * - Bare consonants ("ki ch g l n ch c kh th") are cut out; a run of at least 4 is cut.
 * - A segment covers its time only when most of its words survived; speech that was lost, and not
 *   silence Whisper filled with an outro, is sent again once (see CloudTranscriber).
 *
 * The same test cases are in TranscriptFilterTest and src/lib/__tests__/transcript-filter.test.ts.
 */
object TranscriptFilter {
  data class Segment(
    val text: String,
    val noSpeechProb: Double,
    val avgLogprob: Double? = null,
    val compressionRatio: Double? = null,
    // Seconds into the audio sent
    val start: Double? = null,
    val end: Double? = null,
  )

  /** What one answer of Whisper gave, and what the filters did to it */
  data class Answer(
    val text: String,
    // Words Whisper wrote in the segments it kept, and the words left after the filters
    val words: Int,
    val wordsLeft: Int,
    // Seconds of the segments Whisper wrote for, and the part whose words did not survive
    val speechSeconds: Double,
    val uncoveredSeconds: Double,
    // Words cut out as bare consonants. Words dropped as an outro are silence Whisper filled and are
    // not counted here: only bare consonants can mean real speech was lost.
    val gibberishWords: Int,
  ) {
    val gibberish: Boolean get() = gibberishWords > 0
  }

  // A segment is dropped as silence only when Whisper thinks there is no speech (above this) AND was
  // unsure of its words. Low confidence alone never drops real speech (the computer lost stretches
  // of real dictations that way).
  private const val NO_SPEECH_THRESHOLD = 0.6
  private const val LOW_CONFIDENCE_LOGPROB = -1.0
  private const val COMPRESSION_RATIO_THRESHOLD = 2.4
  private const val LOOP_MAX_PHRASE_WORDS = 4
  private const val GIBBERISH_BRIDGE_GAP = 2
  private const val GIBBERISH_MIN_RUN = 4

  /** At least this much speech lost makes a piece worth sending again */
  const val RESEND_MIN_UNCOVERED_SECONDS = 3.0

  private val HALLUCINATION_PHRASES = listOf(
    "like and subscribe", "like, share and subscribe", "like, comment and subscribe",
    "please like and subscribe", "please subscribe", "don't forget to subscribe",
    "subscribe to my channel", "thank you for watching", "thanks for watching",
    "see you in the next video", "see you next time",
    "cảm ơn các bạn đã theo dõi", "cảm ơn các bạn đã xem", "cảm ơn mọi người đã xem",
    "cảm ơn quý vị đã theo dõi", "cảm ơn bạn đã theo dõi", "hẹn gặp lại các bạn",
    "hẹn gặp lại trong video", "hẹn gặp lại ở video", "hãy subscribe", "nhớ subscribe",
    "nhớ like", "đăng ký kênh", "like và subscribe", "đừng quên đăng ký",
    "không bỏ lỡ những video", "không bỏ lỡ video", "video hấp dẫn", "ghiền mì gõ",
  ).map { Normalizer.normalize(it, Normalizer.Form.NFC) }

  private val HALLUCINATION_SENTENCES = setOf(Normalizer.normalize("kết thúc video", Normalizer.Form.NFC))

  // Digits and number words repeat for real (a phone number "0 9 0 0 0 5", "không không không", an
  // amount read twice): never collapsed, since losing one digit loses the number
  private val NUMBER_WORDS = setOf(
    "không", "một", "mốt", "hai", "ba", "bốn", "tư", "năm", "lăm", "sáu", "bảy", "bẩy", "tám", "chín", "mười", "mươi",
    "linh", "lẻ", "trăm", "nghìn", "ngàn", "triệu", "tỷ", "tỉ", "chấm", "phẩy",
    "zero", "oh", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "hundred", "thousand",
    "million", "billion", "double", "triple", "point",
  )

  private val SENTENCE_BREAK = Regex("(?<=[.!?…])\\s+|\\n+")
  private val END_PUNCTUATION = Regex("[.,!?。，！？]+")
  private val WHITESPACE = Regex("\\s+")
  private val NOT_LETTER_OR_DIGIT = Regex("[^\\p{L}\\p{N}]")
  private val NOT_LETTER_OR_DIGIT_RUN = Regex("[^\\p{L}\\p{N}]+")
  private val EDGE_NOT_LETTER_OR_DIGIT = Regex("^[^\\p{L}\\p{N}]+|[^\\p{L}\\p{N}]+$")
  private val ANY_DIGIT = Regex("\\p{N}")
  private val ONLY_DIGITS = Regex("\\d+")
  private val ONLY_LETTERS = Regex("\\p{L}+")
  private val COMBINING_MARKS = Regex("[\\u0300-\\u036f]")
  private val ASCII_VOWEL = Regex("[aeiouyAEIOUY]")

  /** Silence Whisper filled with invented text. A looping segment is not dropped here. */
  fun isReliable(s: Segment): Boolean {
    if (s.noSpeechProb <= NO_SPEECH_THRESHOLD) return true
    val logprob = s.avgLogprob ?: return false
    return logprob >= LOW_CONFIDENCE_LOGPROB
  }

  private fun isNumberWord(word: String): Boolean = ANY_DIGIT.containsMatchIn(word) || word in NUMBER_WORDS

  /**
   * Whisper stuck in a loop ("vâng vâng vâng vâng…"): a word or phrase of up to 4 words repeated
   * three times or more in a row is kept twice. A list read out with different items, or a phrase
   * said twice, is left as it is.
   */
  fun collapseLoops(text: String): String {
    val words = text.split(WHITESPACE).filter { it.isNotEmpty() }
    fun key(w: String): String = Normalizer.normalize(w, Normalizer.Form.NFC).lowercase().replace(NOT_LETTER_OR_DIGIT, "")
    val out = ArrayList<String>()
    var i = 0
    while (i < words.size) {
      var collapsed = false
      var n = 1
      while (n <= LOOP_MAX_PHRASE_WORDS && !collapsed) {
        if (i + n > words.size) break
        val unit = words.subList(i, i + n).map { key(it) }
        if (unit.any { it.isEmpty() }) break
        if (unit.any { isNumberWord(it) }) break
        var repeats = 1
        while (i + (repeats + 1) * n <= words.size &&
          words.subList(i + repeats * n, i + (repeats + 1) * n).map { key(it) } == unit
        ) {
          repeats++
        }
        if (repeats >= 3) {
          out.addAll(words.subList(i, i + 2 * n))
          i += repeats * n
          collapsed = true
        }
        n++
      }
      if (!collapsed) {
        out.add(words[i])
        i++
      }
    }
    return text.takeWhile { it.isWhitespace() } + out.joinToString(" ")
  }

  private fun wordTokens(text: String): List<String> =
    Normalizer.normalize(text, Normalizer.Form.NFC).lowercase().split(NOT_LETTER_OR_DIGIT_RUN).filter { it.isNotEmpty() }

  private fun countWords(text: String): Int = wordTokens(text).size

  /**
   * A word with no vowel at all once its marks are stripped is a gibberish signal: every Vietnamese
   * syllable has a vowel; vowel-less English words are acronyms ("CEO"), which are kept.
   */
  fun looksLikeGibberishToken(token: String): Boolean {
    if (!ONLY_LETTERS.matches(token)) return false
    if (token.length >= 2 && token == token.uppercase()) return false
    val base = Normalizer.normalize(token, Normalizer.Form.NFD).replace(COMBINING_MARKS, "")
    return !ASCII_VOWEL.containsMatchIn(base)
  }

  private fun findGibberishZones(flags: List<Boolean>): BooleanArray {
    val inZone = BooleanArray(flags.size)
    var i = 0
    while (i < flags.size) {
      if (!flags[i]) {
        i++
        continue
      }
      var end = i
      var count = 1
      var j = i + 1
      while (j < flags.size) {
        if (flags[j]) {
          end = j
          count++
          j++
          continue
        }
        var k = j
        while (k < flags.size && !flags[k] && k - end <= GIBBERISH_BRIDGE_GAP) k++
        if (k < flags.size && flags[k]) {
          end = k
          count++
          j = k + 1
        } else {
          break
        }
      }
      if (count >= GIBBERISH_MIN_RUN) for (q in i..end) inZone[q] = true
      i = end + 1
    }
    return inZone
  }

  /** The sentence without its garbled runs, or "" when too little real content is left */
  fun stripGibberish(sentence: String): String {
    val raws = Normalizer.normalize(sentence, Normalizer.Form.NFC).split(WHITESPACE).filter { it.isNotEmpty() }
    val flags = raws.map { raw ->
      val stripped = raw.replace(EDGE_NOT_LETTER_OR_DIGIT, "")
      stripped.isNotEmpty() && !ONLY_DIGITS.matches(stripped) && looksLikeGibberishToken(stripped)
    }
    val zones = findGibberishZones(flags)
    if (zones.none { it }) return sentence
    val cleaned = raws.filterIndexed { index, _ -> !zones[index] }.joinToString(" ").trim()
    return if (countWords(cleaned) >= 2) cleaned else ""
  }

  private fun splitSentences(text: String): List<String> =
    text.split(SENTENCE_BREAK).map { it.trim() }.filter { it.isNotEmpty() }

  private fun gibberishWordsIn(text: String): Int =
    splitSentences(text).sumOf { maxOf(0, countWords(it) - countWords(stripGibberish(it))) }

  /** `seen` is shared by the segments of one answer, so a sentence repeated 3+ times is caught across them */
  fun filterKnownHallucinations(text: String, seen: MutableMap<String, Int> = HashMap()): String {
    val kept = ArrayList<String>()
    for (raw in splitSentences(text)) {
      val sentence = stripGibberish(raw)
      if (sentence.isEmpty()) continue
      val normalized = Normalizer.normalize(sentence, Normalizer.Form.NFC).lowercase().replace(END_PUNCTUATION, "").trim()
      if (normalized.isEmpty()) continue
      if (normalized in HALLUCINATION_SENTENCES) continue
      if (HALLUCINATION_PHRASES.any { normalized.contains(it) }) continue
      val count = (seen[normalized] ?: 0) + 1
      seen[normalized] = count
      if (count > 2) continue
      kept.add(sentence)
    }
    return kept.joinToString(" ").trim()
  }

  /** One answer of Whisper, read segment by segment as the computer reads it */
  fun readAnswer(text: String?, segments: List<Segment>?): Answer {
    if (segments.isNullOrEmpty()) {
      val original = (text ?: "").trim()
      val cleaned = filterKnownHallucinations(original)
      return Answer(cleaned, countWords(original), countWords(cleaned), 0.0, 0.0, gibberishWordsIn(original))
    }
    val seen = HashMap<String, Int>()
    var cut = 0
    var total = 0
    var left = 0
    var speech = 0.0
    var uncovered = 0.0
    val pieces = segments.filter(::isReliable).map { s ->
      val raw = if (s.compressionRatio != null && s.compressionRatio > COMPRESSION_RATIO_THRESHOLD) collapseLoops(s.text) else s.text
      val original = raw.trim()
      cut += gibberishWordsIn(original)
      val kept = filterKnownHallucinations(original, seen)
      // Whisper's own spacing between segments is kept
      val space = if (kept.isNotEmpty() && raw.firstOrNull()?.isWhitespace() == true) " " else ""
      val had = countWords(original)
      val remaining = countWords(kept)
      val seconds = if (s.start != null && s.end != null) maxOf(0.0, s.end - s.start) else 0.0
      total += had
      left += remaining
      speech += seconds
      if (!(remaining > 0 && remaining * 2 >= had)) uncovered += seconds
      space + kept
    }
    return Answer(pieces.joinToString("").trim(), total, left, speech, uncovered, cut)
  }

  fun clean(text: String?, segments: List<Segment>?): String = readAnswer(text, segments).text

  /**
   * Real speech was lost to the bare-consonant filter: at least 3 s of segments whose words did not
   * survive, and half of what Whisper wrote. Silence Whisper filled with an outro never counts (no
   * bare consonants in it).
   */
  fun needsResend(answer: Answer?): Boolean {
    if (answer == null || !answer.gibberish) return false
    if (answer.speechSeconds <= 0) return answer.words >= 4 && answer.wordsLeft * 2 < answer.words
    return answer.uncoveredSeconds >= RESEND_MIN_UNCOVERED_SECONDS && answer.uncoveredSeconds * 2 >= answer.speechSeconds
  }

  /**
   * What the keyboard and the mic button do with the first answer, given the language they sent
   * (T-0145 review): with a language already told to Whisper there is nothing more to ask, so the
   * first answer stands; with none ("auto"), see resolve.
   */
  fun resolveFor(language: String?, first: Answer, resend: () -> Answer?): Answer =
    if (language != null) first else resolve(first, resend)

  /** The answer to use: the first, or the resend's when the first lost speech and the resend kept more words */
  fun resolve(first: Answer, resend: () -> Answer?): Answer {
    if (!needsResend(first)) return first
    val second = resend() ?: return first
    return if (second.wordsLeft > first.wordsLeft) second else first
  }
}
