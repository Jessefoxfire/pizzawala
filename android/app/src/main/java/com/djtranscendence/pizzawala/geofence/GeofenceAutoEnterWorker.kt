package com.djtranscendence.pizzawala.geofence

import android.content.Context
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

/** Remain inside 5 minutes before automatic start or resume. Repeated ENTER keeps the original timer. */
class GeofenceAutoEnterWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  companion object {
    private const val UNIQUE_PREFIX = "auto_enter_"

    fun schedule(context: Context, geofenceId: String, action: String) {
      if (geofenceId.isBlank()) return
      val pending = GeofencePrefs.getPendingAutoAction(context, geofenceId)
      if (pending == action) return
      GeofencePrefs.setPendingAutoAction(context, geofenceId, action)
      val request = OneTimeWorkRequestBuilder<GeofenceAutoEnterWorker>()
        .setInitialDelay(GeofenceShiftEligibility.AUTO_DELAY_MINUTES, TimeUnit.MINUTES)
        .setInputData(
          workDataOf(
            "geofenceId" to geofenceId,
            "action" to action,
          )
        )
        .build()
      WorkManager.getInstance(context).enqueueUniqueWork(
        UNIQUE_PREFIX + geofenceId,
        if (pending.isNullOrBlank()) ExistingWorkPolicy.KEEP else ExistingWorkPolicy.REPLACE,
        request
      )
    }

    fun cancel(context: Context, geofenceId: String) {
      if (geofenceId.isBlank()) return
      val pending = GeofencePrefs.getPendingAutoAction(context, geofenceId)
      if (pending == "start" || pending == "resume") {
        GeofencePrefs.setPendingAutoAction(context, geofenceId, null)
      }
      WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_PREFIX + geofenceId)
    }
  }

  override fun doWork(): Result {
    val geofenceId = inputData.getString("geofenceId") ?: return Result.success()
    val action = inputData.getString("action") ?: "start"
    if (!GeofencePrefs.consumePendingAutoAction(applicationContext, geofenceId, action)) {
      return Result.success()
    }
    val name = GeofencePrefs.getGeofenceName(applicationContext, geofenceId)
    if (action == "resume") {
      if (!GeofencePrefs.isShiftActive(applicationContext) || !GeofencePrefs.isShiftPaused(applicationContext)) {
        return Result.success()
      }
      if (!GeofencePrefs.isCurrentShiftWorksite(applicationContext, geofenceId)) {
        return Result.success()
      }
      if (!GeofencePrefs.isAutomaticBreak(applicationContext)) return Result.success()
      if (!ShiftOngoingStore.applyResume(applicationContext)) return Result.success()
      GeofencePrefs.setShiftPaused(applicationContext, false)
      GeofencePrefs.setBreakSource(applicationContext, null)
      GeofencePrefs.setAutoBreakArmed(applicationContext, true)
      GeofencePrefs.setConfirmedAwayForVisit(applicationContext, geofenceId, false)
      ShiftOngoingService.postCurrent(applicationContext)
      GeofenceNotifier.cancelAllWorksitePrompts(applicationContext)
      GeofenceShiftActions.dispatch(applicationContext, "resume", geofenceId, name)
      return Result.success()
    }

    if (GeofencePrefs.isShiftActive(applicationContext)) return Result.success()
    if (GeofencePrefs.isCutoffReached(applicationContext) || ShiftOngoingStore.isCutoff(applicationContext)) {
      return Result.success()
    }
    GeofencePrefs.setConfirmedAwayForVisit(applicationContext, geofenceId, false)
    GeofencePrefs.setEnterHandledForVisit(applicationContext, geofenceId, true)
    GeofencePrefs.setAutoBreakArmed(applicationContext, true)
    GeofenceShiftActions.dispatch(applicationContext, "start", geofenceId, name)
    return Result.success()
  }
}
