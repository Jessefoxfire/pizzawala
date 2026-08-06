import { isShiftInProgress } from './processor';
import {
  getGeofenceRemindersStopped,
  isGeofenceNotificationMuted,
  getSuppressGeofenceWhileOnShift,
  setGeofenceRemindersStopped,
  setSuppressGeofenceWhileOnShift,
} from './storage';
import { setNativeSuppressEnterNotifications } from './native';

export type GeofenceNotificationVariant = 'prompt' | 'auto_result' | 'mute_offer';

export type GeofenceNotificationDecision =
  | { show: false }
  | { show: true; variant: GeofenceNotificationVariant };

export async function decideGeofenceNotification(
  userId: string,
  transition: 'enter' | 'exit'
): Promise<GeofenceNotificationDecision> {
  if ((await getGeofenceRemindersStopped()) || (await isGeofenceNotificationMuted())) {
    return { show: false };
  }

  const inProgress = await isShiftInProgress(userId);
  const suppressed = await getSuppressGeofenceWhileOnShift();

  if (transition === 'enter') {
    if (inProgress || suppressed) {
      return { show: false };
    }
    return { show: true, variant: 'prompt' };
  }

  return inProgress || suppressed ? { show: false } : { show: true, variant: 'prompt' };
}

export async function onShiftStarted(): Promise<void> {
  await setSuppressGeofenceWhileOnShift(true);
  await setNativeSuppressEnterNotifications(true);
}

export async function onShiftEnded(): Promise<void> {
  await setSuppressGeofenceWhileOnShift(false);
  await setNativeSuppressEnterNotifications(false);
}

export async function applyKeepReminding(): Promise<void> {
  await setGeofenceRemindersStopped(false);
  await setSuppressGeofenceWhileOnShift(false);
  await setNativeSuppressEnterNotifications(false);
}

export async function applyStopReminders(): Promise<void> {
  await setGeofenceRemindersStopped(true);
  await setSuppressGeofenceWhileOnShift(false);
  await setNativeSuppressEnterNotifications(false);
}

export async function handleGeofenceReminderAction(actionId: string): Promise<void> {
  if (actionId === 'keep_reminding') {
    await applyKeepReminding();
  } else if (actionId === 'stop_reminders') {
    await applyStopReminders();
  }
}
