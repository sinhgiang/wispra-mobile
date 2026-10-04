package expo.modules.wispradictation

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Toast
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Watches which text field has the focus. When it is an editable field in another app, the Wispra
 * mic bubble is shown above it; tap to dictate, ■ to stop. The audio is kept for Wispra's History,
 * and once transcription is available the words are typed into that field.
 *
 * It looks only at the focused field (its position, text and selection), never at the rest of the
 * screen, and records only between a tap on the mic and a tap on ■ or Cancel.
 */
class WispraAccessibilityService : AccessibilityService() {
  private val main = Handler(Looper.getMainLooper())
  private val worker = Executors.newSingleThreadExecutor()
  private lateinit var bubble: Bubble
  private lateinit var recorder: DictationRecorder

  // The field the user is dictating into, and the dictation in progress
  private var target: AccessibilityNodeInfo? = null
  private var current: Pending? = null

  private data class Pending(val id: String, val audio: File, val createdAt: String, val sourceApp: String?)

  private val tick = object : Runnable {
    override fun run() {
      if (!recorder.isRecording) return
      bubble.showListening(recorder.elapsedMs())
      main.postDelayed(this, 500)
    }
  }

  override fun onServiceConnected() {
    super.onServiceConnected()
    recorder = DictationRecorder(this)
    bubble = Bubble(this, onMic = ::startDictation, onStop = ::finishDictation, onCancel = ::cancelDictation)
    useTestTranscriptInDebugBuilds()
  }

  // Debug builds only: until Wispra Cloud transcription is in (part 2), a test can put words in
  // files/wispra/test-transcript.txt to check that they are typed into the other app's field.
  // Release builds never read this file.
  private fun useTestTranscriptInDebugBuilds() {
    val debuggable = (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
    if (!debuggable || Transcribers.current != null) return
    val file = File(filesDir, "wispra/test-transcript.txt")
    Transcribers.current = Transcriber { if (file.exists()) file.readText().trim().ifEmpty { null } else null }
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (!::bubble.isInitialized || recorder.isRecording) return
    if (event?.packageName == packageName) {
      // Our own app, or our own bubble being touched: leave the bubble as it is
      if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) bubble.hide()
      return
    }
    val field = if (DictationPrefs.bubbleEnabled(this)) focusedTextField() else null
    if (field == null) {
      target = null
      bubble.hide()
      return
    }
    target = field
    val bounds = Rect()
    field.getBoundsInScreen(bounds)
    if (bounds.isEmpty) bubble.hide() else bubble.showAt(bounds)
  }

  override fun onInterrupt() {
    cancelDictation()
  }

  override fun onDestroy() {
    if (::recorder.isInitialized && recorder.isRecording) recorder.cancel()
    if (::bubble.isInitialized) bubble.hide()
    worker.shutdown()
    super.onDestroy()
  }

  private fun focusedTextField(): AccessibilityNodeInfo? {
    val node = rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
      ?: windows.asSequence().mapNotNull { it.root?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) }.firstOrNull()
      ?: return null
    if (node.packageName == packageName || !node.isEditable || node.isPassword) return null
    return node
  }

  private fun startDictation() {
    if (recorder.isRecording) return
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      toast("Open Wispra once and allow the microphone, then try again.")
      packageManager.getLaunchIntentForPackage(packageName)?.let {
        it.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(it)
      }
      return
    }
    val id = UUID.randomUUID().toString()
    val audio = File(DictationPrefs.inbox(this), "$id.m4a")
    val sourceApp = target?.packageName?.toString()?.let(::appLabel)
    goForeground()
    try {
      recorder.start(audio)
    } catch (e: Exception) {
      leaveForeground()
      toast("Wispra could not use the microphone: ${e.message ?: "unknown error"}")
      return
    }
    current = Pending(id, audio, isoNow(), sourceApp)
    main.post(tick)
  }

  private fun finishDictation() {
    val pending = current ?: return
    current = null
    main.removeCallbacks(tick)
    val length = recorder.stop()
    leaveForeground()
    bubble.showIdle()
    val field = target
    worker.execute {
      val text = try {
        Transcribers.current?.transcribe(pending.audio)
      } catch (_: Exception) {
        null
      }
      main.post {
        val typed = text != null && field != null && typeInto(field, text)
        save(pending, length, if (typed) text else null)
        toast(
          when {
            typed -> "Typed by Wispra"
            text != null -> "Saved in Wispra History. The field was gone, so nothing was typed."
            else -> "Saved in Wispra History. Typing the words here needs Wispra Cloud sign-in, coming soon."
          },
        )
      }
    }
  }

  private fun cancelDictation() {
    if (current == null) return
    current = null
    main.removeCallbacks(tick)
    recorder.cancel()
    leaveForeground()
    bubble.showIdle()
  }

  private fun save(pending: Pending, length: Long, text: String?) {
    try {
      InboxEntry(pending.id, pending.createdAt, length, pending.audio.name, pending.sourceApp, text)
        .writeTo(DictationPrefs.inbox(this))
    } catch (e: Exception) {
      toast("Wispra could not save the dictation: ${e.message}")
    }
  }

  /** Types [text] at the field's cursor, like the keyboard would. */
  private fun typeInto(field: AccessibilityNodeInfo, text: String): Boolean {
    if (!field.refresh()) return false
    val showingHint = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && field.isShowingHintText
    val existing = if (showingHint) "" else field.text?.toString() ?: ""
    val merged = TextInsert.merge(existing, field.textSelectionStart, field.textSelectionEnd, text)
    val setText = Bundle().apply {
      putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, merged.text)
    }
    if (!field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, setText)) return false
    val cursor = Bundle().apply {
      putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, merged.cursor)
      putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, merged.cursor)
    }
    field.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, cursor)
    return true
  }

  // Android lets a service use the microphone in the background only while it shows a notification
  private fun goForeground() {
    val nm = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.wispra_recording_channel), NotificationManager.IMPORTANCE_LOW))
    }
    val notification = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(this))
      .setSmallIcon(R.drawable.wispra_mic)
      .setContentTitle(getString(R.string.wispra_recording_notice))
      .setOngoing(true)
      .build()
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (_: Exception) {
      // Not allowed right now; the recording is still tried, the user sees the bubble meanwhile
    }
  }

  private fun leaveForeground() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
  }

  private fun appLabel(pkg: String): String = try {
    packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
  } catch (_: Exception) {
    pkg
  }

  private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()

  private fun isoNow(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    .apply { timeZone = TimeZone.getTimeZone("UTC") }
    .format(Date())

  companion object {
    private const val CHANNEL = "wispra_dictation"
    private const val NOTIFICATION_ID = 4711
  }
}
