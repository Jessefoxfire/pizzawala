package com.djtranscendence.pizzawala.geofence

import android.content.Context
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

class GeofenceShiftCutoffWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  companion object {
    private const val UNIQUE_NAME = "shift_24h_cutoff"

    fun schedule(context: Context) {
      if (!ShiftOngoingStore.isActive(context) || ShiftOngoingStore.isCutoff(context)) {
        cancel(context)
        return
      }
      val cutoffAt = ShiftOngoingStore.cutoffAtMs(context)
      if (cutoffAt <= 0L) return
      val delay = (cutoffAt - System.currentTimeMillis()).coerceAtLeast(0L)
      val request = OneTimeWorkRequestBuilder<GeofenceShiftCutoffWorker>()
        .setInitialDelay(delay, TimeUnit.MILLISECONDS)
        .build()
      WorkManager.getInstance(context).enqueueUniqueWork(
        UNIQUE_NAME,
        ExistingWorkPolicy.REPLACE,
        request
      )
    }

    fun cancel(context: Context) {
      WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_NAME)
    }
  }

  override fun doWork(): Result {
    if (!ShiftOngoingStore.applyCutoffIfDue(applicationContext)) {
      return Result.success()
    }
    val cutoffAt = ShiftOngoingStore.cutoffAtMs(applicationContext)
    ShiftOngoingService.postCurrent(applicationContext)
    GeofenceNotifier.cancelAllWorksitePrompts(applicationContext)
    val intentExtrasShiftId = GeofencePrefs.getShiftId(applicationContext)
    GeofenceShiftActions.dispatchCutoff(applicationContext, cutoffAt, intentExtrasShiftId)
    return Result.success()
  }
}
