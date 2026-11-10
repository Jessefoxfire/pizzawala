package com.djtranscendence.pizzawala.geofence

import android.content.Context

enum class EnterNotifyKind {
  NONE,
  START_SHIFT,
  BREAK_RETURN,
}

object GeofenceShiftEligibility {
  const val AUTO_DELAY_MINUTES = 5L

  fun enterNotifyKind(context: Context, geofenceId: String): EnterNotifyKind {
    if (GeofencePrefs.isAutoShiftEnabled(context)) return EnterNotifyKind.NONE
    if (GeofencePrefs.isShiftActive(context)) return EnterNotifyKind.NONE
    if (GeofencePrefs.isCutoffReached(context)) return EnterNotifyKind.NONE
    if (GeofencePrefs.isEnterHandledForVisit(context, geofenceId)) return EnterNotifyKind.NONE
    return EnterNotifyKind.START_SHIFT
  }

  fun enterAutoAction(context: Context, geofenceId: String): String? {
    if (!GeofencePrefs.isAutoShiftEnabled(context)) return null
    if (GeofencePrefs.isCutoffReached(context) || ShiftOngoingStore.isCutoff(context)) return null
    val onShift = GeofencePrefs.isShiftActive(context)
    val paused = GeofencePrefs.isShiftPaused(context)
    val currentSite = GeofencePrefs.isCurrentShiftWorksite(context, geofenceId)
    if (onShift && paused && currentSite && GeofencePrefs.isAutomaticBreak(context)) return "resume"
    if (onShift) return null
    if (GeofencePrefs.isEnterHandledForVisit(context, geofenceId)) return null
    return "start"
  }

  fun shouldNotifyWorkingExit(context: Context, geofenceId: String): Boolean {
    return false
  }

  fun shouldAutoBreakWorkingShift(context: Context, geofenceId: String): Boolean {
    if (!GeofencePrefs.isAutoShiftEnabled(context)) return false
    if (GeofencePrefs.isCutoffReached(context) || ShiftOngoingStore.isCutoff(context)) return false
    if (!GeofencePrefs.isShiftActive(context)) return false
    if (GeofencePrefs.isShiftPaused(context)) return false
    if (!GeofencePrefs.isAutoBreakArmed(context)) return false
    return GeofencePrefs.isCurrentShiftWorksite(context, geofenceId)
  }
}
