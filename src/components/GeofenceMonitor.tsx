import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import notifee, { AuthorizationStatus } from '@notifee/react-native';
import Geolocation from 'react-native-geolocation-service';
import nativeAuth from '@react-native-firebase/auth';
import {
  collection,
  doc,
  getFirestore,
  onSnapshot,
  query,
} from '@react-native-firebase/firestore';
import type { Geofence } from '../types';
import {
  ensureActivityRecognitionPermission,
  ensureGeofencePermissions,
  ensureLocationPermission,
  checkAndPromptBatteryOptimization,
  normalizeLatLng,
} from '../utils/geo';
import {
  getNativeAvailability,
  resolveGeofenceForNativeEvent,
  shouldUseJsFallback,
  startNativeMonitoring,
  stopNativeMonitoring,
  subscribeNativeEvents,
} from '../geofencing/native';
import {
  cacheGeofences,
  consumePendingPrompt,
  loadCachedGeofences,
  setLastUserId,
  setLastUserName,
  shouldNotifyForEvent,
  getAutoShiftEnabled,
} from '../geofencing/storage';
import { effectiveGeofenceRadiusMeters } from '../geofencing/effectiveRadius';
import { setNativeUserName } from '../geofencing/native';
import { processGeofenceEvent, startShift, endShift } from '../geofencing/processor';
import { showGeofenceNotification } from '../notifications/geofenceNotifications';
import type { GeofencePromptPayload } from '../geofencing/types';
import { normalizeGeofenceTransition } from '../geofencing/transition';
import { navigate } from '../navigation/navigationRef';

const MAX_IOS_GEOFENCES = 20;
const GEOFENCE_ENTER_MARGIN_METERS = 5;
/** Exit when clearly past the nominal radius (avoid requiring radius+margin, which often blocked exit in GPS noise). */
const GEOFENCE_EXIT_MARGIN_METERS = 0;
const MAX_ACCURACY_METERS = 60;

const toRadians = (value: number) => (value * Math.PI) / 180;

