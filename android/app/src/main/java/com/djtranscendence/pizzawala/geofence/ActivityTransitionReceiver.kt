package com.djtranscendence.pizzawala.geofence

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionResult
import com.google.android.gms.location.DetectedActivity

class ActivityTransitionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (!ActivityTransitionResult.hasResult(intent)) return
    val result = ActivityTransitionResult.extractResult(intent) ?: return

    result.transitionEvents.forEach { event ->
      val activity = activityName(event.activityType)
      val transition = when (event.transitionType) {
        ActivityTransition.ACTIVITY_TRANSITION_ENTER -> "enter"
        ActivityTransition.ACTIVITY_TRANSITION_EXIT -> "exit"
        else -> "unknown"
      }
      val timestamp = System.currentTimeMillis()
      GeofencePrefs.setLastActivitySignal(
        context,
        "$activity|$transition|$timestamp"
      )

      val payload = Arguments.createMap().apply {
        putString("activity", activity)
        putString("transition", transition)
        putDouble("timestamp", timestamp.toDouble())
      }
      GeofenceModule.emitSignificantLocationChange(payload)

      // Background Kick: Refresh geofences when activity changes (especially when starting movement)
      if (activity != "still") {
          GeofenceRegistrar.registerStoredGeofences(context, "activity:$activity")
      }
    }
  }

  private fun activityName(type: Int): String {
    return when (type) {
      DetectedActivity.IN_VEHICLE -> "in_vehicle"
      DetectedActivity.ON_BICYCLE -> "on_bicycle"
      DetectedActivity.ON_FOOT -> "on_foot"
      DetectedActivity.WALKING -> "walking"
      DetectedActivity.RUNNING -> "running"
      DetectedActivity.STILL -> "still"
      else -> "unknown"
    }
  }
}
