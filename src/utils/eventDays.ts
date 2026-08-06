export type EventDay = {
  date: string;
  startTime: string;
  endTime: string;
};

export const DEFAULT_EVENT_DAY_TIMES = {
  startTime: '09:00',
  endTime: '17:00',
} as const;

export type EventLike = {
  days?: EventDay[];
  startDate?: string;
  endDate?: string;
  arrivalDate?: string;
  startTime?: string;
  endTime?: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateKey(value: string) {
  return DATE_RE.test(value);
}

function addDaysToDateKey(dateKey: string, amount: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + amount);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function expandDateRange(startKey: string, endKey: string, startTime: string, endTime: string): EventDay[] {
  if (!isValidDateKey(startKey)) return [];
  const end = isValidDateKey(endKey) ? endKey : startKey;
  const days: EventDay[] = [];
  let cursor = startKey;
  let guard = 0;
  while (cursor <= end && guard < 366) {
    days.push({ date: cursor, startTime, endTime });
    if (cursor === end) break;
    cursor = addDaysToDateKey(cursor, 1);
    guard += 1;
  }
  return days;
}

export function normalizeEventDay(day: EventDay): EventDay {
  return {
    date: day.date,
    startTime: day.startTime?.trim() || DEFAULT_EVENT_DAY_TIMES.startTime,
    endTime: day.endTime?.trim() || DEFAULT_EVENT_DAY_TIMES.endTime,
  };
}

/** Times for a newly added day — copy the chronologically previous day, else defaults. */
export function timesForNewEventDay(existingDays: EventDay[], dateKey: string) {
  const sorted = [...existingDays]
    .filter(day => isValidDateKey(day.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  const previous = sorted.filter(day => day.date < dateKey).pop();
  if (previous) {
    const normalized = normalizeEventDay(previous);
    return { startTime: normalized.startTime, endTime: normalized.endTime };
  }
  return { ...DEFAULT_EVENT_DAY_TIMES };
}

export function timeToMinutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isValidTimeRange(startTime: string, endTime: string) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start == null || end == null) return false;
  return end > start;
}

/** Normalize legacy single-date fields into editable event days. */
export function normalizeEventDays(event: EventLike): EventDay[] {
  if (Array.isArray(event.days) && event.days.length > 0) {
    return [...event.days]
      .filter(day => isValidDateKey(day.date))
      .map(normalizeEventDay)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  const startTime = event.startTime || '';
  const endTime = event.endTime || '';
  const start = event.startDate || '';
  const end = event.endDate || start;
  const arrival = event.arrivalDate || '';

  const normalizedStart = startTime.trim() || DEFAULT_EVENT_DAY_TIMES.startTime;
  const normalizedEnd = endTime.trim() || DEFAULT_EVENT_DAY_TIMES.endTime;

  if (arrival && isValidDateKey(arrival)) {
    return [normalizeEventDay({ date: arrival, startTime: normalizedStart, endTime: normalizedEnd })];
  }

  if (start && end && start !== end) {
    return expandDateRange(start, end, normalizedStart, normalizedEnd).map(normalizeEventDay);
  }

  if (start && isValidDateKey(start)) {
    return [normalizeEventDay({ date: start, startTime: normalizedStart, endTime: normalizedEnd })];
  }

  return [];
}

export function getEventSortDate(event: EventLike) {
  const days = normalizeEventDays(event);
  return days[0]?.date || event.arrivalDate || event.startDate || '';
}

export function getEventEndDate(event: EventLike) {
  const days = normalizeEventDays(event);
  if (days.length === 0) return event.endDate || event.startDate || '';
  return days[days.length - 1].date;
}

export function sortEventsByDays<T extends EventLike>(events: T[]) {
  return [...events].sort((a, b) => getEventSortDate(a).localeCompare(getEventSortDate(b)));
}

export function findCurrentOrUpcomingEventIndex<T extends { id: string } & EventLike>(events: T[]) {
  if (!events.length) return 0;
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const currentIndex = events.findIndex(event => {
    const days = normalizeEventDays(event);
    return days.some(day => day.date === todayKey);
  });
  if (currentIndex >= 0) return currentIndex;

  const upcomingIndex = events.findIndex(event => {
    const days = normalizeEventDays(event);
    return days.some(day => day.date >= todayKey);
  });
  if (upcomingIndex >= 0) return upcomingIndex;

  return events.length - 1;
}

export function formatTimeLabel(value: string) {
  if (!value?.trim()) return '—';
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return value;
  const hours = Number(match[1]);
  const minutes = match[2];
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes} ${period}`;
}

export function formatTimeRange(startTime: string, endTime: string) {
  return `${formatTimeLabel(startTime)} – ${formatTimeLabel(endTime)}`;
}

export function formatDayHeading(dateKey: string) {
  try {
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return dateKey;
  }
}

export function timeStringToDate(time: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const date = new Date();
  if (!match) {
    date.setHours(9, 0, 0, 0);
    return date;
  }
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return date;
}

export function dateToTimeString(value: Date) {
  const hours = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function pickLinkedScheduleDate(event: EventLike) {
  const days = normalizeEventDays(event);
  if (days.length === 0) return undefined;
  const todayKey = localTodayKey();
  const todayDay = days.find(day => day.date === todayKey);
  if (todayDay) return todayDay.date;
  const upcoming = days.find(day => day.date >= todayKey);
  return upcoming?.date || days[days.length - 1].date;
}

function localTodayKey() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}
