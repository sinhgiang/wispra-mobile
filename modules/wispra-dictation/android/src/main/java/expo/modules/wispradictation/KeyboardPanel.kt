package expo.modules.wispradictation

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.PorterDuff
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The Wispra keyboard on Android, following the owner's design shared with the iPhone keyboard
 * (T-0145): a full keyboard with every letter and Vietnamese Telex, light or dark like the phone,
 * and a strip on its top edge, right under the text field, with the small purple mic at the left.
 * The mic turns red while listening. Built in code, so the keyboard needs no layout files.
 */
class KeyboardPanel(context: Context, private val actions: Actions) : LinearLayout(context) {
  interface Actions {
    fun onMic()
    fun onUndo()
    fun onKey(key: KeyKind)
  }

  enum class Mode { IDLE, LISTENING, WORKING }

  private val density = resources.displayMetrics.density
  private fun dp(v: Int) = (v * density).toInt()
  private fun dpf(v: Float) = v * density

  private val dark = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
  private val background = if (dark) Color.parseColor("#2B2B2B") else Color.parseColor("#D1D4DB")
  private val letterFace = if (dark) Color.parseColor("#6B6B6B") else Color.WHITE
  private val specialFace = if (dark) Color.parseColor("#454545") else Color.parseColor("#ABB0BA")
  private val ink = if (dark) Color.WHITE else Color.BLACK
  private val purple = BubbleStyle.PURPLE.toInt()
  private val lavender = BubbleStyle.LAVENDER.toInt()
  private val red = BubbleStyle.RED.toInt()

  private val micIcon = ImageView(context).apply { setImageResource(R.drawable.wispra_mic) }
  private val mic = FrameLayout(context).apply {
    addView(micIcon, FrameLayout.LayoutParams(dp(16), dp(16), Gravity.CENTER))
    setOnClickListener { actions.onMic() }
  }
  private val status = TextView(context).apply {
    textSize = 13f
    setTextColor(if (dark) Color.parseColor("#BFBFBF") else Color.parseColor("#4B4B4B"))
    maxLines = 1
    ellipsize = TextUtils.TruncateAt.END
  }
  private val undo = TextView(context).apply {
    text = "Hoàn tác"
    textSize = 14f
    setTextColor(purple)
    setPadding(dp(12), dp(6), dp(12), dp(6))
    setOnClickListener { actions.onUndo() }
    visibility = GONE
  }
  private val keys = LinearLayout(context).apply { orientation = VERTICAL }

  private var page = KeyboardPage.LETTERS
  private var upper = true
  private var locked = false
  private var vietnamese = true

  private val repeat = Handler(Looper.getMainLooper())

