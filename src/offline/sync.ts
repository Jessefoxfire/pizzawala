import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from '@react-native-firebase/firestore';
import {
  clearOfflineOpenShift,
  getOfflineOpenShift,
  loadOutbox,
  removeOutboxItem,
} from './outbox';
import { isDeviceOnline } from './connectivity';
import type { OutboxItem } from './types';
import {
  buildOfflineShiftEndWrite,
  isShiftPaused,
  normalizeShiftPeriods,
  pauseShiftPeriods,
  resumeShiftPeriods,
  type LiveShift,
} from '../services/shifts';

let syncing = false;
const SYNC_ITEM_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      handle = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]).finally(() => {
    if (handle) clearTimeout(handle);
  });
}

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
    workCategory: item.payload.workCategory ?? null,
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
  const periods = pauseShiftPeriods(workPeriods, breakPeriods, nowIso);

  await updateDoc(ref, {
    workPeriods: periods.workPeriods,
    breakPeriods: periods.breakPeriods,
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
  const periods = resumeShiftPeriods(workPeriods, breakPeriods, nowIso);

  await updateDoc(ref, {
    workPeriods: periods.nextWork ? [...periods.workPeriods, periods.nextWork] : periods.workPeriods,
    breakPeriods: periods.breakPeriods,
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
    return;
  }
  const data = { id: snap.id, ...snap.data() } as LiveShift;
  const write = buildOfflineShiftEndWrite(data, item.payload);
  if (write.kind === 'skip') return;
  if (write.kind === 'delete') {
    await deleteDoc(ref);
    return;
  }

  await updateDoc(ref, {
    ...write.fields,
    offlineRecordedAtIso: item.payload.recordedAtIso,
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
      {
        const offline = await getOfflineOpenShift();
        if (offline?.clientShiftId === item.payload.shiftId) {
          await clearOfflineOpenShift();
        }
      }
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
        await withTimeout(syncItem(item), SYNC_ITEM_TIMEOUT_MS);
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
