package com.djtranscendence.pizzawala.geofence

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class GeofenceWatchdog(appContext: Context, params: WorkerParameters) :
    CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        Log.d("GeofenceWatchdog", "Watchdog checking geofence status...")
        
        // 1. Check if we have specs stored
        val specs = GeofencePrefs.loadGeofences(applicationContext)
        if (specs.isEmpty()) {
            Log.d("GeofenceWatchdog", "No geofences to watch. Skipping.")
            return@withContext Result.success()
        }

        // 2. Perform a re-registration to ensure the system is aware of them.
        // Google's GeofencingClient is idempotent if the same request IDs are used,
        // but re-registering ensures they persist across various OS-level kills.
        GeofenceRegistrar.registerGeofences(applicationContext, specs, "watchdog") { success, error ->
            if (success) {
                Log.d("GeofenceWatchdog", "Watchdog re-registration successful.")
            } else {
                Log.e("GeofenceWatchdog", "Watchdog re-registration failed: $error")
            }
        }

        Result.success()
    }
}
