import {
  addDoc,
  collection,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from '@react-native-firebase/firestore';
import {
  clearOfflineOpenShift,
  loadOutbox,
  removeOutboxItem,
} from './outbox';
import { isDeviceOnline } from './connectivity';
import type { OutboxItem } from './types';
import {
  closeLastOpenPeriod,
  isShiftPaused,
  normalizeShiftPeriods,
  type LiveShift,
} from '../services/shifts';

let syncing = false;

const OUTBOX_TYPE_ORDER: Record<OutboxItem['type'], number> = {
  shift_start: 0,
  shift_pause: 1,
  shift_resume: 2,
  shift_end: 3,
  temperature_log: 4,
};

function sortOutboxItems(items: OutboxItem[]): OutboxItem[] {
  return [...items].sort((a, b) => {
    const typeDelta = OUTBOX_TYPE_ORDER[a.type] - OUTBOX_TYPE_ORDER[b.type];
    if (typeDelta !== 0) return typeDelta;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

async function syncTemperatureLog(item: Extract<OutboxItem, { type: 'temperature_log' }>) {
  const fs = getFirestore();
  await addDoc(collection(fs, 'hygieneTemperatureLogs'), {
    ...item.payload.actor,
    targetKey: item.payload.targetKey,
    targetLabel: item.payload.targetLabel,
    temperatureValue: item.payload.temperatureValue,
    temperatureUnit: item.payload.temperatureUnit,
    notes: item.payload.notes,
    dateKey: item.payload.dateKey,
    monthKey: item.payload.monthKey,
    loggedAtIso: item.payload.loggedAtIso,
    loggedAt: serverTimestamp(),
    source: 'offline',
    offlineOutboxId: item.id,
  });
}

async function syncShiftStart(item: Extract<OutboxItem, { type: 'shift_start' }>) {
  const fs = getFirestore();
  const ref = doc(fs, 'shifts', item.clientShiftId);
  const existing = await getDoc(ref);
  if (existing.exists()) return;

  await setDoc(ref, {
    userId: item.payload.userId,
    teamId: item.payload.teamId,
    geofenceId: item.payload.geofenceId ?? null,
    geofenceName: item.payload.geofenceName ?? null,
    status: 'open',
    locked: false,
    paused: false,
    workPeriods: [{ startIso: item.payload.recordedAtIso }],
    breakPeriods: [],
    startAt: serverTimestamp(),
    startedBy: item.payload.startedBy,
    offlineRecordedAtIso: item.payload.recordedAtIso,
    source: 'offline',
    offlineOutboxId: item.id,
  });
}

async function syncShiftPause(item: Extract<OutboxItem, { type: 'shift_pause' }>) {
  const fs = getFirestore();
  const ref = doc(fs, 'shifts', item.payload.shiftId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    console.warn('[Offline] Dropping stale pause — shift missing:', item.payload.shiftId);
    return;
  }
  const data = { id: snap.id, ...snap.data() } as LiveShift;
  if (data.status !== 'open' || isShiftPaused(data)) return;

  const nowIso = item.payload.recordedAtIso;
  const { workPeriods, breakPeriods } = normalizeShiftPeriods(data);
  const nextWork = closeLastOpenPeriod(workPeriods, nowIso);
  const nextBreak = [...breakPeriods, { startIso: nowIso }];

  await updateDoc(ref, {
    workPeriods: nextWork,
    breakPeriods: nextBreak,
    paused: true,
    updatedAt: serverTimestamp(),
    source: 'offline',
  });
}

async function syncShiftResume(item: Extract<OutboxItem, { type: 'shift_resume' }>) {
  const fs = getFirestore();
  const ref = doc(fs, 'shifts', item.payload.shiftId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    console.warn('[Offline] Dropping stale resume — shift missing:', item.payload.shiftId);
    return;
  }
  const data = { id: snap.id, ...snap.data() } as LiveShift;
  if (data.status !== 'open' || !isShiftPaused(data)) return;

  const nowIso = item.payload.recordedAtIso;
  const { workPeriods, breakPeriods } = normalizeShiftPeriods(data);
  const nextBreak = closeLastOpenPeriod(breakPeriods, nowIso);
  const nextWork = [...workPeriods, { startIso: nowIso }];

  await updateDoc(ref, {
    workPeriods: nextWork,
    breakPeriods: nextBreak,
    paused: false,
    updatedAt: serverTimestamp(),
    source: 'offline',
  });
}

async function syncShiftEnd(item: Extract<OutboxItem, { type: 'shift_end' }>) {
  const fs = getFirestore();
  const ref = doc(fs, 'shifts', item.payload.shiftId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    console.warn('[Offline] Dropping stale end — shift missing:', item.payload.shiftId);
    await clearOfflineOpenShift();
    return;
  }
  const data = { id: snap.id, ...snap.data() } as LiveShift;
  if (data.status !== 'open') {
    await clearOfflineOpenShift();
    return;
  }

  const nowIso = item.payload.recordedAtIso;
  let { workPeriods, breakPeriods } = normalizeShiftPeriods(data);

  if (isShiftPaused(data)) {
    breakPeriods = closeLastOpenPeriod(breakPeriods, nowIso);
  } else {
    workPeriods = closeLastOpenPeriod(workPeriods, nowIso);
  }

  await updateDoc(ref, {
    workPeriods,
    breakPeriods,
    status: 'closed',
    locked: true,
    paused: false,
    endAt: serverTimestamp(),
    endedBy: item.payload.endedBy,
    offlineRecordedAtIso: nowIso,
    updatedAt: serverTimestamp(),
    source: 'offline',
  });
}

async function syncItem(item: OutboxItem): Promise<void> {
  switch (item.type) {
    case 'temperature_log':
      await syncTemperatureLog(item);
      return;
    case 'shift_start':
      await syncShiftStart(item);
      return;
    case 'shift_pause':
      await syncShiftPause(item);
      return;
    case 'shift_resume':
      await syncShiftResume(item);
      return;
    case 'shift_end':
      await syncShiftEnd(item);
      await clearOfflineOpenShift();
      return;
    default:
      return;
  }
}

export async function flushOutbox(): Promise<{ synced: number; failed: number }> {
  if (syncing) return { synced: 0, failed: 0 };
  const online = await isDeviceOnline();
  if (!online) return { synced: 0, failed: 0 };

  syncing = true;
  let synced = 0;
  let failed = 0;

  try {
    const items = sortOutboxItems(await loadOutbox());
    for (const item of items) {
      try {
        await syncItem(item);
        await removeOutboxItem(item.id);
        synced += 1;
      } catch (error) {
        console.warn('[Offline] Failed to sync outbox item:', item.type, error);
        failed += 1;
        break;
      }
    }
  } finally {
    syncing = false;
  }

  return { synced, failed };
}
