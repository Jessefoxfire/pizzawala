import notifee, { AndroidImportance, AndroidStyle } from '@notifee/react-native';
import type { GeofencePromptPayload } from '../geofencing/types';
import { getWorksiteAlertsEnabled } from '../geofencing/storage';
import {
  GEOFENCE_ACTION_IGNORE,
  GEOFENCE_ACTION_START,
} from './geofenceNotificationActions';

const CHANNEL_ID = 'geofence-updates';
let channelReady = false;

const ensureChannel = async () => {
  if (channelReady) return CHANNEL_ID;
  await notifee.createChannel({
    id: CHANNEL_ID,
    name: 'Worksite updates',
    importance: AndroidImportance.HIGH,
  });
  channelReady = true;
  return CHANNEL_ID;
};

export type GeofenceNotificationVariant = 'prompt' | 'auto_result' | 'break_return';

export const showGeofenceNotification = async (
  payload: GeofencePromptPayload,
  options?: { variant?: GeofenceNotificationVariant }
) => {
  if (!(await getWorksiteAlertsEnabled())) return;
  const variant = options?.variant ?? payload.variant ?? 'prompt';
  const isEnter = payload.transition === 'enter';
  if (!isEnter || variant !== 'prompt') return;

  const title = 'Worksite Arrival';
  const body = `You have entered the ${payload.geofenceName} Worksite. Would you like to start your shift?`;
  const channelId = await ensureChannel();

  await notifee.displayNotification({
    id: `${payload.geofenceId}:${payload.transition}`,
    title,
    body,
    data: {
      type: 'geofence_event',
      payload: JSON.stringify(payload),
      geofenceId: payload.geofenceId,
      transition: payload.transition,
      variant,
    },
    android: {
      channelId,
      smallIcon: 'ic_launcher',
      pressAction: { id: 'default', launchActivity: 'default' as const },
      importance: AndroidImportance.HIGH,
      style: { type: AndroidStyle.BIGTEXT, text: body },
      actions: [
        {
          title: 'Ignore',
          pressAction: { id: GEOFENCE_ACTION_IGNORE },
        },
        {
          title: 'Start',
          pressAction: {
            id: GEOFENCE_ACTION_START,
            launchActivity: 'default' as const,
          },
        },
      ],
    },
  });
};
