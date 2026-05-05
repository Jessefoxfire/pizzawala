import React, { useEffect, useMemo, useState } from 'react';
import { 
  ScrollView, 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ActivityIndicator, 
  Alert, 
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Calendar } from 'react-native-calendars';
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
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { auth } from '../services/firebase';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { setPromptActionStatus, loadCachedGeofences } from '../geofencing/storage';
import type { GeofencePromptPayload } from '../geofencing/types';
import Geolocation from 'react-native-geolocation-service';

type Props = NativeStackScreenProps<RootStackParamList, 'MySchedule'>;

type ShiftRecord = {
  id: string;
  userId: string;
  geofenceId?: string;
  geofenceName?: string;
  status: 'open' | 'closed';
  startAt?: any;
  endAt?: any;
};

type ScheduledShift = {
  id: string;
  userId: string;
  userName: string;
  worksiteName: string;
  date: string;
  startTime: string;
  endTime: string;
};

const toRadians = (v: number) => (v * Math.PI) / 180;
const getDistance = (p1: {lat:number, lng:number}, p2: {lat:number, lng:number}) => {
  const R = 6371000;
  const dLat = toRadians(p2.lat - p1.lat);
  const dLng = toRadians(p2.lng - p1.lng);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRadians(p1.lat)) * Math.cos(toRadians(p2.lat)) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

const formatDuration = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
};

const formatTime = (value: Date) => value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const formatDate = (value: Date) => value.toLocaleDateString([], { month: 'short', day: 'numeric' });

