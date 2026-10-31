import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  ScrollView,
  Dimensions,
  Image,
} from 'react-native';
import { CalendarList } from 'react-native-calendars';
import { 
  collection, 
  onSnapshot, 
  query, 
  where, 
  deleteDoc, 
  doc, 
  updateDoc 
} from 'firebase/firestore';
import { db } from '../services/firebase';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { openUserProfile } from '../navigation/openUserProfile';
import { Avatars, AvatarKey } from '../../assets/avatars';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import PizzaFireScreen from '../components/PizzaFireScreen';
import { CalendarMonthHeader, HIDDEN_CALENDAR_HEADER_THEME, toMonthStartKey } from '../components/PizzaFireCalendar';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminCalendar'>;

type ScheduledShift = {
  id: string;
  userId: string;
  userName: string;
  worksiteName: string;
  date: string;
  startTime: string;
  endTime: string;
  isScheduled: boolean;
};

export default function AdminCalendarScreen({ navigation }: Props) {
  const [shifts, setShifts] = useState<ScheduledShift[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [visibleMonth, setVisibleMonth] = useState(() => toMonthStartKey(new Date()));
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('month');
  
  // Edit Modal State
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingShift, setEditingShift] = useState<ScheduledShift | null>(null);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'shifts'), where('isScheduled', '==', true));
    const unsub = onSnapshot(q, snap => {
      if (!snap || !snap.docs) {
        setShifts([]);
        setLoading(false);
        return;
      }
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as ScheduledShift));
      setShifts(items);
      setLoading(false);
    }, err => {
      console.error('Fetch error:', err);
      setLoading(false);
    });

    const unsubUsers = onSnapshot(collection(db, 'users'), snap => {
      if (!snap || !snap.docs || snap.empty) {
        setUsers([]);
        return;
      }
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsub();
      unsubUsers();
    };
  }, []);

  const shiftsByDate = useMemo(() => {
    const groups: Record<string, ScheduledShift[]> = {};
    shifts.forEach(s => {
      if (!groups[s.date]) groups[s.date] = [];
      groups[s.date].push(s);
    });
    Object.keys(groups).forEach(d => {
      groups[d].sort((a, b) => a.startTime.localeCompare(b.startTime));
    });
    return groups;
  }, [shifts]);

  const handleDelete = async (id: string) => {
    Alert.alert('Delete Shift', 'Are you sure you want to remove this shift?', [
      { text: 'Cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await deleteDoc(doc(db, 'shifts', id));
          setEditModalVisible(false);
        } catch (e) {
          Alert.alert('Notice', 'Unable to delete shift.');
        }
      }}
    ]);
  };

  const openEdit = (shift: ScheduledShift) => {
    setEditingShift(shift);
    setEditStart(shift.startTime);
    setEditEnd(shift.endTime);
    setEditModalVisible(true);
  };

  const handleUpdate = async () => {
    if (!editingShift) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'shifts', editingShift.id), {
        startTime: editStart,
        endTime: editEnd,
      });
      setEditModalVisible(false);
    } catch (e) {
      Alert.alert('Notice', 'Failed to update shift.');
    } finally {
      setSaving(false);
    }
  };

  const DayComponent = ({ date, state }: any) => {
    const dateString = date.dateString;
    const dayShifts = shiftsByDate[dateString] || [];
    const isSelected = selectedDate === dateString;
    const isToday = new Date().toISOString().split('T')[0] === dateString;

    return (
      <TouchableOpacity 
        style={[styles.dayContainer, isSelected && styles.daySelected]} 
        onPress={() => {
          setSelectedDate(dateString);
          setViewMode('day');
        }}
      >
        <Text style={[
          styles.dayText, 
          state === 'disabled' && styles.dayDisabled,
          isToday && styles.todayText,
          isSelected && styles.daySelectedText
        ]}>
          {date.day}
        </Text>
        <View style={styles.pillContainer}>
          {dayShifts.slice(0, 4).map(s => (
            <View key={s.id} style={styles.pill}>
              <Text style={styles.pillText} numberOfLines={1}>
                {s.userName.split(' ')[0]}
              </Text>
            </View>
          ))}
          {dayShifts.length > 4 && (
            <Text style={styles.moreText}>+{dayShifts.length - 4}</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const format12hr = (time24: string) => {
    if (!time24) return '';
    const [h, m] = time24.split(':').map(Number);
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 || 12;
    return `${h12}.${m.toString().padStart(2, '0')}${ampm}`;
  };

  const getDuration = (start: string, end: string) => {
    const [h1, m1] = start.split(':').map(Number);
    const [h2, m2] = end.split(':').map(Number);
    let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (diff < 0) diff += 24 * 60;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  const renderShiftItem = ({ item }: { item: ScheduledShift }) => {
    const user = users.find(u => u.id === item.userId);
    const avatarKey = (user?.avatarUrl as AvatarKey) || 'man-1';

    return (
      <View style={styles.shiftCard}>
        <TouchableOpacity
          onPress={() => openUserProfile(navigation, { userId: item.userId, userName: item.userName })}
          activeOpacity={0.85}
        >
          <Image source={Avatars[avatarKey]} style={styles.cardAvatar} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.shiftInfo} onPress={() => openEdit(item)} activeOpacity={0.85}>
          <Text style={styles.shiftUser}>{item.userName}</Text>
          <Text style={styles.shiftWorksite}>{item.worksiteName}</Text>
          <View style={styles.timeRow}>
            <Text style={styles.shiftTimeRange}>
              {format12hr(item.startTime)} - {format12hr(item.endTime)}
            </Text>
            <Text style={styles.durationLabel}>Duration: {getDuration(item.startTime, item.endTime)}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleDelete(item.id)}>
          <Text style={styles.deleteLink}>Delete</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const getWeekDays = () => {
    const days = [];
    const current = new Date(selectedDate);
    // Start from Monday (1). Sunday is 0.
    const day = current.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    current.setDate(current.getDate() + diff);
    for (let i = 0; i < 7; i++) {
      days.push(new Date(current).toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }
    return days;
  };

  return (
    <PizzaFireScreen>
    <View style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Schedule Overview</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.viewSelector}>
        {(['day', 'week', 'month'] as const).map(mode => (
          <TouchableOpacity 
            key={mode} 
            style={[styles.modeBtn, viewMode === mode && styles.modeBtnActive]}
            onPress={() => setViewMode(mode)}
          >
            <Text style={[styles.modeBtnText, viewMode === mode && styles.modeBtnTextActive]}>
              {mode.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={PIZZA_FIRE.accent} style={{ marginTop: 40 }} />
        ) : viewMode === 'month' ? (
          <View style={styles.monthView}>
            <View style={styles.monthNav}>
              <CalendarMonthHeader monthKey={visibleMonth} onChange={setVisibleMonth} />
            </View>
            <CalendarList
              key={visibleMonth}
              current={visibleMonth}
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
                ...HIDDEN_CALENDAR_HEADER_THEME,
              }}
              hideArrows
              renderHeader={() => null}
              pastScrollRange={0}
              futureScrollRange={0}
              scrollEnabled={false}
              firstDay={1}
              dayComponent={DayComponent}
              style={[styles.calendar, { height: CAL_HEIGHT }]}
              calendarHeight={CAL_HEIGHT}
            />
          </View>
        ) : viewMode === 'week' ? (
          <ScrollView style={styles.weekScroll}>
            {getWeekDays().map(date => {
              const dayShifts = shiftsByDate[date] || [];
              const isSelected = date === selectedDate;
              return (
                <View key={date} style={[styles.weekDayRow, isSelected && { borderColor: PIZZA_FIRE.accent, backgroundColor: 'rgba(201,120,43,0.05)' }]}>
                  <TouchableOpacity style={styles.weekDayLabel} onPress={() => setSelectedDate(date)}>
                    <Text style={[styles.weekDayNum, isSelected && { color: PIZZA_FIRE.accent }]}>{date.split('-')[2]}</Text>
                    <Text style={styles.weekDayName}>{new Date(date).toLocaleDateString('en-US', { weekday: 'short' })}</Text>
                  </TouchableOpacity>
                  <View style={styles.weekShifts}>
                    {dayShifts.length === 0 ? (
                      <Text style={styles.emptySmall}>No shifts</Text>
                    ) : (
                      dayShifts.map(s => (
                        <TouchableOpacity key={s.id} style={styles.weekPill} onPress={() => openEdit(s)}>
                          <Text style={styles.weekPillText} numberOfLines={1}>{s.userName.split(' ')[0]} @ {s.startTime}</Text>
                        </TouchableOpacity>
                      ))
                    )}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        ) : (
          <View style={styles.dayView}>
            <View style={styles.dayHeader}>
              <Text style={styles.dayTitle}>{new Date(selectedDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</Text>
            </View>
            <FlatList
              data={shiftsByDate[selectedDate] || []}
              renderItem={renderShiftItem}
              keyExtractor={item => item.id}
              ListEmptyComponent={<Text style={styles.empty}>No shifts scheduled for this day.</Text>}
              contentContainerStyle={{ padding: 16 }}
            />
          </View>
        )}
      </View>

      <Modal visible={editModalVisible} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Shift</Text>
              <TouchableOpacity onPress={() => handleDelete(editingShift?.id || '')}>
                <Text style={styles.deleteBtnText}>Delete Shift</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>{editingShift?.userName} @ {editingShift?.worksiteName}</Text>
            <Text style={styles.modalSub}>{editingShift?.date}</Text>

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Start Time</Text>
                <TextInput 
                  style={styles.input} 
                  value={editStart} 
                  onChangeText={setEditStart} 
                />
              </View>
              <View style={{ width: 16 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>End Time</Text>
                <TextInput 
                  style={styles.input} 
                  value={editEnd} 
                  onChangeText={setEditEnd} 
                />
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity 
                onPress={() => setEditModalVisible(false)} 
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={handleUpdate} 
                style={styles.saveBtn}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color={PIZZA_FIRE.charcoal} /> : <Text style={styles.saveBtnText}>Update</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
    </PizzaFireScreen>
  );
}

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
const CAL_HEIGHT = SCREEN_HEIGHT - 232;
const DAY_H = Math.floor(CAL_HEIGHT / 6);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, backgroundColor: 'transparent', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: PIZZA_FIRE.divider },
  back: { color: PIZZA_FIRE.gold, fontSize: 16 },
  title: { color: PIZZA_FIRE.textPrimary, fontSize: 18, fontWeight: '800' },
  createBtn: { color: PIZZA_FIRE.accent, fontSize: 16, fontWeight: 'bold' },
  viewSelector: { flexDirection: 'row', backgroundColor: PIZZA_FIRE.bgMid, padding: 8, borderBottomWidth: 1, borderBottomColor: PIZZA_FIRE.divider },
  modeBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  modeBtnActive: { backgroundColor: PIZZA_FIRE.inputBg },
  modeBtnText: { color: PIZZA_FIRE.textMuted, fontSize: 12, fontWeight: 'bold' },
  modeBtnTextActive: { color: PIZZA_FIRE.accent },
  content: { flex: 1 },
  monthView: { flex: 1 },
  monthNav: {
    paddingHorizontal: 8,
  },
  calendar: { 
    width: '100%',
  },
  dayContainer: {
    height: DAY_H,
    width: SCREEN_WIDTH / 7 - 4,
    padding: 2,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  daySelected: { backgroundColor: PIZZA_FIRE.inputBg },
  dayText: { color: PIZZA_FIRE.textPrimary, fontSize: 14, fontWeight: '600' },
  dayDisabled: { color: '#3A2D24' },
  todayText: { color: PIZZA_FIRE.accent },
  daySelectedText: { color: PIZZA_FIRE.accent, fontWeight: 'bold' },
  pillContainer: { width: '100%', gap: 2, marginTop: 4 },
  pill: { backgroundColor: PIZZA_FIRE.accent, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2, width: '100%' },
  pillText: { color: PIZZA_FIRE.charcoal, fontSize: 9, fontWeight: '800', textAlign: 'center' },
  moreText: { color: PIZZA_FIRE.textMuted, fontSize: 9, textAlign: 'center', marginTop: 2 },
  dayView: { flex: 1 },
  dayHeader: { padding: 16, borderBottomWidth: 1, borderBottomColor: PIZZA_FIRE.divider },
  dayTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '700' },
  shiftCard: { flexDirection: 'row', backgroundColor: PIZZA_FIRE.surface, padding: 16, borderRadius: 16, marginBottom: 12, alignItems: 'center', borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder },
  cardAvatar: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: PIZZA_FIRE.accent },
  shiftInfo: { flex: 1, marginLeft: 16 },
  shiftUser: { color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '900' },
  shiftWorksite: { color: PIZZA_FIRE.textMuted, fontSize: 13, marginBottom: 6 },
  timeRow: { flexDirection: 'column' },
  shiftTimeRange: { color: PIZZA_FIRE.accent, fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
  durationLabel: { color: PIZZA_FIRE.textMuted, fontSize: 11, marginTop: 2, fontStyle: 'italic' },
  deleteLink: { color: '#9E3C2E', fontSize: 12, fontWeight: 'bold', marginLeft: 8 },
  weekScroll: { flex: 1, padding: 16 },
  weekDayRow: { flexDirection: 'row', backgroundColor: PIZZA_FIRE.surface, borderRadius: 12, marginBottom: 8, padding: 12, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder },
  weekDayLabel: { width: 50, alignItems: 'center', borderRightWidth: 1, borderRightColor: '#3A2D24', marginRight: 12 },
  weekDayNum: { color: PIZZA_FIRE.textPrimary, fontSize: 18, fontWeight: '900' },
  weekDayName: { color: PIZZA_FIRE.textMuted, fontSize: 10, textTransform: 'uppercase' },
  weekShifts: { flex: 1, gap: 4 },
  weekPill: { backgroundColor: PIZZA_FIRE.accent, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  weekPillText: { color: PIZZA_FIRE.charcoal, fontSize: 11, fontWeight: '800' },
  empty: { color: PIZZA_FIRE.textMuted, textAlign: 'center', marginTop: 40 },
  emptySmall: { color: PIZZA_FIRE.textMuted, fontSize: 11, fontStyle: 'italic', marginTop: 8 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: PIZZA_FIRE.bgMid, borderRadius: 20, padding: 24, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 20, fontWeight: '800' },
  deleteBtnText: { color: '#9E3C2E', fontSize: 13, fontWeight: 'bold' },
  modalSub: { color: PIZZA_FIRE.textMuted, fontSize: 14, marginBottom: 4 },
  label: { color: PIZZA_FIRE.textMuted, fontSize: 12, textTransform: 'uppercase', marginBottom: 8, marginTop: 16, fontWeight: '700' },
  input: { backgroundColor: PIZZA_FIRE.inputBg, color: PIZZA_FIRE.textPrimary, padding: 12, borderRadius: 8 },
  row: { flexDirection: 'row' },
  modalActions: { flexDirection: 'row', marginTop: 24, gap: 12 },
  cancelBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  cancelBtnText: { color: PIZZA_FIRE.textMuted, fontWeight: 'bold' },
  saveBtn: { flex: 2, backgroundColor: PIZZA_FIRE.accent, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  saveBtnText: { color: PIZZA_FIRE.charcoal, fontWeight: 'bold' },
});
