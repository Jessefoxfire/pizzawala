import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@react-native-firebase/firestore';
import { isDeviceOnline } from '../offline/connectivity';
import {
  createOutboxId,
  enqueueOutbox,
  getOfflineOpenShift,
  setOfflineOpenShift,
  clearOfflineOpenShift,
  createClientShiftId,
} from '../offline/outbox';
import type { WriteResult } from '../offline/types';

export type ShiftPeriod = {
  startIso: string;
  endIso?: string | null;
  /** First recorded values before any manual edit. */
  originalStartIso?: string;
  originalEndIso?: string | null;
  manuallyEdited?: boolean;
};

export type LiveShift = {
  id: string;
  userId: string;
  status: 'open' | 'closed';
  locked?: boolean;
  paused?: boolean;
  isScheduled?: boolean;
  geofenceId?: string | null;
  geofenceName?: string | null;
  worksiteName?: string | null;
  workPeriods?: ShiftPeriod[];
  breakPeriods?: ShiftPeriod[];
  startAt?: unknown;
  endAt?: unknown;
  startedBy?: string;
  endedBy?: string;
};

export function getTimestampMs(raw: unknown, fallbackIso?: string | null): number {
  if (raw && typeof raw === 'object' && typeof (raw as any).toDate === 'function') {
    try {
      return (raw as any).toDate().getTime();
    } catch {
      /* fall through */
    }
  }
  if (typeof raw === 'string') {
    const parsed = new Date(raw).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (fallbackIso) {
    const parsed = new Date(fallbackIso).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function periodDurationMs(period: ShiftPeriod, nowMs: number): number {
  const start = new Date(period.startIso).getTime();
  if (Number.isNaN(start)) return 0;
  const end = period.endIso ? new Date(period.endIso).getTime() : nowMs;
  if (Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}

function sumPeriodsMs(periods: ShiftPeriod[] | undefined, nowMs: number): number {
  if (!Array.isArray(periods)) return 0;
  return periods.reduce((total, period) => total + periodDurationMs(period, nowMs), 0);
}

export function closeLastOpenPeriod(periods: ShiftPeriod[], endIso: string): ShiftPeriod[] {
  const copy = periods.map(period => ({ ...period }));
  for (let i = copy.length - 1; i >= 0; i -= 1) {
    if (!copy[i].endIso) {
      copy[i] = { ...copy[i], endIso };
      return copy;
    }
  }
  return copy;
}

export function normalizeShiftPeriods(shift: LiveShift | Record<string, unknown>, nowMs = Date.now()) {
  const typed = shift as LiveShift;
  if (Array.isArray(typed.workPeriods) && typed.workPeriods.length > 0) {
    return {
      workPeriods: typed.workPeriods,
      breakPeriods: typed.breakPeriods || [],
    };
  }

  const startMs = getTimestampMs(typed.startAt);
  if (!startMs) {
    return { workPeriods: [] as ShiftPeriod[], breakPeriods: [] as ShiftPeriod[] };
  }

  const endMs =
    typed.status === 'closed' ? getTimestampMs(typed.endAt) || nowMs : nowMs;
  return {
    workPeriods: [
      {
        startIso: new Date(startMs).toISOString(),
        endIso: typed.status === 'closed' ? new Date(endMs).toISOString() : null,
      },
    ],
    breakPeriods: [] as ShiftPeriod[],
  };
}

/** Total time from shift start to end (or now). */
export function calcShiftSpanMs(shift: LiveShift | Record<string, unknown>, nowMs = Date.now()): number {
  const startMs = getTimestampMs((shift as LiveShift).startAt);
  if (!startMs) return 0;
  const endMs =
    (shift as LiveShift).status === 'closed'
      ? getTimestampMs((shift as LiveShift).endAt) || nowMs
      : nowMs;
  return Math.max(0, endMs - startMs);
}

export function calcBreakMs(shift: LiveShift | Record<string, unknown>, nowMs = Date.now()): number {
  const { breakPeriods } = normalizeShiftPeriods(shift, nowMs);
  return sumPeriodsMs(breakPeriods, nowMs);
}

/** Duration of the current open break (resets when pause starts). */
export function calcCurrentPauseMs(shift: LiveShift | Record<string, unknown>, nowMs = Date.now()): number {
  const { breakPeriods } = normalizeShiftPeriods(shift, nowMs);
  if (!Array.isArray(breakPeriods)) return 0;
  for (let i = breakPeriods.length - 1; i >= 0; i -= 1) {
    const period = breakPeriods[i];
    if (!period.endIso) {
      return periodDurationMs(period, nowMs);
    }
  }
  return 0;
}

/** Worked time = shift span − breaks (equivalent to summed work periods). */
export function calcWorkedMs(shift: LiveShift | Record<string, unknown>, nowMs = Date.now()): number {
  const { workPeriods } = normalizeShiftPeriods(shift, nowMs);
  if (Array.isArray((shift as LiveShift).workPeriods) && (shift as LiveShift).workPeriods!.length > 0) {
    return sumPeriodsMs(workPeriods, nowMs);
  }
  return Math.max(0, calcShiftSpanMs(shift, nowMs) - calcBreakMs(shift, nowMs));
}

/** Worked time clipped to an inclusive date/time range. */
export function calcWorkedMsInRange(
  shift: LiveShift | Record<string, unknown>,
  rangeStartMs: number,
  rangeEndMs: number,
  nowMs = Date.now()
): number {
  const { workPeriods } = normalizeShiftPeriods(shift, nowMs);
  let total = 0;
  workPeriods.forEach(period => {
    const periodStart = new Date(period.startIso).getTime();
    const periodEnd = period.endIso ? new Date(period.endIso).getTime() : nowMs;
    if (Number.isNaN(periodStart) || Number.isNaN(periodEnd)) return;
    const clippedStart = Math.max(periodStart, rangeStartMs);
    const clippedEnd = Math.min(periodEnd, rangeEndMs);
    if (clippedEnd > clippedStart) total += clippedEnd - clippedStart;
  });
  return total;
}

export function shiftOverlapsRange(
  shift: LiveShift | Record<string, unknown>,
  rangeStartMs: number,
  rangeEndMs: number,
  nowMs = Date.now()
): boolean {
  const { workPeriods } = normalizeShiftPeriods(shift, nowMs);
  return workPeriods.some(period => {
    const periodStart = new Date(period.startIso).getTime();
    const periodEnd = period.endIso ? new Date(period.endIso).getTime() : nowMs;
    if (Number.isNaN(periodStart) || Number.isNaN(periodEnd)) return false;
    return periodEnd > rangeStartMs && periodStart < rangeEndMs;
  });
}

export function isShiftPaused(shift: LiveShift | Record<string, unknown>): boolean {
  const typed = shift as LiveShift;
  if (typed.paused === true) return true;
  const { workPeriods, breakPeriods } = normalizeShiftPeriods(typed);
  const openBreak = breakPeriods.some(period => !period.endIso);
  const openWork = workPeriods.some(period => !period.endIso);
  return openBreak && !openWork;
}

export function isLiveShiftRecord(shift: { status?: string; isScheduled?: boolean }) {
  return shift.status === 'open' || shift.status === 'closed';
}

export function formatShiftDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function formatCompactDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

async function getTeamId(userId: string) {
  const fs = getFirestore();
  const userSnap = await getDoc(doc(fs, 'users', userId));
  return userSnap.data()?.teamId != null ? String(userSnap.data()!.teamId) : 'team-1';
}

async function getOpenLiveShift(userId: string) {
  const offline = await getOfflineOpenShift();
  if (offline && offline.userId === userId) {
    return offlineOpenShiftToLiveShift(offline);
  }

  const fs = getFirestore();
  const snap = await getDocs(
    query(collection(fs, 'shifts'), where('userId', '==', userId), where('status', '==', 'open'), limit(5))
  );
  const live = snap.docs
    .map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as LiveShift))
    .filter(shift => !shift.isScheduled)
    .sort((a, b) => getTimestampMs(b.startAt) - getTimestampMs(a.startAt));
  return live[0] || null;
}

export function offlineOpenShiftToLiveShift(offline: import('../offline/types').OfflineOpenShift): LiveShift {
  return {
    id: offline.clientShiftId,
    userId: offline.userId,
    status: 'open',
    paused: offline.paused,
    geofenceId: offline.geofenceId ?? null,
    geofenceName: offline.geofenceName ?? null,
    workPeriods: offline.workPeriods,
    breakPeriods: offline.breakPeriods,
    startAt: offline.recordedAtIso,
    startedBy: offline.startedBy,
  };
}

async function queueShiftStart(params: {
  userId: string;
  geofenceId?: string | null;
  geofenceName?: string | null;
  startedBy: string;
}): Promise<string> {
  const existing = await getOpenLiveShift(params.userId);
  if (existing) return existing.id;

  const teamId = await getTeamId(params.userId);
  const nowIso = new Date().toISOString();
  const clientShiftId = createClientShiftId();

  await setOfflineOpenShift({
    clientShiftId,
    userId: params.userId,
    teamId,
    geofenceId: params.geofenceId ?? null,
    geofenceName: params.geofenceName ?? null,
    startedBy: params.startedBy,
    recordedAtIso: nowIso,
    workPeriods: [{ startIso: nowIso }],
    breakPeriods: [],
    paused: false,
    status: 'open',
    pendingSync: true,
  });

  await enqueueOutbox({
    id: createOutboxId(),
    type: 'shift_start',
    createdAt: nowIso,
    clientShiftId,
    payload: {
      userId: params.userId,
      teamId,
      geofenceId: params.geofenceId ?? null,
      geofenceName: params.geofenceName ?? null,
      startedBy: params.startedBy,
      recordedAtIso: nowIso,
    },
  });

  return clientShiftId;
}

async function queueShiftPause(shiftId: string, recordedAtIso: string) {
  const offline = await getOfflineOpenShift();
  if (offline && offline.clientShiftId === shiftId) {
    const nextWork = closeLastOpenPeriod(offline.workPeriods, recordedAtIso);
    const nextBreak = [...offline.breakPeriods, { startIso: recordedAtIso }];
    await setOfflineOpenShift({
      ...offline,
      workPeriods: nextWork,
      breakPeriods: nextBreak,
      paused: true,
    });
  }

  await enqueueOutbox({
    id: createOutboxId(),
    type: 'shift_pause',
    createdAt: recordedAtIso,
    payload: { shiftId, recordedAtIso },
  });
}

async function queueShiftResume(shiftId: string, recordedAtIso: string) {
  const offline = await getOfflineOpenShift();
  if (offline && offline.clientShiftId === shiftId) {
    const nextBreak = closeLastOpenPeriod(offline.breakPeriods, recordedAtIso);
    const nextWork = [...offline.workPeriods, { startIso: recordedAtIso }];
    await setOfflineOpenShift({
      ...offline,
      workPeriods: nextWork,
      breakPeriods: nextBreak,
      paused: false,
    });
  }

  await enqueueOutbox({
    id: createOutboxId(),
    type: 'shift_resume',
    createdAt: recordedAtIso,
    payload: { shiftId, recordedAtIso },
  });
}

async function queueShiftEnd(shiftId: string, endedBy: string, recordedAtIso: string) {
  const offline = await getOfflineOpenShift();
  if (offline && offline.clientShiftId === shiftId) {
    await clearOfflineOpenShift();
  }

  await enqueueOutbox({
    id: createOutboxId(),
    type: 'shift_end',
    createdAt: recordedAtIso,
    payload: { shiftId, endedBy, recordedAtIso },
  });
}

export async function startLiveShift(params: {
  userId: string;
  geofenceId?: string | null;
  geofenceName?: string | null;
  startedBy: string;
}): Promise<string> {
  const existing = await getOpenLiveShift(params.userId);
  if (existing) return existing.id;

  const online = await isDeviceOnline();
  if (!online) {
    return queueShiftStart(params);
  }

  try {
    const fs = getFirestore();
    const teamId = await getTeamId(params.userId);
    const nowIso = new Date().toISOString();

    const ref = await addDoc(collection(fs, 'shifts'), {
      userId: params.userId,
      teamId,
      geofenceId: params.geofenceId ?? null,
      geofenceName: params.geofenceName ?? null,
      status: 'open',
      locked: false,
      paused: false,
      workPeriods: [{ startIso: nowIso }],
      breakPeriods: [],
      startAt: serverTimestamp(),
      startedBy: params.startedBy,
    });

    return ref.id;
  } catch {
    return queueShiftStart(params);
  }
}

export async function pauseLiveShift(shiftId: string): Promise<WriteResult> {
  const nowIso = new Date().toISOString();
  const offline = await getOfflineOpenShift();
  if (offline && offline.clientShiftId === shiftId) {
    await queueShiftPause(shiftId, nowIso);
    return { queued: true, clientShiftId: shiftId };
  }

  const online = await isDeviceOnline();
  if (!online) {
    await queueShiftPause(shiftId, nowIso);
    return { queued: true, clientShiftId: shiftId };
  }

  try {
    const fs = getFirestore();
    const ref = doc(fs, 'shifts', shiftId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Shift not found.');
    const data = { id: snap.id, ...snap.data() } as LiveShift;
    if (data.status !== 'open' || data.locked) throw new Error('Shift is not active.');
    if (isShiftPaused(data)) return { queued: false };

    const { workPeriods, breakPeriods } = normalizeShiftPeriods(data);
    const nextWork = closeLastOpenPeriod(workPeriods, nowIso);
    const nextBreak = [...breakPeriods, { startIso: nowIso }];

    await updateDoc(ref, {
      workPeriods: nextWork,
      breakPeriods: nextBreak,
      paused: true,
      updatedAt: serverTimestamp(),
    });
    return { queued: false };
  } catch {
    await queueShiftPause(shiftId, nowIso);
    return { queued: true, clientShiftId: shiftId };
  }
}

export async function resumeLiveShift(shiftId: string): Promise<WriteResult> {
  const nowIso = new Date().toISOString();
  const offline = await getOfflineOpenShift();
  if (offline && offline.clientShiftId === shiftId) {
    await queueShiftResume(shiftId, nowIso);
    return { queued: true, clientShiftId: shiftId };
  }

  const online = await isDeviceOnline();
  if (!online) {
    await queueShiftResume(shiftId, nowIso);
    return { queued: true, clientShiftId: shiftId };
  }

  try {
    const fs = getFirestore();
    const ref = doc(fs, 'shifts', shiftId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Shift not found.');
    const data = { id: snap.id, ...snap.data() } as LiveShift;
    if (data.status !== 'open' || data.locked) throw new Error('Shift is not active.');
    if (!isShiftPaused(data)) return { queued: false };

    const { workPeriods, breakPeriods } = normalizeShiftPeriods(data);
    const nextBreak = closeLastOpenPeriod(breakPeriods, nowIso);
    const nextWork = [...workPeriods, { startIso: nowIso }];

    await updateDoc(ref, {
      workPeriods: nextWork,
      breakPeriods: nextBreak,
      paused: false,
      updatedAt: serverTimestamp(),
    });
    return { queued: false };
  } catch {
    await queueShiftResume(shiftId, nowIso);
    return { queued: true, clientShiftId: shiftId };
  }
}

export async function endLiveShift(shiftId: string, endedBy = 'manual'): Promise<WriteResult> {
  const nowIso = new Date().toISOString();
  const offline = await getOfflineOpenShift();
  if (offline && offline.clientShiftId === shiftId) {
    await queueShiftEnd(shiftId, endedBy, nowIso);
    return { queued: true, clientShiftId: shiftId };
  }

  const online = await isDeviceOnline();
  if (!online) {
    await queueShiftEnd(shiftId, endedBy, nowIso);
    return { queued: true, clientShiftId: shiftId };
  }

  try {
    const fs = getFirestore();
    const ref = doc(fs, 'shifts', shiftId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Shift not found.');
    const data = { id: snap.id, ...snap.data() } as LiveShift;
    if (data.status !== 'open') return { queued: false };

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
      endedBy,
      updatedAt: serverTimestamp(),
    });
    return { queued: false };
  } catch {
    await queueShiftEnd(shiftId, endedBy, nowIso);
    return { queued: true, clientShiftId: shiftId };
  }
}

export async function endLiveShiftForUser(userId: string, endedBy = 'geofence') {
  const open = await getOpenLiveShift(userId);
  if (!open) return;
  await endLiveShift(open.id, endedBy);
}

export async function updateShiftPeriodTimes(
  shiftId: string,
  kind: 'work' | 'break',
  periodIndex: number,
  startIso: string,
  endIso: string
) {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    throw new Error('Finish time must be after start time.');
  }

  const fs = getFirestore();
  const ref = doc(fs, 'shifts', shiftId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Shift not found.');
  const data = { id: snap.id, ...snap.data() } as LiveShift;
  if (data.locked) throw new Error('This shift is locked and cannot be edited.');

  const { workPeriods, breakPeriods } = normalizeShiftPeriods(data);
  const periods = kind === 'work' ? [...workPeriods] : [...breakPeriods];
  if (periodIndex < 0 || periodIndex >= periods.length) {
    throw new Error('Time slot not found.');
  }

  const current = periods[periodIndex];
  if (!current.endIso && data.status === 'open') {
    throw new Error('Pause or end the active timer before editing this slot.');
  }

  periods[periodIndex] = {
    startIso,
    endIso,
    manuallyEdited: true,
    originalStartIso: current.originalStartIso || current.startIso,
    originalEndIso:
      current.originalEndIso !== undefined ? current.originalEndIso : current.endIso ?? null,
  };

  await updateDoc(ref, {
    [kind === 'work' ? 'workPeriods' : 'breakPeriods']: periods,
    manuallyEdited: true,
    updatedAt: serverTimestamp(),
  });
}
