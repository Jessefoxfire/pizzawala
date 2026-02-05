
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity, ActivityIndicator, Alert, Platform } from 'react-native';
import { getAuth } from 'firebase/auth';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import CompassHeading from 'react-native-compass-heading';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Geolocation from 'react-native-geolocation-service';

import { Icons } from '../components/Icons';
import { db } from '../services/firebase';
import { getDistance, getBearing } from '../utils/geo';
import { RootStackParamList } from '../navigation/AppNavigator';

type WorksiteFinderScreenProps = NativeStackScreenProps<RootStackParamList, 'WorksiteFinder'>;

export default function WorksiteFinderScreen({ route, navigation }: WorksiteFinderScreenProps) {
    const { geofence } = route.params;
    const [currentLocation, setCurrentLocation] = useState<{latitude: number; longitude: number} | null>(null);
    const [deviceHeading, setDeviceHeading] = useState(0);
    const [isCheckingIn, setIsCheckingIn] = useState(false);
    
    const auth = getAuth();
    const user = auth.currentUser;

    useEffect(() => {
        CompassHeading.start(1, ({ heading }) => {
            setDeviceHeading(heading);
        });

        const watchId = Geolocation.watchPosition(
            (position) => setCurrentLocation(position.coords),
            (error) => Alert.alert('Location Error', 'Could not track location.'),
            { enableHighAccuracy: true, distanceFilter: 1, interval: 1000 }
        );

        return () => {
            CompassHeading.stop();
            Geolocation.clearWatch(watchId);
        };
    }, []);

    const distance = currentLocation ? getDistance(currentLocation.latitude, currentLocation.longitude, geofence.center.lat, geofence.center.lng) : null;
    const bearing = currentLocation ? getBearing(currentLocation.latitude, currentLocation.longitude, geofence.center.lat, geofence.center.lng) : 0;
    
    const arrowRotation = bearing - deviceHeading;
    const canCheckIn = distance !== null && distance <= geofence.radiusMeters;

    const handleCheckIn = async () => {
        if (!user || !currentLocation) return;
        setIsCheckingIn(true);
    
        try {
          const { latitude, longitude, accuracy } = currentLocation as any;
          const logTimestamp = new Date();
    
          const logRef = await addDoc(collection(db, 'attendanceLogs'), {
            userId: user.uid,
            geofenceId: geofence.id,
            eventType: 'manual_checkin',
            timestamp: logTimestamp,
            location: { lat: latitude, lng: longitude, accuracy },
            permissionState: 'granted',
            deviceInfo: 'React Native App',
            responded: false,
          });
          
          await addDoc(collection(db, 'shifts'), {
              userId: user.uid,
              geofenceId: geofence.id,
              startTimestamp: logTimestamp,
              status: 'open',
              derivedFromLogs: [logRef.id],
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
          });
    
          Alert.alert('Checked In!', `Welcome to ${geofence.name}!`);
          navigation.navigate('Home');
        } catch (error: any) {
          Alert.alert('Error', 'Check-in failed.');
        } finally {
          setIsCheckingIn(false);
        }
      };

    if (!currentLocation) {
        return (
            <SafeAreaView style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#FEF6E4" />
                <Text style={styles.loadingText}>Finding Worksite...</Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()}>
                    <Text style={styles.backButton}>‹ Back</Text>
                </TouchableOpacity>
            </View>
            <View style={styles.content}>
                <Text style={styles.title}>Navigate to Worksite</Text>
                <Text style={styles.geofenceName}>{geofence.name}</Text>
                
                <View style={styles.compassContainer}>
                    <View style={styles.arrowContainer}>
                         <Icons.navigationArrow 
                            width="100%" 
                            height="100%" 
                            color="#FEF6E4"
                            style={{ transform: [{ rotate: `${arrowRotation}deg` }] }}
                        />
                    </View>
                </View>

                <Text style={styles.distanceText}>
                    {distance?.toFixed(0)}
                    <Text style={styles.distanceUnit}> meters</Text>
                </Text>
            </View>
            <View style={styles.footer}>
                <TouchableOpacity 
                    style={[styles.checkInButton, !canCheckIn && styles.checkInButtonDisabled]}
                    onPress={handleCheckIn}
                    disabled={!canCheckIn || isCheckingIn}
                >
                    {isCheckingIn ? (
                        <ActivityIndicator color="#3D352E" />
                    ) : (
                        <Text style={[styles.checkInButtonText, !canCheckIn && styles.checkInButtonTextDisabled]}>
                            {canCheckIn ? 'Clock In' : 'Too Far to Clock In'}
                        </Text>
                    )}
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#e77f39' },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#e77f39' },
    loadingText: { marginTop: 20, fontSize: 18, color: '#FEF6E4' },
    header: { padding: 16 },
    backButton: { fontSize: 18, color: '#FEF6E4', fontWeight: 'bold' },
    content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
    title: { fontSize: 18, fontWeight: '600', color: '#FDECC8' },
    geofenceName: { fontSize: 32, fontWeight: 'bold', color: '#FEF6E4', marginTop: 8, marginBottom: 40, textAlign: 'center' },
    compassContainer: { width: 250, height: 250, justifyContent: 'center', alignItems: 'center', borderRadius: 125, borderWidth: 4, borderColor: 'rgba(254, 246, 228, 0.2)', marginBottom: 40 },
    arrowContainer: { width: 150, height: 150 },
    distanceText: { fontSize: 48, fontWeight: 'bold', color: '#FFFFFF' },
    distanceUnit: { fontSize: 24, fontWeight: '500', color: '#FDECC8' },
    footer: { padding: 20 },
    checkInButton: { backgroundColor: '#FDECC8', paddingVertical: 20, borderRadius: 16, alignItems: 'center' },
    checkInButtonDisabled: { backgroundColor: 'rgba(253, 236, 200, 0.5)' },
    checkInButtonText: { fontSize: 20, fontWeight: 'bold', color: '#3D352E' },
    checkInButtonTextDisabled: { color: 'rgba(61, 53, 46, 0.5)' },
});
