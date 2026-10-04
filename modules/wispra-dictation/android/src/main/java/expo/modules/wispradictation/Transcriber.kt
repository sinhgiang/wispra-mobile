package expo.modules.wispradictation

import java.io.File

/**
 * Turns a dictation into text. Runs on a background thread. Returns null when the words cannot be
 * transcribed now; the audio then waits in History with Try again.
 *
 * The service uses CloudTranscriber (Wispra Cloud, needs the sign-in made in the app).
 */
fun interface Transcriber {
  fun transcribe(audio: File, durationMs: Long): String?
}

object Transcribers {
  @Volatile
  var current: Transcriber? = null
}
