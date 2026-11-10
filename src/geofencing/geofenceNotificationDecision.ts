export type GeofenceNotificationVariant = 'prompt' | 'auto_result' | 'break_return';

export type GeofenceNotificationDecision =
  | { show: false }
  | { show: true; variant: GeofenceNotificationVariant };

export type BreakSource = 'auto' | 'manual' | null;

export type ShiftTrackingState = {
  known: boolean;
  open: boolean;
  paused: boolean;
  shiftId: string | null;
  geofenceId: string | null;
  userId: string | null;
  breakSource?: BreakSource;
  autoBreakArmed?: boolean;
  cutoffReached?: boolean;
  originalStartMs?: number | null;
};

export type AutoTransitionKind = 'none' | 'start' | 'pause' | 'resume';

export const AUTO_CONFIRM_MS = 5 * 60 * 1000;
export const SHIFT_LIMIT_MS = 24 * 60 * 60 * 1000;
export const CUTOFF_TITLE = 'Your shift reached the 24-hour limit.';
export const CUTOFF_BODY = 'Review your times and end the day.';

export function pendingAutoWorkOnEvent(
  alreadyScheduled: boolean,
  event: 'repeat_same' | 'opposite' | 'manual'
): 'keep' | 'cancel' | 'schedule' {
  if (event === 'opposite' || event === 'manual') return 'cancel';
  if (event === 'repeat_same' && alreadyScheduled) return 'keep';
  return 'schedule';
}

export function clampToShiftLimitMs(originalStartMs: number, atMs: number): number {
  if (!(originalStartMs > 0)) return atMs;
  return Math.min(atMs, originalStartMs + SHIFT_LIMIT_MS);
}

export function isPastShiftLimit(originalStartMs: number, atMs: number): boolean {
  return originalStartMs > 0 && atMs >= originalStartMs + SHIFT_LIMIT_MS;
}

export function cutoffRecordedAtIso(originalStartMs: number): string {
  return new Date(originalStartMs + SHIFT_LIMIT_MS).toISOString();
}

export function decideAutoTransition(input: {
  autoEnabled: boolean;
  phase: 'confirmed_enter' | 'confirmed_exit';
  geofenceId?: string;
  tracking: ShiftTrackingState;
}): AutoTransitionKind {
  if (!input.autoEnabled || !input.tracking.known) return 'none';
  if (input.tracking.cutoffReached) return 'none';
  const currentSite = !!input.geofenceId && input.geofenceId === input.tracking.geofenceId;

  if (input.phase === 'confirmed_enter') {
    if (input.tracking.open && input.tracking.paused && currentSite) {
      if (input.tracking.breakSource === 'manual') return 'none';
      if (input.tracking.breakSource === 'auto') return 'resume';
      return 'none';
    }
    if (input.tracking.open) return 'none';
    return 'start';
  }

  if (!input.tracking.open || input.tracking.paused) return 'none';
  if (input.tracking.autoBreakArmed === false) return 'none';
  if (input.geofenceId && input.tracking.geofenceId && !currentSite) return 'none';
  return 'pause';
}

export function decideGeofenceNotificationFromState(input: {
  alertsEnabled: boolean;
  autoEnabled?: boolean;
  transition: 'enter' | 'exit';
  geofenceId?: string;
  tracking: ShiftTrackingState;
  enterHandled: boolean;
  breakReturnHandled: boolean;
}): GeofenceNotificationDecision {
  if (!input.alertsEnabled) return { show: false };
  if (!input.tracking.known) return { show: false };
  if (input.autoEnabled) return { show: false };
  if (input.tracking.cutoffReached) return { show: false };

  if (input.transition === 'enter') {
    if (input.tracking.open) return { show: false };
    if (input.enterHandled) return { show: false };
    return { show: true, variant: 'prompt' };
  }

  return { show: false };
}

export function shouldPublishOngoingShift(
  shift: { status?: string | null } | null,
  opts: { offlineResolved: boolean; cutoffReached?: boolean }
): 'sync' | 'keep' | 'stop' {
  if (opts.cutoffReached) return 'keep';
  if (shift && shift.status === 'open') return 'sync';
  if (!opts.offlineResolved) return 'keep';
  return 'stop';
}
