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
import { type LiveShift } from '../services/shifts';
import { getPendingShiftEnds } from '../offline/outbox';
import { subscribeOutboxChanges } from '../offline/events';
import { pickScheduledEndMs, type ScheduledShiftRow } from '../utils/daySummary';
import { cancelShiftEndReminders, syncShiftEndReminders } from '../notifications/shiftEndReminder';

export default function ShiftEndReminderSync() {
  const lastSigRef = useRef<string>('');
  const lastShiftIdRef = useRef<string | null>(null);

  useEffect(() => {
    let unsubOpen: (() => void) | null = null;
    let unsubScheduled: (() => void) | null = null;
    let liveShift: LiveShift | null = null;
    let scheduled: ScheduledShiftRow[] = [];
    let pendingIds = new Set<string>();

    const chooseOpenShift = (shifts: LiveShift[]) =>
      shifts
        .filter(shift => !shift.isScheduled && !pendingIds.has(shift.id))
        .sort((a, b) => {
          const toMs = (v: unknown) =>
            v && typeof v === 'object' && typeof (v as { toDate?: () => Date }).toDate === 'function'
              ? (v as { toDate: () => Date }).toDate().getTime()
              : 0;
          return toMs(b.startAt) - toMs(a.startAt);
        })[0] || null;

    const publish = async () => {
      if (!liveShift) {
        if (lastShiftIdRef.current) {
          await cancelShiftEndReminders(lastShiftIdRef.current);
          lastShiftIdRef.current = null;
        }
        lastSigRef.current = '';
        return;
      }
      if (lastShiftIdRef.current && lastShiftIdRef.current !== liveShift.id) {
        await cancelShiftEndReminders(lastShiftIdRef.current);
      }
      const endMs = pickScheduledEndMs(liveShift, scheduled, Date.now());
      const nextSig = `${liveShift.id}:${endMs ?? 'none'}`;
      if (nextSig === lastSigRef.current) {
        lastShiftIdRef.current = liveShift.id;
        return;
      }
      const sig = await syncShiftEndReminders({ shift: liveShift, scheduled });
      lastShiftIdRef.current = liveShift.id;
      lastSigRef.current = sig || nextSig;
    };

    const unsubAuth = nativeAuth().onAuthStateChanged(user => {
      unsubOpen?.();
      unsubScheduled?.();
      unsubOpen = null;
      unsubScheduled = null;
      liveShift = null;
      scheduled = [];
      if (!user) {
        void publish();
        return;
      }

      const openQuery = query(
        collection(getFirestore(), 'shifts'),
        where('userId', '==', user.uid),
        where('status', '==', 'open'),
        limit(5)
      );
      unsubOpen = onSnapshot(openQuery, snap => {
        const docs = [...(snap?.docs || [])].map(d => ({ id: d.id, ...d.data() } as LiveShift));
        liveShift = chooseOpenShift(docs);
        void publish();
      });

      const scheduledQuery = query(
        collection(getFirestore(), 'shifts'),
        where('userId', '==', user.uid),
        where('isScheduled', '==', true)
      );
      unsubScheduled = onSnapshot(scheduledQuery, snap => {
        scheduled = (snap?.docs || []).map(d => ({
          id: d.id,
          date: String(d.data()?.date || ''),
          startTime: String(d.data()?.startTime || ''),
          endTime: String(d.data()?.endTime || ''),
        }));
        void publish();
      });
    });

    const unsubOutbox = subscribeOutboxChanges(() => {
      void (async () => {
        pendingIds = new Set((await getPendingShiftEnds()).map(item => item.shiftId));
        if (liveShift && pendingIds.has(liveShift.id)) {
          liveShift = null;
        }
        await publish();
      })();
    });
    void getPendingShiftEnds().then(ends => {
      pendingIds = new Set(ends.map(item => item.shiftId));
      if (liveShift && pendingIds.has(liveShift.id)) {
        liveShift = null;
        void publish();
      }
    });

    return () => {
      unsubAuth();
      unsubOpen?.();
      unsubScheduled?.();
      unsubOutbox();
      if (lastShiftIdRef.current) {
        void cancelShiftEndReminders(lastShiftIdRef.current);
      }
    };
  }, []);

  return null;
}
