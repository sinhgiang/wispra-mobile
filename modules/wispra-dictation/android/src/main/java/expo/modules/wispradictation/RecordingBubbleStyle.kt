package expo.modules.wispradictation

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

/** What the recording indicator says: the wave moves while recording and stands still while waiting. */
enum class IndicatorMode { RECORDING, WAITING }

data class IndicatorLook(
  val background: Long,
  val barColor: Long,
  /** true: the bars move */
  val animated: Boolean,
  /** Read out by TalkBack, since there is no visible label */
  val description: String,
)

/**
 * How the recording indicator looks (T-1073): a small round button at the right edge of the screen, with
 * a little wave in it, faint so it does not hide what is under it. Tapping it opens Wispra. Kept apart
 * from the Android views so it can be tested, like BubbleStyle.
 */
object RecordingBubbleStyle {
  const val PURPLE = 0xFF6366F1
  const val AMBER = 0xFFF59E0B
  const val INK = 0xFF1B1D2A

  const val SIZE_DP = 40
  /** The whole button is this see-through (1 is solid): faint, as the owner asked, like the computer's */
  const val ALPHA = 0.5f
  /** Space between the button and the right edge, in dp */
  const val EDGE_DP = 4
  /** How far down the screen it sits, as a share of the screen's height */
  const val TOP_FRACTION = 0.38f

  const val BARS = 3
  const val BAR_WIDTH_DP = 4
  const val BAR_GAP_DP = 3
  const val BAR_MIN_DP = 6
  const val BAR_MAX_DP = 22

  /** One turn of the moving wave, in milliseconds */
  const val WAVE_MS = 1200L

  /** The mode the app's JavaScript names: "recording", or anything else (paused, waiting for the microphone) */
  fun mode(name: String): IndicatorMode = if (name == "recording") IndicatorMode.RECORDING else IndicatorMode.WAITING

  fun look(mode: IndicatorMode): IndicatorLook = when (mode) {
    IndicatorMode.RECORDING -> IndicatorLook(INK, PURPLE, animated = true, description = "Wispra is recording. Tap to open Wispra")
    IndicatorMode.WAITING -> IndicatorLook(INK, AMBER, animated = false, description = "Wispra recording is paused or waiting for the microphone. Tap to open Wispra")
  }

  /**
   * The height of bar [index] (0 until [BARS]) at [phase] (0 to 1, one turn of the wave), between [minPx]
   * and [maxPx]. Still bars (a pause) are low, high, medium.
   */
  fun barHeight(index: Int, phase: Float, animated: Boolean, minPx: Int, maxPx: Int): Int {
    val share = if (animated) abs(sin(PI * (phase + index.toFloat() / BARS))).toFloat() else STILL[index.coerceIn(0, BARS - 1)]
    return minPx + ((maxPx - minPx) * share).toInt()
  }

  private val STILL = floatArrayOf(0.35f, 1f, 0.6f)

  /** The top of the button, so that it sits [TOP_FRACTION] down the screen and never leaves it */
  fun topPx(screenHeightPx: Int, sizePx: Int): Int = (screenHeightPx * TOP_FRACTION).toInt().coerceIn(0, (screenHeightPx - sizePx).coerceAtLeast(0))
}
