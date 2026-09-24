import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
} from 'react-native';
import PizzaFireScreen from '../components/PizzaFireScreen';
import ShiftPlanGridView from '../components/ShiftPlanGrid';
import {
  collection,
  onSnapshot,
  query,
  where,
  doc,
  deleteDoc,
  getFirestore,
} from '@react-native-firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { openUserProfile } from '../navigation/openUserProfile';
import { Icons } from '../components/Icons';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import {
  downloadSchedulePdfToDevice,
  type ScheduledShiftRow,
} from '../services/schedulePdf';
import {
  buildShiftPlanGrid,
  eventPeriodLabel,
  groupScheduledShiftsByEvent,
  uniqueEmployeesFromShifts,
  UNLINKED_EVENT_ID,
  type ScheduleEventRef,
  type ScheduleGeofenceRef,
  type ShiftPlanCell,
} from '../utils/shiftPlanGrid';
import { resolveAvatarSource } from '../utils/avatar';
import {
  EVENT_SEASONS_CONFIG_ID,
  parseSeasonDoc,
  splitLiveAndArchived,
  type EventSeason,
} from '../utils/eventSeasons';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminSchedule'>;

type ScheduledShift = ScheduledShiftRow & { id: string };
type ScheduleView = 'events' | 'employees' | 'person';

