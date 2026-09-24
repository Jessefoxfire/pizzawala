import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Geofence } from '../types';
import type { GeofencePromptPayload } from './types';

const DEVICE_ID_KEY = 'geofence_device_id';
const GEOFENCE_CACHE_KEY = 'geofence_cache';
const PENDING_PROMPT_KEY = 'geofence_pending_prompt';
const LAST_PROMPT_EVENT_KEY = 'geofence_last_prompt_event';
const LAST_NOTIFY_EVENT_KEY = 'geofence_last_notify_event';
const LAST_USER_ID_KEY = 'geofence_last_user_id';
const LAST_USER_NAME_KEY = 'geofence_last_user_name';
const LAST_EVENT_DEBUG_KEY = 'geofence_last_event_debug';
const PROMPT_ACTION_STATUS_PREFIX = 'geofence_prompt_status_';
const AUTO_SHIFT_ENABLED_KEY = 'geofence_auto_shift_enabled';
const SHIFT_SETUP_INTRO_SEEN_KEY = 'shift_setup_intro_seen';
const TRACKING_ACTIVE_KEY = 'geofence_tracking_active';
const SHIFT_START_TIME_KEY = 'geofence_shift_start_time';
const SUPPRESS_WHILE_ON_SHIFT_KEY = 'geofence_suppress_while_on_shift';
const ENTER_HANDLED_PREFIX = 'geofence_enter_handled_';
const GEOFENCE_STATE_PREFIX = 'geofence_state_';

export const setAutoShiftEnabled = async (enabled: boolean): Promise<void> => {
  await AsyncStorage.setItem(AUTO_SHIFT_ENABLED_KEY, enabled ? 'true' : 'false');
  try {
    const { setNativeAutoShiftEnabled } = require('./native');
    setNativeAutoShiftEnabled(enabled);
  } catch (err) {
    console.warn('Failed to sync auto shift to native:', err);
  }
};

export const getAutoShiftEnabled = async (): Promise<boolean> => {
  const raw = await AsyncStorage.getItem(AUTO_SHIFT_ENABLED_KEY);
  return raw === 'true'; // Defaults to false
};

export const getShiftSetupIntroSeen = async (): Promise<boolean> => {
  const raw = await AsyncStorage.getItem(SHIFT_SETUP_INTRO_SEEN_KEY);
  return raw === 'true';
};

export const setShiftSetupIntroSeen = async (seen = true): Promise<void> => {
  await AsyncStorage.setItem(SHIFT_SETUP_INTRO_SEEN_KEY, seen ? 'true' : 'false');
};

const randomId = () => {
  const part = () => Math.random().toString(36).slice(2, 10);
  return `${part()}${part()}${Date.now().toString(36)}`;
};

export const getDeviceId = async (): Promise<string> => {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const next = randomId();
  await AsyncStorage.setItem(DEVICE_ID_KEY, next);
  return next;
};

export const cacheGeofences = async (geofences: Geofence[]): Promise<void> => {
  await AsyncStorage.setItem(GEOFENCE_CACHE_KEY, JSON.stringify(geofences));
};

export const loadCachedGeofences = async (): Promise<Geofence[]> => {
  const raw = await AsyncStorage.getItem(GEOFENCE_CACHE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Geofence[]) : [];
  } catch {
    return [];
  }
};

export const savePendingPrompt = async (payload: GeofencePromptPayload): Promise<void> => {
  await AsyncStorage.setItem(PENDING_PROMPT_KEY, JSON.stringify(payload));
};

export const consumePendingPrompt = async (): Promise<GeofencePromptPayload | null> => {
  const raw = await AsyncStorage.getItem(PENDING_PROMPT_KEY);
  if (!raw) return null;
  await AsyncStorage.removeItem(PENDING_PROMPT_KEY);
  try {
    return JSON.parse(raw) as GeofencePromptPayload;
  } catch {
    return null;
  }
};

export const shouldPromptForEvent = async (eventId: string): Promise<boolean> => {
  const lastPromptEventId = await AsyncStorage.getItem(LAST_PROMPT_EVENT_KEY);
  if (lastPromptEventId === eventId) {
    return false;
  }
  await AsyncStorage.setItem(LAST_PROMPT_EVENT_KEY, eventId);
  return true;
};

export const shouldNotifyForEvent = async (eventId: string): Promise<boolean> => {
  const lastNotifyEventId = await AsyncStorage.getItem(LAST_NOTIFY_EVENT_KEY);
  if (lastNotifyEventId === eventId) {
    return false;
  }
  await AsyncStorage.setItem(LAST_NOTIFY_EVENT_KEY, eventId);
  return true;
};

export const setLastUserId = async (userId: string | null) => {
  if (!userId) {
    await AsyncStorage.removeItem(LAST_USER_ID_KEY);
    return;
  }
  await AsyncStorage.setItem(LAST_USER_ID_KEY, userId);
};

