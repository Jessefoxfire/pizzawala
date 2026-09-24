import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Image,
  Modal,
} from 'react-native';
import { addDoc, collection, doc, getFirestore, onSnapshot, serverTimestamp, updateDoc } from '@react-native-firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { Icons } from '../components/Icons';
import { resolveAvatarSource } from '../utils/avatar';
import { openUserProfile } from '../navigation/openUserProfile';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import PizzaFireScreen from '../components/PizzaFireScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminAvailability'>;

type Event = {
  id: string;
  title: string;
  sortDate?: string;
  startDate?: string;
  staffIds?: string[];
  adminConfirmedStaffIds?: string[];
};

type Availability = {
  userId: string;
  userName: string;
  isAvailable: boolean;
  attendanceStatus?: 'confirmed' | 'declined';
  notes: string;
  updatedAt: any;
};

type UserProfile = {
  id: string;
  name?: string;
  avatarUrl?: string;
  customAvatarUrl?: string;
};

type OverviewPerson = Availability & {
  status: 'selected' | 'confirmed' | 'declined' | 'available';
  selectedByAdmin: boolean;
};

export default function AdminAvailabilityScreen({ navigation, route }: Props) {
  const routeEvent = route.params?.event as Event | undefined;
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(routeEvent || null);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [userProfiles, setUserProfiles] = useState<Record<string, UserProfile>>({});
  const [loading, setLoading] = useState(true);
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [memberPickerVisible, setMemberPickerVisible] = useState(false);

  useEffect(() => {
    if (routeEvent?.id) setSelectedEvent(routeEvent);
  }, [routeEvent?.id]);

  useEffect(() => {
    const fs = getFirestore();
    const unsubUsers = onSnapshot(collection(fs, 'users'), snap => {
      const profiles: Record<string, UserProfile> = {};
      snap?.docs.forEach(d => {
        profiles[d.id] = { id: d.id, ...d.data() } as UserProfile;
      });
      setUserProfiles(profiles);
    });

    // Current events use sortDate/days, while older events use startDate.
    // Ordering in Firestore by startDate excluded the newer records entirely.
    const unsubEvents = onSnapshot(collection(fs, 'events'), snap => {
      const items = (snap?.docs || [])
        .map(d => ({ id: d.id, ...d.data() } as Event))
        .sort((a, b) => String(b.sortDate || b.startDate || '').localeCompare(String(a.sortDate || a.startDate || '')));
      setEvents(items);
      setLoading(false);
      setSelectedEvent(current => current ? (items.find(item => item.id === current.id) || current) : (items[0] || null));
    });

    return () => {
      unsubUsers();
      unsubEvents();
    };
  }, []);

  useEffect(() => {
    if (!selectedEvent) {
      setAvailability([]);
      return;
    }
    setLoadingAvail(true);
    const unsub = onSnapshot(
      collection(getFirestore(), 'events', selectedEvent.id, 'availability'),
      snap => {
        setAvailability((snap?.docs || []).map(d => {
          const data = d.data() as Availability;
          return { ...data, userId: data.userId || d.id };
        }));
        setLoadingAvail(false);
      },
      () => {
        setAvailability([]);
        setLoadingAvail(false);
      }
    );
    return () => unsub();
  }, [selectedEvent?.id]);

  const overviewPeople = useMemo<OverviewPerson[]>(() => {
    if (!selectedEvent) return [];
    const availabilityByUser = new Map(availability.map(item => [item.userId, item]));
    const selectedIds = Array.from(new Set(selectedEvent.staffIds || []));
    const adminConfirmed = new Set(selectedEvent.adminConfirmedStaffIds || []);
    const selected = selectedIds.map(userId => {
      const response = availabilityByUser.get(userId);
      const status: OverviewPerson['status'] = response?.attendanceStatus === 'declined'
        ? 'declined'
        : response?.attendanceStatus === 'confirmed' || adminConfirmed.has(userId)
          ? 'confirmed'
          : 'selected';
      return {
        userId,
        userName: response?.userName || userProfiles[userId]?.name || 'Team member',
        isAvailable: false,
        notes: response?.notes || '',
        updatedAt: response?.updatedAt,
        attendanceStatus: response?.attendanceStatus,
        status,
        selectedByAdmin: true,
      };
    });
    const available = availability
      .filter(item => !selectedIds.includes(item.userId) && item.isAvailable)
      .map(item => ({ ...item, status: 'available' as const, selectedByAdmin: false }));
    return [...selected, ...available];
  }, [availability, selectedEvent, userProfiles]);

  const counts = useMemo(() => ({
    selected: overviewPeople.filter(item => item.selectedByAdmin).length,
    confirmed: overviewPeople.filter(item => item.status === 'confirmed').length,
    pending: overviewPeople.filter(item => item.status === 'selected').length,
  }), [overviewPeople]);

  const notifyNewAssignments = async (userIds: string[]) => {
    if (!selectedEvent || userIds.length === 0) return;
    const fs = getFirestore();
    await Promise.allSettled(userIds.map(userId => addDoc(collection(fs, 'users', userId, 'notifications'), {
      title: 'Event confirmation needed',
      body: `You have been selected for ${selectedEvent.title}. Please confirm if you can attend.`,
      nav: { screen: 'Events', eventId: selectedEvent.id },
      createdAt: serverTimestamp(),
    })));
  };

  const cycleMemberSelection = async (userId: string) => {
    if (!selectedEvent) return;
    const staffIds = selectedEvent.staffIds || [];
    const confirmed = new Set(selectedEvent.adminConfirmedStaffIds || []);
    const isSelected = staffIds.includes(userId);
    const nextStaffIds = !isSelected
      ? [...staffIds, userId]
      : confirmed.has(userId)
        ? staffIds.filter(id => id !== userId)
        : staffIds;
    if (isSelected && confirmed.has(userId)) confirmed.delete(userId);
    else if (isSelected) confirmed.add(userId);
    try {
      await updateDoc(doc(getFirestore(), 'events', selectedEvent.id), {
        staffIds: nextStaffIds,
        adminConfirmedStaffIds: Array.from(confirmed).filter(id => nextStaffIds.includes(id)),
      });
      if (!isSelected) await notifyNewAssignments([userId]);
    } catch {
      // The event listener will retain the current state if the update is rejected.
    }
  };

  const selectAllMembers = async () => {
    if (!selectedEvent) return;
    const existing = new Set(selectedEvent.staffIds || []);
    const newlySelected = Object.keys(userProfiles).filter(userId => !existing.has(userId));
    if (newlySelected.length === 0) return;
    try {
      await updateDoc(doc(getFirestore(), 'events', selectedEvent.id), {
        staffIds: [...existing, ...newlySelected],
      });
      await notifyNewAssignments(newlySelected);
    } catch {
      // Keep the picker open so the admin can retry.
    }
  };

  const renderPerson = ({ item }: { item: OverviewPerson }) => {
    const profile = userProfiles[item.userId];
    const isConfirmed = item.status === 'confirmed';
    const isDeclined = item.status === 'declined';
    const statusLabel = isConfirmed ? 'Confirmed' : isDeclined ? 'Can’t make it' : item.status === 'selected' ? 'Selected' : 'Available';
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <TouchableOpacity style={styles.userRow} onPress={() => openUserProfile(navigation, { userId: item.userId, userName: item.userName })} activeOpacity={0.85}>
            <Image source={resolveAvatarSource(profile?.avatarUrl, profile?.customAvatarUrl)} style={styles.avatar} />
            <Text style={styles.userName}>{item.userName}</Text>
          </TouchableOpacity>
          {item.selectedByAdmin ? (
            <TouchableOpacity
              style={[styles.statusBadge, isConfirmed && styles.statusBadgeConfirmed, isDeclined && styles.statusBadgeDeclined]}
              onPress={() => void cycleMemberSelection(item.userId)}
            >
              <Text style={[styles.statusText, isConfirmed && styles.statusTextConfirmed, isDeclined && styles.statusTextDeclined]}>
                {isConfirmed ? '✓' : '✓'} {statusLabel}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.statusBadge}><Text style={styles.statusText}>{statusLabel}</Text></View>
          )}
        </View>
        {item.notes ? <View style={styles.notesBox}><Text style={styles.notesLabel}>Staff Notes:</Text><Text style={styles.notesText}>{item.notes}</Text></View> : null}
      </View>
    );
  };

  return (
    <PizzaFireScreen>
      <View style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}><Icons.arrowLeft color={PIZZA_FIRE.gold} width={24} height={24} /></TouchableOpacity>
          <View style={styles.headerInfo}><Text style={styles.title}>Manage Availability</Text><Text style={styles.subtitle}>Selected and confirmed staff</Text></View>
        </View>
        {loading ? <ActivityIndicator size="large" color={PIZZA_FIRE.accent} style={{ marginTop: 40 }} /> : <>
          <View style={styles.eventSelector}>
            <FlatList data={events} horizontal showsHorizontalScrollIndicator={false} keyExtractor={item => item.id} renderItem={({ item }) => <TouchableOpacity style={[styles.eventPill, selectedEvent?.id === item.id && styles.eventPillActive]} onPress={() => setSelectedEvent(item)}><Text style={[styles.eventPillText, selectedEvent?.id === item.id && styles.eventPillTextActive]}>{item.title}</Text></TouchableOpacity>} contentContainerStyle={styles.eventList} />
          </View>
          <View style={styles.statsRow}>
            <View style={styles.statBox}><Text style={styles.statVal}>{counts.selected}</Text><Text style={styles.statLab}>Selected</Text></View>
            <View style={styles.statBox}><Text style={[styles.statVal, styles.confirmedValue]}>{counts.confirmed}</Text><Text style={styles.statLab}>Confirmed</Text></View>
            <View style={styles.statBox}><Text style={styles.statVal}>{counts.pending}</Text><Text style={styles.statLab}>Pending</Text></View>
          </View>
          {loadingAvail ? <ActivityIndicator size="small" color={PIZZA_FIRE.accent} style={{ marginTop: 20 }} /> : <FlatList data={overviewPeople} keyExtractor={item => item.userId} renderItem={({ item, index }) => <View>{renderPerson({ item })}{item.selectedByAdmin && index === counts.selected - 1 ? <TouchableOpacity style={styles.addMemberBtn} onPress={() => setMemberPickerVisible(true)}><Text style={styles.addMemberBtnText}>+ Add Member</Text></TouchableOpacity> : null}</View>} contentContainerStyle={styles.list} ListEmptyComponent={<View style={styles.emptyContainer}><Text style={styles.emptyText}>{selectedEvent ? 'No members have been selected for this event yet.' : 'Select an event to see availability.'}</Text>{selectedEvent ? <TouchableOpacity style={styles.addMemberBtn} onPress={() => setMemberPickerVisible(true)}><Text style={styles.addMemberBtnText}>+ Add Member</Text></TouchableOpacity> : null}</View>} />}
        </>}
        <Modal visible={memberPickerVisible} transparent animationType="fade" onRequestClose={() => setMemberPickerVisible(false)}>
          <View style={styles.modalBg}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Add or confirm members</Text>
              <TouchableOpacity style={styles.selectAllBtn} onPress={() => void selectAllMembers()}><Text style={styles.selectAllText}>Select all members</Text></TouchableOpacity>
              <FlatList
                data={Object.values(userProfiles).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))}
                keyExtractor={item => item.id}
                style={styles.memberPickerList}
                renderItem={({ item }) => {
                  const isSelected = (selectedEvent?.staffIds || []).includes(item.id);
                  const isConfirmed = (selectedEvent?.adminConfirmedStaffIds || []).includes(item.id);
                  return <TouchableOpacity style={[styles.memberPickerItem, isSelected && styles.memberPickerItemSelected, isConfirmed && styles.memberPickerItemConfirmed]} onPress={() => void cycleMemberSelection(item.id)}>
                    <Image source={resolveAvatarSource(item.avatarUrl, item.customAvatarUrl)} style={styles.avatar} />
                    <Text style={[styles.memberPickerName, isSelected && styles.memberPickerNameSelected, isConfirmed && styles.memberPickerNameConfirmed]}>{item.name || 'Team member'}</Text>
                    {isSelected ? <Text style={[styles.memberTick, isConfirmed && styles.memberTickConfirmed]}>✓</Text> : null}
                  </TouchableOpacity>;
                }}
              />
              <TouchableOpacity style={styles.closePickerBtn} onPress={() => setMemberPickerVisible(false)}><Text style={styles.closePickerText}>Done</Text></TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </PizzaFireScreen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: { flexDirection: 'row', padding: 16, backgroundColor: 'transparent', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: PIZZA_FIRE.divider },
  headerInfo: { flex: 1, marginLeft: 16 },
  title: { color: PIZZA_FIRE.textPrimary, fontSize: 18, fontWeight: '900' },
  subtitle: { color: PIZZA_FIRE.accent, fontSize: 13, fontWeight: '600', marginTop: 2 },
  eventSelector: { backgroundColor: PIZZA_FIRE.surface, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: PIZZA_FIRE.divider },
  addMemberBtn: { alignSelf: 'center', marginTop: 2, marginBottom: 14, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: PIZZA_FIRE.qlBorder, backgroundColor: PIZZA_FIRE.qlFill },
  addMemberBtnText: { color: PIZZA_FIRE.accent, fontSize: 12, fontWeight: '800' },
  eventList: { paddingHorizontal: 16, gap: 10 },
  eventPill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: PIZZA_FIRE.surfaceInset, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder },
  eventPillActive: { backgroundColor: PIZZA_FIRE.accentSoftStrong, borderColor: PIZZA_FIRE.accent },
  eventPillText: { color: PIZZA_FIRE.textMuted, fontSize: 13, fontWeight: '700' },
  eventPillTextActive: { color: PIZZA_FIRE.textPrimary },
  statsRow: { flexDirection: 'row', padding: 16, gap: 8, backgroundColor: PIZZA_FIRE.surface, marginBottom: 8 },
  statBox: { flex: 1, backgroundColor: PIZZA_FIRE.surfaceInset, padding: 12, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder },
  statVal: { color: PIZZA_FIRE.textPrimary, fontSize: 22, fontWeight: '900' },
  confirmedValue: { color: '#4CAF50' },
  statLab: { color: PIZZA_FIRE.textMuted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginTop: 4 },
  list: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: PIZZA_FIRE.surface, padding: 16, borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  userRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatar: { width: 32, height: 32, borderRadius: 16, marginRight: 12 },
  userName: { color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '800' },
  statusBadge: { backgroundColor: 'rgba(201, 120, 43, 0.12)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: PIZZA_FIRE.accent },
  statusBadgeConfirmed: { backgroundColor: 'rgba(76, 175, 80, 0.12)', borderColor: '#4CAF50' },
  statusBadgeDeclined: { backgroundColor: 'rgba(255, 69, 58, 0.20)', borderColor: 'rgba(255, 160, 150, 0.75)' },
  statusText: { color: PIZZA_FIRE.accent, fontSize: 11, fontWeight: '800' },
  statusTextConfirmed: { color: '#4CAF50' },
  statusTextDeclined: { color: '#FFB4AD' },
  notesBox: { backgroundColor: PIZZA_FIRE.surfaceInset, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder, marginTop: 6 },
  notesLabel: { color: PIZZA_FIRE.textMuted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginBottom: 4 },
  notesText: { color: PIZZA_FIRE.textSecondary, fontSize: 14, lineHeight: 20 },
  emptyContainer: { alignItems: 'center', marginTop: 40 },
  emptyText: { color: PIZZA_FIRE.textMuted, fontStyle: 'italic', textAlign: 'center', maxWidth: '80%' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.80)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: PIZZA_FIRE.bgMid, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder, maxHeight: '80%' },
  modalTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 17, fontWeight: '900', marginBottom: 12 },
  selectAllBtn: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: PIZZA_FIRE.qlFill, borderWidth: 1, borderColor: PIZZA_FIRE.qlBorder, marginBottom: 8 },
  selectAllText: { color: PIZZA_FIRE.accent, fontSize: 12, fontWeight: '800' },
  memberPickerList: { maxHeight: 380 },
  memberPickerItem: { flexDirection: 'row', alignItems: 'center', padding: 9, borderRadius: 9, marginBottom: 3 },
  memberPickerItemSelected: { backgroundColor: 'rgba(201, 120, 43, 0.15)' },
  memberPickerItemConfirmed: { backgroundColor: 'rgba(76, 175, 80, 0.12)' },
  memberPickerName: { flex: 1, color: PIZZA_FIRE.textMuted, fontSize: 14 },
  memberPickerNameSelected: { color: PIZZA_FIRE.textPrimary, fontWeight: '700' },
  memberPickerNameConfirmed: { color: '#4CAF50' },
  memberTick: { color: PIZZA_FIRE.accent, fontSize: 16, fontWeight: '900' },
  memberTickConfirmed: { color: '#4CAF50', borderWidth: 1, borderColor: '#4CAF50', borderRadius: 10, width: 20, height: 20, textAlign: 'center', lineHeight: 18 },
  closePickerBtn: { alignSelf: 'flex-end', marginTop: 12, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, backgroundColor: PIZZA_FIRE.accent },
  closePickerText: { color: PIZZA_FIRE.charcoal, fontWeight: '900' },
});
