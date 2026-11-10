import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  deleteField,
} from '@react-native-firebase/firestore';
import {
  deviceLooksOnline,
  getConnectionDegraded,
  markConnectionDegraded,
  markConnectionHealthy,
  probeDegradedConnection,
} from '../offline/connectivity';
import {
  createOutboxId,
  enqueueOutbox,
  getOfflineClosedShifts,
  getOfflineOpenShift,
  getPendingShiftEnds,
  setOfflineOpenShift,
  clearOfflineOpenShift,
  createClientShiftId,
  forgetOpenShiftId,
  getRememberedOpenShiftId,
  loadOutbox,
  rememberOpenShiftId,
  removeOfflineClosedShift,
  removeOutboxItem,
  replaceOutbox,
  upsertOfflineClosedShift,
} from '../offline/outbox';
import type {
  OfflineClosedShift,
  OfflineOpenShift,
  OutboxItem,
  PendingShiftEnd,
  ShiftEndPayload,
  WriteResult,
} from '../offline/types';
import { SHIFT_LIMIT_MS, cutoffRecordedAtIso, isPastShiftLimit } from '../geofencing/geofenceNotificationDecision';

export type ShiftPeriod = {
  startIso: string;
  endIso?: string | null;
  /** First recorded values before any manual edit. */
  originalStartIso?: string;
  originalEndIso?: string | null;
  manuallyEdited?: boolean;
};

export type ShiftPendingEdit = {
  startIso: string;
  endIso: string;
  kind: 'work' | 'break';
  periodIndex: number;
  requestedBy: string;
  requestedAt: string;
};

export type LiveShift = {
  id: string;
  userId: string;
  status: 'open' | 'closed' | 'scheduled';
  locked?: boolean;
  pendingEdit?: ShiftPendingEdit | null;
  pendingDelete?: boolean;
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

export function originalShiftStartMs(shift: LiveShift | Record<string, unknown>): number {
  const typed = shift as LiveShift;
  return getTimestampMs(typed.startAt, typed.workPeriods?.[0]?.startIso);
}

export function shiftLimitNowMs(shift: LiveShift | Record<string, unknown>, nowMs = Date.now()): number {
  const startMs = originalShiftStartMs(shift);
  return startMs ? Math.min(nowMs, startMs + SHIFT_LIMIT_MS) : nowMs;
}

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

  const cappedNow = Math.min(nowMs, startMs + SHIFT_LIMIT_MS);
  const endMs =
    typed.status === 'closed' ? Math.min(getTimestampMs(typed.endAt) || cappedNow, startMs + SHIFT_LIMIT_MS) : cappedNow;
  return {
    workPeriods: [
      {
        startIso: new Date(startMs).toISOString(),
        endIso: typed.status === 'closed' ? new Date(endMs).toISOString() : null,
      },
    ],
    breakPeriods: typed.breakPeriods || [],
  };
}

