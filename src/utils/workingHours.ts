import {
  formatShiftDuration,
  getTimestampMs,
  normalizeShiftPeriods,
  type LiveShift,
  type ShiftPeriod,
} from '../services/shifts';
import { dateToTimeString } from './eventDays';
import { hoursChangeKind } from './daySummary';

export { hoursChangeKind };

export type ScheduledShiftRow = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
};

export type DayTimeEntry = {
  id: string;
  shiftId: string;
  periodIndex: number;
  kind: 'work' | 'break';
  workCategory?: 'driving' | null;
  startMs: number;
  endMs: number | null;
  durationMs: number;
  locationName?: string;
  isActive: boolean;
  shiftLocked: boolean;
  isEdited: boolean;
  isAdded: boolean;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  originalStartMs?: number;
  originalEndMs?: number | null;
  originalDurationMs?: number;
  periodStartIso: string;
  periodEndIso: string | null;
};

export const MIN_ACCOUNTABLE_SHIFT_MS = 60 * 1000;

export const localDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const dateKeyToDate = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export const buildRecentDateKeys = (days = 7) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    keys.push(localDateKey(d));
  }
  return keys;
};

export const addDaysToDateKey = (dateKey: string, days: number) => {
  const date = dateKeyToDate(dateKey);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
};

/** Past dates for the Hours rolodex, oldest → newest, excluding today. */
export const buildHoursRolodexDateKeys = (todayKey: string, selectedDateKey: string) => {
  const defaultStart = addDaysToDateKey(todayKey, -400);
  const selectedStart =
    selectedDateKey && selectedDateKey < todayKey ? addDaysToDateKey(selectedDateKey, -60) : defaultStart;
  const startKey = selectedStart < defaultStart ? selectedStart : defaultStart;
  const keys: string[] = [];
  let key = startKey;
  while (key < todayKey) {
    keys.push(key);
    key = addDaysToDateKey(key, 1);
  }
  return keys;
};

/** Index of the first of 5 visible rolodex dates. Selected stays centered until today cuts off following days. */
export const hoursRolodexWindowStart = (selectedDateKey: string, todayKey: string, keys: string[]) => {
  if (keys.length <= 5) return 0;
  const maxStart = keys.length - 5;
  if (!selectedDateKey || selectedDateKey >= todayKey) return maxStart;
  const idx = keys.indexOf(selectedDateKey);
  if (idx < 0) return maxStart;
  return Math.max(0, Math.min(idx - 2, maxStart));
};

export const formatTabLabel = (dateKey: string, isToday: boolean) => {
  if (isToday) return 'TODAY';
  const date = dateKeyToDate(dateKey);
  const month = date.toLocaleString('en-US', { month: 'short' });
  return `${date.getDate()} ${month}`;
};

const periodMs = (period: ShiftPeriod, nowMs: number) => {
  const start = new Date(period.startIso).getTime();
  const end = period.endIso ? new Date(period.endIso).getTime() : nowMs;
  return Number.isNaN(start) || Number.isNaN(end) ? 0 : Math.max(0, end - start);
};

const shiftStartDateKey = (shift: LiveShift) => {
  const firstPeriod = shift.workPeriods?.[0]?.startIso || shift.breakPeriods?.[0]?.startIso;
  const startMs = getTimestampMs(shift.startAt) || (firstPeriod ? new Date(firstPeriod).getTime() : 0);
  return Number.isNaN(startMs) || !startMs ? null : localDateKey(new Date(startMs));
};

const shiftDurationMs = (shift: LiveShift, nowMs: number) => {
  const { workPeriods, breakPeriods } = normalizeShiftPeriods(shift, nowMs);
  return [...workPeriods, ...breakPeriods].reduce((total, period) => total + periodMs(period, nowMs), 0);
};

