package expo.modules.wispradictation

import expo.modules.wispradictation.TranscriptFilter.Segment
import org.junit.Assert.assertEquals
import org.junit.Test

// The same cases as src/lib/__tests__/cloud.test.ts, so the app and the mic button agree
class TranscriptFilterTest {
  @Test
  fun dropsSilenceAndGuessedSegments() {
    val text = TranscriptFilter.clean(
      null,
      listOf(
        Segment(" Chào anh Minh.", 0.01, -0.2),
        Segment(" Cảm ơn các bạn đã theo dõi.", 0.9, null),
        Segment(" C ph th nh", 0.1, -1.6),
      ),
    )
    assertEquals("Chào anh Minh.", text)
  }

  @Test
  fun dropsInventedOutrosButKeepsRealSpeech() {
    assertEquals(
      "Gửi báo giá trước thứ Hai.",
      TranscriptFilter.filterKnownHallucinations("Gửi báo giá trước thứ Hai. Cảm ơn các bạn đã theo dõi! Kết thúc video."),
    )
    assertEquals(
      "Kết thúc video này, chúng ta chốt giá.",
      TranscriptFilter.filterKnownHallucinations("Kết thúc video này, chúng ta chốt giá."),
    )
  }

  @Test
  fun cutsLoopingSentences() {
    assertEquals("Okay. Okay.", TranscriptFilter.filterKnownHallucinations("Okay. Okay. Okay. Okay."))
  }

  @Test
  fun usesPlainTextWithoutSegments() {
    assertEquals("Hello world", TranscriptFilter.clean("  Hello world  ", null))
  }
}
