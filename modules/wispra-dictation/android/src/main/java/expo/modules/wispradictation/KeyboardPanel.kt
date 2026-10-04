package expo.modules.wispradictation

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The Wispra keyboard as in the approved design: a dark panel with the state and time, level bars
 * while listening, Undo / the big button / ABC, and the Clean up / Formal / English buttons. Built
 * in code, so the keyboard needs no layout files.
 */
class KeyboardPanel(context: Context, private val actions: Actions) : LinearLayout(context) {
  interface Actions {
    fun onMain()
    fun onUndo()
    fun onAbc()
    fun onStyle(style: CloudRewriter.Style)
    fun onBackspace()
    fun onEnter()
  }

  enum class Mode { IDLE, LISTENING, WORKING }

  private val density = resources.displayMetrics.density
  private fun dp(v: Int) = (v * density).toInt()

  private val accent = Color.parseColor("#6366F1")
  private val muted = Color.parseColor("#8892A4")
  private val key = Color.parseColor("#262A33")

  private val status = label(12f, muted)
  private val time = label(12f, muted)
  private val bars = LinearLayout(context).apply { gravity = Gravity.CENTER; orientation = HORIZONTAL }
  private val hint = label(13f, muted).apply { gravity = Gravity.CENTER }
  private val levels = FrameLayout(context)
  private val mainIcon = ImageView(context).apply { setImageResource(R.drawable.wispra_mic) }
  private val mainText = label(15f, Color.WHITE).apply { typeface = Typeface.DEFAULT_BOLD }
  private val main = FrameLayout(context).apply {
    background = pill(accent, 28)
    addView(mainIcon, FrameLayout.LayoutParams(dp(24), dp(24), Gravity.CENTER))
    addView(mainText, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
    setOnClickListener { actions.onMain() }
  }
  private val undo = keyButton("Undo") { actions.onUndo() }
  private val abc = keyButton("ABC") { actions.onAbc() }
  private val styles = listOf(
    chip("Clean up") { actions.onStyle(CloudRewriter.Style.CLEAN_UP) },
    chip("Formal") { actions.onStyle(CloudRewriter.Style.FORMAL) },
    chip("English") { actions.onStyle(CloudRewriter.Style.ENGLISH) },
  )
  private val barViews = List(BAR_COUNT) {
    View(context).apply { background = pill(accent, 2) }
  }

  init {
    orientation = VERTICAL
    setBackgroundColor(Color.parseColor("#15171D"))
    setPadding(dp(12), dp(12), dp(12), dp(16))

    addView(LinearLayout(context).apply {
      orientation = HORIZONTAL
      addView(status, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
      addView(time)
    }, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))

    barViews.forEach { bars.addView(it, LayoutParams(dp(4), dp(10)).apply { marginStart = dp(2); marginEnd = dp(2) }) }
    levels.addView(bars, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    levels.addView(hint, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    addView(levels, LayoutParams(LayoutParams.MATCH_PARENT, dp(44)).apply { topMargin = dp(8) })

    addView(LinearLayout(context).apply {
      orientation = HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      addView(undo, LayoutParams(0, dp(44), 1f))
      addView(main, LayoutParams(0, dp(56), 1.4f).apply { marginStart = dp(10); marginEnd = dp(10) })
      addView(abc, LayoutParams(0, dp(44), 1f))
    }, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })

    addView(LinearLayout(context).apply {
      orientation = HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      styles.forEach { addView(it, LayoutParams(LayoutParams.WRAP_CONTENT, dp(34)).apply { marginEnd = dp(8) }) }
      addView(View(context), LayoutParams(0, 1, 1f))
      addView(keyButton("⌫") { actions.onBackspace() }, LayoutParams(dp(48), dp(34)).apply { marginEnd = dp(8) })
      addView(keyButton("↵") { actions.onEnter() }, LayoutParams(dp(48), dp(34)))
    }, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) })

    show(Mode.IDLE, "Wispra keyboard", "Tap to speak", canUndo = false, canStyle = false)
  }

  fun show(mode: Mode, statusText: String, hintText: String?, canUndo: Boolean, canStyle: Boolean) {
    status.text = statusText
    hint.text = hintText ?: ""
    hint.visibility = if (mode == Mode.LISTENING) View.GONE else View.VISIBLE
    bars.visibility = if (mode == Mode.LISTENING) View.VISIBLE else View.GONE
    if (mode != Mode.LISTENING) time.text = ""
    when (mode) {
      Mode.IDLE -> {
        main.background = pill(accent, 28)
        mainIcon.visibility = View.VISIBLE
        mainText.visibility = View.GONE
        main.contentDescription = "Dictate with Wispra"
        undo.text = "Undo"
      }
      Mode.LISTENING -> {
        main.background = pill(accent, 28)
        mainIcon.visibility = View.GONE
        mainText.visibility = View.VISIBLE
        mainText.text = "Done"
        main.contentDescription = "Stop and insert"
        undo.text = "Cancel"
      }
      Mode.WORKING -> {
        main.background = pill(Color.parseColor("#4B5563"), 28)
        mainIcon.visibility = View.VISIBLE
        mainText.visibility = View.GONE
        main.contentDescription = "Working"
        undo.text = "Undo"
      }
    }
    main.isEnabled = mode != Mode.WORKING
    undo.isEnabled = mode == Mode.LISTENING || canUndo
    undo.alpha = if (undo.isEnabled) 1f else 0.4f
    styles.forEach {
      it.isEnabled = canStyle && mode == Mode.IDLE
      it.alpha = if (it.isEnabled) 1f else 0.4f
    }
  }

  /** Time and level while listening; level is 0 to 1 */
  fun listening(elapsedMs: Long, level: Float) {
    val s = elapsedMs / 1000
    time.text = "%d:%02d".format(s / 60, s % 60)
    // The newest level enters on the right; the others move one step left
    for (i in 0 until BAR_COUNT - 1) barViews[i].layoutParams.height = barViews[i + 1].layoutParams.height
    barViews[BAR_COUNT - 1].layoutParams.height = dp(6) + (level.coerceIn(0f, 1f) * dp(34)).toInt()
    bars.requestLayout()
  }

  private fun label(size: Float, color: Int) = TextView(context).apply {
    textSize = size
    setTextColor(color)
  }

  private fun pill(color: Int, radiusDp: Int) = GradientDrawable().apply {
    setColor(color)
    cornerRadius = dp(radiusDp).toFloat()
  }

  private fun keyButton(text: String, onClick: () -> Unit) = TextView(context).apply {
    this.text = text
    textSize = 14f
    gravity = Gravity.CENTER
    setTextColor(Color.WHITE)
    background = pill(key, 22)
    setOnClickListener { onClick() }
  }

  private fun chip(text: String, onClick: () -> Unit) = TextView(context).apply {
    this.text = text
    textSize = 12f
    gravity = Gravity.CENTER
    setTextColor(Color.parseColor("#C3C8D4"))
    setPadding(dp(12), 0, dp(12), 0)
    background = pill(Color.parseColor("#1D2029"), 17)
    setOnClickListener { onClick() }
  }

  companion object {
    private const val BAR_COUNT = 24
  }
}
