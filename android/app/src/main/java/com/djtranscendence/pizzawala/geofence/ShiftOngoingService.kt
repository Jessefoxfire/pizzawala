package com.djtranscendence.pizzawala.geofence

import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationManagerCompat

class ShiftOngoingService : Service() {
  companion object {
    const val ACTION_SYNC = "com.djtranscendence.pizzawala.SHIFT_ONGOING_SYNC"
    const val ACTION_STOP = "com.djtranscendence.pizzawala.SHIFT_ONGOING_STOP"
    const val EXTRA_MODE = "mode"
    const val EXTRA_PERIOD_START_MS = "periodStartMs"
    const val EXTRA_BASE_ELAPSED_MS = "baseElapsedMs"

    fun sync(context: Context, mode: String, periodStartMs: Long, baseElapsedMs: Long) {
      ShiftOngoingStore.save(context, mode, periodStartMs, baseElapsedMs)
      val intent = Intent(context, ShiftOngoingService::class.java).apply {
        action = ACTION_SYNC
        putExtra(EXTRA_MODE, mode)
        putExtra(EXTRA_PERIOD_START_MS, periodStartMs)
        putExtra(EXTRA_BASE_ELAPSED_MS, baseElapsedMs)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      ShiftOngoingStore.clear(context)
      GeofenceMonitorService.stop(context)
      context.stopService(Intent(context, ShiftOngoingService::class.java))
      NotificationManagerCompat.from(context).cancel(ShiftOngoingStore.NOTIFICATION_ID)
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private val tick = object : Runnable {
    override fun run() {
      if (!ShiftOngoingStore.isActive(this@ShiftOngoingService)) return
      postNotification()
      handler.postDelayed(this, 1000L)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    enterForeground()
    getSystemService(NotificationManager::class.java)?.cancel(92001)
    getSystemService(NotificationManager::class.java)?.cancel(92002)
    handler.post(tick)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP || !ShiftOngoingStore.isActive(this)) {
      stopSelf()
      return START_NOT_STICKY
    }
    enterForeground()
    return START_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(tick)
    super.onDestroy()
  }

  private fun enterForeground() {
    val notification = ShiftOngoingStore.buildNotification(this)
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(
        ShiftOngoingStore.NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
      )
    } else {
      startForeground(ShiftOngoingStore.NOTIFICATION_ID, notification)
    }
  }

  private fun postNotification() {
    val mgr = getSystemService(NotificationManager::class.java) ?: return
    mgr.notify(ShiftOngoingStore.NOTIFICATION_ID, ShiftOngoingStore.buildNotification(this))
  }
}
