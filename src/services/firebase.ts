
import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  initializeAuth, 
  getReactNativePersistence, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  type Auth,
  type UserCredential
} from "firebase/auth";
import { getFirestore, doc, setDoc, serverTimestamp } from "firebase/firestore";
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  "projectId": "pizza-wala-team-x1x24",
  "appId": "1:462340348678:android:d39962a12a52763c",
  "storageBucket": "pizza-wala-team-x1x24.appspot.com",
  "apiKey": "AIzaSyDHnpnODxu039eoDVSA0M4C_DsEkimLXMY",
  "authDomain": "pizza-wala-team-x1x24.firebaseapp.com",
  "messagingSenderId": "462340348678"
};

let app;
if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApp();
}

const auth: Auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage)
});

const db = getFirestore(app);

const loginWithEmail = (email: string, password: string) => {
  return signInWithEmailAndPassword(auth, email, password);
}

const createAccountWithEmail = async (name: string, email: string, password: string, avatarUrl: string): Promise<UserCredential> => {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    const userDocRef = doc(db, "users", user.uid);
    await setDoc(userDocRef, {
        uid: user.uid,
        name,
        email,
        avatarUrl,
        roles: ['member'],
        teamId: 'team-1',
        createdAt: serverTimestamp(),
    });

    return userCredential;
}

const signOutUser = () => {
    return signOut(auth);
}

export { auth, db, loginWithEmail, createAccountWithEmail, signOutUser };
