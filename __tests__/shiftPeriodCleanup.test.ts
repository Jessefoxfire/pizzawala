jest.mock('@react-native-firebase/firestore', () => ({}));
jest.mock('../src/offline/connectivity', () => ({ isDeviceOnline: jest.fn() }));
jest.mock('../src/offline/outbox', () => ({}));

import {
  applyActualShiftRange,
  applyEditedWorkPeriodTimes,
  assertShiftCanBeDeleted,
  compactClosedShiftPeriods,
  calcBreakMs,
  calcWorkedMs,
  selectOpenLiveShiftsToEnd,
} from '../src/services/shifts';
import type { LiveShift } from '../src/services/shifts';

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

describe('compactClosedShiftPeriods', () => {
  it('counts a short break as uninterrupted work', () => {
    const result = compactClosedShiftPeriods(
      [
        { startIso: iso(0), endIso: iso(120) },
        { startIso: iso(150), endIso: iso(300) },
      ],
      [{ startIso: iso(120), endIso: iso(150) }],
      300000
    );

    expect(result.workPeriods).toEqual([{ startIso: iso(0), endIso: iso(300) }]);
    expect(result.breakPeriods).toEqual([]);
    expect(result.hasAccountableWork).toBe(true);
  });

  it('removes a short work tap between breaks', () => {
    const result = compactClosedShiftPeriods(
      [{ startIso: iso(120), endIso: iso(150) }],
      [
        { startIso: iso(0), endIso: iso(120) },
        { startIso: iso(150), endIso: iso(300) },
      ],
      300000
    );

    expect(result.workPeriods).toEqual([]);
    expect(result.breakPeriods).toEqual([{ startIso: iso(0), endIso: iso(300) }]);
    expect(result.hasAccountableWork).toBe(false);
  });

  it('marks a standalone under-minute work record for deletion', () => {
    const result = compactClosedShiftPeriods(
      [{ startIso: iso(0), endIso: iso(59) }],
      [],
      59000
    );

    expect(result.workPeriods).toEqual([]);
    expect(result.hasAccountableWork).toBe(false);
  });
});

