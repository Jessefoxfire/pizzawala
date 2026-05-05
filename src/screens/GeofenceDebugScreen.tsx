import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
    TouchableOpacity,
  ActivityIndicator,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Geolocation from 'react-native-geolocation-service';
import { collection, getFirestore, onSnapshot } from '@react-native-firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import type { Geofence } from '../types';
import { showGeofenceNotification } from '../notifications/geofenceNotifications';
import {
  cacheGeofences,
  loadLastGeofenceEvent,
  shouldNotifyForEvent,
  type LastGeofenceEvent,
} from '../geofencing/storage';
import { ensureLocationPermission, normalizeLatLng } from '../utils/geo';
import { auth } from '../services/firebase';
import { processGeofenceEvent, notifyGeofenceTransition } from '../geofencing/processor';
import { effectiveGeofenceRadiusMeters } from '../geofencing/effectiveRadius';
import { getNativeStatus, openBatteryExemptionUi, startNativeMonitoring, type NativeGeofenceStatus } from '../geofencing/native';

type Props = NativeStackScreenProps<RootStackParamList, 'GeofenceDebug'>;

type Coordinates = { lat: number; lng: number };

const toRadians = (value: number) => (value * Math.PI) / 180;

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

const formatDistance = (meters: number | null) => {
  if (meters == null || !isFinite(meters)) return '--';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
};

