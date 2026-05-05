import notifee, { AndroidImportance } from '@notifee/react-native';
import type { FirebaseMessagingTypes } from '@react-native-firebase/messaging';

function dataAsStrings(data: FirebaseMessagingTypes.RemoteMessage['data']): Record<string, string> {
  const out: Record<string, string> = {};
  if (!data) return out;
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? v : String(v);
  }
  return out;
}

async function ensureChannel(channelId: string, name: string) {
  await notifee.createChannel({
    id: channelId,
    name,
    importance: AndroidImportance.HIGH,
  });
}

/** OS does not show notification banners while the app is foregrounded; mirror FCM with Notifee. */
export async function displayForegroundRemoteMessage(
  remoteMessage: FirebaseMessagingTypes.RemoteMessage
) {
  const { notification, data } = remoteMessage;
  const type = data?.type ?? 'personal_notification';

  const channelId =
    type === 'chat_message' || type === 'broadcast'
      ? 'chat_messages'
      : type === 'award_received'
        ? 'awards'
        : 'personal_alerts';

  const channelName =
    channelId === 'chat_messages'
      ? 'Team Chat Messages'
      : channelId === 'awards'
        ? 'Awards & Medals'
        : 'Personal Alerts';

  await ensureChannel(channelId, channelName);

  const rawTitle = notification?.title ?? data?.title ?? 'PizzaWala';
  const rawBody = notification?.body ?? data?.body ?? '';
  const title = typeof rawTitle === 'string' ? rawTitle : String(rawTitle);
  const body = typeof rawBody === 'string' ? rawBody : String(rawBody);

  await notifee.displayNotification({
    title,
    body,
    data: dataAsStrings(data),
    android: {
      channelId,
      importance: AndroidImportance.HIGH,
      smallIcon: 'ic_launcher',
      pressAction: { id: 'default' },
    },
  });
}
