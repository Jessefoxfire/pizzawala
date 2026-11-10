import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OfflineClosedShift, OfflineOpenShift, OutboxItem, PendingShiftEnd } from './types';
import { notifyOutboxChanged } from './events';

const OUTBOX_KEY = 'offline_outbox_v1';
const OFFLINE_OPEN_SHIFT_KEY = 'offline_open_shift_v1';
const OFFLINE_CLOSED_SHIFTS_KEY = 'offline_closed_shifts_v1';
const LAST_OPEN_SHIFT_ID_KEY = 'last_open_shift_id_v1';

const randomId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export async function loadOutbox(): Promise<OutboxItem[]> {
  const raw = await AsyncStorage.getItem(OUTBOX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

async function saveOutbox(items: OutboxItem[]): Promise<void> {
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  notifyOutboxChanged();
}

export async function getOutboxCount(): Promise<number> {
  const items = await loadOutbox();
  return items.length;
}

export async function enqueueOutbox(item: OutboxItem): Promise<void> {
  const items = await loadOutbox();
  items.push(item);
  await saveOutbox(items);
}

export async function removeOutboxItem(id: string): Promise<void> {
  const items = await loadOutbox();
  const next = items.filter(item => item.id !== id);
  await saveOutbox(next);
}

export async function replaceOutbox(items: OutboxItem[]): Promise<void> {
  await saveOutbox(items);
}

export function createOutboxId(): string {
  return randomId();
}

export function createClientShiftId(): string {
  return `shift-${randomId()}`;
}

export function outboxTouchesShift(item: OutboxItem, shiftId: string): boolean {
  if (item.type === 'shift_start') return item.clientShiftId === shiftId;
  if (item.type === 'temperature_log') return false;
  return item.payload.shiftId === shiftId;
}

export function outboxHasPendingStart(items: OutboxItem[], shiftId: string): boolean {
  return items.some(item => item.type === 'shift_start' && item.clientShiftId === shiftId);
}

export async function getOfflineOpenShift(): Promise<OfflineOpenShift | null> {
  const raw = await AsyncStorage.getItem(OFFLINE_OPEN_SHIFT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OfflineOpenShift;
  } catch {
    return null;
  }
}

export async function setOfflineOpenShift(shift: OfflineOpenShift): Promise<void> {
  await AsyncStorage.setItem(OFFLINE_OPEN_SHIFT_KEY, JSON.stringify(shift));
  notifyOutboxChanged();
}

export async function clearOfflineOpenShift(): Promise<void> {
  await AsyncStorage.removeItem(OFFLINE_OPEN_SHIFT_KEY);
  notifyOutboxChanged();
}

export async function getOfflineClosedShifts(): Promise<OfflineClosedShift[]> {
  const raw = await AsyncStorage.getItem(OFFLINE_CLOSED_SHIFTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OfflineClosedShift[]) : [];
  } catch {
    return [];
  }
}

async function saveOfflineClosedShifts(shifts: OfflineClosedShift[]): Promise<void> {
  if (!shifts.length) {
    await AsyncStorage.removeItem(OFFLINE_CLOSED_SHIFTS_KEY);
  } else {
    await AsyncStorage.setItem(OFFLINE_CLOSED_SHIFTS_KEY, JSON.stringify(shifts));
  }
  notifyOutboxChanged();
}

export async function upsertOfflineClosedShift(shift: OfflineClosedShift): Promise<void> {
  const current = await getOfflineClosedShifts();
  const next = current.filter(item => item.clientShiftId !== shift.clientShiftId);
  next.push(shift);
  await saveOfflineClosedShifts(next);
}

export async function removeOfflineClosedShift(shiftId: string): Promise<void> {
  const current = await getOfflineClosedShifts();
  const next = current.filter(item => item.clientShiftId !== shiftId);
  if (next.length === current.length) return;
  await saveOfflineClosedShifts(next);
}

export async function rememberOpenShiftId(shiftId: string): Promise<void> {
  if (!shiftId) return;
  await AsyncStorage.setItem(LAST_OPEN_SHIFT_ID_KEY, shiftId);
}

export async function getRememberedOpenShiftId(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_OPEN_SHIFT_ID_KEY);
}

export async function forgetOpenShiftId(shiftId?: string): Promise<void> {
  if (!shiftId) {
    await AsyncStorage.removeItem(LAST_OPEN_SHIFT_ID_KEY);
    return;
  }
  const current = await AsyncStorage.getItem(LAST_OPEN_SHIFT_ID_KEY);
  if (current === shiftId) await AsyncStorage.removeItem(LAST_OPEN_SHIFT_ID_KEY);
}

export async function getPendingShiftEnds(): Promise<PendingShiftEnd[]> {
  const items = await loadOutbox();
  const byId = new Map<string, PendingShiftEnd>();
  items.forEach(item => {
    if (item.type !== 'shift_end') return;
    const existing = byId.get(item.payload.shiftId);
    if (!existing || item.payload.recordedAtIso < existing.recordedAtIso) {
      byId.set(item.payload.shiftId, item.payload);
    }
  });
  return [...byId.values()];
}
