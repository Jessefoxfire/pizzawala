import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import PizzaFireScreen from '../components/PizzaFireScreen';
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  doc,
  serverTimestamp,
  writeBatch,
  getFirestore,
} from '@react-native-firebase/firestore';
import { auth } from '../services/firebase';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { Icons } from '../components/Icons';
import PizzaFireCalendar from '../components/PizzaFireCalendar';
import { resolveAvatarSource } from '../utils/avatar';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';

type Props = NativeStackScreenProps<RootStackParamList, 'AssignShifts'>;

export default function AssignShiftsScreen({ navigation, route }: Props) {
  const fs = getFirestore();
  const presetEventId = route.params?.eventId;
  const presetUserId = route.params?.userId;
  const [users, setUsers] = useState<any[]>([]);
  const [worksites, setWorksites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form State
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [selectedWorksite, setSelectedWorksite] = useState<any | null>(null);
  const [selectedDates, setSelectedDates] = useState<Record<string, any>>({});
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');

  useEffect(() => {
    const unsubUsers = onSnapshot(query(collection(fs, 'users'), orderBy('name', 'asc')), snap => {
      if (!snap || !snap.docs || snap.empty) {
        setUsers([]);
        return;
      }
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const unsubWorksites = onSnapshot(query(collection(fs, 'geofences'), orderBy('name', 'asc')), snap => {
      if (!snap || !snap.docs || snap.empty) {
        setWorksites([]);
        setLoading(false);
        return;
      }
      setWorksites(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });

    return () => {
      unsubUsers();
      unsubWorksites();
    };
  }, [fs]);

  const onDayPress = (day: any) => {
    const dateStr = day.dateString;
    const newSelected = { ...selectedDates };
    
    if (newSelected[dateStr]) {
      delete newSelected[dateStr];
    } else {
      newSelected[dateStr] = { 
        selected: true, 
        selectedColor: PIZZA_FIRE.accent,
        selectedTextColor: PIZZA_FIRE.charcoal
      };
    }
    setSelectedDates(newSelected);
  };

  const notifyUser = async (userId: string, title: string, body: string) => {
    try {
      await addDoc(collection(fs, `users/${userId}/notifications`), {
        title,
        body,
        createdAt: serverTimestamp(),
        nav: { screen: 'MySchedule', view: 'calendar' }
      });
    } catch (e) {
      console.warn('Notification failed:', e);
    }
  };

  const handleSave = async () => {
    const dateKeys = Object.keys(selectedDates);
    if (!selectedUser || !selectedWorksite || dateKeys.length === 0) {
      Alert.alert('Incomplete', 'Please select a member, worksite, and at least one date.');
      return;
    }

    setSaving(true);
    try {
      const batch = writeBatch(fs);
      dateKeys.forEach(d => {
        const newDocRef = doc(collection(fs, 'shifts'));
        batch.set(newDocRef, {
          userId: selectedUser.id,
          userName: selectedUser.name || selectedUser.email,
          worksiteName: selectedWorksite.name,
          eventId: selectedWorksite.eventId || presetEventId || null,
          geofenceId: selectedWorksite.id || null,
          date: d,
          startTime,
          endTime,
          status: 'scheduled',
          isScheduled: true,
          createdAt: serverTimestamp(),
          createdBy: auth.currentUser?.uid,
        });
      });
      
      await batch.commit();

      // Notify the user
      const dateRange = dateKeys.length > 1 
        ? `${dateKeys.length} days starting ${dateKeys.sort()[0]}` 
        : dateKeys[0];
      
      await notifyUser(
        selectedUser.id,
        'New Shifts Assigned! 🍕',
        `You've been assigned to ${selectedWorksite.name} for ${dateRange} (${startTime} - ${endTime}). Click here to view your schedule.`
      );

      Alert.alert('Success', `Assigned ${dateKeys.length} shifts to ${selectedUser.name}.`);
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <PizzaFireScreen>
        <ActivityIndicator size="large" color={PIZZA_FIRE.accent} style={{ marginTop: 40 }} />
      </PizzaFireScreen>
    );
  }

  return (
    <PizzaFireScreen>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icons.arrowLeft color={PIZZA_FIRE.gold} width={24} height={24} />
        </TouchableOpacity>
        <Text style={styles.title}>Schedule Planner</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionLabel}>1. Select Team Member</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.userPicker}>
          {users.map(u => (
            <TouchableOpacity 
              key={u.id} 
              style={[styles.userItem, selectedUser?.id === u.id && styles.userItemActive]}
              onPress={() => setSelectedUser(u)}
            >
              <Image source={resolveAvatarSource(u.avatarUrl, u.customAvatarUrl)} style={styles.avatar} />
              <Text style={[styles.userName, selectedUser?.id === u.id && styles.userNameActive]} numberOfLines={1}>
                {u.name?.split(' ')[0] || 'Member'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.sectionLabel}>2. Select Worksite</Text>
        <View style={styles.worksiteGrid}>
          {worksites.map(w => (
            <TouchableOpacity 
              key={w.id} 
              style={[styles.worksitePill, selectedWorksite?.id === w.id && styles.worksitePillActive]}
              onPress={() => setSelectedWorksite(w)}
            >
              <Text style={[styles.worksiteText, selectedWorksite?.id === w.id && styles.worksiteTextActive]}>
                {w.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>3. Select Dates (Tap multiple)</Text>
        <PizzaFireCalendar
          minDate={new Date().toISOString().split('T')[0]}
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
          markedDates={selectedDates}
          onDayPress={onDayPress}
          style={styles.calendar}
        />

        <Text style={styles.sectionLabel}>4. Set Shift Times</Text>
        <View style={styles.timeRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.timeLabel}>Start Time</Text>
            <TextInput 
              style={styles.input} 
              value={startTime} 
              onChangeText={setStartTime} 
              placeholder="09:00" 
              placeholderTextColor="#5A4739" 
            />
          </View>
          <View style={{ width: 16 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.timeLabel}>End Time</Text>
            <TextInput 
              style={styles.input} 
              value={endTime} 
              onChangeText={setEndTime} 
              placeholder="17:00" 
              placeholderTextColor="#5A4739" 
            />
          </View>
        </View>

        <TouchableOpacity 
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]} 
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color={PIZZA_FIRE.charcoal} /> : <Text style={styles.saveBtnText}>Assign {Object.keys(selectedDates).length} Shifts</Text>}
        </TouchableOpacity>
        
        <View style={{ height: 40 }} />
      </ScrollView>
    </PizzaFireScreen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, backgroundColor: 'transparent', alignItems: 'center' },
  title: { color: PIZZA_FIRE.textPrimary, fontSize: 18, fontWeight: '900' },
  content: { padding: 16, gap: 12 },
  sectionLabel: { color: PIZZA_FIRE.accent, fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1, marginTop: 12, marginBottom: 4 },
  userPicker: { flexDirection: 'row', marginBottom: 12 },
  userItem: { alignItems: 'center', marginRight: 16, width: 64 },
  avatar: { width: 50, height: 50, borderRadius: 25, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder, backgroundColor: PIZZA_FIRE.surfaceInset },
  userItemActive: { opacity: 1 },
  userName: { fontSize: 11, color: PIZZA_FIRE.textMuted, marginTop: 6, textAlign: 'center' },
  userNameActive: { color: PIZZA_FIRE.accent, fontWeight: 'bold' },
  worksiteGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  worksitePill: { backgroundColor: PIZZA_FIRE.surface, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder },
  worksitePillActive: { borderColor: PIZZA_FIRE.accent, backgroundColor: PIZZA_FIRE.accentSoft },
  worksiteText: { color: PIZZA_FIRE.textMuted, fontSize: 13, fontWeight: '600' },
  worksiteTextActive: { color: PIZZA_FIRE.accent, fontWeight: 'bold' },
  calendar: { borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder, marginBottom: 12 },
  timeRow: { flexDirection: 'row', marginBottom: 24 },
  timeLabel: { color: PIZZA_FIRE.textMuted, fontSize: 10, fontWeight: 'bold', marginBottom: 6 },
  input: { backgroundColor: PIZZA_FIRE.inputBg, color: PIZZA_FIRE.textPrimary, padding: 14, borderRadius: 12, fontSize: 16, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder },
  saveBtn: { backgroundColor: PIZZA_FIRE.hotAccent, paddingVertical: 16, borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: PIZZA_FIRE.hotAccentBorder },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: PIZZA_FIRE.textPrimary, fontWeight: '900', fontSize: 16, textTransform: 'uppercase' },
});
