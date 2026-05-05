export type GeofenceEventType = 'enter' | 'exit' | 'dwell';

export type GeofenceEventSource =
  | 'native'
  | 'native-hardened'
  | 'js-fallback'
  | 'debug-manual'
  | 'debug-poll';

export type NativeGeofenceEvent = {
  geofenceId: string;
  transition: GeofenceEventType;
  latitude?: number;
  longitude?: number;
  timestamp?: number;
};

export type GeofencePromptPayload = {
  eventId: string;
  geofenceId: string;
  geofenceName: string;
  userName?: string | null;
  transition: 'enter' | 'exit';
  occurredAt: number;
};
