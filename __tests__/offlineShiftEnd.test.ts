jest.mock('@react-native-firebase/firestore', () => ({}));
jest.mock('../src/offline/connectivity', () => ({ isDeviceOnline: jest.fn() }));
jest.mock('../src/offline/outbox', () => ({
  getPendingShiftEnds: jest.fn(async () => []),
  rememberOpenShiftId: jest.fn(),
  forgetOpenShiftId: jest.fn(),
  getRememberedOpenShiftId: jest.fn(async () => null),
}));

import { applyPendingShiftEnds, buildOfflineShiftEndWrite, type LiveShift } from '../src/services/shifts';

function openShift(): LiveShift {
  return {
    id: 'shift-1',
    userId: 'user-1',
    status: 'open',
    paused: false,
    startAt: '2026-10-01T08:00:00.000Z',
    workPeriods: [{ startIso: '2026-10-01T08:00:00.000Z' }],
    breakPeriods: [],
  };
}

describe('offline shift end', () => {
  it('closes an open shift at the recorded clock-out time', () => {
    const write = buildOfflineShiftEndWrite(openShift(), {
      shiftId: 'shift-1',
      endedBy: 'manual',
      recordedAtIso: '2026-10-01T16:00:00.000Z',
    });

    expect(write.kind).toBe('update');
    if (write.kind !== 'update') return;
    expect(write.fields.status).toBe('closed');
    expect(write.fields.endAt).toBe('2026-10-01T16:00:00.000Z');
    expect(write.fields.workPeriods).toEqual([
      { startIso: '2026-10-01T08:00:00.000Z', endIso: '2026-10-01T16:00:00.000Z' },
    ]);
  });

  it('shows a queued clock-out as already finished', () => {
    const [shift] = applyPendingShiftEnds(
      [openShift()],
      [
        {
          shiftId: 'shift-1',
          endedBy: 'manual',
          recordedAtIso: '2026-10-01T16:00:00.000Z',
        },
      ]
    );

    expect(shift.status).toBe('closed');
    expect(shift.workPeriods?.[0].endIso).toBe('2026-10-01T16:00:00.000Z');
  });

  it('keeps an edited finish time on the queued clock-out', () => {
    const write = buildOfflineShiftEndWrite(openShift(), {
      shiftId: 'shift-1',
      endedBy: 'manual',
      recordedAtIso: '2026-10-01T15:30:00.000Z',
      timesChanged: true,
      actualStartIso: '2026-10-01T09:00:00.000Z',
      actualEndIso: '2026-10-01T15:30:00.000Z',
      originalStartIso: '2026-10-01T08:00:00.000Z',
      originalEndIso: '2026-10-01T16:00:00.000Z',
      editedBy: 'user-1',
    });

    expect(write.kind).toBe('update');
    if (write.kind !== 'update') return;
    expect(write.fields.workPeriods).toEqual([
      expect.objectContaining({
        startIso: '2026-10-01T09:00:00.000Z',
        endIso: '2026-10-01T15:30:00.000Z',
      }),
    ]);
  });
});
