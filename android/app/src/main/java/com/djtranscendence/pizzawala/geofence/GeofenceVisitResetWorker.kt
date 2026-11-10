package com.djtranscendence.pizzawala.geofence

import android.content.Context
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

/** Confirmed leave: reset enter-Ignore flags after five continuous minutes away. */
class GeofenceVisitResetWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  companion object {
    private const val UNIQUE_PREFIX = "visit_reset_"
    private const val DELAY_MINUTES = 5L

    fun schedule(context: Context, geofenceId: String) {
      if (geofenceId.isBlank()) return
      val request = OneTimeWorkRequestBuilder<GeofenceVisitResetWorker>()
        .setInitialDelay(DELAY_MINUTES, TimeUnit.MINUTES)
        .setInputData(workDataOf("geofenceId" to geofenceId))
        .build()
      WorkManager.getInstance(context).enqueueUniqueWork(
        UNIQUE_PREFIX + geofenceId,
        ExistingWorkPolicy.KEEP,
        request
      )
    }

    fun cancel(context: Context, geofenceId: String) {
      if (geofenceId.isBlank()) return
      WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_PREFIX + geofenceId)
    }
  }

  override fun doWork(): Result {
    val geofenceId = inputData.getString("geofenceId") ?: return Result.success()
    GeofencePrefs.setEnterHandledForVisit(applicationContext, geofenceId, false)
    GeofencePrefs.setBreakReturnHandledForVisit(applicationContext, geofenceId, false)
    GeofencePrefs.setExitNotifiedForVisit(applicationContext, geofenceId, false)
    GeofencePrefs.setConfirmedAwayForVisit(applicationContext, geofenceId, true)
    GeofencePrefs.appendNativeHistory(applicationContext, "visit_reset|$geofenceId|${System.currentTimeMillis()}")
    return Result.success()
  }
}
