package expo.modules.wispradictation

/**
 * How the mic over other apps looks in each state, following the owner's design (T-0145, the
 * picture "Hôm nay chúng ta sẽ họp vào lúc 2 giờ chiều"): a small light-purple tile with a purple
 * mic just above the text field; a red round mic while listening; no labels. Kept apart from the
 * Android views so it can be tested.
 */
enum class BubbleState { IDLE, LISTENING, WORKING }

data class BubbleLook(
  /** Width and height in dp */
  val sizeDp: Int,
  /** true: a circle; false: a rounded square */
  val round: Boolean,
  val cornerDp: Int,
  val background: Long,
  val iconColor: Long,
  /** Read out by TalkBack, since there is no visible label */
  val description: String,
)

object BubbleStyle {
  const val PURPLE = 0xFF6366F1
  const val LAVENDER = 0xFFC7C9FA
  const val RED = 0xFFEF4444
  const val WHITE = 0xFFFFFFFF

  /** Space between the bubble and the top of the text field, in dp */
  const val GAP_DP = 4

  fun look(state: BubbleState): BubbleLook = when (state) {
    BubbleState.IDLE -> BubbleLook(30, round = false, cornerDp = 8, background = LAVENDER, iconColor = PURPLE, description = "Dictate with Wispra")
    BubbleState.LISTENING -> BubbleLook(40, round = true, cornerDp = 20, background = RED, iconColor = WHITE, description = "Listening. Tap to type what you said, touch and hold to cancel")
    BubbleState.WORKING -> BubbleLook(30, round = false, cornerDp = 8, background = LAVENDER, iconColor = 0x996366F1, description = "Typing what you said")
  }

  /**
   * Where the bubble goes for a field at [fieldLeft], [fieldTop], [fieldBottom] (pixels): just
   * above the field at its left edge, or just below it when there is no room above.
   */
  fun position(fieldLeft: Int, fieldTop: Int, fieldBottom: Int, sizePx: Int, gapPx: Int, minTopPx: Int, minLeftPx: Int): Pair<Int, Int> {
    val x = (fieldLeft + minLeftPx).coerceAtLeast(minLeftPx)
    val above = fieldTop - sizePx - gapPx
    val y = if (above > minTopPx) above else fieldBottom + gapPx
    return x to y
  }
}
