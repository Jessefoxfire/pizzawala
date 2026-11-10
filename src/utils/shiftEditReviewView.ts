import {
  normalizeShiftPeriods,
  pendingApprovalAction,
  type LiveShift,
} from '../services/shifts';
import { formatClockTime } from './workingHours';

function formatDateLabel(iso: string | undefined | null): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatRange(startIso?: string | null, endIso?: string | null): string {
  if (!startIso) return '—';
  const startMs = new Date(startIso).getTime();
  if (Number.isNaN(startMs)) return '—';
  const start = formatClockTime(startMs);
  if (!endIso) return `${start} – ongoing`;
  const endMs = new Date(endIso).getTime();
  if (Number.isNaN(endMs)) return start;
  return `${start} – ${formatClockTime(endMs)}`;
}

export function buildShiftEditReviewView(
  shift: LiveShift,
  employeeName: string
): {
  employeeName: string;
  dateLabel: string;
  worksiteLabel: string | null;
  currentRange: string;
  requestedLabel: string;
  kindLabel: string;
  hasPending: boolean;
} {
  const action = pendingApprovalAction(shift);
  const { workPeriods, breakPeriods } = normalizeShiftPeriods(shift);
  const worksiteLabel = (shift.geofenceName || shift.worksiteName || '').trim() || null;
  const dateLabel = formatDateLabel(workPeriods[0]?.startIso || (typeof shift.startAt === 'string' ? shift.startAt : null));

  if (action.type === 'delete') {
    const current = workPeriods[0];
    return {
      employeeName: employeeName.trim() || 'Employee',
      dateLabel,
      worksiteLabel,
      currentRange: formatRange(current?.startIso, current?.endIso),
      requestedLabel: 'Delete requested',
      kindLabel: 'Recorded shift',
      hasPending: true,
    };
  }

  if (action.type === 'update') {
    const periods = action.kind === 'break' ? breakPeriods : workPeriods;
    const current = periods[action.periodIndex];
    return {
      employeeName: employeeName.trim() || 'Employee',
      dateLabel,
      worksiteLabel,
      currentRange: formatRange(current?.startIso, current?.endIso),
      requestedLabel: formatRange(action.startIso, action.endIso),
      kindLabel: action.kind === 'break' ? 'Break' : 'Working time',
      hasPending: true,
    };
  }

  const current = workPeriods[0];
  return {
    employeeName: employeeName.trim() || 'Employee',
    dateLabel,
    worksiteLabel,
    currentRange: formatRange(current?.startIso, current?.endIso),
    requestedLabel: 'No pending change',
    kindLabel: 'Recorded shift',
    hasPending: false,
  };
}
