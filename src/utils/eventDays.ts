export type EventDay = {
  date: string;
  startTime: string;
  endTime: string;
  /** Official closing is on the following calendar day (e.g. 10:00–02:00). */
  endsNextDay?: boolean;
  /** Optional note for this opening-time entry only. */
  note?: string;
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

export function addDaysToDateKey(dateKey: string, amount: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + amount);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Inclusive calendar dates from start through end. Empty when the window is invalid. */
export function expandDateKeys(startKey: string, endKey: string): string[] {
  if (!isValidDateKey(startKey)) return [];
  const end = isValidDateKey(endKey) ? endKey : startKey;
  if (end < startKey) return [];
  const dates: string[] = [];
  let cursor = startKey;
  let guard = 0;
  while (cursor <= end && guard < 366) {
    dates.push(cursor);
    if (cursor === end) break;
    cursor = addDaysToDateKey(cursor, 1);
    guard += 1;
  }
  return dates;
}

function expandDateRange(startKey: string, endKey: string, startTime: string, endTime: string): EventDay[] {
  return expandDateKeys(startKey, endKey).map(date => ({ date, startTime, endTime }));
}

/** Fill every date in the window. Matching dates keep their times/notes; new dates copy the first day. */
export function reconcileEventDays(existing: EventDay[], startDate: string, endDate: string): EventDay[] {
  const dates = expandDateKeys(startDate, endDate);
  if (!dates.length) return [];
  const validExisting = existing.filter(day => isValidDateKey(day.date));
  const template = validExisting[0]
    ? normalizeEventDay(validExisting[0])
    : normalizeEventDay({ date: dates[0], ...DEFAULT_EVENT_DAY_TIMES });
  return dates.map(date => {
    const found = validExisting.find(day => day.date === date);
    return found
      ? normalizeEventDay(found)
      : normalizeEventDay({
          date,
          startTime: template.startTime,
          endTime: template.endTime,
        });
  });
}

export function nextEventDateKey(existing: EventDay[]): string | null {
  const sorted = [...existing]
    .filter(day => isValidDateKey(day.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return null;
  const used = new Set(sorted.map(day => day.date));
  let next = addDaysToDateKey(sorted[sorted.length - 1].date, 1);
  let guard = 0;
  while (used.has(next) && guard < 366) {
    next = addDaysToDateKey(next, 1);
    guard += 1;
  }
  return used.has(next) ? null : next;
}

/** Next calendar day after the last entry, copying that day's times (Büro Add Day). */
export function addNextEventDay(existing: EventDay[]): { days: EventDay[]; added: EventDay } | null {
  const dateKey = nextEventDateKey(existing);
  if (!dateKey) return null;
  const times = timesForNewEventDay(existing, dateKey);
  const added = normalizeEventDay({ date: dateKey, ...times });
  const days = [...existing, added].sort((a, b) => a.date.localeCompare(b.date));
  return { days, added };
}

export function eventDateWindowFromDays(days: EventDay[]): { startDate: string; endDate: string } {
  const sorted = [...days].filter(day => isValidDateKey(day.date)).sort((a, b) => a.date.localeCompare(b.date));
  return {
    startDate: sorted[0]?.date || '',
    endDate: sorted.length > 1 ? sorted[sorted.length - 1].date : sorted[0]?.date || '',
  };
}

export function eventDaysHaveGaps(days: EventDay[]): boolean {
  const dates = [...days].map(day => day.date).filter(isValidDateKey).sort();
  return dates.some((date, index) => index > 0 && date !== addDaysToDateKey(dates[index - 1], 1));
}

export function isCompleteEventDay(day: EventDay): boolean {
  return isValidDateKey(day.date) && isValidEventOpeningRange(day.startTime, day.endTime);
}

export function eventDayIssue(day: EventDay): string | null {
  if (!isValidDateKey(day.date)) return 'Choose a date.';
  if (!isValidEventOpeningRange(day.startTime, day.endTime)) {
    return 'Opening and closing times must be valid and different.';
  }
  return null;
}

export function removeEventDayByDate(days: EventDay[], dateKey: string): EventDay[] {
  return days.filter(day => day.date !== dateKey);
}

/** Compact row when the day is valid and the user is not still editing it. */
export function shouldShowEventDayExpanded(input: {
  day: EventDay;
  forceExpanded: boolean;
  interacting: boolean;
}): boolean {
  if (input.forceExpanded || input.interacting) return true;
  return !isCompleteEventDay(input.day);
}

export function trimOpeningNote(value?: string | null) {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeEventDay(day: EventDay): EventDay {
  const startTime = day.startTime?.trim() || DEFAULT_EVENT_DAY_TIMES.startTime;
  const endTime = day.endTime?.trim() || DEFAULT_EVENT_DAY_TIMES.endTime;
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  const inferredOvernight = start != null && end != null && end < start;
  const note = trimOpeningNote(day.note);
  return {
    date: day.date,
    startTime,
    endTime,
    endsNextDay: inferredOvernight,
    ...(note ? { note } : {}),
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
    return {
      startTime: normalized.startTime,
      endTime: normalized.endTime,
      endsNextDay: eventDayEndsNextDay(normalized),
    };
  }
  return { ...DEFAULT_EVENT_DAY_TIMES, endsNextDay: false };
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

/** Official event hours: same-day end after start, or overnight (end earlier than start). Identical times are invalid. */
export function isValidEventOpeningRange(startTime: string, endTime: string) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start == null || end == null) return false;
  return start !== end;
}

export function eventDayEndsNextDay(day: Pick<EventDay, 'startTime' | 'endTime' | 'endsNextDay'>) {
  const start = timeToMinutes(day.startTime);
  const end = timeToMinutes(day.endTime);
  if (start == null || end == null) return day.endsNextDay === true;
  return end < start;
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

export function formatTimeLabel24(value: string) {
  if (!value?.trim()) return '—';
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return value;
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

export function formatOfficialOpeningRange(startTime: string, endTime: string, endsNextDay?: boolean) {
  const start = formatTimeLabel24(startTime);
  const end = formatTimeLabel24(endTime);
  const s = timeToMinutes(startTime);
  const e = timeToMinutes(endTime);
  const overnight = s != null && e != null ? e < s : endsNextDay === true;
  return overnight ? `${start} – ${end} (+1 day)` : `${start} – ${end}`;
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

export function adjustTimeString(time: string, deltaMinutes: number) {
  const current = timeToMinutes(time) ?? 9 * 60;
  const dayMinutes = 24 * 60;
  const next = ((current + deltaMinutes) % dayMinutes + dayMinutes) % dayMinutes;
  const hours = Math.floor(next / 60);
  const minutes = next % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
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
