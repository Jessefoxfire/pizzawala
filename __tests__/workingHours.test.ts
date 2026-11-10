jest.mock('@react-native-firebase/firestore', () => ({}));
jest.mock('@react-native-community/netinfo', () => ({ fetch: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

import {
  buildDayTimeEntries,
  totalBreakMsForDay,
  totalWorkedMsForDay,
} from '../src/utils/workingHours';
import type { LiveShift } from '../src/services/shifts';

describe('working hours date ownership', () => {
  it('keeps an overnight shift entirely on the local date it started', () => {
    const start = new Date(2026, 8, 1, 23, 50);
    const end = new Date(2026, 8, 2, 11, 21);
    const shift: LiveShift = {
      id: 'overnight',
      userId: 'user-1',
      status: 'closed',
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      workPeriods: [{ startIso: start.toISOString(), endIso: end.toISOString() }],
      breakPeriods: [],
    };
    const duration = end.getTime() - start.getTime();

    expect(totalWorkedMsForDay([shift], '2026-09-01', end.getTime())).toBe(duration);
    expect(buildDayTimeEntries([shift], '2026-09-01', end.getTime())).toHaveLength(1);
    expect(totalWorkedMsForDay([shift], '2026-09-02', end.getTime())).toBe(0);
    expect(buildDayTimeEntries([shift], '2026-09-02', end.getTime())).toHaveLength(0);
  });

  it('retains exactly one minute and excludes shorter shifts', () => {
    const start = new Date(2026, 8, 1, 10, 0);
    const minute = new Date(start.getTime() + 60_000);
    const short = new Date(start.getTime() + 59_999);
    const shifts: LiveShift[] = [
      {
        id: 'one-minute',
        userId: 'user-1',
        status: 'closed',
        startAt: start.toISOString(),
        endAt: minute.toISOString(),
        workPeriods: [{ startIso: start.toISOString(), endIso: minute.toISOString() }],
      },
      {
        id: 'too-short',
        userId: 'user-1',
        status: 'closed',
        startAt: start.toISOString(),
        endAt: short.toISOString(),
        workPeriods: [{ startIso: start.toISOString(), endIso: short.toISOString() }],
      },
    ];

    expect(totalWorkedMsForDay(shifts, '2026-09-01', minute.getTime())).toBe(60_000);
    expect(totalBreakMsForDay(shifts, '2026-09-01', minute.getTime())).toBe(0);
    expect(buildDayTimeEntries(shifts, '2026-09-01', minute.getTime())).toHaveLength(1);
  });

  it('subtracts overlapping breaks from a single work envelope', () => {
    const start = new Date(2026, 8, 1, 8, 0);
    const pauseStart = new Date(2026, 8, 1, 10, 0);
    const pauseEnd = new Date(2026, 8, 1, 10, 30);
    const end = new Date(2026, 8, 1, 12, 0);
    const shift: LiveShift = {
      id: 'envelope',
      userId: 'user-1',
      status: 'closed',
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      workPeriods: [{ startIso: start.toISOString(), endIso: end.toISOString() }],
      breakPeriods: [{ startIso: pauseStart.toISOString(), endIso: pauseEnd.toISOString() }],
    };

    expect(totalWorkedMsForDay([shift], '2026-09-01', end.getTime())).toBe(3.5 * 60 * 60 * 1000);
    expect(totalBreakMsForDay([shift], '2026-09-01', end.getTime())).toBe(30 * 60 * 1000);
  });

  it('keeps driving work periods marked as driving in the hours view', () => {
    const start = new Date(2026, 8, 1, 10, 0);
    const end = new Date(2026, 8, 1, 11, 0);
    const entries = buildDayTimeEntries(
      [{
        id: 'driving',
        userId: 'user-1',
        status: 'closed',
        workCategory: 'driving',
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        workPeriods: [{ startIso: start.toISOString(), endIso: end.toISOString() }],
      }],
      '2026-09-01',
      end.getTime()
    );
    expect(entries[0].workCategory).toBe('driving');
  });

  it('shows only the newest open shift as a live ticking counter', () => {
    const first = new Date(2026, 10, 1, 15, 2, 10);
    const second = new Date(2026, 10, 1, 15, 2, 40);
    const now = new Date(2026, 10, 1, 16, 0, 0).getTime();
    const shifts: LiveShift[] = [
      {
        id: 'open-old',
        userId: 'user-1',
        status: 'open',
        startAt: first.toISOString(),
        workPeriods: [{ startIso: first.toISOString(), endIso: null }],
      },
      {
        id: 'open-new',
        userId: 'user-1',
        status: 'open',
        startAt: second.toISOString(),
        workPeriods: [{ startIso: second.toISOString(), endIso: null }],
      },
    ];

    const entries = buildDayTimeEntries(shifts, '2026-11-01', now);
    expect(entries).toHaveLength(1);
    expect(entries[0].shiftId).toBe('open-new');
    expect(entries[0].isActive).toBe(true);
    expect(totalWorkedMsForDay(shifts, '2026-11-01', now)).toBe(now - second.getTime());
  });
});
