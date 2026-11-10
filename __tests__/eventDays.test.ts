import {
  addNextEventDay,
  eventDateWindowFromDays,
  eventDayIssue,
  eventDaysHaveGaps,
  expandDateKeys,
  isCompleteEventDay,
  normalizeEventDay,
  normalizeEventDays,
  reconcileEventDays,
  removeEventDayByDate,
  shouldShowEventDayExpanded,
  trimOpeningNote,
} from '../src/utils/eventDays';

describe('event opening-time notes', () => {
  it('preserves a per-day note and strips empty notes', () => {
    expect(
      normalizeEventDay({
        date: '2026-09-12',
        startTime: '18:00',
        endTime: '23:00',
        note: '  Food trucks may arrive from 16:00  ',
      }).note
    ).toBe('Food trucks may arrive from 16:00');
    expect(
      normalizeEventDay({
        date: '2026-09-12',
        startTime: '18:00',
        endTime: '23:00',
        note: '   ',
      }).note
    ).toBeUndefined();
    expect(trimOpeningNote(null)).toBeUndefined();
    expect(trimOpeningNote('Full team required')).toBe('Full team required');
  });

  it('keeps notes when normalizing existing events and ignores missing notes', () => {
    const days = normalizeEventDays({
      days: [
        { date: '2026-09-12', startTime: '18:00', endTime: '23:00', note: 'Food trucks may arrive from 16:00' },
        { date: '2026-09-13', startTime: '12:00', endTime: '23:00' },
      ],
    });
    expect(days).toHaveLength(2);
    expect(days[0].note).toBe('Food trucks may arrive from 16:00');
    expect(days[1].note).toBeUndefined();
  });
});

describe('event date range and Add Day', () => {
  it('expands a date range into individual calendar days', () => {
    expect(expandDateKeys('2026-06-12', '2026-06-14')).toEqual([
      '2026-06-12',
      '2026-06-13',
      '2026-06-14',
    ]);
    expect(expandDateKeys('2026-06-12', '2026-06-12')).toEqual(['2026-06-12']);
    expect(expandDateKeys('2026-06-14', '2026-06-12')).toEqual([]);
    expect(expandDateKeys('nope', '2026-06-12')).toEqual([]);
    expect(expandDateKeys('2026-01-30', '2026-02-01')).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
    ]);
    expect(expandDateKeys('2026-12-31', '2027-01-01')).toEqual(['2026-12-31', '2027-01-01']);
  });

  it('creates daily entries from a range and keeps existing times on matching dates', () => {
    const existing = [
      normalizeEventDay({ date: '2026-06-12', startTime: '18:00', endTime: '23:00', note: 'Open late' }),
    ];
    const days = reconcileEventDays(existing, '2026-06-12', '2026-06-14');
    expect(days).toHaveLength(3);
    expect(days[0]).toMatchObject({ date: '2026-06-12', startTime: '18:00', endTime: '23:00', note: 'Open late' });
    expect(days[1]).toMatchObject({ date: '2026-06-13', startTime: '18:00', endTime: '23:00' });
    expect(days[1].note).toBeUndefined();
    expect(days[2].date).toBe('2026-06-14');
  });

  it('drops days outside a shrunken range', () => {
    const existing = reconcileEventDays([], '2026-06-12', '2026-06-15');
    const next = reconcileEventDays(existing, '2026-06-13', '2026-06-14');
    expect(next.map(day => day.date)).toEqual(['2026-06-13', '2026-06-14']);
  });

  it('Add Day advances to the next unused date and copies previous times', () => {
    const start = [normalizeEventDay({ date: '2026-06-12', startTime: '10:00', endTime: '02:00' })];
    const first = addNextEventDay(start);
    expect(first?.added).toMatchObject({ date: '2026-06-13', startTime: '10:00', endTime: '02:00', endsNextDay: true });
    const skipped = addNextEventDay([
      ...first!.days,
      normalizeEventDay({ date: '2026-06-15', startTime: '09:00', endTime: '17:00' }),
    ]);
    expect(skipped?.added.date).toBe('2026-06-16');
    expect(addNextEventDay([])).toBeNull();
    const yearWrap = addNextEventDay([
      normalizeEventDay({ date: '2026-12-31', startTime: '18:00', endTime: '23:00' }),
    ]);
    expect(yearWrap?.added).toMatchObject({ date: '2027-01-01', startTime: '18:00', endTime: '23:00' });
  });

  it('validates incomplete and identical times', () => {
    expect(eventDayIssue({ date: '', startTime: '09:00', endTime: '17:00' })).toBe('Choose a date.');
    expect(eventDayIssue({ date: '2026-06-12', startTime: '10:00', endTime: '10:00' })).toMatch(/different/);
    expect(isCompleteEventDay({ date: '2026-06-12', startTime: '22:00', endTime: '02:00' })).toBe(true);
    expect(isCompleteEventDay({ date: '2026-06-12', startTime: '10:00', endTime: '10:00' })).toBe(false);
  });

  it('keeps values when collapsing and reopening a complete day', () => {
    const day = normalizeEventDay({
      date: '2026-06-12',
      startTime: '18:00',
      endTime: '23:00',
      note: 'Food trucks from 16:00',
    });
    expect(shouldShowEventDayExpanded({ day, forceExpanded: false, interacting: false })).toBe(false);
    expect(shouldShowEventDayExpanded({ day, forceExpanded: true, interacting: false })).toBe(true);
    expect(shouldShowEventDayExpanded({
      day: { ...day, endTime: '18:00' },
      forceExpanded: false,
      interacting: false,
    })).toBe(true);
    expect(shouldShowEventDayExpanded({ day, forceExpanded: false, interacting: true })).toBe(true);
    const collapsed = { ...day };
    const reopened = normalizeEventDay(collapsed);
    expect(reopened).toEqual(day);
  });

  it('removes a day without changing the others', () => {
    const days = reconcileEventDays([], '2026-06-12', '2026-06-14');
    expect(removeEventDayByDate(days, '2026-06-13').map(day => day.date)).toEqual(['2026-06-12', '2026-06-14']);
    expect(eventDaysHaveGaps(removeEventDayByDate(days, '2026-06-13'))).toBe(true);
    expect(eventDateWindowFromDays(days)).toEqual({ startDate: '2026-06-12', endDate: '2026-06-14' });
  });
});
