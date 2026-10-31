package com.djtranscendence.pizzawala.geofence

import android.content.Context
import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import androidx.work.*
import java.util.concurrent.TimeUnit

class GeofenceExitWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    companion object {
        private const val WORK_TAG = "GeofenceExitWorker"

        fun schedule(context: Context, geofenceId: String, timestamp: Long) {
            val data = Data.Builder()
                .putString("geofenceId", geofenceId)
                .putLong("timestamp", timestamp)
                .build()

            val workRequest = OneTimeWorkRequestBuilder<GeofenceExitWorker>()
                .setInitialDelay(30, TimeUnit.MINUTES)
                .addTag(WORK_TAG)
                .addTag(geofenceId)
                .setInputData(data)
                .build()

            WorkManager.getInstance(context).enqueueUniqueWork(
                "exit_$geofenceId",
                ExistingWorkPolicy.REPLACE,
                workRequest
            )
            android.util.Log.d(WORK_TAG, "Scheduled delayed auto-stop for $geofenceId in 30 minutes")
        }

        fun cancel(context: Context, geofenceId: String) {
            WorkManager.getInstance(context).cancelUniqueWork("exit_$geofenceId")
            android.util.Log.d(WORK_TAG, "Canceled exit notification for $geofenceId")
        }
    }

    override fun doWork(): Result {
        val geofenceId = inputData.getString("geofenceId") ?: return Result.failure()
        val timestamp = inputData.getLong("timestamp", System.currentTimeMillis())
        val autoShiftEnabled = GeofencePrefs.isAutoShiftEnabled(applicationContext)
        GeofencePrefs.appendNativeHistory(
            applicationContext,
            "exit_worker|run|$geofenceId|$timestamp|auto=$autoShiftEnabled"
        )

        if (!autoShiftEnabled) {
            android.util.Log.d(WORK_TAG, "Delayed exit worker idle for $geofenceId (leave already notified)")
            GeofencePrefs.appendNativeHistory(
                applicationContext,
                "exit_worker|idle|$geofenceId|$timestamp"
            )
            return Result.success()
        }

        // Auto-tracking enabled: perform delayed exit handling headlessly without requiring a tap.
        android.util.Log.d(WORK_TAG, "Triggering delayed auto-stop for $geofenceId")
        GeofencePrefs.appendNativeHistory(
            applicationContext,
            "exit_worker|autostop_dispatch|$geofenceId|$timestamp"
        )
        val serviceIntent = Intent(applicationContext, GeofenceEventService::class.java).apply {
            putExtra("type", "geofence")
            putExtra("geofenceId", geofenceId)
            putExtra("transition", "exit")
            putExtra("timestamp", timestamp)
            putExtra("delayed", true)
        }

        return try {
            GeofenceHeadlessFg.startEventService(applicationContext, serviceIntent)
            HeadlessJsTaskService.acquireWakeLockNow(applicationContext)
            GeofencePrefs.appendNativeHistory(
                applicationContext,
                "exit_worker|autostop_started|$geofenceId|$timestamp"
            )
            Result.success()
        } catch (e: Exception) {
            android.util.Log.e(WORK_TAG, "Failed delayed auto-stop, falling back to notification", e)
            GeofencePrefs.appendNativeHistory(
                applicationContext,
                "exit_worker|autostop_failed_fallback_notify|$geofenceId|$timestamp"
            )
            GeofenceNotifier.notifyTransition(applicationContext, geofenceId, "exit", timestamp)
            Result.success()
        }
    }
}
