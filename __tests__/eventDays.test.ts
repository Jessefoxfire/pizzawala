import {
  normalizeEventDay,
  normalizeEventDays,
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
