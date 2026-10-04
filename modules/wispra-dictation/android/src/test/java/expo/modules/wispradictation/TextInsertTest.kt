package expo.modules.wispradictation

import org.junit.Assert.assertEquals
import org.junit.Test

class TextInsertTest {
  @Test
  fun fillsAnEmptyField() {
    assertEquals(Insertion("Em gửi anh báo giá", 18), TextInsert.merge("", 0, 0, "  Em gửi anh báo giá "))
  }

  @Test
  fun appendsWithASpaceWhenTheCursorIsUnknown() {
    assertEquals(Insertion("Chào anh Minh, em gửi báo giá", 29), TextInsert.merge("Chào anh Minh,", -1, -1, "em gửi báo giá"))
  }

  @Test
  fun insertsAtTheCursorWithSpacesOnBothSides() {
    val r = TextInsert.merge("Hello world", 5, 5, "big")
    assertEquals("Hello big world", r.text)
    assertEquals(9, r.cursor)
  }

  @Test
  fun replacesTheSelection() {
    assertEquals("I like tea", TextInsert.merge("I like coffee", 7, 13, "tea").text)
  }

  @Test
  fun noSpaceBeforePunctuation() {
    assertEquals("Thanks.", TextInsert.merge("Thanks", -1, -1, ".").text)
  }

  @Test
  fun selectionGivenBackwardsOrOutOfRangeIsHandled() {
    // 3..2 is the selection 2..3, so "c" is replaced
    assertEquals("ab X d", TextInsert.merge("abcd", 3, 2, "X").text)
    assertEquals("abcd X", TextInsert.merge("abcd", 99, 99, "X").text)
  }

  @Test
  fun nothingDictatedLeavesTheFieldAlone() {
    assertEquals(Insertion("abc", 1), TextInsert.merge("abc", 1, 1, "   "))
  }
}
