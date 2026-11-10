package com.djtranscendence.pizzawala.geofence

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

/**
 * A persistent foreground service that keeps the PizzaWala process alive 
 * while geofence monitoring is active. This prevents the OS from suspending 
 * the app and ensures geofences remain "hot".
 */
class GeofenceMonitorService : Service() {
    companion object {
        private const val TAG = "GeofenceMonitor"

        fun start(context: Context) {
            if (!ShiftOngoingStore.isActive(context)) return
            val intent = Intent(context, GeofenceMonitorService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(context, intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, GeofenceMonitorService::class.java)
            context.stopService(intent)
        }

        fun boostAccuracy(context: Context) {
            if (!ShiftOngoingStore.isActive(context)) return
            val intent = Intent(context, GeofenceMonitorService::class.java).apply {
                action = "BOOST_ACCURACY"
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(context, intent)
            } else {
                context.startService(intent)
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Service created.")
        enterForeground()
        requestStimulantUpdates()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand: ${intent?.action}")
        if (intent?.action == "BOOST_ACCURACY") {
            requestHighAccuracyUpdates()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        Log.d(TAG, "Service destroyed. Cleaning up location updates.")
        stopStimulantUpdates()
        val keepPosted = ShiftOngoingStore.isActive(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(if (keepPosted) STOP_FOREGROUND_DETACH else STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(!keepPosted)
        }
        super.onDestroy()
    }

    private fun enterForeground() {
        ShiftOngoingStore.ensureChannel(this)
        val notification = ShiftOngoingStore.buildNotification(this)
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                ShiftOngoingStore.NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            )
        } else {
            startForeground(ShiftOngoingStore.NOTIFICATION_ID, notification)
        }
    }

    private fun requestStimulantUpdates() {
        if (!GeofenceRegistrar.hasFineLocation(this)) return
        
        Log.d(TAG, "Requesting stimulant location updates (5m interval)")
        val locationRequest = LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, 5 * 60 * 1000L)
            .setMinUpdateIntervalMillis(2 * 60 * 1000L)
            .build()

        try {
            LocationServices.getFusedLocationProviderClient(this).requestLocationUpdates(
                locationRequest,
                GeofenceRegistrar.getPendingIntent(this)
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to request stimulant updates", e)
        }
    }

    private fun stopStimulantUpdates() {
        try {
            LocationServices.getFusedLocationProviderClient(this).removeLocationUpdates(
                GeofenceRegistrar.getPendingIntent(this)
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to stop stimulant updates", e)
        }
    }

    private fun requestHighAccuracyUpdates() {
        if (!GeofenceRegistrar.hasFineLocation(this)) return
        
        Log.d(TAG, "Boosting accuracy: PRIORITY_HIGH_ACCURACY, 10s interval")
        val locationRequest = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 10 * 1000L)
            .setMinUpdateIntervalMillis(5 * 1000L)
            .setDurationMillis(5 * 60 * 1000L) // Auto-reset after 5 mins to save battery
            .build()

        try {
            LocationServices.getFusedLocationProviderClient(this).requestLocationUpdates(
                locationRequest,
                GeofenceRegistrar.getPendingIntent(this)
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to boost accuracy", e)
        }
    }
}
