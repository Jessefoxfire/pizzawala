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
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { collection, getFirestore, onSnapshot } from '@react-native-firebase/firestore';
import { resolveAvatarSource } from '../utils/avatar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { openUserProfile } from '../navigation/openUserProfile';
import PizzaFireScreen from '../components/PizzaFireScreen';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';

type Props = NativeStackScreenProps<RootStackParamList, 'TeamMap'>;

type UserRecord = {
  id: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  customAvatarUrl?: string;
  lastLocation?: { lat: number; lng: number } | null;
  lastLocationUpdate?: any;
};
type UserWithLocation = UserRecord & { lastLocation: { lat: number; lng: number } };

function hasUsableLocation(user: UserRecord): user is UserWithLocation {
  const location = user.lastLocation;
  return Boolean(
    location &&
      Number.isFinite(location.lat) &&
      Number.isFinite(location.lng) &&
      Math.abs(location.lat) <= 90 &&
      Math.abs(location.lng) <= 180
  );
}

export default function TeamMapScreen({ navigation, route }: Props) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<MapView>(null);
  const fs = getFirestore();
  
  const focusUserId = route.params?.focusUserId;

  useEffect(() => {
    const unsub = onSnapshot(collection(fs, 'users'), snap => {
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
  }, [fs]);

  const activeUsers = useMemo<UserWithLocation[]>(() => {
    return users.filter(hasUsableLocation).filter(u => {
      if (!u.lastLocationUpdate) return false;
      const lastUpdate = u.lastLocationUpdate?.toDate?.() || new Date(u.lastLocationUpdate);
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      return Number.isFinite(lastUpdate.getTime()) && lastUpdate > tenMinutesAgo;
    });
  }, [users]);

  const initialRegion = useMemo<Region>(() => {
    const first = activeUsers[0]?.lastLocation;
    return {
      latitude: first?.lat ?? 52.5200,
      longitude: first?.lng ?? 13.4050,
      latitudeDelta: 0.08,
      longitudeDelta: 0.08,
    };
  }, [activeUsers]);

  useEffect(() => {
    if (loading || !mapReady || !mapRef.current) return;
    const target = focusUserId ? activeUsers.find(u => u.id === focusUserId) : null;
    if (target) {
        mapRef.current.animateToRegion({
          latitude: target.lastLocation.lat,
          longitude: target.lastLocation.lng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }, 1000);
      return;
    }
    if (activeUsers.length === 0) return;
    mapRef.current.fitToCoordinates(
      activeUsers.map(member => ({ latitude: member.lastLocation.lat, longitude: member.lastLocation.lng })),
      { edgePadding: { top: 80, right: 50, bottom: 80, left: 50 }, animated: false }
    );
  }, [loading, mapReady, focusUserId, activeUsers]);

  return (
    <PizzaFireScreen edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Team Live Map</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.container}>
        {loading ? (
          <ActivityIndicator size="large" color={PIZZA_FIRE.accent} style={styles.loader} />
        ) : (
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={styles.map}
            initialRegion={initialRegion}
            onMapReady={() => setMapReady(true)}
            customMapStyle={darkMapStyle}
          >
            {activeUsers.map(user => (
              <Marker
                key={user.id}
                coordinate={{
                  latitude: user.lastLocation.lat,
                  longitude: user.lastLocation.lng,
                }}
                title={user.name || user.email || 'Team Member'}
                onPress={() =>
                  openUserProfile(navigation, { userId: user.id, userName: user.name || user.email })
                }
              >
                <View style={styles.markerContainer}>
                  <Image
                    source={resolveAvatarSource(user.avatarUrl, user.customAvatarUrl)}
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
    </PizzaFireScreen>
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
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, backgroundColor: 'transparent', alignItems: 'center' },
  back: { color: PIZZA_FIRE.textSecondary, fontSize: 16, fontWeight: 'bold' },
  title: { color: PIZZA_FIRE.textPrimary, fontSize: 18, fontWeight: '800' },
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
    borderColor: PIZZA_FIRE.accent,
    backgroundColor: PIZZA_FIRE.surfaceInset,
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
    borderTopColor: PIZZA_FIRE.accent,
    marginTop: -2,
  },
  emptyOverlay: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: PIZZA_FIRE.bgMid,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    alignItems: 'center',
  },
  emptyText: { color: PIZZA_FIRE.textMuted, fontSize: 14, fontWeight: '600' },
});
