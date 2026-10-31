import { isShiftInProgress } from './processor';
import {
  getSuppressGeofenceWhileOnShift,
  isEnterHandledForVisit,
  markEnterHandledForInsideVisits,
  setSuppressGeofenceWhileOnShift,
} from './storage';
import { setNativeSuppressEnterNotifications } from './native';

export type GeofenceNotificationVariant = 'prompt' | 'auto_result';

export type GeofenceNotificationDecision =
  | { show: false }
  | { show: true; variant: GeofenceNotificationVariant };

export async function decideGeofenceNotification(
  userId: string,
  transition: 'enter' | 'exit',
  geofenceId?: string
): Promise<GeofenceNotificationDecision> {
  const inProgress = await isShiftInProgress(userId);
  const suppressed = await getSuppressGeofenceWhileOnShift();

  if (transition === 'enter') {
    if (inProgress || suppressed) {
      return { show: false };
    }
    if (geofenceId && (await isEnterHandledForVisit(geofenceId))) {
      return { show: false };
    }
    return { show: true, variant: 'prompt' };
  }

  if (!inProgress) {
    return { show: false };
  }
  return { show: true, variant: 'prompt' };
}

export async function onShiftStarted(): Promise<void> {
  await setSuppressGeofenceWhileOnShift(true);
  await setNativeSuppressEnterNotifications(true);
}

export async function onShiftEnded(geofenceId?: string | null): Promise<void> {
  await markEnterHandledForInsideVisits(geofenceId);
  await setSuppressGeofenceWhileOnShift(false);
  await setNativeSuppressEnterNotifications(false);
}
