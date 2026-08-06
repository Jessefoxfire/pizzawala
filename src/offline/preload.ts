import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  where,
} from '@react-native-firebase/firestore';
import { cacheGeofences } from '../geofencing/storage';

export async function preloadOfflineData(userId: string): Promise<void> {
  const fs = getFirestore();

  await Promise.allSettled([
    getDoc(doc(fs, 'users', userId)),
    getDoc(doc(fs, 'appConfig', 'userRequiredDocuments')),
    getDocs(query(collection(fs, 'geofences'), limit(100))).then(snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return cacheGeofences(items as any);
    }),
    getDocs(
      query(
        collection(fs, 'shifts'),
        where('userId', '==', userId),
        limit(50)
      )
    ),
    getDocs(query(collection(fs, 'hygieneTemperatureLogs'), limit(200))),
    getDocs(
      query(
        collection(fs, 'hygieneCredentials'),
        where('employeeUid', '==', userId),
        limit(20)
      )
    ),
  ]);
}
