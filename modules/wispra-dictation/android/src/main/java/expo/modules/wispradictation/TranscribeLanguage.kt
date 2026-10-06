package expo.modules.wispradictation

/**
 * The language Whisper is told the speech is in (T-0145, the owner's choice at W-0311), the same as
 * src/lib/transcribe-language.ts in the app: "vi" (the default), "auto" (Whisper guesses: nothing
 * is sent) or "en". The app writes the choice made in Account with setTranscribeLanguage; the
 * keyboard and the mic button read it here.
 */
object TranscribeLanguage {
  const val DEFAULT = "vi"

  /** The saved choice, read back: one of the three, or the default */
  private val CHOICES = setOf("vi", "auto", "en")

  fun parse(saved: String?): String {
    val value = saved?.trim() ?: return DEFAULT
    return if (value in CHOICES) value else DEFAULT
  }

  /** What is sent to Whisper: the language code, nothing for "auto" */
  fun whisperCode(saved: String?): String? = parse(saved).takeIf { it != "auto" }
}
