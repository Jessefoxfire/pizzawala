jest.mock('@react-native-firebase/firestore', () => ({}));
jest.mock('../src/offline/connectivity', () => ({ isDeviceOnline: jest.fn() }));
jest.mock('../src/offline/outbox', () => ({}));

import { compactClosedShiftPeriods } from '../src/services/shifts';

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
