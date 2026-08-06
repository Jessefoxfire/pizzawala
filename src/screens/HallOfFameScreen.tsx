import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, getFirestore, onSnapshot } from '@react-native-firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { resolveAvatarSource } from '../utils/avatar';

type Props = NativeStackScreenProps<RootStackParamList, 'HallOfFame'>;

type Coordinates = { lat: number; lng: number };

type UserRecord = {
  id: string;
  name?: string;
  email?: string;
  lastLocation?: Coordinates | null;
  lastLocationUpdate?: any;
};

type AwardType = 'star' | 'hug' | 'kiss' | 'medal' | 'heart' | 'fire' | 'cool' | 'trophy' | 'crown' | 'pizza';

type AwardRecord = {
  id: string;
  toUserId: string;
  fromUserId: string;
  toUserName?: string;
  fromUserName?: string;
  type: AwardType;
  reason?: string;
  createdAt?: any;
};

const badgeMeta: Record<AwardType, { label: string; icon: string }> = {
  medal: { label: 'Medals', icon: '🏅' },
  star: { label: 'Stars', icon: '⭐' },
  fire: { label: 'Fire', icon: '🔥' },
  heart: { label: 'Hearts', icon: '❤️' },
  cool: { label: 'Cool', icon: 'Cool' },
  trophy: { label: 'Trophy', icon: '🏆' },
  crown: { label: 'Crown', icon: '👑' },
  pizza: { label: 'Pizza', icon: '🍕' },
  hug: { label: 'Hugs', icon: '🤗' },
  kiss: { label: 'Kisses', icon: '💋' },
};

const isRecent = (value: any) => {
  if (!value) return false;
  const lastUpdate = value?.toDate?.() || new Date(value);
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  return lastUpdate > fiveMinutesAgo;
};

export default function HallOfFameScreen({ navigation }: Props) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [awards, setAwards] = useState<AwardRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const fs = getFirestore();

  useEffect(() => {
    const unsubUsers = onSnapshot(collection(fs, 'users'), snap => {
      if (!snap || !snap.docs) {
        setUsers([]);
        setLoading(false);
        return;
      }
      const items = snap.docs.map(docSnap => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<UserRecord, 'id'>),
      }));
      setUsers(items);
      setLoading(false);
    });

    const unsubAwards = onSnapshot(collection(fs, 'awards'), snap => {
      if (!snap || !snap.docs || snap.empty) {
        setAwards([]);
        return;
      }
      const items = snap.docs.map(docSnap => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<AwardRecord, 'id'>),
      }));
      setAwards(items as AwardRecord[]);
    });

    return () => {
      unsubUsers();
      unsubAwards();
    };
  }, [fs]);

  const leaderboard = useMemo(() => {
    const countsByUser: Record<string, Record<AwardType, number>> = {};
    awards.forEach(award => {
      if (!award?.toUserId || !award?.type) return;
      if (!countsByUser[award.toUserId]) {
        countsByUser[award.toUserId] = { 
          star: 0, hug: 0, kiss: 0, medal: 0, 
          heart: 0, fire: 0, cool: 0, trophy: 0, 
          crown: 0, pizza: 0 
        };
      }
      countsByUser[award.toUserId][award.type as AwardType] += 1;
    });

    return users
      .map(user => {
        const counts = countsByUser[user.id] || { 
          star: 0, hug: 0, kiss: 0, medal: 0,
          heart: 0, fire: 0, cool: 0, trophy: 0, 
          crown: 0, pizza: 0 
        };
        const total = Object.values(counts).reduce((acc, val) => acc + val, 0);
        return {
          ...user,
          counts,
          total,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [users, awards]);

  const renderItem = ({ item, index }: { item: any; index: number }) => {
    const label = item.name || item.email || 'Unnamed user';
    const hasLocation = !!item.lastLocation && isRecent(item.lastLocationUpdate);

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Image 
            source={resolveAvatarSource(item.avatarUrl, item.customAvatarUrl)}
            style={styles.avatar} 
          />
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={styles.rank}>#{index + 1}</Text>
              <Text style={styles.name}>{label}</Text>
            </View>
            <Text style={styles.total}>Total Score: {item.total}</Text>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.badgeScroll}>
          <View style={styles.badgeRow}>
            {(Object.keys(badgeMeta) as AwardType[]).map(type => {
              if (item.counts[type] === 0) return null;
              return (
                <View key={type} style={styles.badgeItem}>
                  <Text style={styles.badgeIcon}>{badgeMeta[type].icon}</Text>
                  <Text style={styles.badgeCount}>{item.counts[type]}</Text>
                </View>
              );
            })}
          </View>
        </ScrollView>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, !hasLocation && styles.actionBtnDisabled]}
            onPress={() => {
              if (!hasLocation) return;
              navigation.navigate('TeamMap', { focusUserId: item.id });
            }}
            disabled={!hasLocation}
          >
            <Text style={styles.actionText}>Show Location</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.actionSecondary]}
            onPress={() => navigation.navigate('Chat', { prefillText: `@${label} ` })}
          >
            <Text style={styles.actionText}>Message</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Home</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Hall of Fame</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#F3E6D3" />
        </View>
      ) : (
        <FlatList
          data={leaderboard}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>No users yet.</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#2A211B',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#1E1813',
    borderBottomWidth: 1,
    borderBottomColor: '#3A2D24',
  },
  back: { fontSize: 18, fontWeight: 'bold', color: '#EBDCCB' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#F6EDE2' },
  list: { padding: 16, gap: 12 },
  empty: { textAlign: 'center', marginTop: 40, color: '#A88E73' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: {
    backgroundColor: '#1E1813',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 12,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: '#C9782B',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  rank: {
    fontSize: 14,
    fontWeight: '700',
    color: '#C9782B',
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F6EDE2',
    marginTop: 4,
  },
  total: {
    fontSize: 13,
    color: '#A88E73',
    marginTop: 6,
  },
  badgeScroll: {
    marginVertical: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    paddingRight: 10,
  },
  badgeItem: {
    alignItems: 'center',
  },
  badgeIcon: {
    fontSize: 18,
  },
  badgeCount: {
    fontSize: 12,
    color: '#EBDCCB',
    marginTop: 4,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: '#2E6B5A',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  actionSecondary: {
    backgroundColor: '#5B4B3A',
  },
  actionBtnDisabled: {
    opacity: 0.5,
  },
  actionText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
  },
});