const belongsToStartDate = (shift: LiveShift, dateKey: string, nowMs: number) =>
  shiftStartDateKey(shift) === dateKey && shiftDurationMs(shift, nowMs) >= MIN_ACCOUNTABLE_SHIFT_MS;

export function parseDayTimeEntryId(id: string) {
  const match = /-(work|break)-(\d+)$/.exec(id);
  if (!match) return null;
  return {
    shiftId: id.slice(0, match.index),
    kind: match[1] as 'work' | 'break',
    periodIndex: Number(match[2]),
  };
}

export function msToTimeValue(ms: number) {
  return dateToTimeString(new Date(ms));
}

export function buildIsoFromDateKeyAndTime(dateKey: string, time: string) {
  const withSeconds = time.trim().length === 5 ? `${time.trim()}:00` : time.trim();
  return new Date(`${dateKey}T${withSeconds}`).toISOString();
}

export function applyTimeToIso(baseIso: string, time: string) {
  const base = new Date(baseIso);
  const normalized = time.trim();
  const withSeconds = normalized.length === 5 ? `${normalized}:00` : normalized;
  const [hours, minutes, seconds] = withSeconds.split(':').map(part => Number(part));
  base.setHours(hours, minutes, seconds || 0, 0);
  return base.toISOString();
}

const parseScheduledTimeMs = (dateKey: string, time: string) => {
  const normalized = time.trim();
  const withSeconds = normalized.length === 5 ? `${normalized}:00` : normalized;
  return new Date(`${dateKey}T${withSeconds}`).getTime();
};

export function formatOriginalEntryRange(entry: DayTimeEntry) {
  if (!entry.isEdited) return null;
  if (entry.originalStartMs != null) {
    if (entry.originalEndMs == null) {
      return `Was ${formatClockTime(entry.originalStartMs)}`;
    }
    return `Was ${formatClockTime(entry.originalStartMs)} - ${formatClockTime(entry.originalEndMs)}`;
  }
  if (entry.originalDurationMs != null) {
    return `Was ${formatEntryDuration(entry.originalDurationMs, false)}`;
  }
  return null;
}

export const scheduledMsForDate = (rows: ScheduledShiftRow[], dateKey: string) =>
  rows
    .filter(row => row.date === dateKey)
    .reduce((total, row) => {
      const start = parseScheduledTimeMs(dateKey, row.startTime);
      const end = parseScheduledTimeMs(dateKey, row.endTime);
      if (Number.isNaN(start) || Number.isNaN(end)) return total;
      return total + Math.max(0, end - start);
    }, 0);

export const totalWorkedMsForDay = (shifts: LiveShift[], dateKey: string, nowMs: number) => {
  let total = 0;
  shifts.forEach(shift => {
    if (!belongsToStartDate(shift, dateKey, nowMs)) return;
    const { workPeriods } = normalizeShiftPeriods(shift, nowMs);
    workPeriods.forEach(period => {
      total += periodMs(period, nowMs);
    });
  });
  return total;
};

export const totalBreakMsForDay = (shifts: LiveShift[], dateKey: string, nowMs: number) => {
  let total = 0;
  shifts.forEach(shift => {
    if (!belongsToStartDate(shift, dateKey, nowMs)) return;
    const { breakPeriods } = normalizeShiftPeriods(shift, nowMs);
    breakPeriods.forEach(period => {
      total += periodMs(period, nowMs);
    });
  });
  return total;
};

