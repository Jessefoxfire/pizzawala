import { AppRegistry } from 'react-native';
import '@react-native-firebase/app';
import messaging from '@react-native-firebase/messaging';
import notifee, { EventType } from '@notifee/react-native';
import App from './App';
import { name as appName } from './app.json';
import { handleGeofenceBootHeadless, handleGeofenceEventHeadless } from './src/geofencing/headless';

import { setPromptActionStatus } from './src/geofencing/storage';

// Data-only FCM (high priority) — display while native isn't showing a notification payload.
messaging().setBackgroundMessageHandler(async remoteMessage => {
  const { notification, data } = remoteMessage;
  if (notification?.title) return;
  const type = data?.type ?? 'personal_notification';
  const channelId =
    type === 'chat_message' || type === 'broadcast'
      ? 'chat_messages'
      : type === 'award_received'
        ? 'awards'
        : 'personal_alerts';
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
  const eventId = notification?.data?.payload?.eventId;

  if (type === EventType.ACTION_PRESS) {
    if (pressAction?.id === 'start_shift' || pressAction?.id === 'end_shift') {
      if (eventId) await setPromptActionStatus(eventId, 'confirmed');
      console.log('[Notifee] Background action confirmed:', pressAction.id);
    } else if (pressAction?.id === 'ignore') {
      if (eventId) await setPromptActionStatus(eventId, 'vetoed');
      console.log('[Notifee] Background action vetoed');
    }
  }

  // Remove the notification after interaction
  if (notification?.id) {
    await notifee.cancelNotification(notification.id);
  }
});

AppRegistry.registerComponent(appName, () => App);

AppRegistry.registerHeadlessTask('GeofenceEvent', () => handleGeofenceEventHeadless);
AppRegistry.registerHeadlessTask('SignificantLocationChange', () => handleGeofenceEventHeadless);
AppRegistry.registerHeadlessTask('GeofenceBoot', () => handleGeofenceBootHeadless);
