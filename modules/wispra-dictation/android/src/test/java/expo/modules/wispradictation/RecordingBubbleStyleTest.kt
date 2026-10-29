package expo.modules.wispradictation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RecordingBubbleStyleTest {
  @Test
  fun onlyRecordingIsRecording() {
    assertEquals(IndicatorMode.RECORDING, RecordingBubbleStyle.mode("recording"))
    assertEquals(IndicatorMode.WAITING, RecordingBubbleStyle.mode("paused"))
    assertEquals(IndicatorMode.WAITING, RecordingBubbleStyle.mode("interrupted"))
    assertEquals(IndicatorMode.WAITING, RecordingBubbleStyle.mode(""))
  }

  @Test
  fun recordingIsAMovingPurpleWaveAndWaitingAStillAmberOne() {
    val recording = RecordingBubbleStyle.look(IndicatorMode.RECORDING)
    assertTrue(recording.animated)
    assertEquals(RecordingBubbleStyle.PURPLE, recording.barColor)
    val waiting = RecordingBubbleStyle.look(IndicatorMode.WAITING)
    assertFalse(waiting.animated)
    assertEquals(RecordingBubbleStyle.AMBER, waiting.barColor)
    // TalkBack says what it is and what a tap does
    assertTrue(recording.description.contains("Tap to open Wispra"))
    assertTrue(waiting.description.contains("Tap to open Wispra"))
  }

  @Test
  fun isFaintSoItDoesNotHideWhatIsUnderIt() {
    assertTrue(RecordingBubbleStyle.ALPHA > 0.3f)
    // Faint: at most half solid (the owner, T-1073)
    assertTrue(RecordingBubbleStyle.ALPHA <= 0.5f)
    // Small, but a finger can still hit it
    assertTrue(RecordingBubbleStyle.SIZE_DP in 36..48)
  }

  @Test
  fun theMovingWaveStaysBetweenTheLowestAndHighestBar() {
    for (index in 0 until RecordingBubbleStyle.BARS) {
      for (step in 0..40) {
        val h = RecordingBubbleStyle.barHeight(index, step / 40f, true, 12, 44)
        assertTrue("bar $index at $step is $h", h in 12..44)
      }
    }
  }

  @Test
  fun theBarsMoveAsTheWaveTurns() {
    val heights = (0..10).map { RecordingBubbleStyle.barHeight(0, it / 10f, true, 12, 44) }.toSet()
    assertTrue(heights.size > 3)
    // At one moment the three bars are not all the same height
    val together = (0 until RecordingBubbleStyle.BARS).map { RecordingBubbleStyle.barHeight(it, 0.1f, true, 12, 44) }.toSet()
    assertTrue(together.size > 1)
  }

  @Test
  fun aStillWaveIsLowHighMedium() {
    val still = (0 until RecordingBubbleStyle.BARS).map { RecordingBubbleStyle.barHeight(it, 0.7f, false, 10, 30) }
    assertEquals(30, still[1])
    assertTrue(still[0] > 10)
    assertTrue(still[0] < still[2])
    assertTrue(still[2] < still[1])
    // Not changed by the phase
    assertEquals(still, (0 until RecordingBubbleStyle.BARS).map { RecordingBubbleStyle.barHeight(it, 0.2f, false, 10, 30) })
  }

  @Test
  fun sitsAtTheRightEdgeNearTheMiddleAndNeverLeavesTheScreen() {
    // 38 percent of the way down a 2400 px screen (a pixel either way for rounding)
    assertTrue(Math.abs(RecordingBubbleStyle.topPx(2400, 132) - 912) <= 1)
    // A short screen: the button still fits
    assertEquals(68, RecordingBubbleStyle.topPx(200, 132))
    assertEquals(0, RecordingBubbleStyle.topPx(100, 132))
  }
}
