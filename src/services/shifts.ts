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
  getPendingShiftEnds,
  setOfflineOpenShift,
  clearOfflineOpenShift,
  createClientShiftId,
  forgetOpenShiftId,
  getRememberedOpenShiftId,
  loadOutbox,
  rememberOpenShiftId,
  removeOutboxItem,
  replaceOutbox,
} from '../offline/outbox';
import type { PendingShiftEnd, ShiftEndPayload, WriteResult } from '../offline/types';

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
const SHIFT_END_REMOTE_MS = 8000;
const SHIFT_SUMMARY_REMOTE_MS = 12000;

const PERMANENT_SHIFT_ERRORS = new Set([
  'Finish time must be after start time.',
  'You must be signed in to confirm the day.',
  'Add at least one shift before confirming the day.',
  'You can only confirm your own hours.',
  'Scheduled shifts cannot be changed from Day Summary.',
  'Connect to the internet to save edited or added hours.',
  'Connect to the internet to confirm the day.',
]);

type ShiftEndOptions = {
  recordedAtIso?: string;
  timesChanged?: boolean;
  actualStartIso?: string;
  actualEndIso?: string;
  originalStartIso?: string;
  originalEndIso?: string;
  editedBy?: string;
};

function isRetryableOfflineError(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  if (PERMANENT_SHIFT_ERRORS.has(err.message)) return false;
  const code = String((err as { code?: string }).code || '');
  if (code.includes('permission-denied') || code.includes('unauthenticated') || code.includes('invalid-argument')) {
    return false;
  }
  return true;
}

function toShiftEndPayload(
  shiftId: string,
  endedBy: string,
  recordedAtIso: string,
  options?: ShiftEndOptions
): ShiftEndPayload {
  const timesChanged = !!(options?.timesChanged && options.actualStartIso && options.actualEndIso);
  return {
    shiftId,
    endedBy,
    recordedAtIso: timesChanged ? options!.actualEndIso! : recordedAtIso,
    ...(timesChanged
      ? {
          timesChanged: true,
          actualStartIso: options!.actualStartIso,
          actualEndIso: options!.actualEndIso,
          originalStartIso: options!.originalStartIso,
          originalEndIso: options!.originalEndIso,
          editedBy: options!.editedBy,
        }
      : {}),
  };
}

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
  const pendingIds = new Set((await getPendingShiftEnds()).map(item => item.shiftId));
  const offline = await getOfflineOpenShift();
  if (offline && offline.userId === userId && !pendingIds.has(offline.clientShiftId)) {
    await rememberOpenShiftId(offline.clientShiftId);
    return offlineOpenShiftToLiveShift(offline);
  }

  const lookup = async () => {
    const shift = await lookupRemoteOpenLiveShift(userId);
    if (!shift || pendingIds.has(shift.id)) return null;
    await rememberOpenShiftId(shift.id);
    return shift;
  };

  if (opts?.timeoutMs != null) {
    try {
      return await raceTimeout(lookup(), opts.timeoutMs);
    } catch {
      return null;
    }
  }

  return lookup();
}