const getDistanceMeters = (from: { lat: number; lng: number }, to: { lat: number; lng: number }) => {
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

const pickNearestGeofences = (
  geofences: Geofence[],
  origin: { lat: number; lng: number } | null
) => {
  const active = geofences.filter(item => item?.active !== false);
  if (Platform.OS !== 'ios') {
    return active;
  }

  if (!origin) {
    return [...active].sort((a, b) => a.id.localeCompare(b.id)).slice(0, MAX_IOS_GEOFENCES);
  }

  return [...active]
    .map(item => ({
      geofence: item,
      distance: getDistanceMeters(origin, item.center),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_IOS_GEOFENCES)
    .map(item => item.geofence);
};

export default function GeofenceMonitor() {
  const [userId, setUserId] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [isOnShift, setIsOnShift] = useState(false);
  const [useJsFallback, setUseJsFallback] = useState(false);
  const geofencesRef = useRef<Geofence[]>([]);
  const watchIdRef = useRef<number | null>(null);
  const jsStateRef = useRef<Map<string, boolean>>(new Map());
  const lastNativeRegSigRef = useRef<string>('');
  const useJsFallbackRef = useRef(false);
  const lastNativeEventAtRef = useRef<Map<string, { transition: string; timestamp: number }>>(new Map());

  useEffect(() => {
    useJsFallbackRef.current = useJsFallback;
  }, [useJsFallback]);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = nativeAuth().onAuthStateChanged(user => {
      setUserId(user?.uid ?? null);
      void setLastUserId(user?.uid ?? null);

      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      if (user) {
        unsubProfile = onSnapshot(doc(getFirestore(), 'users', user.uid), snap => {
          if (!snap || !snap.exists()) return;
          const data = snap.data();
          setTeamId((data?.teamId as string) || null);
          setIsOnShift(!!data?.currentShift);
          const name = data?.name;
          if (name) {
            void setLastUserName(name);
            setNativeUserName(name);
          }
        });
      }
    });

    const handleStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        console.log('[GeofenceMonitor] App foregrounded, refreshing registration...');
        refreshNativeRegistration().catch(err => console.error('Auto-refresh failed:', err));
      }
    };

    const subscription = AppState.addEventListener('change', handleStateChange);

    return () => {
      subscription.remove();
      if (unsubProfile) {
        unsubProfile();
      }
      unsubAuth();
    };
  }, []);

  useEffect(() => {
    const seedFromCache = async () => {
      const cached = await loadCachedGeofences();
      if (cached.length > 0) {
        geofencesRef.current = cached;
      }
    };
    void seedFromCache();

    const q = query(collection(getFirestore(), 'geofences'));
    const unsub = onSnapshot(q, snap => {
      if (!snap || !snap.docs) return;
      const items = snap.docs
        .map(d => {
          const data = d.data() as any;
          const center = normalizeLatLng(data.center ?? data.location ?? data.coords);
          if (!center) return null;
          return { id: d.id, ...data, center } as Geofence;
        })
        .filter(Boolean) as Geofence[];
      geofencesRef.current = items;
      void cacheGeofences(items);
      // Removed the !useJsFallback check - we want BOTH running for maximum redundancy.
      if (items.length > 0) {
        void refreshNativeRegistration();
      }
    });

    return () => unsub();
  }, [useJsFallback]);

  useEffect(() => {
    let cleanupNative: () => void = () => {};

    const init = async () => {
      if (!userId) return;
      const hasForegroundLocation = await ensureLocationPermission();
      if (!hasForegroundLocation) {
        console.warn(
          '[GeofenceMonitor] Location permission is required for foreground geofence checks.'
        );
        return;
      }

      try {
        const notifSettings = await notifee.requestPermission({
          alert: true,
          badge: true,
          sound: true,
        });
        const notifyOk =
          notifSettings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
          notifSettings.authorizationStatus === AuthorizationStatus.PROVISIONAL;
        if (!notifyOk) {
          console.warn(
            '[GeofenceMonitor] Notification permission not granted; worksite alerts may be missing.'
          );
        }
      } catch {
        // ignore notification permission failure
      }

      startJsFallback();

      const hasBackgroundLocation = await ensureGeofencePermissions();
      if (!hasBackgroundLocation) {
        setUseJsFallback(true);
        console.warn(
          '[GeofenceMonitor] Background location not granted; foreground geofence checks are active, native background geofencing is disabled.'
        );
        return;
      }
      await ensureActivityRecognitionPermission();
      await checkAndPromptBatteryOptimization();

      const availability = await getNativeAvailability();
      const shouldFallback = shouldUseJsFallback(availability);
      setUseJsFallback(shouldFallback);

      if (shouldFallback) {
        return;
      }

      cleanupNative = subscribeNativeEvents(handleNativeEvent, handleSignificantChange);
      await refreshNativeRegistration();
    };

    init();

    return () => {
      lastNativeRegSigRef.current = '';
      cleanupNative();
      stopJsFallback();
    };
  }, [userId, teamId, isOnShift]);

  useEffect(() => {
    const showPendingPrompt = async () => {
      if (!userId) return;
      const pending = await consumePendingPrompt();
      if (!pending) return;
      navigate('MySchedule', { prompt: pending });
    };
    void showPendingPrompt();
  }, [userId]);

  const nativeRegistrationSignature = (list: Geofence[]) =>
    [...list]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(g => {
        const r = effectiveGeofenceRadiusMeters(g.radiusMeters);
        return `${g.id}:${r}:${g.center.lat.toFixed(5)}:${g.center.lng.toFixed(5)}`;
      })
      .join('|');

  const refreshNativeRegistration = async () => {
    const geofences = geofencesRef.current;
    if (geofences.length === 0) {
      console.log('GeofenceMonitor: Geofences list is empty, skipping registration (preserving previous state if any)');
      return;
    }

    try {
      const location = await getCurrentLocationSafe();
      const nearest = pickNearestGeofences(geofences, location);
      const sig = nativeRegistrationSignature(nearest);
      if (sig === lastNativeRegSigRef.current) {
        return;
      }
      await startNativeMonitoring(nearest);
      lastNativeRegSigRef.current = sig;
    } catch (error) {
      console.warn('Failed to refresh native geofences:', error);
    }
  };

  const refreshNativeRef = useRef(refreshNativeRegistration);
  refreshNativeRef.current = refreshNativeRegistration;

  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next !== 'active' || !userId || useJsFallbackRef.current) return;
      lastNativeRegSigRef.current = '';
      void refreshNativeRef.current();
    });
    return () => sub.remove();
  }, [userId]);

  const handleNativeEvent = async (event: {
    geofenceId: string;
    transition: unknown;
    latitude?: number;
    longitude?: number;
    timestamp?: number;
  }) => {
    const transition = normalizeGeofenceTransition(event.transition);
    if (!transition) {
      console.warn('[GeofenceMonitor] Unknown transition:', event.transition);
      return;
    }
    console.log('[GeofenceMonitor] Native event:', event, 'normalized:', transition);
    if (!userId) return;
    const geofence = await resolveGeofenceForNativeEvent(event.geofenceId, geofencesRef.current);
    if (!geofence) {
      console.warn('[GeofenceMonitor] No geofence metadata for id:', event.geofenceId);
      return;
    }
    if (!geofencesRef.current.some(g => g.id === geofence.id)) {
      geofencesRef.current = [...geofencesRef.current.filter(g => g.id !== geofence.id), geofence];
      void cacheGeofences(geofencesRef.current);
    }

    const result = await processGeofenceEvent({
      userId,
      teamId,
      geofence,
      transition,
      location:
        typeof event.latitude === 'number' && typeof event.longitude === 'number'
          ? { lat: event.latitude, lng: event.longitude }
          : null,
      distanceMeters: null,
      timestamp: event.timestamp,
      source: 'native',
      allowPrompt: true,
    });

    if (transition === 'enter' || transition === 'exit') {
      lastNativeEventAtRef.current.set(event.geofenceId, { transition, timestamp: Date.now() });
    }

    const occurredAt =
      typeof event.timestamp === 'number' && event.timestamp > 0 ? event.timestamp : Date.now();
    const basePayload: GeofencePromptPayload =
      result.promptPayload ?? {
        eventId: result.eventId,
        geofenceId: geofence.id,
        geofenceName: geofence.name || 'Worksite',
        transition,
        occurredAt,
      };

    let didAutoHandle = false;
    if (transition === 'enter' || transition === 'exit') {
      const shouldNotify = await shouldNotifyForEvent(result.eventId);
      const autoShift = await getAutoShiftEnabled();
      const user = nativeAuth().currentUser;

      if (autoShift && user?.uid) {
        didAutoHandle = true;
        if (transition === 'enter') {
          await startShift(user.uid, geofence.id, geofence.name || 'Worksite');
        } else {
          await endShift(user.uid);
        }
        if (shouldNotify) {
          void showGeofenceNotification(basePayload, { variant: 'auto_result' });
        }
      } else if (shouldNotify) {
        void showGeofenceNotification(basePayload, { variant: 'prompt' });
      }
    }

    if (result.promptPayload && !didAutoHandle) {
      navigate('MySchedule', { prompt: result.promptPayload });
    }
  };

  const handleSignificantChange = async () => {
    await refreshNativeRegistration();
  };

  const evaluateJsPosition = async (coords: {
    latitude: number;
    longitude: number;
    accuracy?: number;
  }) => {
    const accuracy = coords.accuracy;
    if (typeof accuracy === 'number' && accuracy > MAX_ACCURACY_METERS) {
      console.log('[GeofenceMonitor] Skipping location: accuracy', accuracy, '>', MAX_ACCURACY_METERS);
      return;
    }

    const current = { lat: coords.latitude, lng: coords.longitude };
    for (const geofence of geofencesRef.current) {
      if (geofence?.active === false) continue;
      const radius = effectiveGeofenceRadiusMeters(geofence.radiusMeters);
      const distanceMeters = getDistanceMeters(current, geofence.center);
      const enterThreshold = radius;
      const exitThreshold = radius + 2;
      const isInside = distanceMeters <= enterThreshold;
      const isOutside = distanceMeters >= exitThreshold;
      const key = `${geofence.id}:inside`;
      const prev = jsStateRef.current.get(key);

      console.log('[GeofenceMonitor] Geofence', geofence.id, {
        distanceMeters,
        accuracy,
        radius,
        enterThreshold,
        exitThreshold,
        prev,
        isInside,
        isOutside,
      });

      if (prev === undefined) {
        // At startup, if we are within the nominal radius, consider ourselves "inside"
        // so that leaving will trigger an exit event.
        const initialInside = distanceMeters <= radius;
        jsStateRef.current.set(key, initialInside);
        // DO NOT trigger handleJsEvent here - it causes duplicate startup notifications.
        continue;
      }

      // With exit margin 0, isOutside means past the nominal radius — reliable leave detection under GPS noise.
      if (prev && isOutside) {
        jsStateRef.current.set(key, false);
        await handleJsEvent(geofence, 'exit', current, distanceMeters);
      } else if (!prev && isInside) {
        jsStateRef.current.set(key, true);
        await handleJsEvent(geofence, 'enter', current, distanceMeters);
      }
    }
  };

  const startJsFallback = () => {
    if (watchIdRef.current !== null) return;

    Geolocation.getCurrentPosition(
      pos => {
        void evaluateJsPosition({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      error => {
        console.warn('JS geofence initial location error:', error);
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 5000,
      }
    );

    watchIdRef.current = Geolocation.watchPosition(
      async pos => {
        await evaluateJsPosition({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      error => {
        console.warn('JS geofence watch error:', error);
      },
      isOnShift ? {
        enableHighAccuracy: false,
        distanceFilter: 100,
        interval: 60000,
        fastestInterval: 30000,
      } : {
        enableHighAccuracy: true,
        distanceFilter: 5,
        interval: 5000,
        fastestInterval: 2000,
      }
    );
  };

  const stopJsFallback = () => {
    if (watchIdRef.current === null) return;
    Geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    jsStateRef.current.clear();
  };

  const handleJsEvent = async (
    geofence: Geofence,
    transition: 'enter' | 'exit',
    location: { lat: number; lng: number },
    distanceMeters: number
  ) => {
    console.log('[GeofenceMonitor] JS fallback event:', { geofence, transition, location, distanceMeters });
    if (!userId) return;

    // Suppression logic: if native already reported this in the last 30 mins, skip JS duplicate
    const lastNative = lastNativeEventAtRef.current.get(geofence.id);
    if (lastNative && lastNative.transition === transition && Date.now() - lastNative.timestamp < 30 * 60 * 1000) {
      console.log('[GeofenceMonitor] Skipping JS duplicate for', geofence.id);
      return;
    }

    const result = await processGeofenceEvent({
      userId,
      teamId,
      geofence,
      transition,
      location,
      distanceMeters,
      timestamp: Date.now(),
      source: 'js-fallback',
      allowPrompt: true,
    });

    const occurredAt = Date.now();
    const basePayload: GeofencePromptPayload =
      result.promptPayload ?? {
        eventId: result.eventId,
        geofenceId: geofence.id,
        geofenceName: geofence.name || 'Worksite',
        transition,
        occurredAt,
      };

    let didAutoHandle = false;
    if (transition === 'enter' || transition === 'exit') {
      const shouldNotify = await shouldNotifyForEvent(result.eventId);
      const autoShift = await getAutoShiftEnabled();
      const user = nativeAuth().currentUser;

      if (autoShift && user?.uid) {
        didAutoHandle = true;
        if (transition === 'enter') {
          await startShift(user.uid, geofence.id, geofence.name || 'Worksite');
        } else {
          await endShift(user.uid);
        }
        if (shouldNotify) {
          void showGeofenceNotification(basePayload, { variant: 'auto_result' });
        }
      } else if (shouldNotify) {
        void showGeofenceNotification(basePayload, { variant: 'prompt' });
      }
    }

    if (result.promptPayload && !didAutoHandle) {
      navigate('MySchedule', { prompt: result.promptPayload });
    }
  };

  return null;
}

const getCurrentLocationSafe = async (): Promise<{ lat: number; lng: number } | null> => {
  try {
    const position = await new Promise<Geolocation.GeoPosition>((resolve, reject) => {
      Geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      });
    });

    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    };
  } catch {
    return null;
  }
};
