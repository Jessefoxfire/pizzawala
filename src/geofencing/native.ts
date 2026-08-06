import { NativeEventEmitter, NativeModules } from 'react-native';
import type { Geofence } from '../types';
import type { GeofenceEventType } from './types';

const { GeofenceModule } = NativeModules as {
  GeofenceModule?: {
    getAvailability: () => Promise<{ available: boolean; isEmulator: boolean; hasPlayServices?: boolean }>;
    getStatus?: () => Promise<NativeGeofenceStatus>;
    getStoredGeofenceSpecs?: () => Promise<NativeStoredGeofenceSpec[]>;
    startMonitoring: (geofences: Array<Record<string, unknown>>) => Promise<void>;
    stopMonitoring: () => Promise<void>;
    initGeofencing?: () => Promise<void>;
    openBatteryExemptionUi?: () => Promise<void>;
    setUserName?: (name: string) => void;
    setNotificationsEnabled?: (enabled: boolean) => Promise<boolean>;
    getNotificationsEnabled?: () => Promise<boolean>;
    setAutoShiftEnabled?: (enabled: boolean) => void;
    setSuppressEnterWhileOnShift?: (suppressed: boolean) => void;
  };
};

export type NativeStoredGeofenceSpec = {
  id: string;
  name?: string;
  latitude: number;
  longitude: number;
  radius: number;
};

const nativeEmitter = GeofenceModule ? new NativeEventEmitter(GeofenceModule as any) : null;

export type NativeGeofenceStatus = {
  hasPlayServices: boolean;
  hasFineLocation: boolean;
  hasBackgroundLocation: boolean;
  hasActivityRecognition: boolean;
  hasNotificationPermission: boolean;
  ignoringBatteryOptimizations: boolean;
  savedGeofenceCount: number;
  lastNativeEvent?: string | null;
  lastActivitySignal?: string | null;
  lastNativeRegistration?: string | null;
  lastNativeRegistrationError?: string | null;
  nativeHistory?: string;
  userName?: string | null;
};

export const getNativeAvailability = async () => {
  if (!GeofenceModule) {
    return { available: false, isEmulator: false, hasPlayServices: false };
  }
  try {
    return await GeofenceModule.getAvailability();
  } catch {
    return { available: false, isEmulator: false, hasPlayServices: false };
  }
};

export const getNativeStatus = async (): Promise<NativeGeofenceStatus | null> => {
  if (!GeofenceModule?.getStatus) {
    return null;
  }
  try {
    return await GeofenceModule.getStatus();
  } catch {
    return null;
  }
};

/** Opens the system UI that sets [ignoringBatteryOptimizations] (not the same as generic “background usage”). */
export const openBatteryExemptionUi = async (): Promise<void> => {
  if (!GeofenceModule?.openBatteryExemptionUi) {
    return;
  }
  await GeofenceModule.openBatteryExemptionUi();
};

/** Unconditional bootstrap of local storage geofences. */
export const initNativeGeofencing = async (): Promise<void> => {
  if (!GeofenceModule?.initGeofencing) {
    return;
  }
  // Sync auto-shift status to native on startup
  const { getAutoShiftEnabled } = require('./storage');
  const auto = await getAutoShiftEnabled();
  setNativeAutoShiftEnabled(auto);

  await GeofenceModule.initGeofencing();
};

export const startNativeMonitoring = async (geofences: Geofence[]) => {
  if (!GeofenceModule) return;
  const activeGeofences = geofences.filter(g => g.active);
  
  if (activeGeofences.length === 0) {
    await GeofenceModule.stopMonitoring();
    return;
  }

  const payload = activeGeofences.map(geofence => ({
    id: geofence.id,
    name: geofence.name,
    latitude: geofence.center.lat,
    longitude: geofence.center.lng,
    // Set Outer Boundary: actual radius + margin, but at least 110m for OS reliability.
    // This makes EXIT triggers much more accurate than forcing 180m/200m.
    radius: Math.max(110, (geofence.radiusMeters || 0) + 20),
  }));
  
  // Sync name during monitoring start to ensure they are together
  const { getLastUserName } = require('./storage');
  const name = await getLastUserName();
  if (name && GeofenceModule?.setUserName) {
    GeofenceModule.setUserName(name);
  }

  await GeofenceModule.startMonitoring(payload);
};

