import { Alert, Vibration } from 'react-native';
import {
  doc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from '@react-native-firebase/firestore';
import type { Geofence } from '../types';
import type { GeofenceEventSource, GeofenceEventType, GeofencePromptPayload } from './types';
import {
  endLiveShiftForUser,
  hasClockedInShift,
  pauseLiveShift,
  resumeLiveShift,
  startLiveShift,
} from '../services/shifts';
import { isActiveWorksite } from '../utils/locationPrompt';
import { Platform } from 'react-native';
import {
  getAutoShiftEnabled,
  getDeviceId,
  saveLastGeofenceEvent,
  savePendingPrompt,
  shouldPromptForEvent,
  isEnterHandledForVisit,
  markEnterHandledForVisit,
  markBreakReturnHandledForVisit,
  clearEnterHandledForVisit,
  clearBreakReturnHandledForVisit,
  setConfirmedAwayForVisit,
} from './storage';
import { decideGeofenceNotification, getShiftTrackingState } from './notificationPolicy';
import { AUTO_CONFIRM_MS, decideAutoTransition } from './geofenceNotificationDecision';

const visitResetTimers = new Map<string, ReturnType<typeof setTimeout>>();
const autoEnterTimers = new Map<string, ReturnType<typeof setTimeout>>();

const cancelVisitReset = (geofenceId: string) => {
  const timer = visitResetTimers.get(geofenceId);
  if (timer) {
    clearTimeout(timer);
    visitResetTimers.delete(geofenceId);
  }
};

const cancelJsAutoEnter = (geofenceId: string) => {
  const timer = autoEnterTimers.get(geofenceId);
  if (timer) {
    clearTimeout(timer);
    autoEnterTimers.delete(geofenceId);
  }
};

const usesJsAutoTracking = (source: GeofenceEventSource) =>
  source === 'js-fallback' || source === 'debug-manual' || Platform.OS !== 'android';

const scheduleVisitReset = (geofenceId: string, userId: string, allowJsAuto: boolean) => {
  cancelVisitReset(geofenceId);
  visitResetTimers.set(
    geofenceId,
    setTimeout(() => {
      visitResetTimers.delete(geofenceId);
      void (async () => {
        await Promise.all([
          clearEnterHandledForVisit(geofenceId),
          clearBreakReturnHandledForVisit(geofenceId),
          setConfirmedAwayForVisit(geofenceId, true),
        ]);
        if (!allowJsAuto) return;
        const [autoEnabled, tracking] = await Promise.all([
          getAutoShiftEnabled(),
          getShiftTrackingState(userId),
        ]);
        if (
          decideAutoTransition({
            autoEnabled,
            phase: 'confirmed_exit',
            geofenceId,
            tracking,
          }) === 'pause'
        ) {
          await applyNativeShiftAction('pause', tracking.shiftId, userId, { id: geofenceId }, 'auto');
        }
      })();
    }, AUTO_CONFIRM_MS)
  );
};

const scheduleJsAutoEnter = (
  geofenceId: string,
  geofenceName: string,
  userId: string,
  action: 'start' | 'resume'
) => {
  if (autoEnterTimers.has(geofenceId)) return;
  autoEnterTimers.set(
    geofenceId,
    setTimeout(() => {
      autoEnterTimers.delete(geofenceId);
      void (async () => {
        if (action === 'resume') {
          await applyNativeShiftAction('resume', null, userId);
          await setConfirmedAwayForVisit(geofenceId, false);
          return;
        }
        await startShift(userId, geofenceId, geofenceName);
        await setConfirmedAwayForVisit(geofenceId, false);
      })();
    }, AUTO_CONFIRM_MS)
  );
};
const BUCKET_MS = 2 * 60 * 1000;

const hashString = (value: string) => {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
};

const buildEventId = (deviceId: string, geofenceId: string, transition: string, ts: number) => {
  const bucket = Math.floor(ts / BUCKET_MS);
  return hashString(`${deviceId}:${geofenceId}:${transition}:${bucket}`);
};

export type ProcessedEvent = {
  eventId: string;
  promptPayload?: GeofencePromptPayload;
};

type ProcessEventInput = {
  userId: string;
  teamId?: string | null;
  geofence: Geofence;
  transition: GeofenceEventType;
  userName?: string | null;
  location?: { lat: number; lng: number } | null;
  distanceMeters?: number | null;
  timestamp?: number;
  source: GeofenceEventSource;
  allowPrompt: boolean;
};

export const processGeofenceEvent = async ({
  userId,
  teamId,
  geofence,
  transition,
  userName,
  location,
  distanceMeters,
  timestamp,
  source,
  allowPrompt,
}: ProcessEventInput): Promise<ProcessedEvent> => {
  const occurredAt = timestamp ?? Date.now();
  const deviceId = await getDeviceId();
  const eventId = buildEventId(deviceId, geofence.id, transition, occurredAt);
  if (!isActiveWorksite(geofence)) {
    return { eventId };
  }

  await saveLastGeofenceEvent({
    geofenceId: geofence.id,
    geofenceName: geofence.name ?? null,
    transition,
    occurredAt,
    source,
    distanceMeters: distanceMeters ?? null,
    location: location ?? null,
  });

  const LAST_STATE_KEY = `geofence_state_${geofence.id}`;
  const { default: AsyncStorage } = require('@react-native-async-storage/async-storage');
  const lastState = await AsyncStorage.getItem(LAST_STATE_KEY);
  if (transition === 'enter') {
    cancelVisitReset(geofence.id);
  }
  if (transition === 'enter' && (await isEnterHandledForVisit(geofence.id))) {
    const decision = await decideGeofenceNotification(userId, 'enter', geofence.id);
    if (decision.show && decision.variant === 'break_return') {
      /* allow the return-on-break prompt even if start-shift was already handled */
    } else {
      if (lastState !== 'enter') {
        await AsyncStorage.setItem(LAST_STATE_KEY, 'enter');
      }
      console.log(`[Processor] Skipping enter for ${geofence.name}: visit already handled until a real exit`);
      return { eventId };
    }
  }
  if (lastState === transition) {
    console.log(`[Processor] Deduplicating ${transition} for ${geofence.name} (already in this state)`);
    return { eventId };
  }
  await AsyncStorage.setItem(LAST_STATE_KEY, transition);

  if (transition === 'exit') {
    cancelJsAutoEnter(geofence.id);
    scheduleVisitReset(geofence.id, userId, usesJsAutoTracking(source));
  }

  const fs = getFirestore();
  try {
    await setDoc(
      doc(fs, 'geofenceEvents', eventId),
      {
        eventId,
        userId,
        teamId: teamId ?? null,
        geofenceId: geofence.id,
        geofenceName: geofence.name,
        transition,
        source,
        location: location ?? null,
        distanceMeters: distanceMeters ?? null,
        occurredAt: serverTimestamp(),
        bucketMs: BUCKET_MS,
      },
      { merge: true }
    );
  } catch (error) {
    // Keep local debug/notification flow alive even if Firestore is unavailable or rejected.
    console.warn('Failed to persist geofence event:', error);
  }

  let promptPayload: GeofencePromptPayload | undefined;
  if (allowPrompt && (transition === 'enter' || transition === 'exit')) {
    const shouldPrompt = await shouldPromptForEvent(eventId);
    if (shouldPrompt) {
      // SUPPRESS PROMPTS IF STATE ALREADY MATCHES
      // 1. Don't prompt "Start shift" if a shift is already in progress.
      // 2. Don't prompt "End shift" if NO shift is in progress.
      const decision = await decideGeofenceNotification(userId, transition, geofence.id);
      if (decision.show) {
        promptPayload = {
          eventId,
          geofenceId: geofence.id,
          geofenceName: geofence.name,
          userName,
          transition,
          occurredAt,
          variant: decision.variant,
        };
        if (transition === 'enter' && decision.variant === 'break_return') {
          await markBreakReturnHandledForVisit(geofence.id);
        } else if (transition === 'enter') {
          await markEnterHandledForVisit(geofence.id);
        }
      }
    }
  }

  if (usesJsAutoTracking(source) && (transition === 'enter' || transition === 'exit')) {
    const [autoEnabled, tracking] = await Promise.all([getAutoShiftEnabled(), getShiftTrackingState(userId)]);
    if (
      transition === 'enter' &&
      tracking.open &&
      !tracking.paused &&
      tracking.geofenceId === geofence.id
    ) {
      const { setAutoBreakArmed } = require('./storage');
      await setAutoBreakArmed(true);
    }
    if (transition === 'enter') {
      const kind = decideAutoTransition({
        autoEnabled,
        phase: 'confirmed_enter',
        geofenceId: geofence.id,
        tracking,
      });
      if (kind === 'start' || kind === 'resume') {
        scheduleJsAutoEnter(geofence.id, geofence.name || 'Worksite', userId, kind);
      }
    } else {
      const kind = decideAutoTransition({
        autoEnabled,
        phase: 'confirmed_exit',
        geofenceId: geofence.id,
        tracking,
      });
      if (kind === 'pause') {
        /* visit-reset timer performs the pause after five continuous minutes away */
      }
    }
  }

  return { eventId, promptPayload };
};

export const handlePrompt = async (payload: GeofencePromptPayload, userId: string) => {
  notifyGeofenceTransition(payload);
  const isEnter = payload.transition === 'enter';
  const shiftVerb = isEnter ? 'start' : 'end';
  
  Alert.alert(
    isEnter ? 'Worksite Arrival' : 'Worksite Departure',
    `You have ${isEnter ? 'entered' : 'exited'} the ${payload.geofenceName} Worksite. Would you like to ${shiftVerb} your shift? If so, click here.`,
    [
      { text: 'Not now', style: 'cancel' },
      {
        text: isEnter ? 'Start shift' : 'End shift',
        onPress: () => {
          if (isEnter) {
            void startShift(userId, payload.geofenceId, payload.geofenceName);
          } else {
            void endShift(userId);
          }
        },
      },
    ]
  );
};

export const notifyGeofenceTransition = async (payload: GeofencePromptPayload) => {
  if (!payload.userName) {
    const { getLastUserName } = require('./storage');
    payload.userName = await getLastUserName();
  }
  
  // JS-side: vibrate; Notifee alerts are shown from GeofenceMonitor.

  Vibration.vibrate(400);
};

export const storePendingPrompt = async (payload: GeofencePromptPayload) => {
  await savePendingPrompt(payload);
};

const cancelPendingAutoForSite = (geofenceId?: string | null) => {
  if (!geofenceId) return;
  cancelJsAutoEnter(geofenceId);
  try {
    const { cancelNativeAutoTracking } = require('./native');
    cancelNativeAutoTracking(geofenceId);
  } catch {
    /* native optional */
  }
};

export const startShift = async (userId: string, geofenceId: string, geofenceName: string) => {
  try {
    cancelPendingAutoForSite(geofenceId);
    const tracking = await getShiftTrackingState(userId);
    if (tracking.open && tracking.paused) {
      console.log('[Processor] Refusing startShift while a shift is on break');
      return;
    }
    if (tracking.open && tracking.geofenceId && tracking.geofenceId !== geofenceId) {
      console.log('[Processor] Refusing startShift that would switch worksites');
      return;
    }
    const shiftId = await startLiveShift({
      userId,
      geofenceId,
      geofenceName,
      startedBy: 'geofence',
    });
    const { onShiftStarted } = require('./notificationPolicy');
    await markEnterHandledForVisit(geofenceId);
    const { setAutoBreakArmed } = require('./storage');
    await setAutoBreakArmed(true);
    await onShiftStarted({
      shiftId,
      userId,
      geofenceId,
      geofenceName,
      paused: false,
    });
  } catch (error) {
    console.warn('Failed to start shift:', error);
  }
};

export const applyNativeShiftAction = async (
  action: 'pause' | 'resume' | 'start' | 'end' | 'cutoff',
  shiftId?: string | null,
  userId?: string | null,
  geofence?: { id?: string | null; name?: string | null } | null,
  breakSource: 'auto' | 'manual' = 'manual',
  recordedAtMs?: number | null
) => {
  if (action === 'start' && userId && geofence?.id) {
    await startShift(userId, geofence.id, geofence.name || 'Worksite');
    return;
  }
  if (action === 'end' && userId) {
    await endShift(userId);
    return;
  }
  let resolvedId = shiftId;
  const tracking = userId ? await getShiftTrackingState(userId) : null;
  if (!resolvedId && tracking) {
    resolvedId = tracking.shiftId;
  }
  if (action === 'cutoff') {
    const { cutoffRecordedAtIso } = require('./geofenceNotificationDecision');
    const { setCutoffReached } = require('./storage');
    const { endLiveShift } = require('../services/shifts');
    const original = tracking?.originalStartMs || Date.now();
    const endIso =
      recordedAtMs && recordedAtMs > 0
        ? new Date(recordedAtMs).toISOString()
        : cutoffRecordedAtIso(original);
    if (resolvedId) {
      await endLiveShift(resolvedId, 'geofence', { recordedAtIso: endIso });
    } else if (userId) {
      await endLiveShiftForUser(userId, 'geofence');
    }
    await setCutoffReached(true);
    return;
  }
  if (!resolvedId) return;
  cancelPendingAutoForSite(geofence?.id || tracking?.geofenceId);
  if (action === 'pause') {
    const { setBreakSource } = require('./storage');
    await setBreakSource(breakSource);
    await pauseLiveShift(resolvedId);
  } else {
    const { setBreakSource, setAutoBreakArmed, isConfirmedAwayForVisit } = require('./storage');
    await setBreakSource(null);
    const siteId = geofence?.id || tracking?.geofenceId;
    const away = siteId ? await isConfirmedAwayForVisit(siteId) : true;
    await setAutoBreakArmed(!away);
    await resumeLiveShift(resolvedId);
  }
  try {
    const { clearNativePendingShiftAction } = require('./native');
    const { onShiftStarted } = require('./notificationPolicy');
    clearNativePendingShiftAction();
    await onShiftStarted({
      shiftId: resolvedId,
      userId: userId ?? tracking?.userId,
      geofenceId: tracking?.geofenceId ?? geofence?.id ?? null,
      paused: action === 'pause',
    });
  } catch {
    /* native optional */
  }
};

export const endShift = async (userId: string, _endTime?: Date) => {
  try {
    await endLiveShiftForUser(userId, 'geofence');
    const { onShiftEnded } = require('./notificationPolicy');
    await onShiftEnded();
  } catch (error) {
    console.warn('Failed to end shift:', error);
  }
};

export const isShiftInProgress = async (userId: string): Promise<boolean> => {
  try {
    return await hasClockedInShift(userId);
  } catch (error) {
    console.warn('Failed to check shift status:', error);
    return false;
  }
};
