package expo.modules.wispradictation

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/**
 * Transcribes a dictation with Wispra Cloud's /api/transcribe, the same request as the app
 * (src/lib/transcriber.ts) and Wispra on the computer. Returns null when it cannot right now
 * (signed out, offline, limit reached), and when nothing was said or the words could not be made
 * out; the dictation then waits in History with its audio, and the app transcribes it later.
 *
 * The language is the one chosen in Account (Vietnamese until chosen). Without one ("auto"), real
 * speech lost to the bare-consonant filter is sent again once, asking for Vietnamese, as in the app
 * (T-0164 review 2); the resend does not count the minutes a second time.
 */
class CloudTranscriber(private val context: Context) : Transcriber {
  override fun transcribe(audio: File, durationMs: Long): String? {
    if (!audio.exists() || audio.length() == 0L || audio.length() > MAX_BYTES) return null
    val apiBase = CloudSession.apiBase(context) ?: return null
    val token = CloudSession.validToken(context) ?: return null

    // The language chosen in Account ("auto": none is sent, Whisper guesses)
    val language = TranscribeLanguage.whisperCode(CloudSession.language(context))
    val first = send(audio, durationMs, apiBase, token, language = language, countMinutes = true) ?: return null
    // With a language already sent there is nothing more to ask; with none, a piece that lost real
    // speech is sent again asking for Vietnamese
    val chosen = TranscriptFilter.resolveFor(language, answerOf(first)) {
      send(audio, durationMs, apiBase, token, language = "vi", countMinutes = false)?.let { answerOf(it) }
    }
    return chosen.text.ifEmpty { null }
  }

  private fun answerOf(data: JSONObject): TranscriptFilter.Answer {
    val segments = data.optJSONArray("segments")?.let { list ->
      (0 until list.length()).map { i ->
        val s = list.getJSONObject(i)
        TranscriptFilter.Segment(
          text = s.optString("text"),
          noSpeechProb = s.optDouble("no_speech_prob", 0.0),
          avgLogprob = if (s.has("avg_logprob")) s.optDouble("avg_logprob") else null,
          compressionRatio = if (s.has("compression_ratio")) s.optDouble("compression_ratio") else null,
          start = if (s.has("start")) s.optDouble("start") else null,
          end = if (s.has("end")) s.optDouble("end") else null,
        )
      }
    }
    return TranscriptFilter.readAnswer(data.optString("text"), segments)
  }

  /** One upload; Whisper's answer, or null when it did not get there */
  private fun send(audio: File, durationMs: Long, apiBase: String, token: String, language: String?, countMinutes: Boolean): JSONObject? {
    val boundary = "wispra-" + UUID.randomUUID().toString()
    fun field(name: String, value: String) =
      "--$boundary\r\nContent-Disposition: form-data; name=\"$name\"\r\n\r\n$value\r\n".toByteArray()
    val head = field("model", MODEL) + field("response_format", "verbose_json") +
      (if (language != null) field("language", language) else ByteArray(0)) +
      ("--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.m4a\"\r\n" +
        "Content-Type: audio/mp4\r\n\r\n").toByteArray()
    val tail = "\r\n--$boundary--\r\n".toByteArray()

    val connection = (URL("$apiBase/api/transcribe").openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      connectTimeout = 15_000
      readTimeout = 120_000
      doOutput = true
      setFixedLengthStreamingMode(head.size + audio.length() + tail.size)
      setRequestProperty("Authorization", "Bearer $token")
      setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
      // The server counts this toward the monthly minutes; a resend is not counted again
      if (countMinutes && durationMs > 0) setRequestProperty("X-Audio-Duration-Seconds", ((durationMs + 999) / 1000).toString())
    }
    return try {
      connection.outputStream.buffered().use { out ->
        out.write(head)
        audio.inputStream().use { it.copyTo(out) }
        out.write(tail)
      }
      if (connection.responseCode != 200) return null
      JSONObject(connection.inputStream.bufferedReader().readText())
    } catch (_: Exception) {
      null
    } finally {
      connection.disconnect()
    }
  }

  companion object {
    private const val MODEL = "whisper-large-v3"
    // Wispra Cloud takes at most 4 MB in one request; a dictation is far below that
    private const val MAX_BYTES = 4L * 1024 * 1024
  }
}
