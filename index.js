import { AppRegistry } from 'react-native';
import '@react-native-firebase/app';
import messaging from '@react-native-firebase/messaging';
import notifee, { EventType } from '@notifee/react-native';
import App from './App';
import { name as appName } from './app.json';
import { handleGeofenceBootHeadless, handleGeofenceEventHeadless } from './src/geofencing/headless';

import { setPromptActionStatus } from './src/geofencing/storage';
import { handleGeofenceNotificationAction } from './src/notifications/geofenceNotificationActions';

// Data-only FCM (high priority) — display while native isn't showing a notification payload.
messaging().setBackgroundMessageHandler(async remoteMessage => {
  const { notification, data } = remoteMessage;
  if (notification?.title) return;
  const type = data?.type ?? 'personal_notification';
  const channelId =
    type === 'chat_message' || type === 'broadcast' ? 'chat_messages' : 'personal_alerts';
  const title = data?.title ?? 'PizzaWala';
  const body = data?.body ?? '';
  await notifee.createChannel({
    id: channelId,
    name: channelId,
    importance: 4,
  });
  const flat = {};
  if (data) {
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined && v !== null) flat[k] = String(v);
    }
  }
  await notifee.displayNotification({
    title,
    body,
    data: flat,
    android: {
      channelId,
      smallIcon: 'ic_launcher',
      pressAction: { id: 'default' },
    },
  });
});

// Handle notifee background events (e.g. action buttons)
notifee.onBackgroundEvent(async ({ type, detail }) => {
  const { notification, pressAction } = detail;
  const data = notification?.data || {};
  let eventId;
  if (data.payload && typeof data.payload === 'object') {
    eventId = data.payload.eventId;
  } else if (typeof data.payload === 'string') {
    try {
      eventId = JSON.parse(data.payload).eventId;
    } catch (_err) {
      eventId = undefined;
    }
  }

  if (type === EventType.ACTION_PRESS) {
    const handled = await handleGeofenceNotificationAction(pressAction?.id, data, notification?.id);
    if (!handled) {
      if (pressAction?.id === 'end_shift' && eventId) {
        await setPromptActionStatus(eventId, 'confirmed');
      }
    } else if (eventId) {
      await setPromptActionStatus(
        eventId,
        pressAction?.id === 'ignore' || pressAction?.id === 'ignore_break_return' ? 'vetoed' : 'confirmed'
      );
    }
  }

  if (notification?.id) {
    await notifee.cancelNotification(notification.id);
  }
});

AppRegistry.registerComponent(appName, () => App);

AppRegistry.registerHeadlessTask('GeofenceEvent', () => handleGeofenceEventHeadless);
AppRegistry.registerHeadlessTask('SignificantLocationChange', () => handleGeofenceEventHeadless);
AppRegistry.registerHeadlessTask('GeofenceBoot', () => handleGeofenceBootHeadless);
