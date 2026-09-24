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
import {
  calcBreakMs,
  calcCurrentPauseMs,
  calcWorkedMs,
  calcWorkedMsInRange,
  formatShiftDuration,
  getTimestampMs,
  isShiftPaused,
  pauseLiveShift,
  resumeLiveShift,
  shiftOverlapsRange,
  startLiveShift,
  type LiveShift,
} from '../services/shifts';
import DaySummaryModal from '../components/DaySummaryModal';
import HoursChangeBadge from '../components/HoursChangeBadge';
import { hoursChangeKind } from '../utils/workingHours';
import {
  collection,
  getFirestore,
  limit,
  onSnapshot,
  query,
  where,
} from '@react-native-firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { auth } from '../services/firebase';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { setPromptActionStatus, loadCachedGeofences } from '../geofencing/storage';
import type { GeofencePromptPayload } from '../geofencing/types';
import Geolocation from 'react-native-geolocation-service';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import PizzaFireScreen from '../components/PizzaFireScreen';
import PizzaFireCalendar from '../components/PizzaFireCalendar';

type Props = NativeStackScreenProps<RootStackParamList, 'MySchedule'>;

type ShiftRecord = LiveShift;

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

const formatTime = (value: Date) => value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const formatDate = (value: Date) => value.toLocaleDateString([], { month: 'short', day: 'numeric' });

const localDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

type CompletedShiftEntry = {
  shift: ShiftRecord;
  workedMs: number;
  start: Date;
  end: Date;
};

type CompletedShiftGroup = {
  key: string;
  locationName: string;
  totalWorkedMs: number;
  shifts: CompletedShiftEntry[];
};

const buildCompletedShiftGroups = (shifts: ShiftRecord[]): CompletedShiftGroup[] => {
  const groups = new Map<string, CompletedShiftGroup>();

  shifts.forEach(shift => {
    if (shift.status !== 'closed' || !shift.startAt || !shift.endAt) return;

    const start = new Date(getTimestampMs(shift.startAt));
    const end = new Date(getTimestampMs(shift.endAt));
    const locationName = shift.workCategory === 'driving'
      ? 'Driving'
      : shift.geofenceName || shift.worksiteName || 'No Worksite';
    const key = locationName;
    const entry: CompletedShiftEntry = {
      shift,
      workedMs: calcWorkedMs(shift, end.getTime()),
      start,
      end,
    };

    const existing = groups.get(key);
    if (existing) {
      existing.totalWorkedMs += entry.workedMs;
      existing.shifts.push(entry);
      return;
    }

    groups.set(key, {
      key,
      locationName,
      totalWorkedMs: entry.workedMs,
      shifts: [entry],
    });
  });

  return Array.from(groups.values())
    .map(group => ({
      ...group,
      shifts: group.shifts.sort((a, b) => b.start.getTime() - a.start.getTime()),
    }))
    .sort((a, b) => {
      const aLatest = Math.max(...a.shifts.map(entry => entry.start.getTime()));
      const bLatest = Math.max(...b.shifts.map(entry => entry.start.getTime()));
      return bLatest - aLatest;
    })
    .slice(0, 20);
};

