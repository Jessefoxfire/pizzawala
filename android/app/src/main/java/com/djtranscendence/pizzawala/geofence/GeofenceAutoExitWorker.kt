package com.djtranscendence.pizzawala.geofence

import android.content.Context
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

/** Remain outside 5 minutes before automatically starting a break. Repeated EXIT keeps the original timer. */
class GeofenceAutoExitWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  companion object {
    private const val UNIQUE_PREFIX = "auto_exit_"

    fun schedule(context: Context, geofenceId: String) {
      if (geofenceId.isBlank()) return
      if (!GeofenceShiftEligibility.shouldAutoBreakWorkingShift(context, geofenceId)) return
      val pending = GeofencePrefs.getPendingAutoAction(context, geofenceId)
      if (pending == "pause") return
      GeofencePrefs.setPendingAutoAction(context, geofenceId, "pause")
      val request = OneTimeWorkRequestBuilder<GeofenceAutoExitWorker>()
        .setInitialDelay(GeofenceShiftEligibility.AUTO_DELAY_MINUTES, TimeUnit.MINUTES)
        .setInputData(workDataOf("geofenceId" to geofenceId))
        .build()
      WorkManager.getInstance(context).enqueueUniqueWork(
        UNIQUE_PREFIX + geofenceId,
        if (pending.isNullOrBlank()) ExistingWorkPolicy.KEEP else ExistingWorkPolicy.REPLACE,
        request
      )
    }

    fun cancel(context: Context, geofenceId: String) {
      if (geofenceId.isBlank()) return
      if (GeofencePrefs.getPendingAutoAction(context, geofenceId) == "pause") {
        GeofencePrefs.setPendingAutoAction(context, geofenceId, null)
      }
      WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_PREFIX + geofenceId)
    }
  }

  override fun doWork(): Result {
    val geofenceId = inputData.getString("geofenceId") ?: return Result.success()
    if (!GeofencePrefs.consumePendingAutoAction(applicationContext, geofenceId, "pause")) {
      return Result.success()
    }
    if (!GeofenceShiftEligibility.shouldAutoBreakWorkingShift(applicationContext, geofenceId)) {
      return Result.success()
    }
    if (!ShiftOngoingStore.applyBreak(applicationContext)) return Result.success()
    GeofencePrefs.setShiftPaused(applicationContext, true)
    GeofencePrefs.setBreakSource(applicationContext, "auto")
    GeofencePrefs.setConfirmedAwayForVisit(applicationContext, geofenceId, true)
    GeofenceNotifier.cancelAllWorksitePrompts(applicationContext)
    ShiftOngoingService.postCurrent(applicationContext)
    GeofenceShiftActions.dispatch(applicationContext, "pause", geofenceId, null, "auto")
    return Result.success()
  }
}
