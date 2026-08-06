import type { HygieneActor } from '../services/hygiene';
import type { ShiftPeriod } from '../services/shifts';

export type OutboxTemperatureLog = {
  id: string;
  type: 'temperature_log';
  createdAt: string;
  payload: {
    targetKey: string;
    targetLabel: string;
    temperatureValue: string;
    temperatureUnit: 'C' | 'F';
    notes: string;
    actor: HygieneActor;
    dateKey: string;
    monthKey: string;
    loggedAtIso: string;
  };
};

export type OutboxShiftStart = {
  id: string;
  type: 'shift_start';
  createdAt: string;
  clientShiftId: string;
  payload: {
    userId: string;
    teamId: string;
    geofenceId?: string | null;
    geofenceName?: string | null;
    startedBy: string;
    recordedAtIso: string;
  };
};

export type OutboxShiftEnd = {
  id: string;
  type: 'shift_end';
  createdAt: string;
  payload: {
    shiftId: string;
    endedBy: string;
    recordedAtIso: string;
  };
};

export type OutboxShiftPause = {
  id: string;
  type: 'shift_pause';
  createdAt: string;
  payload: {
    shiftId: string;
    recordedAtIso: string;
  };
};

export type OutboxShiftResume = {
  id: string;
  type: 'shift_resume';
  createdAt: string;
  payload: {
    shiftId: string;
    recordedAtIso: string;
  };
};

export type OutboxItem =
  | OutboxTemperatureLog
  | OutboxShiftStart
  | OutboxShiftEnd
  | OutboxShiftPause
  | OutboxShiftResume;

export type OfflineOpenShift = {
  clientShiftId: string;
  userId: string;
  teamId: string;
  geofenceId?: string | null;
  geofenceName?: string | null;
  startedBy: string;
  recordedAtIso: string;
  workPeriods: ShiftPeriod[];
  breakPeriods: ShiftPeriod[];
  paused: boolean;
  status: 'open';
  pendingSync: true;
};

export type WriteResult = {
  queued: boolean;
  clientShiftId?: string;
};
