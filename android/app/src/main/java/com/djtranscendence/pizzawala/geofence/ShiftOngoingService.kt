package com.djtranscendence.pizzawala.geofence

import android.Manifest
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * Publishes shift state without starting a location foreground service.
 *
 * The notification's system chronometer keeps moving without a one-second app timer, and a
 * manual clock-in therefore remains completely independent of location permission.
 */
object ShiftOngoingService {
  private const val REFRESH_REQUEST_CODE = 92011
  private const val REFRESH_INTERVAL_MS = 60_000L

  fun sync(context: Context, mode: String, periodStartMs: Long, baseElapsedMs: Long) {
    val appContext = context.applicationContext
    ShiftOngoingStore.save(appContext, mode, periodStartMs, baseElapsedMs)
    scheduleRefresh(appContext)
    postNotification(appContext)
  }

  fun refresh(context: Context) {
    val appContext = context.applicationContext
    if (!ShiftOngoingStore.isActive(appContext)) {
      cancelRefresh(appContext)
      return
    }
    postNotification(appContext)
  }

  fun restoreIfActive(context: Context) {
    val appContext = context.applicationContext
    if (!ShiftOngoingStore.isActive(appContext)) return
    scheduleRefresh(appContext)
    postNotification(appContext)
  }

  private fun postNotification(context: Context) {
    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
        PackageManager.PERMISSION_GRANTED
    ) {
      return
    }
    NotificationManagerCompat.from(context).notify(
      ShiftOngoingStore.NOTIFICATION_ID,
      ShiftOngoingStore.buildNotification(context)
    )
  }

  fun stop(context: Context) {
    val appContext = context.applicationContext
    ShiftOngoingStore.clear(appContext)
    cancelRefresh(appContext)
    GeofenceMonitorService.stop(appContext)
    NotificationManagerCompat.from(appContext).cancel(ShiftOngoingStore.NOTIFICATION_ID)
  }

  private fun scheduleRefresh(context: Context) {
    val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return
    alarmManager.cancel(refreshPendingIntent(context))
    alarmManager.setInexactRepeating(
      AlarmManager.ELAPSED_REALTIME,
      SystemClock.elapsedRealtime() + REFRESH_INTERVAL_MS,
      REFRESH_INTERVAL_MS,
      refreshPendingIntent(context)
    )
  }

  private fun cancelRefresh(context: Context) {
    context.getSystemService(AlarmManager::class.java)?.cancel(refreshPendingIntent(context))
  }

  private fun refreshPendingIntent(context: Context): PendingIntent {
    val intent = Intent(context, ShiftOngoingRefreshReceiver::class.java).apply {
      action = "com.djtranscendence.pizzawala.SHIFT_ONGOING_REFRESH"
    }
    return PendingIntent.getBroadcast(
      context,
      REFRESH_REQUEST_CODE,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }
}
