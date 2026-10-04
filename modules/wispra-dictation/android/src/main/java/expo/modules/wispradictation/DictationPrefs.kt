package expo.modules.wispradictation

import android.content.ComponentName
import android.content.Context
import android.provider.Settings
import android.text.TextUtils
import java.io.File

object DictationPrefs {
  private const val FILE = "wispra_dictation"
  private const val BUBBLE_ENABLED = "bubbleEnabled"

  fun bubbleEnabled(context: Context): Boolean =
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean(BUBBLE_ENABLED, true)

  fun setBubbleEnabled(context: Context, enabled: Boolean) {
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean(BUBBLE_ENABLED, enabled).apply()
  }

  /** Where finished dictations wait for the app: files/wispra/inbox (the app's document directory) */
  fun inbox(context: Context): File = File(context.filesDir, "wispra/inbox")

  /** Whether the user has turned the service on in Settings > Accessibility */
  fun serviceEnabled(context: Context): Boolean {
    val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
    val ours = ComponentName(context, WispraAccessibilityService::class.java)
    val splitter = TextUtils.SimpleStringSplitter(':')
    splitter.setString(enabled)
    return splitter.any { ComponentName.unflattenFromString(it) == ours }
  }
}
