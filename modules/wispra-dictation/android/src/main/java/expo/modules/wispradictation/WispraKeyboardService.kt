package expo.modules.wispradictation

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.inputmethodservice.InputMethodService
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.InputType
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.Executors

/**
 * The Wispra keyboard on Android, the same design as on iPhone (the owner's rule: one design for
 * both): every letter with Vietnamese Telex, and a small purple mic at the top left. On Android a
 * keyboard may use the microphone itself, so no listening session is needed: tap the mic, it turns
 * red, speak; what is said is cut at the pauses and each piece is transcribed with Wispra Cloud and
 * typed at the cursor while the user keeps talking. Tap the red mic to finish. Each dictation is
 * also kept in Wispra's History, like the mic button's.
 */
class WispraKeyboardService : InputMethodService(), KeyboardPanel.Actions {
  private val main = Handler(Looper.getMainLooper())
  // One thread: the pieces are transcribed and typed in the order they were said
  private val worker = Executors.newSingleThreadExecutor()
  private lateinit var recorders: List<DictationRecorder>
  private lateinit var transcriber: Transcriber
  private var panel: KeyboardPanel? = null

  /** One dictation (from a tap on the mic to the next), made of pieces */
  private data class Dictation(val id: String, val createdAt: String, val sourceApp: String?)
  private data class Piece(val file: File, val index: Int)

  private var dictation: Dictation? = null
  private var current: DictationRecorder? = null
  private var piece: Piece? = null
  private var pieceCount = 0
  private val segmenter = Segmenter()
  private var lastTick = 0L
  // The words typed for the current or last dictation, for Undo and History
  private var typedWords = StringBuilder()
  private var lastTyped: String? = null
  private var piecesWaiting = 0
  private var finishing = false

  private var sourceApp: String? = null
  private var passwordField = false
  private var lastSpace = 0L

  private val prefs by lazy { getSharedPreferences("wispra_keyboard", MODE_PRIVATE) }

  private val tick = object : Runnable {
    override fun run() {
      val recorder = current ?: return
      val now = SystemClock.elapsedRealtime()
      val step = if (lastTick == 0L) 100 else now - lastTick
      lastTick = now
      // maxAmplitude is 0 to 32767
      val level = recorder.amplitude() / 32767f
      if (segmenter.feed(level, step)) nextPiece()
      main.postDelayed(this, 100)
    }
  }

  override fun onCreate() {
    super.onCreate()
    recorders = listOf(DictationRecorder(this), DictationRecorder(this))
    transcriber = Transcribers.create(this)
  }

  override fun onCreateInputView(): View = KeyboardPanel(this, this).also {
    panel = it
    it.setVietnamese(prefs.getBoolean("vietnamese", true))
  }

  override fun onStartInputView(info: EditorInfo?, restarting: Boolean) {
    super.onStartInputView(info, restarting)
    if (!restarting) lastTyped = null
    sourceApp = info?.packageName?.let(::appLabel)
    val variation = (info?.inputType ?: 0) and InputType.TYPE_MASK_VARIATION
    passwordField = variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
      variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
      variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
      variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
    // Numbers first in number and phone fields, as other keyboards do
    val klass = (info?.inputType ?: 0) and InputType.TYPE_MASK_CLASS
    panel?.setPage(if (klass == InputType.TYPE_CLASS_NUMBER || klass == InputType.TYPE_CLASS_PHONE) KeyboardPage.NUMBERS else KeyboardPage.LETTERS)
    showIdle(if (passwordField) "Wispra does not listen in password fields" else null)
    updateShift()
  }

  // Leaving the field while listening: what was said is kept in History, nothing is lost
  override fun onFinishInputView(finishingInput: Boolean) {
    if (current != null) finish(type = false)
    super.onFinishInputView(finishingInput)
  }

  override fun onUpdateSelection(oldSelStart: Int, oldSelEnd: Int, newSelStart: Int, newSelEnd: Int, candidatesStart: Int, candidatesEnd: Int) {
    super.onUpdateSelection(oldSelStart, oldSelEnd, newSelStart, newSelEnd, candidatesStart, candidatesEnd)
    updateShift()
  }

  override fun onDestroy() {
    main.removeCallbacks(tick)
    if (::recorders.isInitialized) recorders.forEach { if (it.isRecording) it.cancel() }
    worker.shutdown()
    super.onDestroy()
  }

  // ── Keys ────────────────────────────────────────────────────────────────────────────────────

