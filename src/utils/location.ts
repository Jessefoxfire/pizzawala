import BackgroundGeolocation from 'react-native-background-geolocation';

let isConfigured = false;

export function configureBackgroundGeolocation() {
  if (isConfigured) return;

  BackgroundGeolocation.onGeofence(event => {
    console.log('[Geofence]', event.identifier, event.action);
  });

  BackgroundGeolocation.onLocation(location => {
    console.log('[Location]', location.coords);
  });

  BackgroundGeolocation.onMotionChange(event => {
    console.log('[Motion]', event.isMoving);
  });

  BackgroundGeolocation.onEnabledChange(enabled => {
    console.log('[BG Enabled]', enabled);
  });

  BackgroundGeolocation.ready(
    {
      desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
      distanceFilter: 50,
      stopOnTerminate: false,
      startOnBoot: false,
      enableHeadless: true,
      logLevel: BackgroundGeolocation.LOG_LEVEL_VERBOSE,
      debug: false,
    },
    state => {
      console.log('[BG Ready]', state.enabled);
      // DO NOT auto-start here
    }
  );

  isConfigured = true;
}

export function startBackgroundTracking() {
  BackgroundGeolocation.start();
}

export function stopBackgroundTracking() {
  BackgroundGeolocation.stop();
}

export function addGeofence(id: string, latitude: number, longitude: number, radius = 100) {
  return BackgroundGeolocation.addGeofence({
    identifier: id,
    radius,
    latitude,
    longitude,
    notifyOnEntry: true,
    notifyOnExit: true,
    notifyOnDwell: false,
  });
}

export function removeGeofence(id: string) {
  return BackgroundGeolocation.removeGeofence(id);
}

export function removeAllGeofences() {
  return BackgroundGeolocation.removeGeofences();
}
