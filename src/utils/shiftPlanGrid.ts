import { getEventEndDate, getEventSortDate, normalizeEventDays, type EventLike } from './eventDays';

export const UNLINKED_EVENT_ID = '__unlinked__';

export type ScheduleEventRef = EventLike & {
  id: string;
  title?: string;
  name?: string;
  geofenceId?: string | null;
  locationName?: string;
  seasonId?: string | null;
};

export type ScheduleGeofenceRef = {
  id: string;
  name?: string;
  eventId?: string | null;
};

export type ScheduledShiftLike = {
  id?: string;
  userId?: string;
  userName?: string;
  worksiteName?: string;
  geofenceName?: string;
  eventId?: string | null;
  geofenceId?: string | null;
  date: string;
  startTime?: string;
  endTime?: string;
};

export type ShiftPlanEmployee = {
  userId: string;
  userName: string;
  shiftCount: number;
};

export type ShiftPlanDayHeader = {
  dateKey: string;
  weekday: string;
  dateLabel: string;
};

export type ShiftPlanCell = {
  dateKey: string;
  label: string;
  empty: boolean;
  shifts: ScheduledShiftLike[];
};

export type ShiftPlanRow = {
  userId: string;
  userName: string;
  cells: ShiftPlanCell[];
};

export type ShiftPlanGrid = {
  title: string;
  eventId: string;
  eventName: string;
  dayHeaders: ShiftPlanDayHeader[];
  rows: ShiftPlanRow[];
  staffing: { dateKey: string; count: number; label: string }[];
};

const WEEKDAYS_DE = ['SONNTAG', 'MONTAG', 'DIENSTAG', 'MITTWOCH', 'DONNERSTAG', 'FREITAG', 'SAMSTAG'];
const MONTHS_DE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

function normName(value?: string | null) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function idOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === 'string') return id.trim();
  }
  return '';
}

/** "Bernau 8" belongs to event "Bernau"; exact titles still win. */
function namesMatch(a: string, b: string) {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.startsWith(`${b} `) || b.startsWith(`${a} `) || a.startsWith(`${b}-`) || b.startsWith(`${a}-`);
}

function eventNames(event: ScheduleEventRef): string[] {
  return [event.title, event.name, event.locationName].map(normName).filter(Boolean);
}

function shiftWorksiteNames(shift: ScheduledShiftLike): string[] {
  return [shift.worksiteName, shift.geofenceName].map(normName).filter(Boolean);
}

function eventById(events: ScheduleEventRef[], eventId: string | null | undefined) {
  const id = idOf(eventId);
  if (!id) return undefined;
  return events.find(event => event.id === id);
}

function pickBestEvent(matches: ScheduleEventRef[]) {
  if (matches.length <= 1) return matches[0];
  return [...matches].sort((a, b) => {
    const byTitle = normName(b.title).length - normName(a.title).length;
    if (byTitle !== 0) return byTitle;
    return a.id.localeCompare(b.id);
  })[0];
}

export function formatSchichtplanDayHeading(dateKey: string): ShiftPlanDayHeader {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) {
    return { dateKey, weekday: '', dateLabel: dateKey };
  }
  return {
    dateKey,
    weekday: WEEKDAYS_DE[date.getDay()],
    dateLabel: `${date.getDate()}. ${MONTHS_DE[date.getMonth()]}`,
  };
}

export function formatSchichtplanTimeRange(startTime?: string, endTime?: string) {
  const start = String(startTime || '').trim();
  const end = String(endTime || '').trim();
  if (!start && !end) return '—';
  if (start && end) return `${start}–${end}`;
  return start || end;
}

export function resolveShiftEventId(
  shift: ScheduledShiftLike,
  events: ScheduleEventRef[],
  geofences: ScheduleGeofenceRef[]
): string | null {
  const fromShiftEvent = eventById(events, shift.eventId);
  if (fromShiftEvent) return fromShiftEvent.id;

  const shiftGeofenceId = idOf(shift.geofenceId);
  if (shiftGeofenceId) {
    const geofence = geofences.find(item => item.id === shiftGeofenceId);
    const fromGeofenceEvent = eventById(events, geofence?.eventId);
    if (fromGeofenceEvent) return fromGeofenceEvent.id;

    const linkedEvent = events.find(event => idOf(event.geofenceId) === shiftGeofenceId);
    if (linkedEvent) return linkedEvent.id;
  }

  const worksites = shiftWorksiteNames(shift);
  const namedGeofences = geofences.filter(item => worksites.some(name => namesMatch(name, normName(item.name))));
  for (const geofence of namedGeofences) {
    const fromGeofenceEvent = eventById(events, geofence.eventId);
    if (fromGeofenceEvent) return fromGeofenceEvent.id;

    const linkedEvent = events.find(event => idOf(event.geofenceId) === geofence.id);
    if (linkedEvent) return linkedEvent.id;
  }

  const byLinkedGeofence = events.find(event => {
    const geofenceId = idOf(event.geofenceId);
    if (!geofenceId) return false;
    const linked = geofences.find(item => item.id === geofenceId);
    return worksites.some(name => namesMatch(name, normName(linked?.name)));
  });
  if (byLinkedGeofence) return byLinkedGeofence.id;

  const byEventName = pickBestEvent(
    events.filter(event => {
      const labels = eventNames(event);
      return worksites.some(worksite => labels.some(label => namesMatch(worksite, label)));
    })
  );
  return byEventName?.id || null;
}

