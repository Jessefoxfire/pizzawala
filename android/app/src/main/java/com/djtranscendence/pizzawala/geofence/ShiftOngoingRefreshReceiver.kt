package com.djtranscendence.pizzawala.geofence

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Refreshes the compact elapsed-time label without keeping an app service alive. */
class ShiftOngoingRefreshReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    ShiftOngoingService.refresh(context)
  }
}
