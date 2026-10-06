package expo.modules.wispradictation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BubbleStyleTest {
  @Test
  fun idleIsASmallLightPurpleTileWithAPurpleMic() {
    val look = BubbleStyle.look(BubbleState.IDLE)
    assertEquals(30, look.sizeDp)
    assertFalse(look.round)
    assertEquals(BubbleStyle.LAVENDER, look.background)
    assertEquals(BubbleStyle.PURPLE, look.iconColor)
  }

  @Test
  fun listeningIsARedRoundMic() {
    val look = BubbleStyle.look(BubbleState.LISTENING)
    assertTrue(look.round)
    assertEquals(BubbleStyle.RED, look.background)
    assertEquals(BubbleStyle.WHITE, look.iconColor)
    assertTrue(look.description.contains("touch and hold to cancel"))
  }

  @Test
  fun sitsJustAboveTheFieldAtItsLeftEdge() {
    // A field from x 40, y 1200 to 1300 on screen; a 90 px bubble with a 12 px gap
    val (x, y) = BubbleStyle.position(fieldLeft = 40, fieldTop = 1200, fieldBottom = 1300, sizePx = 90, gapPx = 12, minTopPx = 72, minLeftPx = 12)
    assertEquals(52, x)
    assertEquals(1098, y)
  }

  @Test
  fun goesBelowAFieldAtTheTopOfTheScreen() {
    val (_, y) = BubbleStyle.position(fieldLeft = 0, fieldTop = 60, fieldBottom = 160, sizePx = 90, gapPx = 12, minTopPx = 72, minLeftPx = 12)
    assertEquals(172, y)
  }
}
