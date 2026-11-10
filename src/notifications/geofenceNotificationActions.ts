import notifee from '@notifee/react-native';
import { nativeAuth } from '../services/firebase';
import { markBreakReturnHandledForVisit, markEnterHandledForVisit } from '../geofencing/storage';
import { applyNativeShiftAction, startShift } from '../geofencing/processor';
import type { GeofencePromptPayload } from '../geofencing/types';

export const GEOFENCE_ACTION_IGNORE = 'ignore';
export const GEOFENCE_ACTION_IGNORE_BREAK_RETURN = 'ignore_break_return';
export const GEOFENCE_ACTION_START = 'start_shift';
export const GEOFENCE_ACTION_RESTART = 'restart';
export const GEOFENCE_ACTION_BREAK = 'break';

function payloadFromNotificationData(data: Record<string, unknown> | undefined): GeofencePromptPayload | null {
  if (!data) return null;
  let raw = data.payload;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = undefined;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw as GeofencePromptPayload;
  if (!payload.geofenceId) return null;
  return payload;
}

export async function handleGeofenceNotificationAction(
  pressActionId: string | undefined,
  data: Record<string, unknown> | undefined,
  notificationId?: string
): Promise<boolean> {
  const known = new Set([
    GEOFENCE_ACTION_IGNORE,
    GEOFENCE_ACTION_IGNORE_BREAK_RETURN,
    GEOFENCE_ACTION_START,
    GEOFENCE_ACTION_RESTART,
    GEOFENCE_ACTION_BREAK,
  ]);
  if (!pressActionId || !known.has(pressActionId)) {
    return false;
  }
  const payload = payloadFromNotificationData(data);
  const geofenceId = payload?.geofenceId || (typeof data?.geofenceId === 'string' ? data.geofenceId : '');
  const uid = nativeAuth().currentUser?.uid;

  if (pressActionId === GEOFENCE_ACTION_IGNORE && geofenceId) {
    await markEnterHandledForVisit(geofenceId);
  }
  if (pressActionId === GEOFENCE_ACTION_IGNORE_BREAK_RETURN && geofenceId) {
    await markBreakReturnHandledForVisit(geofenceId);
  }
  if (pressActionId === GEOFENCE_ACTION_START && geofenceId && uid) {
    await markEnterHandledForVisit(geofenceId);
    await startShift(uid, geofenceId, payload?.geofenceName || 'Worksite');
  }
  if ((pressActionId === GEOFENCE_ACTION_RESTART || pressActionId === GEOFENCE_ACTION_BREAK) && uid) {
    if (geofenceId && pressActionId === GEOFENCE_ACTION_RESTART) {
      await markBreakReturnHandledForVisit(geofenceId);
    }
    await applyNativeShiftAction(pressActionId === GEOFENCE_ACTION_BREAK ? 'pause' : 'resume', null, uid);
  }
  if (notificationId) {
    await notifee.cancelNotification(notificationId);
  }
  return true;
}
