package com.djtranscendence.pizzawala.geofence

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.djtranscendence.pizzawala.MainActivity
import com.djtranscendence.pizzawala.R
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object GeofenceNotifier {
  private const val CHANNEL_ID = "geofence-updates"
  private const val CHANNEL_NAME = "Worksite updates"
  
  // Dedup: prevents "multiple notifications" for same event
  private val lastAlerts = mutableMapOf<String, Long>()

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val existing = manager.getNotificationChannel(CHANNEL_ID)
    if (existing != null) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      CHANNEL_NAME,
      NotificationManager.IMPORTANCE_HIGH
    )
    manager.createNotificationChannel(channel)
  }

  fun notifyTransition(context: Context, geofenceId: String, transition: String, originalTs: Long? = null) {
    if (!GeofencePrefs.isNotificationsEnabled(context)) {
      android.util.Log.d("GeofenceNotifier", "Notifications disabled by user preference. Skipping.")
      return
    }
    ensureChannel(context)
    if (Build.VERSION.SDK_INT >= 33) {
      val granted = androidx.core.content.ContextCompat.checkSelfPermission(
        context, Manifest.permission.POST_NOTIFICATIONS
      ) == PackageManager.PERMISSION_GRANTED
      if (!granted) return
    }

    // Dedup only for immediate events, not for the delayed exit one which is unique
    if (originalTs == null) {
      val alertKey = transition
      val now = System.currentTimeMillis()
      val lastTime = lastAlerts[alertKey] ?: 0L
      if (now - lastTime < 60000) { // 60s dedup window across all geofences
          return
      }
      lastAlerts[alertKey] = now
    }

    val name = GeofencePrefs.getGeofenceName(context, geofenceId) ?: geofenceId
    val userName = GeofencePrefs.getUserName(context)
    val firstName = userName?.split(" ")?.get(0) ?: "Team member"
    
    val isDelayedExit = transition == "exit" && originalTs != null
    
    val body = if (isDelayedExit) {
      "Hi $firstName, you left the worksite $name 30 minutes ago? Stop shift?"
    } else {
      val action = when (transition) {
        "enter" -> "entered"
        "exit" -> "left"
        "dwell" -> "arrived at"
        else -> transition
      }
      val isAuto = GeofencePrefs.isAutoShiftEnabled(context)
      if (isAuto) {
        if (transition == "exit") {
          "You have left the $name worksite, but your shift will continue until you have been away for 30 minutes. At that point, your shift will be recorded as ending 30 minutes ago."
        } else {
          "Hi $firstName, you have $action the worksite $name."
        }
      } else {
        val prompt = if (transition == "enter") "start" else "end"
        "You have $action the worksite $name. Would you like to $prompt your shift? If so, click here."
      }
    }

    val intent = Intent(context, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
      putExtra("screen", "Shift")
      if (isDelayedExit) {
        putExtra("action", "stop_shift_at")
        putExtra("endTime", originalTs)
      }
    }
    
    val pendingIntent = PendingIntent.getActivity(
      context, 
      geofenceId.hashCode(), 
      intent, 
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_UPDATE_CURRENT
    )

    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("Hi $firstName")
      .setContentText(body)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setVibrate(longArrayOf(0, 500, 200, 500))
      .setContentIntent(pendingIntent)
      .setAutoCancel(true)

    if (isDelayedExit) {
      // Add a direct action button for "Stop shift"
      val stopIntent = Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        putExtra("screen", "Shift")
        putExtra("action", "stop_shift_at")
        putExtra("endTime", originalTs)
      }
      val stopPendingIntent = PendingIntent.getActivity(
        context,
        geofenceId.hashCode() + 1,
        stopIntent,
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_UPDATE_CURRENT
      )
      builder.addAction(0, "STOP SHIFT", stopPendingIntent)
    }

    val notification = builder.build()

    val notificationId = if (isDelayedExit && geofenceId != null) {
      geofenceId.hashCode()
    } else {
      (System.currentTimeMillis() % Int.MAX_VALUE).toInt()
    }
    NotificationManagerCompat.from(context).notify(notificationId, notification)
  }
}
