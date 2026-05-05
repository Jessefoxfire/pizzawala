import { auth } from '../services/firebase';
import type { Geofence } from '../types';
import { 
  getLastUserId, 
  loadCachedGeofences, 
  cacheGeofences, 
  shouldNotifyForEvent,
  setPromptActionStatus,
  getPromptActionStatus,
  getLastUserName
} from './storage';
import { processGeofenceEvent, storePendingPrompt, startShift, endShift } from './processor';
import { showGeofenceNotification } from '../notifications/geofenceNotifications';
import { resolveGeofenceForNativeEvent, startNativeMonitoring } from './native';
import { normalizeGeofenceTransition } from './transition';
import { getDistanceMeters } from '../utils/geo';

type HeadlessEvent = {
  type?: 'geofence' | 'location';
  geofenceId?: string;
  transition?: unknown;
  latitude?: number;
  longitude?: number;
  timestamp?: number;
  accuracy?: number;
  delayed?: boolean;
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

  if (data.type === 'location') {
    // Handle NATIVE-PUSHED high-accuracy location update
    if (data.latitude == null || data.longitude == null) return;
    const current = { lat: data.latitude, lng: data.longitude };
    
    // Check if we just crossed into a building zone of any cached geofence
    const geofences = await loadCachedGeofences();
    for (const g of geofences) {
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

      if (result.promptPayload) {
        await storePendingPrompt(result.promptPayload);
        // Display high-priority background notification
        await showGeofenceNotification(result.promptPayload);
        
        // AUTO-SHIFT TIMER (60s for entry only)
        if (transition === 'enter') {
          const eventId = result.eventId;
          const gName = geofence?.name;
          const gId = geofence?.id;

          setTimeout(async () => {
            const { getAutoShiftEnabled } = require('./storage');
            if (!(await getAutoShiftEnabled())) return;

            const status = await getPromptActionStatus(eventId);
            if (status === 'confirmed' || status === 'vetoed') return;

            console.log(`[Headless] Enforcing automatic ${transition} for ${gName}`);
            await setPromptActionStatus(eventId, 'automatic');
            
            if (gId && gName) {
              await startShift(userId, gId, gName);
            }
          }, 60000);
        }
      }
    } catch (error) {
      console.error('[Headless] Error:', error);
    }
  };

  // Exit events are handled after native 30m delay.
  if (nativeTransition === 'enter') {
    await executeEvent('enter');
    return;
  }

  if (nativeTransition === 'exit' && data.delayed) {
    try {
      const { getAutoShiftEnabled } = require('./storage');
      if (await getAutoShiftEnabled()) {
        const endTime = data.timestamp ? new Date(data.timestamp) : new Date();
        await endShift(userId, endTime);
        console.log('[Headless] Delayed auto-stop executed at', endTime.toISOString());
        return;
      }

      // Auto-tracking disabled: keep delayed exit prompt behavior.
      await executeEvent('exit');
    } catch (error) {
      console.error('[Headless] Delayed exit handling failed:', error);
    }
  }
};

export const handleGeofenceBootHeadless = async () => {
  const cached = await loadCachedGeofences();
  if (cached.length > 0) {
    await startNativeMonitoring(cached);
  }
};
