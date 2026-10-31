import AsyncStorage from '@react-native-async-storage/async-storage';
import notifee, { AndroidImportance, TriggerType, type TimestampTrigger } from '@notifee/react-native';
import {
  pickScheduledEndMs,
  type ScheduledShiftRow,
} from '../utils/daySummary';
import { type LiveShift } from '../services/shifts';

export { pickScheduledEndMs };
export const SHIFT_END_CHANNEL_ID = 'shift-reminders';
export const SHIFT_END_REMINDER_MS = 30 * 60 * 1000;
const SHOWN_PREFIX = 'shift_end_notice_shown_';

export function shiftEndNoticeIds(shiftId: string) {
  return {
    due: `shift-end:${shiftId}`,
    reminder: `shift-end-reminder:${shiftId}`,
  };
}

async function ensureChannel() {
  await notifee.createChannel({
    id: SHIFT_END_CHANNEL_ID,
    name: 'Shift reminders',
    importance: AndroidImportance.HIGH,
  });
}

function noticeBody(kind: 'due' | 'reminder') {
  return kind === 'due'
    ? 'Your scheduled shift end time has passed and you are still clocked in.'
    : 'Reminder: you are still clocked in 30 minutes after your scheduled end time.';
}

async function wasShown(id: string) {
  return (await AsyncStorage.getItem(SHOWN_PREFIX + id)) === '1';
}

async function markShown(id: string) {
  await AsyncStorage.setItem(SHOWN_PREFIX + id, '1');
}

async function displayNotice(id: string, kind: 'due' | 'reminder') {
  if (await wasShown(id)) return;
  await ensureChannel();
  await notifee.displayNotification({
    id,
    title: kind === 'due' ? 'Shift end passed' : 'Still clocked in',
    body: noticeBody(kind),
    data: {
      type: 'personal_notification',
      screen: 'MySchedule',
    },
    android: {
      channelId: SHIFT_END_CHANNEL_ID,
      smallIcon: 'ic_launcher',
      pressAction: { id: 'default' },
      importance: AndroidImportance.HIGH,
    },
  });
  await markShown(id);
}

async function scheduleNotice(id: string, atMs: number, kind: 'due' | 'reminder') {
  await ensureChannel();
  const trigger: TimestampTrigger = {
    type: TriggerType.TIMESTAMP,
    timestamp: atMs,
    alarmManager: {
      allowWhileIdle: true,
    },
  };
  await notifee.createTriggerNotification(
    {
      id,
      title: kind === 'due' ? 'Shift end passed' : 'Still clocked in',
      body: noticeBody(kind),
      data: {
        type: 'personal_notification',
        screen: 'MySchedule',
      },
      android: {
        channelId: SHIFT_END_CHANNEL_ID,
        smallIcon: 'ic_launcher',
        pressAction: { id: 'default' },
        importance: AndroidImportance.HIGH,
      },
    },
    trigger
  );
}

export async function cancelShiftEndReminders(shiftId: string) {
  const ids = shiftEndNoticeIds(shiftId);
  await notifee.cancelNotification(ids.due);
  await notifee.cancelNotification(ids.reminder);
  await notifee.cancelTriggerNotification(ids.due);
  await notifee.cancelTriggerNotification(ids.reminder);
  await AsyncStorage.multiRemove([SHOWN_PREFIX + ids.due, SHOWN_PREFIX + ids.reminder]);
}

export async function syncShiftEndReminders(input: {
  shift: LiveShift | null;
  scheduled: ScheduledShiftRow[];
  nowMs?: number;
}): Promise<string | null> {
  const { shift, scheduled } = input;
  const nowMs = input.nowMs ?? Date.now();
  if (!shift || shift.status !== 'open' || shift.isScheduled) {
    return null;
  }

  const endMs = pickScheduledEndMs(shift, scheduled, nowMs);
  if (endMs == null) {
    await cancelShiftEndReminders(shift.id);
    return null;
  }

  const ids = shiftEndNoticeIds(shift.id);
  const reminderMs = endMs + SHIFT_END_REMINDER_MS;

  if (endMs > nowMs) {
    await scheduleNotice(ids.due, endMs, 'due');
  } else {
    await displayNotice(ids.due, 'due');
  }

  if (reminderMs > nowMs) {
    await scheduleNotice(ids.reminder, reminderMs, 'reminder');
  } else {
    await displayNotice(ids.reminder, 'reminder');
  }

  return `${shift.id}:${endMs}`;
}
