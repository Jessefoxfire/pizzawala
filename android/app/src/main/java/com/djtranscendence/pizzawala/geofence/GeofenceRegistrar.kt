package com.djtranscendence.pizzawala.geofence

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.Priority
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object GeofenceRegistrar {
  fun hasFineLocation(context: Context): Boolean {
    return ContextCompat.checkSelfPermission(
      context,
      Manifest.permission.ACCESS_FINE_LOCATION
    ) == PackageManager.PERMISSION_GRANTED
  }

  fun hasBackgroundLocation(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
    return ContextCompat.checkSelfPermission(
      context,
      Manifest.permission.ACCESS_BACKGROUND_LOCATION
    ) == PackageManager.PERMISSION_GRANTED
  }

  fun hasNotificationPermission(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < 33) return true
    return ContextCompat.checkSelfPermission(
      context,
      Manifest.permission.POST_NOTIFICATIONS
    ) == PackageManager.PERMISSION_GRANTED
  }

  fun hasPlayServices(context: Context): Boolean {
    return GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) ==
      ConnectionResult.SUCCESS
  }

  fun getPendingIntent(context: Context): PendingIntent {
    val intent = Intent(context, GeofenceBroadcastReceiver::class.java)
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
    } else {
      PendingIntent.FLAG_UPDATE_CURRENT
    }

    return PendingIntent.getBroadcast(context, 92005, intent, flags)
  }

  @SuppressLint("MissingPermission")
  fun registerStoredGeofences(
    context: Context,
    reason: String,
    callback: ((Boolean, String?) -> Unit)? = null,
  ) {
    val specs = GeofencePrefs.loadGeofences(context)
    registerGeofences(context, specs, reason, callback)
  }

  @SuppressLint("MissingPermission")
  fun registerGeofences(
    context: Context,
    specs: List<StoredGeofenceSpec>,
    reason: String,
    callback: ((Boolean, String?) -> Unit)? = null,
  ) {
    if (specs.isEmpty()) {
      GeofencePrefs.setLastRegistration(context, "empty|$reason|${System.currentTimeMillis()}")
      callback?.invoke(true, null)
      return
    }

    if (!hasPlayServices(context)) {
      val message = "Google Play Services unavailable"
      GeofencePrefs.setLastRegistrationError(context, message)
      callback?.invoke(false, message)
      return
    }

    if (!hasFineLocation(context) || !hasBackgroundLocation(context)) {
      val message = "Missing fine/background location permission"
      GeofencePrefs.setLastRegistrationError(context, message)
      callback?.invoke(false, message)
      return
    }

    val geofences = specs.map { spec ->
      // Enforce 200m for OS-level reliability
      val finalRadius = Math.max(200f, spec.radius.toFloat())
      
      Geofence.Builder()
        .setRequestId(spec.id)
        .setCircularRegion(spec.latitude, spec.longitude, finalRadius)
        .setTransitionTypes(
          Geofence.GEOFENCE_TRANSITION_ENTER or 
          Geofence.GEOFENCE_TRANSITION_EXIT
        )
        .setExpirationDuration(Geofence.NEVER_EXPIRE)
        .build()
    }

    val request = GeofencingRequest.Builder()
      .setInitialTrigger(
        GeofencingRequest.INITIAL_TRIGGER_ENTER or GeofencingRequest.INITIAL_TRIGGER_EXIT
      )
      .addGeofences(geofences)
      .build()

    val client = LocationServices.getGeofencingClient(context)
    val pendingIntent = getPendingIntent(context)
    client.removeGeofences(pendingIntent).addOnCompleteListener {
      client.addGeofences(request, pendingIntent)
        .addOnSuccessListener {
          GeofencePrefs.setLastRegistration(
            context,
            "ok|$reason|${specs.size}|${System.currentTimeMillis()}"
          )
          ActivityTransitionRegistrar.register(context, reason)
          scheduleWatchdog(context)
          
          // Start the persistent monitoring service
          GeofenceMonitorService.start(context)
          
          callback?.invoke(true, null)
        }
        .addOnFailureListener { error ->
          val message = error.message ?: error.javaClass.simpleName
          GeofencePrefs.setLastRegistrationError(context, message)
          callback?.invoke(false, message)
        }
    }
  }


  fun removeGeofences(context: Context, callback: ((Boolean, String?) -> Unit)? = null) {
    LocationServices.getGeofencingClient(context)
      .removeGeofences(getPendingIntent(context))
      .addOnSuccessListener {
        GeofencePrefs.setLastRegistration(
          context,
          "removed|code_request|${System.currentTimeMillis()}"
        )
        ActivityTransitionRegistrar.unregister(context)
        cancelWatchdog(context)
        
        // Stop the persistent monitoring service
        GeofenceMonitorService.stop(context)
        
        callback?.invoke(true, null)
      }
      .addOnFailureListener { error ->
        val message = error.message ?: error.javaClass.simpleName
        GeofencePrefs.setLastRegistrationError(context, message)
        callback?.invoke(false, message)
      }
  }

  fun scheduleWatchdog(context: Context) {
    val workRequest = PeriodicWorkRequestBuilder<GeofenceWatchdog>(
      15, TimeUnit.MINUTES // High-frequency self-healing (system minimum)
    ).build()

    WorkManager.getInstance(context).enqueueUniquePeriodicWork(
      "geofence_watchdog",
      ExistingPeriodicWorkPolicy.KEEP,
      workRequest
    )
  }

  fun cancelWatchdog(context: Context) {
    WorkManager.getInstance(context).cancelUniqueWork("geofence_watchdog")
  }
}
