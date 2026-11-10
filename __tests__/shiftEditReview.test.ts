jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(async () => undefined),
  getItem: jest.fn(async () => null),
  removeItem: jest.fn(async () => undefined),
}));
jest.mock('@react-native-firebase/firestore', () => ({}));
jest.mock('../src/offline/connectivity', () => ({ isDeviceOnline: jest.fn() }));
jest.mock('../src/offline/outbox', () => ({}));

import {
  buildShiftEditAdminNotification,
  parseShiftEditReviewFromData,
  parseShiftEditReviewFromUrl,
  shiftEditRequestCopy,
} from '../src/notifications/shiftEditReview';
import { buildPendingShiftEdit, type LiveShift } from '../src/services/shifts';
import { buildShiftEditReviewView } from '../src/utils/shiftEditReviewView';

const start = new Date(2026, 8, 1, 8, 0).toISOString();
const end = new Date(2026, 8, 1, 12, 0).toISOString();
const requestedStart = new Date(2026, 8, 1, 9, 0).toISOString();
const requestedEnd = new Date(2026, 8, 1, 13, 0).toISOString();

describe('shift edit admin notifications', () => {
  it('uses the required admin copy', () => {
    expect(shiftEditRequestCopy('Alex Rivera')).toEqual({
      title: 'Shift edit request',
      body: 'Alex Rivera has requested a shift edit',
    });
  });

  it('parses FCM and Notifee payloads including the old eventId fallback', () => {
    expect(
      parseShiftEditReviewFromData({
        type: 'shift_edit_request',
        shiftId: 'shift-1',
        employeeUserId: 'user-1',
        employeeName: 'Alex Rivera',
      })
    ).toEqual({
      shiftId: 'shift-1',
      employeeUserId: 'user-1',
      employeeName: 'Alex Rivera',
    });

    expect(
      parseShiftEditReviewFromData({
        type: 'personal_notification',
        screen: 'Home',
        eventId: 'shift-1',
        employeeUserId: 'user-1',
        employeeName: 'Alex Rivera',
      })
    ).toEqual({
      shiftId: 'shift-1',
      employeeUserId: 'user-1',
      employeeName: 'Alex Rivera',
    });

    expect(
      parseShiftEditReviewFromData({
        type: 'personal_notification',
        screen: 'Events',
        eventId: 'event-1',
      })
    ).toBeNull();
  });

  it('parses deep-link URLs', () => {
    expect(
      parseShiftEditReviewFromUrl(
        'pizzawala://home?type=shift_edit_request&shiftId=shift-1&employeeUserId=user-1&employeeName=Alex'
      )
    ).toEqual({
      shiftId: 'shift-1',
      employeeUserId: 'user-1',
      employeeName: 'Alex',
    });
  });

  it('stores Home nav fields so inbox writes trigger FCM tap routing', () => {
    const notification = buildShiftEditAdminNotification({
      shiftId: 'shift-1',
      employeeUserId: 'user-1',
      employeeName: 'Alex Rivera',
    });
    expect(notification.body).toBe('Alex Rivera has requested a shift edit');
    expect(notification.nav).toEqual({
      screen: 'Home',
      eventId: 'shift-1',
      shiftId: 'shift-1',
      employeeUserId: 'user-1',
      employeeName: 'Alex Rivera',
    });
  });

  it('describes current times vs requested change or delete', () => {
    const shift: LiveShift = {
      id: 'shift-1',
      userId: 'user-1',
      status: 'closed',
      locked: true,
      startAt: start,
      endAt: end,
      geofenceName: 'Market Square',
      workPeriods: [{ startIso: start, endIso: end }],
      breakPeriods: [],
      pendingEdit: buildPendingShiftEdit({
        startIso: requestedStart,
        endIso: requestedEnd,
        kind: 'work',
        periodIndex: 0,
        requestedBy: 'user-1',
      }),
    };

    const editView = buildShiftEditReviewView(shift, 'Alex Rivera');
    expect(editView.hasPending).toBe(true);
    expect(editView.worksiteLabel).toBe('Market Square');
    expect(editView.currentRange).toContain('–');
    expect(editView.requestedLabel).toContain('–');
    expect(editView.requestedLabel).not.toBe('Delete requested');

    const deleteView = buildShiftEditReviewView({ ...shift, pendingDelete: true }, 'Alex Rivera');
    expect(deleteView.requestedLabel).toBe('Delete requested');
  });
});