export function eventDayKeys(event: EventLike): string[] {
  return normalizeEventDays(event).map(day => day.date);
}

export function uniqueEmployeesFromShifts(shifts: ScheduledShiftLike[]): ShiftPlanEmployee[] {
  const map = new Map<string, ShiftPlanEmployee>();
  shifts.forEach(shift => {
    const userId = String(shift.userId || shift.userName || '').trim();
    if (!userId) return;
    const existing = map.get(userId);
    if (existing) {
      existing.shiftCount += 1;
      if (!existing.userName && shift.userName) existing.userName = shift.userName;
      return;
    }
    map.set(userId, {
      userId,
      userName: String(shift.userName || 'Team member').trim() || 'Team member',
      shiftCount: 1,
    });
  });
  return [...map.values()].sort((a, b) => a.userName.localeCompare(b.userName));
}

export function groupScheduledShiftsByEvent(
  shifts: ScheduledShiftLike[],
  events: ScheduleEventRef[],
  geofences: ScheduleGeofenceRef[]
) {
  const byEvent = new Map<string, ScheduledShiftLike[]>();
  const unlinked: ScheduledShiftLike[] = [];

  shifts.forEach(shift => {
    const eventId = resolveShiftEventId(shift, events, geofences);
    if (!eventId) {
      unlinked.push(shift);
      return;
    }
    const list = byEvent.get(eventId) ?? [];
    list.push(shift);
    byEvent.set(eventId, list);
  });

  const groups = events
    .map(event => ({
      event,
      shifts: byEvent.get(event.id) ?? [],
    }))
    .filter(group => group.shifts.length > 0)
    .sort((a, b) => getEventSortDate(a.event).localeCompare(getEventSortDate(b.event)));

  return { groups, unlinked };
}

export function buildShiftPlanGrid(params: {
  eventId: string;
  eventName: string;
  shifts: ScheduledShiftLike[];
  dayKeys?: string[];
  employeeUserId?: string;
}): ShiftPlanGrid {
  const filtered = params.employeeUserId
    ? params.shifts.filter(shift => String(shift.userId || shift.userName) === params.employeeUserId)
    : params.shifts;

  const datesWithShifts = [...new Set(filtered.map(shift => shift.date).filter(Boolean))].sort();
  const requestedDays = (params.dayKeys || []).filter(Boolean);
  const dayKeys = [
    ...requestedDays.filter(dateKey => datesWithShifts.includes(dateKey)),
    ...datesWithShifts.filter(dateKey => !requestedDays.includes(dateKey)),
  ];

  const employees = uniqueEmployeesFromShifts(filtered);
  const dayHeaders = dayKeys.map(formatSchichtplanDayHeading);

  const rows: ShiftPlanRow[] = employees.map(employee => ({
    userId: employee.userId,
    userName: employee.userName,
    cells: dayKeys.map(dateKey => {
      const dayShifts = filtered.filter(
        shift =>
          String(shift.userId || shift.userName) === employee.userId && shift.date === dateKey
      );
      return {
        dateKey,
        empty: dayShifts.length === 0,
        label:
          dayShifts.length === 0
            ? '—'
            : dayShifts
                .map(shift => formatSchichtplanTimeRange(shift.startTime, shift.endTime))
                .join('\n'),
        shifts: dayShifts,
      };
    }),
  }));

  const staffing = dayKeys.map(dateKey => {
    const people = new Set(
      filtered
        .filter(shift => shift.date === dateKey)
        .map(shift => String(shift.userId || shift.userName || ''))
        .filter(Boolean)
    );
    const count = people.size;
    return {
      dateKey,
      count,
      label: `${count} Person${count === 1 ? '' : 'en'}`,
    };
  });

  return {
    title: `SCHICHTPLAN · ${params.eventName}`,
    eventId: params.eventId,
    eventName: params.eventName,
    dayHeaders,
    rows,
    staffing,
  };
}

export function eventPeriodLabel(event: EventLike) {
  const start = getEventSortDate(event);
  const end = getEventEndDate(event);
  if (!start) return '';
  const startHeading = formatSchichtplanDayHeading(start);
  if (!end || end === start) return startHeading.dateLabel;
  const endHeading = formatSchichtplanDayHeading(end);
  return `${startHeading.dateLabel} – ${endHeading.dateLabel}`;
}
