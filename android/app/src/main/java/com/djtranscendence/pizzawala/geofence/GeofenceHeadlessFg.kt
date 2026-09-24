package com.djtranscendence.pizzawala.geofence

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.djtranscendence.pizzawala.R

/**
 * Headless JS tasks must run in a foreground service on modern Android when started from
 * geofence / boot receivers; otherwise [Context.startService] is blocked or killed quickly.
 * Use the **location** FGS type: dataSync is not appropriate for geofence-triggered work and
 * can be rejected on API 34+ when the app is in the background.
 */
object GeofenceHeadlessFg {
  const val NOTIFICATION_ID: Int = 92001
  private const val CHANNEL_ID = "geofence-headless-min"

  fun startEventService(context: Context, intent: Intent) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && ShiftOngoingStore.isActive(context)) {
        context.startService(intent)
      } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ContextCompat.startForegroundService(context, intent)
      } else {
        context.startService(intent)
      }
    } catch (_: Exception) {
      try {
        context.startService(intent)
      } catch (_: Exception) {
      }
    }
  }

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = context.getSystemService(NotificationManager::class.java) ?: return
    if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
    mgr.createNotificationChannel(
      NotificationChannel(
        CHANNEL_ID,
        "Worksite background sync",
        NotificationManager.IMPORTANCE_MIN
      ).apply {
        setShowBadge(false)
      }
    )
  }

  fun start(service: Service) {
    // Shift timer FGS is already showing; do not post a second title-only notification.
    if (ShiftOngoingStore.isActive(service)) {
      return
    }

    ensureChannel(service)
    val notification: Notification = NotificationCompat.Builder(service, CHANNEL_ID)
      .setContentTitle(service.getString(R.string.app_name))
      .setContentText("")
      .setSmallIcon(R.mipmap.ic_launcher)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setShowWhen(false)
      .build()

    if (Build.VERSION.SDK_INT >= 34) {
      service.startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
      )
    } else {
      service.startForeground(NOTIFICATION_ID, notification)
    }
  }

  fun stop(service: Service) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      val flag =
        if (ShiftOngoingStore.isActive(service)) Service.STOP_FOREGROUND_DETACH
        else Service.STOP_FOREGROUND_REMOVE
      service.stopForeground(flag)
    } else {
      @Suppress("DEPRECATION")
      service.stopForeground(!ShiftOngoingStore.isActive(service))
    }
  }
}
