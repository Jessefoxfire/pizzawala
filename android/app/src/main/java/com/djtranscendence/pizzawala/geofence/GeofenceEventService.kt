package com.djtranscendence.pizzawala.geofence

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class GeofenceEventService : HeadlessJsTaskService() {
  override fun onCreate() {
    GeofenceHeadlessFg.start(this)
    super.onCreate()
  }

  override fun onDestroy() {
    super.onDestroy()
    GeofenceHeadlessFg.stop(this)
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    if (intent == null) return null

    val type = intent.getStringExtra("type") ?: "geofence"
    val latitude = intent.getDoubleExtra("latitude", Double.NaN)
    val longitude = intent.getDoubleExtra("longitude", Double.NaN)
    val timestamp = intent.getLongExtra("timestamp", System.currentTimeMillis())
    val accuracy = intent.getFloatExtra("accuracy", 0f)
    val delayed = intent.getBooleanExtra("delayed", false)

    val data = Arguments.createMap().apply {
      putString("type", type)
      if (!latitude.isNaN() && !longitude.isNaN()) {
        putDouble("latitude", latitude)
        putDouble("longitude", longitude)
      }
      putDouble("timestamp", timestamp.toDouble())
      putDouble("accuracy", accuracy.toDouble())
      
      if (type == "geofence") {
        putString("geofenceId", intent.getStringExtra("geofenceId"))
        putString("transition", intent.getStringExtra("transition"))
        putBoolean("delayed", delayed)
      }
    }

    return HeadlessJsTaskConfig(
      if (type == "location") "SignificantLocationChange" else "GeofenceEvent",
      data,
      600000,
      true
    )
  }
}
