import type { LiveShift } from '../services/shifts';
import {
  calcWorkedMs,
  getTimestampMs,
  isShiftPaused,
  normalizeShiftPeriods,
} from '../services/shifts';

export type ShiftOngoingPayload = {
  mode: 'working' | 'break';
  periodStartMs: number;
  baseElapsedMs: number;
};

export function shiftOngoingPayload(shift: LiveShift): ShiftOngoingPayload {
  const now = Date.now();
  if (isShiftPaused(shift)) {
    const { breakPeriods } = normalizeShiftPeriods(shift, now);
    let periodStartMs = now;
    for (let i = breakPeriods.length - 1; i >= 0; i -= 1) {
      if (!breakPeriods[i].endIso) {
        const parsed = new Date(breakPeriods[i].startIso).getTime();
        if (!Number.isNaN(parsed)) periodStartMs = parsed;
        break;
      }
    }
    return { mode: 'break', periodStartMs, baseElapsedMs: 0 };
  }

  const { workPeriods } = normalizeShiftPeriods(shift, now);
  let periodStartMs = getTimestampMs(shift.startAt) || now;
  for (let i = workPeriods.length - 1; i >= 0; i -= 1) {
    if (!workPeriods[i].endIso) {
      const parsed = new Date(workPeriods[i].startIso).getTime();
      if (!Number.isNaN(parsed)) periodStartMs = parsed;
      break;
    }
  }
  const baseElapsedMs = Math.max(0, calcWorkedMs(shift, periodStartMs));
  return { mode: 'working', periodStartMs, baseElapsedMs };
}

export function shiftOngoingSignature(payload: ShiftOngoingPayload) {
  return `${payload.mode}:${payload.periodStartMs}:${Math.round(payload.baseElapsedMs)}`;
}
