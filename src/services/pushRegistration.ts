import messaging from '@react-native-firebase/messaging';
import { doc, getFirestore, serverTimestamp, setDoc } from '@react-native-firebase/firestore';
import nativeAuth from '@react-native-firebase/auth';

/** Registers FCM token on `users/{uid}` so Cloud Functions can push while JS is suspended. */
export async function registerPushForCurrentUser(): Promise<() => void> {
  const user = nativeAuth().currentUser;
  if (!user) {
    return () => {};
  }

  await messaging().requestPermission();
  const token = await messaging().getToken();

  const fs = getFirestore();
  await setDoc(
    doc(fs, 'users', user.uid),
    {
      fcmToken: token,
      fcmTokenUpdatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  const unsubscribe = messaging().onTokenRefresh(async newToken => {
    await setDoc(
      doc(fs, 'users', user.uid),
      {
        fcmToken: newToken,
        fcmTokenUpdatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });

  return unsubscribe;
}
