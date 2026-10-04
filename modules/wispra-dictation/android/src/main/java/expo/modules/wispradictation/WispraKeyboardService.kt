package expo.modules.wispradictation

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.inputmethodservice.InputMethodService
import android.os.Build
import android.os.Handler
import android.os.Looper
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
import kotlin.math.log10

/**
 * The Wispra keyboard: the backup on Android for apps where the mic button cannot appear (and the
 * same idea as the Wispra keyboard on iPhone). Tap the mic, speak, tap Done: the words are
 * transcribed with Wispra Cloud and typed at the cursor. ABC goes back to the usual keyboard.
 * Every dictation is also kept in Wispra's History, like the mic button's.
 */
class WispraKeyboardService : InputMethodService(), KeyboardPanel.Actions {
  private val main = Handler(Looper.getMainLooper())
  private val worker = Executors.newSingleThreadExecutor()
  private lateinit var recorder: DictationRecorder
  private lateinit var transcriber: Transcriber
  private var panel: KeyboardPanel? = null

  private data class Pending(val id: String, val audio: File, val createdAt: String, val sourceApp: String?)

  private var pending: Pending? = null
  private var working = false
  // What the keyboard typed last, for Undo and the style buttons
  private var lastTyped: String? = null
  private var sourceApp: String? = null
  private var passwordField = false

  private val tick = object : Runnable {
    override fun run() {
      if (!recorder.isRecording) return
      // maxAmplitude is 0 to 32767; shown on a decibel-like scale so normal speech fills the bars
      val amplitude = recorder.amplitude().coerceAtLeast(1)
      val level = ((20 * log10(amplitude / 32767.0) + 50) / 50).toFloat()
      panel?.listening(recorder.elapsedMs(), level)
      main.postDelayed(this, 100)
    }
  }

  override fun onCreate() {
    super.onCreate()
    recorder = DictationRecorder(this)
    transcriber = Transcribers.create(this)
  }

  override fun onCreateInputView(): View = KeyboardPanel(this, this).also { panel = it }

  override fun onStartInputView(info: EditorInfo?, restarting: Boolean) {
    super.onStartInputView(info, restarting)
    if (!restarting) lastTyped = null
    sourceApp = info?.packageName?.let(::appLabel)
    val variation = (info?.inputType ?: 0) and InputType.TYPE_MASK_VARIATION
    passwordField = variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
      variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
      variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
      variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
    showIdle(if (passwordField) "Wispra does not listen in password fields. Tap ABC." else null)
  }

  // Leaving the field while listening: the words are kept in History, nothing is lost
  override fun onFinishInputView(finishingInput: Boolean) {
    if (recorder.isRecording) finish(type = false)
    super.onFinishInputView(finishingInput)
  }

  override fun onDestroy() {
    if (::recorder.isInitialized && recorder.isRecording) recorder.cancel()
    worker.shutdown()
    super.onDestroy()
  }

  // ── Panel buttons ───────────────────────────────────────────────────────────────────────────

  override fun onMain() {
    when {
      working -> Unit
      recorder.isRecording -> finish(type = true)
      else -> start()
    }
  }

  override fun onUndo() {
    if (recorder.isRecording) {
      main.removeCallbacks(tick)
      recorder.cancel()
      pending = null
      showIdle("Cancelled")
      return
    }
    val typed = lastTyped ?: return
    val ic = currentInputConnection ?: return
    if (TextInsert.canUndo(ic.getTextBeforeCursor(typed.length, 0), typed)) {
      ic.deleteSurroundingText(typed.length, 0)
      lastTyped = null
      showIdle("Undone")
    } else {
      showIdle("The text has changed since, so there is nothing to undo.")
    }
  }

