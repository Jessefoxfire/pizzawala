jest.mock('@react-native-firebase/firestore', () => ({}));
jest.mock('../src/offline/connectivity', () => ({ isDeviceOnline: jest.fn() }));
jest.mock('../src/offline/outbox', () => ({
  getPendingShiftEnds: jest.fn(async () => []),
  rememberOpenShiftId: jest.fn(),
  forgetOpenShiftId: jest.fn(),
  getRememberedOpenShiftId: jest.fn(async () => null),
}));

import {
  applyPendingShiftEnds,
  buildOfflineShiftEndWrite,
  liveShiftsFromLocalOffline,
  resolveHomeActiveShift,
  type LiveShift,
} from '../src/services/shifts';

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

  it('hides the Home ticker when a pending end matches either live id', () => {
    const local = { ...openShift(), id: 'offline-abc' };
    const remote = { ...openShift(), id: 'firestore-xyz' };
    expect(
      resolveHomeActiveShift(local, remote, [
        { shiftId: 'firestore-xyz', endedBy: 'manual', recordedAtIso: '' },
      ])
    ).toBeNull();
    expect(
      resolveHomeActiveShift(local, remote, [
        { shiftId: 'offline-abc', endedBy: 'manual', recordedAtIso: '' },
      ])
    ).toBeNull();
  });

  it('stops the Home ticker after Confirm Day even if Firestore is still open', () => {
    const local = { ...openShift(), id: 'offline-abc' };
    const remote = { ...openShift(), id: 'firestore-xyz' };
    expect(resolveHomeActiveShift(local, remote, [], ['offline-abc', 'firestore-xyz'])).toBeNull();
    expect(resolveHomeActiveShift(null, remote, [], ['offline-abc', 'firestore-xyz'])).toBeNull();
  });

  it('shows a new clock-in after Confirm Day', () => {
    const next = { ...openShift(), id: 'offline-new' };
    expect(resolveHomeActiveShift(next, null, [], ['offline-abc', 'firestore-xyz'])).toEqual(next);
  });

  it('keeps the Home ticker stopped after Confirm Day even if snapshot still has an open shift', () => {
    const remote = { ...openShift(), id: 'firestore-xyz' };
    expect(resolveHomeActiveShift(null, remote, [], [], true)).toBeNull();
  });

  it('keeps a locally closed shift visible in Hours before it syncs', () => {
    const shifts = liveShiftsFromLocalOffline({
      open: null,
      closed: [
        {
          clientShiftId: 'offline-abc',
          userId: 'user-1',
          teamId: 'team-1',
          recordedAtIso: '2026-10-01T08:00:00.000Z',
          workPeriods: [
            { startIso: '2026-10-01T08:00:00.000Z', endIso: '2026-10-01T16:00:00.000Z' },
          ],
          breakPeriods: [],
          startAt: '2026-10-01T08:00:00.000Z',
          endAt: '2026-10-01T16:00:00.000Z',
          pendingSync: true,
        },
      ],
      outbox: [],
      userId: 'user-1',
    });
    expect(shifts).toHaveLength(1);
    expect(shifts[0].status).toBe('closed');
    expect(shifts[0].id).toBe('offline-abc');
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
