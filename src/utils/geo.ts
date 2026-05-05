// src/utils/geo.ts

import { PermissionsAndroid, Platform, Alert, Linking, NativeModules } from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import { startNativeMonitoring, getNativeStatus, openBatteryExemptionUi } from '../geofencing/native';

const { GeofenceModule } = NativeModules;

export type LatLng = { lat: number; lng: number };

export async function ensureLocationPermission(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    try {
      const status = await Geolocation.requestAuthorization('whenInUse');
      return status === 'granted';
    } catch (error) {
      console.warn('iOS location permission error:', error);
      return false;
    }
  }

  // Android
  const fine = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
  );

  if (fine !== PermissionsAndroid.RESULTS.GRANTED) {
    Alert.alert('Location Permission', 'Please enable location in Settings');
    return false;
  }

  return true;
}

export async function hasLocationPermission(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    // Geolocation-service doesn't have a simple check for iOS without requesting
    // But we can check current status
    return true; // Fallback or implement more thorough iOS check
  }
  return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
}

export async function hasActivityRecognitionPermission(): Promise<boolean> {
  if (Platform.OS !== 'android' || Platform.Version < 29) return true;
  return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION);
}

export async function hasGeofencePermissions(): Promise<boolean> {
  if (Platform.OS === 'ios') return true; // iOS 'always' is handled by request
  if (Platform.OS !== 'android') return true;

  const fine = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  if (!fine) return false;

  if (Platform.Version < 29) return true;

  return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION);
}

export async function ensureGeofencePermissions(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    try {
      const status = await Geolocation.requestAuthorization('always');
      return status === 'granted';
    } catch (error) {
      console.warn('iOS geofence permission error:', error);
      return false;
    }
  }

  if (Platform.OS !== 'android') return true;

  const hasFine = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
  );

  const fine = hasFine
    ? PermissionsAndroid.RESULTS.GRANTED
    : await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );

  if (fine !== PermissionsAndroid.RESULTS.GRANTED) {
    return false;
  }

  // Android 9 and below: fine location is enough for Play Services geofencing.
  if (Platform.Version < 29) {
    return true;
  }

  // Android 10+ (API 29+): geofence enter/exit while the app is not in the foreground
  // requires ACCESS_BACKGROUND_LOCATION.
  const hasBackground = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION
  );
  if (hasBackground) {
    return true;
  }

  const bg = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION
  );
  if (bg === PermissionsAndroid.RESULTS.GRANTED) {
    return true;
  }

  Alert.alert(
    'Background location required',
    'Choose Location → "Allow all the time" so worksite entry and exit work when PizzaWala is in the background or closed.',
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => void Linking.openSettings() },
    ]
  );
  return false;
}

export async function isIgnoringBatteryOptimizations(): Promise<boolean> {
  if (Platform.OS !== 'android' || !GeofenceModule?.getStatus) return true;
  const status = await GeofenceModule.getStatus();
  return status?.ignoringBatteryOptimizations ?? false;
}

export async function checkAndPromptBatteryOptimization() {
  if (Platform.OS !== 'android') return;
  const ignoring = await isIgnoringBatteryOptimizations();
  if (ignoring) return;

  Alert.alert(
    'Bulletproof background alerts',
    'To notify you reliably when the app is closed, you must set PizzaWala to "No restrictions" in the system battery screen. This is separate from generic Battery Saver.',
    [
      { text: 'Later', style: 'cancel' },
      {
        text: 'Allow exemption',
        onPress: () =>
          void openBatteryExemptionUi().catch(() => {
            void Linking.openSettings();
          }),
      },
      { text: 'App settings', onPress: () => void Linking.openSettings() },
    ]
  );
}

export async function isBulletproofMode(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const status = await getNativeStatus();
  if (!status) return false;
  
  // Bulletproof mode means:
  // 1. Ignoring battery optimizations
  // 2. Monitoring service is active (indicated by geofence count > 0 in this context)
  // 3. Proper location permissions
  return (
    status.ignoringBatteryOptimizations &&
    status.hasBackgroundLocation &&
    status.savedGeofenceCount > 0
  );
}

export async function ensureActivityRecognitionPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Platform.Version < 29) return true;

  const hasActivity = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION
  );
  if (hasActivity) {
    return true;
  }

  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

export function normalizeLatLng(value: any): LatLng | null {
  if (!value) return null;

  const lat = typeof value.lat === 'number'
    ? value.lat
    : typeof value.latitude === 'number'
      ? value.latitude
      : null;
  const lng = typeof value.lng === 'number'
    ? value.lng
    : typeof value.longitude === 'number'
      ? value.longitude
      : null;

  if (lat == null || lng == null) return null;
  return { lat, lng };
}

const toRadians = (value: number) => (value * Math.PI) / 180;

export const getDistanceMeters = (from: LatLng, to: LatLng) => {
  const earthRadius = 6371000;
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
};


