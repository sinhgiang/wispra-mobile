package expo.modules.wispradictation

import android.animation.ValueAnimator
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.animation.LinearInterpolator

/**
 * The recording indicator (T-1073): a faint round button at the right edge of the screen, over every other
 * app, with a little wave in it. It shows while Wispra records and the app is not on screen; tapping it opens
 * Wispra. It is drawn as an overlay window, which needs the "Display over other apps" permission that the
 * person gives in Settings (Account has a row for it); without it there is no button and recording is not
 * affected.
 */
class RecordingBubble(private val context: Context, private val onTap: () -> Unit) {
  private val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
  private val density = context.resources.displayMetrics.density
  private fun dp(v: Int) = (v * density).toInt()

  private val wave = WaveView(context).apply {
    alpha = RecordingBubbleStyle.ALPHA
    setOnClickListener { onTap() }
  }

  private val params = WindowManager.LayoutParams(
    dp(RecordingBubbleStyle.SIZE_DP),
    dp(RecordingBubbleStyle.SIZE_DP),
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
    // Never takes the keyboard from the app underneath
    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
    PixelFormat.TRANSLUCENT,
  ).apply {
    gravity = Gravity.TOP or Gravity.END
    x = dp(RecordingBubbleStyle.EDGE_DP)
    y = RecordingBubbleStyle.topPx(context.resources.displayMetrics.heightPixels, dp(RecordingBubbleStyle.SIZE_DP))
  }

  private var attached = false

  /** Shows the button, or changes how it looks. false: the permission is not given, so there is none. */
  fun show(mode: IndicatorMode): Boolean {
    if (!Settings.canDrawOverlays(context)) return false
    wave.look = RecordingBubbleStyle.look(mode)
    if (!attached) {
      try {
        wm.addView(wave, params)
        attached = true
      } catch (e: Exception) {
        return false
      }
    }
    wave.startWave()
    return true
  }

  fun hide() {
    if (!attached) return
    wave.halt()
    try {
      wm.removeView(wave)
    } catch (e: Exception) {
      // Already gone
    }
    attached = false
  }
}

/** The round button with its three bars. */
private class WaveView(context: Context) : View(context) {
  private val density = context.resources.displayMetrics.density
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
  private val bar = Paint(Paint.ANTI_ALIAS_FLAG)
  private var phase = 0f
  private val animator = ValueAnimator.ofFloat(0f, 1f).apply {
    duration = RecordingBubbleStyle.WAVE_MS
    repeatCount = ValueAnimator.INFINITE
    interpolator = LinearInterpolator()
    addUpdateListener {
      phase = it.animatedValue as Float
      invalidate()
    }
  }

  var look: IndicatorLook = RecordingBubbleStyle.look(IndicatorMode.RECORDING)
    set(value) {
      field = value
      paint(value)
      invalidate()
    }

  init {
    paint(look)
  }

  private fun paint(value: IndicatorLook) {
    fill.color = value.background.toInt()
    bar.color = value.barColor.toInt()
    contentDescription = value.description
  }

  /** Moves the wave when the look says so, and holds it still otherwise */
  fun startWave() {
    if (look.animated) {
      if (!animator.isStarted) animator.start()
    } else {
      halt()
    }
  }

  fun halt() {
    animator.cancel()
    phase = 0f
    invalidate()
  }

  override fun onDetachedFromWindow() {
    animator.cancel()
    super.onDetachedFromWindow()
  }

  override fun onDraw(canvas: Canvas) {
    val w = width.toFloat()
    val h = height.toFloat()
    canvas.drawCircle(w / 2, h / 2, minOf(w, h) / 2, fill)
    val barW = RecordingBubbleStyle.BAR_WIDTH_DP * density
    val gap = RecordingBubbleStyle.BAR_GAP_DP * density
    val total = RecordingBubbleStyle.BARS * barW + (RecordingBubbleStyle.BARS - 1) * gap
    var left = (w - total) / 2
    for (i in 0 until RecordingBubbleStyle.BARS) {
      val barH = RecordingBubbleStyle.barHeight(
        i,
        phase,
        look.animated,
        (RecordingBubbleStyle.BAR_MIN_DP * density).toInt(),
        (RecordingBubbleStyle.BAR_MAX_DP * density).toInt(),
      )
      canvas.drawRoundRect(RectF(left, (h - barH) / 2, left + barW, (h + barH) / 2), barW / 2, barW / 2, bar)
      left += barW + gap
    }
  }
}

/** The one indicator of the app, put on and taken off on the main thread (windows can only be changed there). */
object RecordingIndicator {
  private val main = Handler(Looper.getMainLooper())
  private var bubble: RecordingBubble? = null

  fun show(context: Context, mode: IndicatorMode) {
    val app = context.applicationContext
    main.post {
      val shown = bubble ?: RecordingBubble(app) { openApp(app) }.also { bubble = it }
      shown.show(mode)
    }
  }

  fun hide() {
    main.post { bubble?.hide() }
  }

  // Brings Wispra back to the front where it was, on the recording (a launcher intent resumes the running app)
  private fun openApp(context: Context) {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    context.startActivity(launch)
  }
}
