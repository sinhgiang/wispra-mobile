package expo.modules.wispradictation

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The small Wispra button shown just above the text field the user tapped, as in the approved
 * design: an accent-coloured mic with a "Tap to speak" label; while listening, a red stop button,
 * the time, and Cancel. It is an accessibility overlay window, so it needs no "draw over other
 * apps" permission and never takes the keyboard focus from the field.
 */
class Bubble(
  private val context: Context,
  private val onMic: () -> Unit,
  private val onStop: () -> Unit,
  private val onCancel: () -> Unit,
) {
  private val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
  private val density = context.resources.displayMetrics.density
  private fun dp(v: Int) = (v * density).toInt()

  private val accent = Color.parseColor("#6366F1")
  private val red = Color.parseColor("#EF4444")

  private val icon = ImageView(context).apply { setImageResource(R.drawable.wispra_mic) }
  private val square = View(context).apply {
    background = GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = dp(3).toFloat() }
  }
  private val button = FrameLayout(context).apply {
    background = circle(accent)
    contentDescription = "Dictate with Wispra"
    addView(icon, FrameLayout.LayoutParams(dp(22), dp(22), Gravity.CENTER))
    addView(square, FrameLayout.LayoutParams(dp(14), dp(14), Gravity.CENTER))
    setOnClickListener {
      when {
        working -> Unit
        listening -> onStop()
        else -> onMic()
      }
    }
  }
  private val label = chip("Tap to speak", Color.parseColor("#111827"))
  private val cancel = chip("Cancel", Color.parseColor("#374151")).apply {
    setOnClickListener { onCancel() }
  }
  private val root = LinearLayout(context).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    addView(button, LinearLayout.LayoutParams(dp(44), dp(44)))
    addView(label, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(8) })
    addView(cancel, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(8) })
  }
  private val params = WindowManager.LayoutParams(
    WindowManager.LayoutParams.WRAP_CONTENT,
    WindowManager.LayoutParams.WRAP_CONTENT,
    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
    PixelFormat.TRANSLUCENT,
  ).apply { gravity = Gravity.TOP or Gravity.START }

  private var attached = false
  var listening = false
    private set
  private var working = false

  init {
    showIdle()
  }

  /** Places the bubble above [field] (screen coordinates), or below it when there is no room. */
  fun showAt(field: Rect) {
    val height = dp(44)
    val gap = dp(8)
    val top = field.top - height - gap
    params.x = (field.left + dp(4)).coerceAtLeast(dp(4))
    params.y = if (top > dp(24)) top else field.bottom + gap
    if (attached) {
      wm.updateViewLayout(root, params)
    } else {
      wm.addView(root, params)
      attached = true
    }
  }

  fun hide() {
    if (!attached) return
    wm.removeView(root)
    attached = false
  }

  fun showIdle() {
    listening = false
    working = false
    button.background = circle(accent)
    button.contentDescription = "Dictate with Wispra"
    icon.visibility = View.VISIBLE
    square.visibility = View.GONE
    label.text = "Tap to speak"
    cancel.visibility = View.GONE
  }

  /** After ■, while the words are being transcribed and typed */
  fun showWorking() {
    listening = false
    working = true
    button.background = circle(Color.parseColor("#4B5563"))
    icon.visibility = View.VISIBLE
    square.visibility = View.GONE
    label.text = "Transcribing…"
    cancel.visibility = View.GONE
  }

  fun showListening(elapsedMs: Long) {
    listening = true
    button.background = circle(red)
    button.contentDescription = "Stop and type"
    icon.visibility = View.GONE
    square.visibility = View.VISIBLE
    val s = elapsedMs / 1000
    label.text = "Listening · %d:%02d".format(s / 60, s % 60)
    cancel.visibility = View.VISIBLE
  }

  private fun circle(color: Int) = GradientDrawable().apply {
    shape = GradientDrawable.OVAL
    setColor(color)
  }

  private fun chip(text: String, color: Int) = TextView(context).apply {
    this.text = text
    setTextColor(Color.WHITE)
    textSize = 12f
    setPadding(dp(10), dp(5), dp(10), dp(5))
    background = GradientDrawable().apply { setColor(color); cornerRadius = dp(12).toFloat() }
  }
}