  init {
    orientation = VERTICAL
    setBackgroundColor(background)
    val strip = LinearLayout(context).apply {
      orientation = HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(10), 0, dp(4), 0)
      addView(mic, LayoutParams(dp(32), dp(32)))
      addView(status, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(10) })
      addView(undo, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT))
    }
    addView(strip, LayoutParams(LayoutParams.MATCH_PARENT, dp(44)))
    addView(keys, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(6) })
    show(Mode.IDLE, "Wispra", canUndo = false)
    rebuild()
  }

  /** The strip: the mic's state, a short message, and Undo when there is something to undo */
  fun show(mode: Mode, message: String?, canUndo: Boolean) {
    val listening = mode == Mode.LISTENING
    mic.background = GradientDrawable().apply {
      if (listening) shape = GradientDrawable.OVAL else cornerRadius = dpf(8f)
      setColor(if (listening) red else lavender)
    }
    micIcon.setColorFilter(if (listening) Color.WHITE else purple, PorterDuff.Mode.SRC_IN)
    mic.alpha = if (mode == Mode.WORKING) 0.6f else 1f
    mic.contentDescription = if (listening) "Listening. Tap to type what you said" else "Speak with Wispra"
    status.text = message ?: "Wispra"
    undo.visibility = if (canUndo) VISIBLE else GONE
  }

  fun setPage(next: KeyboardPage) {
    page = next
    rebuild()
  }

  /** Capital letters: once, locked (caps lock) or off */
  fun setShift(upper: Boolean, locked: Boolean) {
    if (this.upper == upper && this.locked == locked) return
    this.upper = upper
    this.locked = locked
    rebuild()
  }

  fun setVietnamese(on: Boolean) {
    vietnamese = on
    rebuild()
  }

  val isUpper: Boolean get() = upper
  val isLocked: Boolean get() = locked
  val currentPage: KeyboardPage get() = page

  private fun rebuild() {
    keys.removeAllViews()
    val rows = KeyboardLogic.rows(page, upper && page == KeyboardPage.LETTERS)
    rows.forEachIndexed { r, row ->
      val line = LinearLayout(context).apply {
        orientation = HORIZONTAL
        setPadding(dp(3), dp(4), dp(3), dp(4))
      }
      // The a–l row is set in by half a key, as on the iPhone keyboard
      val inset = page == KeyboardPage.LETTERS && r == 1
      if (inset) line.addView(View(context), LayoutParams(0, 1, 0.5f))
      for (kind in row) line.addView(keyView(kind), LayoutParams(0, dp(42), weight(kind, r)).apply { marginStart = dp(3); marginEnd = dp(3) })
      if (inset) line.addView(View(context), LayoutParams(0, 1, 0.5f))
      keys.addView(line, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
    }
  }

  private fun weight(kind: KeyKind, row: Int): Float = when (kind) {
    is KeyKind.Text -> if (page != KeyboardPage.LETTERS && row == 2) 1.4f else 1f
    KeyKind.Shift, KeyKind.Delete -> 1.5f
    is KeyKind.Page -> if (row == 2) 1.5f else 1.3f
    KeyKind.Space -> 4.2f
    KeyKind.Enter -> 2f
    else -> 1.1f
  }

  @SuppressLint("ClickableViewAccessibility")
  private fun keyView(kind: KeyKind): View {
    val letter = kind is KeyKind.Text || kind == KeyKind.Space
    val view = TextView(context).apply {
      gravity = Gravity.CENTER
      setTextColor(ink)
      textSize = if (kind is KeyKind.Text && page == KeyboardPage.LETTERS) 21f else 15f
      text = label(kind)
      contentDescription = description(kind)
      background = GradientDrawable().apply {
        cornerRadius = dpf(5f)
        setColor(if (letter) letterFace else specialFace)
      }
      elevation = dpf(1f)
    }
    if (kind == KeyKind.Delete) {
      // Held down, delete repeats
      val again = object : Runnable {
        override fun run() {
          actions.onKey(KeyKind.Delete)
          repeat.postDelayed(this, 80)
        }
      }
      view.setOnTouchListener { v, event ->
        when (event.action) {
          MotionEvent.ACTION_DOWN -> {
            v.alpha = 0.6f
            actions.onKey(KeyKind.Delete)
            repeat.postDelayed(again, 450)
          }
          MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
            v.alpha = 1f
            repeat.removeCallbacks(again)
          }
        }
        true
      }
    } else {
      view.setOnTouchListener { v, event ->
        when (event.action) {
          MotionEvent.ACTION_DOWN -> v.alpha = 0.6f
          MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> v.alpha = 1f
        }
        false
      }
      view.setOnClickListener { actions.onKey(kind) }
    }
    return view
  }

  private fun label(kind: KeyKind): String = when (kind) {
    is KeyKind.Text -> kind.text
    KeyKind.Shift -> if (locked) "⇪" else if (upper) "⬆" else "⇧"
    KeyKind.Delete -> "⌫"
    is KeyKind.Page -> when (kind.page) {
      KeyboardPage.LETTERS -> "ABC"
      KeyboardPage.NUMBERS -> "123"
      KeyboardPage.SYMBOLS -> "#+="
    }
    KeyKind.Space -> if (vietnamese) "Wispra · Tiếng Việt" else "Wispra"
    KeyKind.Enter -> "Nhập"
    KeyKind.Switch -> "🌐"
    KeyKind.Language -> if (vietnamese) "VN" else "EN"
  }

  private fun description(kind: KeyKind): String = when (kind) {
    is KeyKind.Text -> kind.text
    KeyKind.Shift -> "Shift"
    KeyKind.Delete -> "Delete"
    is KeyKind.Page -> label(kind)
    KeyKind.Space -> "Space"
    KeyKind.Enter -> "Enter"
    KeyKind.Switch -> "Next keyboard"
    KeyKind.Language -> if (vietnamese) "Vietnamese Telex on" else "Vietnamese Telex off"
  }
}
