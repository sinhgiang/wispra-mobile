package expo.modules.wispradictation

import android.content.Context
import android.graphics.PixelFormat
import android.graphics.PorterDuff
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView

/**
 * The Wispra mic shown just above the text field the user tapped, as in the owner's design
 * (BubbleStyle): a small light-purple tile with a purple mic; tap it and it turns into a red round
 * mic while listening; tap again and the words are typed into the field (touch and hold to cancel).
 * It is an accessibility overlay window, so it needs no "draw over other apps" permission and never
 * takes the keyboard focus from the field.
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

  private val icon = ImageView(context).apply { setImageResource(R.drawable.wispra_mic) }
  private val button = FrameLayout(context).apply {
    addView(icon, FrameLayout.LayoutParams(dp(18), dp(18), Gravity.CENTER))
    setOnClickListener {
      when (state) {
        BubbleState.WORKING -> Unit
        BubbleState.LISTENING -> onStop()
        BubbleState.IDLE -> onMic()
      }
    }
    setOnLongClickListener {
      if (state == BubbleState.LISTENING) {
        onCancel()
        true
      } else {
        false
      }
    }
  }
  private val params = WindowManager.LayoutParams(
    WindowManager.LayoutParams.WRAP_CONTENT,
    WindowManager.LayoutParams.WRAP_CONTENT,
    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
    PixelFormat.TRANSLUCENT,
  ).apply { gravity = Gravity.TOP or Gravity.START }

  private var attached = false
  private var state = BubbleState.IDLE
  private var field: Rect? = null
  val listening: Boolean
    get() = state == BubbleState.LISTENING

  init {
    apply(BubbleState.IDLE)
  }

  /** Places the bubble just above [field] (screen coordinates), or below it when there is no room. */
  fun showAt(field: Rect) {
    this.field = Rect(field)
    place()
    if (attached) {
      wm.updateViewLayout(button, params)
    } else {
      wm.addView(button, params)
      attached = true
    }
  }

  fun hide() {
    if (!attached) return
    wm.removeView(button)
    attached = false
  }

  fun showIdle() = apply(BubbleState.IDLE)

  /** After the red mic was tapped, while the words are being transcribed and typed */
  fun showWorking() = apply(BubbleState.WORKING)

  @Suppress("UNUSED_PARAMETER")
  fun showListening(elapsedMs: Long) {
    if (state != BubbleState.LISTENING) apply(BubbleState.LISTENING)
  }

  private fun apply(next: BubbleState) {
    state = next
    val look = BubbleStyle.look(next)
    button.background = GradientDrawable().apply {
      if (look.round) shape = GradientDrawable.OVAL else cornerRadius = dp(look.cornerDp).toFloat()
      setColor(look.background.toInt())
    }
    icon.setColorFilter(look.iconColor.toInt(), PorterDuff.Mode.SRC_IN)
    button.contentDescription = look.description
    params.width = dp(look.sizeDp)
    params.height = dp(look.sizeDp)
    // The red mic is a little bigger: it stays anchored just above the field
    if (field != null) place()
    if (attached) wm.updateViewLayout(button, params)
  }

  private fun place() {
    val f = field ?: return
    val (x, y) = BubbleStyle.position(f.left, f.top, f.bottom, params.height, dp(BubbleStyle.GAP_DP), dp(24), dp(4))
    params.x = x
    params.y = y
  }
}
