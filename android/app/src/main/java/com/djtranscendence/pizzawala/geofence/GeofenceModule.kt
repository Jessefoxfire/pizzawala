package com.djtranscendence.pizzawala.geofence

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability

class GeofenceModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  init {
    activeInstance = this
    // Bootstrap geofencing instantly from local storage
    // MOVED: Don't register in init; wait for js_init or app-start to avoid early context issues.
  }

  override fun getName(): String = "GeofenceModule"

  @ReactMethod
  fun initGeofencing(promise: Promise?) {
    GeofenceRegistrar.registerStoredGeofences(reactContext, "js_init")
    promise?.resolve(true)
  }

  @ReactMethod
  fun getAvailability(promise: Promise) {
    val availability = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(reactContext)
    val hasPlayServices = availability == ConnectionResult.SUCCESS
    val isEmulator = isProbablyEmulator()

    val map = Arguments.createMap().apply {
      putBoolean("available", hasPlayServices)
      putBoolean("isEmulator", isEmulator)
      putBoolean("hasPlayServices", hasPlayServices)
    }

    promise.resolve(map)
  }

  @ReactMethod
  fun getPendingAction(promise: Promise) {
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.resolve(null)
      return
    }
    
    val intent = activity.intent
    if (intent == null) {
      promise.resolve(null)
      return
    }
    
    val action = intent.getStringExtra("action")
    val endTime = intent.getLongExtra("endTime", 0L)
    
    if (action != null) {
      val map = Arguments.createMap().apply {
        putString("action", action)
        if (endTime != 0L) putDouble("endTime", endTime.toDouble())
      }
      // Clear intent extras after reading
      intent.removeExtra("action")
      intent.removeExtra("endTime")
      promise.resolve(map)
    } else {
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    val powerManager = reactContext.getSystemService(PowerManager::class.java)
    val saved = GeofencePrefs.loadGeofences(reactContext)
    val map = Arguments.createMap().apply {
      putBoolean("hasPlayServices", GeofenceRegistrar.hasPlayServices(reactContext))
      putBoolean("hasFineLocation", GeofenceRegistrar.hasFineLocation(reactContext))
      putBoolean("hasBackgroundLocation", GeofenceRegistrar.hasBackgroundLocation(reactContext))
      putBoolean("hasActivityRecognition", ActivityTransitionRegistrar.hasActivityRecognitionPermission(reactContext))
      putBoolean("hasNotificationPermission", GeofenceRegistrar.hasNotificationPermission(reactContext))
      putBoolean("ignoringBatteryOptimizations", powerManager?.isIgnoringBatteryOptimizations(reactContext.packageName) == true)
      putInt("savedGeofenceCount", saved.size)
      putString("lastNativeEvent", GeofencePrefs.getLastEvent(reactContext))
      putString("lastActivitySignal", GeofencePrefs.getLastActivitySignal(reactContext))
      putString("lastNativeRegistration", GeofencePrefs.getLastRegistration(reactContext))
      putString("lastNativeRegistrationError", GeofencePrefs.getLastRegistrationError(reactContext))
      putString("nativeHistory", GeofencePrefs.getNativeHistory(reactContext))
      putString("userName", GeofencePrefs.getUserName(reactContext))
    }
    promise.resolve(map)
  }

  /**
   * Opens the screen that actually flips [PowerManager.isIgnoringBatteryOptimizations] for this app.
   * OEM “background usage” toggles alone often do not set that flag.
   */
  @ReactMethod
  fun openBatteryExemptionUi(promise: Promise) {
    try {
      val intent =
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
          data = Uri.parse("package:${reactContext.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      reactContext.startActivity(intent)
      promise.resolve(null)
    } catch (_: Exception) {
      try {
        val fallback =
          Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
        reactContext.startActivity(fallback)
        promise.resolve(null)
      } catch (fallback: Exception) {
        promise.reject("BATTERY_UI_FAILED", fallback.message, fallback)
      }
    }
  }

  @ReactMethod
  fun getStoredGeofenceSpecs(promise: Promise) {
    try {
      val saved = GeofencePrefs.loadGeofences(reactContext)
      val arr: WritableArray = Arguments.createArray()
      for (spec in saved) {
        val m = Arguments.createMap().apply {
          putString("id", spec.id)
          if (spec.name != null) {
            putString("name", spec.name)
          }
          putDouble("latitude", spec.latitude)
          putDouble("longitude", spec.longitude)
          putDouble("radius", spec.radius)
        }
        arr.pushMap(m)
      }
      promise.resolve(arr)
    } catch (error: Exception) {
      promise.reject("GEOFENCE_SPECS_FAILED", error)
    }
  }

  @ReactMethod
  fun startMonitoring(geofences: ReadableArray, promise: Promise) {
    try {
      val specs = mutableListOf<StoredGeofenceSpec>()
      for (i in 0 until geofences.size()) {
        val item = geofences.getMap(i) ?: continue
        val id = item.getString("id") ?: continue
        val name = if (item.hasKey("name")) item.getString("name") else null
        val latitude = if (item.hasKey("latitude")) item.getDouble("latitude") else null
        val longitude = if (item.hasKey("longitude")) item.getDouble("longitude") else null
        val radius = if (item.hasKey("radius")) item.getDouble("radius") else 150.0

        if (latitude == null || longitude == null) continue

        val clampedRadius = if (radius >= 100.0) radius else 100.0

        specs.add(
          StoredGeofenceSpec(
            id = id,
            name = name,
            latitude = latitude,
            longitude = longitude,
            radius = clampedRadius,
          )
        )
      }

      GeofencePrefs.saveGeofences(reactContext, specs)
      GeofenceRegistrar.registerGeofences(reactContext, specs, "react-native") { success, error ->
        if (success) {
          promise.resolve(null)
        } else {
          promise.reject("GEOFENCE_ADD_FAILED", error ?: "Failed to register geofences")
        }
      }
    } catch (error: Exception) {
      promise.reject("GEOFENCE_SETUP_FAILED", error)
    }
  }

  @ReactMethod
  fun stopMonitoring(promise: Promise) {
    GeofenceRegistrar.removeGeofences(reactContext) { success, error ->
      if (success) {
        promise.resolve(null)
      } else {
        promise.reject("GEOFENCE_REMOVE_FAILED", error ?: "Failed to remove geofences")
      }
    }
  }

  @ReactMethod
  fun setUserName(name: String) {
    GeofencePrefs.saveUserName(reactContext, name)
    android.util.Log.d("GeofenceModule", "User name synced: $name")
  }

  @ReactMethod
  fun setNotificationsEnabled(enabled: Boolean, promise: Promise) {
    GeofencePrefs.setNotificationsEnabled(reactContext, enabled)
    promise.resolve(true)
  }

  @ReactMethod
  fun getNotificationsEnabled(promise: Promise) {
    promise.resolve(GeofencePrefs.isNotificationsEnabled(reactContext))
  }

  @ReactMethod
  fun setAutoShiftEnabled(enabled: Boolean) {
     GeofencePrefs.setAutoShiftEnabled(reactContext, enabled)
  }

  @ReactMethod
  fun setSuppressEnterWhileOnShift(suppressed: Boolean) {
    GeofencePrefs.setSuppressEnterWhileOnShift(reactContext, suppressed)
  }

  private fun isProbablyEmulator(): Boolean {
    return Build.FINGERPRINT.startsWith("generic") ||
      Build.FINGERPRINT.startsWith("unknown") ||
      Build.MODEL.contains("google_sdk") ||
      Build.MODEL.contains("Emulator") ||
      Build.MODEL.contains("Android SDK built for x86") ||
      Build.BRAND.startsWith("generic") && Build.DEVICE.startsWith("generic") ||
      "google_sdk" == Build.PRODUCT
  }

  private fun emitEvent(name: String, params: WritableMap) {
    if (!reactContext.hasActiveCatalystInstance()) return
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(name, params)
  }

  fun emitGeofenceEventToJs(params: WritableMap) {
    emitEvent("geofenceEvent", params)
  }

  fun emitSignificantLocationChangeToJs(params: WritableMap) {
    emitEvent("significantLocationChange", params)
  }

  companion object {
    @Volatile
    private var activeInstance: GeofenceModule? = null

    @JvmStatic
    fun emitGeofenceEvent(params: WritableMap) {
      activeInstance?.emitGeofenceEventToJs(params)
    }

    @JvmStatic
    fun emitSignificantLocationChange(params: WritableMap) {
      activeInstance?.emitSignificantLocationChangeToJs(params)
    }
  }
}
