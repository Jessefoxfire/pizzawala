import type { GeofencePromptPayload } from '../geofencing/types';
import type { Geofence } from '../types';
import { navigate, navigationRef } from '../navigation/navigationRef';
import { setPendingNotificationOpen, takePendingNotificationOpen } from './pendingNotificationOpen';

function coerceNotificationData(data: Record<string, unknown>): Record<string, unknown> {
  const type = String(data.type);
  const next = { ...data };

  if (type === 'geofence_event' && typeof data.payload === 'string') {
    try {
      next.payload = JSON.parse(data.payload);
    } catch {
      /* keep string */
    }
  }
  if (type === 'navigation_link') {
    const g = data.geofence;
    if (typeof g === 'string') {
      try {
        next.geofence = JSON.parse(g);
      } catch {
        /* keep */
      }
    }
  }

  return next;
}

function performRoute(data: Record<string, unknown>) {
  const type = String(data.type);

  switch (type) {
    case 'geofence_event': {
      const payload = data.payload as GeofencePromptPayload | undefined;
      if (payload && typeof payload === 'object' && 'eventId' in payload) {
        navigate('MySchedule', { prompt: payload });
      }
      break;
    }
    case 'navigation_link': {
      const geofence = data.geofence as Geofence | undefined;
      if (geofence && typeof geofence === 'object' && 'id' in geofence) {
        navigate('WorksiteFinder', { geofence });
      }
      break;
    }
    case 'chat_message':
      navigate('Chat');
      break;
    case 'broadcast':
      navigate('Chat');
      break;
    case 'award_received':
      navigate('HallOfFame');
      break;
    case 'personal_notification': {
      const screen = String(data.screen || '');
      if (screen === 'MySchedule') {
        const view = data.view === 'calendar' ? 'calendar' : 'list';
        navigate('MySchedule', { initialView: view });
      } else if (screen === 'Hygiene') {
        navigate('Hygiene');
      } else if (screen === 'AdminHygiene') {
        navigate('AdminHygiene');
      } else {
        navigate('Home');
      }
      break;
    }
    default:
      break;
  }
}

/** Route from Notifee payloads, FCM `data`, or cold-start opens. Queues until the navigator is mounted. */
export function routeNotificationOpen(data: Record<string, unknown> | undefined) {
  if (!data?.type) return;
  const normalized = coerceNotificationData(data);
  if (!navigationRef.isReady()) {
    setPendingNotificationOpen(normalized);
    return;
  }
  performRoute(normalized);
}

/** Call from `NavigationContainer` `onReady` after any cold-start pending intent was stored. */
export function flushPendingNotificationRoutes() {
  const pending = takePendingNotificationOpen();
  if (!pending?.type) return;
  if (!navigationRef.isReady()) {
    setPendingNotificationOpen(pending);
    return;
  }
  performRoute(coerceNotificationData(pending));
}
