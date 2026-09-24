import {
  buildShiftPlanGrid,
  formatSchichtplanDayHeading,
  formatSchichtplanTimeRange,
  groupScheduledShiftsByEvent,
  resolveShiftEventId,
  uniqueEmployeesFromShifts,
} from '../src/utils/shiftPlanGrid';

const events = [
  { id: 'e-deich', title: 'Deichbrand', locationName: 'Cuxhaven' },
  { id: 'e-hurr', title: 'Hurricane', locationName: 'HH' },
  { id: 'e-bernau', title: 'Bernau', locationName: 'Bernau', geofenceId: null as string | null, days: [
    { date: '2026-09-18', startTime: '09:00', endTime: '17:00' },
    { date: '2026-09-19', startTime: '10:00', endTime: '01:00' },
  ] },
];

const geofences = [
  { id: 'g1', name: 'Deichbrand', eventId: null as string | null },
  { id: 'g2', name: 'Hurricane', eventId: null as string | null },
  { id: 'g3', name: 'Warehouse', eventId: null as string | null },
  { id: 'g4', name: 'Bernau 8', eventId: null as string | null },
];

describe('shiftPlanGrid', () => {
  it('resolves historical shifts by event title even when eventId and geofence links are missing', () => {
    expect(resolveShiftEventId({ date: '2026-07-17', eventId: 'e-deich' }, events, geofences)).toBe('e-deich');
    expect(resolveShiftEventId({ date: '2026-07-17', worksiteName: 'Deichbrand' }, events, geofences)).toBe('e-deich');
    expect(resolveShiftEventId({ date: '2026-06-20', worksiteName: 'Hurricane' }, events, geofences)).toBe('e-hurr');
    expect(resolveShiftEventId({ date: '2026-07-05', worksiteName: 'Bernau 8' }, events, geofences)).toBe('e-bernau');
    expect(resolveShiftEventId({ date: '2026-06-12', worksiteName: 'Warehouse' }, events, geofences)).toBeNull();
  });

  it('resolves via geofenceId on the shift or event when names differ', () => {
    const linkedEvents = [{ id: 'e-fest', title: 'Festival', locationName: 'Field', geofenceId: 'g-fest' }];
    const linkedGeofences = [{ id: 'g-fest', name: 'Main Stage', eventId: 'e-fest' }];
    expect(
      resolveShiftEventId({ date: '2026-07-01', worksiteName: 'Main Stage', geofenceId: 'g-fest' }, linkedEvents, linkedGeofences)
    ).toBe('e-fest');
  });

  it('groups scheduled shifts by real events and keeps unlinked leftovers', () => {
    const shifts = [
      { id: '1', userId: 'anna', userName: 'Anna', worksiteName: 'Deichbrand', date: '2026-07-17', startTime: '10:00', endTime: '16:00' },
      { id: '2', userId: 'ben', userName: 'Ben', worksiteName: 'Hurricane', date: '2026-06-20', startTime: '12:00', endTime: '20:00' },
      { id: '3', userId: 'chris', userName: 'Chris', worksiteName: 'Warehouse', date: '2026-06-12', startTime: '09:00', endTime: '17:00' },
      { id: '4', userId: 'lea', userName: 'Lea', worksiteName: 'Bernau 8', date: '2026-07-13', startTime: '20:05', endTime: '21:00' },
    ];
    const { groups, unlinked } = groupScheduledShiftsByEvent(shifts, events, geofences);
    expect(groups.map(g => g.event.title)).toEqual(['Deichbrand', 'Hurricane', 'Bernau']);
    expect(groups.find(g => g.event.title === 'Deichbrand')?.shifts).toHaveLength(1);
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0].userName).toBe('Chris');
  });

  it('lists unique employees for an event', () => {
    const employees = uniqueEmployeesFromShifts([
      { userId: 'anna', userName: 'Anna', date: '2026-06-12' },
      { userId: 'anna', userName: 'Anna', date: '2026-06-13' },
      { userId: 'ben', userName: 'Ben', date: '2026-06-12' },
    ]);
    expect(employees.map(e => e.userName)).toEqual(['Anna', 'Ben']);
    expect(employees[0].shiftCount).toBe(2);
  });

  it('builds an Excel-like grid and omits days with no shifts', () => {
    expect(formatSchichtplanDayHeading('2026-06-12')).toEqual({
      dateKey: '2026-06-12',
      weekday: 'FREITAG',
      dateLabel: '12. Juni',
    });
    expect(formatSchichtplanTimeRange('10:00', '16:00')).toBe('10:00–16:00');

    const grid = buildShiftPlanGrid({
      eventId: 'e-deich',
      eventName: 'Deichbrand',
      dayKeys: ['2026-06-12', '2026-06-13', '2026-06-14'],
      shifts: [
        { userId: 'anna', userName: 'Anna', date: '2026-06-12', startTime: '10:00', endTime: '16:00' },
        { userId: 'anna', userName: 'Anna', date: '2026-06-13', startTime: '12:00', endTime: '20:00' },
        { userId: 'ben', userName: 'Ben', date: '2026-06-12', startTime: '16:00', endTime: '22:00' },
      ],
    });

    expect(grid.title).toBe('SCHICHTPLAN · Deichbrand');
    expect(grid.rows).toHaveLength(2);
    expect(grid.dayHeaders.map(d => d.dateKey)).toEqual(['2026-06-12', '2026-06-13']);
    expect(grid.rows[0].cells.map(c => c.label)).toEqual(['10:00–16:00', '12:00–20:00']);
    expect(grid.staffing.map(s => s.label)).toEqual(['2 Personen', '1 Person']);
  });

  it('can build a one-employee grid for a tapped user', () => {
    const grid = buildShiftPlanGrid({
      eventId: 'e-deich',
      eventName: 'Deichbrand',
      employeeUserId: 'anna',
      dayKeys: ['2026-06-12', '2026-06-13'],
      shifts: [
        { userId: 'anna', userName: 'Anna', date: '2026-06-12', startTime: '10:00', endTime: '16:00' },
        { userId: 'ben', userName: 'Ben', date: '2026-06-12', startTime: '16:00', endTime: '22:00' },
      ],
    });
    expect(grid.rows).toHaveLength(1);
    expect(grid.rows[0].userName).toBe('Anna');
    expect(grid.dayHeaders.map(d => d.dateKey)).toEqual(['2026-06-12']);
    expect(grid.staffing[0].count).toBe(1);
  });
});
