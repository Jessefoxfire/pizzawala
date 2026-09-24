package com.djtranscendence.pizzawala.geofence

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * Publishes shift state without starting a location foreground service.
 *
 * The notification's system chronometer keeps moving without a one-second app timer, and a
 * manual clock-in therefore remains completely independent of location permission.
 */
object ShiftOngoingService {
  fun sync(context: Context, mode: String, periodStartMs: Long, baseElapsedMs: Long) {
    val appContext = context.applicationContext
    ShiftOngoingStore.save(appContext, mode, periodStartMs, baseElapsedMs)
    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      ContextCompat.checkSelfPermission(appContext, Manifest.permission.POST_NOTIFICATIONS) !=
        PackageManager.PERMISSION_GRANTED
    ) {
      return
    }
    NotificationManagerCompat.from(appContext).notify(
      ShiftOngoingStore.NOTIFICATION_ID,
      ShiftOngoingStore.buildNotification(appContext)
    )
  }

  fun stop(context: Context) {
    val appContext = context.applicationContext
    ShiftOngoingStore.clear(appContext)
    GeofenceMonitorService.stop(appContext)
    NotificationManagerCompat.from(appContext).cancel(ShiftOngoingStore.NOTIFICATION_ID)
  }
}