  override fun onKey(key: KeyKind) {
    val ic = currentInputConnection ?: return
    val p = panel ?: return
    when (key) {
      is KeyKind.Text -> {
        val text = key.text
        val c = text.singleOrNull()
        if (prefs.getBoolean("vietnamese", true) && p.currentPage == KeyboardPage.LETTERS && c != null && c.isLetter()) {
          val word = KeyboardLogic.trailingWord(ic.getTextBeforeCursor(32, 0))
          val next = Telex.apply(word, c)
          if (next == word + text) {
            ic.commitText(text, 1)
          } else {
            ic.beginBatchEdit()
            ic.deleteSurroundingText(word.length, 0)
            ic.commitText(next, 1)
            ic.endBatchEdit()
          }
        } else {
          ic.commitText(text, 1)
        }
        lastTyped = null
        if (p.isUpper && !p.isLocked) p.setShift(upper = false, locked = false)
        if (p.currentPage != KeyboardPage.LETTERS && text == "'") p.setPage(KeyboardPage.LETTERS)
      }
      KeyKind.Shift -> when {
        p.isLocked -> p.setShift(upper = false, locked = false)
        p.isUpper -> p.setShift(upper = true, locked = true)
        else -> p.setShift(upper = true, locked = false)
      }
      KeyKind.Delete -> {
        val selected = ic.getSelectedText(0)
        if (!selected.isNullOrEmpty()) ic.commitText("", 1) else sendDownUpKeyEvents(KeyEvent.KEYCODE_DEL)
        lastTyped = null
      }
      is KeyKind.Page -> p.setPage(key.page)
      KeyKind.Space -> {
        val now = SystemClock.elapsedRealtime()
        if (now - lastSpace < 400 && KeyboardLogic.doubleSpaceMakesPeriod(ic.getTextBeforeCursor(2, 0))) {
          ic.deleteSurroundingText(1, 0)
          ic.commitText(". ", 1)
          lastSpace = 0
        } else {
          ic.commitText(" ", 1)
          lastSpace = now
        }
        if (p.currentPage != KeyboardPage.LETTERS) p.setPage(KeyboardPage.LETTERS)
        lastTyped = null
      }
      KeyKind.Enter -> {
        if (!sendDefaultEditorAction(true)) ic.commitText("\n", 1)
        lastTyped = null
      }
      KeyKind.Switch -> {
        if (current != null) finish(type = false)
        val switched = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && switchToPreviousInputMethod()
        if (!switched) (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showInputMethodPicker()
      }
      KeyKind.Language -> {
        val on = !prefs.getBoolean("vietnamese", true)
        prefs.edit().putBoolean("vietnamese", on).apply()
        p.setVietnamese(on)
      }
    }
    if (key != KeyKind.Shift) updateShift()
    showIdleIfQuiet()
  }

  /** A capital at the start of a sentence, as the field asks (Android's own rule for it) */
  private fun updateShift() {
    val p = panel ?: return
    if (p.isLocked || p.currentPage != KeyboardPage.LETTERS) return
    val info = currentInputEditorInfo ?: return
    val caps = currentInputConnection?.getCursorCapsMode(info.inputType) ?: 0
    p.setShift(upper = caps != 0, locked = false)
  }

  // ── Mic ─────────────────────────────────────────────────────────────────────────────────────

  override fun onMic() {
    when {
      current != null -> finish(type = true)
      finishing -> Unit
      else -> start()
    }
  }

  override fun onUndo() {
    val typed = lastTyped ?: return
    val ic = currentInputConnection ?: return
    if (TextInsert.canUndo(ic.getTextBeforeCursor(typed.length, 0), typed)) {
      ic.deleteSurroundingText(typed.length, 0)
      lastTyped = null
      showIdle("Đã hoàn tác")
    } else {
      showIdle("Chữ đã đổi, không hoàn tác được")
    }
  }

  private fun start() {
    if (passwordField) return
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      showIdle("Mở Wispra một lần và cho phép micro")
      packageManager.getLaunchIntentForPackage(packageName)?.let {
        it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(it)
      }
      return
    }
    // "mobile-" so the id never collides with the computer's in the shared Wispra Cloud history
    dictation = Dictation("mobile-" + UUID.randomUUID().toString(), isoNow(), sourceApp)
    pieceCount = 0
    typedWords = StringBuilder()
    lastTyped = null
    if (!startPiece(recorders[0])) {
      dictation = null
      return
    }
    panel?.show(KeyboardPanel.Mode.LISTENING, "Đang nghe… bấm mic đỏ khi xong", canUndo = false)
    lastTick = 0
    main.post(tick)
  }

