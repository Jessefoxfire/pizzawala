import { useEffect, useState } from 'react';
import { doc, updateDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import nativeAuth from '@react-native-firebase/auth';

export default function PresenceMonitor() {
  const [isOnShift, setIsOnShift] = useState(false);


  useEffect(() => {
    const user = nativeAuth().currentUser;
    if (!user) return;

    const unsubProfile = onSnapshot(doc(db, 'users', user.uid), snap => {
      if (!snap || !snap.exists()) return;
      const data = snap.data();
      const hasShift = !!data?.currentShift;
      if (hasShift !== isOnShift) {
        setIsOnShift(hasShift);
      }
    });

    return () => unsubProfile();
  }, [isOnShift]);

  useEffect(() => {
    const unsubAuth = nativeAuth().onAuthStateChanged((user) => {
      if (!user) return;

      const updatePresence = async () => {
        try {
          await updateDoc(doc(db, 'users', user.uid), {
            lastSeenAt: serverTimestamp(),
            online: true,
          });
        } catch (e) {
          // ignore
        }
      };

      updatePresence();

      // Use 3 minutes if on shift, 1 minute otherwise
      const intervalMs = isOnShift ? 180000 : 60000;
      console.log(`[PresenceMonitor] Heartbeat interval: ${intervalMs / 1000}s`);

      const interval = setInterval(updatePresence, intervalMs);

      return () => clearInterval(interval);
    });

    return () => unsubAuth();
  }, [isOnShift]);

  return null;
}
