import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import PizzaFireCalendar from '../components/PizzaFireCalendar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  collection,
  getFirestore,
  onSnapshot,
  query,
  where,
  doc,
} from '@react-native-firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import EventDayTimeModal from '../components/EventDayTimeModal';
import HoursChangeBadge from '../components/HoursChangeBadge';
import DaySummaryModal from '../components/DaySummaryModal';
import PizzaFireBackground from '../components/PizzaFireBackground';
import { Icons } from '../components/Icons';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import { formatTimeRange } from '../utils/eventDays';
import { auth } from '../services/firebase';
import { useAuth } from '../auth/useAuth';
import { useOffline } from '../context/OfflineContext';
import { getOfflineOpenShift } from '../offline/outbox';
import { subscribeOutboxChanges } from '../offline/events';
import {
  cleanupStoredSubMinuteShiftsForUser,
  offlineOpenShiftToLiveShift,
  updateShiftPeriodTimes,
  isShiftPaused,
  pauseLiveShift,
  resumeLiveShift,
  type LiveShift,
} from '../services/shifts';
import { shareMonthlyTimesheetPdf } from '../services/monthlyTimesheetPdf';
import {
  applyTimeToIso,
  addDaysToDateKey,
  buildDayTimeEntries,
  buildHoursRolodexDateKeys,
  buildRecentDateKeys,
  hoursRolodexWindowStart,
  formatEntryDuration,
  formatEntryRange,
  formatOriginalEntryRange,
  formatScheduledTargetLabel,
  formatTabLabel,
  formatTotalHoursLabel,
  localDateKey,
  msToTimeValue,
  scheduledMsForDate,
  totalBreakMsForDay,
  totalWorkedMsForDay,
  type DayTimeEntry,
  type ScheduledShiftRow,
} from '../utils/workingHours';

type Props = NativeStackScreenProps<RootStackParamList, 'WorkingHours'>;

const CARD_STYLES = {
  work: {
    backgroundColor: 'rgba(255, 159, 28, 0.14)',
    borderColor: 'rgba(255, 159, 28, 0.32)',
    icon: '🕐',
    title: 'Working time',
  },
  workActive: {
    backgroundColor: 'rgba(255, 87, 34, 0.22)',
    borderColor: PIZZA_FIRE.gold,
    icon: '🕐',
    title: 'Working time',
  },
  driving: {
    backgroundColor: 'rgba(94, 179, 255, 0.14)',
    borderColor: 'rgba(94, 179, 255, 0.32)',
    icon: '🚗',
    title: 'Driving',
  },
  drivingActive: {
    backgroundColor: 'rgba(94, 179, 255, 0.22)',
    borderColor: PIZZA_FIRE.driving,
    icon: '🚗',
    title: 'Driving',
  },
  break: {
    backgroundColor: 'rgba(255, 246, 229, 0.10)',
    borderColor: 'rgba(255, 246, 229, 0.52)',
    icon: '☕',
    title: 'Break',
  },
  breakActive: {
    backgroundColor: 'rgba(255, 246, 229, 0.18)',
    borderColor: PIZZA_FIRE.pause,
    icon: '☕',
    title: 'Break',
  },
} as const;

function getCardStyle(entry: DayTimeEntry) {
  if (entry.kind === 'work' && entry.workCategory === 'driving') {
    return entry.isActive ? CARD_STYLES.drivingActive : CARD_STYLES.driving;
  }
  if (entry.kind === 'work') return entry.isActive ? CARD_STYLES.workActive : CARD_STYLES.work;
  return entry.isActive ? CARD_STYLES.breakActive : CARD_STYLES.break;
}

type TimeViewMode = 'workHours' | 'shiftsBreaks';

const DATE_ITEM_WIDTH = 64;
const VISIBLE_DATE_COUNT = 5;

