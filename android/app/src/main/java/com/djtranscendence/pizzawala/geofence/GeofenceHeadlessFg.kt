package com.djtranscendence.pizzawala.geofence

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import com.djtranscendence.pizzawala.R

/**
 * Headless JS tasks must run in a foreground service on modern Android when started from
 * geofence / boot receivers; otherwise [Context.startService] is blocked or killed quickly.
 * Use the **location** FGS type: dataSync is not appropriate for geofence-triggered work and
 * can be rejected on API 34+ when the app is in the background.
 */
object GeofenceHeadlessFg {
  const val NOTIFICATION_ID: Int = 92001
  private const val CHANNEL_ID = "geofence-headless"

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = context.getSystemService(NotificationManager::class.java) ?: return
    if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
    mgr.createNotificationChannel(
      NotificationChannel(
        CHANNEL_ID,
        "Worksite background sync",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        setShowBadge(false)
      }
    )
  }

  fun start(service: Service) {
    ensureChannel(service)
    val notification: Notification = NotificationCompat.Builder(service, CHANNEL_ID)
      .setContentTitle(service.getString(R.string.app_name))
      .setContentText("Processing worksite event…")
      .setSmallIcon(R.mipmap.ic_launcher)
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
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
      service.stopForeground(Service.STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      service.stopForeground(true)
    }
  }
}
