package expo.modules.wispradictation

import java.text.Normalizer

/**
 * Cleans what Whisper returns, exactly like src/lib/transcript-filter.ts in the app and Wispra on
 * the computer, so the mic button never types words nobody said.
 */
object TranscriptFilter {
  data class Segment(val text: String, val noSpeechProb: Double, val avgLogprob: Double?)

  private const val NO_SPEECH_THRESHOLD = 0.5
  private const val LOW_CONFIDENCE_LOGPROB = -1.0

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

  fun isReliable(s: Segment): Boolean =
    s.noSpeechProb < NO_SPEECH_THRESHOLD && (s.avgLogprob == null || s.avgLogprob >= LOW_CONFIDENCE_LOGPROB)

  private val SENTENCE_BREAK = Regex("(?<=[.!?…])\\s+|\\n+")
  private val END_PUNCTUATION = Regex("[.,!?。，！？]+")

  fun filterKnownHallucinations(text: String): String {
    val seen = HashMap<String, Int>()
    val kept = ArrayList<String>()
    for (raw in text.split(SENTENCE_BREAK)) {
      val sentence = raw.trim()
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

  fun clean(text: String?, segments: List<Segment>?): String {
    val joined = if (!segments.isNullOrEmpty()) {
      segments.filter(::isReliable).joinToString("") { it.text }.trim()
    } else {
      (text ?: "").trim()
    }
    return filterKnownHallucinations(joined)
  }
}
