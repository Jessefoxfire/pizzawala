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
});
