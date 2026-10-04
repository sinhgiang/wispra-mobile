package expo.modules.wispradictation

import java.io.File

/**
 * Turns a dictation into text. Runs on a background thread. Returns null when the words cannot be
 * transcribed now; the audio then waits in History with Try again.
 *
 * Transcription goes through Wispra Cloud, which needs the account sign-in (part 2 of the mobile
 * work). Until then no transcriber is set and every dictation waits.
 */
fun interface Transcriber {
  fun transcribe(audio: File): String?
}

object Transcribers {
  @Volatile
  var current: Transcriber? = null
}
