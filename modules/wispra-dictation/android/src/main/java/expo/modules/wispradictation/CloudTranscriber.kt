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
 * (signed out, offline, limit reached); the dictation then waits in History.
 */
class CloudTranscriber(private val context: Context) : Transcriber {
  override fun transcribe(audio: File, durationMs: Long): String? {
    if (!audio.exists() || audio.length() == 0L || audio.length() > MAX_BYTES) return null
    val apiBase = CloudSession.apiBase(context) ?: return null
    val token = CloudSession.validToken(context) ?: return null

    val boundary = "wispra-" + UUID.randomUUID().toString()
    fun field(name: String, value: String) =
      "--$boundary\r\nContent-Disposition: form-data; name=\"$name\"\r\n\r\n$value\r\n".toByteArray()
    val head = field("model", MODEL) + field("response_format", "verbose_json") +
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
      // The server counts this toward the monthly minutes
      if (durationMs > 0) setRequestProperty("X-Audio-Duration-Seconds", ((durationMs + 999) / 1000).toString())
    }
    return try {
      connection.outputStream.buffered().use { out ->
        out.write(head)
        audio.inputStream().use { it.copyTo(out) }
        out.write(tail)
      }
      if (connection.responseCode != 200) return null
      val data = JSONObject(connection.inputStream.bufferedReader().readText())
      val segments = data.optJSONArray("segments")?.let { list ->
        (0 until list.length()).map { i ->
          val s = list.getJSONObject(i)
          TranscriptFilter.Segment(
            text = s.optString("text"),
            noSpeechProb = s.optDouble("no_speech_prob", 0.0),
            avgLogprob = if (s.has("avg_logprob")) s.optDouble("avg_logprob") else null,
          )
        }
      }
      TranscriptFilter.clean(data.optString("text"), segments).ifEmpty { null }
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