export default function WorkingHoursScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { syncBannerVisible } = useOffline();
  const currentUserId = auth.currentUser?.uid || null;
  const authState = useAuth();
  const isAdmin = authState.status === 'admin';
  const initialDateKey = route.params?.initialDateKey;
  const requestedUserId = route.params?.employeeUserId || currentUserId;
  const requestedOther = Boolean(requestedUserId && currentUserId && requestedUserId !== currentUserId);
  const [viewedUserId, setViewedUserId] = useState(
    () => (requestedOther && authState.status !== 'admin' ? currentUserId : requestedUserId)
  );
  const [viewedUserName, setViewedUserName] = useState(route.params?.employeeName || '');
  const viewingOtherUser = Boolean(viewedUserId && currentUserId && viewedUserId !== currentUserId);
  const userId = viewedUserId;
  const todayKey = localDateKey(new Date());
  const recentQueryDateKeys = useMemo(() => buildRecentDateKeys(7), []);
  const [selectedDateKey, setSelectedDateKey] = useState(() => {
    if (initialDateKey && /^\d{4}-\d{2}-\d{2}$/.test(initialDateKey) && initialDateKey <= todayKey) {
      return initialDateKey;
    }
    return todayKey;
  });
  const stripDateKeys = useMemo(
    () => buildHoursRolodexDateKeys(todayKey, selectedDateKey),
    [selectedDateKey, todayKey]
  );
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [liveShifts, setLiveShifts] = useState<LiveShift[]>([]);
  const [historicalShifts, setHistoricalShifts] = useState<LiveShift[]>([]);
  const cleanedUserIdRef = useRef<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [scheduledShifts, setScheduledShifts] = useState<ScheduledShiftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(Date.now());
  const [offlineShift, setOfflineShift] = useState<LiveShift | null>(null);
  const [editingEntry, setEditingEntry] = useState<DayTimeEntry | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [shiftActionBusy, setShiftActionBusy] = useState(false);
  const [daySummaryOpen, setDaySummaryOpen] = useState(false);
  const [exportingTimesheet, setExportingTimesheet] = useState(false);
  const [timeViewMode, setTimeViewMode] = useState<TimeViewMode>('workHours');
  const tabScrollRef = useRef<FlatList<string>>(null);
  const itemWidthRef = useRef(DATE_ITEM_WIDTH);
  const [itemWidth, setItemWidth] = useState(DATE_ITEM_WIDTH);
  itemWidthRef.current = itemWidth;
  const daySwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 30 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_event, gesture) => {
          if (Math.abs(gesture.dx) < 60) return;
          setSelectedDateKey(current => {
            const next = addDaysToDateKey(current, gesture.dx < 0 ? 1 : -1);
            return next <= todayKey ? next : current;
          });
        },
      }),
    [todayKey]
  );

  const scrollRolodexToSelection = useCallback(
    (dateKey: string, animated: boolean) => {
      if (!stripDateKeys.length) return;
      const start = hoursRolodexWindowStart(dateKey, todayKey, stripDateKeys);
      tabScrollRef.current?.scrollToOffset({
        offset: start * itemWidth,
        animated,
      });
    },
    [itemWidth, stripDateKeys, todayKey]
  );

  useEffect(() => {
    if (authState.status === 'loading') return;
    const requested = route.params?.employeeUserId;
    if (requested && requested !== currentUserId && !isAdmin) {
      setViewedUserId(currentUserId);
      return;
    }
    if (requested) {
      setViewedUserId(requested);
      if (route.params?.employeeName) setViewedUserName(route.params.employeeName);
      return;
    }
    if (!viewedUserId && currentUserId) setViewedUserId(currentUserId);
  }, [authState.status, isAdmin, currentUserId, route.params?.employeeUserId, route.params?.employeeName]);

  useEffect(() => {
    if (!userId) return undefined;
    const fs = getFirestore();
    const unsub = onSnapshot(doc(fs, 'users', userId), snap => {
      const data = snap.data();
      const name = String(data?.name || data?.displayName || '').trim();
      if (name) setViewedUserName(name);
    });
    return unsub;
  }, [userId]);

  useEffect(() => {
    if (initialDateKey && /^\d{4}-\d{2}-\d{2}$/.test(initialDateKey) && initialDateKey <= todayKey) {
      setSelectedDateKey(initialDateKey);
    }
  }, [initialDateKey, todayKey]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const refreshOfflineShift = async () => {
    if (viewingOtherUser) {
      setOfflineShift(null);
      return;
    }
    const offline = await getOfflineOpenShift();
    if (offline && offline.userId === currentUserId) {
      setOfflineShift(offlineOpenShiftToLiveShift(offline));
      return;
    }
    setOfflineShift(null);
  };

  useEffect(() => {
    if (!userId || viewingOtherUser) {
      setOfflineShift(null);
      if (viewingOtherUser) return undefined;
      if (!userId) return undefined;
    }
    void refreshOfflineShift();
    const unsub = subscribeOutboxChanges(() => {
      void refreshOfflineShift();
    });
    return unsub;
  }, [userId, viewingOtherUser, currentUserId]);

  useEffect(() => {
    if (!userId || viewingOtherUser || cleanedUserIdRef.current === userId) return;
    cleanedUserIdRef.current = userId;
    void cleanupStoredSubMinuteShiftsForUser(userId).catch(error => {
      console.warn('Could not clean up short shift records:', error);
    });
  }, [userId, viewingOtherUser]);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setLiveShifts([]);
    setHistoricalShifts([]);
    const fs = getFirestore();
    const historyQuery = query(collection(fs, 'shifts'), where('userId', '==', userId));
    const scheduledQuery = query(
      collection(fs, 'shifts'),
      where('userId', '==', userId),
      where('isScheduled', '==', true)
    );

    const unsubHistory = onSnapshot(historyQuery, snap => {
      const items = (snap?.docs || [])
        .map(d => ({ id: d.id, ...d.data() } as LiveShift))
        .filter(s => !s.isScheduled);
      setLiveShifts(items);
      setLoading(false);
    });

    const unsubScheduled = onSnapshot(scheduledQuery, snap => {
      const items = (snap?.docs || []).map(
        d =>
          ({
            id: d.id,
            date: String(d.data()?.date || ''),
            startTime: String(d.data()?.startTime || ''),
            endTime: String(d.data()?.endTime || ''),
          }) as ScheduledShiftRow
      );
      setScheduledShifts(items);
    });

    return () => {
      unsubHistory();
      unsubScheduled();
    };
  }, [userId]);

  const needsHistoricalLoad = !recentQueryDateKeys.includes(selectedDateKey);

  useEffect(() => {
    if (!userId || !needsHistoricalLoad) {
      setHistoricalShifts([]);
      setHistoryLoading(false);
      return undefined;
    }

    setHistoryLoading(true);
    const fs = getFirestore();
    const historicalQuery = query(collection(fs, 'shifts'), where('userId', '==', userId));
    const unsubHistorical = onSnapshot(historicalQuery, snap => {
      const items = (snap?.docs || [])
        .map(d => ({ id: d.id, ...d.data() } as LiveShift))
        .filter(s => !s.isScheduled);
      setHistoricalShifts(items);
      setHistoryLoading(false);
    });

    return () => {
      unsubHistorical();
    };
  }, [userId, needsHistoricalLoad]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      scrollRolodexToSelection(selectedDateKey, false);
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedDateKey, stripDateKeys, scrollRolodexToSelection]);

  const mergedShifts = useMemo(() => {
    const extras = historicalShifts.filter(s => !liveShifts.some(live => live.id === s.id));
    const base = extras.length ? [...liveShifts, ...extras] : liveShifts;
    if (!offlineShift) return base;
    const withoutOffline = base.filter(s => s.id !== offlineShift.id);
    return [offlineShift, ...withoutOffline];
  }, [liveShifts, historicalShifts, offlineShift]);

  const dayEntries = useMemo(
    () => buildDayTimeEntries(mergedShifts, selectedDateKey, nowMs),
    [mergedShifts, selectedDateKey, nowMs]
  );

  const totalWorkedMs = useMemo(
    () => totalWorkedMsForDay(mergedShifts, selectedDateKey, nowMs),
    [mergedShifts, selectedDateKey, nowMs]
  );

  const totalBreakMs = useMemo(
    () => totalBreakMsForDay(mergedShifts, selectedDateKey, nowMs),
    [mergedShifts, selectedDateKey, nowMs]
  );

  const scheduledMs = useMemo(
    () => scheduledMsForDate(scheduledShifts, selectedDateKey),
    [scheduledShifts, selectedDateKey]
  );

  const visibleEntries = useMemo(
    () =>
      timeViewMode === 'workHours'
        ? dayEntries.filter(entry => entry.kind === 'work')
        : dayEntries,
    [dayEntries, timeViewMode]
  );

  const selectedIsToday = selectedDateKey === todayKey;

  const scheduledLabel = formatScheduledTargetLabel(scheduledMs);
  const scheduledSubtext = scheduledLabel
    ? `Scheduled on rota: ${scheduledLabel.replace(/\s*Hours$/i, '')}`
    : null;
  const workHoursHeading = selectedIsToday ? 'Work hours today' : 'Work hours';
  const shiftsBreaksHeading = selectedIsToday ? 'Shifts & breaks today' : 'Shifts & breaks';

  const findShiftById = (shiftId: string) => mergedShifts.find(s => s.id === shiftId) ?? null;

  const handlePauseOrResumeShift = async (shiftId: string) => {
    if (viewingOtherUser) return;
    if (shiftActionBusy) return;
    const shift = findShiftById(shiftId);
    if (!shift) {
      Alert.alert('Notice', 'Could not find the active shift.');
      return;
    }

    setShiftActionBusy(true);
    try {
      const paused = isShiftPaused(shift);
      const result = paused ? await resumeLiveShift(shiftId) : await pauseLiveShift(shiftId);
      await refreshOfflineShift();
      if (result.queued) {
        Alert.alert('Saved offline', 'Shift change will sync when you are back online.');
      }
    } catch (error) {
      Alert.alert('Notice', error instanceof Error ? error.message : 'Could not update shift.');
    } finally {
      setShiftActionBusy(false);
    }
  };

  const handleEndShiftFromAlert = (_shiftId: string) => {
    if (viewingOtherUser) return;
    if (!userId || shiftActionBusy) return;
    setDaySummaryOpen(true);
  };

  const openEntryEditor = (entry: DayTimeEntry) => {
    if (viewingOtherUser) {
      Alert.alert('View only', 'Employee hours are read-only. Shifts cannot be edited from this view.');
      return;
    }
    if (entry.isActive) {
      const shift = findShiftById(entry.shiftId);
      const paused = shift ? isShiftPaused(shift) : false;
      Alert.alert('Active timer', 'Pause or end the active timer before editing this slot.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: paused ? 'Resume' : 'Pause',
          onPress: () => {
            void handlePauseOrResumeShift(entry.shiftId);
          },
        },
        {
          text: 'End',
          style: 'destructive',
          onPress: () => handleEndShiftFromAlert(entry.shiftId),
        },
      ]);
      return;
    }
    if (entry.shiftLocked) {
      Alert.alert('Locked shift', 'This shift is locked and cannot be edited.');
      return;
    }
    if (entry.shiftId.startsWith('offline-')) {
      Alert.alert('Offline shift', 'Edit this slot after the shift syncs online.');
      return;
    }
    if (!entry.periodEndIso) {
      Alert.alert('Incomplete slot', 'This time slot is still open and cannot be edited.');
      return;
    }
    setEditingEntry(entry);
  };

  const saveEntryEdit = async (startTime: string, endTime: string) => {
    if (viewingOtherUser) return;
    if (!editingEntry?.periodEndIso) return;
    setSavingEdit(true);
    try {
      const startIso = applyTimeToIso(editingEntry.periodStartIso, startTime);
      const endIso = applyTimeToIso(editingEntry.periodEndIso, endTime);
      await updateShiftPeriodTimes(
        editingEntry.shiftId,
        editingEntry.kind,
        editingEntry.periodIndex,
        startIso,
        endIso
      );
      setEditingEntry(null);
    } catch (error) {
      Alert.alert('Could not save', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSavingEdit(false);
    }
  };

  const editModalStart = editingEntry ? msToTimeValue(new Date(editingEntry.periodStartIso).getTime()) : '09:00';
  const editModalEnd = editingEntry?.periodEndIso
    ? msToTimeValue(new Date(editingEntry.periodEndIso).getTime())
    : '17:00';
  const editModalLabel = editingEntry
    ? editingEntry.kind === 'work'
      ? 'Edit working time'
      : 'Edit break'
    : '';

  const selectedMonthKey = selectedDateKey.slice(0, 7);
  const selectedMonthLabel = new Date(`${selectedMonthKey}-01T12:00:00`).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const exportMonthlyTimesheet = async () => {
    if (!userId || exportingTimesheet) return;
    setExportingTimesheet(true);
    try {
      const result = await shareMonthlyTimesheetPdf({
        employeeName: viewedUserName || 'Employee',
        monthKey: selectedMonthKey,
        shifts: mergedShifts,
      });
      if (result.rows.length === 0) {
        Alert.alert('No hours logged', `The ${selectedMonthLabel} Stundenzettel was created with no recorded shifts.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create the Stundenzettel PDF.';
      if (!/user did not share/i.test(message)) Alert.alert('Export failed', message);
    } finally {
      setExportingTimesheet(false);
    }
  };

  const headerTopInset = insets.top + (syncBannerVisible ? 18 : 12);

  return (
    <View style={styles.screen}>
      <PizzaFireBackground />
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <View style={[styles.header, { paddingTop: headerTopInset }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icons.arrowLeft color={PIZZA_FIRE.gold} width={22} height={22} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Working Hours</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.dateSelector}>
        <TouchableOpacity
          style={[styles.tab, styles.dateSelectorFixed]}
          onPress={() => setDatePickerOpen(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.endTabText} numberOfLines={1}>
            SELECT DATE
          </Text>
        </TouchableOpacity>
        <View
          style={styles.dateRolodex}
          onLayout={event => {
            const width = event.nativeEvent.layout.width;
            const nextWidth = Math.floor(width / VISIBLE_DATE_COUNT);
            if (nextWidth > 0 && nextWidth !== itemWidthRef.current) {
              setItemWidth(nextWidth);
            }
          }}
        >
          <FlatList
            ref={tabScrollRef}
            style={styles.dateRolodexList}
            contentContainerStyle={styles.dateRolodexContent}
            data={stripDateKeys}
            keyExtractor={dateKey => dateKey}
            extraData={`${selectedDateKey}:${itemWidth}`}
            horizontal
            showsHorizontalScrollIndicator={false}
            bounces={false}
            snapToInterval={itemWidth}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum={false}
            getItemLayout={(_item, index) => ({
              length: itemWidth,
              offset: itemWidth * index,
              index,
            })}
            initialNumToRender={12}
            windowSize={7}
            onScrollToIndexFailed={info => {
              setTimeout(() => {
                tabScrollRef.current?.scrollToOffset({
                  offset: info.index * itemWidthRef.current,
                  animated: false,
                });
              }, 80);
            }}
            renderItem={({ item: dateKey }) => {
              const active = dateKey === selectedDateKey;
              return (
                <TouchableOpacity
                  style={[
                    styles.tab,
                    styles.dateRolodexItem,
                    { width: itemWidth },
                    active && styles.tabActive,
                  ]}
                  onPress={() => setSelectedDateKey(dateKey)}
                  activeOpacity={0.8}
                  delayPressIn={50}
                >
                  <Text style={[styles.dateTabText, active && styles.tabTextActive]}>
                    {formatTabLabel(dateKey, false)}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>
        <TouchableOpacity
          style={[styles.tab, styles.dateSelectorFixed, selectedIsToday && styles.tabActive]}
          onPress={() => setSelectedDateKey(todayKey)}
          activeOpacity={0.8}
        >
          <Text
            style={[styles.endTabText, selectedIsToday && styles.tabTextActive]}
            numberOfLines={1}
          >
            TODAY
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.selectedPersonName} numberOfLines={1}>
        {viewedUserName || ' '}
      </Text>

      <TouchableOpacity
        style={[styles.exportButton, exportingTimesheet && styles.exportButtonDisabled]}
        onPress={() => void exportMonthlyTimesheet()}
        disabled={exportingTimesheet || loading}
        activeOpacity={0.85}
      >
        <Text style={styles.exportButtonText}>
          {exportingTimesheet ? 'Preparing PDF…' : `Export ${selectedMonthLabel} PDF`}
        </Text>
      </TouchableOpacity>

      {loading || (needsHistoricalLoad && historyLoading) ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={PIZZA_FIRE.gold} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} {...daySwipeResponder.panHandlers}>
          <View style={styles.viewToggle}>
            <TouchableOpacity
              style={[styles.viewToggleBtn, timeViewMode === 'workHours' && styles.viewToggleBtnActive]}
              onPress={() => setTimeViewMode('workHours')}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.viewToggleText,
                  timeViewMode === 'workHours' && styles.viewToggleTextActive,
                ]}
              >
                Work Hours
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.viewToggleBtn, timeViewMode === 'shiftsBreaks' && styles.viewToggleBtnActive]}
              onPress={() => setTimeViewMode('shiftsBreaks')}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.viewToggleText,
                  timeViewMode === 'shiftsBreaks' && styles.viewToggleTextActive,
                ]}
              >
                Shifts & Breaks
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.totalSection}>
            {timeViewMode === 'workHours' ? (
              <>
                <Text style={styles.totalHeading}>{workHoursHeading}</Text>
                <Text style={styles.totalValue}>{formatTotalHoursLabel(totalWorkedMs)}</Text>
                <Text style={styles.totalSubtext}>Working time only · breaks excluded</Text>
                {scheduledSubtext ? (
                  <Text style={styles.totalScheduled}>{scheduledSubtext}</Text>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.totalHeading}>{shiftsBreaksHeading}</Text>
                <View style={styles.splitTotals}>
                  <View style={styles.splitTotalItem}>
                    <Text style={styles.splitTotalLabel}>Work</Text>
                    <Text style={styles.splitTotalValue}>{formatTotalHoursLabel(totalWorkedMs)}</Text>
                  </View>
                  <View style={styles.splitTotalDivider} />
                  <View style={styles.splitTotalItem}>
                    <Text style={styles.splitTotalLabel}>Break</Text>
                    <Text style={styles.splitTotalValue}>{formatTotalHoursLabel(totalBreakMs)}</Text>
                  </View>
                </View>
                <Text style={styles.totalSubtext}>Full shift timeline · work and break slots</Text>
                {scheduledSubtext ? (
                  <Text style={styles.totalScheduled}>{scheduledSubtext}</Text>
                ) : null}
              </>
            )}
          </View>

          {!viewingOtherUser ? (
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => navigation.navigate('ShiftSetup')}
            activeOpacity={0.85}
          >
            <Icons.clock color={PIZZA_FIRE.cheese} width={18} height={18} />
            <Text style={styles.createButtonText}>View Shift Status</Text>
          </TouchableOpacity>
          ) : null}

          {visibleEntries.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                {timeViewMode === 'workHours' ? 'No work logged' : 'No shifts or breaks logged'}
              </Text>
              <Text style={styles.emptyText}>
                {viewingOtherUser
                  ? 'No hours recorded for this employee on the selected date.'
                  : timeViewMode === 'workHours'
                  ? 'Start a shift from Home to track working time here.'
                  : 'Start a shift from Home to see your full shift timeline here.'}
              </Text>
            </View>
          ) : (
            visibleEntries.map(entry => {
              const card = getCardStyle(entry);
              return (
                <View
                  key={entry.id}
                  style={[
                    styles.entryCard,
                    {
                      backgroundColor: card.backgroundColor,
                      borderColor: card.borderColor,
                    },
                  ]}
                >
                  <View style={styles.entryIconWrap}>
                    <Text style={styles.entryIcon}>{card.icon}</Text>
                  </View>
                  <View style={styles.entryBody}>
                    <View style={styles.entryTitleRow}>
                      <Text style={styles.entryTitle}>{card.title}</Text>
                      {entry.isAdded || entry.isEdited ? (
                        <HoursChangeBadge added={entry.isAdded} edited={entry.isEdited} />
                      ) : null}
                    </View>
                    <Text style={styles.entryRange}>{formatEntryRange(entry)}</Text>
                    {entry.scheduledStartTime && entry.scheduledEndTime ? (
                      <Text style={styles.entryOriginal}>
                        Scheduled: {formatTimeRange(entry.scheduledStartTime, entry.scheduledEndTime)}
                      </Text>
                    ) : null}
                    {entry.isAdded ? (
                      <Text style={styles.entryOriginal}>Manually added</Text>
                    ) : entry.isEdited && formatOriginalEntryRange(entry) ? (
                      <Text style={styles.entryOriginal}>{formatOriginalEntryRange(entry)}</Text>
                    ) : null}
                    {entry.locationName ? (
                      <Text style={styles.entryLocation}>{entry.locationName}</Text>
                    ) : null}
                  </View>
                  <View style={styles.entryDurationWrap}>
                    <Text style={styles.entryDuration}>
                      {formatEntryDuration(entry.durationMs, entry.isActive)}
                    </Text>
                    {!viewingOtherUser ? (
                    <TouchableOpacity
                      onPress={() => openEntryEditor(entry)}
                      disabled={savingEdit}
                      hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.entryEdit}>✎</Text>
                    </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <EventDayTimeModal
        visible={!!editingEntry}
        dayLabel={editModalLabel}
        startTime={editModalStart}
        endTime={editModalEnd}
        onClose={() => {
          if (!savingEdit) setEditingEntry(null);
        }}
        onConfirm={saveEntryEdit}
      />
      <DaySummaryModal
        visible={daySummaryOpen}
        userId={currentUserId}
        activeShift={offlineShift || mergedShifts.find(s => s.status === 'open') || null}
        onCancel={() => setDaySummaryOpen(false)}
        onConfirmed={async result => {
          setDaySummaryOpen(false);
          await refreshOfflineShift();
          if (result.queued) {
            Alert.alert('Saved offline', 'Shift end will sync when you are back online.');
          }
        }}
      />
      <Modal
        visible={datePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDatePickerOpen(false)}
      >
        <View style={styles.datePickerBackdrop}>
          <View style={styles.datePickerCard}>
            <Text style={styles.datePickerTitle}>Select date</Text>
            <PizzaFireCalendar
              current={selectedDateKey}
              maxDate={todayKey}
              theme={{
                backgroundColor: PIZZA_FIRE.surfaceInset,
                calendarBackground: 'transparent',
                selectedDayBackgroundColor: PIZZA_FIRE.accent,
                dayTextColor: '#F6EDE2',
                monthTextColor: '#F6EDE2',
                textDisabledColor: '#3A2D24',
                arrowColor: PIZZA_FIRE.accent,
                todayTextColor: '#E9B261',
              }}
              onDayPress={day => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(day.dateString) || day.dateString > todayKey) return;
                setSelectedDateKey(day.dateString);
              }}
              markedDates={{
                [selectedDateKey]: {
                  selected: true,
                  selectedColor: PIZZA_FIRE.accent,
                  selectedTextColor: PIZZA_FIRE.charcoal,
                },
              }}
            />
            <TouchableOpacity
              style={styles.datePickerCloseButton}
              onPress={() => setDatePickerOpen(false)}
            >
              <Text style={styles.datePickerCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: PIZZA_FIRE.bgTop,
  },
  safe: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    color: PIZZA_FIRE.textPrimary,
  },
  headerSpacer: {
    width: 40,
  },
  dateSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  selectedPersonName: {
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '800',
    color: PIZZA_FIRE.textPrimary,
    paddingHorizontal: 16,
    paddingBottom: 10,
    paddingTop: 2,
  },
  exportButton: {
    alignSelf: 'center',
    minHeight: 38,
    paddingHorizontal: 16,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 159, 28, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255, 159, 28, 0.55)',
    marginBottom: 8,
  },
  exportButtonDisabled: {
    opacity: 0.55,
  },
  exportButtonText: {
    color: PIZZA_FIRE.cheese,
    fontWeight: '800',
    fontSize: 13,
  },
  dateSelectorFixed: {
    flexShrink: 0,
    paddingHorizontal: 8,
  },
  dateRolodex: {
    flex: 1,
    minHeight: 44,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  dateRolodexList: {
    flexGrow: 0,
  },
  dateRolodexContent: {
    alignItems: 'center',
  },
  dateRolodexItem: {
    flexShrink: 0,
    paddingHorizontal: 0,
    justifyContent: 'center',
    minHeight: 44,
  },
  tab: {
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
    alignItems: 'center',
  },
  datePickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 20,
  },
  datePickerCard: {
    backgroundColor: PIZZA_FIRE.bgMid,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  datePickerTitle: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  datePickerCloseButton: {
    marginTop: 12,
    minHeight: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PIZZA_FIRE.hotAccent,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.hotAccentBorder,
  },
  datePickerCloseText: {
    color: PIZZA_FIRE.cheese,
    fontSize: 15,
    fontWeight: '800',
  },
  tabActive: {
    borderBottomColor: PIZZA_FIRE.gold,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '700',
    color: PIZZA_FIRE.textMuted,
    letterSpacing: 0.4,
    lineHeight: 20,
    textAlign: 'center',
  },
  dateTabText: {
    fontSize: 12,
    fontWeight: '700',
    color: PIZZA_FIRE.textMuted,
    letterSpacing: 0,
    lineHeight: 20,
    textAlign: 'center',
  },
  endTabText: {
    fontSize: 13,
    fontWeight: '700',
    color: PIZZA_FIRE.textMuted,
    letterSpacing: 0.4,
    lineHeight: 20,
    textAlign: 'center',
  },
  tabTextActive: {
    color: PIZZA_FIRE.textPrimary,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 32,
  },
  viewToggle: {
    flexDirection: 'row',
    marginTop: 0,
    marginBottom: 16,
    padding: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(18, 10, 6, 0.55)',
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  viewToggleBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  viewToggleBtnActive: {
    backgroundColor: PIZZA_FIRE.hotAccent,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.hotAccentBorder,
  },
  viewToggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: PIZZA_FIRE.textMuted,
    textAlign: 'center',
  },
  viewToggleTextActive: {
    color: PIZZA_FIRE.cheese,
  },
  totalSection: {
    alignItems: 'center',
    marginTop: 0,
  },
  totalHeading: {
    fontSize: 12,
    fontWeight: '800',
    color: PIZZA_FIRE.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  totalValue: {
    marginTop: 6,
    fontSize: 34,
    fontWeight: '800',
    color: PIZZA_FIRE.textPrimary,
    textAlign: 'center',
  },
  totalSubtext: {
    marginTop: 6,
    fontSize: 14,
    color: PIZZA_FIRE.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  totalScheduled: {
    marginTop: 4,
    fontSize: 13,
    color: PIZZA_FIRE.textMuted,
    textAlign: 'center',
  },
  splitTotals: {
    marginTop: 10,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  splitTotalItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  splitTotalLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: PIZZA_FIRE.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  splitTotalValue: {
    fontSize: 22,
    fontWeight: '800',
    color: PIZZA_FIRE.textPrimary,
    textAlign: 'center',
  },
  splitTotalDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255, 159, 28, 0.18)',
  },
  createButton: {
    marginTop: 18,
    marginBottom: 22,
    backgroundColor: PIZZA_FIRE.hotAccent,
    borderRadius: 999,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.hotAccentBorder,
  },
  createButtonText: {
    color: PIZZA_FIRE.cheese,
    fontSize: 16,
    fontWeight: '800',
  },
  emptyCard: {
    backgroundColor: PIZZA_FIRE.card,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: PIZZA_FIRE.textPrimary,
  },
  emptyText: {
    marginTop: 6,
    fontSize: 14,
    color: PIZZA_FIRE.textMuted,
    lineHeight: 20,
  },
  entryCard: {
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
  },
  entryIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255, 248, 238, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  entryIcon: {
    fontSize: 20,
  },
  entryBody: {
    flex: 1,
  },
  entryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  entryTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: PIZZA_FIRE.textPrimary,
  },
  editedBadge: {
    backgroundColor: 'rgba(255, 159, 28, 0.18)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(255, 159, 28, 0.28)',
  },
  editedBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: PIZZA_FIRE.gold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  entryRange: {
    marginTop: 4,
    fontSize: 13,
    color: PIZZA_FIRE.textSecondary,
  },
  entryOriginal: {
    marginTop: 2,
    fontSize: 12,
    color: PIZZA_FIRE.textMuted,
    fontStyle: 'italic',
  },
  entryLocation: {
    marginTop: 2,
    fontSize: 12,
    color: PIZZA_FIRE.gold,
  },
  entryDurationWrap: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  entryDuration: {
    fontSize: 16,
    fontWeight: '800',
    color: PIZZA_FIRE.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  entryEdit: {
    marginTop: 6,
    fontSize: 16,
    color: PIZZA_FIRE.gold,
  },
});
