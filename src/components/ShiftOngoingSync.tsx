import { useEffect, useRef } from 'react';
import {
  collection,
  getFirestore,
  limit,
  onSnapshot,
  query,
  where,
} from '@react-native-firebase/firestore';
import { nativeAuth } from '../services/firebase';
import {
  closeOpenShiftAtLimitIfOverdue,
  offlineOpenShiftToLiveShift,
  pauseLiveShift,
  resumeLiveShift,
  type LiveShift,
} from '../services/shifts';
import { getOfflineOpenShift, getPendingShiftEnds } from '../offline/outbox';
import { subscribeOutboxChanges } from '../offline/events';
import type { PendingShiftEnd } from '../offline/types';
import {
  clearNativePendingShiftAction,
  getNativeShiftSnapshot,
  stopNativeShiftOngoing,
  syncNativeShiftOngoing,
  syncNativeShiftSnapshot,
} from '../geofencing/native';
import { shouldPublishOngoingShift, shiftOngoingPayload, shiftOngoingSignature } from '../notifications/shiftOngoing';

export default function ShiftOngoingSync() {
  const lastSigRef = useRef<string>('');
  const pendingEndsRef = useRef<PendingShiftEnd[]>([]);
  const offlineResolvedRef = useRef(false);

  useEffect(() => {
    let unsubOpen: (() => void) | null = null;
    let unsubOutbox: (() => void) | null = null;
    let firestoreShift: LiveShift | null = null;
    let offlineShift: LiveShift | null = null;
    const apply = async (shift: LiveShift | null) => {
      const native = await getNativeShiftSnapshot();
      const action = shouldPublishOngoingShift(shift, {
        offlineResolved: offlineResolvedRef.current,
        cutoffReached: !!native?.cutoffReached,
      });
      if (action === 'keep') return;
      if (action === 'stop') {
        if (lastSigRef.current !== '') {
          lastSigRef.current = '';
          stopNativeShiftOngoing();
        } else {
          syncNativeShiftSnapshot({
            active: false,
            shiftId: null,
            userId: null,
            geofenceId: null,
            geofenceName: null,
            paused: false,
          });
        }
        return;
      }
      if (!shift) return;
      const payload = shiftOngoingPayload(shift);
      const sig = shiftOngoingSignature(payload);
      syncNativeShiftSnapshot({
        active: true,
        shiftId: shift.id,
        userId: shift.userId,
        geofenceId: shift.geofenceId ?? null,
        geofenceName: shift.geofenceName ?? null,
        paused: payload.mode === 'break',
      });
      if (sig === lastSigRef.current) return;
      lastSigRef.current = sig;
      syncNativeShiftOngoing(payload.mode, payload.periodStartMs, payload.baseElapsedMs, payload.workElapsedMs);
    };

    const publish = () => {
      const pendingIds = new Set(pendingEndsRef.current.map(item => item.shiftId));
      const offline = offlineShift && !pendingIds.has(offlineShift.id) ? offlineShift : null;
      const remote = firestoreShift && !pendingIds.has(firestoreShift.id) ? firestoreShift : null;
      void apply(offline || remote);
    };

    const refreshOffline = async () => {
      const [offline, pending] = await Promise.all([getOfflineOpenShift(), getPendingShiftEnds()]);
      pendingEndsRef.current = pending;
      offlineShift = offline ? offlineOpenShiftToLiveShift(offline) : null;
      offlineResolvedRef.current = true;
      publish();
    };

    const applyPendingNativeAction = async () => {
      try {
        const snap = await getNativeShiftSnapshot();
        const action = snap?.pendingAction;
        const shiftId = snap?.shiftId;
        if ((action !== 'pause' && action !== 'resume') || !shiftId) return;
        if (action === 'pause') await pauseLiveShift(shiftId);
        else await resumeLiveShift(shiftId);
        clearNativePendingShiftAction();
        await refreshOffline();
      } catch (err) {
        console.warn('[ShiftOngoingSync] pending native action failed', err);
      }
    };

    const unsubAuth = nativeAuth().onAuthStateChanged(user => {
      if (unsubOpen) {
        unsubOpen();
        unsubOpen = null;
      }
      firestoreShift = null;
      if (!user) {
        offlineResolvedRef.current = true;
        void apply(null);
        return;
      }
      void refreshOffline().then(() => applyPendingNativeAction());
      const openQuery = query(
        collection(getFirestore(), 'shifts'),
        where('userId', '==', user.uid),
        where('status', '==', 'open'),
        limit(5)
      );
      unsubOpen = onSnapshot(openQuery, snap => {
        const best = [...(snap?.docs || [])]
          .map(d => ({ id: d.id, ...d.data() } as LiveShift))
          .filter(s => !s.isScheduled)
          .sort((a, b) => {
            const toMs = (v: unknown) =>
              v && typeof v === 'object' && typeof (v as { toDate?: () => Date }).toDate === 'function'
                ? (v as { toDate: () => Date }).toDate().getTime()
                : 0;
            return toMs(b.startAt) - toMs(a.startAt);
          })[0];
        firestoreShift = best || null;
        if (firestoreShift) {
          void closeOpenShiftAtLimitIfOverdue(firestoreShift);
        }
        publish();
      });
    });

    unsubOutbox = subscribeOutboxChanges(() => {
      void refreshOffline();
    });
    void refreshOffline().then(() => applyPendingNativeAction());

    return () => {
      unsubAuth();
      unsubOpen?.();
      unsubOutbox?.();
    };
  }, []);

  return null;
}
