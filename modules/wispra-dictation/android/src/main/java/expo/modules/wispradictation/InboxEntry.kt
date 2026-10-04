package expo.modules.wispradictation

import java.io.File

/**
 * A dictation recorded over another app. The service cannot reach the app's JavaScript (it may not
 * be running), so it leaves the audio and this small JSON file in `files/wispra/inbox/`; the app
 * moves them into History the next time it is open.
 */
data class InboxEntry(
  val id: String,
  val createdAt: String,
  val durationMs: Long,
  val audioFileName: String,
  val sourceApp: String?,
  // The transcribed words; null while transcription waits
  val text: String?,
) {
  fun toJson(): String = buildString {
    append('{')
    append("\"version\":1,")
    append("\"id\":").append(quote(id)).append(',')
    append("\"kind\":\"dictation\",")
    append("\"createdAt\":").append(quote(createdAt)).append(',')
    append("\"durationMs\":").append(durationMs).append(',')
    append("\"audioFileName\":").append(quote(audioFileName)).append(',')
    append("\"sourceApp\":").append(sourceApp?.let(::quote) ?: "null").append(',')
    append("\"text\":").append(text?.let(::quote) ?: "null")
    append('}')
  }

  /** Written to a temporary name and renamed, so the app never reads half a file. */
  fun writeTo(inbox: File) {
    inbox.mkdirs()
    val tmp = File(inbox, "$id.json.tmp")
    tmp.writeText(toJson(), Charsets.UTF_8)
    if (!tmp.renameTo(File(inbox, "$id.json"))) {
      tmp.delete()
      throw IllegalStateException("Could not save the dictation")
    }
  }

  companion object {
    fun quote(value: String): String {
      val out = StringBuilder("\"")
      for (c in value) {
        when {
          c == '"' -> out.append("\\\"")
          c == '\\' -> out.append("\\\\")
          c == '\n' -> out.append("\\n")
          c == '\r' -> out.append("\\r")
          c == '\t' -> out.append("\\t")
          c < ' ' -> out.append(String.format("\\u%04x", c.code))
          else -> out.append(c)
        }
      }
      return out.append('"').toString()
    }
  }
}
