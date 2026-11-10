jest.mock('@react-native-firebase/firestore', () => ({}));
jest.mock('../src/offline/connectivity', () => ({ isDeviceOnline: jest.fn() }));
jest.mock('../src/offline/outbox', () => ({}));

import {
  applyEditedWorkPeriodTimes,
  buildPendingShiftEdit,
  lockedShiftMutationMode,
  pendingApprovalAction,
  type LiveShift,
} from '../src/services/shifts';
import { buildDayTimeEntries } from '../src/utils/workingHours';

const start = new Date(2026, 8, 1, 8, 0).toISOString();
const end = new Date(2026, 8, 1, 12, 0).toISOString();
const requestedStart = new Date(2026, 8, 1, 9, 0).toISOString();
const requestedEnd = new Date(2026, 8, 1, 13, 0).toISOString();

const lockedShift = (): LiveShift => ({
  id: 'shift-1',
  userId: 'user-1',
  status: 'closed',
  locked: true,
  startAt: start,
  endAt: end,
  workPeriods: [{ startIso: start, endIso: end }],
  breakPeriods: [],
});

describe('locked shift pending approval', () => {
  it('employee save stores pending and does not apply live times', () => {
    const shift = lockedShift();
    expect(lockedShiftMutationMode({ locked: shift.locked, isAdmin: false })).toBe('pending');

    const pending = buildPendingShiftEdit({
      startIso: requestedStart,
      endIso: requestedEnd,
      kind: 'work',
      periodIndex: 0,
      requestedBy: 'user-1',
      requestedAt: '2026-09-01T12:00:00.000Z',
    });
    const afterEmployeeSave: LiveShift = { ...shift, pendingEdit: pending, pendingDelete: false };

    expect(afterEmployeeSave.workPeriods?.[0]?.startIso).toBe(start);
    expect(afterEmployeeSave.workPeriods?.[0]?.endIso).toBe(end);
    expect(afterEmployeeSave.pendingEdit).toEqual(pending);

    const entries = buildDayTimeEntries([afterEmployeeSave], '2026-09-01', new Date(end).getTime());
    expect(entries[0].startMs).toBe(new Date(start).getTime());
    expect(entries[0].endMs).toBe(new Date(end).getTime());
    expect(entries[0].hasPendingApproval).toBe(true);
    expect(entries[0].pendingStartIso).toBe(requestedStart);
  });

  it('admin save applies locked times immediately', () => {
    const shift = lockedShift();
    expect(lockedShiftMutationMode({ locked: shift.locked, isAdmin: true })).toBe('apply');

    const next = applyEditedWorkPeriodTimes(shift.workPeriods || [], shift.breakPeriods || [], 0, requestedStart, requestedEnd);
    expect(next.workPeriods[0].startIso).toBe(requestedStart);
    expect(next.workPeriods[0].endIso).toBe(requestedEnd);
    expect(next.workPeriods[0].manuallyEdited).toBe(true);
  });

  it('approve applies the pending start and end', () => {
    const pending = buildPendingShiftEdit({
      startIso: requestedStart,
      endIso: requestedEnd,
      kind: 'work',
      periodIndex: 0,
      requestedBy: 'user-1',
    });
    const shift: LiveShift = { ...lockedShift(), pendingEdit: pending };
    const action = pendingApprovalAction(shift);
    expect(action).toEqual({
      type: 'update',
      kind: 'work',
      periodIndex: 0,
      startIso: requestedStart,
      endIso: requestedEnd,
    });

    if (action.type !== 'update') throw new Error('expected update');
    const applied = applyEditedWorkPeriodTimes(
      shift.workPeriods || [],
      shift.breakPeriods || [],
      action.periodIndex,
      action.startIso,
      action.endIso
    );
    expect(applied.workPeriods[0].startIso).toBe(requestedStart);
    expect(applied.workPeriods[0].endIso).toBe(requestedEnd);
  });

  it('approve of a pending delete removes the recorded shift', () => {
    expect(pendingApprovalAction({ pendingDelete: true, pendingEdit: null })).toEqual({ type: 'delete' });
  });
});
