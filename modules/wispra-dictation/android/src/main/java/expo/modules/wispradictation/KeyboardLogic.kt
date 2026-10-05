package expo.modules.wispradictation

/**
 * What the Wispra keyboard on Android shows and its small typing rules: the same as the Wispra
 * keyboard on iPhone (targets/keyboard/KeyboardLogic.swift), the owner's rule being that both
 * platforms follow one design.
 */
enum class KeyboardPage { LETTERS, NUMBERS, SYMBOLS }

sealed class KeyKind {
  data class Text(val text: String) : KeyKind()
  object Shift : KeyKind()
  object Delete : KeyKind()
  data class Page(val page: KeyboardPage) : KeyKind()
  object Space : KeyKind()
  object Enter : KeyKind()
  /** Back to the previous keyboard (Android's version of the globe key) */
  object Switch : KeyKind()
  /** Vietnamese (Telex) on or off */
  object Language : KeyKind()
}

object KeyboardLogic {
  fun rows(page: KeyboardPage, upper: Boolean): List<List<KeyKind>> {
    fun chars(s: String) = s.map { KeyKind.Text(if (upper) it.uppercaseChar().toString() else it.toString()) }
    fun plain(list: List<String>) = list.map { KeyKind.Text(it) }
    val bottom = listOf(
      KeyKind.Page(if (page == KeyboardPage.LETTERS) KeyboardPage.NUMBERS else KeyboardPage.LETTERS),
      KeyKind.Switch,
      KeyKind.Language,
      KeyKind.Space,
      KeyKind.Enter,
    )
    return when (page) {
      KeyboardPage.LETTERS -> listOf(
        chars("qwertyuiop"),
        chars("asdfghjkl"),
        listOf(KeyKind.Shift) + chars("zxcvbnm") + listOf(KeyKind.Delete),
        bottom,
      )
      KeyboardPage.NUMBERS -> listOf(
        plain(listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "0")),
        plain(listOf("-", "/", ":", ";", "(", ")", "₫", "&", "@", "\"")),
        listOf(KeyKind.Page(KeyboardPage.SYMBOLS)) + plain(listOf(".", ",", "?", "!", "'")) + listOf(KeyKind.Delete),
        bottom,
      )
      KeyboardPage.SYMBOLS -> listOf(
        plain(listOf("[", "]", "{", "}", "#", "%", "^", "*", "+", "=")),
        plain(listOf("_", "\\", "|", "~", "<", ">", "$", "€", "£", "•")),
        listOf(KeyKind.Page(KeyboardPage.NUMBERS)) + plain(listOf(".", ",", "?", "!", "'")) + listOf(KeyKind.Delete),
        bottom,
      )
    }
  }

  /** A capital letter comes next: at the start of the text, of a line, or after . ? ! and a space */
  fun startsSentence(before: CharSequence?): Boolean {
    if (before.isNullOrEmpty()) return true
    if (before.last() == '\n') return true
    val trimmed = before.toString().trim(' ')
    if (before.last() != ' ' || trimmed.isEmpty()) return trimmed.isEmpty()
    return trimmed.last() in ".?!"
  }

  /** Two spaces in a row after a word make ". " */
  fun doubleSpaceMakesPeriod(before: CharSequence?): Boolean {
    if (before == null || before.length < 2 || before.last() != ' ') return false
    return before[before.length - 2].isLetterOrDigit()
  }

  /** The word being typed: the letters just before the cursor */
  fun trailingWord(before: CharSequence?): String {
    if (before == null) return ""
    var i = before.length
    while (i > 0 && before[i - 1].isLetter()) i--
    return before.substring(i)
  }
}

/**
 * Cuts a dictation into pieces at the pauses, so each piece is transcribed and typed while the
 * user keeps talking: the same rules as the iPhone session (modules/wispra-keyboard-bridge/ios/
 * Segmenter.swift).
 */
class Segmenter(
  /** Below this loudness (0 to 1) it counts as silence */
  private val silenceLevel: Float = 0.02f,
  private val pauseToCutMs: Long = 700,
  private val minPieceMs: Long = 1200,
  private val maxPieceMs: Long = 12000,
) {
  var pieceMs = 0L
    private set
  private var silentMs = 0L
  var heardVoice = false
    private set

  /** Feeds [durationMs] of audio at [level]; true when the piece should end now */
  fun feed(level: Float, durationMs: Long): Boolean {
    pieceMs += durationMs
    if (level >= silenceLevel) {
      heardVoice = true
      silentMs = 0
    } else {
      silentMs += durationMs
    }
    if (pieceMs >= maxPieceMs) return true
    return heardVoice && silentMs >= pauseToCutMs && pieceMs >= minPieceMs
  }

  fun reset() {
    pieceMs = 0
    silentMs = 0
    heardVoice = false
  }
}
