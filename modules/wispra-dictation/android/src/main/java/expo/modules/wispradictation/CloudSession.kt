package expo.modules.wispradictation

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * The Wispra Cloud sign-in, shared by the app (through WispraDictationModule) and the mic-button
 * service. One copy in the app's private storage, because a refresh token works only once: whoever
 * refreshes writes the new pair back here for the other.
 */
object CloudSession {
  private const val FILE = "wispra_cloud"
  private const val SESSION = "session"
  private const val API_BASE = "apiBase"
  private const val SUPABASE_URL = "supabaseUrl"
  private const val PUBLISHABLE_KEY = "publishableKey"
  private const val REFRESH_MARGIN_MS = 5 * 60 * 1000L

  private fun prefs(context: Context) = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  fun getJson(context: Context): String? = prefs(context).getString(SESSION, null)

  fun setJson(context: Context, json: String?) {
    // commit, not apply: the service may read it right after
    prefs(context).edit().apply { if (json == null) remove(SESSION) else putString(SESSION, json) }.commit()
  }

  fun setConfig(context: Context, apiBase: String, supabaseUrl: String, publishableKey: String) {
    prefs(context).edit()
      .putString(API_BASE, apiBase)
      .putString(SUPABASE_URL, supabaseUrl)
      .putString(PUBLISHABLE_KEY, publishableKey)
      .apply()
  }

  fun apiBase(context: Context): String? = prefs(context).getString(API_BASE, null)

  /** A token for Wispra Cloud, refreshed when it is about to run out; null when signed out. */
  @Synchronized
  fun validToken(context: Context): String? {
    val session = getJson(context)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return null
    val expiresAt = session.optLong("expiresAt", 0)
    if (expiresAt - System.currentTimeMillis() > REFRESH_MARGIN_MS) return session.optString("accessToken").ifEmpty { null }

    val url = prefs(context).getString(SUPABASE_URL, null) ?: return null
    val key = prefs(context).getString(PUBLISHABLE_KEY, null) ?: return null
    val connection = (URL("$url/auth/v1/token?grant_type=refresh_token").openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      connectTimeout = 10_000
      readTimeout = 10_000
      doOutput = true
      setRequestProperty("Content-Type", "application/json")
      setRequestProperty("apikey", key)
    }
    return try {
      connection.outputStream.use {
        it.write(JSONObject().put("refresh_token", session.optString("refreshToken")).toString().toByteArray())
      }
      when (connection.responseCode) {
        200 -> {
          val data = JSONObject(connection.inputStream.bufferedReader().readText())
          session.put("accessToken", data.getString("access_token"))
          session.put("refreshToken", data.getString("refresh_token"))
          session.put("expiresAt", System.currentTimeMillis() + data.getLong("expires_in") * 1000)
          setJson(context, session.toString())
          session.getString("accessToken")
        }
        400, 401 -> {
          // The sign-in is no longer valid: the user signs in again in the app
          setJson(context, null)
          null
        }
        // Server trouble: use the current token while it still works
        else -> if (expiresAt > System.currentTimeMillis()) session.optString("accessToken").ifEmpty { null } else null
      }
    } catch (_: Exception) {
      // Offline: use the current token while it still works
      if (expiresAt > System.currentTimeMillis()) session.optString("accessToken").ifEmpty { null } else null
    } finally {
      connection.disconnect()
    }
  }
}
