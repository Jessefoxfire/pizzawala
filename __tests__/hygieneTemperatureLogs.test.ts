import {
  groupTemperatureLogMonths,
  splitLogsByCalendarYear,
} from '../src/utils/hygieneTemperatureLogs';

describe('cooling log calendar years', () => {
  it('keeps a single calendar year as the monthly view with no year file', () => {
    const split = splitLogsByCalendarYear([
      { monthKey: '2026-09' },
      { monthKey: '2026-02' },
      { dateKey: '2026-12-31' },
    ]);
    expect(split.currentYear).toBe('2026');
    expect(split.previousYears).toEqual([]);
    expect(groupTemperatureLogMonths(split.currentLogs).map(month => month.monthKey)).toEqual([
      '2026-12',
      '2026-09',
      '2026-02',
    ]);
  });

  it('creates a previous-year file only after a log in the next calendar year', () => {
    const before = splitLogsByCalendarYear([{ monthKey: '2026-12' }]);
    expect(before.previousYears).toHaveLength(0);

    const after = splitLogsByCalendarYear([
      { monthKey: '2026-12' },
      { dateKey: '2027-02-02' },
      { monthKey: '2027-09' },
    ]);
    expect(after.currentYear).toBe('2027');
    expect(groupTemperatureLogMonths(after.currentLogs).map(month => month.monthKey)).toEqual([
      '2027-09',
      '2027-02',
    ]);
    expect(after.previousYears.map(group => group.year)).toEqual(['2026']);
  });

  it('lists older year files after the newest previous year', () => {
    const split = splitLogsByCalendarYear([
      { monthKey: '2027-09' },
      { monthKey: '2026-11' },
      { monthKey: '2025-03' },
    ]);
    expect(split.previousYears.map(group => group.year)).toEqual(['2026', '2025']);
  });
});
