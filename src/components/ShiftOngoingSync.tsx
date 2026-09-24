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
  offlineOpenShiftToLiveShift,
  type LiveShift,
} from '../services/shifts';
import { getOfflineOpenShift } from '../offline/outbox';
import { subscribeOutboxChanges } from '../offline/events';
import { stopNativeShiftOngoing, syncNativeShiftOngoing } from '../geofencing/native';
import { shiftOngoingPayload, shiftOngoingSignature } from '../notifications/shiftOngoing';

export default function ShiftOngoingSync() {
  const lastSigRef = useRef<string>('');

  useEffect(() => {
    let unsubOpen: (() => void) | null = null;
    let unsubOutbox: (() => void) | null = null;
    let firestoreShift: LiveShift | null = null;
    let offlineShift: LiveShift | null = null;

    const apply = (shift: LiveShift | null) => {
      if (!shift || shift.status !== 'open') {
        if (lastSigRef.current !== '') {
          lastSigRef.current = '';
          stopNativeShiftOngoing();
        }
        return;
      }
      const payload = shiftOngoingPayload(shift);
      const sig = shiftOngoingSignature(payload);
      if (sig === lastSigRef.current) return;
      lastSigRef.current = sig;
      syncNativeShiftOngoing(payload.mode, payload.periodStartMs, payload.baseElapsedMs);
    };

    const publish = () => {
      apply(offlineShift || firestoreShift);
    };

    const refreshOffline = async () => {
      const offline = await getOfflineOpenShift();
      offlineShift = offline ? offlineOpenShiftToLiveShift(offline) : null;
      publish();
    };

    const unsubAuth = nativeAuth().onAuthStateChanged(user => {
      if (unsubOpen) {
        unsubOpen();
        unsubOpen = null;
      }
      firestoreShift = null;
      if (!user) {
        apply(null);
        return;
      }
      void refreshOffline();
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
        publish();
      });
    });

    unsubOutbox = subscribeOutboxChanges(() => {
      void refreshOffline();
    });
    void refreshOffline();

    return () => {
      unsubAuth();
      unsubOpen?.();
      unsubOutbox?.();
      stopNativeShiftOngoing();
    };
  }, []);

  return null;
}
