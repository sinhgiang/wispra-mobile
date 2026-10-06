package expo.modules.wispradictation

import expo.modules.wispradictation.TranscriptFilter.Segment
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// The same cases as src/lib/__tests__/cloud.test.ts and transcript-filter.test.ts, so the app, the
// mic button and the Android keyboard agree (T-0164 review 2)
class TranscriptFilterTest {
  // The garbled stretch of the owner's meeting "Bảo mật web và AI" (build 4)
  private val ownersMeeting =
    "thì đó đều có sự quy ki ch g l n ch c kh th n c nh c l r l c b v r l kh b m Th ti m th quay l c ch nh tr gi s m k th c b n m hay l web c b c g DevTool l ha b n c c ph Network n m ph to to t m k th c t m nh l hoang bác quật là 2456 đi rồi đó thì các bạn thấy"

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

  // ── Bare consonants ──

  @Test
  fun flagsWordsWithoutVowelsButNotAcronymsOrRealWords() {
    for (w in listOf("ch", "g", "kh", "th", "nh", "ph")) assertTrue(w, TranscriptFilter.looksLikeGibberishToken(w))
    for (w in listOf("CEO", "ALT", "được", "người", "web", "quy", "hay", "Network")) assertFalse(w, TranscriptFilter.looksLikeGibberishToken(w))
  }

  @Test
  fun cutsTheGarbledRunOutOfTheOwnersMeetingAndKeepsTheRealWords() {
    val cleaned = TranscriptFilter.stripGibberish(ownersMeeting)
    assertTrue(cleaned.startsWith("thì đó đều có sự quy"))
    assertTrue(cleaned.contains("hoang bác quật là 2456 đi rồi đó thì các bạn thấy"))
    assertFalse(cleaned.contains("ch c kh th"))
    assertFalse(cleaned.contains("l r l c b v r"))
  }

  @Test
  fun leavesNormalTextAndShortRunsAlone() {
    val fine = "Hôm nay chúng ta họp với CEO về API của trang web, lúc 2 giờ."
    assertEquals(fine, TranscriptFilter.stripGibberish(fine))
    assertEquals("Mở tab F12 rồi bấm g ở đây", TranscriptFilter.stripGibberish("Mở tab F12 rồi bấm g ở đây"))
    assertEquals("Hết 5 kg rồi cm này", TranscriptFilter.stripGibberish("Hết 5 kg rồi cm này"))
  }

  @Test
  fun dropsASentenceThatIsOnlyBareConsonants() {
    assertEquals("", TranscriptFilter.stripGibberish("C n m l nh v th t th c"))
  }

  // ── Loops are collapsed, never dropped whole ──

  @Test
  fun collapsesALoopToTwoAndLeavesNumbersListsAndPhrasesSaidTwiceAlone() {
    assertEquals("vâng vâng", TranscriptFilter.collapseLoops("vâng vâng vâng vâng"))
    assertEquals("ý là ý là", TranscriptFilter.collapseLoops("ý là ý là ý là ý là"))
    assertEquals("không không không không", TranscriptFilter.collapseLoops("không không không không"))
    assertEquals("0 9 0 0 0 5", TranscriptFilter.collapseLoops("0 9 0 0 0 5"))
    assertEquals("đi chợ đi chợ rồi về", TranscriptFilter.collapseLoops("đi chợ đi chợ rồi về"))
    assertEquals("mua cam bưởi xoài ổi", TranscriptFilter.collapseLoops("mua cam bưởi xoài ổi"))
  }

  @Test
  fun neverDropsALoopingSegmentWhole() {
    val segment = Segment(" Mình họp lúc hai giờ vâng vâng vâng vâng vâng vâng rồi gửi báo cáo.", 0.05, -0.3, compressionRatio = 3.4)
    assertTrue(TranscriptFilter.isReliable(segment))
    assertEquals("Mình họp lúc hai giờ vâng vâng rồi gửi báo cáo.", TranscriptFilter.clean(null, listOf(segment)))
  }

