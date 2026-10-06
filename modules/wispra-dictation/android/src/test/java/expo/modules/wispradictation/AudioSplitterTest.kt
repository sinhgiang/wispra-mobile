package expo.modules.wispradictation

import org.junit.Assert.assertEquals
import org.junit.Test

class AudioSplitterTest {
  @Test
  fun framesGoToThePieceTheyStartIn() {
    val piece = 30_000_000L
    assertEquals(0, AudioSplitter.pieceIndex(0, piece))
    assertEquals(0, AudioSplitter.pieceIndex(29_999_999, piece))
    assertEquals(1, AudioSplitter.pieceIndex(30_000_000, piece))
    assertEquals(2, AudioSplitter.pieceIndex(67_030_000, piece))
  }

  @Test
  fun aNegativeFirstFrameTimeStaysInTheFirstPiece() {
    assertEquals(0, AudioSplitter.pieceIndex(-23_000, 30_000_000))
  }
}