export const buildDayTimeEntries = (
  shifts: LiveShift[],
  dateKey: string,
  nowMs: number
): DayTimeEntry[] => {
  const entries: DayTimeEntry[] = [];

  shifts.forEach(shift => {
    if (!belongsToStartDate(shift, dateKey, nowMs)) return;
    const locationName = shift.geofenceName || shift.worksiteName || undefined;
    const { workPeriods, breakPeriods } = normalizeShiftPeriods(shift, nowMs);

    workPeriods.forEach((period, index) => {
      const periodStart = new Date(period.startIso).getTime();
      const periodEnd = period.endIso ? new Date(period.endIso).getTime() : nowMs;
      const isActive = !period.endIso && shift.status === 'open';
      const isAdded = hoursChangeKind(shift) === 'added';
      const isEdited = isAdded ? false : !!(period.manuallyEdited || shift.manuallyEdited);
      const originalStartMs = isEdited ? new Date(period.originalStartIso || period.startIso).getTime() : undefined;
      const originalEndMs = isEdited && (period.originalEndIso ?? period.endIso)
        ? new Date((period.originalEndIso ?? period.endIso)!).getTime()
        : undefined;
      entries.push({
        id: `${shift.id}-work-${index}`,
        shiftId: shift.id,
        periodIndex: index,
        kind: 'work',
        workCategory: shift.workCategory ?? null,
        startMs: periodStart,
        endMs: isActive ? null : periodEnd,
        durationMs: periodMs(period, nowMs),
        locationName,
        isActive,
        shiftLocked: !!shift.locked,
        isEdited,
        isAdded,
        scheduledStartTime: shift.scheduledStartTime || null,
        scheduledEndTime: shift.scheduledEndTime || null,
        originalStartMs,
        originalEndMs,
        originalDurationMs: isEdited ? periodMs({ ...period, startIso: period.originalStartIso || period.startIso, endIso: period.originalEndIso ?? period.endIso }, nowMs) : undefined,
        periodStartIso: period.startIso,
        periodEndIso: period.endIso ?? null,
      });
    });

    breakPeriods.forEach((period, index) => {
      const periodStart = new Date(period.startIso).getTime();
      const periodEnd = period.endIso ? new Date(period.endIso).getTime() : nowMs;
      const isActive = !period.endIso && shift.status === 'open';
      const isAdded = hoursChangeKind(shift) === 'added';
      const isEdited = isAdded ? false : !!(period.manuallyEdited || shift.manuallyEdited);
      const originalStartMs = isEdited ? new Date(period.originalStartIso || period.startIso).getTime() : undefined;
      const originalEndMs = isEdited && (period.originalEndIso ?? period.endIso)
        ? new Date((period.originalEndIso ?? period.endIso)!).getTime()
        : undefined;
      entries.push({
        id: `${shift.id}-break-${index}`,
        shiftId: shift.id,
        periodIndex: index,
        kind: 'break',
        startMs: periodStart,
        endMs: isActive ? null : periodEnd,
        durationMs: periodMs(period, nowMs),
        isActive,
        shiftLocked: !!shift.locked,
        isEdited,
        isAdded,
        scheduledStartTime: shift.scheduledStartTime || null,
        scheduledEndTime: shift.scheduledEndTime || null,
        originalStartMs,
        originalEndMs,
        originalDurationMs: isEdited ? periodMs({ ...period, startIso: period.originalStartIso || period.startIso, endIso: period.originalEndIso ?? period.endIso }, nowMs) : undefined,
        periodStartIso: period.startIso,
        periodEndIso: period.endIso ?? null,
      });
    });
  });

  return entries.sort((a, b) => b.startMs - a.startMs);
};

export const formatClockTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const formatTotalHoursLabel = (ms: number) => {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} Hours`;
};

export const formatScheduledTargetLabel = (ms: number) => {
  if (ms <= 0) return null;
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours}:00 Hours`;
  return `${hours}:${String(minutes).padStart(2, '0')} Hours`;
};

export const formatEntryDuration = (ms: number, isActive: boolean) => {
  if (isActive) return formatShiftDuration(ms);
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

export const formatEntryRange = (entry: DayTimeEntry) => {
  if (entry.isActive) return `Since ${formatClockTime(entry.startMs)}`;
  if (entry.endMs == null) return formatClockTime(entry.startMs);
  return `${formatClockTime(entry.startMs)} - ${formatClockTime(entry.endMs)}`;
};