  // ── Segment by segment ──

  @Test
  fun keepsRealUnsureSpeechAndDropsSilenceFilledWithText() {
    assertTrue(TranscriptFilter.isReliable(Segment("nói nhanh", 0.1, -1.4)))
    assertFalse(TranscriptFilter.isReliable(Segment("x", 0.9, -1.4)))
    assertFalse(TranscriptFilter.isReliable(Segment("x", 0.9, null)))
  }

  @Test
  fun dropsOnlyTheOutroSegmentAndKeepsSpeechWrittenWithoutAFullStop() {
    val speech = " hôm nay mình kiểm tra trang web xem cái API của SuperPay có lộ email username password không rồi dùng AI quét lỗi bảo mật cho khách hàng"
    val outro = " Cảm ơn các bạn đã theo dõi."
    val answer = TranscriptFilter.clean(null, listOf(Segment(speech, 0.02, -0.3), Segment(outro, 0.3, -0.5)))
    assertEquals(speech.trim(), answer)
    // Joined, the old way, everything would go
    assertEquals("", TranscriptFilter.clean(speech + outro, null))
  }

  @Test
  fun countsASentenceRepeatedThreeTimesAcrossSegmentsWithOneSharedCount() {
    val segment = Segment(" Xin cảm ơn quý vị.", 0.1, -0.2)
    assertEquals("Xin cảm ơn quý vị. Xin cảm ơn quý vị.", TranscriptFilter.clean(null, listOf(segment, segment, segment, segment)))
  }

  // ── Short real speech is never lost ──

  @Test
  fun keepsOneWordAnswersAndShortPhrasesAtOrdinaryAndLowConfidence() {
    val cases = listOf(" Dạ." to -0.4, " Vâng ạ." to -1.3, " Ừ." to -1.6, " Không." to -0.9, " Ok rồi." to -1.2, " Rồi, tiếp đi." to -1.5)
    for ((text, logprob) in cases) {
      assertEquals(text.trim(), TranscriptFilter.clean(null, listOf(Segment(text, 0.1, logprob))))
    }
  }

  @Test
  fun shortAnswersCoverTheirTime() {
    val read = TranscriptFilter.readAnswer(null, listOf(Segment(" Dạ.", 0.05, -0.4, start = 0.0, end = 1.0), Segment(" Vâng ạ.", 0.05, -0.5, start = 1.0, end = 2.5)))
    assertEquals("Dạ. Vâng ạ.", read.text)
    assertEquals(0.0, read.uncoveredSeconds, 0.0)
    assertFalse(read.gibberish)
  }

  // ── Silence filled with an outro is not lost speech (review 2, point 1) ──

  @Test
  fun anOutroOverSilenceIsNotLostSpeech() {
    for (outro in listOf(" Cảm ơn các bạn đã theo dõi.", " Thank you for watching.", " Hẹn gặp lại các bạn trong video sau.")) {
      val read = TranscriptFilter.readAnswer(null, listOf(Segment(outro, 0.05, -0.3, start = 0.0, end = 6.0)))
      assertEquals("", read.text)
      assertTrue(read.words > 0)
      assertEquals(0, read.wordsLeft)
      // Nothing bare-consonant in it: this is silence, so never sent again and never "speech lost"
      assertEquals(0, read.gibberishWords)
      assertFalse(TranscriptFilter.needsResend(read))
    }
  }

  // ── Lost speech is sent again, once ──

  private val accentsLost = Segment(" B ph tr s vi c tr l m c n g ch th nh t", 0.01, -0.07, start = 0.0, end = 12.0)

  @Test
  fun speechWithEveryAccentLostCountsAsUncoveredAndIsSentAgain() {
    val read = TranscriptFilter.readAnswer(null, listOf(accentsLost, Segment(" Rồi nhé.", 0.05, -0.3, start = 12.0, end = 14.0)))
    assertEquals("Rồi nhé.", read.text)
    assertEquals(14.0, read.speechSeconds, 0.0)
    assertEquals(12.0, read.uncoveredSeconds, 0.0)
    assertTrue(read.gibberish)
    assertTrue(TranscriptFilter.needsResend(read))
  }

