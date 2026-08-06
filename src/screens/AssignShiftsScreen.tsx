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
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { Calendar } from 'react-native-calendars';
import { resolveAvatarSource } from '../utils/avatar';

type Props = NativeStackScreenProps<RootStackParamList, 'AssignShifts'>;

export default function AssignShiftsScreen({ navigation }: Props) {
  const fs = getFirestore();
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
        selectedColor: '#C9782B',
        selectedTextColor: '#1E1813'
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
      Alert.alert('Incomplete', 'Please select a user, worksite, and at least one date.');
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
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator size="large" color="#C9782B" style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icons.arrowLeft color="#F6EDE2" width={24} height={24} />
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
                {u.name?.split(' ')[0] || 'User'}
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
        <Calendar
          minDate={new Date().toISOString().split('T')[0]}
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
          {saving ? <ActivityIndicator color="#1E1813" /> : <Text style={styles.saveBtnText}>Assign {Object.keys(selectedDates).length} Shifts</Text>}
        </TouchableOpacity>
        
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#2A211B' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, backgroundColor: '#1E1813', alignItems: 'center' },
  title: { color: '#F6EDE2', fontSize: 18, fontWeight: '900' },
  content: { padding: 16, gap: 12 },
  sectionLabel: { color: '#C9782B', fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1, marginTop: 12, marginBottom: 4 },
  userPicker: { flexDirection: 'row', marginBottom: 12 },
  userItem: { alignItems: 'center', marginRight: 16, width: 64 },
  avatar: { width: 50, height: 50, borderRadius: 25, borderWidth: 1, borderColor: '#3A2D24', backgroundColor: '#1E1813' },
  userItemActive: { opacity: 1 },
  userName: { fontSize: 11, color: '#A88E73', marginTop: 6, textAlign: 'center' },
  userNameActive: { color: '#C9782B', fontWeight: 'bold' },
  worksiteGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  worksitePill: { backgroundColor: '#1E1813', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: '#3A2D24' },
  worksitePillActive: { borderColor: '#C9782B', backgroundColor: 'rgba(201, 120, 43, 0.1)' },
  worksiteText: { color: '#A88E73', fontSize: 13, fontWeight: '600' },
  worksiteTextActive: { color: '#C9782B', fontWeight: 'bold' },
  calendar: { borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#3A2D24', marginBottom: 12 },
  timeRow: { flexDirection: 'row', marginBottom: 24 },
  timeLabel: { color: '#A88E73', fontSize: 10, fontWeight: 'bold', marginBottom: 6 },
  input: { backgroundColor: '#1E1813', color: '#F6EDE2', padding: 14, borderRadius: 12, fontSize: 16, borderWidth: 1, borderColor: '#3A2D24' },
  saveBtn: { backgroundColor: '#C9782B', paddingVertical: 16, borderRadius: 14, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#1E1813', fontWeight: '900', fontSize: 16, textTransform: 'uppercase' },
});
