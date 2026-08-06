import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  collection,
  getFirestore,
  limit,
  onSnapshot,
  query,
  where,
} from '@react-native-firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import EventDayTimeModal from '../components/EventDayTimeModal';
import PizzaFireBackground from '../components/PizzaFireBackground';
import { Icons } from '../components/Icons';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import { auth } from '../services/firebase';
import { useOffline } from '../context/OfflineContext';
import { getOfflineOpenShift } from '../offline/outbox';
import { subscribeOutboxChanges } from '../offline/events';
import { offlineOpenShiftToLiveShift, updateShiftPeriodTimes, endLiveShift, isShiftPaused, pauseLiveShift, resumeLiveShift, type LiveShift } from '../services/shifts';
import {
  applyTimeToIso,
  buildDayTimeEntries,
  buildRecentDateKeys,
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
  break: {
    backgroundColor: 'rgba(94, 179, 255, 0.12)',
    borderColor: 'rgba(94, 179, 255, 0.28)',
    icon: '☕',
    title: 'Break',
  },
  breakActive: {
    backgroundColor: 'rgba(94, 179, 255, 0.2)',
    borderColor: PIZZA_FIRE.pause,
    icon: '☕',
    title: 'Break',
  },
} as const;

function getCardStyle(entry: DayTimeEntry) {
  if (entry.kind === 'work') return entry.isActive ? CARD_STYLES.workActive : CARD_STYLES.work;
  return entry.isActive ? CARD_STYLES.breakActive : CARD_STYLES.break;
}

type TimeViewMode = 'workHours' | 'shiftsBreaks';

export default function WorkingHoursScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { syncBannerVisible } = useOffline();
  const userId = auth.currentUser?.uid || null;
  const initialDateKey = route.params?.initialDateKey;
  const dateKeys = useMemo(() => {
    const keys = buildRecentDateKeys(7);
    if (initialDateKey && /^\d{4}-\d{2}-\d{2}$/.test(initialDateKey) && !keys.includes(initialDateKey)) {
      return [...keys, initialDateKey].sort();
    }
    return keys;
  }, [initialDateKey]);
  const todayKey = localDateKey(new Date());
  const [selectedDateKey, setSelectedDateKey] = useState(
    initialDateKey && dateKeys.includes(initialDateKey) ? initialDateKey : todayKey
  );
  const [liveShifts, setLiveShifts] = useState<LiveShift[]>([]);
  const [scheduledShifts, setScheduledShifts] = useState<ScheduledShiftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(Date.now());
  const [offlineShift, setOfflineShift] = useState<LiveShift | null>(null);
  const [editingEntry, setEditingEntry] = useState<DayTimeEntry | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [shiftActionBusy, setShiftActionBusy] = useState(false);
  const [timeViewMode, setTimeViewMode] = useState<TimeViewMode>('workHours');
  const tabScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (initialDateKey && dateKeys.includes(initialDateKey)) {
      setSelectedDateKey(initialDateKey);
    }
  }, [initialDateKey, dateKeys]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const refreshOfflineShift = async () => {
    const offline = await getOfflineOpenShift();
    if (offline && offline.userId === userId) {
      setOfflineShift(offlineOpenShiftToLiveShift(offline));
      return;
    }
    setOfflineShift(null);
  };

  useEffect(() => {
    if (!userId) return undefined;
    void refreshOfflineShift();
    const unsub = subscribeOutboxChanges(() => {
      void refreshOfflineShift();
    });
    return unsub;
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return undefined;
    }

    const fs = getFirestore();
    const historyQuery = query(collection(fs, 'shifts'), where('userId', '==', userId), limit(50));
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

  useEffect(() => {
    requestAnimationFrame(() => {
      tabScrollRef.current?.scrollToEnd({ animated: false });
    });
  }, [dateKeys]);

  const mergedShifts = useMemo(() => {
    if (!offlineShift) return liveShifts;
    const withoutOffline = liveShifts.filter(s => s.id !== offlineShift.id);
    return [offlineShift, ...withoutOffline];
  }, [liveShifts, offlineShift]);

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

  const handleEndShiftFromAlert = (shiftId: string) => {
    Alert.alert('End shift', 'End your current shift? It will be locked.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End',
        style: 'destructive',
        onPress: () => {
          if (shiftActionBusy) return;
          setShiftActionBusy(true);
          void endLiveShift(shiftId, 'manual')
            .then(async result => {
              await refreshOfflineShift();
              if (result.queued) {
                Alert.alert('Saved offline', 'Shift end will sync when you are back online.');
              }
            })
            .catch(error =>
              Alert.alert('Notice', error instanceof Error ? error.message : 'Could not end shift.')
            )
            .finally(() => setShiftActionBusy(false));
        },
      },
    ]);
  };

  const openEntryEditor = (entry: DayTimeEntry) => {
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

  const headerTopInset = syncBannerVisible ? insets.top + 18 : 8;

  return (
    <View style={styles.screen}>
      <PizzaFireBackground />
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <View style={[styles.header, { paddingTop: headerTopInset }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icons.arrowLeft color={PIZZA_FIRE.gold} width={22} height={22} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Manage working hours</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        ref={tabScrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabsRow}
      >
        {dateKeys.map(dateKey => {
          const active = dateKey === selectedDateKey;
          return (
            <TouchableOpacity
              key={dateKey}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setSelectedDateKey(dateKey)}
              activeOpacity={0.8}
            >
              <Text
                style={[styles.tabText, active && styles.tabTextActive]}
                numberOfLines={1}
              >
                {formatTabLabel(dateKey, dateKey === todayKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={PIZZA_FIRE.gold} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
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

          <TouchableOpacity
            style={styles.createButton}
            onPress={() => navigation.navigate('ShiftSetup')}
            activeOpacity={0.85}
          >
            <Icons.clock color={PIZZA_FIRE.cheese} width={18} height={18} />
            <Text style={styles.createButtonText}>View Shift Status</Text>
          </TouchableOpacity>

          {visibleEntries.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                {timeViewMode === 'workHours' ? 'No work logged' : 'No shifts or breaks logged'}
              </Text>
              <Text style={styles.emptyText}>
                {timeViewMode === 'workHours'
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
                      {entry.isEdited ? (
                        <View style={styles.editedBadge}>
                          <Text style={styles.editedBadgeText}>Edited</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.entryRange}>{formatEntryRange(entry)}</Text>
                    {entry.isEdited && formatOriginalEntryRange(entry) ? (
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
                    <TouchableOpacity
                      onPress={() => openEntryEditor(entry)}
                      disabled={savingEdit}
                      hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.entryEdit}>✎</Text>
                    </TouchableOpacity>
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
  tabsScroll: {
    flexGrow: 0,
    minHeight: 52,
    marginBottom: 10,
  },
  tabsRow: {
    paddingHorizontal: 12,
    paddingRight: 32,
    paddingTop: 10,
    paddingBottom: 12,
    alignItems: 'center',
    gap: 8,
  },
  tab: {
    minWidth: 84,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
    alignItems: 'center',
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
    backgroundColor: PIZZA_FIRE.ember,
    borderWidth: 1,
    borderColor: 'rgba(255, 209, 102, 0.35)',
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
    backgroundColor: PIZZA_FIRE.ember,
    borderRadius: 999,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 209, 102, 0.45)',
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