export default function MyScheduleScreen({ navigation, route }: Props) {
  const initialView = route.params?.initialView === 'calendar' ? 'calendar' : 'list';
  const initialDateParam = route.params?.initialDate;
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>(initialView);
  const [historyShifts, setHistoryShifts] = useState<ShiftRecord[]>([]);
  const [upcomingShifts, setUpcomingShifts] = useState<ScheduledShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [selectedDate, setSelectedDate] = useState(
    initialDateParam || new Date().toISOString().split('T')[0]
  );
  const [auditStart, setAuditStart] = useState(new Date().toISOString().split('T')[0]);
  const [auditEnd, setAuditEnd] = useState(new Date().toISOString().split('T')[0]);
  const [auditResultMs, setAuditResultMs] = useState<number | null>(null);
  const [shiftNowMs, setShiftNowMs] = useState(Date.now());
  const [shiftBusy, setShiftBusy] = useState(false);
  const [daySummaryOpen, setDaySummaryOpen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<GeofencePromptPayload | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [expandedCompletedGroups, setExpandedCompletedGroups] = useState<Record<string, boolean>>({});

  const userId = auth.currentUser?.uid || null;

  const openShift = useMemo(
    () => historyShifts.find(s => s.status === 'open' && !s.isScheduled) || null,
    [historyShifts]
  );

  const liveShifts = useMemo(
    () => historyShifts.filter(s => !s.isScheduled && (s.status === 'open' || s.status === 'closed')),
    [historyShifts]
  );

  useEffect(() => {
    const timer = setInterval(() => setShiftNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const openShiftWorkedMs = useMemo(
    () => (openShift ? calcWorkedMs(openShift, shiftNowMs) : 0),
    [openShift, shiftNowMs]
  );

  const openShiftBreakMs = useMemo(
    () => (openShift ? calcBreakMs(openShift, shiftNowMs) : 0),
    [openShift, shiftNowMs]
  );

  const openShiftPauseMs = useMemo(
    () => (openShift ? calcCurrentPauseMs(openShift, shiftNowMs) : 0),
    [openShift, shiftNowMs]
  );

  const shiftPaused = openShift ? isShiftPaused(openShift) : false;

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
        const items = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as ShiftRecord))
          .filter(s => !s.isScheduled);
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
    if (!userId || openShift || shiftBusy) return;
    let gId = prompt?.geofenceId || null;
    let gName = prompt?.geofenceName || null;

    if (!prompt) {
      try {
        const cached = await loadCachedGeofences();
        const pos = await new Promise<Geolocation.GeoPosition | null>(resolve =>
          Geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 5000 })
        );
        if (pos && cached.length > 0) {
          const current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          const sorted = cached
            .filter(g => g.active)
            .map(g => ({ ...g, dist: getDistance(current, g.center) }))
            .sort((a, b) => a.dist - b.dist);
          if (sorted[0] && sorted[0].dist < 300) {
            gId = sorted[0].id;
            gName = sorted[0].name;
          }
        }
      } catch {
        /* ignore */
      }
    }

    setShiftBusy(true);
    try {
      await startLiveShift({
        userId,
        geofenceId: gId,
        geofenceName: gName,
        startedBy: prompt ? 'geofence-prompt' : 'manual',
      });
    } catch (err: any) {
      Alert.alert('Notice', err?.message || 'Could not start shift.');
    } finally {
      setShiftBusy(false);
    }
  };

  const handlePauseShift = async () => {
    if (!openShift || shiftBusy) return;
    setShiftBusy(true);
    try {
      await pauseLiveShift(openShift.id);
    } catch (err: any) {
      Alert.alert('Notice', err?.message || 'Could not pause shift.');
    } finally {
      setShiftBusy(false);
    }
  };

  const handleResumeShift = async () => {
    if (!openShift || shiftBusy) return;
    setShiftBusy(true);
    try {
      await resumeLiveShift(openShift.id);
    } catch (err: any) {
      Alert.alert('Notice', err?.message || 'Could not resume shift.');
    } finally {
      setShiftBusy(false);
    }
  };

  const handleEndShift = () => {
    if (!userId || !openShift || shiftBusy) return;
    setDaySummaryOpen(true);
  };

  const upcomingForSelectedDate = useMemo(() => 
    upcomingShifts.filter(s => s.date === selectedDate), 
    [upcomingShifts, selectedDate]
  );

  const calendarMarkedDates = useMemo(() => {
    const acc: Record<string, any> = {
      [selectedDate]: {
        selected: true,
        selectedColor: PIZZA_FIRE.accent,
        selectedTextColor: PIZZA_FIRE.charcoal,
      },
    };
    upcomingShifts.forEach(s => {
      if (!acc[s.date]) {
        acc[s.date] = {
          customStyles: {
            container: { backgroundColor: 'rgba(201, 120, 43, 0.25)', borderRadius: 8 },
            text: { color: PIZZA_FIRE.textPrimary, fontWeight: 'bold' },
          },
        };
      }
      if (s.date === selectedDate) {
        acc[s.date].selected = true;
        acc[s.date].selectedColor = PIZZA_FIRE.accent;
        acc[s.date].selectedTextColor = PIZZA_FIRE.charcoal;
        if (acc[s.date].customStyles) {
          acc[s.date].customStyles.text.color = PIZZA_FIRE.charcoal;
        }
      }
    });
    return acc;
  }, [upcomingShifts, selectedDate]);

  const upcomingFutureShifts = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return upcomingShifts.filter(s => s.date >= today);
  }, [upcomingShifts]);

  const completedShiftGroups = useMemo(
    () => buildCompletedShiftGroups(liveShifts),
    [liveShifts]
  );

  const toggleCompletedGroup = (groupKey: string) => {
    setExpandedCompletedGroups(current => ({
      ...current,
      [groupKey]: !current[groupKey],
    }));
  };

  useEffect(() => {
    if (route.params?.initialView) {
      setViewMode(route.params.initialView);
    }
  }, [route.params?.initialView]);

  useEffect(() => {
    if (route.params?.initialDate) {
      setSelectedDate(route.params.initialDate);
    }
  }, [route.params?.initialDate]);

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

    const rangeStartMs = start.getTime();
    const rangeEndMs = end.getTime();
    let totalMs = 0;
    liveShifts.forEach(s => {
      if (s.status !== 'closed') return;

      const sEndMs = getTimestampMs(s.endAt);
      if (!sEndMs) return;
      if (!shiftOverlapsRange(s, rangeStartMs, rangeEndMs, sEndMs)) return;

      totalMs += calcWorkedMsInRange(s, rangeStartMs, rangeEndMs, sEndMs);
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
    <PizzaFireScreen>
    <View style={styles.safe}>
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
          <ActivityIndicator size="large" color={PIZZA_FIRE.accent} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
        >
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

          {openShift ? (
            <View style={styles.timerCard}>
              <Text style={styles.timerHeader}>{shiftPaused ? 'Shift paused' : 'Shift active'}</Text>
              <Text style={styles.timerLabel}>{shiftPaused ? 'Pause time' : 'Worked time'}</Text>
              <Text style={styles.timerValue}>
                {formatShiftDuration(shiftPaused ? openShiftPauseMs : openShiftWorkedMs)}
              </Text>
              <Text style={styles.timerStatus}>
                {shiftPaused
                  ? `Worked ${formatShiftDuration(openShiftWorkedMs)} • ${openShift.geofenceName || 'Worksite'}`
                  : `Break ${formatShiftDuration(openShiftBreakMs)} • ${openShift.geofenceName || 'Worksite'}`}
              </Text>
              <View style={styles.timerActions}>
                {shiftPaused ? (
                  <TouchableOpacity style={styles.startBtn} onPress={() => void handleResumeShift()} disabled={shiftBusy}>
                    {shiftBusy ? <ActivityIndicator color={PIZZA_FIRE.charcoal} /> : <Text style={styles.startBtnText}>Resume</Text>}
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.pauseBtn} onPress={() => void handlePauseShift()} disabled={shiftBusy}>
                    {shiftBusy ? <ActivityIndicator color={PIZZA_FIRE.textPrimary} /> : <Text style={styles.pauseBtnText}>Pause</Text>}
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.endBtn} onPress={handleEndShift} disabled={shiftBusy}>
                  <Text style={styles.endBtnText}>End shift</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.timerCard}>
              <Text style={styles.timerHeader}>No active shift</Text>
              <Text style={styles.timerStatus}>Start when you begin work at site.</Text>
              <View style={styles.timerActions}>
                <TouchableOpacity style={styles.startBtn} onPress={() => void handleStartShift()} disabled={shiftBusy}>
                  {shiftBusy ? <ActivityIndicator color={PIZZA_FIRE.charcoal} /> : <Text style={styles.startBtnText}>Start shift</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {viewMode === 'calendar' ? (
            <>
              <View style={styles.calendarCard} collapsable={false}>
                <PizzaFireCalendar
                  initialDate={selectedDate}
                  firstDay={1}
                  theme={{
                    backgroundColor: PIZZA_FIRE.surfaceInset,
                    calendarBackground: 'transparent',
                    textSectionTitleColor: '#A88E73',
                    selectedDayBackgroundColor: PIZZA_FIRE.accent,
                    selectedDayTextColor: PIZZA_FIRE.charcoal,
                    todayTextColor: PIZZA_FIRE.accent,
                    dayTextColor: '#F6EDE2',
                    textDisabledColor: '#3A2D24',
                    monthTextColor: '#F6EDE2',
                    indicatorColor: PIZZA_FIRE.accent,
                    arrowColor: PIZZA_FIRE.accent,
                  }}
                  markedDates={calendarMarkedDates}
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
                      <Text style={{ color: PIZZA_FIRE.accent }}>
                        {Math.floor(auditResultMs / 3600000)}h {Math.floor((auditResultMs % 3600000) / 60000)}m
                      </Text>
                    </Text>
                  </View>
                )}
              </View>

              {/* Upcoming Shifts */}
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Upcoming Shifts</Text>
              </View>
              <View style={styles.historyList}>
                {upcomingFutureShifts.length === 0 ? (
                  <Text style={styles.empty}>No upcoming shifts scheduled.</Text>
                ) : (
                  upcomingFutureShifts.slice(0, 10).map(s => (
                    <View key={s.id} style={styles.historyItem}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.historyName}>{s.worksiteName || 'Worksite'}</Text>
                        <Text style={styles.historyTime}>
                          {s.date} • {s.startTime} - {s.endTime}
                        </Text>
                      </View>
                      <Text style={styles.historyDuration}>Upcoming</Text>
                    </View>
                  ))
                )}
              </View>

              {/* Completed History */}
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Completed Shifts</Text>
              </View>
              <View style={styles.historyList}>
                {completedShiftGroups.length === 0 ? (
                  <Text style={styles.empty}>No completed shifts yet.</Text>
                ) : (
                  completedShiftGroups.map(group => {
                    const expanded = !!expandedCompletedGroups[group.key];
                    const shiftLabel = `${group.shifts.length} ${group.shifts.length === 1 ? 'shift' : 'shifts'}`;

                    return (
                      <View key={group.key} style={styles.historyGroupWrap}>
                        <TouchableOpacity
                          style={styles.historyItem}
                          onPress={() => toggleCompletedGroup(group.key)}
                          activeOpacity={0.75}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.historyName}>{group.locationName}</Text>
                            <Text style={styles.historyTime}>{shiftLabel}</Text>
                          </View>
                          <View style={styles.historyRight}>
                            <Text style={styles.historyDuration}>
                              {formatShiftDuration(group.totalWorkedMs)}
                            </Text>
                            <Text style={styles.historyExpandHint}>{expanded ? '−' : '+'}</Text>
                          </View>
                        </TouchableOpacity>
                        {expanded
                          ? group.shifts.map(entry => {
                              const kind = hoursChangeKind(entry.shift);
                              return (
                              <View key={entry.shift.id} style={styles.historySubItem}>
                                <View style={{ flex: 1 }}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    <Text style={styles.historySubTime}>
                                      {formatDate(entry.start)} • {formatTime(entry.start)} - {formatTime(entry.end)}
                                    </Text>
                                    <HoursChangeBadge added={kind === 'added'} edited={kind === 'edited'} />
                                  </View>
                                </View>
                                <Text style={styles.historySubDuration}>
                                  {formatShiftDuration(entry.workedMs)}
                                </Text>
                              </View>
                              );
                            })
                          : null}
                      </View>
                    );
                  })
                )}
              </View>
            </>
          )}
        </ScrollView>
      )}

      <DaySummaryModal
        visible={daySummaryOpen}
        userId={userId}
        activeShift={openShift}
        onCancel={() => setDaySummaryOpen(false)}
        onConfirmed={() => {
          setDaySummaryOpen(false);
        }}
      />

      <Modal visible={pickerVisible} transparent animationType="slide">
        <View style={styles.pickerModalBg}>
          <View style={styles.pickerCard}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select {pickerTarget === 'start' ? 'Start' : 'End'} Date</Text>
              <TouchableOpacity onPress={() => setPickerVisible(false)}>
                <Text style={styles.pickerClose}>Cancel</Text>
              </TouchableOpacity>
            </View>
            <PizzaFireCalendar
              current={pickerTarget === 'start' ? auditStart : auditEnd}
              onDayPress={handleDateSelect}
              theme={{
                backgroundColor: PIZZA_FIRE.surfaceInset,
                calendarBackground: 'transparent',
                textSectionTitleColor: '#A88E73',
                selectedDayBackgroundColor: PIZZA_FIRE.accent,
                selectedDayTextColor: PIZZA_FIRE.charcoal,
                todayTextColor: PIZZA_FIRE.accent,
                dayTextColor: '#F6EDE2',
                textDisabledColor: '#3A2D24',
                monthTextColor: '#F6EDE2',
                indicatorColor: PIZZA_FIRE.accent,
                arrowColor: PIZZA_FIRE.accent,
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
    </PizzaFireScreen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, backgroundColor: 'transparent', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: PIZZA_FIRE.divider },
  back: { color: PIZZA_FIRE.gold, fontSize: 16, fontWeight: 'bold' },
  title: { color: PIZZA_FIRE.textPrimary, fontSize: 18, fontWeight: '800' },
  toggleBtn: { backgroundColor: PIZZA_FIRE.inputBg, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: PIZZA_FIRE.accent },
  toggleText: { color: PIZZA_FIRE.accent, fontSize: 12, fontWeight: 'bold' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  calendarCard: { margin: 16, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder, backgroundColor: PIZZA_FIRE.surfaceInset },
  innerCalendar: { borderBottomWidth: 1, borderBottomColor: PIZZA_FIRE.divider },
  sectionHeader: { marginHorizontal: 16, marginTop: 16, marginBottom: 8 },
  sectionTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '700' },
  upcomingList: { marginHorizontal: 16, gap: 10 },
  upcomingItem: { backgroundColor: PIZZA_FIRE.surface, padding: 16, borderRadius: 12, borderLeftWidth: 4, borderLeftColor: PIZZA_FIRE.accent },
  upcomingWorksite: { color: PIZZA_FIRE.textPrimary, fontWeight: 'bold', fontSize: 16 },
  upcomingTime: { color: PIZZA_FIRE.textMuted, fontSize: 13, marginTop: 4 },
  timerCard: { margin: 16, padding: 24, borderRadius: 20, backgroundColor: PIZZA_FIRE.surface, alignItems: 'center', borderWidth: 1, borderColor: PIZZA_FIRE.accent },
  timerHeader: { color: PIZZA_FIRE.accent, fontSize: 13, fontWeight: '800', textTransform: 'uppercase', marginBottom: 12, letterSpacing: 1 },
  proximityBadge: { backgroundColor: PIZZA_FIRE.surfaceInset, padding: 12, borderRadius: 12, marginBottom: 16, width: '100%', alignItems: 'center', borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder },
  proximityText: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  textInside: { color: '#4CAF50' },
  textOutside: { color: '#F44336' },
  directionsLink: { marginTop: 8 },
  directionsLinkText: { color: PIZZA_FIRE.accent, fontSize: 12, textDecorationLine: 'underline', fontWeight: 'bold' },
  timerLabel: { color: PIZZA_FIRE.textMuted, fontSize: 12, marginBottom: 8 },
  timerValue: { color: PIZZA_FIRE.textPrimary, fontSize: 42, fontWeight: '900', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  timerStatus: { color: PIZZA_FIRE.textMuted, fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  timerActions: { marginTop: 24, width: '100%', flexDirection: 'row', gap: 10 },
  pauseBtn: { flex: 1, backgroundColor: '#5A4739', paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: PIZZA_FIRE.accent },
  pauseBtnText: { color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '900', textTransform: 'uppercase' },
  startBtn: { flex: 1, backgroundColor: PIZZA_FIRE.accent, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  startBtnText: { color: PIZZA_FIRE.charcoal, fontSize: 18, fontWeight: '900', textTransform: 'uppercase' },
  endBtn: { flex: 1, backgroundColor: '#5C2420', paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#9E3C2E' },
  endBtnText: { color: PIZZA_FIRE.textPrimary, fontSize: 18, fontWeight: '900', textTransform: 'uppercase' },
  auditCard: { margin: 16, padding: 20, backgroundColor: PIZZA_FIRE.surface, borderRadius: 16, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder },
  auditTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 16 },
  auditRow: { flexDirection: 'row', marginBottom: 16 },
  auditLabel: { color: PIZZA_FIRE.textMuted, fontSize: 12, marginBottom: 8, textTransform: 'uppercase', fontWeight: 'bold' },
  auditInput: { backgroundColor: PIZZA_FIRE.inputBg, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder, height: 48, justifyContent: 'center' },
  auditInputText: { color: PIZZA_FIRE.textPrimary, fontSize: 14 },
  auditBtn: { backgroundColor: PIZZA_FIRE.inputBg, paddingVertical: 12, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: PIZZA_FIRE.accent },
  auditBtnText: { color: PIZZA_FIRE.accent, fontWeight: 'bold', fontSize: 14 },
  auditResult: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: PIZZA_FIRE.divider, alignItems: 'center' },
  auditResultText: { color: PIZZA_FIRE.textPrimary, fontSize: 18, fontWeight: '900' },
  settingsCard: { marginHorizontal: 16, padding: 16, borderRadius: 16, backgroundColor: PIZZA_FIRE.surface, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder },
  settingsRow: { flexDirection: 'row', alignItems: 'center' },
  settingsLabel: { color: PIZZA_FIRE.textPrimary, fontWeight: 'bold' },
  settingsDesc: { color: PIZZA_FIRE.textMuted, fontSize: 12, marginTop: 2 },
  historyList: { marginHorizontal: 16, gap: 10 },
  historyGroupWrap: { gap: 6 },
  historyItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: PIZZA_FIRE.surface, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder },
  historyRight: { alignItems: 'flex-end', gap: 4 },
  historyExpandHint: { color: PIZZA_FIRE.textMuted, fontSize: 16, fontWeight: '700', lineHeight: 16 },
  historySubItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginLeft: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: PIZZA_FIRE.crustDark,
    borderWidth: 1,
    borderColor: '#2E241D',
  },
  historySubTime: { color: PIZZA_FIRE.textMuted, fontSize: 12 },
  historySubDuration: { color: '#D89A79', fontWeight: '700', fontSize: 12 },
  historyName: { color: PIZZA_FIRE.textPrimary, fontWeight: '600' },
  historyTime: { color: PIZZA_FIRE.textMuted, fontSize: 11, marginTop: 2 },
  historyDuration: { color: PIZZA_FIRE.accent, fontWeight: 'bold', fontSize: 13 },
  empty: { color: PIZZA_FIRE.textMuted, textAlign: 'center', marginTop: 20, fontSize: 13 },
  errorWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { color: '#9E3C2E', textAlign: 'center', fontSize: 14, marginBottom: 16 },
  retryBtn: { backgroundColor: PIZZA_FIRE.inputBg, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: PIZZA_FIRE.accent },
  retryBtnText: { color: PIZZA_FIRE.accent, fontWeight: '800' },
  pickerModalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  pickerCard: { backgroundColor: PIZZA_FIRE.bgMid, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  pickerTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '700' },
  pickerClose: { color: PIZZA_FIRE.accent, fontWeight: '700' },
  promptCard: { margin: 16, padding: 16, borderRadius: 16, backgroundColor: PIZZA_FIRE.inputBg, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder },
  promptTitle: { fontSize: 18, fontWeight: '700', color: PIZZA_FIRE.textPrimary },
  promptHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { backgroundColor: PIZZA_FIRE.accent, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeText: { color: PIZZA_FIRE.charcoal, fontSize: 12, fontWeight: 'bold' },
  promptText: { marginTop: 8, color: PIZZA_FIRE.textSecondary, lineHeight: 22, fontSize: 15 },
  promptActions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  promptBtn: { flex: 1, backgroundColor: PIZZA_FIRE.accent, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  promptBtnText: { color: PIZZA_FIRE.charcoal, fontWeight: '700' },
  promptBtnGhost: { backgroundColor: PIZZA_FIRE.surfaceInset, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder },
  promptBtnGhostText: { color: PIZZA_FIRE.textSecondary, fontWeight: '600' },
});
