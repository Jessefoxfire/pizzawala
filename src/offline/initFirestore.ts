import firestore from '@react-native-firebase/firestore';

let initialized = false;

export function initFirestoreOffline(): void {
  if (initialized) return;
  initialized = true;

  try {
    firestore().settings({
      persistence: true,
      cacheSizeBytes: firestore.CACHE_SIZE_UNLIMITED,
    });
  } catch (error) {
    console.warn('[Offline] Firestore persistence settings failed:', error);
  }
}
