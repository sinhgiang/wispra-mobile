package expo.modules.wispradictation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

class InboxEntryTest {
  private val entry = InboxEntry(
    id = "abc",
    createdAt = "2026-10-04T12:00:00.000Z",
    durationMs = 4200,
    audioFileName = "abc.m4a",
    sourceApp = "Zalo \"chat\"",
    text = null,
  )

  @Test
  fun writesTheJsonTheAppReads() {
    assertEquals(
      "{\"version\":1,\"id\":\"abc\",\"kind\":\"dictation\",\"createdAt\":\"2026-10-04T12:00:00.000Z\"," +
        "\"durationMs\":4200,\"audioFileName\":\"abc.m4a\",\"sourceApp\":\"Zalo \\\"chat\\\"\",\"text\":null}",
      entry.toJson(),
    )
  }

  @Test
  fun escapesControlCharactersAndKeepsVietnamese() {
    assertEquals("\"dòng 1\\ndòng\\t2\\u0001\"", InboxEntry.quote("dòng 1\ndòng\t2\u0001"))
  }

  @Test
  fun leavesOnlyTheFinishedFile() {
    val dir = Files.createTempDirectory("inbox").toFile()
    entry.writeTo(dir)
    assertTrue(dir.resolve("abc.json").exists())
    assertFalse(dir.resolve("abc.json.tmp").exists())
    dir.deleteRecursively()
  }
}
