import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from '@react-native-firebase/firestore';
import { isDeviceOnline } from '../offline/connectivity';
import {
  createOutboxId,
  enqueueOutbox,
  getOfflineOpenShift,
  setOfflineOpenShift,
  clearOfflineOpenShift,
  createClientShiftId,
  loadOutbox,
  removeOutboxItem,
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
  status: 'open' | 'closed' | 'scheduled';
  locked?: boolean;
  paused?: boolean;
  isScheduled?: boolean;
  geofenceId?: string | null;
  geofenceName?: string | null;
  workCategory?: 'driving' | null;
  worksiteName?: string | null;
  workPeriods?: ShiftPeriod[];
  breakPeriods?: ShiftPeriod[];
  startAt?: unknown;
  endAt?: unknown;
  startedBy?: string;
  endedBy?: string;
  teamId?: string;
  manuallyEdited?: boolean;
  manuallyAdded?: boolean;
  source?: 'clock' | 'employee_added' | string;
  editedBy?: string;
  editedAt?: unknown;
  scheduledShiftId?: string | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  originalStartAt?: string | null;
  originalEndAt?: string | null;
};

export const MIN_ACCOUNTABLE_SHIFT_MS = 60 * 1000;

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

const SHIFT_START_REMOTE_MS = 8000;
const SHIFT_START_FALLBACK_MS = 2500;

async function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        handle = setTimeout(() => reject(new Error('timeout')), ms);
      }),
    ]);
  } finally {
    if (handle) clearTimeout(handle);
  }
}

async function getTeamId(userId: string) {
  const fs = getFirestore();
  const userSnap = await getDoc(doc(fs, 'users', userId));
  return userSnap.data()?.teamId != null ? String(userSnap.data()!.teamId) : 'team-1';
}

async function lookupRemoteOpenLiveShift(userId: string) {
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

async function getOpenLiveShift(userId: string, opts?: { timeoutMs?: number }) {
  const offline = await getOfflineOpenShift();
  if (offline && offline.userId === userId) {
    return offlineOpenShiftToLiveShift(offline);
  }

  if (opts?.timeoutMs != null) {
    try {
      return await raceTimeout(lookupRemoteOpenLiveShift(userId), opts.timeoutMs);
    } catch {
      return null;
    }
  }

  return lookupRemoteOpenLiveShift(userId);
}

export function offlineOpenShiftToLiveShift(offline: import('../offline/types').OfflineOpenShift): LiveShift {
  return {
    id: offline.clientShiftId,
    userId: offline.userId,
    status: 'open',
    paused: offline.paused,
    geofenceId: offline.geofenceId ?? null,
    geofenceName: offline.geofenceName ?? null,
    workCategory: offline.workCategory ?? null,
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
  workCategory?: 'driving' | null;
  startedBy: string;
}): Promise<string> {
  const offline = await getOfflineOpenShift();
  if (offline && offline.userId === params.userId) {
    return offline.clientShiftId;
  }

  let teamId = 'team-1';
  try {
    teamId = await raceTimeout(getTeamId(params.userId), SHIFT_START_FALLBACK_MS);
  } catch {
    /* keep default so clock-in is not blocked on a hanging profile read */
  }
  const nowIso = new Date().toISOString();
  const clientShiftId = createClientShiftId();

  await setOfflineOpenShift({
    clientShiftId,
    userId: params.userId,
    teamId,
    geofenceId: params.geofenceId ?? null,
    geofenceName: params.geofenceName ?? null,
    workCategory: params.workCategory ?? null,
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
      workCategory: params.workCategory ?? null,
      startedBy: params.startedBy,
      recordedAtIso: nowIso,
    },
  });

  return clientShiftId;
}

