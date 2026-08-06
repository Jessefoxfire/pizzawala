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
  TextInput,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  collection,
  getFirestore,
  onSnapshot,
} from '@react-native-firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import {
  calcWorkedMs,
  calcWorkedMsInRange,
  getTimestampMs,
  shiftOverlapsRange,
  type LiveShift,
} from '../services/shifts';
import { Avatars, AvatarKey } from '../../assets/avatars';

type Props = NativeStackScreenProps<RootStackParamList, 'WorksiteOverview'>;

type ShiftRecord = LiveShift & {
  geofenceId?: string;
  geofenceName?: string;
};

type WorksiteStats = {
  id: string;
  name: string;
  totalHours: number;
  activePeople: number;
  totalShifts: number;
};

type MemberStats = {
  userId: string;
  userName: string;
  avatarUrl: string;
  totalHours: number;
  isOnline: boolean;
};

export default function WorksiteOverviewScreen({ navigation }: Props) {
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [auditUserId, setAuditUserId] = useState<string | null>(null);
  const [auditPeriod, setAuditPeriod] = useState<'today' | 'week' | 'month' | 'all' | 'custom'>('all');
  const [customStart, setCustomStart] = useState(new Date().toISOString().split('T')[0]);
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fs = getFirestore();
    const unsubShifts = onSnapshot(collection(fs, 'shifts'), snap => {
      const items = (snap?.docs || [])
        .map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as ShiftRecord))
        .filter(shift => !shift.isScheduled);
      setShifts(items);
    });

    const unsubUsers = onSnapshot(collection(fs, 'users'), snap => {
      if (!snap?.docs) {
        setUsers([]);
        setLoading(false);
        return;
      }
      const items = snap.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
      setUsers(items);
      setLoading(false);
    });

    return () => {
      unsubShifts();
      unsubUsers();
    };
  }, []);

  const activeShifts = useMemo(() => {
    return shifts
      .filter(s => s.status === 'open')
      .map(s => {
        const user = users.find(u => u.id === s.userId);
        return {
          ...s,
          user,
        };
      })
      .sort((a, b) => getTimestampMs(b.startAt) - getTimestampMs(a.startAt));
  }, [shifts, users]);

  const memberStats = useMemo(() => {
    const map: Record<string, number> = {};

    shifts.forEach(shift => {
      if (shift.status !== 'closed' || shift.isScheduled) return;
      const endMs = getTimestampMs(shift.endAt);
      if (!endMs) return;
      const hours = calcWorkedMs(shift, endMs) / 3600000;
      map[shift.userId] = (map[shift.userId] || 0) + hours;
    });

    return users.map(user => {
      const activeShift = activeShifts.find(s => s.userId === user.id);
      return {
        userId: user.id,
        userName: user.name || user.email || 'Unknown',
        avatarUrl: user.avatarUrl || 'man-1',
        totalHours: map[user.id] || 0,
        isOnline: !!activeShift
      } as MemberStats;
    }).sort((a, b) => b.totalHours - a.totalHours);
  }, [shifts, users, activeShifts]);

  const stats = useMemo(() => {
    const map: Record<string, WorksiteStats> = {};

    shifts.forEach(shift => {
      const gId = shift.geofenceId || 'unknown';
      if (!map[gId]) {
        map[gId] = {
          id: gId,
          name: shift.geofenceName || 'Unknown Worksite',
          totalHours: 0,
          activePeople: 0,
          totalShifts: 0,
        };
      }

      const worksite = map[gId];
      worksite.totalShifts += 1;

      if (shift.status === 'open') {
        worksite.activePeople += 1;
      } else if (shift.status === 'closed') {
        const endMs = getTimestampMs(shift.endAt);
        if (endMs) {
          worksite.totalHours += calcWorkedMs(shift, endMs) / 3600000;
        }
      }
    });

    return Object.values(map).sort((a, b) => b.totalHours - a.totalHours);
  }, [shifts]);

  const auditResult = useMemo(() => {
    if (!auditUserId) return 0;

    const nowLocal = new Date(now);
    const startOfToday = new Date(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate()).getTime();
    const endOfToday = startOfToday + 86400000;
    const startOfWeek = startOfToday - nowLocal.getDay() * 86400000;
    const startOfMonth = new Date(nowLocal.getFullYear(), nowLocal.getMonth(), 1).getTime();

    let rangeStart = 0;
    let rangeEnd = Number.MAX_SAFE_INTEGER;
    if (auditPeriod === 'today') {
      rangeStart = startOfToday;
      rangeEnd = endOfToday;
    } else if (auditPeriod === 'week') {
      rangeStart = startOfWeek;
      rangeEnd = endOfToday;
    } else if (auditPeriod === 'month') {
      rangeStart = startOfMonth;
      rangeEnd = endOfToday;
    } else if (auditPeriod === 'custom') {
      rangeStart = new Date(customStart).getTime();
      rangeEnd = new Date(customEnd).getTime() + 86400000;
    }

    let total = 0;
    shifts.forEach(shift => {
      if (shift.userId !== auditUserId || shift.status !== 'closed' || shift.isScheduled) return;

      const endMs = getTimestampMs(shift.endAt);
      if (!endMs) return;

      if (auditPeriod === 'all') {
        total += calcWorkedMs(shift, endMs) / 3600000;
        return;
      }

      if (!shiftOverlapsRange(shift, rangeStart, rangeEnd, endMs)) return;
      total += calcWorkedMsInRange(shift, rangeStart, rangeEnd, endMs) / 3600000;
    });
    return total;
  }, [shifts, auditUserId, auditPeriod, customStart, customEnd, now]);

  const formatElapsed = (start: unknown) => {
    const startTime = getTimestampMs(start);
    if (!startTime) return '00:00';
    const diff = now - startTime;
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    const f = (n: number) => n.toString().padStart(2, '0');
    return hours > 0 ? `${hours}:${f(mins)}:${f(secs)}` : `${f(mins)}:${f(secs)}`;
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Home</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Shift Calculator</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#F3E6D3" />
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
          {/* Time Audit Calculator */}
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>Time Audit Calculator</Text>
            <View style={styles.auditCard}>
              <Text style={styles.auditSubLabel}>1. Select Team Member</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.auditUserScroll}>
                {users.map(u => (
                  <TouchableOpacity 
                    key={u.id} 
                    style={[styles.auditUserItem, auditUserId === u.id && styles.auditUserItemActive]}
                    onPress={() => setAuditUserId(u.id)}
                  >
                    <Image 
                      source={Avatars[(u.avatarUrl as AvatarKey) || 'man-1']} 
                      style={[styles.auditAvatar, auditUserId === u.id && styles.auditAvatarActive]} 
                    />
                    <Text style={[styles.auditUserName, auditUserId === u.id && styles.auditUserNameActive]} numberOfLines={1}>
                      {u.name?.split(' ')[0] || 'User'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={[styles.auditSubLabel, { marginTop: 16 }]}>2. Select Period</Text>
              <View style={styles.periodRow}>
                {(['today', 'week', 'month', 'all', 'custom'] as const).map(p => (
                  <TouchableOpacity 
                    key={p} 
                    style={[styles.periodBtn, auditPeriod === p && styles.periodBtnActive]}
                    onPress={() => setAuditPeriod(p)}
                  >
                    <Text style={[styles.periodBtnText, auditPeriod === p && styles.periodBtnTextActive]}>
                      {p.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {auditPeriod === 'custom' && (
                <View style={styles.customRangeRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Start Date</Text>
                    <TextInput 
                      style={styles.input} 
                      value={customStart} 
                      onChangeText={setCustomStart} 
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="#8F6A48"
                    />
                  </View>
                  <View style={{ width: 12 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>End Date</Text>
                    <TextInput 
                      style={styles.input} 
                      value={customEnd} 
                      onChangeText={setCustomEnd} 
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="#8F6A48"
                    />
                  </View>
                </View>
              )}

              <View style={styles.auditResultContainer}>
                <View>
                  <Text style={styles.auditResultLabel}>Total Hours Worked</Text>
                  <Text style={styles.auditResultPeriod}>
                    {auditPeriod === 'all' ? 'Lifetime' : auditPeriod === 'custom' ? `${customStart} to ${customEnd}` : `This ${auditPeriod}`}
                  </Text>
                </View>
                <Text style={styles.auditResultValue}>{auditResult.toFixed(1)}h</Text>
              </View>
            </View>
          </View>

          {activeShifts.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionHeader}>Active People ({activeShifts.length})</Text>
              {activeShifts.map(s => {
                const userName = s.user?.name || s.user?.email || 'Unknown';
                return (
                  <View key={s.id} style={styles.personCard}>
                    <View style={styles.personHeader}>
                      <Image 
                        source={Avatars[(s.user?.avatarUrl as AvatarKey) || 'man-1']} 
                        style={styles.personAvatar} 
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.personName}>{userName}</Text>
                        <Text style={styles.personWorksite}>{s.geofenceName}</Text>
                      </View>
                      <View style={styles.timerBadge}>
                        <Text style={styles.timerText}>{formatElapsed(s.startAt)}</Text>
                      </View>
                    </View>
                    <TouchableOpacity 
                      style={styles.messageBtn}
                      onPress={() => navigation.navigate('Chat', { prefillText: `@${userName} ` })}
                    >
                      <Text style={styles.messageBtnText}>Message {userName.split(' ')[0]}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionHeader}>Member Productivity</Text>
            {memberStats.map(m => (
              <View key={m.userId} style={styles.personCard}>
                <View style={styles.personHeader}>
                  <Image 
                    source={Avatars[(m.avatarUrl as AvatarKey) || 'man-1']} 
                    style={[styles.personAvatar, !m.isOnline && { borderColor: '#3A2D24' }]} 
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.personName}>{m.userName}</Text>
                    <Text style={styles.personWorksite}>Total Contributions</Text>
                  </View>
                  <View style={styles.hourBadge}>
                    <Text style={styles.hourText}>{m.totalHours.toFixed(1)}h</Text>
                  </View>
                </View>
                <TouchableOpacity 
                  style={[styles.messageBtn, styles.actionSecondary]}
                  onPress={() => navigation.navigate('Chat', { prefillText: `@${m.userName} ` })}
                >
                  <Text style={styles.messageBtnText}>Message {m.userName.split(' ')[0]}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionHeader}>Worksite Stats</Text>
            {stats.map(item => (
              <View key={item.id} style={styles.card}>
                <Text style={styles.worksiteName}>{item.name}</Text>
                <View style={styles.statsRow}>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>Total Hours</Text>
                    <Text style={styles.statValue}>{item.totalHours.toFixed(1)}h</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>Active Now</Text>
                    <Text style={[styles.statValue, item.activePeople > 0 && styles.activeValue]}>
                      {item.activePeople}
                    </Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>Total Shifts</Text>
                    <Text style={styles.statValue}>{item.totalShifts}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#2A211B' },
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
  list: { padding: 16, gap: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { textAlign: 'center', marginTop: 40, color: '#A88E73' },
  card: {
    backgroundColor: '#1E1813',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
  worksiteName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F6EDE2',
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statLabel: {
    fontSize: 11,
    color: '#A88E73',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#EBDCCB',
  },
  activeValue: {
    color: '#4CAF50',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '900',
    color: '#C9782B',
    letterSpacing: 1.5,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  personCard: {
    backgroundColor: '#1E1813',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#3A2D24',
    marginBottom: 12,
  },
  personHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  personAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: '#4CAF50',
  },
  personName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F6EDE2',
  },
  personWorksite: {
    fontSize: 12,
    color: '#A88E73',
    marginTop: 2,
  },
  timerBadge: {
    backgroundColor: '#2A211B',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
  timerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4CAF50',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  messageBtn: {
    backgroundColor: '#C9782B',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  messageBtnText: {
    color: '#1E1813',
    fontWeight: 'bold',
    fontSize: 13,
  },
  actionSecondary: {
    backgroundColor: '#5B4B3A',
  },
  hourBadge: {
    backgroundColor: '#2A211B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C9782B',
  },
  hourText: {
    fontSize: 16,
    fontWeight: '900',
    color: '#C9782B',
  },
  scroll: {
    flex: 1,
  },
  auditCard: {
    backgroundColor: '#1E1813',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#C9782B',
  },
  auditSubLabel: {
    fontSize: 12,
    color: '#A88E73',
    fontWeight: '700',
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  auditUserScroll: {
    flexDirection: 'row',
  },
  auditUserItem: {
    alignItems: 'center',
    marginRight: 16,
    width: 60,
  },
  auditUserItemActive: {},
  auditAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
  auditAvatarActive: {
    borderColor: '#C9782B',
    borderWidth: 2,
  },
  auditUserName: {
    fontSize: 11,
    color: '#A88E73',
    marginTop: 6,
    textAlign: 'center',
  },
  auditUserNameActive: {
    color: '#C9782B',
    fontWeight: 'bold',
  },
  periodRow: {
    flexDirection: 'row',
    gap: 8,
  },
  periodBtn: {
    flex: 1,
    backgroundColor: '#2A211B',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
  periodBtnActive: {
    backgroundColor: '#C9782B',
    borderColor: '#C9782B',
  },
  periodBtnText: {
    color: '#A88E73',
    fontSize: 10,
    fontWeight: 'bold',
  },
  periodBtnTextActive: {
    color: '#1E1813',
  },
  auditResultContainer: {
    marginTop: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#2A211B',
    padding: 16,
    borderRadius: 12,
  },
  auditResultLabel: {
    fontSize: 14,
    color: '#EBDCCB',
    fontWeight: '600',
  },
  auditResultPeriod: {
    fontSize: 12,
    color: '#A88E73',
    marginTop: 2,
  },
  auditResultValue: {
    fontSize: 28,
    fontWeight: '900',
    color: '#C9782B',
  },
  customRangeRow: {
    flexDirection: 'row',
    marginTop: 16,
    padding: 12,
    backgroundColor: '#2A211B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
  label: {
    fontSize: 10,
    color: '#A88E73',
    fontWeight: 'bold',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#1E1813',
    color: '#F6EDE2',
    padding: 10,
    borderRadius: 8,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
});
