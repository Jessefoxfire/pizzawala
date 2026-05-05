package com.djtranscendence.pizzawala.geofence

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionRequest
import com.google.android.gms.location.DetectedActivity

object ActivityTransitionRegistrar {
  private val TRACKED_ACTIVITIES = listOf(
    DetectedActivity.IN_VEHICLE,
    DetectedActivity.ON_BICYCLE,
    DetectedActivity.ON_FOOT,
    DetectedActivity.WALKING,
    DetectedActivity.RUNNING,
    DetectedActivity.STILL,
  )

  fun hasActivityRecognitionPermission(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
    return ContextCompat.checkSelfPermission(
      context,
      Manifest.permission.ACTIVITY_RECOGNITION
    ) == PackageManager.PERMISSION_GRANTED
  }

  fun getPendingIntent(context: Context): PendingIntent {
    val intent = Intent(context, ActivityTransitionReceiver::class.java)
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    } else {
      PendingIntent.FLAG_UPDATE_CURRENT
    }

    return PendingIntent.getBroadcast(context, 1, intent, flags)
  }

  fun register(context: Context, reason: String) {
    if (!GeofenceRegistrar.hasPlayServices(context)) return
    if (!hasActivityRecognitionPermission(context)) return

    val transitions = buildList {
      TRACKED_ACTIVITIES.forEach { activity ->
        add(
          ActivityTransition.Builder()
            .setActivityType(activity)
            .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER)
            .build()
        )
        add(
          ActivityTransition.Builder()
            .setActivityType(activity)
            .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_EXIT)
            .build()
        )
      }
    }

    val request = ActivityTransitionRequest(transitions)
    val pendingIntent = getPendingIntent(context)
    ActivityRecognition.getClient(context)
      .removeActivityTransitionUpdates(pendingIntent)
      .addOnCompleteListener {
        ActivityRecognition.getClient(context)
          .requestActivityTransitionUpdates(request, pendingIntent)
          .addOnSuccessListener {
            GeofencePrefs.setLastActivitySignal(
              context,
              "registered|$reason|${System.currentTimeMillis()}"
            )
          }
          .addOnFailureListener { error ->
            val message = error.message ?: error.javaClass.simpleName
            GeofencePrefs.setLastRegistrationError(
              context,
              "activity-transition: $message"
            )
          }
      }
  }

  fun unregister(context: Context) {
    ActivityRecognition.getClient(context)
      .removeActivityTransitionUpdates(getPendingIntent(context))
      .addOnSuccessListener {
        GeofencePrefs.setLastActivitySignal(
          context,
          "removed|${System.currentTimeMillis()}"
        )
      }
  }
}
