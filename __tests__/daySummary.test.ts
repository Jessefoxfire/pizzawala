import {
  applyTimesToRow,
  buildDaySummaryRows,
  dailyShiftBreakdown,
  createAddedShiftRow,
  formatHoursMinutesLabel,
  formatIsoTimeRange,
  formatScheduledLabel,
  matchScheduledShift,
  mergeDaySummaryRows,
  rowChangeKind,
  totalActualMs,
  validateActualRange,
  validateDaySummaryRows,
  type DaySummaryRow,
} from '../src/utils/daySummary';
import { hoursChangeKind } from '../src/utils/daySummary';

describe('day summary', () => {
  const dateKey = '2026-09-01';

  it('validates missing and inverted times', () => {
    expect(validateActualRange('', '2026-09-01T12:00:00.000Z')).toBeTruthy();
    expect(validateActualRange('2026-09-01T14:00:00.000Z', '2026-09-01T10:00:00.000Z')).toMatch(
      /after start/
    );
    expect(validateActualRange('2026-09-01T10:00:00.000Z', '2026-09-01T14:00:00.000Z')).toBeNull();
  });

  it('matches a scheduled shift without consuming it twice', () => {
    const scheduled = [
      { id: 'sched-1', date: dateKey, startTime: '10:00', endTime: '14:00' },
      { id: 'sched-2', date: dateKey, startTime: '15:00', endTime: '17:00' },
    ];
    const used = new Set<string>();
    const first = matchScheduledShift(
      '2026-09-01T10:07:00',
      '2026-09-01T14:03:00',
      scheduled,
      dateKey,
      used
    );
    used.add(first!.id);
    const second = matchScheduledShift(
      '2026-09-01T15:00:00',
      '2026-09-01T17:00:00',
      scheduled,
      dateKey,
      used
    );
    expect(first?.id).toBe('sched-1');
    expect(second?.id).toBe('sched-2');
  });

  it('builds rows for multiple live shifts and ignores scheduled documents', () => {
    const rows = buildDaySummaryRows(
      [
        {
          id: 'live-1',
          status: 'closed',
          startAt: '2026-09-01T10:00:00',
          endAt: '2026-09-01T14:00:00',
          workPeriods: [{ startIso: '2026-09-01T10:00:00', endIso: '2026-09-01T14:00:00' }],
        },
        {
          id: 'live-2',
          status: 'closed',
          startAt: '2026-09-01T15:00:00',
          endAt: '2026-09-01T17:00:00',
          workPeriods: [{ startIso: '2026-09-01T15:00:00', endIso: '2026-09-01T17:00:00' }],
        },
        {
          id: 'sched-doc',
          status: 'scheduled',
          isScheduled: true,
          startAt: '2026-09-01T10:00:00',
        },
      ],
      [{ id: 'sched-1', date: dateKey, startTime: '10:00', endTime: '14:00' }],
      dateKey,
      Date.parse('2026-09-01T18:00:00')
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].scheduledStartTime).toBe('10:00');
    expect(rows.map(row => row.shiftId)).toEqual(['live-1', 'live-2']);
  });

  it('marks edited and added rows and recalculates total', () => {
    const morning: DaySummaryRow = {
      draftId: 'live-1',
      shiftId: 'live-1',
      added: false,
      isOpen: false,
      startIso: '2026-09-01T09:55:00.000Z',
      endIso: '2026-09-01T14:03:00.000Z',
      originalStartIso: '2026-09-01T10:00:00.000Z',
      originalEndIso: '2026-09-01T14:00:00.000Z',
      scheduledStartTime: '10:00',
      scheduledEndTime: '14:00',
    };
    const added = createAddedShiftRow(dateKey, '18:30', '20:15');
    expect(typeof added).not.toBe('string');
    const rows = [morning, added as DaySummaryRow];
    expect(rowChangeKind(morning)).toBe('edited');
    expect(rowChangeKind(added as DaySummaryRow)).toBe('added');
    expect(validateDaySummaryRows(rows)).toBeNull();
    expect(formatHoursMinutesLabel(totalActualMs(rows))).toMatch(/h /);
  });

  it('discards invalid added shifts', () => {
    expect(createAddedShiftRow(dateKey, '20:00', '18:00')).toEqual(expect.any(String));
    const row: DaySummaryRow = {
      draftId: 'x',
      added: false,
      isOpen: false,
      startIso: '2026-09-01T10:00:00.000Z',
      endIso: '2026-09-01T14:00:00.000Z',
      originalStartIso: '2026-09-01T10:00:00.000Z',
      originalEndIso: '2026-09-01T14:00:00.000Z',
    };
    expect(applyTimesToRow(row, dateKey, '14:00', '10:00')).toEqual(expect.any(String));
  });

  it('keeps pending actual times after an edit and shows 24-hour labels', () => {
    const row: DaySummaryRow = {
      draftId: 'live-1',
      shiftId: 'live-1',
      added: false,
      isOpen: false,
      startIso: new Date(2026, 8, 1, 10, 0, 0).toISOString(),
      endIso: new Date(2026, 8, 1, 14, 0, 0).toISOString(),
      originalStartIso: new Date(2026, 8, 1, 10, 0, 0).toISOString(),
      originalEndIso: new Date(2026, 8, 1, 14, 0, 0).toISOString(),
      scheduledStartTime: '10:00',
      scheduledEndTime: '14:00',
    };
    const edited = applyTimesToRow(row, dateKey, '10:07', '14:03');
    expect(typeof edited).not.toBe('string');
    const next = edited as DaySummaryRow;
    expect(rowChangeKind(next)).toBe('edited');
    expect(next.originalStartIso).toBe(row.originalStartIso);
    expect(next.scheduledStartTime).toBe('10:00');
    expect(formatIsoTimeRange(next.startIso, next.endIso)).toBe('10:07 – 14:03');
    expect(formatScheduledLabel(next.scheduledStartTime, next.scheduledEndTime)).toBe(
      'Scheduled: 10:00 – 14:00'
    );
    expect(formatIsoTimeRange(new Date(2026, 8, 1, 17, 40).toISOString(), new Date(2026, 8, 1, 18, 5).toISOString())).toBe(
      '17:40 – 18:05'
    );
    const again = applyTimesToRow(next, dateKey, '10:07', '14:03') as DaySummaryRow;
    expect(formatIsoTimeRange(again.startIso, again.endIso)).toBe('10:07 – 14:03');
  });

  it('does not treat an unchanged confirm as edited', () => {
    const row: DaySummaryRow = {
      draftId: 'live-1',
      shiftId: 'live-1',
      added: false,
      isOpen: true,
      startIso: '2026-09-01T10:00:00.000Z',
      endIso: '2026-09-01T14:00:00.000Z',
      originalStartIso: '2026-09-01T10:00:00.000Z',
      originalEndIso: '2026-09-01T14:00:00.000Z',
    };
    expect(rowChangeKind(row)).toBeNull();
  });

  it('includes an open shift in the list and total using now as the finish', () => {
    const start = new Date(2026, 8, 1, 8, 0, 0);
    const now = new Date(2026, 8, 1, 11, 0, 0);
    const rows = buildDaySummaryRows(
      [
        {
          id: 'open-1',
          status: 'open',
          startAt: start.toISOString(),
          workPeriods: [{ startIso: start.toISOString() }],
        },
      ],
      [],
      dateKey,
      now.getTime()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].isOpen).toBe(true);
    expect(rows[0].shiftId).toBe('open-1');
    expect(formatIsoTimeRange(rows[0].startIso, rows[0].endIso)).toBe('08:00 – 11:00');
    expect(formatHoursMinutesLabel(totalActualMs(rows))).toBe('3h 00m');
  });

  it('keeps driving separate and omits worksites with no recorded work', () => {
    const breakdown = dailyShiftBreakdown(
      [
        {
          id: 'working',
          status: 'closed',
          geofenceName: 'Worksite A',
          startAt: '2026-09-01T08:00:00.000Z',
          endAt: '2026-09-01T10:30:00.000Z',
          workPeriods: [{ startIso: '2026-09-01T08:00:00.000Z', endIso: '2026-09-01T10:00:00.000Z' }],
          breakPeriods: [{ startIso: '2026-09-01T10:00:00.000Z', endIso: '2026-09-01T10:30:00.000Z' }],
        },
        {
          id: 'driving',
          status: 'closed',
          workCategory: 'driving',
          startAt: '2026-09-01T11:00:00.000Z',
          endAt: '2026-09-01T12:15:00.000Z',
          workPeriods: [{ startIso: '2026-09-01T11:00:00.000Z', endIso: '2026-09-01T12:15:00.000Z' }],
        },
        {
          id: 'empty-worksite',
          status: 'closed',
          geofenceName: 'Worksite B',
          startAt: '2026-09-01T13:00:00.000Z',
          endAt: '2026-09-01T13:00:00.000Z',
          workPeriods: [],
        },
      ],
      dateKey,
      Date.parse('2026-09-01T18:00:00.000Z')
    );
    expect(formatHoursMinutesLabel(breakdown.worksites['Worksite A'])).toBe('2h 00m');
    expect(breakdown.worksites['Worksite B']).toBeUndefined();
    expect(formatHoursMinutesLabel(breakdown.unassignedMs)).toBe('0h 00m');
    expect(formatHoursMinutesLabel(breakdown.breakMs)).toBe('0h 30m');
    expect(formatHoursMinutesLabel(breakdown.drivingMs)).toBe('1h 15m');
  });

  it('merges a late-arriving open shift without dropping existing rows', () => {
    const morningStart = new Date(2026, 8, 1, 10, 0, 0);
    const morningEnd = new Date(2026, 8, 1, 14, 0, 0);
    const openStart = new Date(2026, 8, 1, 16, 0, 0);
    const now = new Date(2026, 8, 1, 18, 0, 0);
    const first = buildDaySummaryRows(
      [
        {
          id: 'closed-1',
          status: 'closed',
          startAt: morningStart.toISOString(),
          endAt: morningEnd.toISOString(),
          workPeriods: [{ startIso: morningStart.toISOString(), endIso: morningEnd.toISOString() }],
        },
      ],
      [],
      dateKey,
      now.getTime()
    );
    const later = buildDaySummaryRows(
      [
        {
          id: 'closed-1',
          status: 'closed',
          startAt: morningStart.toISOString(),
          endAt: morningEnd.toISOString(),
          workPeriods: [{ startIso: morningStart.toISOString(), endIso: morningEnd.toISOString() }],
        },
        {
          id: 'open-1',
          status: 'open',
          startAt: openStart.toISOString(),
          workPeriods: [{ startIso: openStart.toISOString() }],
        },
      ],
      [],
      dateKey,
      now.getTime()
    );
    const merged = mergeDaySummaryRows(first, later);
    expect(merged.map(row => row.shiftId)).toEqual(['closed-1', 'open-1']);
    expect(formatHoursMinutesLabel(totalActualMs(merged))).toBe('6h 00m');
  });

  it('keeps edited times when a live snapshot rebuilds the original range', () => {
    const start = new Date(2026, 8, 1, 8, 0, 0);
    const now = new Date(2026, 8, 1, 11, 0, 0);
    const live = buildDaySummaryRows(
      [
        {
          id: 'open-1',
          status: 'open',
          startAt: start.toISOString(),
          workPeriods: [{ startIso: start.toISOString() }],
        },
      ],
      [],
      dateKey,
      now.getTime()
    );
    const edited = applyTimesToRow(live[0], dateKey, '08:00', '12:30');
    expect(typeof edited).not.toBe('string');
    const rebuilt = buildDaySummaryRows(
      [
        {
          id: 'open-1',
          status: 'open',
          startAt: start.toISOString(),
          workPeriods: [{ startIso: start.toISOString() }],
        },
      ],
      [],
      dateKey,
      now.getTime()
    );
    const merged = mergeDaySummaryRows([edited as DaySummaryRow], rebuilt);
    expect(formatIsoTimeRange(merged[0].startIso, merged[0].endIso)).toBe('08:00 – 12:30');
    expect(merged[0].originalStartIso).toBe(live[0].originalStartIso);
    expect(rowChangeKind(merged[0])).toBe('edited');
  });

  it('does not wipe existing rows when a later snapshot is empty', () => {
    const start = new Date(2026, 8, 1, 8, 0, 0);
    const now = new Date(2026, 8, 1, 11, 0, 0);
    const first = buildDaySummaryRows(
      [
        {
          id: 'open-1',
          status: 'open',
          startAt: start.toISOString(),
          workPeriods: [{ startIso: start.toISOString() }],
        },
      ],
      [],
      dateKey,
      now.getTime()
    );
    expect(mergeDaySummaryRows(first, [])).toEqual(first);
  });
});

describe('hoursChangeKind', () => {
  it('prefers added over edited for employee-entered shifts', () => {
    expect(hoursChangeKind({ manuallyAdded: true, manuallyEdited: true, source: 'employee_added' })).toBe(
      'added'
    );
    expect(hoursChangeKind({ manuallyEdited: true })).toBe('edited');
    expect(hoursChangeKind({ workPeriods: [{ manuallyEdited: true }] })).toBe('edited');
    expect(hoursChangeKind({})).toBeNull();
  });
});
