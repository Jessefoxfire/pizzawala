package com.djtranscendence.pizzawala.geofence

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.djtranscendence.pizzawala.MainActivity
import com.djtranscendence.pizzawala.R

object ShiftOngoingStore {
  const val NOTIFICATION_ID = 92010
  const val CHANNEL_ID = "pizzawala-shift-ongoing"

  private const val PREFS = "pizzawala_shift_ongoing"
  private const val KEY_ACTIVE = "active"
  private const val KEY_MODE = "mode"
  private const val KEY_PERIOD_START_MS = "period_start_ms"
  private const val KEY_BASE_ELAPSED_MS = "base_elapsed_ms"

  fun isActive(context: Context): Boolean {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ACTIVE, false)
  }

  fun save(context: Context, mode: String, periodStartMs: Long, baseElapsedMs: Long) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(KEY_ACTIVE, true)
      .putString(KEY_MODE, if (mode == "break") "break" else "working")
      .putLong(KEY_PERIOD_START_MS, periodStartMs)
      .putLong(KEY_BASE_ELAPSED_MS, baseElapsedMs.coerceAtLeast(0L))
      .commit()
  }

  fun clear(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
  }

  fun elapsedMs(context: Context, nowMs: Long = System.currentTimeMillis()): Long {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(KEY_ACTIVE, false)) return 0L
    val periodStart = prefs.getLong(KEY_PERIOD_START_MS, nowMs)
    val base = prefs.getLong(KEY_BASE_ELAPSED_MS, 0L)
    return base + (nowMs - periodStart).coerceAtLeast(0L)
  }

  fun label(context: Context): String {
    val mode = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_MODE, "working")
    return if (mode == "break") "Break" else "Working"
  }

  fun formatHms(ms: Long): String {
    val totalSeconds = (ms / 1000L).coerceAtLeast(0L)
    val hours = totalSeconds / 3600L
    val minutes = (totalSeconds % 3600L) / 60L
    val seconds = totalSeconds % 60L
    return String.format("%02d:%02d:%02d", hours, minutes, seconds)
  }

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = context.getSystemService(NotificationManager::class.java) ?: return
    val existing = mgr.getNotificationChannel(CHANNEL_ID)
    if (existing != null) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Shift timer",
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = "Shows your current shift time while you are clocked in."
      setShowBadge(false)
      setSound(null, null)
      enableVibration(false)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    mgr.createNotificationChannel(channel)
  }

  fun buildNotification(context: Context): Notification {
    ensureChannel(context)
    val appCtx = context.applicationContext
    val text = "${label(appCtx)} · ${formatHms(elapsedMs(appCtx))}"
    val launch = Intent(appCtx, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      putExtra("screen", "Home")
    }
    val pending = PendingIntent.getActivity(
      appCtx,
      NOTIFICATION_ID,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    return NotificationCompat.Builder(appCtx, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(appCtx.getString(R.string.app_name))
      .setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(text))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setSound(null)
      .setVibrate(null)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setContentIntent(pending)
      .setShowWhen(false)
      .build()
  }
}
