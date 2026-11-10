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

object GeofenceNotifier {
  private const val CHANNEL_ID = "geofence-updates"
  private const val CHANNEL_NAME = "Worksite updates"
  const val TRANSITION_RETURN = "return"

  fun notificationId(geofenceId: String, transition: String): Int =
    (geofenceId + ":" + transition).hashCode()

  fun cancel(context: Context, geofenceId: String, transition: String) {
    NotificationManagerCompat.from(context).cancel(notificationId(geofenceId, transition))
  }

  fun cancelWorksitePrompts(context: Context, geofenceId: String) {
    cancel(context, geofenceId, "enter")
    cancel(context, geofenceId, "exit")
    cancel(context, geofenceId, TRANSITION_RETURN)
  }

  fun cancelAllWorksitePrompts(context: Context) {
    GeofencePrefs.loadGeofences(context).forEach { cancelWorksitePrompts(context, it.id) }
    val current = GeofencePrefs.getShiftGeofenceId(context)
    if (!current.isNullOrBlank()) cancelWorksitePrompts(context, current)
  }

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

  private fun homeIntent(context: Context, action: String? = null, geofenceId: String? = null, geofenceName: String? = null): Intent {
    return Intent(context, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
      putExtra("screen", "Home")
      if (!action.isNullOrBlank()) putExtra("action", action)
      if (!geofenceId.isNullOrBlank()) putExtra("geofenceId", geofenceId)
      if (!geofenceName.isNullOrBlank()) putExtra("geofenceName", geofenceName)
    }
  }

  private fun pendingFlags(): Int {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    else
      PendingIntent.FLAG_UPDATE_CURRENT
  }

  fun notifyTransition(
    context: Context,
    geofenceId: String,
    transition: String,
    originalTs: Long? = null,
    kind: EnterNotifyKind = EnterNotifyKind.START_SHIFT,
  ) {
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

    val name = GeofencePrefs.getGeofenceName(context, geofenceId) ?: geofenceId
    val userName = GeofencePrefs.getUserName(context)
    val firstName = userName?.split(" ")?.get(0) ?: "Team member"
    val isAuto = GeofencePrefs.isAutoShiftEnabled(context)
    val isReturn = kind == EnterNotifyKind.BREAK_RETURN || transition == TRANSITION_RETURN
    val isDelayedExit = false

    val body = when {
      isReturn -> "You are back at $name."
      transition == "exit" -> "You have left the $name worksite."
      isAuto -> "Hi $firstName, you have entered the worksite $name."
      else -> "You have entered the worksite $name. Would you like to start your shift?"
    }

    val contentIntent = homeIntent(context)
    val pendingIntent = PendingIntent.getActivity(
      context,
      geofenceId.hashCode(),
      contentIntent,
      pendingFlags()
    )

    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("Hi $firstName")
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setVibrate(longArrayOf(0, 500, 200, 500))
      .setContentIntent(pendingIntent)
      .setAutoCancel(true)

    if (transition == "enter" && !isAuto && !isReturn && !isDelayedExit) {
      val ignoreIntent = Intent(context, GeofenceNotificationActionReceiver::class.java).apply {
        action = GeofenceNotificationActionReceiver.ACTION_IGNORE
        putExtra(GeofenceNotificationActionReceiver.EXTRA_GEOFENCE_ID, geofenceId)
        putExtra(GeofenceNotificationActionReceiver.EXTRA_TRANSITION, "enter")
      }
      val startIntent = homeIntent(context, "start_shift", geofenceId, name)
      builder.addAction(
        0,
        "Ignore",
        PendingIntent.getBroadcast(context, geofenceId.hashCode() + 21, ignoreIntent, pendingFlags())
      )
      builder.addAction(
        0,
        "Start",
        PendingIntent.getActivity(context, geofenceId.hashCode() + 22, startIntent, pendingFlags())
      )
    }

    val notifyTransition = if (isReturn) TRANSITION_RETURN else transition
    NotificationManagerCompat.from(context).notify(
      notificationId(geofenceId, notifyTransition),
      builder.build()
    )
  }
}
