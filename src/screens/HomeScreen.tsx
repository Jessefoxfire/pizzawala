
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  SafeAreaView,
  Platform,
} from 'react-native';
import { signOutUser, db } from '../services/firebase';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  limit,
  getDoc,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { Icons } from '../components/Icons';
import Geolocation from 'react-native-geolocation-service';

type HomeScreenProps = NativeStackScreenProps<RootStackParamList, 'Home'>;

const ADMIN_EMAILS = ['indispirit@gmail.com', 'dylanmarkusimhoff@gmail.com', 'michaudlea91@gmail.com'];

export default function HomeScreen({ navigation }: HomeScreenProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [geofences, setGeofences] = useState<any[]>([]);
  const [activeShift, setActiveShift] = useState<any>(null);
  const [activeGeofence, setActiveGeofence] = useState<any>(null);
  const [isCheckingOut, setIsCheckingOut] = useState<boolean>(false);
  
  const auth = getAuth();
  const user = auth.currentUser;

  const [isAdmin, setIsAdmin] = useState(() => {
    return !!(user?.email && ADMIN_EMAILS.includes(user.email.toLowerCase().trim()));
  });

  useEffect(() => {
    if (!user) {
        setIsLoading(false);
        return;
    }

    const userDocRef = doc(db, 'users', user.uid);
    const unsubscribeUser = onSnapshot(userDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const userData = docSnap.data();
            const emailMatch = user.email && ADMIN_EMAILS.includes(user.email.toLowerCase().trim());
            if ((userData.roles && userData.roles.includes('admin')) || emailMatch) {
                setIsAdmin(true);
            }
        }
    });

    const geofenceQuery = query(collection(db, 'geofences'), where('active', '==', true));
    const unsubscribeGeofences = onSnapshot(geofenceQuery, (snapshot) => {
      const activeGeofences = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setGeofences(activeGeofences);
    });

    const shiftQuery = query(
      collection(db, 'shifts'),
      where('userId', '==', user.uid),
      where('status', '==', 'open'),
      limit(1)
    );
    const unsubscribeShifts = onSnapshot(shiftQuery, (snapshot) => {
      if (!snapshot.empty) {
        const shiftDoc = snapshot.docs[0];
        setActiveShift({ id: shiftDoc.id, ...shiftDoc.data() });
      } else {
        setActiveShift(null);
        setActiveGeofence(null);
      }
      setIsLoading(false);
    }, (error) => {
        setIsLoading(false);
    });

    return () => {
      unsubscribeUser();
      unsubscribeGeofences();
      unsubscribeShifts();
    };
  }, [user]);

  useEffect(() => {
      if (activeShift && activeShift.geofenceId) {
          const geofenceDocRef = doc(db, 'geofences', activeShift.geofenceId);
          getDoc(geofenceDocRef).then(docSnap => {
              if (docSnap.exists()) {
                  setActiveGeofence(docSnap.data());
              }
          });
      }
  }, [activeShift]);


  const handleLogout = () => {
    signOutUser().catch((error) => {
      Alert.alert('Logout Failed', error.message);
    });
  };

  const handleCheckOut = async () => {
    if (!user || !activeShift) return;
    setIsCheckingOut(true);
    
    Geolocation.getCurrentPosition(
        async (position) => {
            const { latitude, longitude, accuracy } = position.coords;
            const logTimestamp = new Date();

            try {
                const logRef = await addDoc(collection(db, 'attendanceLogs'), {
                    userId: user.uid,
                    geofenceId: activeShift.geofenceId,
                    eventType: 'manual_checkout',
                    timestamp: logTimestamp,
                    location: { lat: latitude, lng: longitude, accuracy },
                    permissionState: 'granted',
                    deviceInfo: 'React Native App',
                    responded: false,
                });

                const shiftDocRef = doc(db, 'shifts', activeShift.id);
                await updateDoc(shiftDocRef, {
                    status: 'completed',
                    endTimestamp: logTimestamp,
                    derivedFromLogs: [...activeShift.derivedFromLogs, logRef.id],
                    updatedAt: serverTimestamp(),
                });

                Alert.alert('Checked Out!', `Your shift has ended.`);
            } catch (e) {
                Alert.alert('Error', 'Failed to end shift.');
            } finally {
                setIsCheckingOut(false);
            }
        },
        (error) => {
            Alert.alert('Location Error', 'Could not get location for checkout.');
            setIsCheckingOut(false);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  };
  
  if (isLoading) {
      return (
          <SafeAreaView style={styles.container}>
              <View style={styles.centered}>
                <ActivityIndicator size="large" color="#FEF6E4" />
                <Text style={styles.loadingText}>Loading Dashboard...</Text>
              </View>
          </SafeAreaView>
      );
  }

  const commonFooter = (
    <View style={styles.footerNav}>
        <TouchableOpacity style={styles.navItem} onPress={() => navigation.navigate('Chat')}>
            <Icons.book width={24} height={24} color="#3D352E" />
            <Text style={styles.navText}>Team Chat</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={handleLogout}>
            <Icons.eyeOff width={24} height={24} color="#d9534f" />
            <Text style={[styles.navText, { color: '#d9534f' }]}>Logout</Text>
        </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <Text style={styles.title}>{isAdmin ? 'Admin Panel' : (activeShift ? 'Clocked In' : 'Ready to Work?')}</Text>
          <Text style={styles.subtitle}>Welcome back, {user?.email?.split('@')[0]}</Text>

          {isAdmin ? (
            <TouchableOpacity 
                style={styles.button} 
                onPress={() => navigation.navigate('Geofences')}
            >
              <Text style={styles.buttonText}>Manage Worksites</Text>
            </TouchableOpacity>
          ) : (
            <>
              {activeShift ? (
                <View style={styles.shiftInfo}>
                    <Text style={styles.geofenceName}>{activeGeofence ? activeGeofence.name : '...'}</Text>
                    <TouchableOpacity 
                        style={[styles.button, styles.checkOutButton]} 
                        onPress={handleCheckOut}
                        disabled={isCheckingOut}
                    >
                        {isCheckingOut ? <ActivityIndicator color="#FFFFFF" /> : <Text style={[styles.buttonText, { color: '#fff' }]}>Clock Out</Text>}
                    </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.worksiteList}>
                    <Text style={styles.smallSubtitle}>Select a worksite to find it:</Text>
                    {geofences.map(geo => (
                        <TouchableOpacity 
                            key={geo.id} 
                            style={styles.button} 
                            onPress={() => navigation.navigate('WorksiteFinder', { geofence: geo })}
                        >
                            <Text style={styles.buttonText}>{geo.name}</Text>
                        </TouchableOpacity>
                    ))}
                    {geofences.length === 0 && <Text style={styles.infoText}>No active worksites found.</Text>}
                </View>
              )}
            </>
          )}
          {commonFooter}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#e77f39' },
  scrollContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20, paddingTop: Platform.OS === 'android' ? 40 : 0 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { width: '100%', maxWidth: 400, backgroundColor: '#FEF6E4', borderRadius: 24, padding: 24, alignItems: 'center', elevation: 5 },
  loadingText: { marginTop: 10, fontSize: 16, color: '#FEF6E4', fontFamily: 'sans-serif' },
  title: { fontSize: 28, fontWeight: 'bold', color: '#3D352E', marginBottom: 4, textAlign: 'center', fontFamily: 'sans-serif' },
  subtitle: { fontSize: 16, color: '#57493E', marginBottom: 24, textAlign: 'center', fontFamily: 'sans-serif' },
  smallSubtitle: { fontSize: 14, fontWeight: '600', color: '#3D352E', marginBottom: 12, alignSelf: 'flex-start', fontFamily: 'sans-serif' },
  geofenceName: { fontSize: 22, fontWeight: '600', color: '#3D352E', marginBottom: 24, textAlign: 'center', fontFamily: 'sans-serif' },
  infoText: { fontSize: 14, color: '#57493E', marginVertical: 12, textAlign: 'center', fontFamily: 'sans-serif' },
  button: { backgroundColor: '#FDECC8', paddingVertical: 16, paddingHorizontal: 24, borderRadius: 12, width: '100%', marginBottom: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#EADBC7' },
  checkOutButton: { backgroundColor: '#d9534f', borderColor: '#d43f3a' },
  buttonText: { color: '#3D352E', fontSize: 16, fontWeight: '600', textAlign: 'center', fontFamily: 'sans-serif' },
  shiftInfo: { width: '100%', alignItems: 'center' },
  worksiteList: { width: '100%' },
  footerNav: { flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginTop: 24, borderTopWidth: 1, borderTopColor: '#FDECC8', paddingTop: 24 },
  navItem: { alignItems: 'center' },
  navText: { fontSize: 12, marginTop: 4, fontWeight: '600', color: '#3D352E', fontFamily: 'sans-serif' }
});
