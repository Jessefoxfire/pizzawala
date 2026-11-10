package com.djtranscendence.pizzawala.geofence

import android.content.Context
import android.content.Intent
import com.facebook.react.HeadlessJsTaskService

object GeofenceShiftActions {
  fun dispatch(
    context: Context,
    action: String,
    geofenceId: String? = null,
    geofenceName: String? = null,
    breakSource: String? = null,
  ) {
    val shiftId = GeofencePrefs.getShiftId(context)
    val serviceIntent = Intent(context, GeofenceEventService::class.java).apply {
      putExtra("type", "shift_action")
      putExtra("action", action)
      if (!shiftId.isNullOrBlank()) putExtra("shiftId", shiftId)
      if (!geofenceId.isNullOrBlank()) putExtra("geofenceId", geofenceId)
      if (!geofenceName.isNullOrBlank()) putExtra("geofenceName", geofenceName)
      if (!breakSource.isNullOrBlank()) putExtra("breakSource", breakSource)
    }
    try {
      GeofenceHeadlessFg.startEventService(context, serviceIntent)
      HeadlessJsTaskService.acquireWakeLockNow(context)
    } catch (_: Exception) {
      GeofencePrefs.appendNativeHistory(context, "shift_action|headless_failed|$action")
    }
  }

  fun dispatchCutoff(context: Context, recordedAtMs: Long, shiftId: String?) {
    val serviceIntent = Intent(context, GeofenceEventService::class.java).apply {
      putExtra("type", "shift_action")
      putExtra("action", "cutoff")
      putExtra("recordedAtMs", recordedAtMs)
      if (!shiftId.isNullOrBlank()) putExtra("shiftId", shiftId)
    }
    try {
      GeofenceHeadlessFg.startEventService(context, serviceIntent)
      HeadlessJsTaskService.acquireWakeLockNow(context)
    } catch (_: Exception) {
      GeofencePrefs.appendNativeHistory(context, "shift_action|headless_failed|cutoff")
    }
  }
}
