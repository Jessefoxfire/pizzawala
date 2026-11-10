package com.djtranscendence.pizzawala

import android.content.Intent
import android.os.Bundle
import com.djtranscendence.pizzawala.geofence.GeofenceNotifier
import com.djtranscendence.pizzawala.geofence.GeofencePrefs
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "PizzaWala"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    consumeGeofenceNotificationIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    consumeGeofenceNotificationIntent(intent)
  }

  private fun consumeGeofenceNotificationIntent(intent: Intent?) {
    val action = intent?.getStringExtra("action") ?: return
    val geofenceId = intent.getStringExtra("geofenceId")
    val geofenceName = intent.getStringExtra("geofenceName")
    GeofencePrefs.setPendingJsAction(this, action, geofenceId, geofenceName)
    if (action == "start_shift" && !geofenceId.isNullOrBlank()) {
      GeofencePrefs.setEnterHandledForVisit(this, geofenceId, true)
      GeofenceNotifier.cancel(this, geofenceId, "enter")
    }
  }
}