/** Total time from shift start to end (or now). */
export function calcShiftSpanMs(shift: LiveShift | Record<string, unknown>, nowMs = Date.now()): number {
  const startMs = originalShiftStartMs(shift);
  if (!startMs) return 0;
  const typed = shift as LiveShift;
  const endMs =
    typed.status === 'closed'
      ? getTimestampMs(typed.endAt) || nowMs
      : nowMs;
  return Math.max(0, shiftLimitNowMs(shift, endMs) - startMs);
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

function overlappingBreakMs(workPeriods: ShiftPeriod[], breakPeriods: ShiftPeriod[], nowMs: number): number {
  return (breakPeriods || []).reduce((total, breakPeriod) => {
    const breakStart = new Date(breakPeriod.startIso).getTime();
    const breakEnd = breakPeriod.endIso ? new Date(breakPeriod.endIso).getTime() : nowMs;
    if (Number.isNaN(breakStart) || Number.isNaN(breakEnd) || breakEnd <= breakStart) return total;
    return (
      total +
      (workPeriods || []).reduce((overlap, workPeriod) => {
        const workStart = new Date(workPeriod.startIso).getTime();
        const workEnd = workPeriod.endIso ? new Date(workPeriod.endIso).getTime() : nowMs;
        if (Number.isNaN(workStart) || Number.isNaN(workEnd)) return overlap;
        const clippedStart = Math.max(breakStart, workStart);
        const clippedEnd = Math.min(breakEnd, workEnd);
        return overlap + Math.max(0, clippedEnd - clippedStart);
      }, 0)
    );
  }, 0);
}

/** One worked-time function for live timers, hours UI, day confirm, and PDF. */
export function calcWorkedMs(shift: LiveShift | Record<string, unknown>, nowMs = Date.now()): number {
  const until = shiftLimitNowMs(shift, nowMs);
  const startMs = originalShiftStartMs(shift);
  const { workPeriods, breakPeriods } = normalizeShiftPeriods(shift, until);
  const clippedWork = startMs ? clipPeriodsToRange(workPeriods, startMs, until) : workPeriods;
  const clippedBreaks = startMs ? clipPeriodsToRange(breakPeriods, startMs, until) : breakPeriods;
  return Math.max(0, sumPeriodsMs(clippedWork, until) - overlappingBreakMs(clippedWork, clippedBreaks, until));
}

/** Worked time clipped to an inclusive date/time range. */
export function calcWorkedMsInRange(
  shift: LiveShift | Record<string, unknown>,
  rangeStartMs: number,
  rangeEndMs: number,
  nowMs = Date.now()
): number {
  const until = Math.min(shiftLimitNowMs(shift, nowMs), rangeEndMs);
  const { workPeriods, breakPeriods } = normalizeShiftPeriods(shift, until);
  const clippedWork = clipPeriodsToRange(workPeriods, rangeStartMs, until);
  const clippedBreaks = clipPeriodsToRange(breakPeriods, rangeStartMs, until);
  return Math.max(0, sumPeriodsMs(clippedWork, until) - overlappingBreakMs(clippedWork, clippedBreaks, until));
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

const SHIFT_START_LOOKUP_MS = 800;
const SHIFT_START_FALLBACK_MS = 2500;
const SHIFT_END_REMOTE_MS = 2500;
const SHIFT_SUMMARY_REMOTE_MS = 4000;
const startLiveShiftJobs = new Map<string, Promise<string>>();
const coalesceExtraOpenJobs = new Map<string, Promise<number>>();
let writeSessionDepth = 0;
let writeSessionPreferOnline = false;

async function flushRecoveredOutbox() {
  try {
    const { flushOutbox } = require('../offline/sync') as typeof import('../offline/sync');
    await flushOutbox();
  } catch (error) {
    console.warn('[Offline] Flush after reconnect probe failed:', error);
  }
}

/** Probe only when Home is showing offline. Nested writes reuse that result. */
async function ensureConnectionBeforeWrite(): Promise<boolean> {
  const recovered = await probeDegradedConnection(SHIFT_START_FALLBACK_MS);
  if (!recovered) return false;
  await flushRecoveredOutbox();
  return true;
}

async function runShiftWrite<T>(run: (preferOnline: boolean) => Promise<T>): Promise<T> {
  const outermost = writeSessionDepth === 0;
  if (outermost) {
    writeSessionPreferOnline = await ensureConnectionBeforeWrite();
  }
  writeSessionDepth += 1;
  try {
    return await run(writeSessionPreferOnline);
  } finally {
    writeSessionDepth -= 1;
    if (writeSessionDepth === 0) writeSessionPreferOnline = false;
  }
}

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

function compareOpenLiveShiftStart(a: LiveShift, b: LiveShift) {
  return (
    getTimestampMs(b.startAt, b.workPeriods?.[0]?.startIso) -
      getTimestampMs(a.startAt, a.workPeriods?.[0]?.startIso) || b.id.localeCompare(a.id)
  );
}

export function selectOpenLiveShiftsToEnd(shifts: LiveShift[]): { keep: LiveShift | null; extras: LiveShift[] } {
  const live = shifts.filter(shift => shift.status === 'open' && !shift.isScheduled);
  if (!live.length) return { keep: null, extras: [] };
  const sorted = [...live].sort(compareOpenLiveShiftStart);
  return { keep: sorted[0], extras: sorted.slice(1) };
}

export type LiveShiftSiteTarget = {
  geofenceId?: string | null;
  workCategory?: 'driving' | null;
};

export function isSameOpenLiveShiftSite(open: LiveShiftSiteTarget, next: LiveShiftSiteTarget): boolean {
  return (open.geofenceId || null) === (next.geofenceId || null) && (open.workCategory || null) === (next.workCategory || null);
}

/** One decision for Home start, Start anyway, dropdown switch, and geofence start. */
export function resolveLiveShiftStartPlan(
  open: LiveShiftSiteTarget | null,
  next: LiveShiftSiteTarget
): 'start' | 'reuse' | 'switch' {
  if (!open) return 'start';
  return isSameOpenLiveShiftSite(open, next) ? 'reuse' : 'switch';
}

async function listRemoteOpenLiveShifts(userId: string) {
  const fs = getFirestore();
  const snap = await getDocs(
    query(collection(fs, 'shifts'), where('userId', '==', userId), where('status', '==', 'open'))
  );
  return snap.docs
    .map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as LiveShift))
    .filter(shift => !shift.isScheduled)
    .sort(compareOpenLiveShiftStart);
}

async function lookupRemoteOpenLiveShift(userId: string) {
  const live = await listRemoteOpenLiveShifts(userId);
  return live[0] || null;
}

/** Once per user: keep the newest open live shift and end the rest. */
export async function coalesceExtraOpenLiveShifts(userId: string): Promise<number> {
  if (!userId) return 0;
  const existing = coalesceExtraOpenJobs.get(userId);
  if (existing) return existing;

  const job = (async () => {
    try {
      const { extras } = selectOpenLiveShiftsToEnd(await listRemoteOpenLiveShifts(userId));
      if (!extras.length) return 0;

      let ended = 0;
      for (const extra of extras) {
        const startMs = getTimestampMs(extra.startAt, extra.workPeriods?.[0]?.startIso);
        const recordedAtIso = new Date(startMs || Date.now()).toISOString();
        await endLiveShift(extra.id, 'manual', { recordedAtIso });
        ended += 1;
      }
      return ended;
    } catch (error) {
      if (coalesceExtraOpenJobs.get(userId) === job) {
        coalesceExtraOpenJobs.delete(userId);
      }
      throw error;
    }
  })();

  coalesceExtraOpenJobs.set(userId, job);
  return job;
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
      markConnectionDegraded();
      return null;
    }
  }

  return lookup();
}

