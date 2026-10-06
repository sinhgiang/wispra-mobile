package expo.modules.wispradictation

import android.content.Context
import android.content.pm.ApplicationInfo
import java.io.File

/**
 * Turns a dictation into text. Runs on a background thread. Returns null when the words cannot be
 * transcribed now; the audio then waits in History with Try again.
 */
fun interface Transcriber {
  fun transcribe(audio: File, durationMs: Long): String?
}

object Transcribers {
  /**
   * Wispra Cloud, with the sign-in made in the app. Debug builds first look for words in
   * files/wispra/test-transcript.txt, so a test can check the typing without speaking to the
   * cloud; release builds never read that file. Used by the mic button and the keyboard.
   */
  fun create(context: Context): Transcriber {
    val cloud = CloudTranscriber(context)
    val debuggable = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    if (!debuggable) return cloud
    val testFile = File(context.filesDir, "wispra/test-transcript.txt")
    return Transcriber { audio, durationMs ->
      if (testFile.exists()) testFile.readText().trim().ifEmpty { null } else cloud.transcribe(audio, durationMs)
    }
  }
}