export default function GeofenceDebugScreen({ navigation }: Props) {
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [position, setPosition] = useState<Coordinates | null>(null);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(true);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [forcing, setForcing] = useState(false);
  const [lastEvent, setLastEvent] = useState<LastGeofenceEvent | null>(null);
  const [nativeStatus, setNativeStatus] = useState<NativeGeofenceStatus | null>(null);
  const lastEvaluatedInsideRef = useRef<boolean | null>(null);
  const evaluatingRef = useRef(false);
  const watchStartedRef = useRef(false);

  const refreshLastEvent = async () => {
    const event = await loadLastGeofenceEvent();
    setLastEvent(event);
    setNativeStatus(await getNativeStatus());
  };

  useEffect(() => {
    const fs = getFirestore();
    const unsub = onSnapshot(
      collection(fs, 'geofences'),
      snap => {
        if (!snap || !snap.docs || snap.empty) {
          setGeofences([]);
          setLoading(false);
          return;
        }
        const items = snap.docs
          .map(d => {
            const data = d.data() as any;
            const center = normalizeLatLng(data.center ?? data.location ?? data.coords);
            if (!center) return null;
            return { id: d.id, ...data, center } as Geofence;
          })
          .filter(Boolean) as Geofence[];
        setGeofences(items);
        setSelectedId(prev => prev || items[0]?.id || null);
        setLoading(false);
        if (items.length > 0) {
          void cacheGeofences(items);
        }
      },
      err => {
        console.warn('GeofenceDebug geofences listener', err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  useEffect(() => {
    const loadLast = async () => {
      await refreshLastEvent();
    };
    void loadLast();
  }, []);

  useEffect(() => {
    let watchId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const fetchCurrentPosition = () => {
      Geolocation.getCurrentPosition(
        pos => {
          const nextPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setPosition(nextPosition);
          setLocating(false);
          setLocationError(null);
        },
        err => {
          setLocating(false);
          setLocationError(err?.message || 'Unable to get location.');
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
          showLocationDialog: true,
          forceRequestLocation: true,
        }
      );
    };

    const startWatch = async () => {
      const allowed = await ensureLocationPermission();
      if (!allowed) {
        setLocating(false);
        setLocationError('Location permission denied.');
        return;
      }
      if (Platform.OS === 'android' && !Geolocation.watchPosition) {
        setLocating(false);
        setLocationError('Location watcher unavailable.');
        return;
      }

      fetchCurrentPosition();

      watchId = Geolocation.watchPosition(
        pos => {
          setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setLocating(false);
          setLocationError(null);
          if (!watchStartedRef.current) {
            watchStartedRef.current = true;
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
          }
        },
        err => {
          setLocating(false);
          setLocationError(err?.message || 'Unable to get location.');
        },
        {
          enableHighAccuracy: true,
          distanceFilter: 1,
          interval: 3000,
          fastestInterval: 1000,
          showLocationDialog: true,
          forceRequestLocation: true,
        }
      );

      timeoutId = setTimeout(() => {
        if (!watchStartedRef.current) {
          setLocating(false);
          setLocationError('Location update timed out. Tap "Force location".');
        }
      }, 12000);
    };

    startWatch();

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (watchId !== null) {
        Geolocation.clearWatch(watchId);
      }
      watchStartedRef.current = false;
    };
  }, []);

  const selected = useMemo(
    () => geofences.find(item => item.id === selectedId) || null,
    [geofences, selectedId]
  );

  useEffect(() => {
    lastEvaluatedInsideRef.current = null;
  }, [selectedId]);

  const distanceMeters = useMemo(() => {
    if (!position || !selected) return null;
    return getDistanceMeters(position, selected.center);
  }, [position, selected]);

  const isInside = useMemo(() => {
    if (distanceMeters == null || !selected) return null;
    return distanceMeters <= effectiveGeofenceRadiusMeters(selected.radiusMeters);
  }, [distanceMeters, selected]);

  const applyGeofenceEvaluation = useCallback(
    async (source: 'debug-manual' | 'debug-poll', options?: { showDialogs?: boolean }) => {
      const showDialogs = options?.showDialogs ?? true;
      if (evaluatingRef.current) {
        return;
      }

      if (!selected) {
        if (source === 'debug-manual') {
          setLocationError('Select a worksite first.');
        }
        return;
      }
      const user = auth.currentUser;
      if (!user?.uid) {
        if (source === 'debug-manual') {
          setLocationError('User not signed in.');
        }
        return;
      }

      const allowed = await ensureLocationPermission();
      if (!allowed) {
        if (source === 'debug-manual') {
          setLocationError('Location permission denied.');
        }
        return;
      }

      if (source === 'debug-manual') {
        setLocating(true);
      }

      evaluatingRef.current = true;

      Geolocation.getCurrentPosition(
        async pos => {
          try {
            const current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            setPosition(current);
            setLocating(false);
            setLocationError(null);

            const distance = getDistanceMeters(current, selected.center);
            const inside = distance <= effectiveGeofenceRadiusMeters(selected.radiusMeters);
            const previous = lastEvaluatedInsideRef.current;

            if (previous === null) {
              lastEvaluatedInsideRef.current = inside;
              return;
            }

            if (previous === inside) {
              return;
            }

            lastEvaluatedInsideRef.current = inside;
            const transition = inside ? 'enter' : 'exit';

            const result = await processGeofenceEvent({
              userId: user.uid,
              teamId: selected.teamId,
              geofence: selected,
              transition,
              location: current,
              distanceMeters: distance,
              timestamp: Date.now(),
              source,
              allowPrompt: true,
            });

            const payload = result.promptPayload ?? {
              eventId: result.eventId,
              geofenceId: selected.id,
              geofenceName: selected.name,
              transition,
              occurredAt: Date.now(),
            };

            const shouldNotify = await shouldNotifyForEvent(result.eventId);
            if (shouldNotify) {
              notifyGeofenceTransition(payload);
            }
            await refreshLastEvent();
          } finally {
            evaluatingRef.current = false;
          }
        },
        err => {
          evaluatingRef.current = false;
          if (source === 'debug-manual') {
            setLocating(false);
            setLocationError(err?.message || 'Unable to get location.');
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 5000,
          showLocationDialog: showDialogs,
          forceRequestLocation: showDialogs,
        }
      );
    },
    [selected]
  );

  useEffect(() => {
    if (loading || !selected) return;

    const id = setInterval(() => {
      void applyGeofenceEvaluation('debug-poll', { showDialogs: false });
    }, 10000);

    return () => clearInterval(id);
  }, [loading, selected, applyGeofenceEvaluation]);

  const evaluateGeofenceNow = async () => {
    await applyGeofenceEvaluation('debug-manual', { showDialogs: true });
  };

  const historyLines = nativeStatus?.nativeHistory?.split('\n').filter(l => l.length > 0) || [];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Home</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Geofence Debug</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#F3E6D3" />
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <Text style={styles.sectionTitle}>Select worksite</Text>
          <View style={styles.chips}>
            {geofences.length === 0 ? (
              <Text style={styles.empty}>No geofences available.</Text>
            ) : (
              geofences.map(item => (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.chip,
                    item.id === selectedId && styles.chipActive,
                  ]}
                  onPress={() => setSelectedId(item.id)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      item.id === selectedId && styles.chipTextActive,
                    ]}
                  >
                    {item.name}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Current location</Text>
            {locating ? (
              <Text style={styles.cardValue}>Locating...</Text>
            ) : locationError ? (
              <Text style={styles.errorText}>{locationError}</Text>
            ) : position ? (
              <Text style={styles.cardValue}>
                {position.lat.toFixed(6)}, {position.lng.toFixed(6)}
              </Text>
            ) : (
              <Text style={styles.cardValue}>--</Text>
            )}
            <View style={styles.debugActions}>
              <TouchableOpacity
                style={styles.debugButton}
                disabled={forcing}
                onPress={() => {
                  if (forcing) return;
                  setForcing(true);
                  ensureLocationPermission()
                    .then(allowed => {
                      if (!allowed) {
                        setLocating(false);
                        setLocationError('Location permission denied.');
                        setForcing(false);
                        return;
                      }
                      Geolocation.getCurrentPosition(
                        pos => {
                          setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                          setLocating(false);
                          setLocationError(null);
                          setForcing(false);
                        },
                        err => {
                          setLocating(false);
                          setLocationError(err?.message || 'Unable to get location.');
                          setForcing(false);
                        },
                        {
                          enableHighAccuracy: true,
                          timeout: 15000,
                          maximumAge: 0,
                          showLocationDialog: true,
                          forceRequestLocation: true,
                        }
                      );
                    })
                    .catch(() => {
                      setLocating(false);
                      setLocationError('Unable to request location permission.');
                      setForcing(false);
                    });
                }}
              >
                <Text style={styles.debugButtonText}>
                  {forcing ? 'Locating...' : 'Force location'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Geofence status</Text>
            {selected ? (
              <View>
                <Text style={styles.cardValue}>Radius: {selected.radiusMeters} m</Text>
                <Text style={styles.cardValue}>
                  Distance: {formatDistance(distanceMeters)}
                </Text>
                <Text style={styles.cardValue}>
                  Inside: {isInside == null ? '--' : isInside ? 'YES' : 'NO'}
                </Text>
              </View>
            ) : (
              <Text style={styles.cardValue}>Select a worksite.</Text>
            )}
            <View style={styles.debugActions}>
              <TouchableOpacity
                style={styles.debugButton}
                onPress={() => {
                  void evaluateGeofenceNow();
                }}
              >
                <Text style={styles.debugButtonText}>Evaluate geofence</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Last geofence event</Text>
            {lastEvent ? (
              <View>
                <Text style={styles.cardValue}>
                  {lastEvent.transition.toUpperCase()} • {lastEvent.geofenceName || lastEvent.geofenceId}
                </Text>
                <Text style={styles.cardValue}>Source: {lastEvent.source}</Text>
                <Text style={styles.cardValue}>
                  Time: {new Date(lastEvent.occurredAt).toLocaleString()}
                </Text>
              </View>
            ) : (
              <Text style={styles.cardValue}>No events recorded yet.</Text>
            )}
            <View style={styles.debugActions}>
              <TouchableOpacity
                style={styles.debugButton}
                onPress={async () => {
                  await refreshLastEvent();
                }}
              >
                <Text style={styles.debugButtonText}>Refresh</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.debugButton, styles.debugButtonAlt]}
                onPress={async () => {
                  await showGeofenceNotification({
                    eventId: 'test',
                    geofenceId: 'test',
                    geofenceName: 'Test Worksite',
                    transition: 'exit',
                    occurredAt: Date.now(),
                  });
                }}
              >
                <Text style={styles.debugButtonText}>Test notification</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Native background status</Text>
            {nativeStatus ? (
              <View>
                <Text style={styles.cardValue}>App Build: v2.2 (Dedup Edition)</Text>
                <Text style={styles.cardValue}>Play Services: {nativeStatus.hasPlayServices ? 'yes' : 'no'}</Text>
                <Text style={styles.cardValue}>Fine location: {nativeStatus.hasFineLocation ? 'yes' : 'no'}</Text>
                <Text style={styles.cardValue}>Background location: {nativeStatus.hasBackgroundLocation ? 'yes' : 'no'}</Text>
                <Text style={styles.cardValue}>Activity recognition: {nativeStatus.hasActivityRecognition ? 'yes' : 'no'}</Text>
                <Text style={styles.cardValue}>Notifications: {nativeStatus.hasNotificationPermission ? 'yes' : 'no'}</Text>
                <Text style={styles.cardValue}>Battery unrestricted: {nativeStatus.ignoringBatteryOptimizations ? 'yes' : 'not exempt'}</Text>
                <Text style={styles.cardValue}>Saved geofences: {nativeStatus.savedGeofenceCount}</Text>
                <Text style={styles.cardValue}>Last registration: {nativeStatus.lastNativeRegistration || '--'}</Text>
                <Text style={styles.cardValue}>Registration error: {nativeStatus.lastNativeRegistrationError || '--'}</Text>
                <Text style={styles.cardValue}>Last native event: {nativeStatus.lastNativeEvent || '--'}</Text>
                <Text style={styles.cardValue}>Native User Name: {nativeStatus.userName || 'Team member'}</Text>
                <Text style={styles.cardValue}>Last activity signal: {nativeStatus.lastActivitySignal || '--'}</Text>
                {historyLines.length > 0 && (
                  <View style={styles.historyBox}>
                    <Text style={styles.historyTitle}>Native Signal History (Last 5):</Text>
                    {historyLines.map((line, idx) => (
                      <Text key={idx} style={styles.historyLine}>• {line}</Text>
                    ))}
                  </View>
                )}
              </View>
            ) : (
              <Text style={styles.cardValue}>Native status unavailable.</Text>
            )}
            <View style={styles.debugActions}>
              <TouchableOpacity
                style={styles.debugButton}
                onPress={async () => {
                  await refreshLastEvent();
                }}
              >
                <Text style={styles.debugButtonText}>Refresh native status</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.debugButton, styles.debugButtonAlt]}
                onPress={async () => {
                  await startNativeMonitoring(geofences);
                  await refreshLastEvent();
                }}
              >
                <Text style={styles.debugButtonText}>Force native sync</Text>
              </TouchableOpacity>
            </View>
          </View>

          {nativeStatus && !nativeStatus.ignoringBatteryOptimizations && (
            <View style={styles.warningCard}>
              <Text style={styles.warningTitle}>⚠️ Battery Optimization is ON</Text>
              <Text style={styles.warningText}>
                OEM battery toggles often do not grant this exemption. Use the system prompt below, confirm for
                PizzaWala, then refresh status.
              </Text>
              <TouchableOpacity
                style={[styles.debugButton, styles.warningButton]}
                onPress={() => void openBatteryExemptionUi()}
              >
                <Text style={styles.debugButtonText}>Open battery exemption</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.helperText}>
            Tips: make sure Location permission is set to Always/Background and
            use “Open battery exemption” if Battery unrestricted still shows “not exempt”.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#2A211B',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#1E1813',
    borderBottomWidth: 1,
    borderBottomColor: '#3A2D24',
  },
  back: { fontSize: 18, fontWeight: 'bold', color: '#EBDCCB' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#F6EDE2' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#C8B29A',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#3A2D24',
    borderWidth: 1,
    borderColor: '#5A4739',
  },
  chipActive: {
    backgroundColor: '#C9782B',
    borderColor: '#D9A441',
  },
  chipText: {
    color: '#EBDCCB',
    fontSize: 12,
  },
  chipTextActive: {
    color: '#1E1813',
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#1E1813',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#3A2D24',
    padding: 14,
  },
  cardTitle: {
    color: '#C8B29A',
    fontWeight: '600',
    marginBottom: 6,
  },
  cardValue: {
    color: '#F6EDE2',
    fontSize: 14,
    marginBottom: 4,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 13,
  },
  helperText: {
    color: '#C8B29A',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  historyBox: {
    marginTop: 10,
    backgroundColor: '#16110D',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
  historyTitle: {
    color: '#C8B29A',
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  historyLine: {
    color: '#A88E73',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 2,
  },
  debugActions: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 10,
  },
  debugButton: {
    backgroundColor: '#C9782B',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  debugButtonAlt: {
    backgroundColor: '#5A4739',
  },
  debugButtonText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 12,
  },
  empty: {
    color: '#A88E73',
    fontSize: 12,
  },
  warningCard: {
    backgroundColor: '#452200',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#D97706',
    marginTop: 8,
  },
  warningTitle: {
    color: '#FBBF24',
    fontWeight: 'bold',
    marginBottom: 4,
    fontSize: 14,
  },
  warningText: {
    color: '#FDE68A',
    fontSize: 13,
    lineHeight: 18,
  },
  warningButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
  },
});
