package expo.modules.wispradictation

import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** What the app's JavaScript can ask about the mic button in other apps. */
class WispraDictationModule : Module() {
  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("WispraDictation")

    // Whether the user turned on "Wispra mic button" in Settings > Accessibility
    Function("isServiceEnabled") {
      DictationPrefs.serviceEnabled(context)
    }

    // Opens Settings > Accessibility, where only the user can turn the service on
    Function("openAccessibilitySettings") {
      val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    // A switch inside Wispra to hide the bubble without going back to Settings
    Function("isBubbleEnabled") {
      DictationPrefs.bubbleEnabled(context)
    }

    Function("setBubbleEnabled") { enabled: Boolean ->
      DictationPrefs.setBubbleEnabled(context, enabled)
    }

    // The Wispra Cloud sign-in (JSON), kept in one place for the app and the mic-button service
    Function("getSession") {
      CloudSession.getJson(context)
    }

    Function("setSession") { json: String? ->
      CloudSession.setJson(context, json)
    }

    Function("setCloudConfig") { apiBase: String, supabaseUrl: String, publishableKey: String ->
      CloudSession.setConfig(context, apiBase, supabaseUrl, publishableKey)
    }

    // Cuts a recording into pieces of pieceMs (no re-encoding). The pieces are written next to
    // it; the original is left in place for the caller to remove once the pieces are saved.
    AsyncFunction("splitAudio") { uri: String, pieceMs: Double ->
      val input = java.io.File(android.net.Uri.parse(uri).path ?: uri)
      val base = input.nameWithoutExtension
      AudioSplitter.split(input, input.parentFile ?: context.filesDir, base, pieceMs.toLong()).map {
        mapOf("uri" to android.net.Uri.fromFile(it.file).toString(), "startMs" to it.startMs.toDouble(), "durationMs" to it.durationMs.toDouble())
      }
    }
  }
}
