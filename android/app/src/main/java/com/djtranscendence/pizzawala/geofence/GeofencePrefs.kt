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
  private const val KEY_SUPPRESS_ENTER_WHILE_ON_SHIFT = "suppress_enter_while_on_shift"
  private const val KEY_ENTER_HANDLED_PREFIX = "enter_handled_"
  private const val KEY_BREAK_RETURN_HANDLED_PREFIX = "break_return_handled_"
  private const val KEY_CONFIRMED_AWAY_PREFIX = "confirmed_away_"
  private const val KEY_PENDING_AUTO_PREFIX = "pending_auto_"
  private const val KEY_EXIT_NOTIFIED_PREFIX = "exit_notified_"
  private const val KEY_REGISTERED_SIGNATURE = "registered_signature"
  private const val KEY_SHIFT_ACTIVE = "shift_active"
  private const val KEY_SHIFT_ID = "shift_id"
  private const val KEY_SHIFT_USER_ID = "shift_user_id"
  private const val KEY_SHIFT_GEOFENCE_ID = "shift_geofence_id"
  private const val KEY_SHIFT_GEOFENCE_NAME = "shift_geofence_name"
  private const val KEY_SHIFT_PAUSED = "shift_paused"
  private const val KEY_BREAK_SOURCE = "break_source"
  private const val KEY_AUTO_BREAK_ARMED = "auto_break_armed"
  private const val KEY_CUTOFF_REACHED = "shift_cutoff_reached"
  private const val KEY_PENDING_SHIFT_ACTION = "pending_shift_action"
  private const val KEY_PENDING_JS_ACTION = "pending_js_action"
  private const val KEY_PENDING_JS_GEOFENCE_ID = "pending_js_geofence_id"
  private const val KEY_PENDING_JS_GEOFENCE_NAME = "pending_js_geofence_name"

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
      .getBoolean(KEY_NOTIFICATIONS_ENABLED, false)
  }

  fun setSuppressEnterWhileOnShift(context: Context, suppressed: Boolean) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(KEY_SUPPRESS_ENTER_WHILE_ON_SHIFT, suppressed)
      .apply()
  }

  fun isSuppressEnterWhileOnShift(context: Context): Boolean {
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getBoolean(KEY_SUPPRESS_ENTER_WHILE_ON_SHIFT, false)
  }

  fun setEnterHandledForVisit(context: Context, geofenceId: String, handled: Boolean) {
    if (geofenceId.isBlank()) return
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
    if (handled) {
      prefs.putBoolean(KEY_ENTER_HANDLED_PREFIX + geofenceId, true)
    } else {
      prefs.remove(KEY_ENTER_HANDLED_PREFIX + geofenceId)
    }
    prefs.apply()
  }

  fun isEnterHandledForVisit(context: Context, geofenceId: String): Boolean {
    if (geofenceId.isBlank()) return false
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getBoolean(KEY_ENTER_HANDLED_PREFIX + geofenceId, false)
  }

  fun setExitNotifiedForVisit(context: Context, geofenceId: String, notified: Boolean) {
    if (geofenceId.isBlank()) return
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
    if (notified) {
      prefs.putBoolean(KEY_EXIT_NOTIFIED_PREFIX + geofenceId, true)
    } else {
      prefs.remove(KEY_EXIT_NOTIFIED_PREFIX + geofenceId)
    }
    prefs.apply()
  }

  fun isExitNotifiedForVisit(context: Context, geofenceId: String): Boolean {
    if (geofenceId.isBlank()) return false
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getBoolean(KEY_EXIT_NOTIFIED_PREFIX + geofenceId, false)
  }

  fun setBreakReturnHandledForVisit(context: Context, geofenceId: String, handled: Boolean) {
    if (geofenceId.isBlank()) return
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
    if (handled) {
      prefs.putBoolean(KEY_BREAK_RETURN_HANDLED_PREFIX + geofenceId, true)
    } else {
      prefs.remove(KEY_BREAK_RETURN_HANDLED_PREFIX + geofenceId)
    }
    prefs.apply()
  }

  fun isBreakReturnHandledForVisit(context: Context, geofenceId: String): Boolean {
    if (geofenceId.isBlank()) return false
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getBoolean(KEY_BREAK_RETURN_HANDLED_PREFIX + geofenceId, false)
  }

  fun setConfirmedAwayForVisit(context: Context, geofenceId: String, away: Boolean) {
    if (geofenceId.isBlank()) return
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
    if (away) {
      prefs.putBoolean(KEY_CONFIRMED_AWAY_PREFIX + geofenceId, true)
    } else {
      prefs.remove(KEY_CONFIRMED_AWAY_PREFIX + geofenceId)
    }
    prefs.apply()
  }

  fun isConfirmedAwayForVisit(context: Context, geofenceId: String): Boolean {
    if (geofenceId.isBlank()) return false
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getBoolean(KEY_CONFIRMED_AWAY_PREFIX + geofenceId, false)
  }

  fun getPendingAutoAction(context: Context, geofenceId: String): String? {
    if (geofenceId.isBlank()) return null
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(KEY_PENDING_AUTO_PREFIX + geofenceId, null)
  }

  fun setPendingAutoAction(context: Context, geofenceId: String, action: String?) {
    if (geofenceId.isBlank()) return
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
    if (action.isNullOrBlank()) {
      prefs.remove(KEY_PENDING_AUTO_PREFIX + geofenceId)
    } else {
      prefs.putString(KEY_PENDING_AUTO_PREFIX + geofenceId, action)
    }
    prefs.apply()
  }

  fun consumePendingAutoAction(context: Context, geofenceId: String, action: String): Boolean {
    val pending = getPendingAutoAction(context, geofenceId)
    if (pending != action) return false
    setPendingAutoAction(context, geofenceId, null)
    return true
  }

  fun saveShiftSnapshot(
    context: Context,
    active: Boolean,
    shiftId: String?,
    userId: String?,
    geofenceId: String?,
    geofenceName: String?,
    paused: Boolean,
  ) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(KEY_SHIFT_ACTIVE, active)
      .putString(KEY_SHIFT_ID, shiftId)
      .putString(KEY_SHIFT_USER_ID, userId)
      .putString(KEY_SHIFT_GEOFENCE_ID, geofenceId)
      .putString(KEY_SHIFT_GEOFENCE_NAME, geofenceName)
      .putBoolean(KEY_SHIFT_PAUSED, paused)
      .apply()
    if (!paused) {
      setBreakSource(context, null)
    }
  }

  fun clearShiftSnapshot(context: Context) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(KEY_SHIFT_ACTIVE, false)
      .remove(KEY_SHIFT_ID)
      .remove(KEY_SHIFT_USER_ID)
      .remove(KEY_SHIFT_GEOFENCE_ID)
      .remove(KEY_SHIFT_GEOFENCE_NAME)
      .putBoolean(KEY_SHIFT_PAUSED, false)
      .remove(KEY_BREAK_SOURCE)
      .remove(KEY_PENDING_SHIFT_ACTION)
      .apply()
  }

  fun isShiftActive(context: Context): Boolean {
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getBoolean(KEY_SHIFT_ACTIVE, false)
  }

  fun isShiftPaused(context: Context): Boolean {
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getBoolean(KEY_SHIFT_PAUSED, false)
  }

  fun getShiftId(context: Context): String? {
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(KEY_SHIFT_ID, null)
  }

  fun getShiftUserId(context: Context): String? {
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(KEY_SHIFT_USER_ID, null)
  }

  fun getShiftGeofenceId(context: Context): String? {
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(KEY_SHIFT_GEOFENCE_ID, null)
  }

  fun getShiftGeofenceName(context: Context): String? {
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(KEY_SHIFT_GEOFENCE_NAME, null)
  }

  fun setShiftPaused(context: Context, paused: Boolean) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(KEY_SHIFT_PAUSED, paused)
      .apply()
  }

  fun setBreakSource(context: Context, source: String?) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
    if (source.isNullOrBlank()) {
      prefs.remove(KEY_BREAK_SOURCE)
    } else {
      prefs.putString(KEY_BREAK_SOURCE, source)
    }
    prefs.apply()
  }

  fun getBreakSource(context: Context): String? {
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(KEY_BREAK_SOURCE, null)
  }

  fun isAutomaticBreak(context: Context): Boolean {
    return getBreakSource(context) == "auto"
  }

  fun setAutoBreakArmed(context: Context, armed: Boolean) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(KEY_AUTO_BREAK_ARMED, armed)
      .apply()
  }

  fun isAutoBreakArmed(context: Context): Boolean {
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getBoolean(KEY_AUTO_BREAK_ARMED, true)
  }

  fun setCutoffReached(context: Context, reached: Boolean) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(KEY_CUTOFF_REACHED, reached)
      .apply()
  }

  fun isCutoffReached(context: Context): Boolean {
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getBoolean(KEY_CUTOFF_REACHED, false)
  }

  fun setPendingShiftAction(context: Context, action: String?) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
    if (action.isNullOrBlank()) {
      prefs.remove(KEY_PENDING_SHIFT_ACTION)
    } else {
      prefs.putString(KEY_PENDING_SHIFT_ACTION, action)
    }
    prefs.apply()
  }

  fun getPendingShiftAction(context: Context): String? {
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(KEY_PENDING_SHIFT_ACTION, null)
  }

  fun setPendingJsAction(context: Context, action: String, geofenceId: String?, geofenceName: String?) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_PENDING_JS_ACTION, action)
      .putString(KEY_PENDING_JS_GEOFENCE_ID, geofenceId)
      .putString(KEY_PENDING_JS_GEOFENCE_NAME, geofenceName)
      .apply()
  }

  fun takePendingJsAction(context: Context): Triple<String, String?, String?>? {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val action = prefs.getString(KEY_PENDING_JS_ACTION, null) ?: return null
    val geofenceId = prefs.getString(KEY_PENDING_JS_GEOFENCE_ID, null)
    val geofenceName = prefs.getString(KEY_PENDING_JS_GEOFENCE_NAME, null)
    prefs.edit()
      .remove(KEY_PENDING_JS_ACTION)
      .remove(KEY_PENDING_JS_GEOFENCE_ID)
      .remove(KEY_PENDING_JS_GEOFENCE_NAME)
      .apply()
    return Triple(action, geofenceId, geofenceName)
  }

  fun isCurrentShiftWorksite(context: Context, geofenceId: String): Boolean {
    val current = getShiftGeofenceId(context)
    return !current.isNullOrBlank() && current == geofenceId
  }

  fun setRegisteredSignature(context: Context, signature: String) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_REGISTERED_SIGNATURE, signature)
      .apply()
  }

  fun getRegisteredSignature(context: Context): String? {
    return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(KEY_REGISTERED_SIGNATURE, null)
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
