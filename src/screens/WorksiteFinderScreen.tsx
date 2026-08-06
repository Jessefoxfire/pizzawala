import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PermissionsAndroid,
  Platform,
  ActivityIndicator,
  Animated,
  TouchableOpacity,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Geolocation from 'react-native-geolocation-service';
import MapView, { Marker, Polyline, type Region } from 'react-native-maps';
import CompassHeading from 'react-native-compass-heading';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { auth, db } from '../services/firebase';
import { doc, onSnapshot, collection, query, where, updateDoc } from 'firebase/firestore';
import { resolveAvatarSource } from '../utils/avatar';

type Props = NativeStackScreenProps<RootStackParamList, 'WorksiteFinder'>;

type Coordinates = { lat: number; lng: number };

const toRadians = (value: number) => (value * Math.PI) / 180;
const toDegrees = (value: number) => (value * 180) / Math.PI;

const getBearing = (from: Coordinates, to: Coordinates) => {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLng = toRadians(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const bearing = toDegrees(Math.atan2(y, x));
  return (bearing + 360) % 360;
};

const getDistanceMeters = (from: Coordinates, to: Coordinates) => {
  const earthRadius = 6371000;
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
};

const formatDistance = (meters: number) => {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
};

const regionDeltaForMeters = (meters: number, latitude: number) => {
  const paddedMeters = Math.max(meters * 2.4, 120);
  const latitudeDelta = Math.max(0.0018, Math.min(0.02, paddedMeters / 111320));
  const longitudeDelta = Math.max(
    0.0018,
    Math.min(0.02, latitudeDelta / Math.max(Math.cos(toRadians(latitude)), 0.2))
  );

  return { latitudeDelta, longitudeDelta };
};

const moveCoordinate = (origin: Coordinates, headingDegrees: number, distanceMeters: number): Coordinates => {
  const earthRadius = 6371000;
  const angularDistance = distanceMeters / earthRadius;
  const bearing = toRadians(headingDegrees);
  const lat1 = toRadians(origin.lat);
  const lng1 = toRadians(origin.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
  );

  return {
    lat: toDegrees(lat2),
    lng: toDegrees(lng2),
  };
};

const COMPASS_LABELS = [
  { key: 'N', label: 'N', top: 10, left: '50%' as const, dx: -7, dy: 0 },
  { key: 'NE', label: 'NE', top: 28, right: 32, dx: 0, dy: 0 },
  { key: 'E', label: 'E', top: '50%' as const, right: 12, dx: 0, dy: -9 },
  { key: 'SE', label: 'SE', bottom: 28, right: 30, dx: 0, dy: 0 },
  { key: 'S', label: 'S', bottom: 10, left: '50%' as const, dx: -6, dy: 0 },
  { key: 'SW', label: 'SW', bottom: 28, left: 28, dx: 0, dy: 0 },
  { key: 'W', label: 'W', top: '50%' as const, left: 14, dx: 0, dy: -9 },
  { key: 'NW', label: 'NW', top: 28, left: 28, dx: 0, dy: 0 },
];

const WorksiteFinderScreen = ({ navigation, route }: Props) => {
  const { geofence } = route.params;
  const [gpsPosition, setGpsPosition] = useState<Coordinates | null>(null);
  const [displayPosition, setDisplayPosition] = useState<Coordinates | null>(null);
  const [gpsHeading, setGpsHeading] = useState<number | null>(null);
  const [compassHeading, setCompassHeading] = useState<number | null>(null);
  const [movementSpeed, setMovementSpeed] = useState<number>(0);
  const [mapType, setMapType] = useState<'standard' | 'satellite'>('satellite');
  const [followMap, setFollowMap] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [otherUsers, setOtherUsers] = useState<any[]>([]);
  const [showTeam, setShowTeam] = useState(false);
  const [selectedTeammate, setSelectedTeammate] = useState<any | null>(null);
  const mapRef = useRef<MapView | null>(null);
  const pulse = useRef(new Animated.Value(0)).current;
  const lastGpsFixRef = useRef<{ position: Coordinates; timestamp: number; speedMps: number; heading: number | null } | null>(null);
  const user = auth.currentUser;
  const insets = useSafeAreaInsets();
  // Listen to other users' locations
  useEffect(() => {
    if (!user?.uid) return;
    const usersQuery = query(
      collection(db, 'users'),
      where('__name__', '!=', user.uid)
    );
    const unsub = onSnapshot(usersQuery, snap => {
      if (!snap) {
        setOtherUsers([]);
        return;
      }
      const users = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter((u: any) => {
          // Only show users with recent location updates (within last 5 minutes)
          if (!u.lastLocation || !u.lastLocationUpdate) return false;
          const lastUpdate = u.lastLocationUpdate?.toDate?.() || new Date(u.lastLocationUpdate);
          const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
          return lastUpdate > fiveMinutesAgo;
        });
      setOtherUsers(users);
      setSelectedTeammate((previous: any) => {
        if (!previous?.id) return previous;
        return users.find((u: any) => u.id === previous.id) || null;
      });
    });
    return () => unsub();
  }, [user?.uid]);

  // Update current user's location in Firestore
  useEffect(() => {
    if (!user?.uid || !gpsPosition) return;
    
    const updateLocation = async () => {
      try {
        await updateDoc(doc(db, 'users', user.uid), {
          lastLocation: { lat: gpsPosition.lat, lng: gpsPosition.lng },
          lastLocationUpdate: new Date(),
        });
      } catch (err) {
        console.error('Failed to update user location:', err);
      }
    };

    updateLocation();
    const interval = setInterval(updateLocation, 10000); // Update every 10 seconds
    
    return () => clearInterval(interval);
  }, [user?.uid, gpsPosition]);

  useEffect(() => {
    let watchId: number | null = null;

    const ensureLocationPermission = async () => {
      if (Platform.OS === 'ios') {
        const auth = await Geolocation.requestAuthorization('whenInUse');
        console.log('iOS location auth status:', auth);
        return auth === 'granted';
      }
      if (Platform.OS !== 'android') return true;
      console.log('Requesting Android location permission');
      const fine = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      console.log('Android location permission result:', fine);
      return fine === PermissionsAndroid.RESULTS.GRANTED;
    };

    const startWatching = async () => {
      const allowed = await ensureLocationPermission();
      console.log('Location permission allowed:', allowed);
      if (!allowed) {
        console.error('Location permission denied - check Settings');
        setError('Location permission denied. Please enable in Settings.');
        return;
      }

      console.log('Getting current position...');
      Geolocation.getCurrentPosition(
        pos => {
          console.log('Got position:', pos.coords.latitude, pos.coords.longitude);
          const nextPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setGpsPosition(nextPosition);
          setDisplayPosition(nextPosition);
          const nextHeading = typeof pos.coords.heading === 'number' && pos.coords.heading >= 0
            ? pos.coords.heading
            : null;
          setGpsHeading(nextHeading);
          setMovementSpeed(typeof pos.coords.speed === 'number' && pos.coords.speed > 0 ? pos.coords.speed : 0);
          lastGpsFixRef.current = {
            position: nextPosition,
            timestamp: Date.now(),
            speedMps: typeof pos.coords.speed === 'number' && pos.coords.speed > 0 ? pos.coords.speed : 0,
            heading: nextHeading,
          };
          setError(''); // Clear any previous errors
        },
        err => {
          console.warn('getCurrentPosition error:', err);
          const errorMsg = err.code === 1
            ? 'Permission denied - check Settings'
            : err.code === 2
            ? 'Location unavailable. If using the iOS Simulator, set Features > Location.'
            : err.code === 3
            ? 'Location request timeout'
            : err.message || 'Unable to get location.';
          setError(errorMsg);
        },
        {
          enableHighAccuracy: true,
          timeout: 30000,
          maximumAge: 0,
        }
      );

      console.log('Setting up location watch...');
      watchId = Geolocation.watchPosition(
        pos => {
          console.log('Watch update:', pos.coords.latitude, pos.coords.longitude);
          const nextPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          const now = Date.now();
          const previousFix = lastGpsFixRef.current;
          let nextSpeed = typeof pos.coords.speed === 'number' && pos.coords.speed > 0 ? pos.coords.speed : 0;
          if (nextSpeed <= 0 && previousFix) {
            const elapsedSeconds = Math.max((now - previousFix.timestamp) / 1000, 0.001);
            nextSpeed = getDistanceMeters(previousFix.position, nextPosition) / elapsedSeconds;
          }

          const nextHeading = typeof pos.coords.heading === 'number' && pos.coords.heading >= 0
            ? pos.coords.heading
            : null;
          setGpsPosition(nextPosition);
          setDisplayPosition(nextPosition);
          setGpsHeading(nextHeading);
          setMovementSpeed(nextSpeed);
          lastGpsFixRef.current = {
            position: nextPosition,
            timestamp: now,
            speedMps: nextSpeed,
            heading: nextHeading,
          };
        },
        err => {
          console.warn('watchPosition error:', err);
          const errorMsg = err.code === 2
            ? 'Location unavailable. If using the iOS Simulator, set Features > Location.'
            : err.message || 'Unable to get location.';
          setError(errorMsg);
        },
        {
          enableHighAccuracy: true,
          distanceFilter: 2,
          interval: 5000,
          fastestInterval: 2000,
        }
      );
    };

    console.log('WorksiteFinderScreen: calling startWatching');
    startWatching();

    return () => {
      if (watchId !== null) {
        Geolocation.clearWatch(watchId);
      }
    };
  }, []);

  useEffect(() => {
    CompassHeading.start(3, ({ heading }) => {
      setCompassHeading(heading);
    });

    return () => {
      CompassHeading.stop();
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const lastFix = lastGpsFixRef.current;
      if (!lastFix) return;

      const ageMs = Date.now() - lastFix.timestamp;
      const effectiveHeading = compassHeading ?? lastFix.heading;

      if (!effectiveHeading || ageMs > 5000 || lastFix.speedMps < 0.8) {
        setDisplayPosition(lastFix.position);
        return;
      }

      // Brief dead reckoning between GPS fixes for a smoother feel.
      const estimatedDistance = Math.min(lastFix.speedMps * (ageMs / 1000), 12);
      setDisplayPosition(moveCoordinate(lastFix.position, effectiveHeading, estimatedDistance));
    }, 700);

    return () => clearInterval(interval);
  }, [compassHeading]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1400,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1400,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const bearing = useMemo(() => {
    if (!displayPosition) return null;
    const target = selectedTeammate?.lastLocation || geofence.center;
    return getBearing(displayPosition, target);
  }, [displayPosition, geofence.center, selectedTeammate]);

  const distance = useMemo(() => {
    if (!displayPosition) return null;
    const target = selectedTeammate?.lastLocation || geofence.center;
    return getDistanceMeters(displayPosition, target);
  }, [displayPosition, geofence.center, selectedTeammate]);

  const routeStart = useMemo(() => {
    if (!displayPosition) return null;
    const target = selectedTeammate?.lastLocation || geofence.center;
    const directBearing = getBearing(displayPosition, target);
    const routeOffsetMeters = Math.min(Math.max(distance ?? 0, 0), 16);
    return moveCoordinate(displayPosition, directBearing, routeOffsetMeters);
  }, [displayPosition, geofence.center, distance, selectedTeammate]);

  const selectedTeammateDistance = useMemo(() => {
    if (!displayPosition || !selectedTeammate?.lastLocation) return null;
    return getDistanceMeters(displayPosition, selectedTeammate.lastLocation);
  }, [displayPosition, selectedTeammate]);

  const teamWithDistance = useMemo(() => {
    if (!displayPosition) return [];
    return otherUsers
      .filter((u: any) => !!u.lastLocation)
      .map((u: any) => ({
        ...u,
        distanceMeters: getDistanceMeters(displayPosition, u.lastLocation),
      }))
      .sort((a: any, b: any) => a.distanceMeters - b.distanceMeters);
  }, [displayPosition, otherUsers]);

  const rotation = useMemo<string>(() => {
    if (bearing == null) return '0deg';
    const deviceHeading = compassHeading ?? gpsHeading ?? 0;
    const relativeHeading = (bearing - deviceHeading + 360) % 360;
    return `${relativeHeading.toFixed(0)}deg`;
  }, [bearing, compassHeading, gpsHeading]);

  const compassSize = 184;

  const mapRegion = useMemo<Region>(() => {
    if (!displayPosition) {
      const deltas = regionDeltaForMeters(geofence.radiusMeters, geofence.center.lat);
      return {
        latitude: geofence.center.lat,
        longitude: geofence.center.lng,
        latitudeDelta: deltas.latitudeDelta,
        longitudeDelta: deltas.longitudeDelta,
      };
    }

    const target = selectedTeammate?.lastLocation || geofence.center;
    const dist = getDistanceMeters(displayPosition, target);
    const baseRadius = selectedTeammate ? 120 : geofence.radiusMeters;
    const focusMeters = Math.max(dist, baseRadius * 1.6);
    const deltas = regionDeltaForMeters(focusMeters, displayPosition.lat);

    return {
      latitude: (displayPosition.lat + target.lat) / 2,
      longitude: (displayPosition.lng + target.lng) / 2,
      latitudeDelta: deltas.latitudeDelta,
      longitudeDelta: deltas.longitudeDelta,
    };
  }, [displayPosition, geofence.center, geofence.radiusMeters, selectedTeammate]);

  useEffect(() => {
    if (mapRef.current && followMap) {
      mapRef.current.animateToRegion(mapRegion, 700);
    }
  }, [followMap, mapRegion]);

  return (
    <SafeAreaView style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={mapRegion}
        mapType={mapType}
        followsUserLocation
        pointerEvents="auto"
        zoomEnabled
        scrollEnabled
        rotateEnabled
        pitchEnabled
        onTouchStart={() => setFollowMap(false)}
        onPanDrag={() => setFollowMap(false)}
        onRegionChangeComplete={() => undefined}
      >
        <Marker
          coordinate={{ latitude: geofence.center.lat, longitude: geofence.center.lng }}
          title={geofence.name}
          pinColor="#B35412"
        />
        {routeStart && (
          <Polyline
            coordinates={[
              { latitude: routeStart.lat, longitude: routeStart.lng },
              {
                latitude: (selectedTeammate?.lastLocation?.lat ?? geofence.center.lat),
                longitude: (selectedTeammate?.lastLocation?.lng ?? geofence.center.lng),
              },
            ]}
            strokeColor="rgba(0, 245, 160, 0.85)"
            strokeWidth={3}
            lineDashPattern={[8, 6]}
          />
        )}
        {/* Intentionally hide self marker: map should show only other team members + worksite. */}
        {showTeam && otherUsers.map(otherUser => {
          if (!otherUser.lastLocation) return null;
          const avatarSource = resolveAvatarSource(otherUser.avatarUrl);
          const displayName = otherUser.name || 'User';
          return (
            <Marker
              key={otherUser.id}
              coordinate={{
                latitude: otherUser.lastLocation.lat,
                longitude: otherUser.lastLocation.lng,
              }}
              anchor={{ x: 0.5, y: 0.5 }}
              title={displayName}
              onPress={() => setSelectedTeammate(otherUser)}
            >
              <View style={styles.otherUserMarker}>
                  <Image
                    source={resolveAvatarSource(otherUser.avatarUrl, otherUser.customAvatarUrl)}
                    style={styles.otherUserAvatar}
                    resizeMode="cover"
                  />
              </View>
            </Marker>
          );
        })}
      </MapView>

      <View style={styles.overlay} pointerEvents="box-none">
        <View style={[styles.mapControls, { top: 20 + insets.top, left: 16 }]}>
          <TouchableOpacity
            style={styles.mapControlButton}
            onPress={() => {
              setMapType(current => (current === 'satellite' ? 'standard' : 'satellite'));
            }}
          >
            <Text style={styles.mapControlButtonText}>
              {mapType === 'satellite' ? 'Standard' : 'Satellite'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.mapControlButton, showTeam && styles.mapControlButtonActive]}
            onPress={() => {
              setShowTeam(!showTeam);
              if (showTeam) setSelectedTeammate(null);
            }}
          >
            <Text style={styles.mapControlButtonText}>
              {showTeam ? 'Hide Team' : 'Show Team'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.mapControlButton, !followMap && styles.mapControlButtonActive]}
            onPress={() => {
              setFollowMap(true);
              mapRef.current?.animateToRegion(mapRegion, 500);
            }}
          >
            <Text style={styles.mapControlButtonText}>Recenter</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.card, { marginTop: 92 + insets.top }]} pointerEvents="none">
          {error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : !displayPosition ? (
            <ActivityIndicator color="#F3E6D3" />
          ) : (
            <View style={styles.compassWrap}>
              <View
                style={[
                  styles.compass,
                  {
                    width: compassSize,
                    height: compassSize,
                    borderRadius: compassSize / 2,
                  },
                ]}
              >
                <View style={styles.compassHalo} />
                <View style={styles.compassOuterRing} />
                <View style={styles.compassMiddleRing} />
                <View style={styles.compassInnerRing} />
                <View style={styles.compassGridVertical} />
                <View style={styles.compassGridHorizontal} />
                <View style={styles.compassGridDiagonalOne} />
                <View style={styles.compassGridDiagonalTwo} />
                {COMPASS_LABELS.map(item => (
                  <Text
                    key={item.key}
                    style={[
                      styles.compassLabel,
                      item.top !== undefined && { top: item.top },
                      item.bottom !== undefined && { bottom: item.bottom },
                      item.left !== undefined && { left: item.left },
                      item.right !== undefined && { right: item.right },
                      { transform: [{ translateX: item.dx }, { translateY: item.dy }] },
                    ]}
                  >
                    {item.label}
                  </Text>
                ))}
                <View style={[styles.pointerWrap, { transform: [{ rotate: rotation }] }]}>
                  <View style={styles.pointerNeedle}>
                    <View style={styles.pointerHead} />
                    <View style={styles.pointerCoreRing}>
                      <View style={styles.pointerCoreDot} />
                    </View>
                  </View>
                </View>
                <View style={styles.compassCenter} />
              </View>
            </View>
          )}
        </View>
        {showTeam && teamWithDistance.length > 0 && (
          <View style={[styles.teamPanel, { top: 140 + insets.top }]}>
            <Text style={styles.teamPanelTitle}>Team Nearby</Text>
            {teamWithDistance.slice(0, 4).map(member => {
              const displayName = member.name || member.email || 'Teammate';
              const isSelected = selectedTeammate?.id === member.id;
              return (
                <TouchableOpacity
                  key={member.id}
                  style={[styles.teamRow, isSelected && styles.teamRowActive]}
                  onPress={() => setSelectedTeammate(member)}
                >
                  <Image
                    source={resolveAvatarSource(member.avatarUrl, member.customAvatarUrl)}
                    style={styles.teamRowAvatar}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.teamRowName}>{displayName}</Text>
                    <Text style={styles.teamRowSub}>{formatDistance(member.distanceMeters)}</Text>
                  </View>
                  <Text style={styles.teamRowAction}>Navigate</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <View style={[styles.bottomReadout, { bottom: 24 + insets.bottom }]}>
          <View style={styles.readoutPanel}>
            <View style={styles.readoutRow}>
              <Text style={styles.readoutLabel}>NAVIGATING TO:</Text>
              <Text style={styles.readoutValueLine}>
                {selectedTeammate?.name || selectedTeammate?.email || geofence.name}
              </Text>
            </View>
            <View style={styles.readoutDivider} />
            <View style={styles.readoutRow}>
              <Text style={styles.readoutLabel}>DISTANCE TO DESTINATION:</Text>
              <View style={styles.readoutBox}>
                <Text style={styles.readoutValue}>
                  {distance ? formatDistance(distance) : '--'}
                </Text>
              </View>
            </View>
            {selectedTeammateDistance != null && (
              <>
                <View style={styles.readoutDivider} />
                <View style={styles.readoutRow}>
                  <Text style={styles.readoutLabel}>
                    DISTANCE TO {String(selectedTeammate?.name || selectedTeammate?.email || 'TEAM MEMBER').toUpperCase()}:
                  </Text>
                  <Text style={styles.readoutValueLine}>{formatDistance(selectedTeammateDistance)}</Text>
                </View>
              </>
            )}
            <View style={styles.readoutDivider} />
            <View style={styles.readoutRow}>
              <Text style={styles.readoutLabel}>HEADING / MOTION:</Text>
              <Text style={styles.readoutValueLine}>
                {`${Math.round(compassHeading ?? gpsHeading ?? 0)}° · ${movementSpeed.toFixed(1)} m/s`}
              </Text>
            </View>
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.closeButton, { top: 20 + insets.top }]}
        onPress={() => {
          console.log('Close button pressed - navigating back');
          navigation.goBack();
        }}
        activeOpacity={0.7}
      >
        <Text style={styles.closeButtonText}>×</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

export default WorksiteFinderScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#2A211B',
  },
  closeButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(31, 41, 55, 0.85)',
    borderWidth: 2,
    borderColor: '#D9A441',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 999,
    zIndex: 99999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
  },
  closeButtonText: {
    color: '#D9A441',
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 28,
  },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  mapControls: {
    position: 'absolute',
    zIndex: 20,
    gap: 10,
  },
  mapControlButton: {
    backgroundColor: 'rgba(31, 41, 55, 0.9)',
    borderWidth: 1,
    borderColor: '#C9782B',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  mapControlButtonActive: {
    backgroundColor: 'rgba(201, 120, 43, 0.9)',
  },
  mapControlButtonText: {
    color: '#F6EDE2',
    fontSize: 12,
    fontWeight: '700',
  },
  teamPanel: {
    position: 'absolute',
    right: 16,
    width: 200,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderWidth: 1,
    borderColor: '#C9782B',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    zIndex: 25,
  },
  teamPanelTitle: {
    color: '#F6EDE2',
    fontWeight: '700',
    marginBottom: 6,
    fontSize: 12,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 6,
    marginBottom: 6,
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
  },
  teamRowActive: {
    backgroundColor: 'rgba(201, 120, 43, 0.35)',
    borderWidth: 1,
    borderColor: '#C9782B',
  },
  teamRowAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 8,
  },
  teamRowName: {
    color: '#F6EDE2',
    fontSize: 12,
    fontWeight: '700',
  },
  teamRowSub: {
    color: '#C8B29A',
    fontSize: 11,
  },
  teamRowAction: {
    color: '#7EF2FF',
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 6,
  },
  card: {
    width: 300,
    height: 300,
    backgroundColor: 'rgba(31, 41, 55, 0)',
    borderRadius: 150,
    padding: 18,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    borderWidth: 0,
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  compassWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomReadout: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    alignItems: 'center',
  },
  readoutPanel: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: 'rgba(31, 41, 55, 0.95)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#C9782B',
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  readoutRow: {
    alignItems: 'center',
  },
  readoutDivider: {
    height: 1,
    marginVertical: 10,
    backgroundColor: 'rgba(249, 115, 22, 0.3)',
  },
  readoutLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: '#C8B29A',
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  readoutBox: {
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C9782B',
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
  },
  readoutValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#C9782B',
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  readoutValueLine: {
    marginTop: 6,
    fontSize: 16,
    fontWeight: '700',
    color: '#F6EDE2',
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  compass: {
    width: 184,
    height: 184,
    borderRadius: 92,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(5, 24, 31, 0.48)',
    borderWidth: 1,
    borderColor: 'rgba(76, 226, 255, 0.28)',
    overflow: 'hidden',
  },
  compassHalo: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: 999,
    backgroundColor: 'rgba(35, 212, 245, 0.08)',
    shadowColor: '#46E3FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.65,
    shadowRadius: 18,
  },
  compassOuterRing: {
    position: 'absolute',
    width: 172,
    height: 172,
    borderRadius: 86,
    borderWidth: 2,
    borderColor: 'rgba(70, 227, 255, 0.8)',
  },
  compassMiddleRing: {
    position: 'absolute',
    width: 136,
    height: 136,
    borderRadius: 68,
    borderWidth: 1,
    borderColor: 'rgba(70, 227, 255, 0.4)',
  },
  compassInnerRing: {
    position: 'absolute',
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 1,
    borderColor: 'rgba(70, 227, 255, 0.28)',
  },
  compassGridVertical: {
    position: 'absolute',
    width: 1,
    height: 150,
    backgroundColor: 'rgba(70, 227, 255, 0.16)',
  },
  compassGridHorizontal: {
    position: 'absolute',
    width: 150,
    height: 1,
    backgroundColor: 'rgba(70, 227, 255, 0.16)',
  },
  compassGridDiagonalOne: {
    position: 'absolute',
    width: 1,
    height: 138,
    backgroundColor: 'rgba(70, 227, 255, 0.12)',
    transform: [{ rotate: '45deg' }],
  },
  compassGridDiagonalTwo: {
    position: 'absolute',
    width: 1,
    height: 138,
    backgroundColor: 'rgba(70, 227, 255, 0.12)',
    transform: [{ rotate: '-45deg' }],
  },
  compassLabel: {
    position: 'absolute',
    color: '#89F3FF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textShadowColor: 'rgba(0, 0, 0, 0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  compassCenter: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00F5A0',
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -4,
    marginTop: -4,
  },
  centerAvatarWrap: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: '#C9782B',
    backgroundColor: '#1E1813',
    alignItems: 'center',
    justifyContent: 'center',
    left: '50%',
    top: '50%',
    marginLeft: -28,
    marginTop: -28,
    shadowColor: '#C9782B',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 5,
  },
  centerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  pointerWrap: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 42,
    height: 84,
    marginLeft: -21,
    marginTop: -42,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  pointerNeedle: {
    width: 42,
    height: 84,
    alignItems: 'center',
    justifyContent: 'flex-start',
    shadowColor: '#00F5A0',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 10,
    elevation: 6,
  },
  pointerHead: {
    width: 0,
    height: 0,
    borderLeftWidth: 16,
    borderRightWidth: 16,
    borderBottomWidth: 30,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#46E3FF',
  },
  pointerCoreRing: {
    position: 'absolute',
    bottom: 0,
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 3,
    borderColor: '#46E3FF',
    backgroundColor: 'rgba(5, 24, 31, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointerCoreDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#46E3FF',
    opacity: 0.9,
  },
  errorText: {
    fontSize: 14,
    color: '#FCA5A5',
    textAlign: 'center',
  },
  userMarker: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userPulse: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(6, 182, 212, 0.65)',
  },
  userDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#D9A441',
    borderWidth: 2,
    borderColor: '#0F172A',
  },
  otherUserMarker: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: '#C9782B',
    backgroundColor: '#fff',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  otherUserAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  otherUserPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#C9782B',
  },
});
