jest.mock('@react-native-firebase/firestore', () => ({}));
jest.mock('@react-native-community/netinfo', () => ({ fetch: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('react-native-fs', () => ({}));
jest.mock('react-native-share', () => ({}));
jest.mock('jspdf', () => ({ jsPDF: jest.fn() }));

import {
  buildMonthlyTimesheetRows,
  timesheetActivityLabel,
  totalWorkingTimeMs,
} from '../src/services/monthlyTimesheetPdf';
import type { LiveShift } from '../src/services/shifts';

const iso = (hours: number, minutes = 0) => new Date(2026, 9, 3, hours, minutes).toISOString();

const shift = (overrides: Partial<LiveShift> & { id: string; startAt: string; endAt: string }): LiveShift => ({
  userId: 'user-1',
  status: 'closed',
  workPeriods: [{ startIso: overrides.startAt, endIso: overrides.endAt }],
  breakPeriods: [],
  ...overrides,
});

describe('monthly timesheet rows', () => {
  it('labels working rows with the worksite and leaves driving alone', () => {
    expect(timesheetActivityLabel({ workCategory: 'driving', geofenceName: 'Lager' } as LiveShift)).toBe('Driving');
    expect(timesheetActivityLabel({ geofenceName: 'Lager' } as LiveShift)).toBe('Working - Lager');
    expect(timesheetActivityLabel({} as LiveShift)).toBe('Working');
  });

  it('keeps a worksite switch as two working lines on the same day', () => {
    const rows = buildMonthlyTimesheetRows(
      [
        shift({
          id: 'site-1',
          geofenceName: 'Lager',
          startAt: iso(9),
          endAt: iso(13),
        }),
        shift({
          id: 'drive',
          workCategory: 'driving',
          startAt: iso(13),
          endAt: iso(14),
        }),
        shift({
          id: 'site-2',
          geofenceName: 'Kuche',
          startAt: iso(14),
          endAt: iso(18),
        }),
      ],
      '2026-10',
      new Date(2026, 9, 3, 18, 0).getTime()
    );

    expect(rows.map(row => row.activity)).toEqual(['Working - Lager', 'Driving', 'Working - Kuche']);
    expect(totalWorkingTimeMs(rows)).toBe(8 * 60 * 60 * 1000);
  });

  it('combines two shifts at the same site into one row', () => {
    const rows = buildMonthlyTimesheetRows(
      [
        shift({
          id: 'lager-1',
          geofenceName: 'Lager',
          startAt: iso(9),
          endAt: iso(12),
          breakPeriods: [{ startIso: iso(11), endIso: iso(11, 15) }],
          workPeriods: [
            { startIso: iso(9), endIso: iso(11) },
            { startIso: iso(11, 15), endIso: iso(12) },
          ],
        }),
        shift({
          id: 'lager-2',
          geofenceName: 'Lager',
          startAt: iso(14),
          endAt: iso(17),
          breakPeriods: [{ startIso: iso(15), endIso: iso(15, 30) }],
          workPeriods: [
            { startIso: iso(14), endIso: iso(15) },
            { startIso: iso(15, 30), endIso: iso(17) },
          ],
        }),
      ],
      '2026-10',
      new Date(2026, 9, 3, 18, 0).getTime()
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].activity).toBe('Working - Lager');
    expect(rows[0].start).toBe('09:00');
    expect(rows[0].end).toBe('17:00');
    expect(rows[0].breakMs).toBe(45 * 60 * 1000);
    expect(rows[0].workedMs).toBe((5 * 60 + 15) * 60 * 1000);
  });
});