export default function MyScheduleScreen({ navigation, route }: Props) {
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('list');
  const [historyShifts, setHistoryShifts] = useState<ShiftRecord[]>([]);
  const [upcomingShifts, setUpcomingShifts] = useState<ScheduledShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [auditStart, setAuditStart] = useState(new Date().toISOString().split('T')[0]);
  const [auditEnd, setAuditEnd] = useState(new Date().toISOString().split('T')[0]);
  const [auditResultMs, setAuditResultMs] = useState<number | null>(null);
  
  // Prompt state (migrated from ShiftScreen)
  const [pendingPrompt, setPendingPrompt] = useState<GeofencePromptPayload | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  const userId = auth.currentUser?.uid || null;

  const openShift = useMemo(() => historyShifts.find(s => s.status === 'open') || null, [historyShifts]);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    const fs = getFirestore();
    setLoadError(null);

    // 1. History & Live Shift
    const historyQuery = query(collection(fs, 'shifts'), where('userId', '==', userId), limit(50));
    const unsubHistory = onSnapshot(
      historyQuery,
      snap => {
        if (!snap || !snap.docs) {
          setHistoryShifts([]);
          setLoading(false);
          return;
        }
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as ShiftRecord));
        items.sort((a, b) => {
          const getTs = (s: any) => {
            if (!s?.startAt) return 0;
            if (typeof s.startAt.toDate === 'function') return s.startAt.toDate().getTime();
            const d = new Date(s.startAt);
            return isNaN(d.getTime()) ? 0 : d.getTime();
          };
          return getTs(b) - getTs(a);
        });
        setHistoryShifts(items);
        setLoading(false);
      },
      err => {
        setLoadError(err?.message || String(err));
        setLoading(false);
      }
    );

    // 2. Upcoming Schedule
    const upcomingQuery = query(
      collection(fs, 'shifts'),
      where('userId', '==', userId),
      where('isScheduled', '==', true)
    );
    const unsubUpcoming = onSnapshot(
      upcomingQuery,
      snap => {
        if (!snap || !snap.docs || snap.empty) {
          setUpcomingShifts([]);
          return;
        }
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as ScheduledShift));
        items.sort((a, b) => a.date.localeCompare(b.date));
        setUpcomingShifts(items);
      },
      () => {
        setUpcomingShifts([]);
      }
    );

    return () => {
      unsubHistory();
      unsubUpcoming();
    };
  }, [userId, retryToken]);

  const handleStartShift = async (prompt?: GeofencePromptPayload | null) => {
    if (!userId || openShift) return;
    let gId = prompt?.geofenceId || null;
    let gName = prompt?.geofenceName || null;

    if (!prompt) {
      try {
        const cached = await loadCachedGeofences();
        const pos = await new Promise<Geolocation.GeoPosition | null>(resolve => Geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 5000 }));
        if (pos && cached.length > 0) {
          const current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          const sorted = cached.filter(g => g.active).map(g => ({ ...g, dist: getDistance(current, g.center) })).sort((a, b) => a.dist - b.dist);
          if (sorted[0] && sorted[0].dist < 300) {
            gId = sorted[0].id;
            gName = sorted[0].name;
          }
        }
      } catch {
        /* ignore */
      }
    }

    try {
      const fs = getFirestore();
      const userDoc = await getDoc(doc(fs, 'users', userId));
      const teamId = userDoc.data()?.teamId || 'team-1';

      await addDoc(collection(fs, 'shifts'), { 
        userId, 
        teamId,
        geofenceId: gId, 
        geofenceName: gName, 
        status: 'open', 
        startAt: serverTimestamp(), 
        startedBy: prompt ? 'geofence-prompt' : 'manual' 
      });
    } catch (err: any) {
      Alert.alert('Notice', err.message);
    }
  };

  const handleEndShift = async () => {
    if (!userId || !openShift) return;
    try {
      const fs = getFirestore();
      await updateDoc(doc(fs, 'shifts', openShift.id), { status: 'closed', endAt: serverTimestamp(), endedBy: 'manual' });
    } catch (err: any) {
      Alert.alert('Notice', err.message);
    }
  };

  const upcomingForSelectedDate = useMemo(() => 
    upcomingShifts.filter(s => s.date === selectedDate), 
    [upcomingShifts, selectedDate]
  );

  useEffect(() => {
    const p = route.params?.prompt;
    if (p) {
      setPendingPrompt(p);
      const elapsed = (Date.now() - p.occurredAt) / 1000;
      const remaining = Math.max(0, Math.ceil(60 - elapsed));
      setCountdown(remaining);
      // Auto-switch to list view to show the prompt
      setViewMode('list');
    }
  }, [route.params?.prompt]);

  useEffect(() => {
    if (countdown === null || !pendingPrompt) return;
    if (countdown <= 0) {
      setPendingPrompt(null);
      setCountdown(null);
      return;
    }
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, pendingPrompt]);

  const handleConfirmPrompt = async () => {
    if (!pendingPrompt) return;
    await setPromptActionStatus(pendingPrompt.eventId, 'confirmed');
    if (pendingPrompt.transition === 'enter') {
      await handleStartShift(pendingPrompt);
    } else {
      await handleEndShift();
    }
    setPendingPrompt(null);
    setCountdown(null);
  };

  const handleVetoPrompt = async () => {
    if (!pendingPrompt) return;
    await setPromptActionStatus(pendingPrompt.eventId, 'vetoed');
    setPendingPrompt(null);
    setCountdown(null);
  };

  const calculateAudit = () => {
    const start = new Date(auditStart);
    const end = new Date(auditEnd);
    end.setHours(23, 59, 59, 999);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      Alert.alert('Invalid Date', 'Please use YYYY-MM-DD format.');
      return;
    }

    let totalMs = 0;
    historyShifts.forEach(s => {
      if (s.status !== 'closed' || !s.startAt || !s.endAt) return;
      
      const sStart = s.startAt?.toDate?.() || new Date(s.startAt);
      const sEnd = s.endAt?.toDate?.() || new Date(s.endAt);

      if (sStart >= start && sEnd <= end) {
        totalMs += (sEnd.getTime() - sStart.getTime());
      }
    });

    setAuditResultMs(totalMs);
  };

  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<'start' | 'end'>('start');

  const openPicker = (target: 'start' | 'end') => {
    setPickerTarget(target);
    setPickerVisible(true);
  };

  const handleDateSelect = (day: any) => {
    if (pickerTarget === 'start') {
      setAuditStart(day.dateString);
    } else {
      setAuditEnd(day.dateString);
    }
    setPickerVisible(false);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Home</Text>
        </TouchableOpacity>
        <Text style={styles.title}>My Schedule</Text>
        <TouchableOpacity 
          style={styles.toggleBtn} 
          onPress={() => setViewMode(viewMode === 'calendar' ? 'list' : 'calendar')}
        >
          <Text style={styles.toggleText}>{viewMode === 'calendar' ? 'Shift View' : 'Calendar View'}</Text>
        </TouchableOpacity>
      </View>

      {loadError ? (
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{loadError}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => {
              setLoadError(null);
              setLoading(true);
              setRetryToken(t => t + 1);
            }}
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#C9782B" />
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {pendingPrompt && (
            <View style={styles.promptCard}>
              <View style={styles.promptHeaderRow}>
                <Text style={styles.promptTitle}>
                  {pendingPrompt.transition === 'enter' ? 'Start shift?' : 'End shift?'}
                </Text>
                {countdown !== null && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{countdown}s</Text>
                  </View>
                )}
              </View>
              <Text style={styles.promptText}>
                {pendingPrompt.transition === 'enter'
                  ? `You arrived at ${pendingPrompt.geofenceName}. Start shift?`
                  : `You left ${pendingPrompt.geofenceName}. End shift?`}
              </Text>
              <View style={styles.promptActions}>
                <TouchableOpacity style={[styles.promptBtn, styles.promptBtnGhost]} onPress={handleVetoPrompt}>
                  <Text style={styles.promptBtnGhostText}>No</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.promptBtn} onPress={handleConfirmPrompt}>
                  <Text style={styles.promptBtnText}>Yes</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {viewMode === 'calendar' ? (
            <>
              <View style={styles.calendarCard}>
                <Calendar
                  firstDay={1}
                  theme={{
                    backgroundColor: '#1E1813',
                    calendarBackground: '#1E1813',
                    textSectionTitleColor: '#A88E73',
                    selectedDayBackgroundColor: '#C9782B',
                    selectedDayTextColor: '#1E1813',
                    todayTextColor: '#C9782B',
                    dayTextColor: '#F6EDE2',
                    textDisabledColor: '#3A2D24',
                    monthTextColor: '#F6EDE2',
                    indicatorColor: '#C9782B',
                    arrowColor: '#C9782B',
                  }}
                  markedDates={upcomingShifts.reduce((acc: any, s: any) => {
                    if (!acc[s.date]) {
                      acc[s.date] = { 
                        customStyles: {
                          container: { backgroundColor: 'rgba(201, 120, 43, 0.25)', borderRadius: 8 },
                          text: { color: '#F6EDE2', fontWeight: 'bold' }
                        }
                      };
                    }
                    if (s.date === selectedDate) {
                      acc[s.date].selected = true;
                      acc[s.date].selectedColor = '#C9782B';
                      acc[s.date].selectedTextColor = '#1E1813';
                      // Keep customStyles but override text for selected state if needed
                      if (acc[s.date].customStyles) {
                        acc[s.date].customStyles.text.color = '#1E1813';
                      }
                    }
                    return acc;
                  }, { [selectedDate]: { selected: true, selectedColor: '#C9782B', selectedTextColor: '#1E1813' } })}
                  markingType={'custom'}
                  onDayPress={day => setSelectedDate(day.dateString)}
                  style={styles.innerCalendar}
                />
              </View>

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Today's shifts</Text>
              </View>

              <View style={styles.upcomingList}>
                {upcomingForSelectedDate.length === 0 ? (
                  <Text style={styles.empty}>No shifts scheduled for this day.</Text>
                ) : (
                  upcomingForSelectedDate.map(s => (
                    <View key={s.id} style={styles.upcomingItem}>
                      <Text style={styles.upcomingWorksite}>{s.worksiteName}</Text>
                      <Text style={styles.upcomingTime}>{s.startTime} - {s.endTime}</Text>
                    </View>
                  ))
                )}
              </View>

              {/* All Upcoming Overview */}
              <View style={[styles.sectionHeader, { marginTop: 32 }]}>
                <Text style={styles.sectionTitle}>Next 7 Days</Text>
              </View>
              <View style={styles.upcomingList}>
                {upcomingShifts.filter(s => s.date >= new Date().toISOString().split('T')[0]).slice(0, 7).length === 0 ? (
                  <Text style={styles.empty}>No upcoming shifts scheduled.</Text>
                ) : (
                  upcomingShifts
                    .filter(s => s.date >= new Date().toISOString().split('T')[0])
                    .slice(0, 7)
                    .map(s => (
                      <View key={s.id} style={[styles.upcomingItem, { borderLeftColor: '#A88E73', backgroundColor: 'rgba(30, 24, 19, 0.5)' }]}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={styles.upcomingWorksite}>{s.worksiteName}</Text>
                          <Text style={[styles.upcomingTime, { marginTop: 0 }]}>{s.date.split('-').slice(1).join('/')}</Text>
                        </View>
                        <Text style={styles.upcomingTime}>{s.startTime} - {s.endTime}</Text>
                      </View>
                    ))
                )}
              </View>
            </>
          ) : (
            <>
              {/* Personal Audit */}
              <View style={styles.auditCard}>
                <Text style={styles.auditTitle}>Calculate total time worked</Text>
                <View style={styles.auditRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.auditLabel}>Start Date</Text>
                    <TouchableOpacity style={styles.auditInput} onPress={() => openPicker('start')}>
                      <Text style={styles.auditInputText}>{auditStart}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={{ width: 12 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.auditLabel}>End Date</Text>
                    <TouchableOpacity style={styles.auditInput} onPress={() => openPicker('end')}>
                      <Text style={styles.auditInputText}>{auditEnd}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <TouchableOpacity style={styles.auditBtn} onPress={calculateAudit}>
                  <Text style={styles.auditBtnText}>Calculate</Text>
                </TouchableOpacity>
                {auditResultMs !== null && (
                  <View style={styles.auditResult}>
                    <Text style={styles.auditResultText}>
                      Total time:{' '}
                      <Text style={{ color: '#C9782B' }}>
                        {Math.floor(auditResultMs / 3600000)}h {Math.floor((auditResultMs % 3600000) / 60000)}m
                      </Text>
                    </Text>
                  </View>
                )}
              </View>

              {/* History List */}
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Shift History</Text>
              </View>
              <View style={styles.historyList}>
                {historyShifts.filter(s => s.status === 'closed').slice(0, 10).map(s => {
                  const start = s.startAt?.toDate?.() || new Date(s.startAt);
                  const end = s.endAt?.toDate?.() || new Date(s.endAt);
                  return (
                    <View key={s.id} style={styles.historyItem}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.historyName}>{s.geofenceName || 'Worksite'}</Text>
                        <Text style={styles.historyTime}>{formatDate(start)} • {formatTime(start)} - {formatTime(end)}</Text>
                      </View>
                      <Text style={styles.historyDuration}>{formatDuration(end.getTime() - start.getTime())}</Text>
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </ScrollView>
      )}

      <Modal visible={pickerVisible} transparent animationType="slide">
        <View style={styles.pickerModalBg}>
          <View style={styles.pickerCard}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select {pickerTarget === 'start' ? 'Start' : 'End'} Date</Text>
              <TouchableOpacity onPress={() => setPickerVisible(false)}>
                <Text style={styles.pickerClose}>Cancel</Text>
              </TouchableOpacity>
            </View>
            <Calendar
              current={pickerTarget === 'start' ? auditStart : auditEnd}
              onDayPress={handleDateSelect}
              theme={{
                backgroundColor: '#1E1813',
                calendarBackground: '#1E1813',
                textSectionTitleColor: '#A88E73',
                selectedDayBackgroundColor: '#C9782B',
                selectedDayTextColor: '#1E1813',
                todayTextColor: '#C9782B',
                dayTextColor: '#F6EDE2',
                textDisabledColor: '#3A2D24',
                monthTextColor: '#F6EDE2',
                indicatorColor: '#C9782B',
                arrowColor: '#C9782B',
              }}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#2A211B' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, backgroundColor: '#1E1813', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#3A2D24' },
  back: { color: '#EBDCCB', fontSize: 16, fontWeight: 'bold' },
  title: { color: '#F6EDE2', fontSize: 18, fontWeight: '800' },
  toggleBtn: { backgroundColor: '#3A2D24', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#C9782B' },
  toggleText: { color: '#C9782B', fontSize: 12, fontWeight: 'bold' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  calendarCard: { margin: 16, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#3A2D24', backgroundColor: '#1E1813' },
  innerCalendar: { borderBottomWidth: 1, borderBottomColor: '#3A2D24' },
  sectionHeader: { marginHorizontal: 16, marginTop: 16, marginBottom: 8 },
  sectionTitle: { color: '#F6EDE2', fontSize: 16, fontWeight: '700' },
  upcomingList: { marginHorizontal: 16, gap: 10 },
  upcomingItem: { backgroundColor: '#1E1813', padding: 16, borderRadius: 12, borderLeftWidth: 4, borderLeftColor: '#C9782B' },
  upcomingWorksite: { color: '#F6EDE2', fontWeight: 'bold', fontSize: 16 },
  upcomingTime: { color: '#A88E73', fontSize: 13, marginTop: 4 },
  timerCard: { margin: 16, padding: 24, borderRadius: 20, backgroundColor: '#1E1813', alignItems: 'center', borderWidth: 1, borderColor: '#C9782B' },
  timerHeader: { color: '#C9782B', fontSize: 13, fontWeight: '800', textTransform: 'uppercase', marginBottom: 12, letterSpacing: 1 },
  proximityBadge: { backgroundColor: '#2A211B', padding: 12, borderRadius: 12, marginBottom: 16, width: '100%', alignItems: 'center', borderWidth: 1, borderColor: '#3A2D24' },
  proximityText: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  textInside: { color: '#4CAF50' },
  textOutside: { color: '#F44336' },
  directionsLink: { marginTop: 8 },
  directionsLinkText: { color: '#C9782B', fontSize: 12, textDecorationLine: 'underline', fontWeight: 'bold' },
  timerLabel: { color: '#A88E73', fontSize: 12, marginBottom: 8 },
  timerValue: { color: '#F6EDE2', fontSize: 42, fontWeight: '900', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  timerStatus: { color: '#A88E73', fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  timerActions: { marginTop: 24, width: '100%' },
  startBtn: { backgroundColor: '#C9782B', paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  startBtnText: { color: '#1E1813', fontSize: 18, fontWeight: '900', textTransform: 'uppercase' },
  endBtn: { backgroundColor: '#5C2420', paddingVertical: 16, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#9E3C2E' },
  endBtnText: { color: '#F6EDE2', fontSize: 18, fontWeight: '900', textTransform: 'uppercase' },
  auditCard: { margin: 16, padding: 20, backgroundColor: '#1E1813', borderRadius: 16, borderWidth: 1, borderColor: '#3A2D24' },
  auditTitle: { color: '#F6EDE2', fontSize: 16, fontWeight: '700', marginBottom: 16 },
  auditRow: { flexDirection: 'row', marginBottom: 16 },
  auditLabel: { color: '#A88E73', fontSize: 12, marginBottom: 8, textTransform: 'uppercase', fontWeight: 'bold' },
  auditInput: { backgroundColor: '#2A211B', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#3A2D24', height: 48, justifyContent: 'center' },
  auditInputText: { color: '#F6EDE2', fontSize: 14 },
  auditBtn: { backgroundColor: '#3A2D24', paddingVertical: 12, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#C9782B' },
  auditBtnText: { color: '#C9782B', fontWeight: 'bold', fontSize: 14 },
  auditResult: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#3A2D24', alignItems: 'center' },
  auditResultText: { color: '#F6EDE2', fontSize: 18, fontWeight: '900' },
  settingsCard: { marginHorizontal: 16, padding: 16, borderRadius: 16, backgroundColor: '#1E1813', borderWidth: 1, borderColor: '#3A2D24' },
  settingsRow: { flexDirection: 'row', alignItems: 'center' },
  settingsLabel: { color: '#F6EDE2', fontWeight: 'bold' },
  settingsDesc: { color: '#A88E73', fontSize: 12, marginTop: 2 },
  historyList: { marginHorizontal: 16, gap: 10 },
  historyItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1E1813', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#3A2D24' },
  historyName: { color: '#F6EDE2', fontWeight: '600' },
  historyTime: { color: '#A88E73', fontSize: 11, marginTop: 2 },
  historyDuration: { color: '#C9782B', fontWeight: 'bold', fontSize: 13 },
  empty: { color: '#A88E73', textAlign: 'center', marginTop: 20, fontSize: 13 },
  errorWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { color: '#9E3C2E', textAlign: 'center', fontSize: 14, marginBottom: 16 },
  retryBtn: { backgroundColor: '#3A2D24', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#C9782B' },
  retryBtnText: { color: '#C9782B', fontWeight: '800' },
  pickerModalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  pickerCard: { backgroundColor: '#1E1813', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, borderWidth: 1, borderColor: '#3A2D24' },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  pickerTitle: { color: '#F6EDE2', fontSize: 16, fontWeight: '700' },
  pickerClose: { color: '#C9782B', fontWeight: '700' },
  promptCard: { margin: 16, padding: 16, borderRadius: 16, backgroundColor: '#3A2D24', borderWidth: 1, borderColor: '#5A4739' },
  promptTitle: { fontSize: 18, fontWeight: '700', color: '#F6EDE2' },
  promptHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { backgroundColor: '#C9782B', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeText: { color: '#1E1813', fontSize: 12, fontWeight: 'bold' },
  promptText: { marginTop: 8, color: '#C8B29A', lineHeight: 22, fontSize: 15 },
  promptActions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  promptBtn: { flex: 1, backgroundColor: '#C9782B', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  promptBtnText: { color: '#1E1813', fontWeight: '700' },
  promptBtnGhost: { backgroundColor: '#2A211B', borderWidth: 1, borderColor: '#5A4739' },
  promptBtnGhostText: { color: '#EBDCCB', fontWeight: '600' },
});
