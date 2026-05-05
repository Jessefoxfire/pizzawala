import { useEffect, useRef, useState } from 'react';
import Geolocation from 'react-native-geolocation-service';
import { doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import nativeAuth from '@react-native-firebase/auth';
import { ensureLocationPermission } from '../utils/geo';

type Coordinates = { lat: number; lng: number };

export default function LocationMonitor() {
  const watchIdRef = useRef<number | null>(null);
  const [isOnShift, setIsOnShift] = useState(false);

  useEffect(() => {
    const user = nativeAuth().currentUser;
    if (!user) return;

    // Listen to shift status to adjust power usage
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
    const stopWatch = () => {
      if (watchIdRef.current !== null) {
        Geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };

    const unsub = nativeAuth().onAuthStateChanged(async user => {
      stopWatch();
      if (!user?.uid) return;

      const allowed = await ensureLocationPermission();
      if (!allowed) return;

      // POWER SAVING LOGIC:
      // If on shift, we assume the user is stationary. 
      // We use cell/wifi (enableHighAccuracy: false) and larger distance filters.
      const options = isOnShift ? {
        enableHighAccuracy: false, // Use cell/wifi towers (cheaper)
        distanceFilter: 100,       // Only update if moved 100m
        interval: 30000,          // 30 second interval
        fastestInterval: 15000,
      } : {
        enableHighAccuracy: true,
        distanceFilter: 10,
        interval: 5000,
        fastestInterval: 2000,
      };

      console.log(`[LocationMonitor] Starting watch. Power Mode: ${isOnShift ? 'LOW' : 'HIGH'}`);

      watchIdRef.current = Geolocation.watchPosition(
        pos => {
          const nextPosition: Coordinates = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          };

          updateDoc(doc(db, 'users', user.uid), {
            lastLocation: nextPosition,
            lastLocationUpdate: new Date(),
          }).catch(() => undefined);
        },
        error => {
          console.warn('Location watch error:', error);
        },
        options
      );
    });

    return () => unsub();
  }, [isOnShift]);


  return null;
}
