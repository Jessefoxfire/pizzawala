package com.djtranscendence.pizzawala.geofence

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class GeofenceBootService : HeadlessJsTaskService() {
  override fun onCreate() {
    GeofenceHeadlessFg.start(this)
    super.onCreate()
  }

  override fun onDestroy() {
    super.onDestroy()
    GeofenceHeadlessFg.stop(this)
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val data = Arguments.createMap().apply {
      putString("reason", intent?.getStringExtra("reason") ?: "boot")
      putDouble("timestamp", (intent?.getLongExtra("timestamp", System.currentTimeMillis()) ?: 0L).toDouble())
    }

    return HeadlessJsTaskConfig(
      "GeofenceBoot",
      data,
      30000,
      true
    )
  }
}
