package expo.modules.wispradictation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The same cases as the iPhone keyboard's tests (targets-tests/keyboard/KeyboardTests.swift) */
class TelexTest {
  private fun type(keys: String): String {
    var word = ""
    for (key in keys) word = Telex.apply(word, key)
    return word
  }

  @Test
  fun tonesLettersAndWords() {
    val cases = listOf(
      "as" to "á", "af" to "à", "ar" to "ả", "ax" to "ã", "aj" to "ạ", "asz" to "a",
      "aa" to "â", "aw" to "ă", "ee" to "ê", "oo" to "ô", "ow" to "ơ", "uw" to "ư", "dd" to "đ", "w" to "ư",
      "ass" to "as", "aaa" to "aa", "ddd" to "dd", "ww" to "w", "oww" to "ow",
      "vieetj" to "việt", "Vieetj" to "Việt", "tieengs" to "tiếng", "nguwowif" to "người", "nguoiwf" to "người",
      "dduwowcj" to "được", "truwowngf" to "trường", "chuyeenj" to "chuyện", "cuar" to "của", "muaf" to "mùa",
      "hoaf" to "hòa", "hoafn" to "hoàn", "thuyr" to "thủy", "khoer" to "khỏe", "toans" to "toán",
      "quas" to "quá", "gif" to "gì", "giaf" to "già", "ngoaif" to "ngoài", "muoois" to "muối",
      "hocj" to "học", "ddi" to "đi", "did" to "đi", "Ddaay" to "Đây", "chieeuf" to "chiều", "hopj" to "họp",
      "cuwus" to "cứu", "tooi" to "tôi", "xin" to "xin", "chaof" to "chào",
      "tieesng" to "tiếng", "tiesng" to "tiéng",
    )
    for ((keys, expected) in cases) assertEquals("typing $keys", expected, type(keys))
  }

  @Test
  fun keyboardLayoutLikeTheIphoneOne() {
    val letters = KeyboardLogic.rows(KeyboardPage.LETTERS, upper = false)
    assertEquals(4, letters.size)
    assertEquals(KeyKind.Text("q"), letters[0].first())
    assertEquals(KeyKind.Shift, letters[2].first())
    assertEquals(KeyKind.Delete, letters[2].last())
    assertEquals(listOf(KeyKind.Page(KeyboardPage.NUMBERS), KeyKind.Switch, KeyKind.Language, KeyKind.Space, KeyKind.Enter), letters[3])
    assertEquals(KeyKind.Text("Q"), KeyboardLogic.rows(KeyboardPage.LETTERS, upper = true)[0].first())
    assertEquals(KeyKind.Text("1"), KeyboardLogic.rows(KeyboardPage.NUMBERS, upper = false)[0].first())
  }

  @Test
  fun typingRules() {
    assertTrue(KeyboardLogic.startsSentence(null))
    assertTrue(KeyboardLogic.startsSentence("Xin chào. "))
    assertTrue(KeyboardLogic.startsSentence("Chào\n"))
    assertFalse(KeyboardLogic.startsSentence("Xin chào "))
    assertFalse(KeyboardLogic.startsSentence("Xin"))
    assertTrue(KeyboardLogic.doubleSpaceMakesPeriod("chào "))
    assertFalse(KeyboardLogic.doubleSpaceMakesPeriod("chào. "))
    assertFalse(KeyboardLogic.doubleSpaceMakesPeriod("chào  "))
    assertEquals("chúng", KeyboardLogic.trailingWord("Hôm nay chúng"))
    assertEquals("", KeyboardLogic.trailingWord("Hôm nay "))
  }

  @Test
  fun segmenterCutsAtPauses() {
    val s = Segmenter()
    var cut = false
    repeat(8) { cut = s.feed(0.2f, 125) }
    assertFalse(cut)
    var cutAt = 0
    for (n in 1..10) {
      if (cut) break
      cut = s.feed(0.001f, 125)
      if (cut) cutAt = n
    }
    assertEquals(6, cutAt)
    s.reset()
    repeat(20) { cut = s.feed(0.001f, 100) }
    assertFalse(cut)
    assertFalse(s.heardVoice)
    s.reset()
    var steps = 0
    do { steps++ } while (!s.feed(0.3f, 500))
    assertEquals(24, steps)
  }
}
