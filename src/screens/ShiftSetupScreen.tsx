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
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import {
  getAutoShiftEnabled,
  getWorksiteAlertsEnabled,
  getShiftSetupIntroSeen,
  setAutoShiftEnabled,
  setWorksiteAlertsEnabled,
  setShiftSetupIntroSeen,
  loadCachedGeofences,
} from '../geofencing/storage';
import { effectiveGeofenceRadiusMeters } from '../geofencing/effectiveRadius';
import type { Geofence } from '../types';
import { getDistanceMeters, normalizeLatLng, requestLocationForFeature } from '../utils/geo';
import Geolocation from 'react-native-geolocation-service';

import {
  calcBreakMs,
  calcCurrentPauseMs,
  calcWorkedMs,
  endLiveShift,
  formatShiftDuration,
  isShiftPaused,
  offlineOpenShiftToLiveShift,
  pauseLiveShift,
  resumeLiveShift,
  startLiveShift,
  type LiveShift,
} from '../services/shifts';
import DaySummaryModal from '../components/DaySummaryModal';
import { getOfflineOpenShift } from '../offline/outbox';
import { subscribeOutboxChanges } from '../offline/events';
import { useOffline } from '../context/OfflineContext';
import {
  collection,
  getFirestore,
  limit,
  onSnapshot,
  query,
  where,
} from '@react-native-firebase/firestore';
import { auth } from '../services/firebase';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import PizzaFireScreen from '../components/PizzaFireScreen';

type ShiftRecord = LiveShift;

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

const formatWorkedDuration = formatShiftDuration;

