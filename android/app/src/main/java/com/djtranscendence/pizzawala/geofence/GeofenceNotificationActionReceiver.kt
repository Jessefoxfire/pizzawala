package com.djtranscendence.pizzawala.geofence

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.facebook.react.HeadlessJsTaskService

class GeofenceNotificationActionReceiver : BroadcastReceiver() {
  companion object {
    const val ACTION_IGNORE = "com.djtranscendence.pizzawala.geofence.IGNORE_ENTER"
    const val ACTION_IGNORE_BREAK_RETURN = "com.djtranscendence.pizzawala.geofence.IGNORE_BREAK_RETURN"
    const val ACTION_BREAK = "com.djtranscendence.pizzawala.geofence.BREAK"
    const val ACTION_RESUME = "com.djtranscendence.pizzawala.geofence.RESUME"
    const val ACTION_RESTART = "com.djtranscendence.pizzawala.geofence.RESTART"
    const val ACTION_ONGOING_TAP = "com.djtranscendence.pizzawala.geofence.ONGOING_TAP"
    const val EXTRA_GEOFENCE_ID = "geofenceId"
    const val EXTRA_TRANSITION = "transition"
  }

  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_IGNORE -> {
        val geofenceId = intent.getStringExtra(EXTRA_GEOFENCE_ID) ?: return
        GeofencePrefs.setEnterHandledForVisit(context, geofenceId, true)
        GeofenceNotifier.cancel(context, geofenceId, "enter")
      }
      ACTION_IGNORE_BREAK_RETURN -> {
        val geofenceId = intent.getStringExtra(EXTRA_GEOFENCE_ID) ?: return
        GeofenceNotifier.cancel(context, geofenceId, GeofenceNotifier.TRANSITION_RETURN)
      }
      ACTION_BREAK -> applyPause(context)
      ACTION_RESUME, ACTION_RESTART -> applyResume(context, intent.getStringExtra(EXTRA_GEOFENCE_ID))
      ACTION_ONGOING_TAP -> handleOngoingTap(context)
    }
  }

  private fun handleOngoingTap(context: Context) {
    if (!ShiftOngoingStore.isActive(context)) return
    if (ShiftOngoingStore.isCutoff(context)) {
      openHome(context, "open_end_shift")
      return
    }
    if (!ShiftOngoingStore.actionsRevealed(context)) {
      ShiftOngoingStore.setActionsRevealed(context, true)
      ShiftOngoingService.postCurrent(context)
      return
    }
    ShiftOngoingStore.setActionsRevealed(context, false)
    ShiftOngoingService.postCurrent(context)
    openHome(context, null)
  }

  private fun openHome(context: Context, action: String?) {
    val launch = Intent(context, com.djtranscendence.pizzawala.MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
      putExtra("screen", "Home")
      if (!action.isNullOrBlank()) putExtra("action", action)
    }
    context.startActivity(launch)
  }

  private fun applyPause(context: Context) {
    if (ShiftOngoingStore.isCutoff(context)) return
    if (!GeofencePrefs.isShiftActive(context) || GeofencePrefs.isShiftPaused(context)) return
    if (GeofencePrefs.getPendingShiftAction(context) == "pause") return
    GeofenceAutoExitWorker.cancel(context, GeofencePrefs.getShiftGeofenceId(context) ?: "")
    if (!ShiftOngoingStore.applyBreak(context)) return
    GeofencePrefs.setShiftPaused(context, true)
    GeofencePrefs.setBreakSource(context, "manual")
    GeofencePrefs.setPendingShiftAction(context, "pause")
    GeofenceNotifier.cancelAllWorksitePrompts(context)
    ShiftOngoingService.postCurrent(context)
    dispatchShiftAction(context, "pause", "manual")
  }

  private fun applyResume(context: Context, geofenceId: String?) {
    if (ShiftOngoingStore.isCutoff(context)) return
    if (!GeofencePrefs.isShiftActive(context) || !GeofencePrefs.isShiftPaused(context)) return
    if (GeofencePrefs.getPendingShiftAction(context) == "resume") return
    val siteId = geofenceId ?: GeofencePrefs.getShiftGeofenceId(context)
    GeofenceAutoEnterWorker.cancel(context, siteId ?: "")
    if (!ShiftOngoingStore.applyResume(context)) return
    GeofencePrefs.setShiftPaused(context, false)
    GeofencePrefs.setBreakSource(context, null)
    GeofencePrefs.setPendingShiftAction(context, "resume")
    val outside = siteId.isNullOrBlank() || GeofencePrefs.isConfirmedAwayForVisit(context, siteId)
    if (outside) {
      GeofencePrefs.setAutoBreakArmed(context, false)
    } else {
      GeofencePrefs.setAutoBreakArmed(context, true)
    }
    GeofenceNotifier.cancelAllWorksitePrompts(context)
    ShiftOngoingService.postCurrent(context)
    dispatchShiftAction(context, "resume")
  }

  private fun dispatchShiftAction(context: Context, action: String, breakSource: String? = null) {
    val shiftId = GeofencePrefs.getShiftId(context)
    val serviceIntent = Intent(context, GeofenceEventService::class.java).apply {
      putExtra("type", "shift_action")
      putExtra("action", action)
      if (!shiftId.isNullOrBlank()) putExtra("shiftId", shiftId)
      if (!breakSource.isNullOrBlank()) putExtra("breakSource", breakSource)
    }
    try {
      GeofenceHeadlessFg.startEventService(context, serviceIntent)
      HeadlessJsTaskService.acquireWakeLockNow(context)
    } catch (_: Exception) {
      GeofencePrefs.appendNativeHistory(context, "shift_action|headless_failed|$action")
    }
  }
}