export async function hasClockedInShift(userId: string): Promise<boolean> {
  if (!userId) return false;
  const open = await getOpenLiveShift(userId, { timeoutMs: SHIFT_END_REMOTE_MS });
  return !!open;
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
    await rememberOpenShiftId(offline.clientShiftId);
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

  await rememberOpenShiftId(clientShiftId);
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

async function queueShiftEnd(
  shiftId: string,
  endedBy: string,
  recordedAtIso: string,
  options?: ShiftEndOptions
) {
  const offline = await getOfflineOpenShift();
  if (offline && offline.clientShiftId === shiftId) {
    await clearOfflineOpenShift();
  }

  await forgetOpenShiftId(shiftId);
  const payload = toShiftEndPayload(shiftId, endedBy, recordedAtIso, options);
  const items = await loadOutbox();
  const index = items.findIndex(item => item.type === 'shift_end' && item.payload.shiftId === shiftId);
  const next = {
    id: index >= 0 ? items[index].id : createOutboxId(),
    type: 'shift_end' as const,
    createdAt: payload.recordedAtIso,
    payload,
  };
  if (index >= 0) items[index] = next;
  else items.push(next);
  await replaceOutbox(items);
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
      .filter(item =>
        (item.type === 'shift_start' && item.clientShiftId === shiftId) ||
        ('shiftId' in item.payload && item.payload.shiftId === shiftId)
      )
      .map(item => removeOutboxItem(item.id))
  );
  await clearOfflineOpenShift();
  await forgetOpenShiftId(shiftId);
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
    await rememberOpenShiftId(offline.clientShiftId);
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

    await rememberOpenShiftId(ref.id);
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

async function queueLiveShiftEnd(shiftId: string, endedBy: string, recordedAtIso: string, options: ShiftEndOptions | undefined, geofenceId?: string | null) {
  await queueShiftEnd(shiftId, endedBy, recordedAtIso, options);
  await markVisitProcessedAfterShiftEnd(geofenceId);
  return { queued: true, clientShiftId: shiftId } satisfies WriteResult;
}

export async function endLiveShift(shiftId: string, endedBy = 'manual', options?: ShiftEndOptions): Promise<WriteResult> {
  const nowIso = options?.recordedAtIso || new Date().toISOString();
  if (options?.timesChanged) {
    assertValidActualRange(options.actualStartIso || '', options.actualEndIso || '');
  }

  const offline = await getOfflineOpenShift();
  if (offline && offline.clientShiftId === shiftId) {
    const endMs = Date.parse(options?.actualEndIso || nowIso);
    const startMs = Date.parse(options?.actualStartIso || offline.recordedAtIso);
    if (endMs - startMs < MIN_ACCOUNTABLE_SHIFT_MS) {
      await discardQueuedShift(shiftId);
      await markVisitProcessedAfterShiftEnd(offline.geofenceId);
      return { queued: false };
    }
    return queueLiveShiftEnd(shiftId, endedBy, nowIso, options, offline.geofenceId);
  }

  let online = false;
  try {
    online = await raceTimeout(isDeviceOnline(), SHIFT_START_FALLBACK_MS);
  } catch {
    online = false;
  }
  if (!online) {
    return queueLiveShiftEnd(shiftId, endedBy, nowIso, options, offline?.geofenceId);
  }

  try {
    const outcome = await raceTimeout(
      commitRemoteShiftEnd(shiftId, endedBy, nowIso, options),
      SHIFT_END_REMOTE_MS
    );
    if (outcome === 'missing') {
      return queueLiveShiftEnd(shiftId, endedBy, nowIso, options, offline?.geofenceId);
    }
    return { queued: false };
  } catch {
    return queueLiveShiftEnd(shiftId, endedBy, nowIso, options, offline?.geofenceId);
  }
}

export async function endLiveShiftForUser(userId: string, endedBy = 'geofence') {
  const open = await getOpenLiveShift(userId, { timeoutMs: SHIFT_END_REMOTE_MS });
  if (open) {
    await endLiveShift(open.id, endedBy);
    return;
  }
  const remembered = await getRememberedOpenShiftId();
  if (!remembered) return;
  const pending = await getPendingShiftEnds();
  if (pending.some(item => item.shiftId === remembered)) return;
  await endLiveShift(remembered, endedBy);
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

export function buildOfflineShiftEndWrite(
  shift: LiveShift,
  payload: ShiftEndPayload
): { kind: 'skip' } | { kind: 'delete' } | { kind: 'update'; fields: Record<string, unknown> } {
  if (shift.status !== 'open') return { kind: 'skip' };

  const endIso = payload.timesChanged && payload.actualEndIso ? payload.actualEndIso : payload.recordedAtIso;
  if (payload.timesChanged && payload.actualStartIso && payload.actualEndIso) {
    const span = Date.parse(payload.actualEndIso) - Date.parse(payload.actualStartIso);
    if (!Number.isFinite(span) || span < MIN_ACCOUNTABLE_SHIFT_MS) return { kind: 'delete' };
    const periods = replaceShiftWithActualRange(
      shift,
      payload.actualStartIso,
      payload.actualEndIso,
      payload.originalStartIso || payload.actualStartIso,
      payload.originalEndIso || payload.actualEndIso
    );
    return {
      kind: 'update',
      fields: {
        ...periods,
        status: 'closed',
        locked: true,
        paused: false,
        endAt: payload.actualEndIso,
        endedBy: payload.endedBy,
        manuallyEdited: true,
        editedBy: payload.editedBy || null,
        originalStartAt: shift.originalStartAt || payload.originalStartIso || payload.actualStartIso,
        originalEndAt: shift.originalEndAt || payload.originalEndIso || payload.actualEndIso,
      },
    };
  }

  if (calcShiftSpanMs(shift, new Date(endIso).getTime()) < MIN_ACCOUNTABLE_SHIFT_MS) {
    return { kind: 'delete' };
  }

  let { workPeriods, breakPeriods } = normalizeShiftPeriods(shift);
  if (isShiftPaused(shift)) {
    breakPeriods = closeLastOpenPeriod(breakPeriods, endIso);
  } else {
    workPeriods = closeLastOpenPeriod(workPeriods, endIso);
  }
  const compacted = compactClosedShiftPeriods(workPeriods, breakPeriods, new Date(endIso).getTime());
  if (!compacted.hasAccountableWork) return { kind: 'delete' };

  return {
    kind: 'update',
    fields: {
      workPeriods: compacted.workPeriods,
      breakPeriods: compacted.breakPeriods,
      status: 'closed',
      locked: true,
      paused: false,
      endAt: endIso,
      endedBy: payload.endedBy,
    },
  };
}

export function applyPendingShiftEnds(shifts: LiveShift[], pending: PendingShiftEnd[]): LiveShift[] {
  if (!pending.length) return shifts;
  const byId = new Map(pending.map(item => [item.shiftId, item]));
  return shifts.map(shift => {
    const end = byId.get(shift.id);
    if (!end || shift.status !== 'open') return shift;
    const write = buildOfflineShiftEndWrite(shift, end);
    if (write.kind === 'update') {
      return { ...shift, ...write.fields, status: 'closed' as const };
    }
    const endAt = end.actualEndIso || end.recordedAtIso;
    const periods = closeShiftPeriodsAt(shift, endAt);
    return { ...shift, ...periods, status: 'closed' as const, locked: true, paused: false, endAt };
  });
}

async function commitRemoteShiftEnd(
  shiftId: string,
  endedBy: string,
  recordedAtIso: string,
  options?: ShiftEndOptions
): Promise<'done' | 'missing'> {
  const fs = getFirestore();
  const ref = doc(fs, 'shifts', shiftId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return 'missing';
  const data = { id: snap.id, ...snap.data() } as LiveShift;
  const write = buildOfflineShiftEndWrite(data, toShiftEndPayload(shiftId, endedBy, recordedAtIso, options));
  if (write.kind === 'skip') {
    await forgetOpenShiftId(shiftId);
    return 'done';
  }
  if (write.kind === 'delete') {
    await deleteDoc(ref);
    await forgetOpenShiftId(shiftId);
    await markVisitProcessedAfterShiftEnd(data.geofenceId);
    return 'done';
  }
  await updateDoc(ref, {
    ...write.fields,
    updatedAt: serverTimestamp(),
  });
  await forgetOpenShiftId(shiftId);
  await markVisitProcessedAfterShiftEnd(data.geofenceId);
  return 'done';
}

async function confirmDaySummaryOffline(params: {
  userId: string;
  rows: DaySummarySubmitRow[];
  endedBy?: string;
}): Promise<WriteResult> {
  const openRow = params.rows.find(row => row.isOpen && !row.added && row.shiftId);
  const otherChanges = params.rows.some(row => row.added || (row.timesChanged && !row.isOpen));
  if (openRow?.shiftId) {
    const result = await endLiveShift(openRow.shiftId, params.endedBy || 'manual', {
      recordedAtIso: openRow.endIso,
      timesChanged: openRow.timesChanged,
      actualStartIso: openRow.startIso,
      actualEndIso: openRow.endIso,
      originalStartIso: openRow.originalStartIso,
      originalEndIso: openRow.originalEndIso,
      editedBy: params.userId,
    });
    if (!otherChanges) return result;
    if (!result.queued) {
      throw new Error('Connect to the internet to save edited or added hours.');
    }
    return {
      ...result,
      notice: 'Clock-out was saved on this phone. Connect to the internet to save other edited or added hours.',
    };
  }
  if (otherChanges) {
    throw new Error('Connect to the internet to save edited or added hours.');
  }
  throw new Error('Connect to the internet to confirm the day.');
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

  let online = false;
  try {
    online = await raceTimeout(isDeviceOnline(), SHIFT_START_FALLBACK_MS);
  } catch {
    online = false;
  }
  if (!online) return confirmDaySummaryOffline(params);

  try {
    return await raceTimeout(commitDaySummaryRemote(params), SHIFT_SUMMARY_REMOTE_MS);
  } catch (err) {
    if (!isRetryableOfflineError(err)) throw err;
    return confirmDaySummaryOffline(params);
  }
}

async function commitDaySummaryRemote(params: {
  userId: string;
  dateKey: string;
  rows: DaySummarySubmitRow[];
  endedBy?: string;
}): Promise<WriteResult> {
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
