import { useEffect, useState } from 'react';
import { doc, getFirestore, onSnapshot, serverTimestamp, updateDoc } from '@react-native-firebase/firestore';
import nativeAuth from '@react-native-firebase/auth';

export default function PresenceMonitor() {
  const [isOnShift, setIsOnShift] = useState(false);
  const fs = getFirestore();


  useEffect(() => {
    const user = nativeAuth().currentUser;
    if (!user) return;

    const unsubProfile = onSnapshot(doc(fs, 'users', user.uid), snap => {
      if (!snap || !snap.exists()) return;
      const data = snap.data();
      const hasShift = !!data?.currentShift;
      if (hasShift !== isOnShift) {
        setIsOnShift(hasShift);
      }
    });

    return () => unsubProfile();
  }, [fs, isOnShift]);

  useEffect(() => {
    const unsubAuth = nativeAuth().onAuthStateChanged((user) => {
      if (!user) return;

      const updatePresence = async () => {
        try {
          await updateDoc(doc(fs, 'users', user.uid), {
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
  }, [fs, isOnShift]);

  return null;
}
