import AsyncStorage from '@react-native-async-storage/async-storage';

export const SHIFT_EDIT_REQUEST_TYPE = 'shift_edit_request';
const PENDING_KEY = 'pending_shift_edit_review';

export type ShiftEditReviewPayload = {
  shiftId: string;
  employeeUserId: string;
  employeeName: string;
};

let pendingReview: ShiftEditReviewPayload | null = null;
const dismissedShiftIds = new Set<string>();

export function shiftEditRequestCopy(employeeName: string): { title: string; body: string } {
  const name = employeeName.trim() || 'An employee';
  return {
    title: 'Shift edit request',
    body: `${name} has requested a shift edit`,
  };
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseShiftEditReviewFromData(
  data: Record<string, unknown> | undefined | null
): ShiftEditReviewPayload | null {
  if (!data || typeof data !== 'object') return null;

  const nav = data.nav && typeof data.nav === 'object' ? (data.nav as Record<string, unknown>) : {};
  const type = readString(data.type);
  const screen = readString(data.screen) || readString(nav.screen);
  const shiftId =
    readString(data.shiftId) ||
    readString(nav.shiftId) ||
    (screen === 'Home' ? readString(data.eventId) || readString(nav.eventId) : '');
  if (!shiftId) return null;

  const employeeUserId = readString(data.employeeUserId) || readString(nav.employeeUserId);
  const employeeName = readString(data.employeeName) || readString(nav.employeeName);

  if (type === SHIFT_EDIT_REQUEST_TYPE) {
    return { shiftId, employeeUserId, employeeName };
  }

  if (type === 'personal_notification' && (screen === 'Home' || screen === '')) {
    return { shiftId, employeeUserId, employeeName };
  }

  return null;
}

export function parseShiftEditReviewFromUrl(url: string | null | undefined): ShiftEditReviewPayload | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (!/shift_edit_request|shiftId=/i.test(trimmed)) return null;

  try {
    const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed.replace(/^pizzawala:\/\//i, 'https://pizzawala.local/')
      : `https://pizzawala.local/${trimmed.replace(/^\/+/, '')}`;
    const parsed = new URL(normalized);
    const data: Record<string, unknown> = {
      type: parsed.searchParams.get('type') || SHIFT_EDIT_REQUEST_TYPE,
      screen: parsed.searchParams.get('screen') || 'Home',
      shiftId: parsed.searchParams.get('shiftId') || '',
      employeeUserId: parsed.searchParams.get('employeeUserId') || '',
      employeeName: parsed.searchParams.get('employeeName') || '',
      eventId: parsed.searchParams.get('eventId') || '',
    };
    return parseShiftEditReviewFromData(data);
  } catch {
    return null;
  }
}

export function setPendingShiftReview(payload: ShiftEditReviewPayload | null) {
  pendingReview = payload;
  if (payload?.shiftId) {
    dismissedShiftIds.delete(payload.shiftId);
    void AsyncStorage.setItem(PENDING_KEY, JSON.stringify(payload)).catch(() => undefined);
    return;
  }
  void AsyncStorage.removeItem(PENDING_KEY).catch(() => undefined);
}

export function peekPendingShiftReview(): ShiftEditReviewPayload | null {
  return pendingReview;
}

export function takePendingShiftReview(): ShiftEditReviewPayload | null {
  const next = pendingReview;
  pendingReview = null;
  return next;
}

export async function loadPersistedShiftReview(): Promise<ShiftEditReviewPayload | null> {
  if (pendingReview) return pendingReview;
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ShiftEditReviewPayload;
    return parsed?.shiftId ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearPendingShiftReview(shiftId?: string) {
  if (shiftId) dismissedShiftIds.add(shiftId);
  pendingReview = null;
  try {
    await AsyncStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

export function wasShiftReviewDismissed(shiftId: string): boolean {
  return dismissedShiftIds.has(shiftId);
}

export function buildShiftEditAdminNotification(payload: ShiftEditReviewPayload) {
  const copy = shiftEditRequestCopy(payload.employeeName);
  return {
    title: copy.title,
    body: copy.body,
    kind: SHIFT_EDIT_REQUEST_TYPE,
    shiftId: payload.shiftId,
    employeeUserId: payload.employeeUserId,
    employeeName: payload.employeeName,
    nav: {
      screen: 'Home',
      eventId: payload.shiftId,
      shiftId: payload.shiftId,
      employeeUserId: payload.employeeUserId,
      employeeName: payload.employeeName,
    },
  };
}
