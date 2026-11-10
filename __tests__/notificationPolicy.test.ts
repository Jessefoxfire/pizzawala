import {
  AUTO_CONFIRM_MS,
  SHIFT_LIMIT_MS,
  clampToShiftLimitMs,
  cutoffRecordedAtIso,
  decideAutoTransition,
  decideGeofenceNotificationFromState,
  isPastShiftLimit,
  pendingAutoWorkOnEvent,
  shouldPublishOngoingShift,
  type ShiftTrackingState,
} from '../src/geofencing/geofenceNotificationDecision';

const tracking = (partial: Partial<ShiftTrackingState>): ShiftTrackingState => ({
  known: true,
  open: false,
  paused: false,
  shiftId: null,
  geofenceId: null,
  userId: 'u1',
  breakSource: null,
  autoBreakArmed: true,
  cutoffReached: false,
  originalStartMs: null,
  ...partial,
});

describe('decideGeofenceNotificationFromState', () => {
  it('shows start prompt when clocked out at a worksite', () => {
    expect(
      decideGeofenceNotificationFromState({
        alertsEnabled: true,
        transition: 'enter',
        geofenceId: 'lager',
        tracking: tracking({ open: false }),
        enterHandled: false,
        breakReturnHandled: false,
      })
    ).toEqual({ show: true, variant: 'prompt' });
  });

  it('does not retrigger enter after Ignore until a confirmed leave', () => {
    expect(
      decideGeofenceNotificationFromState({
        alertsEnabled: true,
        transition: 'enter',
        geofenceId: 'lager',
        tracking: tracking({ open: false }),
        enterHandled: true,
        breakReturnHandled: false,
      })
    ).toEqual({ show: false });
  });

  it('does not show a separate leave banner while working; End Day and Break live on the timer', () => {
    expect(
      decideGeofenceNotificationFromState({
        alertsEnabled: true,
        transition: 'exit',
        geofenceId: 'lager',
        tracking: tracking({ open: true, paused: false, geofenceId: 'lager', shiftId: 's1' }),
        enterHandled: false,
        breakReturnHandled: false,
      })
    ).toEqual({ show: false });
  });

  it('does not show a separate return banner; End Day and Resume live on the break timer', () => {
    expect(
      decideGeofenceNotificationFromState({
        alertsEnabled: true,
        transition: 'enter',
        geofenceId: 'lager',
        tracking: tracking({ open: true, paused: true, geofenceId: 'lager', shiftId: 's1' }),
        enterHandled: true,
        breakReturnHandled: false,
      })
    ).toEqual({ show: false });
  });

  it('does not assume clocked-out while tracking is unknown', () => {
    expect(
      decideGeofenceNotificationFromState({
        alertsEnabled: true,
        transition: 'enter',
        geofenceId: 'lager',
        tracking: tracking({ known: false }),
        enterHandled: false,
        breakReturnHandled: false,
      })
    ).toEqual({ show: false });
  });
});

describe('autotracking delays', () => {
  it('uses a 5-minute confirm window for auto and Ignore re-arm', () => {
    expect(AUTO_CONFIRM_MS).toBe(5 * 60 * 1000);
  });

  it('keeps a pending start/pause on repeated geofence events and cancels on the opposite or manual action', () => {
    expect(pendingAutoWorkOnEvent(true, 'repeat_same')).toBe('keep');
    expect(pendingAutoWorkOnEvent(false, 'repeat_same')).toBe('schedule');
    expect(pendingAutoWorkOnEvent(true, 'opposite')).toBe('cancel');
    expect(pendingAutoWorkOnEvent(true, 'manual')).toBe('cancel');
  });
});

