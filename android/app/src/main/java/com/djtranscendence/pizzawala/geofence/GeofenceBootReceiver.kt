package com.djtranscendence.pizzawala.geofence

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat
import com.facebook.react.HeadlessJsTaskService

class GeofenceBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (
      intent.action != Intent.ACTION_BOOT_COMPLETED &&
      intent.action != Intent.ACTION_LOCKED_BOOT_COMPLETED &&
      intent.action != Intent.ACTION_MY_PACKAGE_REPLACED &&
      intent.action != "android.location.PROVIDERS_CHANGED" &&
      intent.action != "android.intent.action.QUICKBOOT_POWERON" &&
      intent.action != "com.htc.intent.action.QUICKBOOT_POWERON"
    ) return

    val pendingResult = goAsync()
    GeofenceRegistrar.registerStoredGeofences(context, intent.action ?: "boot") { _, _ ->
      pendingResult.finish()
    }

    val serviceIntent = Intent(context, GeofenceBootService::class.java).apply {
      putExtra("reason", "boot")
      putExtra("timestamp", System.currentTimeMillis())
    }
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ContextCompat.startForegroundService(context, serviceIntent)
      } else {
        context.startService(serviceIntent)
      }
    } catch (_: IllegalStateException) {
      context.startService(serviceIntent)
    }
    HeadlessJsTaskService.acquireWakeLockNow(context)
  }
}
