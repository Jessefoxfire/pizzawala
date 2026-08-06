import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OfflineOpenShift, OutboxItem } from './types';
import { notifyOutboxChanged } from './events';

const OUTBOX_KEY = 'offline_outbox_v1';
const OFFLINE_OPEN_SHIFT_KEY = 'offline_open_shift_v1';

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
  return `offline-${randomId()}`;
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
