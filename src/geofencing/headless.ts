import { Platform } from 'react-native';
import { auth } from '../services/firebase';
import type { Geofence } from '../types';
import { 
  getLastUserId, 
  loadCachedGeofences, 
  cacheGeofences, 
  shouldNotifyForEvent,
  getLastUserName,
  getLocationFeaturesEnabled,
  syncNativeWorksiteNotificationPref,
} from './storage';
import { processGeofenceEvent, storePendingPrompt, applyNativeShiftAction } from './processor';
import { decideGeofenceNotification } from './notificationPolicy';
import { showGeofenceNotification } from '../notifications/geofenceNotifications';
import { resolveGeofenceForNativeEvent, startNativeMonitoring } from './native';
import { normalizeGeofenceTransition } from './transition';
import { getDistanceMeters } from '../utils/geo';
import { isActiveWorksite } from '../utils/locationPrompt';

type HeadlessEvent = {
  type?: 'geofence' | 'location' | 'shift_action';
  geofenceId?: string;
  transition?: unknown;
  latitude?: number;
  longitude?: number;
  timestamp?: number;
  accuracy?: number;
  delayed?: boolean;
  action?: string;
  shiftId?: string;
  geofenceName?: string;
  recordedAtMs?: number;
  breakSource?: string;
};

const mergeGeofenceIntoCache = async (resolved: Geofence) => {
  const existing = await loadCachedGeofences();
  const others = existing.filter(g => g.id !== resolved.id);
  await cacheGeofences([...others, resolved]);
};

/** 
 * PRECISION TRACKER REMOVED 
 * Reliance on RN Geolocation for background is killed per non-negotiable requirements.
 * Native layer now handles high-accuracy boosts and bridges them to JS.
 */

export const handleGeofenceEventHeadless = async (data: HeadlessEvent) => {
  const user = auth.currentUser;
  const userId = user?.uid ?? (await getLastUserId());
  if (!userId) return;

  if (data.type === 'shift_action') {
    const action = data.action;
    if (
      action !== 'pause' &&
      action !== 'resume' &&
      action !== 'start' &&
      action !== 'end' &&
      action !== 'cutoff'
    ) {
      return;
    }
    await applyNativeShiftAction(
      action,
      data.shiftId,
      userId,
      {
        id: data.geofenceId,
        name: data.geofenceName,
      },
      data.breakSource === 'auto' ? 'auto' : 'manual',
      typeof data.recordedAtMs === 'number' ? data.recordedAtMs : null
    );
    return;
  }

  if (data.type === 'location') {
    // Handle NATIVE-PUSHED high-accuracy location update
    if (data.latitude == null || data.longitude == null) return;
    const current = { lat: data.latitude, lng: data.longitude };
    
    // Check if we just crossed into a building zone of any cached geofence
    const geofences = await loadCachedGeofences();
    for (const g of geofences) {
      if (!isActiveWorksite(g)) continue;
      const dist = getDistanceMeters(current, g.center);
      // If we are VERY close (e.g. 30m) it might trigger an auto-shift if one isn't already running
      if (dist < 30) {
        // Implementation of auto-shift on refined location can go here
      }
    }
    return;
  }

  // Handle GEOFENCE transition
  console.log('[Headless] Wakeup (Native Event):', data.geofenceId, data.transition);
  const nativeTransition = normalizeGeofenceTransition(data.transition);
  if (!nativeTransition) return;

  const geofences = await loadCachedGeofences();
  let geofence = await resolveGeofenceForNativeEvent(data.geofenceId ?? '', geofences);
  if (!geofence) return;

  const userName = await getLastUserName();
  
  const executeEvent = async (transition: 'enter' | 'exit', loc?: { lat: number; lng: number } | null) => {
    try {
      const result = await processGeofenceEvent({
        userId,
        teamId: geofence?.teamId,
        geofence: geofence!,
        transition,
        userName,
        location: loc ?? (typeof data.latitude === 'number' && typeof data.longitude === 'number'
          ? { lat: data.latitude, lng: data.longitude }
          : null),
        distanceMeters: null,
        timestamp: data.timestamp ?? Date.now(),
        source: 'native-hardened',
        allowPrompt: true,
      });

      const decision = await decideGeofenceNotification(userId, transition, geofence!.id);
      const notifyPayload =
        result.promptPayload ?? {
          eventId: result.eventId,
          geofenceId: geofence!.id,
          geofenceName: geofence!.name || 'Worksite',
          userName: userName ?? undefined,
          transition,
          occurredAt: data.timestamp ?? Date.now(),
        };

      if (result.promptPayload) {
        await storePendingPrompt(result.promptPayload);
      }

      if (decision.show && result.promptPayload && Platform.OS !== 'android') {
        const shouldNotify = await shouldNotifyForEvent(result.eventId);
        if (shouldNotify) {
          await showGeofenceNotification(notifyPayload, { variant: decision.variant });
        }
      }

    } catch (error) {
      console.error('[Headless] Error:', error);
    }
  };

  if (!isActiveWorksite(geofence)) return;

  if (nativeTransition === 'enter') {
    await executeEvent('enter');
    return;
  }

  if (nativeTransition === 'exit' && !data.delayed) {
    await executeEvent('exit');
  }
};

export const handleGeofenceBootHeadless = async () => {
  if (!(await getLocationFeaturesEnabled())) return;
  await syncNativeWorksiteNotificationPref();
  const cached = await loadCachedGeofences();
  if (cached.length > 0) {
    await startNativeMonitoring(cached);
  }
};