export default function ShiftSetupScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'ShiftSetup'>>();
  
  const [allowAlerts, setAllowAlerts] = useState(false);
  const [autoTracking, setAutoTracking] = useState(false);
  const [worksites, setWorksites] = useState<Geofence[]>([]);
  const [selectedWorksite, setSelectedWorksite] = useState<Geofence | null>(null);
  const [selectedWorkCategory, setSelectedWorkCategory] = useState<'driving' | null>(null);
  const [loading, setLoading] = useState(true);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [daySummaryOpen, setDaySummaryOpen] = useState(false);
  const [showIntroMessage, setShowIntroMessage] = useState(false);

  const userId = auth.currentUser?.uid ?? null;
  const [historyShifts, setHistoryShifts] = useState<ShiftRecord[]>([]);
  const [localStartAt, setLocalStartAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [proximity, setProximity] = useState<{
    isInside: boolean;
    distance: number;
    worksiteName: string;
    worksiteId: string;
    configuredRadius: number;
    effectiveRadius: number;
    center?: { lat: number; lng: number };
  } | null>(null);
  const [offlineShift, setOfflineShift] = useState<LiveShift | null>(null);
  const { isOnline, pendingCount } = useOffline();
  const activeWorksites = useMemo(() => worksites.filter(worksite => worksite.active !== false), [worksites]);
  const displayedWorksite = openShift
    ? activeWorksites.find(worksite => worksite.id === openShift.geofenceId) || null
    : selectedWorksite;
  const displayedWorkCategory = openShift?.workCategory ?? selectedWorkCategory;
  const insideWorksite = useMemo(
    () => (proximity?.isInside ? activeWorksites.find(worksite => worksite.id === proximity.worksiteId) || null : null),
    [activeWorksites, proximity]
  );
  const otherActiveWorksites = useMemo(
    () => activeWorksites.filter(worksite => worksite.id !== insideWorksite?.id),
    [activeWorksites, insideWorksite]
  );

  const refreshOfflineShift = React.useCallback(async () => {
    const offline = await getOfflineOpenShift();
    setOfflineShift(offline ? offlineOpenShiftToLiveShift(offline) : null);
  }, []);

  useEffect(() => {
    void refreshOfflineShift();
    return subscribeOutboxChanges(() => {
      void refreshOfflineShift();
    });
  }, [refreshOfflineShift]);

  const openShift = useMemo(() => {
    const fromFirestore = historyShifts.find(s => s.status === 'open' && !s.isScheduled) || null;
    if (offlineShift) return offlineShift;
    return fromFirestore;
  }, [historyShifts, offlineShift]);

  const shiftPaused = openShift ? isShiftPaused(openShift) : false;

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    void (async () => {
      const seen = await getShiftSetupIntroSeen();
      if (seen) {
        setShowIntroMessage(false);
        return;
      }
      setShowIntroMessage(true);
      await setShiftSetupIntroSeen(true);
    })();
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
        const items = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as ShiftRecord))
          .filter(s => !s.isScheduled);
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
    if (!autoTracking && !allowAlerts) {
      setProximity(null);
      return;
    }
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
              const configuredRadius =
                typeof target.radiusMeters === 'number' && target.radiusMeters > 0
                  ? target.radiusMeters
                  : 150;
              const threshold = effectiveGeofenceRadiusMeters(target.radiusMeters);
              setProximity({
                isInside: dist <= threshold,
                distance: dist,
                worksiteName: target.name,
                worksiteId: target.id,
                configuredRadius,
                effectiveRadius: threshold,
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
  }, [allowAlerts, autoTracking, openShift]);

  const workedMs = useMemo(() => {
    if (!openShift) return 0;
    return calcWorkedMs(openShift, now.getTime());
  }, [openShift, now]);

  const breakMs = useMemo(() => {
    if (!openShift) return 0;
    return calcBreakMs(openShift, now.getTime());
  }, [openShift, now]);

  const pauseMs = useMemo(() => {
    if (!openShift) return 0;
    return calcCurrentPauseMs(openShift, now.getTime());
  }, [openShift, now]);

  const handleFirestoreStartShift = async () => {
    if (!userId) {
      Alert.alert('Notice', 'Sign in to start a shift.');
      return;
    }
    if (openShift || shiftBusy) return;
    setShiftBusy(true);
    try {
      await startLiveShift({
        userId,
        geofenceId: selectedWorksite?.id ?? null,
        geofenceName: selectedWorksite?.name ?? null,
        workCategory: selectedWorkCategory,
        startedBy: 'manual',
      });
      setLocalStartAt(new Date());
      await refreshOfflineShift();
      if (!isOnline) {
        Alert.alert(
          'Shift saved offline',
          'Your shift is running on this device and will sync when you are back online.'
        );
      }
    } catch (err: any) {
      Alert.alert('Notice', err?.message || 'Could not start shift.');
    } finally {
      setShiftBusy(false);
    }
  };

  const handleFirestorePauseShift = async () => {
    if (!openShift || shiftBusy) return;
    setShiftBusy(true);
    try {
      const result = await pauseLiveShift(openShift.id);
      await refreshOfflineShift();
      if (result.queued) {
        Alert.alert('Saved offline', 'Pause will sync when you are back online.');
      }
    } catch (err: any) {
      Alert.alert('Notice', err?.message || 'Could not pause shift.');
    } finally {
      setShiftBusy(false);
    }
  };

  const handleFirestoreResumeShift = async () => {
    if (!openShift || shiftBusy) return;
    setShiftBusy(true);
    try {
      const result = await resumeLiveShift(openShift.id);
      await refreshOfflineShift();
      if (result.queued) {
        Alert.alert('Saved offline', 'Resume will sync when you are back online.');
      }
    } catch (err: any) {
      Alert.alert('Notice', err?.message || 'Could not resume shift.');
    } finally {
      setShiftBusy(false);
    }
  };

  const handleFirestoreEndShift = () => {
    if (!openShift || shiftBusy) return;
    setDaySummaryOpen(true);
  };

  const selectWorksite = async (worksite: Geofence | null, workCategory: 'driving' | null = null) => {
    if (!openShift) {
      setSelectedWorksite(worksite);
      setSelectedWorkCategory(workCategory);
      return;
    }
    if ((openShift.geofenceId || null) === (worksite?.id || null) && (openShift.workCategory || null) === workCategory) {
      return;
    }
    setShiftBusy(true);
    try {
      await endLiveShift(openShift.id, 'manual');
      await startLiveShift({
        userId: userId || openShift.userId,
        geofenceId: worksite?.id ?? null,
        geofenceName: worksite?.name ?? null,
        workCategory,
        startedBy: 'manual',
      });
      await refreshOfflineShift();
    } catch (err: any) {
      Alert.alert('Notice', err?.message || 'Could not switch worksite.');
    } finally {
      setShiftBusy(false);
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
      const notify = await getWorksiteAlertsEnabled();

      setAutoTracking(auto);
      setAllowAlerts(notify);
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

        setSelectedWorksite(prev => (prev && sorted.some(w => w.id === prev.id) ? prev : null));
        setLoading(false);
      },
      err => {
        console.warn('ShiftSetup geofences listener', err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  return (
    <PizzaFireScreen>
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Shift</Text>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={PIZZA_FIRE.gold} />
        </View>
      ) : (
      <ScrollView style={styles.content}>
        <View style={styles.timerCard}>
          <Text style={styles.timerHeader}>Current Shift Status</Text>
          {proximity && (
            <View style={styles.proximityBadge}>
              {(() => {
                const distance = Math.round(proximity.distance);
                const configuredRadius = Math.round(proximity.configuredRadius);
                const effectiveRadius = Math.round(proximity.effectiveRadius);
                const isWithinConfigured = proximity.distance <= proximity.configuredRadius;
                const isInMonitoringBuffer = proximity.isInside && !isWithinConfigured;

                if (isInMonitoringBuffer) {
                  return (
                    <Text style={[styles.proximityText, styles.textBuffer]}>
                      You are near the {proximity.worksiteName} worksite ({distance}m). Core radius is{' '}
                      {configuredRadius}m; monitoring radius is {effectiveRadius}m.
                    </Text>
                  );
                }

                return (
                  <Text style={[styles.proximityText, proximity.isInside ? styles.textInside : styles.textOutside]}>
                    You are {proximity.isInside ? 'Inside' : 'Outside'} ({distance}m) the {proximity.worksiteName}{' '}
                    worksite.
                  </Text>
                );
              })()}
              {!proximity.isInside && (
                <TouchableOpacity onPress={openDirections} style={styles.directionsLink}>
                  <Text style={styles.directionsLinkText}>Would you like directions to the worksite?</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          <Text style={styles.timerLabel}>{shiftPaused ? 'Pause time:' : 'Worked time:'}</Text>
          <Text style={styles.timerValue}>
            {openShift ? formatWorkedDuration(shiftPaused ? pauseMs : workedMs) : '00:00:00'}
          </Text>
          <Text style={styles.timerStatus}>
            {openShift
              ? shiftPaused
                ? `Worked ${formatWorkedDuration(workedMs)} • ${openShift.geofenceName || 'worksite'}`
                : `Break ${formatWorkedDuration(breakMs)} • ${openShift.geofenceName || 'worksite'}`
              : 'Not on shift'}
          </Text>
          {offlineShift ? (
            <Text style={styles.pendingSyncText}>Shift changes pending sync</Text>
          ) : pendingCount > 0 ? (
            <Text style={styles.pendingSyncText}>{pendingCount} change(s) waiting to sync</Text>
          ) : null}
          <View style={styles.timerActions}>
            {!openShift ? (
              <TouchableOpacity style={styles.startBtn} onPress={() => void handleFirestoreStartShift()} disabled={shiftBusy}>
                {shiftBusy ? <ActivityIndicator color={PIZZA_FIRE.charcoal} /> : <Text style={styles.startBtnText}>Start Shift</Text>}
              </TouchableOpacity>
            ) : (
              <>
                {shiftPaused ? (
                  <TouchableOpacity style={styles.startBtn} onPress={() => void handleFirestoreResumeShift()} disabled={shiftBusy}>
                    {shiftBusy ? <ActivityIndicator color={PIZZA_FIRE.charcoal} /> : <Text style={styles.startBtnText}>Resume</Text>}
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.pauseBtn} onPress={() => void handleFirestorePauseShift()} disabled={shiftBusy}>
                    {shiftBusy ? <ActivityIndicator color={PIZZA_FIRE.textPrimary} /> : <Text style={styles.pauseBtnText}>Pause</Text>}
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.endBtn} onPress={handleFirestoreEndShift} disabled={shiftBusy}>
                  <Text style={styles.endBtnText}>End Shift</Text>
                </TouchableOpacity>
              </>
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
                if (v && !(await requestLocationForFeature(true))) return;
                await setAutoShiftEnabled(v);
                setAutoTracking(v);
              }}
              trackColor={{ false: PIZZA_FIRE.inputBg, true: PIZZA_FIRE.accent }}
              thumbColor={autoTracking ? '#F6EDE2' : '#A88E73'}
            />
          </View>
        </View>

        {showIntroMessage ? (
          <View style={styles.introSection}>
            <Text style={styles.introText}>
              This app is designed to help you keep track of your shifts. It can do this automatically,
              by detecting your location, or you can stop and start your shifts manually.
            </Text>
          </View>
        ) : null}

        <View style={styles.divider} />

        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={styles.label}>Worksite Alerts</Text>
            <Switch 
              value={allowAlerts} 
              onValueChange={async v => {
                if (v && !(await requestLocationForFeature(true))) return;
                await setWorksiteAlertsEnabled(v);
                setAllowAlerts(v);
              }}
              trackColor={{ false: PIZZA_FIRE.inputBg, true: PIZZA_FIRE.accent }}
            />
          </View>
          <Text style={styles.hint}>Receive notifications when arriving at or leaving a worksite.</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.section}>
          <Text style={styles.label}>Select Worksite</Text>
          <Text style={styles.hint}>Optional — choose a site, Driving, or start without one.</Text>
          <View style={styles.worksiteList}>
            {insideWorksite ? (
              <TouchableOpacity
                onPress={() => void selectWorksite(insideWorksite)}
                style={[styles.worksitePill, displayedWorksite?.id === insideWorksite.id && styles.worksitePillSelected]}
              >
                <Text style={[styles.worksiteText, displayedWorksite?.id === insideWorksite.id && styles.worksiteTextSelected]}>
                  📍 {insideWorksite.name} · Inside geofence
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() => void selectWorksite(null, 'driving')}
              style={[styles.worksitePill, displayedWorkCategory === 'driving' && styles.worksitePillSelected]}
            >
              <Text style={[styles.worksiteText, displayedWorkCategory === 'driving' && styles.worksiteTextSelected]}>
                Driving
              </Text>
            </TouchableOpacity>
            {otherActiveWorksites.map(ws => (
              <TouchableOpacity 
                key={ws.id} 
                onPress={() => void selectWorksite(ws)}
                style={[
                  styles.worksitePill,
                  displayedWorksite?.id === ws.id && styles.worksitePillSelected
                ]}
              >
                <Text style={[
                  styles.worksiteText,
                  displayedWorksite?.id === ws.id && styles.worksiteTextSelected
                ]}>
                  {ws.name}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={() => void selectWorksite(null)}
              style={[styles.worksitePill, !displayedWorksite && !displayedWorkCategory && styles.worksitePillSelected]}
            >
              <Text style={[styles.worksiteText, !displayedWorksite && !displayedWorkCategory && styles.worksiteTextSelected]}>
                No worksite
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
      )}
      <DaySummaryModal
        visible={daySummaryOpen}
        userId={userId}
        activeShift={openShift}
        onCancel={() => setDaySummaryOpen(false)}
        onConfirmed={async result => {
          setDaySummaryOpen(false);
          setLocalStartAt(null);
          await refreshOfflineShift();
          if (result.queued) {
            Alert.alert('Saved offline', 'Shift end will sync when you are back online.');
          }
        }}
      />
    </View>
    </PizzaFireScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
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
    borderBottomColor: PIZZA_FIRE.divider,
  },
  backButton: {
    padding: 8,
    marginRight: 10,
  },
  backText: {
    color: PIZZA_FIRE.gold,
    fontSize: 16,
    fontWeight: '600',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: PIZZA_FIRE.textPrimary,
  },
  introSection: {
    backgroundColor: PIZZA_FIRE.inputBg,
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.accent,
  },
  introText: {
    color: PIZZA_FIRE.textPrimary,
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
    color: PIZZA_FIRE.textPrimary,
  },
  hint: {
    fontSize: 14,
    color: PIZZA_FIRE.textSecondary,
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: PIZZA_FIRE.inputBg,
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
    backgroundColor: PIZZA_FIRE.inputBg,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  worksitePillSelected: {
    backgroundColor: PIZZA_FIRE.accent,
    borderColor: '#F3E6D3',
  },
  worksiteText: {
    color: PIZZA_FIRE.textPrimary,
    fontWeight: '600',
  },
  worksiteTextSelected: {
    color: PIZZA_FIRE.charcoal,
    fontWeight: '700',
  },
  statusWindow: {
    backgroundColor: PIZZA_FIRE.surface,
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
    backgroundColor: PIZZA_FIRE.surfaceInset,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    marginBottom: 12,
  },
  timerText: {
    fontSize: 42,
    fontWeight: '900',
    color: PIZZA_FIRE.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  statusSub: {
    fontSize: 14,
    color: PIZZA_FIRE.textSecondary,
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
  timerCard: {
    padding: 24,
    borderRadius: 20,
    backgroundColor: PIZZA_FIRE.surfaceInset,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PIZZA_FIRE.accent,
    marginBottom: 20,
  },
  timerHeader: {
    color: PIZZA_FIRE.accent,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 12,
    letterSpacing: 1,
  },
  proximityBadge: {
    backgroundColor: PIZZA_FIRE.surfaceInset,
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  proximityText: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  textInside: { color: '#4CAF50' },
  textBuffer: { color: PIZZA_FIRE.gold },
  textOutside: { color: '#F44336' },
  directionsLink: { marginTop: 8 },
  directionsLinkText: { color: PIZZA_FIRE.accent, fontSize: 12, textDecorationLine: 'underline', fontWeight: 'bold' },
  timerLabel: { color: PIZZA_FIRE.textMuted, fontSize: 12, marginBottom: 8 },
  timerValue: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 42,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  timerStatus: { color: PIZZA_FIRE.textMuted, fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  pendingSyncText: { color: '#C98B2E', fontSize: 12, marginTop: 6, fontWeight: '600' },
  timerActions: { marginTop: 24, width: '100%', flexDirection: 'row', gap: 10 },
  startBtn: {
    flex: 1,
    backgroundColor: PIZZA_FIRE.hotAccent,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PIZZA_FIRE.hotAccentBorder,
  },
  startBtnText: { color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '800', textTransform: 'uppercase' },
  pauseBtn: {
    flex: 1,
    backgroundColor: PIZZA_FIRE.qlFill,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
  },
  pauseBtnText: { color: PIZZA_FIRE.textSecondary, fontSize: 16, fontWeight: '800', textTransform: 'uppercase' },
  endBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 69, 58, 0.12)',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.28)',
  },
  endBtnText: { color: '#FF8A80', fontSize: 16, fontWeight: '800', textTransform: 'uppercase' },
  autoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: PIZZA_FIRE.divider,
    width: '100%',
  },
  autoLabel: { color: PIZZA_FIRE.textPrimary, fontWeight: 'bold' },
  autoDesc: { color: PIZZA_FIRE.textMuted, fontSize: 12, marginTop: 2 },
});
