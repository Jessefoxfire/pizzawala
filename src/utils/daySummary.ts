import { formatTimeLabel24 } from './eventDays';

export type ScheduledShiftRow = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
};

export type DaySummaryShiftLike = {
  id: string;
  status?: string;
  isScheduled?: boolean;
  startAt?: unknown;
  endAt?: unknown;
  workPeriods?: Array<{
    startIso: string;
    endIso?: string | null;
    originalStartIso?: string;
    originalEndIso?: string | null;
    manuallyEdited?: boolean;
  }>;
  breakPeriods?: Array<{
    startIso: string;
    endIso?: string | null;
  }>;
  workCategory?: 'driving' | null;
  geofenceName?: string | null;
  manuallyAdded?: boolean;
  manuallyEdited?: boolean;
  source?: string;
  scheduledShiftId?: string | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
};

export type DaySummaryRow = {
  draftId: string;
  shiftId?: string;
  added: boolean;
  isOpen: boolean;
  startIso: string;
  endIso: string;
  originalStartIso: string;
  originalEndIso: string;
  scheduledShiftId?: string | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_ACCOUNTABLE_SHIFT_MS = 60 * 1000;

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildIsoFromDateKeyAndTime(dateKey: string, time: string) {
  const withSeconds = time.trim().length === 5 ? `${time.trim()}:00` : time.trim();
  return new Date(`${dateKey}T${withSeconds}`).toISOString();
}

export function hoursChangeKind(shift: {
  manuallyAdded?: boolean;
  manuallyEdited?: boolean;
  source?: string;
  workPeriods?: Array<{ manuallyEdited?: boolean }>;
}): 'added' | 'edited' | null {
  if (shift.manuallyAdded || shift.source === 'employee_added') return 'added';
  if (shift.manuallyEdited) return 'edited';
  if ((shift.workPeriods || []).some(period => period.manuallyEdited)) return 'edited';
  return null;
}

function timestampMs(raw: unknown, fallbackIso?: string | null): number {
  if (raw && typeof raw === 'object') {
    const maybeTs = raw as { toDate?: () => Date; seconds?: number; _seconds?: number; nanoseconds?: number };
    if (typeof maybeTs.toDate === 'function') {
      try {
        return maybeTs.toDate().getTime();
      } catch {
        /* fall through */
      }
    }
    const seconds = typeof maybeTs.seconds === 'number' ? maybeTs.seconds : maybeTs._seconds;
    if (typeof seconds === 'number') {
      const nanos = typeof maybeTs.nanoseconds === 'number' ? maybeTs.nanoseconds : 0;
      return seconds * 1000 + Math.floor(nanos / 1e6);
    }
  }
  if (typeof raw === 'string') {
    const parsed = new Date(raw).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw < 1e12 ? raw * 1000 : raw;
  }
  if (fallbackIso) {
    const parsed = new Date(fallbackIso).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function normalizeTime(time: string) {
  const trimmed = time.trim();
  return trimmed.length === 5 ? `${trimmed}:00` : trimmed;
}

export function scheduledWindowMs(dateKey: string, startTime: string, endTime: string) {
  const start = new Date(`${dateKey}T${normalizeTime(startTime)}`).getTime();
  let end = new Date(`${dateKey}T${normalizeTime(endTime)}`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (end <= start) end += DAY_MS;
  return { start, end };
}

export function pickScheduledEndMs(
  shift: {
    startAt?: unknown;
    scheduledShiftId?: string | null;
    scheduledStartTime?: string | null;
    scheduledEndTime?: string | null;
  },
  scheduled: ScheduledShiftRow[],
  nowMs: number
): number | null {
  const startMs = timestampMs(shift.startAt) || nowMs;
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(Math.max(nowMs, startMs + 60 * 1000)).toISOString();
  const dateKey = localDateKey(new Date(startMs));

  if (shift.scheduledEndTime) {
    const window = scheduledWindowMs(
      dateKey,
      shift.scheduledStartTime || '00:00',
      shift.scheduledEndTime
    );
    return window?.end ?? null;
  }

  const matched =
    matchScheduledShift(startIso, endIso, scheduled, dateKey, new Set()) ||
    matchScheduledShift(
      startIso,
      endIso,
      scheduled,
      localDateKey(new Date(startMs - DAY_MS)),
      new Set()
    );
  if (!matched) return null;
  return scheduledWindowMs(matched.date, matched.startTime, matched.endTime)?.end ?? null;
}

export function isoTimesDiffer(a: string, b: string) {
  const aMs = new Date(a).getTime();
  const bMs = new Date(b).getTime();
  if (Number.isNaN(aMs) || Number.isNaN(bMs)) return true;
  return Math.round(aMs / 60000) !== Math.round(bMs / 60000);
}

export function rowWasEdited(row: DaySummaryRow) {
  if (row.added) return false;
  return isoTimesDiffer(row.startIso, row.originalStartIso) || isoTimesDiffer(row.endIso, row.originalEndIso);
}

export function rowChangeKind(row: DaySummaryRow): 'edited' | 'added' | null {
  if (row.added) return 'added';
  if (rowWasEdited(row)) return 'edited';
  return null;
}

export function validateActualRange(startIso: string, endIso: string): string | null {
  if (!startIso?.trim() || !endIso?.trim()) return 'Start and finish times are required.';
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 'Enter valid start and finish times.';
  if (endMs <= startMs) return 'Finish time must be after start time.';
  return null;
}

export function validateDaySummaryRows(rows: DaySummaryRow[]): string | null {
  if (rows.length === 0) return 'Add at least one shift before confirming the day.';
  for (const row of rows) {
    const error = validateActualRange(row.startIso, row.endIso);
    if (error) return error;
  }
  return null;
}

export function totalActualMs(rows: DaySummaryRow[]) {
  return rows.reduce((total, row) => {
    const startMs = new Date(row.startIso).getTime();
    const endMs = new Date(row.endIso).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return total;
    return total + (endMs - startMs);
  }, 0);
}

function totalPeriodMs(
  periods: Array<{ startIso: string; endIso?: string | null }> | undefined,
  nowMs: number
) {
  return (periods || []).reduce((total, period) => {
    const startMs = new Date(period.startIso).getTime();
    const endMs = period.endIso ? new Date(period.endIso).getTime() : nowMs;
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return total;
    return total + (endMs - startMs);
  }, 0);
}

/** Keeps driving separate from normal working time without changing work or break periods. */
export function dailyShiftBreakdown(shifts: DaySummaryShiftLike[], dateKey: string, nowMs: number) {
  return shifts.reduce(
    (total, shift) => {
      if (shift.isScheduled || !shiftOverlapsDate(shift, dateKey, nowMs)) return total;
      const workedMs = totalPeriodMs(workPeriodsFromShift(shift, nowMs), nowMs);
      const breakMs = totalPeriodMs(shift.breakPeriods, nowMs);
      if (workedMs + breakMs < MIN_ACCOUNTABLE_SHIFT_MS) return total;
      if (shift.workCategory === 'driving') {
        total.drivingMs += workedMs;
      } else if (shift.geofenceName) {
        total.worksites[shift.geofenceName] = (total.worksites[shift.geofenceName] || 0) + workedMs;
      } else {
        total.unassignedMs += workedMs;
      }
      total.breakMs += breakMs;
      return total;
    },
    { unassignedMs: 0, breakMs: 0, drivingMs: 0, worksites: {} as Record<string, number> }
  );
}

export function formatHoursMinutesLabel(ms: number) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

export function formatClockHHmm(value: Date) {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

export function formatIsoTimeRange(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '—';
  return `${formatClockHHmm(start)} – ${formatClockHHmm(end)}`;
}

export function formatScheduledLabel(startTime?: string | null, endTime?: string | null) {
  if (!startTime || !endTime) return null;
  return `Scheduled: ${formatTimeLabel24(startTime)} – ${formatTimeLabel24(endTime)}`;
}

function workPeriodsFromShift(shift: DaySummaryShiftLike, nowMs: number) {
  if (Array.isArray(shift.workPeriods) && shift.workPeriods.length > 0) {
    return shift.workPeriods;
  }
  const startMs = timestampMs(shift.startAt);
  if (!startMs) return [];
  const closedEnd = shift.status === 'closed' ? timestampMs(shift.endAt) || nowMs : nowMs;
  return [
    {
      startIso: new Date(startMs).toISOString(),
      endIso: shift.status === 'closed' ? new Date(closedEnd).toISOString() : null,
    },
  ];
}

function toIsoString(value: unknown, fallbackMs: number) {
  const ms = timestampMs(value) || fallbackMs;
  return new Date(ms).toISOString();
}

export function actualRangeFromShift(shift: DaySummaryShiftLike, nowMs: number) {
  const workPeriods = workPeriodsFromShift(shift, nowMs);
  const first = workPeriods[0];
  const last = workPeriods[workPeriods.length - 1];
  const startMs = first ? timestampMs(first.startIso, first.startIso) || timestampMs(shift.startAt) : timestampMs(shift.startAt);
  if (!startMs) return null;

  const lastClosed = !!(last?.endIso);
  let endMs = lastClosed
    ? timestampMs(last.endIso)
    : shift.status === 'closed'
      ? timestampMs(shift.endAt, last?.endIso) || nowMs
      : nowMs;
  if (!endMs || Number.isNaN(endMs)) endMs = nowMs;

  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
    originalStartIso: toIsoString(first?.originalStartIso || first?.startIso, startMs),
    originalEndIso: toIsoString(
      first?.originalEndIso || last?.originalEndIso || last?.endIso,
      shift.status === 'closed' ? endMs : nowMs
    ),
  };
}

function shiftOverlapsDate(shift: DaySummaryShiftLike, dateKey: string, nowMs: number) {
  const range = actualRangeFromShift(shift, nowMs);
  if (!range) return false;
  const startKey = localDateKey(new Date(range.startIso));
  return startKey === dateKey;
}

export function matchScheduledShift(
  actualStartIso: string,
  actualEndIso: string,
  scheduled: ScheduledShiftRow[],
  dateKey: string,
  usedIds: Set<string>
) {
  const actualStart = new Date(actualStartIso).getTime();
  const actualEnd = new Date(actualEndIso).getTime();
  if (Number.isNaN(actualStart) || Number.isNaN(actualEnd)) return null;

  let bestRow: ScheduledShiftRow | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const row of scheduled) {
    if (row.date !== dateKey || usedIds.has(row.id)) continue;
    const window = scheduledWindowMs(row.date, row.startTime, row.endTime);
    if (!window) continue;
    const overlaps = actualEnd > window.start && actualStart < window.end;
    const distance = Math.abs(actualStart - window.start);
    if (!overlaps && distance > 3 * 60 * 60 * 1000) continue;
    if (distance < bestDistance) {
      bestRow = row;
      bestDistance = distance;
    }
  }
  return bestRow;
}

export function buildDaySummaryRows(
  shifts: DaySummaryShiftLike[],
  scheduled: ScheduledShiftRow[],
  dateKey: string,
  nowMs: number
): DaySummaryRow[] {
  const usedScheduled = new Set<string>();
  const live = shifts.filter(shift => {
    if (shift.isScheduled) return false;
    if (shift.status === 'open') return true;
    const range = actualRangeFromShift(shift, nowMs);
    return !!range && shiftOverlapsDate(shift, dateKey, nowMs)
      && Date.parse(range.endIso) - Date.parse(range.startIso) >= MIN_ACCOUNTABLE_SHIFT_MS;
  });
  const rows: DaySummaryRow[] = [];

  for (const shift of live) {
    let range = actualRangeFromShift(shift, nowMs);
    if (!range && shift.status === 'open') {
      const endIso = new Date(nowMs).toISOString();
      const startIso = new Date(Math.max(0, nowMs - 60 * 1000)).toISOString();
      range = { startIso, endIso, originalStartIso: startIso, originalEndIso: endIso };
    }
    if (!range) continue;
    const matched =
      shift.scheduledShiftId && shift.scheduledStartTime && shift.scheduledEndTime
        ? {
            id: shift.scheduledShiftId,
            date: dateKey,
            startTime: shift.scheduledStartTime,
            endTime: shift.scheduledEndTime,
          }
        : matchScheduledShift(range.startIso, range.endIso, scheduled, dateKey, usedScheduled);
    if (matched) usedScheduled.add(matched.id);
    rows.push({
      draftId: shift.id,
      shiftId: shift.id,
      added: !!(shift.manuallyAdded || shift.source === 'employee_added'),
      isOpen: shift.status === 'open',
      startIso: range.startIso,
      endIso: range.endIso,
      originalStartIso: range.originalStartIso,
      originalEndIso: range.originalEndIso,
      scheduledShiftId: matched?.id || shift.scheduledShiftId || null,
      scheduledStartTime: matched?.startTime || shift.scheduledStartTime || null,
      scheduledEndTime: matched?.endTime || shift.scheduledEndTime || null,
    });
  }

  return rows.sort((a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime());
}

export function mergeDaySummaryRows(current: DaySummaryRow[], incoming: DaySummaryRow[]): DaySummaryRow[] {
  if (incoming.length === 0) return current;
  const currentByShiftId = new Map<string, DaySummaryRow>();
  const localAdds: DaySummaryRow[] = [];
  for (const row of current) {
    if (row.added && !row.shiftId) {
      localAdds.push(row);
    } else if (row.shiftId) {
      currentByShiftId.set(row.shiftId, row);
    }
  }

  const merged = incoming.map(row => {
    const existing = row.shiftId ? currentByShiftId.get(row.shiftId) : undefined;
    if (existing && (existing.added || rowWasEdited(existing))) {
      return {
        ...existing,
        isOpen: row.isOpen,
        scheduledShiftId: existing.scheduledShiftId ?? row.scheduledShiftId,
        scheduledStartTime: existing.scheduledStartTime ?? row.scheduledStartTime,
        scheduledEndTime: existing.scheduledEndTime ?? row.scheduledEndTime,
      };
    }
    return row;
  });

  return [...merged, ...localAdds].sort(
    (a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime()
  );
}

export function createAddedShiftRow(dateKey: string, startTime: string, endTime: string): DaySummaryRow | string {
  const startIso = buildIsoFromDateKeyAndTime(dateKey, startTime);
  const endIso = buildIsoFromDateKeyAndTime(dateKey, endTime);
  const error = validateActualRange(startIso, endIso);
  if (error) return error;
  const draftId = `added-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    draftId,
    added: true,
    isOpen: false,
    startIso,
    endIso,
    originalStartIso: startIso,
    originalEndIso: endIso,
  };
}

export function applyTimesToRow(row: DaySummaryRow, dateKey: string, startTime: string, endTime: string): DaySummaryRow | string {
  const startIso = buildIsoFromDateKeyAndTime(dateKey, startTime);
  const endIso = buildIsoFromDateKeyAndTime(dateKey, endTime);
  const error = validateActualRange(startIso, endIso);
  if (error) return error;
  return { ...row, startIso, endIso };
}

export function daySummaryHasPendingChanges(rows: DaySummaryRow[]) {
  return rows.some(row => row.added || rowWasEdited(row));
}
