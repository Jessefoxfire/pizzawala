import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, onSnapshot, query, orderBy, getFirestore } from '@react-native-firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { Icons } from '../components/Icons';
import { resolveAvatarSource } from '../utils/avatar';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminAvailability'>;

type Event = {
  id: string;
  title: string;
  startDate: string;
};

type Availability = {
  userId: string;
  userName: string;
  isAvailable: boolean;
  notes: string;
  updatedAt: any;
};

type UserProfile = {
  id: string;
  avatarUrl?: string;
  customAvatarUrl?: string;
};

export default function AdminAvailabilityScreen({ navigation, route }: Props) {
  const routeEvent = route.params?.event;
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(routeEvent || null);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [userProfiles, setUserProfiles] = useState<Record<string, UserProfile>>({});
  const [loading, setLoading] = useState(true);
  const [loadingAvail, setLoadingAvail] = useState(false);

  useEffect(() => {
    const fs = getFirestore();
    // Listen to all users to get their latest avatars
    const unsubUsers = onSnapshot(collection(fs, 'users'), snap => {
      if (!snap) {
        setUserProfiles({});
        return;
      }
      const profiles: Record<string, UserProfile> = {};
      snap.docs.forEach(d => {
        profiles[d.id] = { id: d.id, ...d.data() } as UserProfile;
      });
      setUserProfiles(profiles);
    });

    // Listen to all events for selection
    const eventsQuery = query(collection(fs, 'events'), orderBy('startDate', 'desc'));
    const unsubEvents = onSnapshot(eventsQuery, snap => {
      if (!snap) {
        setEvents([]);
        setLoading(false);
        return;
      }
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Event));
      setEvents(items);
      setLoading(false);
      
      // If we don't have a selected event yet, pick the first one
      if (!selectedEvent && items.length > 0) {
        setSelectedEvent(items[0]);
      }
    });

    return () => {
      unsubUsers();
      unsubEvents();
    };
  }, []);

  useEffect(() => {
    if (!selectedEvent) return;

    setLoadingAvail(true);
    const fs = getFirestore();
    const q = query(
      collection(fs, 'events', selectedEvent.id, 'availability'),
      orderBy('updatedAt', 'desc')
    );
    
    const unsubAvail = onSnapshot(q, snap => {
      if (!snap) {
        setAvailability([]);
        setLoadingAvail(false);
        return;
      }
      const items = snap.docs.map(d => {
        const data = d.data() as Availability;
        return {
          ...data,
          userId: data.userId || d.id,
        };
      });
      setAvailability(items);
      setLoadingAvail(false);
    });
    
    return () => unsubAvail();
  }, [selectedEvent?.id]);

  const renderAvail = ({ item }: { item: Availability }) => {
    const profile = userProfiles[item.userId];
    const avatarSource = resolveAvatarSource(profile?.avatarUrl, profile?.customAvatarUrl);

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.userRow}>
            <Image source={avatarSource} style={styles.avatar} />
            <Text style={styles.userName}>{item.userName}</Text>
          </View>
          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>Available</Text>
          </View>
        </View>
        
        {item.notes ? (
          <View style={styles.notesBox}>
            <Text style={styles.notesLabel}>Staff Notes:</Text>
            <Text style={styles.notesText}>{item.notes}</Text>
          </View>
        ) : (
          <Text style={styles.noNotes}>No additional notes provided.</Text>
        )}
      </View>
    );
  };

  const renderEventItem = ({ item }: { item: Event }) => (
    <TouchableOpacity 
      style={[styles.eventPill, selectedEvent?.id === item.id && styles.eventPillActive]}
      onPress={() => setSelectedEvent(item)}
    >
      <Text style={[styles.eventPillText, selectedEvent?.id === item.id && styles.eventPillTextActive]}>
        {item.title}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icons.arrowLeft color="#F6EDE2" width={24} height={24} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.title}>Manage Availability</Text>
          <Text style={styles.subtitle}>View staff responses for events</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#C9782B" style={{ marginTop: 40 }} />
      ) : (
        <>
          <View style={styles.eventSelector}>
            <FlatList
              data={events}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={item => item.id}
              renderItem={renderEventItem}
              contentContainerStyle={styles.eventList}
            />
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statVal}>{availability.length}</Text>
              <Text style={styles.statLab}>Total Available</Text>
            </View>
          </View>

          {loadingAvail ? (
            <ActivityIndicator size="small" color="#C9782B" style={{ marginTop: 20 }} />
          ) : (
            <FlatList
              data={availability}
              keyExtractor={(item, index) => item.userId || `availability-${index}`}
              renderItem={renderAvail}
              contentContainerStyle={styles.list}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>
                    {selectedEvent 
                      ? "No one has marked themselves as available for this event yet."
                      : "Select an event to see availability."}
                  </Text>
                </View>
              }
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#2A211B' },
  header: { 
    flexDirection: 'row', 
    padding: 16, 
    backgroundColor: '#1E1813', 
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#3A2D24'
  },
  headerInfo: { flex: 1, marginLeft: 16 },
  title: { color: '#F6EDE2', fontSize: 18, fontWeight: '900' },
  subtitle: { color: '#C9782B', fontSize: 13, fontWeight: '600', marginTop: 2 },
  eventSelector: {
    backgroundColor: '#1E1813',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#3A2D24',
  },
  eventList: { paddingHorizontal: 16, gap: 10 },
  eventPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#2A211B',
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
  eventPillActive: {
    backgroundColor: 'rgba(201, 120, 43, 0.2)',
    borderColor: '#C9782B',
  },
  eventPillText: { color: '#A88E73', fontSize: 13, fontWeight: '700' },
  eventPillTextActive: { color: '#F6EDE2' },
  statsRow: {
    padding: 16,
    backgroundColor: '#1E1813',
    marginBottom: 8,
  },
  statBox: {
    backgroundColor: '#2A211B',
    padding: 16,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
  statVal: { color: '#F6EDE2', fontSize: 24, fontWeight: '900' },
  statLab: { color: '#A88E73', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', marginTop: 4 },
  list: { padding: 16, paddingBottom: 40 },
  card: { 
    backgroundColor: '#1E1813', 
    padding: 16, 
    borderRadius: 16, 
    marginBottom: 12, 
    borderWidth: 1, 
    borderColor: '#3A2D24' 
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  userRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 32, height: 32, borderRadius: 16, marginRight: 12 },
  userName: { color: '#F6EDE2', fontSize: 16, fontWeight: '800' },
  statusBadge: { backgroundColor: 'rgba(76, 175, 80, 0.1)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#4CAF50' },
  statusText: { color: '#4CAF50', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  notesBox: { backgroundColor: '#2A211B', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#3A2D24' },
  notesLabel: { color: '#7C6854', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginBottom: 4 },
  notesText: { color: '#EBDCCB', fontSize: 14, lineHeight: 20 },
  noNotes: { color: '#5A4739', fontStyle: 'italic', fontSize: 13 },
  emptyContainer: { alignItems: 'center', marginTop: 40 },
  emptyText: { color: '#A88E73', fontStyle: 'italic', textAlign: 'center', maxWidth: '80%' },
});
