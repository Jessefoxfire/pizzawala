import { pickScheduledEndMs } from '../src/utils/daySummary';
import type { ScheduledShiftRow } from '../src/utils/daySummary';

const SHIFT_END_REMINDER_MS = 30 * 60 * 1000;

describe('pickScheduledEndMs', () => {
  const dateKey = '2026-09-16';
  const startAt = new Date(`${dateKey}T10:05:00`).toISOString();

  it('uses the end time stored on the live shift', () => {
    const endMs = pickScheduledEndMs(
      {
        startAt,
        scheduledStartTime: '10:00',
        scheduledEndTime: '14:00',
      },
      [],
      new Date(`${dateKey}T11:00:00`).getTime()
    );
    expect(endMs).toBe(new Date(`${dateKey}T14:00:00`).getTime());
  });

  it('matches a scheduled row when the live shift has no stored times', () => {
    const scheduled: ScheduledShiftRow[] = [
      { id: 'sched-1', date: dateKey, startTime: '10:00', endTime: '14:00' },
      { id: 'sched-2', date: dateKey, startTime: '15:00', endTime: '17:00' },
    ];
    const endMs = pickScheduledEndMs(
      { startAt },
      scheduled,
      new Date(`${dateKey}T11:00:00`).getTime()
    );
    expect(endMs).toBe(new Date(`${dateKey}T14:00:00`).getTime());
  });

  it('handles overnight scheduled windows', () => {
    const endMs = pickScheduledEndMs(
      {
        startAt: new Date(`${dateKey}T22:10:00`).toISOString(),
        scheduledStartTime: '22:00',
        scheduledEndTime: '02:00',
      },
      [],
      new Date(`${dateKey}T23:00:00`).getTime()
    );
    expect(endMs).toBe(new Date('2026-09-17T02:00:00').getTime());
  });

  it('returns null when there is no matching scheduled shift', () => {
    expect(
      pickScheduledEndMs({ startAt }, [], new Date(`${dateKey}T11:00:00`).getTime())
    ).toBeNull();
  });

  it('places the reminder 30 minutes after scheduled end', () => {
    const endMs = pickScheduledEndMs(
      {
        startAt,
        scheduledStartTime: '10:00',
        scheduledEndTime: '14:00',
      },
      [],
      new Date(`${dateKey}T11:00:00`).getTime()
    );
    expect(endMs).not.toBeNull();
    expect(endMs! + SHIFT_END_REMINDER_MS).toBe(new Date(`${dateKey}T14:30:00`).getTime());
  });
});
