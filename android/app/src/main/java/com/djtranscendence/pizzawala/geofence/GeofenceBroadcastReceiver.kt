package com.djtranscendence.pizzawala.geofence

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.HeadlessJsTaskService
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent

class GeofenceBroadcastReceiver : BroadcastReceiver() {
  companion object {
    private const val TAG = "GeofenceReceiver"
  }

  override fun onReceive(context: Context, intent: Intent) {
    Log.d(TAG, "onReceive: ${intent.action}")

    val event = com.google.android.gms.location.GeofencingEvent.fromIntent(intent)
    if (event == null) {
        // Check if it's a location update (stimulant or boosted)
        val locationResult = com.google.android.gms.location.LocationResult.extractResult(intent)
        if (locationResult != null) {
            val loc = locationResult.lastLocation ?: return
            Log.d(TAG, "Native location update: ${loc.latitude}, ${loc.longitude} (accuracy: ${loc.accuracy})")
            
            // 1. Emit to foreground JS if active
            val map = com.facebook.react.bridge.Arguments.createMap().apply {
                putDouble("latitude", loc.latitude)
                putDouble("longitude", loc.longitude)
                putDouble("timestamp", loc.time.toDouble())
                putDouble("accuracy", loc.accuracy.toDouble())
            }
            GeofenceModule.emitSignificantLocationChange(map)

            // 2. Wake up Headless JS if background (optional, but good for "Auto-Shift" accuracy)
            val serviceIntent = Intent(context, GeofenceEventService::class.java).apply {
                putExtra("type", "location")
                putExtra("latitude", loc.latitude)
                putExtra("longitude", loc.longitude)
                putExtra("accuracy", loc.accuracy)
                putExtra("timestamp", loc.time)
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ContextCompat.startForegroundService(context, serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
            } catch (_: Exception) {}
        }
        return
    }

    if (event.hasError()) {
      Log.e(TAG, "GeofencingEvent error: ${event.errorCode}")
      GeofencePrefs.appendNativeHistory(context, "error|${event.errorCode}|${System.currentTimeMillis()}")
      return
    }

    val transitionRaw = event.geofenceTransition
    val transition = when (transitionRaw) {
      Geofence.GEOFENCE_TRANSITION_ENTER -> "enter"
      Geofence.GEOFENCE_TRANSITION_EXIT -> "exit"
      else -> null
    } ?: return

    val location = event.triggeringLocation
    val geofences = event.triggeringGeofences ?: return
    val ts = System.currentTimeMillis()

    geofences.forEach { geofence ->
      val geofenceId = geofence.requestId
      
      // 1. IMMEDIATE NATIVE HANDLING
      if (transition == "enter") {
        GeofenceExitWorker.cancel(context, geofenceId)
        if (!GeofencePrefs.isSuppressEnterWhileOnShift(context)) {
          GeofenceNotifier.notifyTransition(context, geofenceId, transition)
        }
      } else if (transition == "exit") {
        GeofenceExitWorker.schedule(context, geofenceId, ts)
      }
      
      GeofencePrefs.appendNativeHistory(context, "event|$transition|$geofenceId|$ts")
      
      // BOOST ACCURACY NATIVELY (Kill reliance on RN geolocation watch)
      GeofenceMonitorService.boostAccuracy(context)

      // 2. WAKE UP JS LAYER (Tied to Foreground Service in GeofenceEventService)
      val serviceIntent = Intent(context, GeofenceEventService::class.java).apply {
        putExtra("geofenceId", geofenceId)
        putExtra("transition", transition)
        if (location != null) {
          putExtra("latitude", location.latitude)
          putExtra("longitude", location.longitude)
        }
        putExtra("timestamp", ts)
      }

      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          ContextCompat.startForegroundService(context, serviceIntent)
        } else {
          context.startService(serviceIntent)
        }
        HeadlessJsTaskService.acquireWakeLockNow(context)
      } catch (e: Exception) {
        Log.e(TAG, "Failed to start Headless task", e)
        try { context.startService(serviceIntent) } catch(_: Exception) {}
      }
    }
  }
}