export default function AdminScheduleScreen({ navigation }: Props) {
  const [shifts, setShifts] = useState<ScheduledShift[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [events, setEvents] = useState<ScheduleEventRef[]>([]);
  const [seasons, setSeasons] = useState<EventSeason[]>([]);
  const [currentSeasonId, setCurrentSeasonId] = useState<string | null>(null);
  const [geofences, setGeofences] = useState<ScheduleGeofenceRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ScheduleView>('events');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [openedSeasonId, setOpenedSeasonId] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [scheduleViewerVisible, setScheduleViewerVisible] = useState(false);
  const fs = getFirestore();

  useEffect(() => {
    const unsubShifts = onSnapshot(
      query(collection(fs, 'shifts'), where('isScheduled', '==', true)),
      snap => {
        if (!snap || !snap.docs || snap.empty) {
          setShifts([]);
          setLoading(false);
          return;
        }
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as ScheduledShift));
        items.sort((a, b) => b.date.localeCompare(a.date));
        setShifts(items);
        setLoading(false);
      }
    );

    const unsubUsers = onSnapshot(collection(fs, 'users'), snap => {
      if (!snap || !snap.docs) {
        setUsers([]);
        return;
      }
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const unsubEvents = onSnapshot(collection(fs, 'events'), snap => {
      if (!snap || !snap.docs) {
        setEvents([]);
        return;
      }
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() } as ScheduleEventRef)));
    });

    const unsubSeasons = onSnapshot(collection(fs, 'seasons'), snap => {
      if (!snap?.docs) {
        setSeasons([]);
        return;
      }
      setSeasons(snap.docs.map(d => parseSeasonDoc(d.id, d.data() as Record<string, unknown>)));
    });

    const unsubSeasonConfig = onSnapshot(doc(fs, 'appConfig', EVENT_SEASONS_CONFIG_ID), snap => {
      const raw = snap?.exists() ? (snap.data() as { currentSeasonId?: unknown })?.currentSeasonId : null;
      setCurrentSeasonId(typeof raw === 'string' && raw.trim() ? raw.trim() : null);
    });

    const unsubGeofences = onSnapshot(collection(fs, 'geofences'), snap => {
      if (!snap || !snap.docs) {
        setGeofences([]);
        return;
      }
      setGeofences(snap.docs.map(d => ({ id: d.id, ...d.data() } as ScheduleGeofenceRef)));
    });

    return () => {
      unsubShifts();
      unsubUsers();
      unsubEvents();
      unsubSeasons();
      unsubSeasonConfig();
      unsubGeofences();
    };
  }, [fs]);

  const grouped = useMemo(
    () => groupScheduledShiftsByEvent(shifts, events, geofences),
    [shifts, events, geofences]
  );

  const eventCards = useMemo(() => {
    const cards = grouped.groups.map(group => {
      const dayKeys = [...new Set(group.shifts.map(s => s.date).filter(Boolean))].sort();
      return {
        id: group.event.id,
        title: group.event.title || group.event.name || 'Event',
        period: eventPeriodLabel(group.event) || (dayKeys.length ? `${dayKeys[0]} – ${dayKeys[dayKeys.length - 1]}` : ''),
        shifts: group.shifts,
        dayKeys,
        unlinked: false,
        seasonId: group.event.seasonId || null,
      };
    });
    if (grouped.unlinked.length) {
      const dates = [...new Set(grouped.unlinked.map(s => s.date).filter(Boolean))].sort();
      cards.push({
        id: UNLINKED_EVENT_ID,
        title: 'Standalone worksites',
        period: dates.length ? `${dates[0]} – ${dates[dates.length - 1]}` : '',
        shifts: grouped.unlinked,
        dayKeys: dates,
        unlinked: true,
        seasonId: null,
      });
    }
    return cards;
  }, [grouped]);

  const scheduleSplit = useMemo(
    () => splitLiveAndArchived(eventCards.filter(card => !card.unlinked), seasons, currentSeasonId),
    [eventCards, seasons, currentSeasonId]
  );
  const unlinkedCards = useMemo(() => eventCards.filter(card => card.unlinked), [eventCards]);
  const openedScheduleSeason = scheduleSplit.archives.find(archive => archive.season.id === openedSeasonId) ?? null;

  const eventListRows = useMemo(() => {
    if (openedScheduleSeason) {
      return openedScheduleSeason.items.map(card => ({ kind: 'event' as const, card }));
    }
    return [
      ...scheduleSplit.archives.map(archive => ({ kind: 'archive' as const, archive })),
      ...scheduleSplit.live.map(card => ({ kind: 'event' as const, card })),
      ...unlinkedCards.map(card => ({ kind: 'event' as const, card })),
    ];
  }, [openedScheduleSeason, scheduleSplit, unlinkedCards]);

  const selectedEvent = eventCards.find(card => card.id === selectedEventId) || null;
  const eventEmployees = useMemo(
    () => (selectedEvent ? uniqueEmployeesFromShifts(selectedEvent.shifts) : []),
    [selectedEvent]
  );
  const selectedEmployee = eventEmployees.find(emp => emp.userId === selectedUserId) || null;

  const eventGrid = useMemo(() => {
    if (!selectedEvent) return null;
    return buildShiftPlanGrid({
      eventId: selectedEvent.id,
      eventName: selectedEvent.title,
      shifts: selectedEvent.shifts,
      dayKeys: selectedEvent.dayKeys,
    });
  }, [selectedEvent]);

  const personGrid = useMemo(() => {
    if (!selectedEvent || !selectedUserId) return null;
    return buildShiftPlanGrid({
      eventId: selectedEvent.id,
      eventName: selectedEvent.title,
      shifts: selectedEvent.shifts,
      dayKeys: selectedEvent.dayKeys,
      employeeUserId: selectedUserId,
    });
  }, [selectedEvent, selectedUserId]);

  const viewGrid = view === 'person' ? personGrid : eventGrid;

  const exportRange = useMemo(() => {
    const keys = [...new Set((selectedEvent?.shifts || []).map(s => s.date).filter(Boolean))].sort();
    if (keys.length) return { startDate: keys[0], endDate: keys[keys.length - 1] };
    return { startDate: '1970-01-01', endDate: '1970-01-01' };
  }, [selectedEvent]);

  const handleDelete = (id: string) => {
    Alert.alert('Delete Shift', 'Are you sure you want to remove this scheduled shift?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteDoc(doc(fs, 'shifts', id)) },
    ]);
  };

  const handleCellPress = (cell: ShiftPlanCell) => {
    if (cell.empty || cell.shifts.length === 0) return;
    const first = cell.shifts[0];
    if (!first.id) return;
    handleDelete(first.id);
  };

  const runDownload = async () => {
    if (!selectedEvent || !viewGrid) return;
    setDownloadingPdf(true);
    try {
      await downloadSchedulePdfToDevice({
        shifts: selectedEvent.shifts,
        startDate: exportRange.startDate,
        endDate: exportRange.endDate,
        eventName: selectedEvent.title,
        dayKeys: selectedEvent.dayKeys,
        employeeUserId: view === 'person' ? selectedUserId || undefined : undefined,
        grid: viewGrid,
      });
    } catch (err: any) {
      const code = err?.code ? `\n\n(${err.code})` : '';
      Alert.alert('Download failed', `${err?.message || 'Could not save schedule PDF.'}${code}`);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleBack = () => {
    if (view === 'person') {
      setSelectedUserId(null);
      setScheduleViewerVisible(false);
      setView('employees');
      return;
    }
    if (view === 'employees') {
      setSelectedEventId(null);
      setScheduleViewerVisible(false);
      setView('events');
      return;
    }
    if (openedSeasonId) {
      setOpenedSeasonId(null);
      return;
    }
    navigation.goBack();
  };

  const headerTitle =
    view === 'person'
      ? selectedEmployee?.userName || 'Employee'
      : view === 'employees'
        ? selectedEvent?.title || 'Event'
        : openedScheduleSeason
          ? openedScheduleSeason.season.name
          : 'Team Schedule';

  const scheduleActions = view !== 'events' && selectedEvent ? (
    <View style={styles.exportSection}>
      <TouchableOpacity
        style={[styles.viewScheduleBtn, !viewGrid && styles.btnDisabled]}
        onPress={() => setScheduleViewerVisible(true)}
        disabled={!viewGrid}
        activeOpacity={0.85}
      >
        <Text style={styles.viewScheduleBtnText}>View Schedule</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.downloadBtn, downloadingPdf && styles.btnDisabled]}
        onPress={() => void runDownload()}
        disabled={downloadingPdf || !viewGrid}
      >
        {downloadingPdf ? (
          <ActivityIndicator color={PIZZA_FIRE.accent} />
        ) : (
          <Text style={styles.downloadBtnText}>Download / save PDF</Text>
        )}
      </TouchableOpacity>
    </View>
  ) : null;

  const renderEventCard = ({ item }: { item: (typeof eventCards)[number] }) => {
    const employees = uniqueEmployeesFromShifts(item.shifts);
    return (
      <TouchableOpacity
        style={styles.eventCard}
        onPress={() => {
          setSelectedEventId(item.id);
          setSelectedUserId(null);
          setView('employees');
        }}
        activeOpacity={0.85}
      >
        <Text style={styles.eventTitle}>{item.title}</Text>
        {item.period ? <Text style={styles.eventPeriod}>{item.period}</Text> : null}
        <Text style={styles.eventMeta}>
          {employees.length} employee{employees.length === 1 ? '' : 's'} · {item.shifts.length} shift
          {item.shifts.length === 1 ? '' : 's'}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderEmployee = ({ item }: { item: { userId: string; userName: string; shiftCount: number } }) => {
    const user = users.find(u => u.id === item.userId);
    const avatarSource = resolveAvatarSource(user?.avatarUrl, user?.customAvatarUrl);
    return (
      <TouchableOpacity
        style={styles.employeeCard}
        onPress={() => {
          setSelectedUserId(item.userId);
          setView('person');
        }}
        activeOpacity={0.85}
      >
        <Image source={avatarSource} style={styles.cardAvatar} />
        <View style={styles.shiftInfo}>
          <Text style={styles.shiftUser}>{item.userName}</Text>
          <Text style={styles.shiftWorksite}>
            {item.shiftCount} shift{item.shiftCount === 1 ? '' : 's'}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    );
  };

  return (
    <PizzaFireScreen>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack}>
          <Icons.arrowLeft color={PIZZA_FIRE.gold} width={24} height={24} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{headerTitle}</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() =>
            navigation.navigate('AssignShifts', {
              eventId:
                selectedEventId && selectedEventId !== UNLINKED_EVENT_ID
                  ? selectedEventId
                  : undefined,
              userId: selectedUserId || undefined,
            })
          }
        >
          <Icons.plus color={PIZZA_FIRE.gold} width={28} height={28} />
        </TouchableOpacity>
      </View>

      <View style={styles.summaryBar}>
        <Text style={styles.summaryText}>
          {view === 'events'
            ? `${eventCards.length} event${eventCards.length === 1 ? '' : 's'} with shift plans`
            : view === 'employees'
              ? `${eventEmployees.length} employee${eventEmployees.length === 1 ? '' : 's'}`
              : selectedEmployee
                ? `${selectedEmployee.shiftCount} shift${selectedEmployee.shiftCount === 1 ? '' : 's'}`
                : ''}
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={PIZZA_FIRE.accent} style={{ marginTop: 40 }} />
      ) : view === 'events' ? (
        <FlatList
          data={eventListRows}
          keyExtractor={item =>
            item.kind === 'archive' ? `archive-${item.archive.season.id}` : item.card.id
          }
          renderItem={({ item }) => {
            if (item.kind === 'archive') {
              return (
                <TouchableOpacity
                  style={styles.eventCard}
                  onPress={() => setOpenedSeasonId(item.archive.season.id)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.eventPeriod}>Season file</Text>
                  <Text style={styles.eventTitle}>{item.archive.season.name}</Text>
                  <Text style={styles.eventMeta}>
                    {item.archive.items.length} event{item.archive.items.length === 1 ? '' : 's'}
                  </Text>
                </TouchableOpacity>
              );
            }
            return renderEventCard({ item: item.card });
          }}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>No scheduled shifts</Text>
              <Text style={styles.emptySub}>Tap the + button to start planning.</Text>
            </View>
          }
        />
      ) : view === 'employees' ? (
        <FlatList
          data={eventEmployees}
          keyExtractor={item => item.userId}
          renderItem={renderEmployee}
          ListHeaderComponent={scheduleActions}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>No employees on this plan</Text>
            </View>
          }
        />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {scheduleActions}
          {personGrid ? (
            <ShiftPlanGridView
              grid={personGrid}
              onPressEmployee={(userId, userName) => openUserProfile(navigation, { userId, userName })}
              onPressCell={handleCellPress}
            />
          ) : null}
        </ScrollView>
      )}

      <Modal visible={scheduleViewerVisible} transparent animationType="slide" onRequestClose={() => setScheduleViewerVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.viewerCard}>
            <View style={styles.viewerHeader}>
              <Text style={styles.modalTitle} numberOfLines={1}>
                {view === 'person' ? selectedEmployee?.userName || 'Schedule' : selectedEvent?.title || 'Schedule'}
              </Text>
              <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setScheduleViewerVisible(false)}>
                <Text style={styles.modalCloseText}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.viewerScroll}>
              {viewGrid ? (
                <ShiftPlanGridView
                  grid={viewGrid}
                  onPressEmployee={(userId, userName) => {
                    setScheduleViewerVisible(false);
                    openUserProfile(navigation, { userId, userName });
                  }}
                />
              ) : (
                <Text style={styles.emptySub}>No schedule to show.</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </PizzaFireScreen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  title: { color: PIZZA_FIRE.textPrimary, fontSize: 20, fontWeight: '900', flex: 1, textAlign: 'center', marginHorizontal: 8 },
  addBtn: { padding: 4 },
  summaryBar: { backgroundColor: PIZZA_FIRE.inputBg, paddingVertical: 8, paddingHorizontal: 16 },
  summaryText: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  list: { padding: 16, paddingBottom: 40 },
  seasonHeader: { marginBottom: 10, marginTop: 4 },
  seasonHeaderLabel: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  seasonHeaderName: { color: PIZZA_FIRE.gold, fontSize: 18, fontWeight: '900', marginBottom: 4 },
  eventCard: {
    backgroundColor: PIZZA_FIRE.surface,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  eventTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 18, fontWeight: '900' },
  eventPeriod: { color: PIZZA_FIRE.accent, fontSize: 13, fontWeight: '700', marginTop: 6 },
  eventMeta: { color: PIZZA_FIRE.textMuted, fontSize: 13, marginTop: 8 },
  employeeCard: {
    flexDirection: 'row',
    backgroundColor: PIZZA_FIRE.surface,
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  chevron: { color: PIZZA_FIRE.gold, fontSize: 28, fontWeight: '300', marginLeft: 8 },
  exportSection: { marginBottom: 16, gap: 10 },
  viewScheduleBtn: {
    backgroundColor: PIZZA_FIRE.surface,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PIZZA_FIRE.gold,
  },
  viewScheduleBtnText: { color: PIZZA_FIRE.gold, fontSize: 14, fontWeight: '900' },
  downloadBtn: {
    backgroundColor: PIZZA_FIRE.inputBg,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PIZZA_FIRE.accent,
  },
  downloadBtnText: { color: PIZZA_FIRE.accent, fontSize: 14, fontWeight: '900' },
  btnDisabled: { opacity: 0.6 },
  cardAvatar: { width: 50, height: 50, borderRadius: 25, borderWidth: 2, borderColor: PIZZA_FIRE.cardBorder },
  shiftInfo: { flex: 1, marginLeft: 16 },
  shiftUser: { color: PIZZA_FIRE.textPrimary, fontSize: 17, fontWeight: '800', marginBottom: 2 },
  shiftWorksite: {
    color: PIZZA_FIRE.accent,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  emptyContainer: { alignItems: 'center', marginTop: 40 },
  emptyTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  emptySub: { color: PIZZA_FIRE.textMuted, fontSize: 14 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  viewerCard: {
    backgroundColor: PIZZA_FIRE.bgMid,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    paddingBottom: 28,
    maxHeight: '88%',
  },
  viewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  viewerScroll: { paddingBottom: 12 },
  modalTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '800', flex: 1 },
  modalCloseBtn: {
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  modalCloseText: { color: PIZZA_FIRE.accent, fontSize: 14, fontWeight: '800' },
});