export const getLastUserId = async (): Promise<string | null> => {
  return AsyncStorage.getItem(LAST_USER_ID_KEY);
};

export const setLastUserName = async (name: string | null) => {
  if (!name) {
    await AsyncStorage.removeItem(LAST_USER_NAME_KEY);
    return;
  }
  await AsyncStorage.setItem(LAST_USER_NAME_KEY, name);
};

export const getLastUserName = async (): Promise<string | null> => {
  return AsyncStorage.getItem(LAST_USER_NAME_KEY);
};

export type LastGeofenceEvent = {
  geofenceId: string;
  geofenceName?: string | null;
  transition: string;
  occurredAt: number;
  source: string;
  distanceMeters?: number | null;
  location?: { lat: number; lng: number } | null;
};

export const saveLastGeofenceEvent = async (event: LastGeofenceEvent): Promise<void> => {
  await AsyncStorage.setItem(LAST_EVENT_DEBUG_KEY, JSON.stringify(event));
};

export const loadLastGeofenceEvent = async (): Promise<LastGeofenceEvent | null> => {
  const raw = await AsyncStorage.getItem(LAST_EVENT_DEBUG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LastGeofenceEvent;
  } catch {
    return null;
  }
};

export const setPromptActionStatus = async (eventId: string, status: 'confirmed' | 'vetoed' | 'automatic'): Promise<void> => {
  await AsyncStorage.setItem(PROMPT_ACTION_STATUS_PREFIX + eventId, status);
};

export const getPromptActionStatus = async (eventId: string): Promise<string | null> => {
  return AsyncStorage.getItem(PROMPT_ACTION_STATUS_PREFIX + eventId);
};

export const setTrackingActiveState = async (active: boolean): Promise<void> => {
  await AsyncStorage.setItem(TRACKING_ACTIVE_KEY, active ? 'true' : 'false');
};

export const getTrackingActiveState = async (): Promise<boolean> => {
  const raw = await AsyncStorage.getItem(TRACKING_ACTIVE_KEY);
  return raw === 'true';
};

export const setShiftStartTime = async (time: number | null): Promise<void> => {
  if (time === null) {
    await AsyncStorage.removeItem(SHIFT_START_TIME_KEY);
  } else {
    await AsyncStorage.setItem(SHIFT_START_TIME_KEY, time.toString());
  }
};

export const getShiftStartTime = async (): Promise<number | null> => {
  const raw = await AsyncStorage.getItem(SHIFT_START_TIME_KEY);
  return raw ? parseInt(raw, 10) : null;
};

export const setSuppressGeofenceWhileOnShift = async (suppressed: boolean): Promise<void> => {
  await AsyncStorage.setItem(SUPPRESS_WHILE_ON_SHIFT_KEY, suppressed ? 'true' : 'false');
};

export const getSuppressGeofenceWhileOnShift = async (): Promise<boolean> => {
  const raw = await AsyncStorage.getItem(SUPPRESS_WHILE_ON_SHIFT_KEY);
  return raw === 'true';
};

const syncEnterHandledToNative = (geofenceId: string, handled: boolean) => {
  try {
    const { setNativeEnterHandledForVisit } = require('./native');
    setNativeEnterHandledForVisit(geofenceId, handled);
  } catch (err) {
    console.warn('Failed to sync enter-handled flag to native:', err);
  }
};

/** Persist that this dwell/visit already had a start-shift prompt (or a shift ended while still inside). */
export const markEnterHandledForVisit = async (geofenceId: string): Promise<void> => {
  if (!geofenceId) return;
  await AsyncStorage.setItem(ENTER_HANDLED_PREFIX + geofenceId, 'true');
  syncEnterHandledToNative(geofenceId, true);
};

export const clearEnterHandledForVisit = async (geofenceId: string): Promise<void> => {
  if (!geofenceId) return;
  await AsyncStorage.removeItem(ENTER_HANDLED_PREFIX + geofenceId);
  syncEnterHandledToNative(geofenceId, false);
};

export const isEnterHandledForVisit = async (geofenceId: string): Promise<boolean> => {
  if (!geofenceId) return false;
  const raw = await AsyncStorage.getItem(ENTER_HANDLED_PREFIX + geofenceId);
  return raw === 'true';
};

/** After ending a shift while still inside, treat every currently-inside geofence visit as processed. */
export const markEnterHandledForInsideVisits = async (
  extraGeofenceId?: string | null
): Promise<void> => {
  const ids = new Set<string>();
  if (extraGeofenceId) ids.add(extraGeofenceId);
  const keys = await AsyncStorage.getAllKeys();
  await Promise.all(
    keys
      .filter(key => key.startsWith(GEOFENCE_STATE_PREFIX))
      .map(async key => {
        const value = await AsyncStorage.getItem(key);
        if (value !== 'enter') return;
        ids.add(key.slice(GEOFENCE_STATE_PREFIX.length));
      })
  );
  await Promise.all([...ids].map(id => markEnterHandledForVisit(id)));
};