export async function resolveLiveShiftPresence(userId: string): Promise<{
  status: 'open' | 'none' | 'unknown';
  shift: LiveShift | null;
}> {
  if (!userId) return { status: 'none', shift: null };
  const pendingIds = new Set((await getPendingShiftEnds()).map(item => item.shiftId));
  const offline = await getOfflineOpenShift();
  if (offline && offline.userId === userId && !pendingIds.has(offline.clientShiftId)) {
    return { status: 'open', shift: offlineOpenShiftToLiveShift(offline) };
  }
  try {
    const shift = await raceTimeout(lookupRemoteOpenLiveShift(userId), SHIFT_END_REMOTE_MS);
    if (!shift || pendingIds.has(shift.id)) return { status: 'none', shift: null };
    await rememberOpenShiftId(shift.id);
    return { status: 'open', shift };
  } catch {
    return { status: 'unknown', shift: null };
  }
}

export async function hasClockedInShift(userId: string): Promise<boolean> {
  if (!userId) return false;
  const presence = await resolveLiveShiftPresence(userId);
  if (presence.status === 'open') return true;
  if (presence.status === 'unknown') {
    try {
      const { getNativeShiftSnapshot } = require('../geofencing/native');
      const snap = await getNativeShiftSnapshot();
      if (snap?.active && (!snap.userId || snap.userId === userId)) return true;
    } catch {
      /* native snapshot unavailable */
    }
    return true;
  }
  return false;
}