  private fun startPiece(recorder: DictationRecorder): Boolean {
    val d = dictation ?: return false
    val file = File(DictationPrefs.inbox(this), "${d.id}-${pieceCount}.m4a")
    return try {
      recorder.start(file)
      current = recorder
      piece = Piece(file, pieceCount)
      pieceCount++
      segmenter.reset()
      true
    } catch (e: Exception) {
      showIdle("Wispra could not use the microphone: ${e.message ?: "unknown error"}")
      false
    }
  }

  /** At a pause: the next piece starts before this one stops, so nothing is lost between them */
  private fun nextPiece() {
    val recorder = current ?: return
    val done = piece ?: return
    val voiced = segmenter.heardVoice
    val other = recorders.first { it !== recorder }
    if (!startPiece(other)) return
    val length = recorder.stop()
    send(done, length, voiced, last = false)
  }

  /** Stops listening; types the last piece when [type] and the field is still there. */
  private fun finish(type: Boolean) {
    val recorder = current ?: return
    val done = piece
    main.removeCallbacks(tick)
    val voiced = segmenter.heardVoice
    val length = recorder.stop()
    current = null
    piece = null
    finishing = true
    if (done != null) send(done, length, voiced, last = true, type = type) else finishing = false
    panel?.show(KeyboardPanel.Mode.WORKING, "Đang viết…", canUndo = false)
  }

  /** A piece is transcribed in the background and typed at the cursor, in order */
  private fun send(p: Piece, length: Long, voiced: Boolean, last: Boolean, type: Boolean = true) {
    val d = dictation ?: return
    piecesWaiting++
    worker.execute {
      val text = if (!voiced) "" else try {
        transcriber.transcribe(p.file, length)
      } catch (_: Exception) {
        null
      }
      main.post {
        piecesWaiting--
        when {
          text == null -> savePiece(d, p, length) // kept with its audio, transcribed later by the app
          text.isNotBlank() -> {
            p.file.delete()
            typedWords.append(if (typedWords.isEmpty()) text.trim() else " " + text.trim())
            val ic = currentInputConnection
            if (type && ic != null) {
              val commit = TextInsert.forCommit(ic.getTextBeforeCursor(1, 0), text.trim(), ic.getTextAfterCursor(1, 0))
              ic.commitText(commit, 1)
              lastTyped = (lastTyped ?: "") + commit
            }
          }
          else -> p.file.delete()
        }
        if (last) {
          finishing = false
          saveDictation(d)
          showIdle(
            when {
              typedWords.isNotEmpty() -> "Đã gõ bằng Wispra"
              CloudSession.getJson(this) == null -> "Đã lưu vào Wispra. Đăng nhập trong app Wispra để ra chữ"
              else -> "Không nghe rõ, thử lại"
            },
          )
        }
      }
    }
  }

  private fun showIdle(message: String?) {
    panel?.show(KeyboardPanel.Mode.IDLE, message ?: "Wispra", canUndo = lastTyped != null)
  }

  private fun showIdleIfQuiet() {
    if (current == null && !finishing) showIdle(null)
  }

  // ── History ─────────────────────────────────────────────────────────────────────────────────

  /** The whole dictation's words as one entry of Wispra's History (no audio: the words are in) */
  private fun saveDictation(d: Dictation) {
    if (typedWords.isEmpty()) return
    try {
      InboxEntry(d.id, d.createdAt, 0, "", d.sourceApp, typedWords.toString()).writeTo(DictationPrefs.inbox(this))
    } catch (_: Exception) {
      // The words are in the field already
    }
  }

  /** A piece that could not be transcribed now: kept with its audio, the app transcribes it later */
  private fun savePiece(d: Dictation, p: Piece, length: Long) {
    try {
      InboxEntry("${d.id}-${p.index}", d.createdAt, length, p.file.name, d.sourceApp, null).writeTo(DictationPrefs.inbox(this))
    } catch (_: Exception) {
      // The audio file stays in the inbox folder even if its note could not be written
    }
  }

  private fun appLabel(pkg: String): String = try {
    packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
  } catch (_: Exception) {
    pkg
  }

  private fun isoNow(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    .apply { timeZone = TimeZone.getTimeZone("UTC") }
    .format(Date())
}
