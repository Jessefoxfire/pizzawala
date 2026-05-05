import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore as getWebFirestore } from "firebase/firestore";

// Native Firebase imports
import { getApp as getNativeApp } from '@react-native-firebase/app';
import nativeAuth from '@react-native-firebase/auth';
import {
  getFirestore as getRNFirestore,
  collection,
  doc,
  setDoc,
  serverTimestamp as nativeServerTimestamp,
} from '@react-native-firebase/firestore';
import { getStorage } from '@react-native-firebase/storage';

const firebaseConfig = {
  "projectId": "pizza-wala-team",
  "appId": "1:959171239075:android:3ead00c09c27aa030b3316",
  "storageBucket": "pizza-wala-team.firebasestorage.app",
  "apiKey": "AIzaSyCEZBpujIMl3ZSHx43duOunC-l457UWb9c",
  "authDomain": "pizza-wala-team.firebaseapp.com",
  "messagingSenderId": "959171239075"
};

let app;
if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApp();
}

// Keep db for Firestore Web SDK for now, but auth moves to native
const db = getWebFirestore(app);

const loginWithEmail = (email: string, password: string) => {
  return nativeAuth().signInWithEmailAndPassword(email, password);
}

const createAccountWithEmail = async (name: string, email: string, password: string, avatarUrl: string | null, customAvatarUrl: string | null = null) => {
    const userCredential = await nativeAuth().createUserWithEmailAndPassword(email, password);
    const user = userCredential.user;

    /** Native Firestore only — web `db` is not signed in, so old flow never created a doc visible to `getDoc`/listeners using native auth. */
    await setDoc(doc(getRNFirestore(), 'users', user.uid), {
      uid: user.uid,
      name,
      email,
      avatarUrl,
      customAvatarUrl,
      roles: ['member'],
      teamId: 'team-1',
      createdAt: nativeServerTimestamp(),
    });

    return userCredential;
}

const signOutUser = () => {
    return nativeAuth().signOut();
}

const resetPassword = (email: string) => {
    return nativeAuth().sendPasswordResetEmail(email);
}

/** Web-SDK-shaped compat: screens use `auth.currentUser` while RN Firebase is `nativeAuth()`. */
export const auth = {
  get currentUser() {
    return nativeAuth().currentUser;
  },
};

/** Team chat — native Firestore (modular) so reads/writes use the same session as native Auth. */
export const teamChatMessages = () =>
  collection(getRNFirestore(), 'chats', 'team-1', 'messages');

/** Keep upload bucket explicit to avoid accidental project/bucket drift. */
export const STORAGE_BUCKET_URL = 'gs://pizza-wala-team.firebasestorage.app';
export const LEGACY_STORAGE_BUCKET_URL = 'gs://pizza-wala-team.appspot.com';

/** Use modular `getStorage(app, gsUrl)` — `storage(gsUrl)` alone is invalid (first arg must be a FirebaseApp). */
export const uploadStorageRef = (storagePath: string) =>
  getStorage(getNativeApp(), STORAGE_BUCKET_URL).ref(storagePath);
export const uploadStorageRefFallback = (storagePath: string) =>
  getStorage(getNativeApp(), LEGACY_STORAGE_BUCKET_URL).ref(storagePath);

export { db, loginWithEmail, createAccountWithEmail, signOutUser, resetPassword, nativeAuth };
