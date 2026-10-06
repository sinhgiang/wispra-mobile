package expo.modules.wispradictation

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaMuxer
import java.io.File
import java.nio.ByteBuffer

/**
 * Cuts an AAC .m4a recording into pieces of a given length without re-encoding: the compressed
 * frames are copied as they are, so nothing is lost or changed. Used when a meeting piece grew
 * long (Android pauses the app's timers while the screen is locked, so the next piece could not
 * start on time) or an older recording is too large to send to Wispra Cloud in one request.
 */
object AudioSplitter {
  data class Piece(val file: File, val startMs: Long, val durationMs: Long)

  /** Index of the piece a frame at [timeUs] belongs to. Pure, so it can be tested. */
  fun pieceIndex(timeUs: Long, pieceUs: Long): Int = (maxOf(0L, timeUs) / pieceUs).toInt()

  fun split(input: File, outDir: File, baseName: String, pieceMs: Long): List<Piece> {
    require(pieceMs > 0)
    val extractor = MediaExtractor()
    extractor.setDataSource(input.absolutePath)
    try {
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(android.media.MediaFormat.KEY_MIME)?.startsWith("audio/") == true
      } ?: throw IllegalArgumentException("No audio in ${input.name}")
      extractor.selectTrack(track)
      val format = extractor.getTrackFormat(track)
      val pieceUs = pieceMs * 1000
      val buffer = ByteBuffer.allocate(256 * 1024)
      val info = MediaCodec.BufferInfo()
      val pieces = ArrayList<Piece>()
      outDir.mkdirs()

      var muxer: MediaMuxer? = null
      var muxTrack = -1
      var current = -1
      var pieceStartUs = 0L
      var lastUs = 0L
      var file: File? = null

      fun close() {
        val m = muxer ?: return
        m.stop()
        m.release()
        muxer = null
        pieces.add(Piece(file!!, pieceStartUs / 1000, maxOf(0L, lastUs - pieceStartUs) / 1000))
      }

      while (true) {
        val size = extractor.readSampleData(buffer, 0)
        if (size < 0) break
        val timeUs = extractor.sampleTime
        val index = pieceIndex(timeUs, pieceUs)
        if (index != current) {
          close()
          current = index
          pieceStartUs = index * pieceUs
          file = File(outDir, "$baseName-${index + 1}.m4a")
          muxer = MediaMuxer(file!!.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4).also {
            muxTrack = it.addTrack(format)
            it.start()
          }
        }
        info.offset = 0
        info.size = size
        info.presentationTimeUs = timeUs - pieceStartUs
        info.flags = if ((extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC) != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
        muxer!!.writeSampleData(muxTrack, buffer, info)
        lastUs = timeUs + frameUs(format)
        extractor.advance()
      }
      close()
      return pieces
    } finally {
      extractor.release()
    }
  }

  // One AAC frame is 1024 samples
  private fun frameUs(format: android.media.MediaFormat): Long {
    val rate = if (format.containsKey(android.media.MediaFormat.KEY_SAMPLE_RATE)) format.getInteger(android.media.MediaFormat.KEY_SAMPLE_RATE) else 16000
    return 1024L * 1_000_000L / rate
  }
}
