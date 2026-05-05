package com.djtranscendence.pizzawala.geofence

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class StoredGeofenceSpec(
  val id: String,
  val name: String?,
  val latitude: Double,
  val longitude: Double,
  val radius: Double,
)

object GeofencePrefs {
  private const val PREFS_NAME = "pizzawala_geofences"
  private const val KEY_PREFIX_NAME = "name_"
  private const val KEY_LAST_EVENT = "last_event"
  private const val KEY_GEOFENCES = "geofences"
  private const val KEY_LAST_REGISTRATION = "last_registration"
  private const val KEY_LAST_REGISTRATION_ERROR = "last_registration_error"
  private const val KEY_LAST_ACTIVITY_SIGNAL = "last_activity_signal"
  private const val KEY_USER_NAME = "user_name"
  private const val KEY_NATIVE_HISTORY = "native_history"
  private const val KEY_NOTIFICATIONS_ENABLED = "notifications_enabled"
  private const val KEY_AUTO_SHIFT_ENABLED = "auto_shift_enabled"

  fun setAutoShiftEnabled(context: Context, enabled: Boolean) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(KEY_AUTO_SHIFT_ENABLED, enabled)
      .apply()
  }

  fun isAutoShiftEnabled(context: Context): Boolean {
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getBoolean(KEY_AUTO_SHIFT_ENABLED, false) // Default to false
  }

  fun setNotificationsEnabled(context: Context, enabled: Boolean) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(KEY_NOTIFICATIONS_ENABLED, enabled)
      .apply()
  }

  fun isNotificationsEnabled(context: Context): Boolean {
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getBoolean(KEY_NOTIFICATIONS_ENABLED, true) // Default to true
  }

  fun appendNativeHistory(context: Context, log: String) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val existing = prefs.getString(KEY_NATIVE_HISTORY, "") ?: ""
    val lines = existing.split("\n").filter { it.isNotBlank() }.take(4)
    val newHistory = (listOf(log) + lines).joinToString("\n")
    prefs.edit().putString(KEY_NATIVE_HISTORY, newHistory).apply()
  }

  fun getNativeHistory(context: Context): String {
    val appCtx = context.applicationContext
    return appCtx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(KEY_NATIVE_HISTORY, "") ?: ""
  }

  fun saveUserName(context: Context, name: String) {
    val appCtx = context.applicationContext
    appCtx
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_USER_NAME, name)
      .apply()
  }

  fun getUserName(context: Context): String? {
    val appCtx = context.applicationContext
    return appCtx
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(KEY_USER_NAME, null)
  }

  fun saveGeofenceName(context: Context, geofenceId: String, name: String?) {
    val safeName = name?.takeIf { it.isNotBlank() } ?: return
    context
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_PREFIX_NAME + geofenceId, safeName)
      .apply()
  }

  fun getGeofenceName(context: Context, geofenceId: String): String? {
    return context
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(KEY_PREFIX_NAME + geofenceId, null)
  }

  fun setLastEvent(context: Context, value: String) {
    val appCtx = context.applicationContext
    appCtx
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_LAST_EVENT, value)
      .apply()
  }

  fun getLastEvent(context: Context): String? {
    val appCtx = context.applicationContext
    return appCtx
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(KEY_LAST_EVENT, null)
  }

  fun saveGeofences(context: Context, geofences: List<StoredGeofenceSpec>) {
    val appCtx = context.applicationContext
    val json = JSONArray()
    geofences.forEach { spec ->
      json.put(
        JSONObject()
          .put("id", spec.id)
          .put("name", spec.name)
          .put("latitude", spec.latitude)
          .put("longitude", spec.longitude)
          .put("radius", spec.radius)
      )
      saveGeofenceName(appCtx, spec.id, spec.name)
    }

    appCtx
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_GEOFENCES, json.toString())
      .apply()
  }

  fun loadGeofences(context: Context): List<StoredGeofenceSpec> {
    val appCtx = context.applicationContext
    val raw = appCtx
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(KEY_GEOFENCES, null) ?: return emptyList()

    return try {
      val array = JSONArray(raw)
      buildList {
        for (i in 0 until array.length()) {
          val item = array.optJSONObject(i) ?: continue
          val id = item.optString("id").takeIf { it.isNotBlank() } ?: continue
          val latitude = item.optDouble("latitude", Double.NaN)
          val longitude = item.optDouble("longitude", Double.NaN)
          if (latitude.isNaN() || longitude.isNaN()) continue
          add(
            StoredGeofenceSpec(
              id = id,
              name = item.optString("name").takeIf { it.isNotBlank() },
              latitude = latitude,
              longitude = longitude,
              radius = item.optDouble("radius", 150.0).takeIf { it > 0 } ?: 150.0,
            )
          )
        }
      }
    } catch (_: Exception) {
      emptyList()
    }
  }

  fun setLastRegistration(context: Context, value: String) {
    val appCtx = context.applicationContext
    appCtx
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_LAST_REGISTRATION, value)
      .remove(KEY_LAST_REGISTRATION_ERROR)
      .apply()
  }

  fun setLastRegistrationError(context: Context, value: String) {
    val appCtx = context.applicationContext
    appCtx
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_LAST_REGISTRATION_ERROR, value)
      .apply()
  }

  fun getLastRegistration(context: Context): String? {
    val appCtx = context.applicationContext
    return appCtx
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(KEY_LAST_REGISTRATION, null)
  }

  fun getLastRegistrationError(context: Context): String? {
    val appCtx = context.applicationContext
    return appCtx
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(KEY_LAST_REGISTRATION_ERROR, null)
  }

  fun setLastActivitySignal(context: Context, value: String) {
    val appCtx = context.applicationContext
    appCtx
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_LAST_ACTIVITY_SIGNAL, value)
      .apply()
  }

  fun getLastActivitySignal(context: Context): String? {
    val appCtx = context.applicationContext
    return appCtx
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(KEY_LAST_ACTIVITY_SIGNAL, null)
  }
}
