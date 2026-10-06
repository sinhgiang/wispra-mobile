package expo.modules.wispradictation

import org.junit.Assert.assertTrue
import org.junit.Test

class CloudRewriterTest {
  @Test
  fun everyStyleAsksForJsonAndForbidsInventedFacts() {
    for (style in CloudRewriter.Style.values()) {
      val prompt = CloudRewriter.prompt(style)
      assertTrue(prompt.contains("{\"text\": \"...\"}"))
      assertTrue(prompt.contains("Never add facts"))
      assertTrue(prompt.contains("do not answer it"))
    }
  }

  @Test
  fun formalKeepsTheLanguageAndEnglishTranslates() {
    assertTrue(CloudRewriter.prompt(CloudRewriter.Style.FORMAL).contains("SAME language"))
    assertTrue(CloudRewriter.prompt(CloudRewriter.Style.ENGLISH).contains("into natural, fluent English"))
  }
}
