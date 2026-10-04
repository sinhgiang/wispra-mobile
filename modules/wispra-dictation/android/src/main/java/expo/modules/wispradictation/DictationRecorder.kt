package expo.modules.wispradictation

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import java.io.File

/** Speech recording in the same format as the app's own recordings: mono AAC, 16 kHz, 32 kbps. */
class DictationRecorder(private val context: Context) {
  private var recorder: MediaRecorder? = null
  private var file: File? = null
  private var startedAt = 0L

  val isRecording: Boolean get() = recorder != null

  fun elapsedMs(): Long = if (recorder == null) 0 else SystemClock.elapsedRealtime() - startedAt

  fun start(output: File) {
    output.parentFile?.mkdirs()
    val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
    try {
      r.setAudioSource(MediaRecorder.AudioSource.MIC)
      r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
      r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
      r.setAudioChannels(1)
      r.setAudioSamplingRate(16000)
      r.setAudioEncodingBitRate(32000)
      r.setOutputFile(output.absolutePath)
      r.prepare()
      r.start()
    } catch (e: Exception) {
      r.release()
      output.delete()
      throw e
    }
    recorder = r
    file = output
    startedAt = SystemClock.elapsedRealtime()
  }

  /** Stops and keeps the file. Returns its length in milliseconds. */
  fun stop(): Long {
    val r = recorder ?: return 0
    val length = elapsedMs()
    recorder = null
    try {
      r.stop()
    } catch (_: RuntimeException) {
      // Stopped right after starting: the file has no audio, but it is kept like any other
    } finally {
      r.release()
    }
    return length
  }

  /** Stops and deletes the file. */
  fun cancel() {
    stop()
    file?.delete()
    file = null
  }
}
