import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import {
  getAutoShiftEnabled,
  setAutoShiftEnabled,
  getTrackingActiveState,
  setTrackingActiveState,
  getShiftStartTime,
  setShiftStartTime,
  loadCachedGeofences,
} from '../geofencing/storage';
import { effectiveGeofenceRadiusMeters } from '../geofencing/effectiveRadius';
import { 
  getNativeNotificationsEnabled, 
  setNativeNotificationsEnabled,
  initNativeGeofencing
} from '../geofencing/native';
import type { Geofence } from '../types';
import { getDistanceMeters, normalizeLatLng } from '../utils/geo';
import Geolocation from 'react-native-geolocation-service';
import notifee from '@notifee/react-native';

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getFirestore,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@react-native-firebase/firestore';
import { auth } from '../services/firebase';

type ShiftRecord = {
  id: string;
  userId: string;
  geofenceId?: string;
  geofenceName?: string;
  status: 'open' | 'closed';
  startAt?: any;
  endAt?: any;
};

const toRad = (v: number) => (v * Math.PI) / 180;
const distanceM = (p1: { lat: number; lng: number }, p2: { lat: number; lng: number }) => {
  const R = 6371000;
  const dLat = toRad(p2.lat - p1.lat);
  const dLng = toRad(p2.lng - p1.lng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const formatWorkedDuration = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
};

export default function ShiftSetupScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'ShiftSetup'>>();
  
  const [allowAlerts, setAllowAlerts] = useState(true);
  const [autoTracking, setAutoTracking] = useState(false);
  const [worksites, setWorksites] = useState<Geofence[]>([]);
  const [selectedWorksite, setSelectedWorksite] = useState<Geofence | null>(null);
  const [loading, setLoading] = useState(true);
  const [trackingActive, setTrackingActive] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [_elapsed, setElapsed] = useState('00:00:00');

  const userId = auth.currentUser?.uid ?? null;
  const [historyShifts, setHistoryShifts] = useState<ShiftRecord[]>([]);
  const [localStartAt, setLocalStartAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [proximity, setProximity] = useState<{
    isInside: boolean;
    distance: number;
    worksiteName: string;
    center?: { lat: number; lng: number };
  } | null>(null);

  const openShift = useMemo(() => historyShifts.find(s => s.status === 'open') || null, [historyShifts]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!userId) return;
    const fs = getFirestore();
    const unsub = onSnapshot(
      query(collection(fs, 'shifts'), where('userId', '==', userId), limit(50)),
      snap => {
        if (!snap || !snap.docs) {
          setHistoryShifts([]);
          return;
        }
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as ShiftRecord));
        items.sort((a, b) => {
          const ts = (s: ShiftRecord) => {
            if (!s?.startAt) return 0;
            if (typeof (s.startAt as any).toDate === 'function') return (s.startAt as any).toDate().getTime();
            const d0 = new Date(s.startAt as any);
            return isNaN(d0.getTime()) ? 0 : d0.getTime();
          };
          return ts(b) - ts(a);
        });
        setHistoryShifts(items);
      },
      () => setHistoryShifts([])
    );
    return () => unsub();
  }, [userId]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const tick = async () => {
      try {
        const cached = await loadCachedGeofences();
        if (cached.length === 0) return;
        Geolocation.getCurrentPosition(
          pos => {
            const current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            let target = cached.find(g => g.id === openShift?.geofenceId);
            if (!target) {
              const sorted = cached
                .filter(g => g.active !== false)
                .map(g => ({ ...g, dist: distanceM(current, g.center) }))
                .sort((a, b) => a.dist - b.dist);
              target = sorted[0];
            }
            if (target) {
              const dist = distanceM(current, target.center);
              const threshold = effectiveGeofenceRadiusMeters(target.radiusMeters);
              setProximity({
                isInside: dist <= threshold,
                distance: dist,
                worksiteName: target.name,
                center: target.center,
              });
            }
          },
          () => {},
          { enableHighAccuracy: true, timeout: 10000 }
        );
      } catch {
        /* ignore */
      }
    };
    void tick();
    interval = setInterval(tick, 15000);
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [openShift]);

  const elapsedMs = useMemo(() => {
    if (!openShift?.startAt && !localStartAt) return 0;
    const startSource = openShift?.startAt ?? localStartAt;
    const startDate = (startSource as any)?.toDate?.() || new Date(startSource as any);
    return now.getTime() - startDate.getTime();
  }, [openShift, localStartAt, now]);

  const handleFirestoreStartShift = async () => {
    if (!userId) {
      Alert.alert('Notice', 'Sign in to start a shift.');
      return;
    }
    if (openShift) return;
    let gId: string | null = null;
    let gName: string | null = null;
    try {
      const cached = await loadCachedGeofences();
      const pos = await new Promise<Geolocation.GeoPosition | null>(resolve =>
        Geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 5000 })
      );
      if (pos && cached.length > 0) {
        const current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const sorted = cached
          .filter(g => g.active !== false)
          .map(g => ({ ...g, dist: distanceM(current, g.center) }))
          .sort((a, b) => a.dist - b.dist);
        if (sorted[0] && sorted[0].dist < 300) {
          gId = sorted[0].id;
          gName = sorted[0].name;
        }
      }
    } catch {
      /* ignore */
    }
    try {
      const fs = getFirestore();
      const userSnap = await getDoc(doc(fs, 'users', userId));
      const teamId = userSnap.data()?.teamId || 'team-1';
      await addDoc(collection(fs, 'shifts'), {
        userId,
        teamId,
        geofenceId: gId,
        geofenceName: gName,
        status: 'open',
        startAt: serverTimestamp(),
        startedBy: 'manual',
      });
      setLocalStartAt(new Date());
    } catch (err: any) {
      Alert.alert('Notice', err?.message || 'Could not start shift.');
    }
  };

  const handleFirestoreEndShift = async () => {
    if (!userId || !openShift) {
      return;
    }
    try {
      const fs = getFirestore();
      await updateDoc(doc(fs, 'shifts', openShift.id), {
        status: 'closed',
        endAt: serverTimestamp(),
        endedBy: 'manual',
      });
      setLocalStartAt(null);
    } catch (err: any) {
      Alert.alert('Notice', err?.message || 'Could not end shift.');
    }
  };

  const openDirections = () => {
    if (!proximity?.center) return;
    const { lat, lng } = proximity.center;
    const url = Platform.select({
      ios: `maps:0,0?q=${lat},${lng}`,
      android: `geo:0,0?q=${lat},${lng}`,
    });
    if (url) Linking.openURL(url);
  };

  useEffect(() => {
    // 1. Load basic settings
    async function initSettings() {
      const auto = await getAutoShiftEnabled();
      const notify = await getNativeNotificationsEnabled();
      const active = await getTrackingActiveState();
      const st = await getShiftStartTime();
      
      setAutoTracking(auto);
      setAllowAlerts(notify);
      setTrackingActive(active);
      setStartTime(st);
    }
    initSettings();

    // 2. Listen for worksites LIVE (native Firestore — same auth as sign-in)
    const fs = getFirestore();
    const q = query(collection(fs, 'geofences'));
    const unsub = onSnapshot(
      q,
      snap => {
        if (!snap) {
          setWorksites([]);
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

        const sorted = items.sort((a, b) => a.name.localeCompare(b.name));
        setWorksites(sorted);

        setSelectedWorksite(prev => {
          if (sorted.length === 0) return null;
          if (prev && sorted.some(w => w.id === prev.id)) return prev;
          return sorted[0];
        });
        setLoading(false);
      },
      err => {
        console.warn('ShiftSetup geofences listener', err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  // 3. Timer logic
  useEffect(() => {
    if (!trackingActive || !startTime) {
      setElapsed('00:00:00');
      return;
    }

    const interval = setInterval(() => {
      const diff = Date.now() - startTime;
      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      
      const f = (n: number) => n.toString().padStart(2, '0');
      setElapsed(`${f(hours)}:${f(mins)}:${f(secs)}`);
    }, 1000);

    return () => clearInterval(interval);
  }, [trackingActive, startTime]);

  const handleStop = async () => {
    try {
      await setTrackingActiveState(false);
      await setShiftStartTime(null);
      setTrackingActive(false);
      setStartTime(null);
      Alert.alert('Tracking Stopped', 'Background monitoring has been disabled.');
    } catch {
      Alert.alert('Notice', 'Failed to stop tracking.');
    }
  };

  const handleStart = async () => {
    if (trackingActive) {
      handleStop();
      return;
    }

    if (!selectedWorksite) {
      Alert.alert('Selection Required', 'Please select a worksite first.');
      return;
    }

    try {
      // 1. Persist settings
      await setAutoShiftEnabled(autoTracking);
      await setNativeNotificationsEnabled(allowAlerts);
      
      const startedAt = Date.now();
      await setTrackingActiveState(true);
      await setShiftStartTime(startedAt);
      setStartTime(startedAt);
      setTrackingActive(true);

      // 2. Force Native Sync
      await initNativeGeofencing();

      // 3. Get immediate status for notification
      Geolocation.getCurrentPosition(
        async (pos) => {
          const dist = getDistanceMeters(
            { lat: pos.coords.latitude, lng: pos.coords.longitude },
            selectedWorksite.center
          );
          
          const isInside = dist <= effectiveGeofenceRadiusMeters(selectedWorksite.radiusMeters);
          const statusText = isInside ? 'inside' : 'outside';

          // 4. Send notification
          await notifee.displayNotification({
            title: 'Shift Tracking Active',
            body: `You are ${statusText} the ${selectedWorksite.name} worksite. Tap to view map.`,
            android: {
              channelId: 'geofence-events',
              pressAction: {
                id: 'default',
              },
            },
            data: {
              type: 'navigation_link',
              geofence: selectedWorksite
            }
          });

          setTrackingActive(true);
          // Alert.alert('Tracking Started', `System synced. You are currently ${statusText} the site.`);
          navigation.replace('MySchedule');
        },
        (err) => {
          console.warn('Location failed for setup notification', err);
          // Alert.alert('Tracking Started', 'System synced. Unable to determine immediate proximity.');
          navigation.replace('MySchedule');
        },
        { enableHighAccuracy: true, timeout: 15000 }
      );
    } catch (err) {
      console.error('Setup failed:', err);
      Alert.alert('Notice', 'Failed to synchronize settings.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Shift</Text>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#D9A441" />
        </View>
      ) : (
      <ScrollView style={styles.content}>
        <View style={styles.timerCard}>
          <Text style={styles.timerHeader}>Current Shift Status</Text>
          {proximity && (
            <View style={styles.proximityBadge}>
              <Text style={[styles.proximityText, proximity.isInside ? styles.textInside : styles.textOutside]}>
                You are {proximity.isInside ? 'Inside' : 'Outside'} ({Math.round(proximity.distance)}m) the{' '}
                {proximity.worksiteName} worksite.
              </Text>
              {!proximity.isInside && (
                <TouchableOpacity onPress={openDirections} style={styles.directionsLink}>
                  <Text style={styles.directionsLinkText}>Would you like directions to the worksite?</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          <Text style={styles.timerLabel}>You have worked:</Text>
          <Text style={styles.timerValue}>{openShift ? formatWorkedDuration(elapsedMs) : '00:00:00'}</Text>
          <Text style={styles.timerStatus}>
            {openShift ? `System is monitoring ${openShift.geofenceName || 'worksite'}` : 'Not on shift'}
          </Text>
          <View style={styles.timerActions}>
            {!openShift ? (
              <TouchableOpacity style={styles.startBtn} onPress={() => void handleFirestoreStartShift()}>
                <Text style={styles.startBtnText}>Start Shift</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.endBtn} onPress={() => void handleFirestoreEndShift()}>
                <Text style={styles.endBtnText}>End Shift</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.autoRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.autoLabel}>Auto-Tracking</Text>
              <Text style={styles.autoDesc}>Auto start/end shifts when arriving/leaving.</Text>
            </View>
            <Switch
              value={autoTracking}
              onValueChange={async v => {
                setAutoTracking(v);
                await setAutoShiftEnabled(v);
              }}
              trackColor={{ false: '#3A2D24', true: '#C9782B' }}
              thumbColor={autoTracking ? '#F6EDE2' : '#A88E73'}
            />
          </View>
        </View>

        <View style={styles.introSection}>
          <Text style={styles.introText}>
            This app is designed to help you keep track of your shifts. It can do this automatically, 
            by detecting your location, or you can stop and start your shifts manually.
          </Text>
        </View>

        <TouchableOpacity 
          style={styles.manualChoiceBtn} 
          onPress={async () => {
            await setAutoShiftEnabled(false);
            navigation.replace('MySchedule');
          }}
        >
          <Text style={styles.manualChoiceText}>I will start and stop shifts myself</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={styles.label}>Worksite Alerts</Text>
            <Switch 
              value={allowAlerts} 
              onValueChange={setAllowAlerts}
              trackColor={{ false: '#3A2D24', true: '#C9782B' }}
            />
          </View>
          <Text style={styles.hint}>Receive notifications when arriving at or leaving a worksite.</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.section}>
          <Text style={styles.label}>Select Worksite</Text>
          <Text style={styles.hint}>Choose the site you are working at today.</Text>
          <View style={styles.worksiteList}>
            {worksites.map(ws => (
              <TouchableOpacity 
                key={ws.id} 
                onPress={() => setSelectedWorksite(ws)}
                style={[
                  styles.worksitePill,
                  selectedWorksite?.id === ws.id && styles.worksitePillSelected
                ]}
              >
                <Text style={[
                  styles.worksiteText,
                  selectedWorksite?.id === ws.id && styles.worksiteTextSelected
                ]}>
                  {ws.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>
      )}

      {!loading && (
      <View style={styles.footer}>
        <Text style={styles.startHint}>
          Click Start below to begin automatic location-based shift detection:
        </Text>
        <TouchableOpacity 
          style={[styles.startButton, trackingActive && styles.trackingButton]} 
          onPress={handleStart}
        >
          <Text style={styles.startButtonText}>
            {trackingActive ? 'STOP TRACKING' : 'START'}
          </Text>
        </TouchableOpacity>
      </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1E1813',
  },
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#3A2D24',
  },
  backButton: {
    padding: 8,
    marginRight: 10,
  },
  backText: {
    color: '#D9A441',
    fontSize: 16,
    fontWeight: '600',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F6EDE2',
  },
  introSection: {
    backgroundColor: '#3A2D24',
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#C9782B',
  },
  introText: {
    color: '#F6EDE2',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  section: {
    marginVertical: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F6EDE2',
  },
  hint: {
    fontSize: 14,
    color: '#C8B29A',
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: '#3A2D24',
    marginVertical: 20,
  },
  worksiteList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  worksitePill: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#3A2D24',
    borderWidth: 1,
    borderColor: '#5A4739',
  },
  worksitePillSelected: {
    backgroundColor: '#C9782B',
    borderColor: '#F3E6D3',
  },
  worksiteText: {
    color: '#F6EDE2',
    fontWeight: '600',
  },
  worksiteTextSelected: {
    color: '#1E1813',
    fontWeight: '700',
  },
  footer: {
    padding: 24,
    borderTopWidth: 1,
    borderTopColor: '#3A2D24',
  },
  startHint: {
    color: '#A88E73',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
    fontWeight: '600',
    lineHeight: 18,
  },
  startButton: {
    backgroundColor: '#C9782B',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#C9782B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  startButtonText: {
    color: '#F6EDE2',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 2,
  },
  trackingButton: {
    backgroundColor: '#9E3C2E',
    shadowColor: '#9E3C2E',
  },
  statusWindow: {
    backgroundColor: '#1E1813',
    margin: 20,
    marginBottom: 0,
    padding: 20,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#4CAF50',
    alignItems: 'center',
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 15,
    elevation: 10,
  },
  statusTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: '#4CAF50',
    letterSpacing: 2,
    marginBottom: 8,
  },
  timerContainer: {
    backgroundColor: '#2A211B',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3A2D24',
    marginBottom: 12,
  },
  timerText: {
    fontSize: 42,
    fontWeight: '900',
    color: '#F6EDE2',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  statusSub: {
    fontSize: 14,
    color: '#C8B29A',
    fontWeight: '500',
  },
  stopLink: {
    marginTop: 16,
    padding: 8,
  },
  stopLinkText: {
    color: '#9E3C2E',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  manualChoiceBtn: {
    backgroundColor: '#3A2D24',
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#C9782B',
    alignItems: 'center',
    marginVertical: 10,
  },
  manualChoiceText: {
    color: '#F6EDE2',
    fontSize: 16,
    fontWeight: '700',
  },
  timerCard: {
    padding: 24,
    borderRadius: 20,
    backgroundColor: '#2A211B',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#C9782B',
    marginBottom: 20,
  },
  timerHeader: {
    color: '#C9782B',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 12,
    letterSpacing: 1,
  },
  proximityBadge: {
    backgroundColor: '#1E1813',
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
  proximityText: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  textInside: { color: '#4CAF50' },
  textOutside: { color: '#F44336' },
  directionsLink: { marginTop: 8 },
  directionsLinkText: { color: '#C9782B', fontSize: 12, textDecorationLine: 'underline', fontWeight: 'bold' },
  timerLabel: { color: '#A88E73', fontSize: 12, marginBottom: 8 },
  timerValue: {
    color: '#F6EDE2',
    fontSize: 42,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  timerStatus: { color: '#A88E73', fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  timerActions: { marginTop: 24, width: '100%' },
  startBtn: { backgroundColor: '#C9782B', paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  startBtnText: { color: '#1E1813', fontSize: 18, fontWeight: '900', textTransform: 'uppercase' },
  endBtn: {
    backgroundColor: '#5C2420',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#9E3C2E',
  },
  endBtnText: { color: '#F6EDE2', fontSize: 18, fontWeight: '900', textTransform: 'uppercase' },
  autoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#3A2D24',
    width: '100%',
  },
  autoLabel: { color: '#F6EDE2', fontWeight: 'bold' },
  autoDesc: { color: '#A88E73', fontSize: 12, marginTop: 2 },
});
