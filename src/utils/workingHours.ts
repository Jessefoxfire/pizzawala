import {
  formatShiftDuration,
  normalizeShiftPeriods,
  type LiveShift,
  type ShiftPeriod,
} from '../services/shifts';
import { dateToTimeString } from './eventDays';

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
  startMs: number;
  endMs: number | null;
  durationMs: number;
  locationName?: string;
  isActive: boolean;
  shiftLocked: boolean;
  isEdited: boolean;
  originalStartMs?: number;
  originalEndMs?: number | null;
  originalDurationMs?: number;
  periodStartIso: string;
  periodEndIso: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

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

export const formatTabLabel = (dateKey: string, isToday: boolean) => {
  if (isToday) return 'TODAY';
  const date = dateKeyToDate(dateKey);
  const month = date.toLocaleString('en-US', { month: 'long' }).toUpperCase();
  return `${date.getDate()} ${month}`;
};

const dayBoundsMs = (dateKey: string) => {
  const start = dateKeyToDate(dateKey).getTime();
  return { start, end: start + DAY_MS };
};

const periodOverlapsDay = (period: ShiftPeriod, dateKey: string, nowMs: number) => {
  const { start, end: dayEnd } = dayBoundsMs(dateKey);
  const periodStart = new Date(period.startIso).getTime();
  const periodEnd = period.endIso ? new Date(period.endIso).getTime() : nowMs;
  if (Number.isNaN(periodStart) || Number.isNaN(periodEnd)) return false;
  return periodEnd > start && periodStart < dayEnd;
};

const clipPeriodMs = (period: ShiftPeriod, dateKey: string, nowMs: number) => {
  const { start: dayStart, end: dayEnd } = dayBoundsMs(dateKey);
  const periodStart = new Date(period.startIso).getTime();
  const periodEnd = period.endIso ? new Date(period.endIso).getTime() : nowMs;
  const clippedStart = Math.max(periodStart, dayStart);
  const clippedEnd = Math.min(periodEnd, dayEnd);
  return Math.max(0, clippedEnd - clippedStart);
};

const clipIsoMsToDay = (iso: string | null | undefined, dateKey: string) => {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  const { start: dayStart, end: dayEnd } = dayBoundsMs(dateKey);
  if (ms < dayStart || ms >= dayEnd) return null;
  return ms;
};

const originalDurationOnDay = (period: ShiftPeriod, dateKey: string, nowMs: number) => {
  const origStart = period.originalStartIso || period.startIso;
  const origEnd = period.originalEndIso !== undefined ? period.originalEndIso : period.endIso;
  const startMs = new Date(origStart).getTime();
  const endMs = origEnd ? new Date(origEnd).getTime() : nowMs;
  if (Number.isNaN(startMs)) return undefined;
  const { start: dayStart, end: dayEnd } = dayBoundsMs(dateKey);
  const clippedStart = Math.max(startMs, dayStart);
  const clippedEnd = Math.min(endMs || nowMs, dayEnd);
  if (clippedEnd <= clippedStart) return undefined;
  return clippedEnd - clippedStart;
};

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
    const { workPeriods } = normalizeShiftPeriods(shift, nowMs);
    workPeriods.forEach(period => {
      if (periodOverlapsDay(period, dateKey, nowMs)) {
        total += clipPeriodMs(period, dateKey, nowMs);
      }
    });
  });
  return total;
};

export const totalBreakMsForDay = (shifts: LiveShift[], dateKey: string, nowMs: number) => {
  let total = 0;
  shifts.forEach(shift => {
    const { breakPeriods } = normalizeShiftPeriods(shift, nowMs);
    breakPeriods.forEach(period => {
      if (periodOverlapsDay(period, dateKey, nowMs)) {
        total += clipPeriodMs(period, dateKey, nowMs);
      }
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
    const locationName = shift.geofenceName || shift.worksiteName || undefined;
    const { workPeriods, breakPeriods } = normalizeShiftPeriods(shift, nowMs);

    workPeriods.forEach((period, index) => {
      if (!periodOverlapsDay(period, dateKey, nowMs)) return;
      const { start: dayStart, end: dayEnd } = dayBoundsMs(dateKey);
      const periodStart = new Date(period.startIso).getTime();
      const periodEnd = period.endIso ? new Date(period.endIso).getTime() : nowMs;
      const isActive = !period.endIso && shift.status === 'open';
      const isEdited = !!period.manuallyEdited;
      const originalStartMs = isEdited
        ? clipIsoMsToDay(period.originalStartIso || period.startIso, dateKey) ?? undefined
        : undefined;
      const originalEndMs = isEdited
        ? clipIsoMsToDay(period.originalEndIso ?? period.endIso, dateKey)
        : undefined;
      entries.push({
        id: `${shift.id}-work-${index}`,
        shiftId: shift.id,
        periodIndex: index,
        kind: 'work',
        startMs: Math.max(periodStart, dayStart),
        endMs: isActive ? null : Math.min(periodEnd, dayEnd),
        durationMs: clipPeriodMs(period, dateKey, nowMs),
        locationName,
        isActive,
        shiftLocked: !!shift.locked,
        isEdited,
        originalStartMs,
        originalEndMs,
        originalDurationMs: isEdited
          ? originalDurationOnDay(period, dateKey, nowMs)
          : undefined,
        periodStartIso: period.startIso,
        periodEndIso: period.endIso ?? null,
      });
    });

    breakPeriods.forEach((period, index) => {
      if (!periodOverlapsDay(period, dateKey, nowMs)) return;
      const { start: dayStart, end: dayEnd } = dayBoundsMs(dateKey);
      const periodStart = new Date(period.startIso).getTime();
      const periodEnd = period.endIso ? new Date(period.endIso).getTime() : nowMs;
      const isActive = !period.endIso && shift.status === 'open';
      const isEdited = !!period.manuallyEdited;
      const originalStartMs = isEdited
        ? clipIsoMsToDay(period.originalStartIso || period.startIso, dateKey) ?? undefined
        : undefined;
      const originalEndMs = isEdited
        ? clipIsoMsToDay(period.originalEndIso ?? period.endIso, dateKey)
        : undefined;
      entries.push({
        id: `${shift.id}-break-${index}`,
        shiftId: shift.id,
        periodIndex: index,
        kind: 'break',
        startMs: Math.max(periodStart, dayStart),
        endMs: isActive ? null : Math.min(periodEnd, dayEnd),
        durationMs: clipPeriodMs(period, dateKey, nowMs),
        isActive,
        shiftLocked: !!shift.locked,
        isEdited,
        originalStartMs,
        originalEndMs,
        originalDurationMs: isEdited
          ? originalDurationOnDay(period, dateKey, nowMs)
          : undefined,
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