describe('editing shift times keeps breaks', () => {
  const start = '2026-10-03T08:00:00.000Z';
  const breakStart = '2026-10-03T11:00:00.000Z';
  const breakEnd = '2026-10-03T11:30:00.000Z';
  const end = '2026-10-03T16:00:00.000Z';

  it('rebuilds work around an existing break when the start time is edited', () => {
    const result = applyEditedWorkPeriodTimes(
      [{ startIso: start, endIso: end }],
      [{ startIso: breakStart, endIso: breakEnd }],
      0,
      '2026-10-03T07:30:00.000Z',
      end
    );

    expect(result.breakPeriods).toEqual([{ startIso: breakStart, endIso: breakEnd }]);
    expect(result.workPeriods.map(period => [period.startIso, period.endIso])).toEqual([
      ['2026-10-03T07:30:00.000Z', breakStart],
      [breakEnd, end],
    ]);
  });

  it('keeps a break that only overlaps the new range instead of dropping it', () => {
    const shift: LiveShift = {
      id: 'shift-1',
      userId: 'user-1',
      status: 'closed',
      startAt: start,
      endAt: end,
      workPeriods: [{ startIso: start, endIso: end }],
      breakPeriods: [{ startIso: breakStart, endIso: breakEnd }],
    };
    const result = applyActualShiftRange(
      shift,
      '2026-10-03T11:15:00.000Z',
      end,
      start,
      end
    );

    expect(result.breakPeriods).toEqual([{ startIso: '2026-10-03T11:15:00.000Z', endIso: breakEnd }]);
    expect(result.workPeriods).toEqual([
      expect.objectContaining({ startIso: breakEnd, endIso: end }),
    ]);
    expect(calcBreakMs({ ...shift, ...result })).toBe(15 * 60 * 1000);
    expect(calcWorkedMs({ ...shift, ...result })).toBe((Date.parse(end) - Date.parse(breakEnd)));
  });

  it('rebuilds work around an existing break when the end time is extended', () => {
    const result = applyEditedWorkPeriodTimes(
      [{ startIso: start, endIso: end }],
      [{ startIso: breakStart, endIso: breakEnd }],
      0,
      start,
      '2026-10-03T17:00:00.000Z'
    );

    expect(result.breakPeriods).toEqual([{ startIso: breakStart, endIso: breakEnd }]);
    expect(result.workPeriods.map(period => [period.startIso, period.endIso])).toEqual([
      [start, breakStart],
      [breakEnd, '2026-10-03T17:00:00.000Z'],
    ]);
  });

  it('keeps a mid-shift break when the last work period is shortened', () => {
    const result = applyEditedWorkPeriodTimes(
      [
        { startIso: start, endIso: breakStart },
        { startIso: breakEnd, endIso: end },
      ],
      [{ startIso: breakStart, endIso: breakEnd }],
      1,
      breakEnd,
      '2026-10-03T15:00:00.000Z'
    );

    expect(result.breakPeriods).toEqual([{ startIso: breakStart, endIso: breakEnd }]);
    expect(result.workPeriods.map(period => [period.startIso, period.endIso])).toEqual([
      [start, breakStart],
      [breakEnd, '2026-10-03T15:00:00.000Z'],
    ]);
  });

  it('does not let a later break wipe work when the end is moved before that break', () => {
    const result = applyEditedWorkPeriodTimes(
      [{ startIso: start, endIso: end }],
      [{ startIso: breakStart, endIso: breakEnd }],
      0,
      start,
      '2026-10-03T10:30:00.000Z'
    );

    expect(result.breakPeriods).toEqual([]);
    expect(result.workPeriods.map(period => [period.startIso, period.endIso])).toEqual([
      [start, '2026-10-03T10:30:00.000Z'],
    ]);
  });

  it('clips a trailing break when the whole shift end is moved into it', () => {
    const shift: LiveShift = {
      id: 'shift-1',
      userId: 'user-1',
      status: 'closed',
      startAt: start,
      endAt: end,
      workPeriods: [{ startIso: start, endIso: end }],
      breakPeriods: [{ startIso: '2026-10-03T15:30:00.000Z', endIso: '2026-10-03T16:00:00.000Z' }],
    };
    const result = applyActualShiftRange(
      shift,
      start,
      '2026-10-03T15:45:00.000Z',
      start,
      end
    );

    expect(result.breakPeriods).toEqual([
      { startIso: '2026-10-03T15:30:00.000Z', endIso: '2026-10-03T15:45:00.000Z' },
    ]);
    expect(result.workPeriods.map(period => [period.startIso, period.endIso])).toEqual([
      [start, '2026-10-03T15:30:00.000Z'],
    ]);
  });
});

describe('assertShiftCanBeDeleted', () => {
  it('blocks locked shifts', () => {
    expect(() => assertShiftCanBeDeleted({ locked: true })).toThrow(/locked/);
  });

  it('allows an unlocked recorded shift so the whole document can be removed', () => {
    expect(() => assertShiftCanBeDeleted({ locked: false })).not.toThrow();
    expect(() => assertShiftCanBeDeleted({})).not.toThrow();
  });

  it('lets an admin delete a locked shift', () => {
    expect(() => assertShiftCanBeDeleted({ locked: true }, { allowLocked: true })).not.toThrow();
  });
});

describe('selectOpenLiveShiftsToEnd', () => {
  it('keeps the newest open live shift and marks the rest as extras', () => {
    const result = selectOpenLiveShiftsToEnd([
      {
        id: 'older',
        userId: 'user-1',
        status: 'open',
        startAt: '2026-11-01T14:02:10.000Z',
        workPeriods: [{ startIso: '2026-11-01T14:02:10.000Z' }],
      },
      {
        id: 'newest',
        userId: 'user-1',
        status: 'open',
        startAt: '2026-11-01T14:03:40.000Z',
        workPeriods: [{ startIso: '2026-11-01T14:03:40.000Z' }],
      },
      {
        id: 'closed',
        userId: 'user-1',
        status: 'closed',
        startAt: '2026-11-01T08:00:00.000Z',
        endAt: '2026-11-01T12:00:00.000Z',
      },
    ]);

    expect(result.keep?.id).toBe('newest');
    expect(result.extras.map(shift => shift.id)).toEqual(['older']);
  });
});
