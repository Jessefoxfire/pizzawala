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
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, addDoc, getDocs, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { Icons } from '../components/Icons';
import { resolveAvatarSource } from '../utils/avatar';
import { Calendar } from 'react-native-calendars';

type Props = NativeStackScreenProps<RootStackParamList, 'ManualShiftEntry'>;

export default function ManualShiftEntryScreen({ navigation }: Props) {
  const [users, setUsers] = useState<any[]>([]);
  const [worksites, setWorksites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form State
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [selectedWorksite, setSelectedWorksite] = useState<any | null>(null);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [showDatePicker, setShowDatePicker] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const uSnap = await getDocs(query(collection(db, 'users'), orderBy('name', 'asc')));
        setUsers(uSnap.docs.map(d => ({ id: d.id, ...d.data() })));

        const wSnap = await getDocs(query(collection(db, 'geofences'), orderBy('name', 'asc')));
        setWorksites(wSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const calculateHours = () => {
    try {
      const start = new Date(`${date}T${startTime}:00`);
      const end = new Date(`${date}T${endTime}:00`);
      const diff = (end.getTime() - start.getTime()) / 3600000;
      return diff > 0 ? diff.toFixed(1) : '0';
    } catch {
      return '0';
    }
  };

  const handleSave = async () => {
    if (!selectedUser || !selectedWorksite || !date || !startTime || !endTime) {
      Alert.alert('Incomplete', 'Please fill in all fields.');
      return;
    }

    const start = new Date(`${date}T${startTime}:00`);
    const end = new Date(`${date}T${endTime}:00`);

    if (end <= start) {
      Alert.alert('Invalid Time', 'End time must be after start time.');
      return;
    }

    setSaving(true);
    try {
      await addDoc(collection(db, 'shifts'), {
        userId: selectedUser.id,
        userName: selectedUser.name || selectedUser.email,
        geofenceId: selectedWorksite.id,
        geofenceName: selectedWorksite.name,
        status: 'closed',
        startAt: start,
        endAt: end,
        manual: true,
        createdAt: serverTimestamp(),
      });
      Alert.alert('Success', 'Shift created successfully.');
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
        <Text style={styles.title}>Manual Shift Entry</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.label}>1. Select Team Member</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.userPicker}>
          {users.map(u => (
            <TouchableOpacity 
              key={u.id} 
              style={[styles.userItem, selectedUser?.id === u.id && styles.userItemActive]}
              onPress={() => setSelectedUser(u)}
            >
              <Image source={resolveAvatarSource(u.avatarUrl, u.customAvatarUrl)} style={styles.avatar} />
              <Text style={[styles.userName, selectedUser?.id === u.id && styles.userNameActive]}>
                {u.name?.split(' ')[0] || 'User'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.label}>2. Select Worksite</Text>
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

        <View style={styles.timeRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Date</Text>
            <TouchableOpacity style={styles.input} onPress={() => setShowDatePicker(true)}>
              <Text style={styles.inputText}>{date}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.timeRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Start Time (HH:MM)</Text>
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
            <Text style={styles.label}>End Time (HH:MM)</Text>
            <TextInput 
              style={styles.input} 
              value={endTime} 
              onChangeText={setEndTime} 
              placeholder="17:00" 
              placeholderTextColor="#5A4739" 
            />
          </View>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total Hours Calculated</Text>
          <Text style={styles.summaryValue}>{calculateHours()}h</Text>
        </View>

        <TouchableOpacity 
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]} 
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color="#1E1813" /> : <Text style={styles.saveBtnText}>Log Manual Shift</Text>}
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={showDatePicker} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.calendarCard}>
            <Calendar
              theme={{
                backgroundColor: '#1E1813',
                calendarBackground: '#1E1813',
                selectedDayBackgroundColor: '#C9782B',
                dayTextColor: '#F6EDE2',
                monthTextColor: '#F6EDE2',
              }}
              onDayPress={(day: any) => { setDate(day.dateString); setShowDatePicker(false); }}
              markedDates={{ [date]: { selected: true, selectedColor: '#C9782B' } }}
            />
            <TouchableOpacity onPress={() => setShowDatePicker(false)} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#2A211B' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, backgroundColor: '#1E1813', alignItems: 'center' },
  title: { color: '#F6EDE2', fontSize: 18, fontWeight: '900' },
  content: { padding: 16, gap: 16 },
  label: { color: '#A88E73', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, marginTop: 12 },
  userPicker: { flexDirection: 'row', marginTop: 8 },
  userItem: { alignItems: 'center', marginRight: 20, width: 60 },
  userItemActive: {},
  avatar: { width: 50, height: 50, borderRadius: 25, borderWidth: 1, borderColor: '#3A2D24' },
  userName: { fontSize: 11, color: '#A88E73', marginTop: 6, textAlign: 'center' },
  userNameActive: { color: '#C9782B', fontWeight: 'bold' },
  worksiteGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  worksitePill: { backgroundColor: '#1E1813', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: '#3A2D24' },
  worksitePillActive: { borderColor: '#C9782B', backgroundColor: 'rgba(201, 120, 43, 0.1)' },
  worksiteText: { color: '#A88E73', fontSize: 14 },
  worksiteTextActive: { color: '#C9782B', fontWeight: 'bold' },
  timeRow: { flexDirection: 'row', marginTop: 8 },
  input: { backgroundColor: '#1E1813', color: '#F6EDE2', padding: 14, borderRadius: 12, fontSize: 16, borderWidth: 1, borderColor: '#3A2D24', justifyContent: 'center' },
  inputText: { color: '#F6EDE2', fontSize: 16 },
  summaryCard: { backgroundColor: '#1E1813', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#C9782B', marginTop: 24, alignItems: 'center' },
  summaryLabel: { color: '#A88E73', fontSize: 12, fontWeight: 'bold' },
  summaryValue: { color: '#C9782B', fontSize: 32, fontWeight: '900', marginTop: 4 },
  saveBtn: { backgroundColor: '#C9782B', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 24, marginBottom: 40 },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#1E1813', fontWeight: '900', fontSize: 16 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 },
  calendarCard: { backgroundColor: '#1E1813', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: '#3A2D24' },
  closeBtn: { marginTop: 16, padding: 12, alignItems: 'center' },
  closeBtnText: { color: '#C9782B', fontWeight: 'bold' },
});