async function queueShiftPause(shiftId: string, recordedAtIso: string) {
  const offline = await getOfflineOpenShift();
  if (offline && offline.clientShiftId === shiftId) {
    const periods = pauseShiftPeriods(offline.workPeriods, offline.breakPeriods, recordedAtIso);
    await setOfflineOpenShift({
      ...offline,
      workPeriods: periods.workPeriods,
      breakPeriods: periods.breakPeriods,
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
    const periods = resumeShiftPeriods(offline.workPeriods, offline.breakPeriods, recordedAtIso);
    await setOfflineOpenShift({
      ...offline,
      workPeriods: periods.nextWork ? [...periods.workPeriods, periods.nextWork] : periods.workPeriods,
      breakPeriods: periods.breakPeriods,
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

/** One-time cleanup for previously saved accidental taps in a user's history. */
export async function cleanupStoredSubMinuteShiftsForUser(userId: string): Promise<number> {
  if (!userId) return 0;
  const fs = getFirestore();
  const snap = await getDocs(query(collection(fs, 'shifts'), where('userId', '==', userId)));
  const changes: Array<{ ref: ReturnType<typeof doc>; delete?: boolean; periods?: CompactedShiftPeriods }> = [];

  snap.docs.forEach(docSnap => {
    const shift = { id: docSnap.id, ...docSnap.data() } as LiveShift;
    if (shift.status !== 'closed' || shift.isScheduled) return;
    const endMs = getTimestampMs(shift.endAt) || Date.now();
    const { workPeriods, breakPeriods } = normalizeShiftPeriods(shift, endMs);
    const compacted = compactClosedShiftPeriods(workPeriods, breakPeriods, endMs);
    const unchanged =
      JSON.stringify(workPeriods) === JSON.stringify(compacted.workPeriods) &&
      JSON.stringify(breakPeriods) === JSON.stringify(compacted.breakPeriods);
    if (!compacted.hasAccountableWork) {
      changes.push({ ref: docSnap.ref, delete: true });
    } else if (!unchanged) {
      changes.push({ ref: docSnap.ref, periods: compacted });
    }
  });

  for (let start = 0; start < changes.length; start += 450) {
    const batch = writeBatch(fs);
    changes.slice(start, start + 450).forEach(change => {
      if (change.delete) {
        batch.delete(change.ref);
      } else if (change.periods) {
        batch.update(change.ref, {
          workPeriods: change.periods.workPeriods,
          breakPeriods: change.periods.breakPeriods,
          updatedAt: serverTimestamp(),
        });
      }
    });
    await batch.commit();
  }
  return changes.length;
}

type ShiftPeriodKind = 'work' | 'break';

type PeriodSegment = {
  kind: ShiftPeriodKind;
  startMs: number;
  endMs: number;
  period: ShiftPeriod;
};

export type CompactedShiftPeriods = {
  workPeriods: ShiftPeriod[];
  breakPeriods: ShiftPeriod[];
  hasAccountableWork: boolean;
};

/**
 * Removes accidental sub-minute taps from a completed shift. A short break is
 * absorbed by the time immediately before it (normally work), while a short
 * work tap is absorbed by the preceding break. This keeps the actual timeline
 * continuous without leaving 00:00 rows in the hours view.
 */
export function compactClosedShiftPeriods(
  workPeriods: ShiftPeriod[],
  breakPeriods: ShiftPeriod[],
  nowMs = Date.now()
): CompactedShiftPeriods {
  const segments: PeriodSegment[] = [];
  const addPeriods = (kind: ShiftPeriodKind, periods: ShiftPeriod[]) => {
    periods.forEach(period => {
      const startMs = new Date(period.startIso).getTime();
      const endMs = period.endIso ? new Date(period.endIso).getTime() : nowMs;
      if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return;
      segments.push({ kind, startMs, endMs, period });
    });
  };
  addPeriods('work', workPeriods);
  addPeriods('break', breakPeriods);
  segments.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const compacted: PeriodSegment[] = [];
  segments.forEach(segment => {
    const durationMs = segment.endMs - segment.startMs;
    const previous = compacted[compacted.length - 1];

    if (durationMs < MIN_ACCOUNTABLE_SHIFT_MS) {
      // Treat a quick state toggle as uninterrupted time in the previous state.
      if (previous) previous.endMs = Math.max(previous.endMs, segment.endMs);
      return;
    }

    if (previous && previous.kind === segment.kind && previous.endMs >= segment.startMs) {
      previous.endMs = Math.max(previous.endMs, segment.endMs);
      return;
    }
    compacted.push({ ...segment });
  });

  const toPeriods = (kind: ShiftPeriodKind) =>
    compacted
      .filter(segment => segment.kind === kind)
      .map(segment => ({
        ...segment.period,
        startIso: new Date(segment.startMs).toISOString(),
        endIso: new Date(segment.endMs).toISOString(),
      }));
  const compactedWork = toPeriods('work');
  return {
    workPeriods: compactedWork,
    breakPeriods: toPeriods('break'),
    hasAccountableWork: compactedWork.some(period => periodDurationMs(period, nowMs) >= MIN_ACCOUNTABLE_SHIFT_MS),
  };
}

/** Apply a pause while folding a just-created, sub-minute work tap back into its break. */
export function pauseShiftPeriods(workPeriods: ShiftPeriod[], breakPeriods: ShiftPeriod[], nowIso: string) {
  const nextWork = closeLastOpenPeriod(workPeriods, nowIso);
  const lastWork = nextWork[nextWork.length - 1];
  const previousBreak = breakPeriods[breakPeriods.length - 1];
  if (
    lastWork &&
    previousBreak?.endIso &&
    periodDurationMs(lastWork, new Date(nowIso).getTime()) < MIN_ACCOUNTABLE_SHIFT_MS
  ) {
    return {
      workPeriods: nextWork.slice(0, -1),
      breakPeriods: [...breakPeriods.slice(0, -1), { ...previousBreak, endIso: null }],
    };
  }
  return { workPeriods: nextWork, breakPeriods: [...breakPeriods, { startIso: nowIso }] };
}

/** Apply a resume while counting a just-created, sub-minute break as work. */
export function resumeShiftPeriods(workPeriods: ShiftPeriod[], breakPeriods: ShiftPeriod[], nowIso: string) {
  const nextBreak = closeLastOpenPeriod(breakPeriods, nowIso);
  const lastBreak = nextBreak[nextBreak.length - 1];
  const previousWork = workPeriods[workPeriods.length - 1];
  if (
    lastBreak &&
    previousWork?.endIso &&
    periodDurationMs(lastBreak, new Date(nowIso).getTime()) < MIN_ACCOUNTABLE_SHIFT_MS
  ) {
    return {
      workPeriods: [...workPeriods.slice(0, -1), { ...previousWork, endIso: null }],
      breakPeriods: nextBreak.slice(0, -1),
    };
  }
  return { workPeriods, breakPeriods: nextBreak, nextWork: { startIso: nowIso } };
}

async function discardQueuedShift(shiftId: string) {
  const items = await loadOutbox();
  await Promise.all(
    items
      .filter(item => item.clientShiftId === shiftId || ('shiftId' in item.payload && item.payload.shiftId === shiftId))
      .map(item => removeOutboxItem(item.id))
  );
  await clearOfflineOpenShift();
}

export async function startLiveShift(params: {
  userId: string;
  geofenceId?: string | null;
  geofenceName?: string | null;
  workCategory?: 'driving' | null;
  startedBy: string;
}): Promise<string> {
  const offline = await getOfflineOpenShift();
  if (offline && offline.userId === params.userId) {
    return offline.clientShiftId;
  }

  let online = true;
  try {
    online = await raceTimeout(isDeviceOnline(), SHIFT_START_FALLBACK_MS);
  } catch {
    online = true;
  }
  if (!online) {
    return queueShiftStart(params);
  }

  try {
    const fs = getFirestore();
    let teamId = 'team-1';
    try {
      teamId = await raceTimeout(getTeamId(params.userId), SHIFT_START_FALLBACK_MS);
    } catch {
      teamId = 'team-1';
    }
    const nowIso = new Date().toISOString();

    const ref = await raceTimeout(
      addDoc(collection(fs, 'shifts'), {
        userId: params.userId,
        teamId,
        geofenceId: params.geofenceId ?? null,
        geofenceName: params.geofenceName ?? null,
        workCategory: params.workCategory ?? null,
        status: 'open',
        locked: false,
        paused: false,
        workPeriods: [{ startIso: nowIso }],
        breakPeriods: [],
        startAt: serverTimestamp(),
        startedBy: params.startedBy,
      }),
      SHIFT_START_REMOTE_MS
    );

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
    const periods = pauseShiftPeriods(workPeriods, breakPeriods, nowIso);

    await updateDoc(ref, {
      workPeriods: periods.workPeriods,
      breakPeriods: periods.breakPeriods,
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
    const periods = resumeShiftPeriods(workPeriods, breakPeriods, nowIso);

    await updateDoc(ref, {
      workPeriods: periods.nextWork ? [...periods.workPeriods, periods.nextWork] : periods.workPeriods,
      breakPeriods: periods.breakPeriods,
      paused: false,
      updatedAt: serverTimestamp(),
    });
    return { queued: false };
  } catch {
    await queueShiftResume(shiftId, nowIso);
    return { queued: true, clientShiftId: shiftId };
  }
}

async function markVisitProcessedAfterShiftEnd(geofenceId?: string | null) {
  try {
    const { onShiftEnded } = require('../geofencing/notificationPolicy');
    await onShiftEnded(geofenceId);
  } catch (err) {
    console.warn('Failed to mark geofence visit after shift end:', err);
  }
}

export async function endLiveShift(shiftId: string, endedBy = 'manual'): Promise<WriteResult> {
  const nowIso = new Date().toISOString();
  const offline = await getOfflineOpenShift();
  if (offline && offline.clientShiftId === shiftId) {
    if (Date.parse(nowIso) - Date.parse(offline.recordedAtIso) < MIN_ACCOUNTABLE_SHIFT_MS) {
      await discardQueuedShift(shiftId);
      await markVisitProcessedAfterShiftEnd(offline.geofenceId);
      return { queued: false };
    }
    await queueShiftEnd(shiftId, endedBy, nowIso);
    await markVisitProcessedAfterShiftEnd(offline.geofenceId);
    return { queued: true, clientShiftId: shiftId };
  }

  const online = await isDeviceOnline();
  if (!online) {
    await queueShiftEnd(shiftId, endedBy, nowIso);
    await markVisitProcessedAfterShiftEnd(offline?.geofenceId);
    return { queued: true, clientShiftId: shiftId };
  }

  try {
    const fs = getFirestore();
    const ref = doc(fs, 'shifts', shiftId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Shift not found.');
    const data = { id: snap.id, ...snap.data() } as LiveShift;
    if (data.status !== 'open') return { queued: false };

    if (calcShiftSpanMs(data, new Date(nowIso).getTime()) < MIN_ACCOUNTABLE_SHIFT_MS) {
      await deleteDoc(ref);
      await markVisitProcessedAfterShiftEnd(data.geofenceId);
      return { queued: false };
    }

    let { workPeriods, breakPeriods } = normalizeShiftPeriods(data);

    if (isShiftPaused(data)) {
      breakPeriods = closeLastOpenPeriod(breakPeriods, nowIso);
    } else {
      workPeriods = closeLastOpenPeriod(workPeriods, nowIso);
    }

    const compacted = compactClosedShiftPeriods(workPeriods, breakPeriods, new Date(nowIso).getTime());
    if (!compacted.hasAccountableWork) {
      await deleteDoc(ref);
      await markVisitProcessedAfterShiftEnd(data.geofenceId);
      return { queued: false };
    }

    await updateDoc(ref, {
      workPeriods: compacted.workPeriods,
      breakPeriods: compacted.breakPeriods,
      status: 'closed',
      locked: true,
      paused: false,
      endAt: serverTimestamp(),
      endedBy,
      updatedAt: serverTimestamp(),
    });
    try {
      await markVisitProcessedAfterShiftEnd(data.geofenceId);
    } catch (err) {
      console.warn('Failed to mark geofence visit after shift end:', err);
    }
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

export type DaySummarySubmitRow = {
  shiftId?: string;
  added: boolean;
  isOpen?: boolean;
  startIso: string;
  endIso: string;
  originalStartIso: string;
  originalEndIso: string;
  scheduledShiftId?: string | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  timesChanged: boolean;
};

function assertValidActualRange(startIso: string, endIso: string) {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (!startIso || !endIso || Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    throw new Error('Finish time must be after start time.');
  }
}

function closeShiftPeriodsAt(shift: LiveShift, endIso: string) {
  let { workPeriods, breakPeriods } = normalizeShiftPeriods(shift);
  if (isShiftPaused(shift)) {
    breakPeriods = closeLastOpenPeriod(breakPeriods, endIso);
  } else {
    workPeriods = closeLastOpenPeriod(workPeriods, endIso);
  }
  return { workPeriods, breakPeriods };
}

function replaceShiftWithActualRange(
  shift: LiveShift,
  startIso: string,
  endIso: string,
  originalStartIso: string,
  originalEndIso: string
) {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  const { breakPeriods } = normalizeShiftPeriods(shift, endMs);
  const keptBreaks = (breakPeriods || [])
    .filter(period => {
      const periodStart = new Date(period.startIso).getTime();
      const periodEnd = period.endIso ? new Date(period.endIso).getTime() : endMs;
      return periodStart >= startMs && periodEnd <= endMs;
    })
    .map(period => ({ ...period, endIso: period.endIso || endIso }));
  return {
    workPeriods: [
      {
        startIso,
        endIso,
        originalStartIso,
        originalEndIso,
        manuallyEdited: true,
      },
    ],
    breakPeriods: keptBreaks,
  };
}

export async function submitDaySummary(params: {
  userId: string;
  dateKey: string;
  rows: DaySummarySubmitRow[];
  endedBy?: string;
}): Promise<WriteResult> {
  if (!params.userId) throw new Error('You must be signed in to confirm the day.');
  if (!params.rows.length) throw new Error('Add at least one shift before confirming the day.');
  params.rows.forEach(row => assertValidActualRange(row.startIso, row.endIso));

  const pendingChanges = params.rows.some(row => row.added || row.timesChanged);
  const offline = await getOfflineOpenShift();
  const online = await isDeviceOnline();
  const openRow = params.rows.find(row => row.isOpen && !row.added);

  if (!online || (offline && offline.userId === params.userId && pendingChanges)) {
    if (pendingChanges) {
      throw new Error('Connect to the internet to save edited or added hours.');
    }
    if (openRow?.shiftId) {
      return endLiveShift(openRow.shiftId, params.endedBy || 'manual');
    }
    throw new Error('Connect to the internet to confirm the day.');
  }

  const fs = getFirestore();
  const batch = writeBatch(fs);
  let openGeofenceId: string | null | undefined;
  let teamId = 'team-1';
  try {
    teamId = await getTeamId(params.userId);
  } catch {
    teamId = 'team-1';
  }

  for (const row of params.rows) {
    if (row.added) {
      const newRef = doc(collection(fs, 'shifts'));
      batch.set(newRef, {
        userId: params.userId,
        teamId,
        status: 'closed',
        locked: true,
        paused: false,
        isScheduled: false,
        manuallyAdded: true,
        manuallyEdited: true,
        source: 'employee_added',
        startedBy: 'employee_added',
        endedBy: params.endedBy || 'employee_added',
        editedBy: params.userId,
        editedAt: serverTimestamp(),
        workPeriods: [
          {
            startIso: row.startIso,
            endIso: row.endIso,
            originalStartIso: row.startIso,
            originalEndIso: row.endIso,
            manuallyEdited: true,
          },
        ],
        breakPeriods: [],
        startAt: row.startIso,
        endAt: row.endIso,
        updatedAt: serverTimestamp(),
      });
      continue;
    }

    if (!row.shiftId) continue;
    const ref = doc(fs, 'shifts', row.shiftId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Shift not found.');
    const data = { id: snap.id, ...snap.data() } as LiveShift;
    if (data.userId !== params.userId) throw new Error('You can only confirm your own hours.');
    if (data.isScheduled || data.status === 'scheduled') {
      throw new Error('Scheduled shifts cannot be changed from Day Summary.');
    }

    const scheduledFields = {
      scheduledShiftId: row.scheduledShiftId || data.scheduledShiftId || null,
      scheduledStartTime: row.scheduledStartTime || data.scheduledStartTime || null,
      scheduledEndTime: row.scheduledEndTime || data.scheduledEndTime || null,
    };

    if (data.status === 'open') {
      openGeofenceId = data.geofenceId;
      const periods = row.timesChanged
        ? replaceShiftWithActualRange(
            data,
            row.startIso,
            row.endIso,
            row.originalStartIso,
            row.originalEndIso
          )
        : closeShiftPeriodsAt(data, row.endIso);
      batch.update(ref, {
        ...periods,
        ...scheduledFields,
        status: 'closed',
        locked: true,
        paused: false,
        endAt: row.timesChanged ? row.endIso : serverTimestamp(),
        endedBy: params.endedBy || 'manual',
        updatedAt: serverTimestamp(),
        ...(row.timesChanged
          ? {
              manuallyEdited: true,
              editedBy: params.userId,
              editedAt: serverTimestamp(),
              originalStartAt: data.originalStartAt || row.originalStartIso,
              originalEndAt: data.originalEndAt || row.originalEndIso,
            }
          : {}),
      });
      continue;
    }

    if (!row.timesChanged) {
      if (scheduledFields.scheduledShiftId && !data.scheduledShiftId) {
        batch.update(ref, {
          ...scheduledFields,
          updatedAt: serverTimestamp(),
        });
      }
      continue;
    }

    const periods = replaceShiftWithActualRange(
      data,
      row.startIso,
      row.endIso,
      data.workPeriods?.[0]?.originalStartIso || row.originalStartIso,
      data.workPeriods?.[0]?.originalEndIso || row.originalEndIso
    );
    batch.update(ref, {
      ...periods,
      ...scheduledFields,
      locked: true,
      manuallyEdited: true,
      editedBy: params.userId,
      editedAt: serverTimestamp(),
      originalStartAt: data.originalStartAt || row.originalStartIso,
      originalEndAt: data.originalEndAt || row.originalEndIso,
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
  if (openGeofenceId !== undefined) {
    try {
      await markVisitProcessedAfterShiftEnd(openGeofenceId);
    } catch (err) {
      console.warn('Failed to mark geofence visit after shift end:', err);
    }
  }
  return { queued: false };
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
