package expo.modules.wispradictation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// The same cases as src/lib/__tests__/transcribe-language.test.ts
class TranscribeLanguageTest {
  @Test
  fun readsTheSavedChoiceBackAndFallsBackToVietnamese() {
    assertEquals("vi", TranscribeLanguage.parse("vi"))
    assertEquals("auto", TranscribeLanguage.parse("auto"))
    assertEquals("en", TranscribeLanguage.parse(" en\n"))
    assertEquals("vi", TranscribeLanguage.parse(null))
    assertEquals("vi", TranscribeLanguage.parse(""))
    assertEquals("vi", TranscribeLanguage.parse("fr"))
  }

  @Test
  fun sendsTheCodeToWhisperAndNothingForAuto() {
    assertEquals("vi", TranscribeLanguage.whisperCode(null))
    assertEquals("vi", TranscribeLanguage.whisperCode("vi"))
    assertEquals("en", TranscribeLanguage.whisperCode("en"))
    assertNull(TranscribeLanguage.whisperCode("auto"))
  }
}
