import { isShiftPaused, resolveLiveShiftPresence } from '../services/shifts';
import {
  getAutoBreakArmed,
  getAutoShiftEnabled,
  getBreakSource,
  getCutoffReached,
  getOriginalShiftStartMs,
  getWorksiteAlertsEnabled,
  isBreakReturnHandledForVisit,
  isEnterHandledForVisit,
  markEnterHandledForInsideVisits,
  isConfirmedAwayForVisit,
  setBreakSource,
  setAutoBreakArmed,
  setOriginalShiftStartMs,
} from './storage';
import { getNativeShiftSnapshot, setNativeSuppressEnterNotifications, syncNativeShiftSnapshot } from './native';
import {
  decideAutoTransition,
  decideGeofenceNotificationFromState,
  type AutoTransitionKind,
  type GeofenceNotificationDecision,
  type GeofenceNotificationVariant,
  type ShiftTrackingState,
} from './geofenceNotificationDecision';

export {
  decideAutoTransition,
  decideGeofenceNotificationFromState,
  type AutoTransitionKind,
  type GeofenceNotificationDecision,
  type GeofenceNotificationVariant,
  type ShiftTrackingState,
};

export async function getShiftTrackingState(userId: string): Promise<ShiftTrackingState> {
  const empty: ShiftTrackingState = {
    known: false,
    open: false,
    paused: false,
    shiftId: null,
    geofenceId: null,
    userId: userId || null,
    breakSource: null,
    autoBreakArmed: true,
    cutoffReached: false,
    originalStartMs: null,
  };
  if (!userId) return { ...empty, known: true };
  const [jsBreakSource, jsArmed, jsCutoff, jsOriginal, native, presence] = await Promise.all([
    getBreakSource(),
    getAutoBreakArmed(),
    getCutoffReached(),
    getOriginalShiftStartMs(),
    getNativeShiftSnapshot(),
    resolveLiveShiftPresence(userId),
  ]);
  const extras = {
    breakSource: (native?.breakSource === 'auto' || native?.breakSource === 'manual'
      ? native.breakSource
      : jsBreakSource) as ShiftTrackingState['breakSource'],
    autoBreakArmed: native?.autoBreakArmed ?? jsArmed,
    cutoffReached: !!native?.cutoffReached || jsCutoff,
    originalStartMs: jsOriginal,
  };
  if (presence.status === 'open' && presence.shift) {
    return {
      known: true,
      open: true,
      paused: isShiftPaused(presence.shift),
      shiftId: presence.shift.id,
      geofenceId: presence.shift.geofenceId ?? null,
      userId,
      ...extras,
    };
  }
  if (presence.status === 'unknown') {
    if (native?.active && (!native.userId || native.userId === userId)) {
      return {
        known: true,
        open: true,
        paused: !!native.paused,
        shiftId: native.shiftId ?? null,
        geofenceId: native.geofenceId ?? null,
        userId: native.userId ?? userId,
        ...extras,
      };
    }
    return { ...empty, ...extras };
  }
  return { ...empty, known: true, open: false, ...extras };
}

export async function decideGeofenceNotification(
  userId: string,
  transition: 'enter' | 'exit',
  geofenceId?: string
): Promise<GeofenceNotificationDecision> {
  const [alertsEnabled, autoEnabled, tracking, enterHandled, breakReturnHandled] = await Promise.all([
    getWorksiteAlertsEnabled(),
    getAutoShiftEnabled(),
    getShiftTrackingState(userId),
    geofenceId ? isEnterHandledForVisit(geofenceId) : Promise.resolve(false),
    geofenceId ? isBreakReturnHandledForVisit(geofenceId) : Promise.resolve(false),
  ]);
  return decideGeofenceNotificationFromState({
    alertsEnabled,
    autoEnabled,
    transition,
    geofenceId,
    tracking,
    enterHandled,
    breakReturnHandled,
  });
}

export async function onShiftStarted(info?: {
  shiftId?: string | null;
  userId?: string | null;
  geofenceId?: string | null;
  geofenceName?: string | null;
  paused?: boolean;
}): Promise<void> {
  await setNativeSuppressEnterNotifications(true);
  if (!info?.paused) {
    await setBreakSource(null);
    const existing = await getOriginalShiftStartMs();
    if (!existing) await setOriginalShiftStartMs(Date.now());
  }
  syncNativeShiftSnapshot({
    active: true,
    shiftId: info?.shiftId ?? null,
    userId: info?.userId ?? null,
    geofenceId: info?.geofenceId ?? null,
    geofenceName: info?.geofenceName ?? null,
    paused: !!info?.paused,
  });
}

export async function onManualBreak(): Promise<void> {
  await setBreakSource('manual');
}

export async function onManualResume(geofenceId?: string | null): Promise<void> {
  await setBreakSource(null);
  const away = geofenceId ? await isConfirmedAwayForVisit(geofenceId) : false;
  await setAutoBreakArmed(!away);
}

export async function onShiftEnded(geofenceId?: string | null): Promise<void> {
  await markEnterHandledForInsideVisits(geofenceId);
  await setNativeSuppressEnterNotifications(false);
  syncNativeShiftSnapshot({
    active: false,
    shiftId: null,
    userId: null,
    geofenceId: null,
    geofenceName: null,
    paused: false,
  });
}
