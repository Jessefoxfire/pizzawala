import { useEffect, useRef, useState } from 'react';
// Native Auth import
import nativeAuth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
// Web Firestore for now, but native user
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../services/firebase';

type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'user' }
  | { status: 'admin' };

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const bootstrapCheckedRef = useRef(false);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    // Use Native Auth listener
    const unsubAuth = nativeAuth().onAuthStateChanged(user => {
      if (!user) {
        if (unsubProfile) {
          unsubProfile();
          unsubProfile = null;
        }
        setState({ status: 'signedOut' });
        return;
      }

      // Move off the login screen immediately while profile loads.
      setState({ status: 'user' });

      if (unsubProfile) {
        unsubProfile();
      }

      const profileRef = doc(db, 'users', user.uid);
      unsubProfile = onSnapshot(
        profileRef,
        async snap => {
          const email = user.email?.trim().toLowerCase() || '';
          const bootstrapEmails = ['indispirit@gmail.com', 'goddessjyotis@gmail.com', 'maromabeauty@gmail.com'];

          if (!snap.exists() && email && bootstrapEmails.includes(email)) {
            try {
              await setDoc(
                profileRef,
                {
                  uid: user.uid,
                  email: user.email,
                  emailLower: email,
                  roles: ['admin'],
                  teamId: 'team-1',
                  displayName: 'Admin User',
                  createdAt: serverTimestamp(),
                },
                { merge: true }
              );
            } catch (err) {
              console.error('Failed to bootstrap admin:', err);
            }
          }

          if (snap.exists() && snap.data()?.disabled) {
            try {
              await nativeAuth().signOut();
            } catch {
              // ignore sign-out failure
            }
            setState({ status: 'signedOut' });
            return;
          }
          const roles = snap.data()?.roles;
          const isAdmin = (email && bootstrapEmails.includes(email)) || (Array.isArray(roles) && roles.includes('admin'));

          if (!isAdmin) {
            if (!bootstrapCheckedRef.current && email && bootstrapEmails.includes(email)) {
              bootstrapCheckedRef.current = true;
              try {
                const adminsSnap = await getDocs(
                  query(
                    collection(db, 'users'),
                    where('roles', 'array-contains', 'admin'),
                    limit(1)
                  )
                );

                if (adminsSnap.empty) {
                  const nextRoles = Array.isArray(roles)
                    ? Array.from(new Set([...roles, 'admin']))
                    : ['admin'];
                  await updateDoc(profileRef, { roles: nextRoles });
                }
              } catch {
                // Fallback to non-admin if bootstrap fails.
              }
            }
          }

          setState({ status: isAdmin ? 'admin' : 'user' });
        },
        () => setState({ status: 'user' })
      );
    });

    return () => {
      if (unsubProfile) {
        unsubProfile();
      }
      unsubAuth();
    };
  }, []);

  return state;
}