export const stopNativeMonitoring = async () => {
  if (!GeofenceModule) return;
  await GeofenceModule.stopMonitoring();
};

export const setNativeUserName = (name: string) => {
  if (GeofenceModule?.setUserName) {
    GeofenceModule.setUserName(name);
  }
};

export const setNativeNotificationsEnabled = async (enabled: boolean) => {
  if (!GeofenceModule?.setNotificationsEnabled) return false;
  return await GeofenceModule.setNotificationsEnabled(enabled);
};

export const getNativeNotificationsEnabled = async () => {
  if (!GeofenceModule?.getNotificationsEnabled) return true;
  return await GeofenceModule.getNotificationsEnabled();
};

export const setNativeAutoShiftEnabled = (enabled: boolean) => {
  if (GeofenceModule?.setAutoShiftEnabled) {
    GeofenceModule.setAutoShiftEnabled(enabled);
  }
};

export const setNativeSuppressEnterNotifications = async (suppressed: boolean) => {
  if (GeofenceModule?.setSuppressEnterWhileOnShift) {
    GeofenceModule.setSuppressEnterWhileOnShift(suppressed);
  }
};

export const getNativeStoredGeofenceSpecs = async (): Promise<NativeStoredGeofenceSpec[]> => {
  if (!GeofenceModule?.getStoredGeofenceSpecs) {
    return [];
  }
  try {
    const raw = await GeofenceModule.getStoredGeofenceSpecs();
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((item: any) => {
        const id = typeof item?.id === 'string' ? item.id : null;
        const latitude = typeof item?.latitude === 'number' ? item.latitude : null;
        const longitude = typeof item?.longitude === 'number' ? item.longitude : null;
        const radius = typeof item?.radius === 'number' ? item.radius : 120;
        if (!id || latitude == null || longitude == null) {
          return null;
        }
        const name = typeof item?.name === 'string' ? item.name : undefined;
        return { id, name, latitude, longitude, radius: radius > 0 ? radius : 120 };
      })
      .filter(Boolean) as NativeStoredGeofenceSpec[];
  } catch {
    return [];
  }
};


/** Minimal Geofence when JS cache / Firestore snapshot is missing (e.g. cold headless task). */
export const geofenceFromNativeSpec = (spec: NativeStoredGeofenceSpec): Geofence => ({
  id: spec.id,
  name: spec.name ?? spec.id,
  active: true,
  radiusMeters: spec.radius > 0 ? spec.radius : 120,
  center: { lat: spec.latitude, lng: spec.longitude },
  teamId: '',
  createdBy: '',
  createdAt: null,
});

export const resolveGeofenceForNativeEvent = async (
  geofenceId: string,
  cachedList: Geofence[]
): Promise<Geofence | null> => {
  const fromCache = cachedList.find(item => item.id === geofenceId);
  if (fromCache) {
    return fromCache;
  }
  const specs = await getNativeStoredGeofenceSpecs();
  const spec = specs.find(s => s.id === geofenceId);
  if (!spec) {
    return null;
  }
  return geofenceFromNativeSpec(spec);
};

export const subscribeNativeEvents = (
  onEvent: (event: { geofenceId: string; transition: GeofenceEventType; latitude?: number; longitude?: number; timestamp?: number }) => void,
  onSignificantLocationChange: (event: { latitude?: number; longitude?: number; timestamp?: number }) => void
) => {
  if (!nativeEmitter) {
    return () => undefined;
  }
  const eventSub = nativeEmitter.addListener('geofenceEvent', onEvent);
  const locationSub = nativeEmitter.addListener('significantLocationChange', onSignificantLocationChange);
  return () => {
    eventSub.remove();
    locationSub.remove();
  };
};

export const shouldUseJsFallback = (availability: { available: boolean; isEmulator: boolean; hasPlayServices?: boolean }) => {
  const flag = (globalThis as any)?.USE_JS_GEOFENCE === true;

  if (flag) return true;
  if (!availability.available) return true;
  if (availability.hasPlayServices === false) return true;
  return false;
};
