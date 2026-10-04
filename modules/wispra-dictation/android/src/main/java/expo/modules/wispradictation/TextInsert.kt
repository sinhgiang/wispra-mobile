package expo.modules.wispradictation

/** The field's new text and where the cursor goes after typing dictated words into it. */
data class Insertion(val text: String, val cursor: Int)

object TextInsert {
  private val NO_SPACE_BEFORE = setOf('.', ',', '!', '?', ';', ':', ')', ']', '}', '…')

  /**
   * Puts [dictated] in place of the selection [selStart]..[selEnd] of [existing], the way typing
   * would. A selection of -1 (unknown) means the end of the text. A space is added between the
   * words already there and the new ones when neither side has one.
   */
  fun merge(existing: String, selStart: Int, selEnd: Int, dictated: String): Insertion {
    val words = dictated.trim()
    if (words.isEmpty()) {
      val at = clamp(if (selStart < 0) existing.length else selStart, existing.length)
      return Insertion(existing, at)
    }
    var start = if (selStart < 0) existing.length else clamp(selStart, existing.length)
    var end = if (selEnd < 0) start else clamp(selEnd, existing.length)
    if (end < start) start = end.also { end = start }

    val before = existing.substring(0, start)
    val after = existing.substring(end)
    val leading = if (before.isNotEmpty() && !before.last().isWhitespace() && words.first() !in NO_SPACE_BEFORE) " " else ""
    val trailing = if (after.isNotEmpty() && !after.first().isWhitespace() && after.first() !in NO_SPACE_BEFORE) " " else ""
    val inserted = leading + words + trailing
    return Insertion(before + inserted + after, before.length + leading.length + words.length)
  }

  private fun clamp(value: Int, max: Int): Int = value.coerceIn(0, max)
}
