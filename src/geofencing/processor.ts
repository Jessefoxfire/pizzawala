import { Alert, Vibration } from 'react-native';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from '@react-native-firebase/firestore';
import type { Geofence } from '../types';
import type { GeofenceEventSource, GeofenceEventType, GeofencePromptPayload } from './types';
import {
  getDeviceId,
  saveLastGeofenceEvent,
  savePendingPrompt,
  shouldPromptForEvent,
} from './storage';
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

  await saveLastGeofenceEvent({
    geofenceId: geofence.id,
    geofenceName: geofence.name ?? null,
    transition,
    occurredAt,
    source,
    distanceMeters: distanceMeters ?? null,
    location: location ?? null,
  });

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

    // STATEFUL DEDUPLICATION:
    // If the last transition for THIS geofence was the SAME as this one,
    // we should NOT fire notifications or prompts.
    const LAST_STATE_KEY = `geofence_state_${geofence.id}`;
    const { default: AsyncStorage } = require('@react-native-async-storage/async-storage');
    const lastState = await AsyncStorage.getItem(LAST_STATE_KEY);
    
    if (lastState === transition) {
      console.log(`[Processor] Deduplicating ${transition} for ${geofence.name} (already in this state)`);
      return { eventId };
    }
    
    // Update last known state
    await AsyncStorage.setItem(LAST_STATE_KEY, transition);

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
      const inProgress = await isShiftInProgress(userId);
      
      if (transition === 'enter' && inProgress) {
        console.log('[Processor] Suppressing "Start shift" prompt: Shift already in progress.');
        return { eventId };
      }
      if (transition === 'exit' && !inProgress) {
        console.log('[Processor] Suppressing "End shift" prompt: No shift in progress.');
        return { eventId };
      }

      promptPayload = {
        eventId,
        geofenceId: geofence.id,
        geofenceName: geofence.name,
        userName,
        transition,
        occurredAt,
      };
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

export const startShift = async (userId: string, geofenceId: string, geofenceName: string) => {
  try {
    const fs = getFirestore();
    const userSnap = await getDoc(doc(fs, 'users', userId));
    const teamId = userSnap.data()?.teamId != null ? String(userSnap.data()!.teamId) : 'team-1';

    const shiftsRef = collection(fs, 'shifts');
    const openSnap = await getDocs(
      query(shiftsRef, where('userId', '==', userId), where('status', '==', 'open'), limit(1))
    );

    if (!openSnap.empty) {
      return;
    }

    await addDoc(shiftsRef, {
      userId,
      teamId,
      geofenceId,
      geofenceName,
      status: 'open',
      startAt: serverTimestamp(),
      startedBy: 'geofence',
    });
  } catch (error) {
    console.warn('Failed to start shift:', error);
  }
};

export const endShift = async (userId: string, endTime?: Date) => {
  try {
    const fs = getFirestore();
    const shiftsRef = collection(fs, 'shifts');
    const openSnap = await getDocs(
      query(shiftsRef, where('userId', '==', userId), where('status', '==', 'open'), limit(1))
    );

    if (openSnap.empty) {
      return;
    }

    const openShift = openSnap.docs[0];
    await updateDoc(doc(fs, 'shifts', openShift.id), {
      status: 'closed',
      endAt: endTime || serverTimestamp(),
      endedBy: 'geofence',
    });
  } catch (error) {
    console.warn('Failed to end shift:', error);
  }
};

export const isShiftInProgress = async (userId: string): Promise<boolean> => {
  try {
    const fs = getFirestore();
    const shiftsRef = collection(fs, 'shifts');
    const q = query(
      shiftsRef,
      where('userId', '==', userId),
      where('status', '==', 'open'),
      limit(1)
    );
    const snap = await getDocs(q);
    return !snap.empty;
  } catch (error) {
    console.warn('Failed to check shift status:', error);
    return false;
  }
};