  override fun onAbc() {
    if (recorder.isRecording) finish(type = false)
    val switched = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && switchToPreviousInputMethod()
    if (!switched) (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showInputMethodPicker()
  }

  override fun onStyle(style: CloudRewriter.Style) {
    val typed = lastTyped ?: return
    if (working) return
    working = true
    panel?.show(KeyboardPanel.Mode.WORKING, "Wispra keyboard", "Rewriting…", canUndo = false, canStyle = false)
    worker.execute {
      val rewritten = CloudRewriter(this).rewrite(typed.trim(), style)
      main.post {
        working = false
        val ic = currentInputConnection
        if (rewritten == null || ic == null) {
          showIdle(if (CloudSession.getJson(this) == null) "Sign in to Wispra Cloud in the Wispra app first." else "Could not rewrite now. Try again.")
          return@post
        }
        if (!TextInsert.canUndo(ic.getTextBeforeCursor(typed.length, 0), typed)) {
          showIdle("The text has changed since, so it was left as it is.")
          return@post
        }
        ic.beginBatchEdit()
        ic.deleteSurroundingText(typed.length, 0)
        val replacement = TextInsert.forCommit(ic.getTextBeforeCursor(1, 0), rewritten, ic.getTextAfterCursor(1, 0))
        ic.commitText(replacement, 1)
        ic.endBatchEdit()
        lastTyped = replacement
        showIdle("Rewritten")
      }
    }
  }

  override fun onBackspace() {
    sendDownUpKeyEvents(KeyEvent.KEYCODE_DEL)
    lastTyped = null
  }

  override fun onEnter() {
    if (!sendDefaultEditorAction(true)) sendKeyChar('\n')
    lastTyped = null
  }

  // ── Dictation ───────────────────────────────────────────────────────────────────────────────

  private fun start() {
    if (passwordField) return
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      showIdle("Open Wispra once and allow the microphone.")
      packageManager.getLaunchIntentForPackage(packageName)?.let {
        it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(it)
      }
      return
    }
    // "mobile-" so the id never collides with the computer's in the shared Wispra Cloud history
    val id = "mobile-" + UUID.randomUUID().toString()
    val audio = File(DictationPrefs.inbox(this), "$id.m4a")
    try {
      recorder.start(audio)
    } catch (e: Exception) {
      showIdle("Wispra could not use the microphone: ${e.message ?: "unknown error"}")
      return
    }
    pending = Pending(id, audio, isoNow(), sourceApp)
    panel?.show(KeyboardPanel.Mode.LISTENING, "Wispra keyboard · Listening", null, canUndo = true, canStyle = false)
    main.post(tick)
  }

  /** Stops listening; types the words when [type] and the field is still there. Always keeps them in History. */
  private fun finish(type: Boolean) {
    val dictation = pending ?: return
    pending = null
    main.removeCallbacks(tick)
    val length = recorder.stop()
    working = true
    panel?.show(KeyboardPanel.Mode.WORKING, "Wispra keyboard", "Transcribing…", canUndo = false, canStyle = false)
    worker.execute {
      val text = try {
        transcriber.transcribe(dictation.audio, length)
      } catch (_: Exception) {
        null
      }
      main.post {
        working = false
        save(dictation, length, text)
        val ic = currentInputConnection
        when {
          text == null ->
            showIdle(
              if (CloudSession.getJson(this) == null) "Saved in Wispra History. Sign in to Wispra Cloud in the Wispra app to type your words."
              else "Could not transcribe now. Saved in Wispra History.",
            )
          !type || ic == null -> showIdle("Saved in Wispra History.")
          else -> {
            val commit = TextInsert.forCommit(ic.getTextBeforeCursor(1, 0), text, ic.getTextAfterCursor(1, 0))
            ic.commitText(commit, 1)
            lastTyped = commit
            showIdle("Typed by Wispra")
          }
        }
      }
    }
  }

  private fun showIdle(message: String?) {
    panel?.show(
      KeyboardPanel.Mode.IDLE,
      message ?: "Wispra keyboard",
      if (passwordField) null else "Tap the mic to speak",
      canUndo = lastTyped != null,
      canStyle = lastTyped != null,
    )
  }

  private fun save(dictation: Pending, length: Long, text: String?) {
    try {
      InboxEntry(dictation.id, dictation.createdAt, length, dictation.audio.name, dictation.sourceApp, text)
        .writeTo(DictationPrefs.inbox(this))
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
