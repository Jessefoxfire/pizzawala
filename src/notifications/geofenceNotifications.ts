import notifee, { AndroidImportance } from '@notifee/react-native';
import type { GeofencePromptPayload } from '../geofencing/types';
import {
  isGeofenceNotificationMuted,
  recordGeofenceNotificationShown,
} from '../geofencing/storage';

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

export type GeofenceNotificationVariant = 'prompt' | 'auto_result' | 'mute_offer';

export const showGeofenceNotification = async (
  payload: GeofencePromptPayload,
  options?: { variant?: GeofenceNotificationVariant }
) => {
  const variant = options?.variant ?? 'prompt';
  const isEnter = payload.transition === 'enter';
  const action = isEnter ? 'entered' : 'exited';
  const shiftVerb = isEnter ? 'start' : 'end';

  if (await isGeofenceNotificationMuted()) {
    return;
  }

  const title =
    variant === 'mute_offer'
      ? 'Too many worksite notifications'
      : variant === 'auto_result'
        ? isEnter
          ? 'Shift started'
          : 'Shift ended'
        : isEnter
          ? 'Worksite Arrival'
          : 'Worksite Departure';
  const body =
    variant === 'mute_offer'
      ? 'You are receiving above the normal amount of notifications. Would you like to disable notifications for 1 hour?'
      : variant === 'auto_result'
        ? isEnter
          ? `You're at ${payload.geofenceName}. Your shift started automatically.`
          : `You left ${payload.geofenceName}. Your shift was ended automatically.`
        : `You have ${action} the ${payload.geofenceName} Worksite. Would you like to ${shiftVerb} your shift? Tap to open the app.`;

  const channelId = await ensureChannel();

  const androidActions =
    variant === 'mute_offer'
      ? [
          {
            title: 'Disable 1 hour',
            pressAction: { id: 'mute_geofence_1h' },
          },
          {
            title: 'Keep enabled',
            pressAction: { id: 'keep_geofence_enabled' },
          },
        ]
      : variant === 'auto_result'
        ? undefined
        : [
            {
              title: isEnter ? 'START SHIFT' : 'END SHIFT',
              pressAction: {
                id: 'view_shift',
                launchActivity: 'default' as const,
              },
            },
          ];

  await notifee.displayNotification({
    id: payload.eventId,
    title,
    body,
    data: {
      type: 'geofence_event',
      payload,
    },
    android: {
      channelId,
      smallIcon: 'ic_launcher',
      pressAction: { id: 'default' },
      importance: AndroidImportance.HIGH,
      ...(androidActions ? { actions: androidActions } : {}),
    },
  });

  if (variant !== 'mute_offer') {
    const { shouldOfferMute } = await recordGeofenceNotificationShown(payload.occurredAt || Date.now());
    if (shouldOfferMute) {
      await notifee.displayNotification({
        id: `geofence-mute-offer-${payload.eventId}`,
        title: 'Too many worksite notifications',
        body: 'You are receiving above the normal amount of notifications. Would you like to disable notifications for 1 hour?',
        data: {
          type: 'geofence_mute_offer',
        },
        android: {
          channelId,
          smallIcon: 'ic_launcher',
          pressAction: { id: 'default' },
          importance: AndroidImportance.HIGH,
          actions: [
            {
              title: 'Disable 1 hour',
              pressAction: { id: 'mute_geofence_1h' },
            },
            {
              title: 'Keep enabled',
              pressAction: { id: 'keep_geofence_enabled' },
            },
          ],
        },
      });
    }
  }
};