export function offlineOpenShiftToLiveShift(offline: OfflineOpenShift): LiveShift {
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

export function offlineClosedShiftToLiveShift(closed: OfflineClosedShift): LiveShift {
  return {
    id: closed.clientShiftId,
    userId: closed.userId,
    status: 'closed',
    locked: true,
    paused: false,
    geofenceId: closed.geofenceId ?? null,
    geofenceName: closed.geofenceName ?? null,
    workCategory: closed.workCategory ?? null,
    workPeriods: closed.workPeriods,
    breakPeriods: closed.breakPeriods,
    startAt: closed.startAt,
    endAt: closed.endAt,
    startedBy: closed.startedBy,
    endedBy: 'manual',
  };
}

export function liveShiftsFromLocalOffline(params: {
  open: OfflineOpenShift | null;
  closed: OfflineClosedShift[];
  outbox: OutboxItem[];
  userId?: string | null;
}): LiveShift[] {
  const byId = new Map<string, LiveShift>();
  const userId = params.userId;
  if (params.open && (!userId || params.open.userId === userId)) {
    byId.set(params.open.clientShiftId, offlineOpenShiftToLiveShift(params.open));
  }
  for (const closed of params.closed) {
    if (userId && closed.userId !== userId) continue;
    byId.set(closed.clientShiftId, offlineClosedShiftToLiveShift(closed));
  }
  for (const item of params.outbox) {
    if (item.type !== 'shift_start') continue;
    if (userId && item.payload.userId !== userId) continue;
    if (byId.has(item.clientShiftId)) continue;
    byId.set(item.clientShiftId, {
      id: item.clientShiftId,
      userId: item.payload.userId,
      status: 'open',
      paused: false,
      geofenceId: item.payload.geofenceId ?? null,
      geofenceName: item.payload.geofenceName ?? null,
      workCategory: item.payload.workCategory ?? null,
      workPeriods: [{ startIso: item.payload.recordedAtIso }],
      breakPeriods: [],
      startAt: item.payload.recordedAtIso,
      startedBy: item.payload.startedBy,
    });
  }
  return [...byId.values()];
}

export async function loadLocalOfflineShifts(userId?: string | null): Promise<LiveShift[]> {
  const [open, closed, outbox] = await Promise.all([
    getOfflineOpenShift(),
    getOfflineClosedShifts(),
    loadOutbox(),
  ]);
  const shifts = liveShiftsFromLocalOffline({ open, closed, outbox, userId });
  const pending = await getPendingShiftEnds();
  return applyPendingShiftEnds(shifts, pending);
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
    if (isSameOpenLiveShiftSite(offline, params)) {
      await rememberOpenShiftId(offline.clientShiftId);
      return offline.clientShiftId;
    }
    await endLiveShift(offline.clientShiftId, params.startedBy || 'manual');
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
  const payload = toShiftEndPayload(shiftId, endedBy, recordedAtIso, options);
  if (offline && offline.clientShiftId === shiftId) {
    const write = buildOfflineShiftEndWrite(offlineOpenShiftToLiveShift(offline), payload);
    if (write.kind === 'update') {
      await upsertOfflineClosedShift({
        clientShiftId: offline.clientShiftId,
        userId: offline.userId,
        teamId: offline.teamId,
        geofenceId: offline.geofenceId,
        geofenceName: offline.geofenceName,
        workCategory: offline.workCategory,
        startedBy: offline.startedBy,
        recordedAtIso: offline.recordedAtIso,
        workPeriods: write.fields.workPeriods as ShiftPeriod[],
        breakPeriods: write.fields.breakPeriods as ShiftPeriod[],
        startAt: String(write.fields.workPeriods?.[0]?.startIso || offline.recordedAtIso),
        endAt: String(write.fields.endAt),
        pendingSync: true,
      });
    }
    await clearOfflineOpenShift();
  }

  await forgetOpenShiftId(shiftId);
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
  const open = await getOfflineOpenShift();
  if (open?.clientShiftId === shiftId) {
    await clearOfflineOpenShift();
  }
  await removeOfflineClosedShift(shiftId);
  await forgetOpenShiftId(shiftId);
}

async function reuseOrEndOpenLiveShiftForStart(
  userId: string,
  target: LiveShiftSiteTarget,
  endedBy: string
): Promise<string | null> {
  const offline = await getOfflineOpenShift();
  if (offline && offline.userId === userId) {
    if (resolveLiveShiftStartPlan(offline, target) === 'reuse') {
      await rememberOpenShiftId(offline.clientShiftId);
      return offline.clientShiftId;
    }
    await endLiveShift(offline.clientShiftId, endedBy);
  }

  const open = await getOpenLiveShift(userId, { timeoutMs: SHIFT_START_LOOKUP_MS });
  if (!open) return null;
  if (resolveLiveShiftStartPlan(open, target) === 'reuse') {
    await rememberOpenShiftId(open.id);
    return open.id;
  }
  await queueLiveShiftEnd(open.id, endedBy, new Date().toISOString(), undefined, open.geofenceId);
  return null;
}

async function createLiveShift(params: {
  userId: string;
  geofenceId?: string | null;
  geofenceName?: string | null;
  workCategory?: 'driving' | null;
  startedBy: string;
}): Promise<string> {
  const target: LiveShiftSiteTarget = {
    geofenceId: params.geofenceId ?? null,
    workCategory: params.workCategory ?? null,
  };
  const reused = await reuseOrEndOpenLiveShiftForStart(params.userId, target, params.startedBy || 'manual');
  if (reused) return reused;
  return queueShiftStart(params);
}

export async function startLiveShift(params: {
  userId: string;
  geofenceId?: string | null;
  geofenceName?: string | null;
  workCategory?: 'driving' | null;
  startedBy: string;
}): Promise<string> {
  const existingJob = startLiveShiftJobs.get(params.userId);
  if (existingJob) return existingJob;

  const job = runShiftWrite(async preferOnline => {
    const id = await createLiveShift(params);
    if (preferOnline) await flushRecoveredOutbox();
    return id;
  }).finally(() => {
    if (startLiveShiftJobs.get(params.userId) === job) {
      startLiveShiftJobs.delete(params.userId);
    }
  });
  startLiveShiftJobs.set(params.userId, job);
  return job;
}

export async function pauseLiveShift(shiftId: string): Promise<WriteResult> {
  return runShiftWrite(preferOnline => writeLiveShiftPause(shiftId, preferOnline));
}

async function writeLiveShiftPause(shiftId: string, preferOnline: boolean): Promise<WriteResult> {
  const nowIso = new Date().toISOString();
  const offline = await getOfflineOpenShift();
  if (!preferOnline && (getConnectionDegraded() || (offline && offline.clientShiftId === shiftId))) {
    await queueShiftPause(shiftId, nowIso);
    return { queued: true, clientShiftId: shiftId };
  }

  if (!preferOnline) {
    const online = await deviceLooksOnline(SHIFT_START_FALLBACK_MS);
    if (!online) {
      await queueShiftPause(shiftId, nowIso);
      return { queued: true, clientShiftId: shiftId };
    }
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
    if (offline && offline.clientShiftId === shiftId) {
      const local = pauseShiftPeriods(offline.workPeriods, offline.breakPeriods, nowIso);
      await setOfflineOpenShift({
        ...offline,
        workPeriods: local.workPeriods,
        breakPeriods: local.breakPeriods,
        paused: true,
      });
    }
    markConnectionHealthy();
    return { queued: false };
  } catch {
    markConnectionDegraded();
    await queueShiftPause(shiftId, nowIso);
    return { queued: true, clientShiftId: shiftId };
  }
}

export async function resumeLiveShift(shiftId: string): Promise<WriteResult> {
  return runShiftWrite(preferOnline => writeLiveShiftResume(shiftId, preferOnline));
}

async function writeLiveShiftResume(shiftId: string, preferOnline: boolean): Promise<WriteResult> {
  const nowIso = new Date().toISOString();
  const offline = await getOfflineOpenShift();
  if (!preferOnline && (getConnectionDegraded() || (offline && offline.clientShiftId === shiftId))) {
    await queueShiftResume(shiftId, nowIso);
    return { queued: true, clientShiftId: shiftId };
  }

  if (!preferOnline) {
    const online = await deviceLooksOnline(SHIFT_START_FALLBACK_MS);
    if (!online) {
      await queueShiftResume(shiftId, nowIso);
      return { queued: true, clientShiftId: shiftId };
    }
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
    if (offline && offline.clientShiftId === shiftId) {
      const local = resumeShiftPeriods(offline.workPeriods, offline.breakPeriods, nowIso);
      await setOfflineOpenShift({
        ...offline,
        workPeriods: local.nextWork ? [...local.workPeriods, local.nextWork] : local.workPeriods,
        breakPeriods: local.breakPeriods,
        paused: false,
      });
    }
    markConnectionHealthy();
    return { queued: false };
  } catch {
    markConnectionDegraded();
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
  return runShiftWrite(preferOnline => writeLiveShiftEnd(shiftId, endedBy, options, preferOnline));
}

async function writeLiveShiftEnd(
  shiftId: string,
  endedBy: string,
  options: ShiftEndOptions | undefined,
  preferOnline: boolean
): Promise<WriteResult> {
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
    if (!preferOnline) {
      return queueLiveShiftEnd(shiftId, endedBy, nowIso, options, offline.geofenceId);
    }
  }

  if (!preferOnline && getConnectionDegraded()) {
    return queueLiveShiftEnd(shiftId, endedBy, nowIso, options, offline?.geofenceId);
  }

  if (!preferOnline) {
    const online = await deviceLooksOnline(SHIFT_START_FALLBACK_MS);
    if (!online) {
      return queueLiveShiftEnd(shiftId, endedBy, nowIso, options, offline?.geofenceId);
    }
  }

  try {
    const outcome = await raceTimeout(
      commitRemoteShiftEnd(shiftId, endedBy, nowIso, options),
      SHIFT_END_REMOTE_MS
    );
    if (outcome === 'missing') {
      return queueLiveShiftEnd(shiftId, endedBy, nowIso, options, offline?.geofenceId);
    }
    if (offline && offline.clientShiftId === shiftId) {
      await clearOfflineOpenShift();
    }
    markConnectionHealthy();
    return { queued: false };
  } catch {
    markConnectionDegraded();
    return queueLiveShiftEnd(shiftId, endedBy, nowIso, options, offline?.geofenceId);
  }
}

export async function closeOpenShiftAtLimitIfOverdue(shift: LiveShift): Promise<boolean> {
  if (!shift?.id || shift.status !== 'open' || shift.isScheduled) return false;
  const startMs = originalShiftStartMs(shift);
  if (!isPastShiftLimit(startMs, Date.now())) return false;
  await endLiveShift(shift.id, 'geofence', { recordedAtIso: cutoffRecordedAtIso(startMs) });
  return true;
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

export function clipPeriodsToRange(periods: ShiftPeriod[], startMs: number, endMs: number): ShiftPeriod[] {
  return (periods || [])
    .map(period => {
      const periodStart = new Date(period.startIso).getTime();
      const periodEnd = period.endIso ? new Date(period.endIso).getTime() : endMs;
      if (Number.isNaN(periodStart) || Number.isNaN(periodEnd)) return null;
      const clippedStart = Math.max(periodStart, startMs);
      const clippedEnd = Math.min(periodEnd, endMs);
      if (clippedEnd <= clippedStart) return null;
      return {
        ...period,
        startIso: new Date(clippedStart).toISOString(),
        endIso: new Date(clippedEnd).toISOString(),
      };
    })
    .filter((period): period is ShiftPeriod => !!period);
}

export function workPeriodsAroundBreaks(
  startIso: string,
  endIso: string,
  breakPeriods: ShiftPeriod[],
  extras?: Pick<ShiftPeriod, 'originalStartIso' | 'originalEndIso' | 'manuallyEdited'>
): ShiftPeriod[] {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

  const breaks = clipPeriodsToRange(breakPeriods || [], startMs, endMs)
    .map(period => ({
      startMs: new Date(period.startIso).getTime(),
      endMs: period.endIso ? new Date(period.endIso).getTime() : endMs,
    }))
    .filter(period => Number.isFinite(period.startMs) && Number.isFinite(period.endMs) && period.endMs > period.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const workPeriods: ShiftPeriod[] = [];
  let cursor = startMs;
  breaks.forEach(period => {
    if (period.startMs > cursor) {
      workPeriods.push({
        startIso: new Date(cursor).toISOString(),
        endIso: new Date(period.startMs).toISOString(),
        ...extras,
      });
    }
    cursor = Math.max(cursor, period.endMs);
  });
  if (cursor < endMs) {
    workPeriods.push({
      startIso: new Date(cursor).toISOString(),
      endIso,
      ...extras,
    });
  }
  return workPeriods;
}

export function applyActualShiftRange(
  shift: LiveShift,
  startIso: string,
  endIso: string,
  originalStartIso: string,
  originalEndIso: string
) {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  const { breakPeriods } = normalizeShiftPeriods(shift, endMs);
  const keptBreaks = clipPeriodsToRange(breakPeriods || [], startMs, endMs);
  return {
    workPeriods: workPeriodsAroundBreaks(startIso, endIso, keptBreaks, {
      originalStartIso,
      originalEndIso,
      manuallyEdited: true,
    }),
    breakPeriods: keptBreaks,
  };
}

function replaceShiftWithActualRange(
  shift: LiveShift,
  startIso: string,
  endIso: string,
  originalStartIso: string,
  originalEndIso: string
) {
  return applyActualShiftRange(shift, startIso, endIso, originalStartIso, originalEndIso);
}

export function applyEditedWorkPeriodTimes(
  workPeriods: ShiftPeriod[],
  breakPeriods: ShiftPeriod[],
  periodIndex: number,
  startIso: string,
  endIso: string
) {
  if (periodIndex < 0 || periodIndex >= workPeriods.length) {
    throw new Error('Time slot not found.');
  }
  const current = workPeriods[periodIndex];
  const edited: ShiftPeriod = {
    startIso,
    endIso,
    manuallyEdited: true,
    originalStartIso: current.originalStartIso || current.startIso,
    originalEndIso: current.originalEndIso !== undefined ? current.originalEndIso : current.endIso ?? null,
  };
  const nextWork = [...workPeriods.slice(0, periodIndex), edited, ...workPeriods.slice(periodIndex + 1)];
  const starts = nextWork.map(period => new Date(period.startIso).getTime()).filter(Number.isFinite);
  const ends = nextWork
    .map(period => (period.endIso ? new Date(period.endIso).getTime() : NaN))
    .filter(Number.isFinite);
  const envelopeStart = Math.min(...starts);
  const envelopeEnd = Math.max(...ends);
  const keptBreaks = clipPeriodsToRange(breakPeriods, envelopeStart, envelopeEnd);
  return {
    workPeriods: workPeriodsAroundBreaks(
      new Date(envelopeStart).toISOString(),
      new Date(envelopeEnd).toISOString(),
      keptBreaks,
      {
        originalStartIso: edited.originalStartIso,
        originalEndIso: edited.originalEndIso,
        manuallyEdited: true,
      }
    ),
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

/** Home ticker: hide if Confirm Day stopped it, or if either source id was ended. */
export function resolveHomeActiveShift<T extends { id: string }>(
  offlineShift: T | null,
  openShift: T | null,
  pendingEnds: Array<{ shiftId: string }> = [],
  locallyEndedIds: Iterable<string> = [],
  tickerStopped = false
): T | null {
  if (tickerStopped) return null;
  const ended = new Set<string>(locallyEndedIds);
  for (const item of pendingEnds) {
    if (item.shiftId) ended.add(item.shiftId);
  }
  const pendingEndedThisSession = pendingEnds.some(
    item => item.shiftId && (item.shiftId === offlineShift?.id || item.shiftId === openShift?.id)
  );
  if (pendingEndedThisSession) return null;
  const offline = offlineShift && !ended.has(offlineShift.id) ? offlineShift : null;
  const open = openShift && !ended.has(openShift.id) ? openShift : null;
  return offline || open;
}

async function clearLocalOpenShiftAfterDayConfirm(params: { userId: string }) {
  try {
    const { stopNativeShiftOngoing } = require('../geofencing/native');
    const { clearShiftTrackingExtras } = require('../geofencing/storage');
    stopNativeShiftOngoing();
    await clearShiftTrackingExtras();
  } catch {
    /* native optional */
  }
  const offline = await getOfflineOpenShift();
  if (!offline || offline.userId !== params.userId) return;
  await clearOfflineOpenShift();
  await forgetOpenShiftId(offline.clientShiftId);
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
  removedShiftIds?: string[];
  endedBy?: string;
}): Promise<WriteResult> {
  const removedShiftIds = (params.removedShiftIds || []).filter(Boolean);
  for (const shiftId of removedShiftIds) {
    await discardQueuedShift(shiftId);
  }
  const openRow = params.rows.find(row => row.isOpen && !row.added && row.shiftId);
  const extraChanges = params.rows.some(row => row.added || (row.timesChanged && !row.isOpen));
  if (openRow?.shiftId) {
    return endLiveShift(openRow.shiftId, params.endedBy || 'manual', {
      recordedAtIso: openRow.endIso,
      timesChanged: openRow.timesChanged,
      actualStartIso: openRow.startIso,
      actualEndIso: openRow.endIso,
      originalStartIso: openRow.originalStartIso,
      originalEndIso: openRow.originalEndIso,
      editedBy: params.userId,
    });
  }
  if (!params.rows.length && removedShiftIds.length) {
    return { queued: true };
  }
  if (extraChanges) {
    throw new Error('Connect to the internet to save edited or added hours.');
  }
  throw new Error('Connect to the internet to confirm the day.');
}

export async function submitDaySummary(params: {
  userId: string;
  dateKey: string;
  rows: DaySummarySubmitRow[];
  removedShiftIds?: string[];
  endedBy?: string;
}): Promise<WriteResult> {
  if (!params.userId) throw new Error('You must be signed in to confirm the day.');
  const removedShiftIds = (params.removedShiftIds || []).filter(Boolean);
  if (!params.rows.length && !removedShiftIds.length) {
    throw new Error('Add at least one shift before confirming the day.');
  }
  params.rows.forEach(row => assertValidActualRange(row.startIso, row.endIso));

  return runShiftWrite(async preferOnline => {
    const finish = async (result: WriteResult) => {
      await clearLocalOpenShiftAfterDayConfirm(params);
      return result;
    };
    if (!preferOnline && getConnectionDegraded()) {
      return finish(await confirmDaySummaryOffline(params));
    }
    if (!preferOnline) {
      const online = await deviceLooksOnline(SHIFT_START_FALLBACK_MS);
      if (!online) return finish(await confirmDaySummaryOffline(params));
    }

    try {
      const result = await raceTimeout(commitDaySummaryRemote(params), SHIFT_SUMMARY_REMOTE_MS);
      markConnectionHealthy();
      return finish(result);
    } catch (err) {
      if (!isRetryableOfflineError(err)) throw err;
      markConnectionDegraded();
      return finish(await confirmDaySummaryOffline(params));
    }
  });
}

async function commitDaySummaryRemote(params: {
  userId: string;
  dateKey: string;
  rows: DaySummarySubmitRow[];
  removedShiftIds?: string[];
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

  const endedOpenIds: string[] = [];
  for (const shiftId of params.removedShiftIds || []) {
    if (!shiftId) continue;
    const ref = doc(fs, 'shifts', shiftId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await discardQueuedShift(shiftId);
      continue;
    }
    const data = { id: snap.id, ...snap.data() } as LiveShift;
    if (data.userId !== params.userId) throw new Error('You can only confirm your own hours.');
    if (data.isScheduled || data.status === 'scheduled') {
      throw new Error('Scheduled shifts cannot be changed from Day Summary.');
    }
    if (data.status === 'open') {
      openGeofenceId = data.geofenceId;
      endedOpenIds.push(shiftId);
    }
    batch.delete(ref);
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
    const shiftId = row.shiftId;
    const ref = doc(fs, 'shifts', shiftId);
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
      endedOpenIds.push(shiftId);
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
  for (const shiftId of endedOpenIds) {
    await forgetOpenShiftId(shiftId);
  }
  if (openGeofenceId !== undefined) {
    try {
      await markVisitProcessedAfterShiftEnd(openGeofenceId);
    } catch (err) {
      console.warn('Failed to mark geofence visit after shift end:', err);
    }
  }
  return { queued: false };
}

export function lockedShiftMutationMode(input: { locked?: boolean; isAdmin: boolean }): 'apply' | 'pending' {
  return input.locked && !input.isAdmin ? 'pending' : 'apply';
}

export function buildPendingShiftEdit(input: {
  startIso: string;
  endIso: string;
  kind: 'work' | 'break';
  periodIndex: number;
  requestedBy: string;
  requestedAt?: string;
}): ShiftPendingEdit {
  return {
    startIso: input.startIso,
    endIso: input.endIso,
    kind: input.kind,
    periodIndex: input.periodIndex,
    requestedBy: input.requestedBy,
    requestedAt: input.requestedAt || new Date().toISOString(),
  };
}

export function pendingApprovalAction(
  shift: Pick<LiveShift, 'pendingEdit' | 'pendingDelete'>
):
  | { type: 'none' }
  | { type: 'delete' }
  | { type: 'update'; kind: 'work' | 'break'; periodIndex: number; startIso: string; endIso: string } {
  if (shift.pendingDelete) return { type: 'delete' };
  const pending = shift.pendingEdit;
  if (!pending) return { type: 'none' };
  return {
    type: 'update',
    kind: pending.kind,
    periodIndex: pending.periodIndex,
    startIso: pending.startIso,
    endIso: pending.endIso,
  };
}

export type ShiftEditActor = {
  userId: string;
  isAdmin: boolean;
};

export async function updateShiftPeriodTimes(
  shiftId: string,
  kind: 'work' | 'break',
  periodIndex: number,
  startIso: string,
  endIso: string,
  options?: { allowLocked?: boolean }
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
  if (data.locked && !options?.allowLocked) throw new Error('This shift is locked and cannot be edited.');

  const { workPeriods, breakPeriods } = normalizeShiftPeriods(data);
  const periods = kind === 'work' ? [...workPeriods] : [...breakPeriods];
  if (periodIndex < 0 || periodIndex >= periods.length) {
    throw new Error('Time slot not found.');
  }

  const current = periods[periodIndex];
  if (!current.endIso && data.status === 'open') {
    throw new Error('Pause or end the active timer before editing this slot.');
  }

  const next =
    kind === 'work'
      ? applyEditedWorkPeriodTimes(workPeriods, breakPeriods, periodIndex, startIso, endIso)
      : applyEditedWorkPeriodTimes(
          workPeriods,
          periods.map((period, index) =>
            index === periodIndex
              ? {
                  startIso,
                  endIso,
                  manuallyEdited: true,
                  originalStartIso: period.originalStartIso || period.startIso,
                  originalEndIso:
                    period.originalEndIso !== undefined ? period.originalEndIso : period.endIso ?? null,
                }
              : period
          ),
          0,
          workPeriods[0]?.startIso || startIso,
          workPeriods[workPeriods.length - 1]?.endIso || endIso
        );

  const firstWorkStart = next.workPeriods[0]?.startIso;
  const lastWorkEnd = next.workPeriods[next.workPeriods.length - 1]?.endIso || endIso;

  await updateDoc(ref, {
    workPeriods: next.workPeriods,
    breakPeriods: next.breakPeriods,
    startAt: firstWorkStart || startIso,
    endAt: data.status === 'closed' ? lastWorkEnd : data.endAt || null,
    manuallyEdited: true,
    pendingEdit: deleteField(),
    pendingDelete: deleteField(),
    updatedAt: serverTimestamp(),
  });
}

export function assertShiftCanBeDeleted(
  shift: Pick<LiveShift, 'locked'>,
  options?: { allowLocked?: boolean }
): void {
  if (shift.locked && !options?.allowLocked) throw new Error('This shift is locked and cannot be edited.');
}

/** Hard-delete a recorded shift so it vanishes from hours and Shift Audit. Online only. */
export async function deleteRecordedShift(
  shiftId: string,
  options?: { allowLocked?: boolean }
): Promise<void> {
  if (!(await deviceLooksOnline(SHIFT_START_FALLBACK_MS))) {
    throw new Error('Connect to the internet to delete a shift.');
  }

  const fs = getFirestore();
  const ref = doc(fs, 'shifts', shiftId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await discardQueuedShift(shiftId);
    return;
  }
  const data = { id: snap.id, ...snap.data() } as LiveShift;
  assertShiftCanBeDeleted(data, options);
  await deleteDoc(ref);
  await discardQueuedShift(shiftId);
}

export async function requestPendingShiftEdit(params: {
  shiftId: string;
  kind: 'work' | 'break';
  periodIndex: number;
  startIso: string;
  endIso: string;
  requestedBy: string;
  pendingDelete?: boolean;
}): Promise<void> {
  const startMs = new Date(params.startIso).getTime();
  const endMs = new Date(params.endIso).getTime();
  if (!params.pendingDelete && (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs)) {
    throw new Error('Finish time must be after start time.');
  }

  const fs = getFirestore();
  const ref = doc(fs, 'shifts', params.shiftId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Shift not found.');
  const data = { id: snap.id, ...snap.data() } as LiveShift;
  if (!data.locked) {
    throw new Error('This shift is not locked. Save the change instead of requesting approval.');
  }

  await updateDoc(ref, {
    pendingEdit: buildPendingShiftEdit({
      startIso: params.startIso,
      endIso: params.endIso,
      kind: params.kind,
      periodIndex: params.periodIndex,
      requestedBy: params.requestedBy,
    }),
    pendingDelete: params.pendingDelete === true,
    updatedAt: serverTimestamp(),
  });

  void import('./shiftEditAdminNotify')
    .then(({ notifyAdminsOfPendingShiftEdit }) =>
      notifyAdminsOfPendingShiftEdit({
        shift: { id: data.id, userId: data.userId, teamId: data.teamId },
      })
    )
    .catch(error => {
      console.warn('[ShiftEdit] failed notifying admins:', error);
    });
}

export async function rejectPendingShiftEdit(shiftId: string): Promise<void> {
  const fs = getFirestore();
  const ref = doc(fs, 'shifts', shiftId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Shift not found.');
  await updateDoc(ref, {
    pendingEdit: deleteField(),
    pendingDelete: deleteField(),
    updatedAt: serverTimestamp(),
  });
}

export async function approvePendingShiftEdit(shiftId: string): Promise<void> {
  const fs = getFirestore();
  const ref = doc(fs, 'shifts', shiftId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Shift not found.');
  const data = { id: snap.id, ...snap.data() } as LiveShift;
  const action = pendingApprovalAction(data);
  if (action.type === 'none') {
    throw new Error('There is no pending change to approve.');
  }
  if (action.type === 'delete') {
    await deleteRecordedShift(shiftId, { allowLocked: true });
    return;
  }
  await updateShiftPeriodTimes(shiftId, action.kind, action.periodIndex, action.startIso, action.endIso, {
    allowLocked: true,
  });
}

export async function saveShiftPeriodEdit(params: {
  shiftId: string;
  kind: 'work' | 'break';
  periodIndex: number;
  startIso: string;
  endIso: string;
  actor: ShiftEditActor;
}): Promise<{ applied: boolean; pending: boolean }> {
  const fs = getFirestore();
  const ref = doc(fs, 'shifts', params.shiftId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Shift not found.');
  const data = { id: snap.id, ...snap.data() } as LiveShift;
  if (lockedShiftMutationMode({ locked: data.locked, isAdmin: params.actor.isAdmin }) === 'pending') {
    await requestPendingShiftEdit({
      shiftId: params.shiftId,
      kind: params.kind,
      periodIndex: params.periodIndex,
      startIso: params.startIso,
      endIso: params.endIso,
      requestedBy: params.actor.userId,
    });
    return { applied: false, pending: true };
  }
  await updateShiftPeriodTimes(params.shiftId, params.kind, params.periodIndex, params.startIso, params.endIso, {
    allowLocked: params.actor.isAdmin,
  });
  return { applied: true, pending: false };
}

export async function saveShiftDeleteRequest(params: {
  shiftId: string;
  kind: 'work' | 'break';
  periodIndex: number;
  startIso: string;
  endIso: string;
  actor: ShiftEditActor;
}): Promise<{ applied: boolean; pending: boolean }> {
  const fs = getFirestore();
  const ref = doc(fs, 'shifts', params.shiftId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Shift not found.');
  const data = { id: snap.id, ...snap.data() } as LiveShift;
  if (lockedShiftMutationMode({ locked: data.locked, isAdmin: params.actor.isAdmin }) === 'pending') {
    await requestPendingShiftEdit({
      shiftId: params.shiftId,
      kind: params.kind,
      periodIndex: params.periodIndex,
      startIso: params.startIso,
      endIso: params.endIso,
      requestedBy: params.actor.userId,
      pendingDelete: true,
    });
    return { applied: false, pending: true };
  }
  await deleteRecordedShift(params.shiftId, { allowLocked: params.actor.isAdmin });
  return { applied: true, pending: false };
}
