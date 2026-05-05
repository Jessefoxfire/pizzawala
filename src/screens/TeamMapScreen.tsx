import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { Avatars, AvatarKey } from '../../assets/avatars';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'TeamMap'>;

type UserRecord = {
  id: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  lastLocation?: { lat: number; lng: number } | null;
  lastLocationUpdate?: any;
};

export default function TeamMapScreen({ navigation, route }: Props) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<MapView>(null);
  
  const focusUserId = route.params?.focusUserId;

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), snap => {
      if (!snap || !snap.docs) {
        setUsers([]);
        setLoading(false);
        return;
      }
      const items = snap.docs.map(docSnap => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<UserRecord, 'id'>),
      }));
      setUsers(items);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const activeUsers = useMemo(() => {
    return users.filter(u => {
      if (!u.lastLocation || !u.lastLocationUpdate) return false;
      const lastUpdate = u.lastLocationUpdate?.toDate?.() || new Date(u.lastLocationUpdate);
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      return lastUpdate > tenMinutesAgo;
    });
  }, [users]);

  useEffect(() => {
    if (!loading && focusUserId && mapRef.current) {
      const target = activeUsers.find(u => u.id === focusUserId);
      if (target?.lastLocation) {
        mapRef.current.animateToRegion({
          latitude: target.lastLocation.lat,
          longitude: target.lastLocation.lng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }, 1000);
      }
    }
  }, [loading, focusUserId, activeUsers]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Team Live Map</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.container}>
        {loading ? (
          <ActivityIndicator size="large" color="#C9782B" style={styles.loader} />
        ) : (
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={styles.map}
            initialRegion={{
              latitude: 51.0447, // Default to a central point if none
              longitude: -114.0719,
              latitudeDelta: 0.1,
              longitudeDelta: 0.1,
            }}
            customMapStyle={darkMapStyle}
          >
            {activeUsers.map(user => (
              <Marker
                key={user.id}
                coordinate={{
                  latitude: user.lastLocation!.lat,
                  longitude: user.lastLocation!.lng,
                }}
                title={user.name || user.email || 'Team Member'}
              >
                <View style={styles.markerContainer}>
                  <Image
                    source={Avatars[(user.avatarUrl as AvatarKey) || 'pizzaMaker']}
                    style={styles.markerAvatar}
                  />
                  <View style={styles.markerArrow} />
                </View>
              </Marker>
            ))}
          </MapView>
        )}
        
        {!loading && activeUsers.length === 0 && (
          <View style={styles.emptyOverlay}>
            <Text style={styles.emptyText}>No team members currently active.</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const darkMapStyle = [
  { "elementType": "geometry", "stylers": [{ "color": "#242f3e" }] },
  { "elementType": "labels.text.fill", "stylers": [{ "color": "#746855" }] },
  { "elementType": "labels.text.stroke", "stylers": [{ "color": "#242f3e" }] },
  { "featureType": "administrative.locality", "elementType": "labels.text.fill", "stylers": [{ "color": "#d59563" }] },
  { "featureType": "poi", "elementType": "labels.text.fill", "stylers": [{ "color": "#d59563" }] },
  { "featureType": "road", "elementType": "geometry", "stylers": [{ "color": "#38414e" }] },
  { "featureType": "road", "elementType": "geometry.stroke", "stylers": [{ "color": "#212a37" }] },
  { "featureType": "road", "elementType": "labels.text.fill", "stylers": [{ "color": "#9ca5b3" }] },
  { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#17263c" }] }
];

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#1E1813' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, backgroundColor: '#1E1813', alignItems: 'center' },
  back: { color: '#EBDCCB', fontSize: 16, fontWeight: 'bold' },
  title: { color: '#F6EDE2', fontSize: 18, fontWeight: '800' },
  container: { flex: 1 },
  map: { width: '100%', height: '100%' },
  loader: { marginTop: 100 },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 50,
    height: 50,
  },
  markerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#C9782B',
    backgroundColor: '#1E1813',
  },
  markerArrow: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#C9782B',
    marginTop: -2,
  },
  emptyOverlay: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(30, 24, 19, 0.9)',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3A2D24',
    alignItems: 'center',
  },
  emptyText: { color: '#A88E73', fontSize: 14, fontWeight: '600' },
});