  @Test
  fun aSegmentThatKeepsMostOfItsWordsCoversItsTime() {
    val read = TranscriptFilter.readAnswer(null, listOf(Segment(" hôm nay mình họp với anh Nam ch c kh th n c nh", 0.05, -0.4, start = 0.0, end = 10.0)))
    assertEquals(0.0, read.uncoveredSeconds, 0.0)
  }

  @Test
  fun decidesFromTheAnswer() {
    val base = TranscriptFilter.Answer("", 12, 0, 12.0, 12.0, 12)
    assertTrue(TranscriptFilter.needsResend(base))
    assertFalse(TranscriptFilter.needsResend(base.copy(uncoveredSeconds = 2.0)))
    assertFalse(TranscriptFilter.needsResend(base.copy(uncoveredSeconds = 5.0)))
    assertFalse(TranscriptFilter.needsResend(base.copy(gibberishWords = 0)))
    assertFalse(TranscriptFilter.needsResend(null))
  }

  @Test
  fun resolvesToTheAnswerWithMoreWordsAndSendsAgainOnlyOnce() {
    val garbled = TranscriptFilter.readAnswer(null, listOf(accentsLost))
    val clean = TranscriptFilter.readAnswer(null, listOf(Segment(" Bạn phụ trách sẽ viết câu trả lời mẫu cho các câu hỏi", 0.01, -0.2, start = 0.0, end = 12.0)))
    var asked = 0
    val chosen = TranscriptFilter.resolve(garbled) {
      asked++
      clean
    }
    assertEquals("Bạn phụ trách sẽ viết câu trả lời mẫu cho các câu hỏi", chosen.text)
    assertEquals(1, asked)
    // A second answer that is no better: the first stays
    val same = TranscriptFilter.resolve(garbled) { garbled }
    assertEquals(garbled, same)
    // The resend failed to get there: the first stays
    assertEquals(garbled, TranscriptFilter.resolve(garbled) { null })
  }

  @Test
  fun doesNotSendAgainForCleanSpeechOrForSilence() {
    var asked = 0
    val cleanSpeech = TranscriptFilter.readAnswer(null, listOf(Segment(" Bạn phụ trách sẽ viết câu trả lời", 0.01, -0.2, start = 0.0, end = 5.0)))
    val outro = TranscriptFilter.readAnswer(null, listOf(Segment(" Cảm ơn các bạn đã theo dõi.", 0.05, -0.3, start = 0.0, end = 6.0)))
    assertEquals(cleanSpeech, TranscriptFilter.resolve(cleanSpeech) { asked++; null })
    assertEquals(outro, TranscriptFilter.resolve(outro) { asked++; null })
    assertEquals(0, asked)
    assertNotEquals(cleanSpeech.text, outro.text)
  }

  // ── The language already told to Whisper (T-0145 review) ──

  @Test
  fun withALanguageAlreadyToldThereIsNothingMoreToAsk() {
    val garbled = TranscriptFilter.readAnswer(null, listOf(accentsLost))
    assertTrue(TranscriptFilter.needsResend(garbled))
    var asked = 0
    // "vi" or "en" was sent: the first answer stands, nothing is sent again
    assertEquals(garbled, TranscriptFilter.resolveFor("vi", garbled) { asked++; null })
    assertEquals(garbled, TranscriptFilter.resolveFor("en", garbled) { asked++; null })
    assertEquals(0, asked)
    // None was sent (auto): the resend asking for Vietnamese is still there
    val clean = TranscriptFilter.readAnswer(null, listOf(Segment(" Bạn phụ trách sẽ viết câu trả lời mẫu cho các câu hỏi", 0.01, -0.2, start = 0.0, end = 12.0)))
    assertEquals(clean, TranscriptFilter.resolveFor(null, garbled) { asked++; clean })
    assertEquals(1, asked)
  }
}
