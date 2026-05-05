import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, onSnapshot, query, where, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { Avatars, AvatarKey } from '../../assets/avatars';
import { Icons } from '../components/Icons';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminSchedule'>;

type ScheduledShift = {
  id: string;
  userId: string;
  userName: string;
  worksiteName: string;
  date: string;
  startTime: string;
  endTime: string;
};

export default function AdminScheduleScreen({ navigation }: Props) {
  const [shifts, setShifts] = useState<ScheduledShift[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Listen for scheduled shifts
    const q = query(collection(db, 'shifts'), where('isScheduled', '==', true));
    const unsubShifts = onSnapshot(q, snap => {
      if (!snap || !snap.docs || snap.empty) {
        setShifts([]);
        setLoading(false);
        return;
      }
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as ScheduledShift));
      // Sort by date descending (newest/future first)
      items.sort((a, b) => b.date.localeCompare(a.date));
      setShifts(items);
      setLoading(false);
    });

    // Listen for users (to get avatars)
    const unsubUsers = onSnapshot(collection(db, 'users'), snap => {
      if (!snap || !snap.docs) {
        setUsers([]);
        return;
      }
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubShifts();
      unsubUsers();
    };
  }, []);

  const handleDelete = (id: string) => {
    Alert.alert('Delete Shift', 'Are you sure you want to remove this scheduled shift?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteDoc(doc(db, 'shifts', id)) }
    ]);
  };

  const renderShift = ({ item }: { item: ScheduledShift }) => {
    const user = users.find(u => u.id === item.userId);
    const avatarKey = (user?.avatarUrl as AvatarKey) || 'pizzaMaker';
    const avatarSource = Avatars[avatarKey] || Avatars.pizzaMaker;

    return (
      <View style={styles.shiftCard}>
        <Image source={avatarSource} style={styles.cardAvatar} />
        <View style={styles.shiftInfo}>
          <Text style={styles.shiftUser}>{item.userName}</Text>
          <Text style={styles.shiftWorksite}>{item.worksiteName}</Text>
          <View style={styles.timeBadge}>
            <Text style={styles.shiftTime}>{item.date}  •  {item.startTime} - {item.endTime}</Text>
          </View>
        </View>
        <TouchableOpacity onPress={() => handleDelete(item.id)} style={styles.deleteBtn}>
          <Icons.trash color="#9E3C2E" width={20} height={20} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icons.arrowLeft color="#F6EDE2" width={24} height={24} />
        </TouchableOpacity>
        <Text style={styles.title}>Team Schedule</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => navigation.navigate('AssignShifts')}>
          <Icons.plus color="#C9782B" width={28} height={28} />
        </TouchableOpacity>
      </View>

      <View style={styles.summaryBar}>
        <Text style={styles.summaryText}>{shifts.length} Active Assignments</Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#C9782B" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={shifts}
          keyExtractor={item => item.id}
          renderItem={renderShift}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>No scheduled shifts</Text>
              <Text style={styles.emptySub}>Tap the + button to start planning.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#2A211B' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, backgroundColor: '#1E1813', alignItems: 'center' },
  title: { color: '#F6EDE2', fontSize: 20, fontWeight: '900' },
  addBtn: { padding: 4 },
  summaryBar: { backgroundColor: '#3A2D24', paddingVertical: 8, paddingHorizontal: 16 },
  summaryText: { color: '#A88E73', fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  list: { padding: 16, paddingBottom: 40 },
  shiftCard: { 
    flexDirection: 'row', 
    backgroundColor: '#1E1813', 
    padding: 16, 
    borderRadius: 16, 
    marginBottom: 12, 
    alignItems: 'center', 
    borderWidth: 1, 
    borderColor: '#3A2D24',
  },
  cardAvatar: { width: 50, height: 50, borderRadius: 25, borderWidth: 2, borderColor: '#3A2D24' },
  shiftInfo: { flex: 1, marginLeft: 16 },
  shiftUser: { color: '#F6EDE2', fontSize: 17, fontWeight: '800', marginBottom: 2 },
  shiftWorksite: { color: '#C9782B', fontSize: 13, fontWeight: '700', textTransform: 'uppercase', marginBottom: 8 },
  timeBadge: { backgroundColor: '#2A211B', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, alignSelf: 'flex-start', borderWidth: 1, borderColor: '#3A2D24' },
  shiftTime: { color: '#A88E73', fontSize: 12, fontWeight: '700' },
  deleteBtn: { padding: 8, backgroundColor: 'rgba(158, 60, 46, 0.1)', borderRadius: 10 },
  emptyContainer: { alignItems: 'center', marginTop: 100 },
  emptyTitle: { color: '#F6EDE2', fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  emptySub: { color: '#A88E73', fontSize: 14 },
});
