import type { GeofenceEventType } from './types';

const GMS_ENTER = 1;
const GMS_EXIT = 2;
const GMS_DWELL = 4;

/** Bridge / headless may send GMS ints, stringified ints, or names. */
export const normalizeGeofenceTransition = (value: unknown): GeofenceEventType | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = value | 0;
    if (n === GMS_ENTER) return 'enter';
    if (n === GMS_EXIT) return 'exit';
    if (n === GMS_DWELL) return 'dwell';
    if ((n & GMS_EXIT) !== 0) return 'exit';
    if ((n & GMS_ENTER) !== 0) return 'enter';
    if ((n & GMS_DWELL) !== 0) return 'dwell';
    return null;
  }
  const s = String(value ?? '')
    .trim()
    .toLowerCase();
  if (s === 'enter' || s === 'exit' || s === 'dwell') return s as GeofenceEventType;
  if (s === '1') return 'enter';
  if (s === '2') return 'exit';
  if (s === '4') return 'dwell';
  return null;
};