describe('decideAutoTransition', () => {
  it('starts a new shift after confirmed enter while clocked out', () => {
    expect(
      decideAutoTransition({
        autoEnabled: true,
        phase: 'confirmed_enter',
        geofenceId: 'lager',
        tracking: tracking({ open: false }),
      })
    ).toBe('start');
  });

  it('does not start another shift when one is already active', () => {
    expect(
      decideAutoTransition({
        autoEnabled: true,
        phase: 'confirmed_enter',
        geofenceId: 'lager',
        tracking: tracking({ open: true, paused: false, geofenceId: 'lager', shiftId: 's1' }),
      })
    ).toBe('none');
  });

  it('pauses the current working shift after confirmed leave of that worksite', () => {
    expect(
      decideAutoTransition({
        autoEnabled: true,
        phase: 'confirmed_exit',
        geofenceId: 'lager',
        tracking: tracking({ open: true, paused: false, geofenceId: 'lager', shiftId: 's1' }),
      })
    ).toBe('pause');
  });

  it('does not auto-break another worksite, a break, or a disarmed resume-outside', () => {
    expect(
      decideAutoTransition({
        autoEnabled: true,
        phase: 'confirmed_exit',
        geofenceId: 'buro',
        tracking: tracking({ open: true, paused: false, geofenceId: 'lager', shiftId: 's1' }),
      })
    ).toBe('none');
    expect(
      decideAutoTransition({
        autoEnabled: true,
        phase: 'confirmed_exit',
        geofenceId: 'lager',
        tracking: tracking({ open: true, paused: true, geofenceId: 'lager', shiftId: 's1', breakSource: 'auto' }),
      })
    ).toBe('none');
    expect(
      decideAutoTransition({
        autoEnabled: true,
        phase: 'confirmed_exit',
        geofenceId: 'lager',
        tracking: tracking({
          open: true,
          paused: false,
          geofenceId: 'lager',
          shiftId: 's1',
          autoBreakArmed: false,
        }),
      })
    ).toBe('none');
  });

  it('resumes only automatic breaks after confirmed re-enter', () => {
    expect(
      decideAutoTransition({
        autoEnabled: true,
        phase: 'confirmed_enter',
        geofenceId: 'lager',
        tracking: tracking({
          open: true,
          paused: true,
          geofenceId: 'lager',
          shiftId: 's1',
          breakSource: 'auto',
        }),
      })
    ).toBe('resume');
    expect(
      decideAutoTransition({
        autoEnabled: true,
        phase: 'confirmed_enter',
        geofenceId: 'lager',
        tracking: tracking({
          open: true,
          paused: true,
          geofenceId: 'lager',
          shiftId: 's1',
          breakSource: 'manual',
        }),
      })
    ).toBe('none');
  });

  it('does not auto-transition when autotracking is off or after the 24-hour cutoff', () => {
    expect(
      decideAutoTransition({
        autoEnabled: false,
        phase: 'confirmed_enter',
        geofenceId: 'lager',
        tracking: tracking({ open: false }),
      })
    ).toBe('none');
    expect(
      decideAutoTransition({
        autoEnabled: true,
        phase: 'confirmed_enter',
        geofenceId: 'lager',
        tracking: tracking({ open: false, cutoffReached: true }),
      })
    ).toBe('none');
  });
});

describe('autotracking vs manual prompts', () => {
  it('hides Start/Ignore when autotracking is on', () => {
    expect(
      decideGeofenceNotificationFromState({
        alertsEnabled: true,
        autoEnabled: true,
        transition: 'enter',
        geofenceId: 'lager',
        tracking: tracking({ open: false }),
        enterHandled: false,
        breakReturnHandled: false,
      })
    ).toEqual({ show: false });
  });

  it('keeps manual Start/Ignore when autotracking is off', () => {
    expect(
      decideGeofenceNotificationFromState({
        alertsEnabled: true,
        autoEnabled: false,
        transition: 'enter',
        geofenceId: 'lager',
        tracking: tracking({ open: false }),
        enterHandled: false,
        breakReturnHandled: false,
      })
    ).toEqual({ show: true, variant: 'prompt' });
  });
});

describe('24-hour cutoff', () => {
  const start = Date.parse('2026-11-08T08:00:00.000Z');

  it('closes the interval at start plus 24 hours even if the timer runs late', () => {
    const late = start + SHIFT_LIMIT_MS + 45 * 60 * 1000;
    expect(clampToShiftLimitMs(start, late)).toBe(start + SHIFT_LIMIT_MS);
    expect(isPastShiftLimit(start, start + SHIFT_LIMIT_MS - 1)).toBe(false);
    expect(isPastShiftLimit(start, start + SHIFT_LIMIT_MS)).toBe(true);
    expect(cutoffRecordedAtIso(start)).toBe(new Date(start + SHIFT_LIMIT_MS).toISOString());
    expect(clampToShiftLimitMs(0, late)).toBe(late);
  });
});

describe('shouldPublishOngoingShift', () => {
  it('keeps the native timer while offline state has not resolved', () => {
    expect(shouldPublishOngoingShift(null, { offlineResolved: false })).toBe('keep');
  });

  it('keeps the cutoff notification after the live shift is closed for review', () => {
    expect(shouldPublishOngoingShift(null, { offlineResolved: true, cutoffReached: true })).toBe('keep');
  });

  it('syncs an open shift including paused breaks', () => {
    expect(shouldPublishOngoingShift({ status: 'open' }, { offlineResolved: true })).toBe('sync');
  });

  it('stops only after a resolved empty snapshot', () => {
    expect(shouldPublishOngoingShift(null, { offlineResolved: true })).toBe('stop');
  });
});

