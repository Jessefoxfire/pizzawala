jest.mock('@react-native-firebase/firestore', () => ({}));
jest.mock('../src/offline/connectivity', () => ({ isDeviceOnline: jest.fn() }));
jest.mock('../src/offline/outbox', () => ({}));

import {
  buildOfflineShiftEndWrite,
  resolveLiveShiftStartPlan,
  type LiveShift,
} from '../src/services/shifts';

const siteA = { geofenceId: 'site-a', workCategory: null as const };
const siteB = { geofenceId: 'site-b', workCategory: null as const };

describe('resolveLiveShiftStartPlan', () => {
  it('starts when there is no open shift', () => {
    expect(resolveLiveShiftStartPlan(null, siteA)).toBe('start');
  });

  it('reuses the open shift when the same site is selected again', () => {
    expect(resolveLiveShiftStartPlan(siteA, siteA)).toBe('reuse');
    expect(resolveLiveShiftStartPlan(siteA, { geofenceId: 'site-a' })).toBe('reuse');
  });

  it('switches when the selected site differs from the open shift', () => {
    expect(resolveLiveShiftStartPlan(siteA, siteB)).toBe('switch');
  });

  it('switches between a worksite and driving', () => {
    expect(resolveLiveShiftStartPlan(siteA, { geofenceId: null, workCategory: 'driving' })).toBe('switch');
  });

  it('is the same decision for Start anyway and dropdown start', () => {
    const startAnyway = resolveLiveShiftStartPlan(siteA, siteB);
    const dropdownSwitch = resolveLiveShiftStartPlan(siteA, siteB);
    expect(startAnyway).toBe('switch');
    expect(dropdownSwitch).toBe(startAnyway);
    expect(resolveLiveShiftStartPlan(siteA, siteA)).toBe('reuse');
  });
});

describe('ending the first site while on break', () => {
  const pausedAtA = (): LiveShift => ({
    id: 'shift-a',
    userId: 'user-1',
    status: 'open',
    paused: true,
    geofenceId: 'site-a',
    geofenceName: 'Lager WM',
    startAt: '2026-10-01T08:00:00.000Z',
    workPeriods: [{ startIso: '2026-10-01T08:00:00.000Z', endIso: '2026-10-01T12:00:00.000Z' }],
    breakPeriods: [{ startIso: '2026-10-01T12:00:00.000Z', endIso: null }],
  });

  it('closes the open break on site A and does not start a new work period there', () => {
    const write = buildOfflineShiftEndWrite(pausedAtA(), {
      shiftId: 'shift-a',
      endedBy: 'manual',
      recordedAtIso: '2026-10-01T12:20:00.000Z',
    });

    expect(write.kind).toBe('update');
    if (write.kind !== 'update') return;
    expect(write.fields.status).toBe('closed');
    expect(write.fields.paused).toBe(false);
    expect(write.fields.workPeriods).toEqual([
      { startIso: '2026-10-01T08:00:00.000Z', endIso: '2026-10-01T12:00:00.000Z' },
    ]);
    expect(write.fields.breakPeriods).toEqual([
      { startIso: '2026-10-01T12:00:00.000Z', endIso: '2026-10-01T12:20:00.000Z' },
    ]);
  });
});
