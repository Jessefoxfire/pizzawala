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
import {
  collection,
  getFirestore,
  onSnapshot,
} from '@react-native-firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { openUserProfile } from '../navigation/openUserProfile';
import {
  calcWorkedMs,
  calcWorkedMsInRange,
  getTimestampMs,
  shiftOverlapsRange,
  type LiveShift,
} from '../services/shifts';
import { formatClockTime, hoursChangeKind } from '../utils/workingHours';
import HoursChangeBadge from '../components/HoursChangeBadge';
import { Avatars, AvatarKey } from '../../assets/avatars';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import { SHOW_DEBUG_ONLY_OPERATIONS } from '../config/buildFeatures';
import PizzaFireScreen from '../components/PizzaFireScreen';

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
  hasAdded: boolean;
  hasEdited: boolean;
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
  const [auditDayKey, setAuditDayKey] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setAuditDayKey(null);
  }, [auditPeriod, auditUserId]);

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
    const added: Record<string, boolean> = {};
    const edited: Record<string, boolean> = {};

    shifts.forEach(shift => {
      if (shift.status !== 'closed' || shift.isScheduled) return;
      const endMs = getTimestampMs(shift.endAt);
      if (!endMs) return;
      const hours = calcWorkedMs(shift, endMs) / 3600000;
      map[shift.userId] = (map[shift.userId] || 0) + hours;
      const kind = hoursChangeKind(shift);
      if (kind === 'added') added[shift.userId] = true;
      if (kind === 'edited') edited[shift.userId] = true;
    });

    return users.map(user => {
      const activeShift = activeShifts.find(s => s.userId === user.id);
      return {
        userId: user.id,
        userName: user.name || user.email || 'Unknown',
        avatarUrl: user.avatarUrl || 'man-1',
        totalHours: map[user.id] || 0,
        isOnline: !!activeShift,
        hasAdded: !!added[user.id],
        hasEdited: !!edited[user.id],
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

  const auditRange = useMemo(() => {
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
    return { rangeStart, rangeEnd };
  }, [auditPeriod, customStart, customEnd, now]);

  const auditShifts = useMemo(() => {
    if (!auditUserId) return [];
    return shifts
      .filter(shift => {
        if (shift.userId !== auditUserId || shift.status !== 'closed' || shift.isScheduled) return false;
        const endMs = getTimestampMs(shift.endAt);
        if (!endMs) return false;
        if (auditPeriod === 'all') return true;
        return shiftOverlapsRange(shift, auditRange.rangeStart, auditRange.rangeEnd, endMs);
      })
      .sort((a, b) => getTimestampMs(b.startAt) - getTimestampMs(a.startAt));
  }, [shifts, auditUserId, auditPeriod, auditRange]);

  const auditResult = useMemo(() => {
    if (!auditUserId) return 0;

    let total = 0;
    auditShifts.forEach(shift => {
      const endMs = getTimestampMs(shift.endAt);
      if (!endMs) return;
      if (auditPeriod === 'all') {
        total += calcWorkedMs(shift, endMs) / 3600000;
        return;
      }
      total += calcWorkedMsInRange(shift, auditRange.rangeStart, auditRange.rangeEnd, endMs) / 3600000;
    });
    return total;
  }, [auditUserId, auditShifts, auditPeriod, auditRange]);

  const auditDays = useMemo(() => {
    const byDay = new Map<string, ShiftRecord[]>();
    auditShifts.forEach(shift => {
      const startMs = getTimestampMs(shift.startAt, shift.workPeriods?.[0]?.startIso);
      if (!startMs) return;
      const date = new Date(startMs);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      byDay.set(key, [...(byDay.get(key) || []), shift]);
    });
    return [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [auditShifts]);
  const auditUsesDayNavigation = auditPeriod === 'week' || auditPeriod === 'month' || auditPeriod === 'all';
  const displayedAuditShifts = auditUsesDayNavigation && auditDayKey
    ? auditDays.find(([key]) => key === auditDayKey)?.[1] || []
    : auditShifts;

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

  const openEmployeeProfile = (userId: string, userName: string) => {
    openUserProfile(navigation, { userId, userName });
  };

  return (
    <PizzaFireScreen>
    <View style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Home</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Shift Audit</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#F3E6D3" />
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
          {/* Shift Audit */}
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>Shift Audit</Text>
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
                      {u.name?.split(' ')[0] || 'Member'}
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
              {auditUserId && auditShifts.length > 0 ? (
                <View style={styles.auditShiftList}>
                  {auditUsesDayNavigation && !auditDayKey ? auditDays.map(([dayKey, dayShifts]) => (
                    <TouchableOpacity key={dayKey} style={styles.auditShiftRow} onPress={() => setAuditDayKey(dayKey)}>
                      <Text style={styles.auditShiftTime}>{new Date(`${dayKey}T00:00:00`).toLocaleDateString()}</Text>
                      <Text style={styles.auditShiftScheduled}>{dayShifts.length} {dayShifts.length === 1 ? 'shift' : 'shifts'} ›</Text>
                    </TouchableOpacity>
                  )) : (
                    <>
                      {auditUsesDayNavigation ? (
                        <TouchableOpacity onPress={() => setAuditDayKey(null)}><Text style={styles.auditShiftScheduled}>‹ All days</Text></TouchableOpacity>
                      ) : null}
                      {displayedAuditShifts.map(shift => {
                    const kind = hoursChangeKind(shift);
                    const startMs = getTimestampMs(shift.startAt, shift.workPeriods?.[0]?.startIso);
                    const endMs = getTimestampMs(shift.endAt, shift.workPeriods?.[0]?.endIso);
                    return (
                      <View key={shift.id} style={styles.auditShiftRow}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <Text style={styles.auditShiftTime}>
                              {startMs ? formatClockTime(startMs) : '—'} – {endMs ? formatClockTime(endMs) : '—'}
                            </Text>
                            <HoursChangeBadge added={kind === 'added'} edited={kind === 'edited'} />
                          </View>
                          {shift.scheduledStartTime && shift.scheduledEndTime ? (
                            <Text style={styles.auditShiftScheduled}>
                              Scheduled: {shift.scheduledStartTime} – {shift.scheduledEndTime}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    );
                      })}
                    </>
                  )}
                </View>
              ) : null}
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
                    {SHOW_DEBUG_ONLY_OPERATIONS ? <TouchableOpacity 
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
                      onPress={() => openEmployeeProfile(s.userId, userName)}
                      activeOpacity={0.8}
                    >
                      <Image 
                        source={Avatars[(s.user?.avatarUrl as AvatarKey) || 'man-1']} 
                        style={styles.personAvatar} 
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.personName}>{userName}</Text>
                        <Text style={styles.personWorksite}>{s.geofenceName}</Text>
                      </View>
                    </TouchableOpacity> : null}
                      <View style={styles.timerBadge}>
                        <Text style={styles.timerText}>{formatElapsed(s.startAt)}</Text>
                      </View>
                    </View>
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
                  <TouchableOpacity
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
                    onPress={() => navigation.navigate('WorkingHours', { employeeUserId: m.userId, employeeName: m.userName })}
                    activeOpacity={0.8}
                  >
                    <Image 
                      source={Avatars[(m.avatarUrl as AvatarKey) || 'man-1']} 
                      style={[styles.personAvatar, !m.isOnline && { borderColor: PIZZA_FIRE.cardBorder }]} 
                    />
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Text style={styles.personName}>{m.userName}</Text>
                        <HoursChangeBadge added={m.hasAdded} edited={m.hasEdited} />
                      </View>
                      <Text style={styles.personWorksite}>Total Contributions</Text>
                    </View>
                    <View style={styles.hourBadge}>
                      <Text style={styles.hourText}>{m.totalHours.toFixed(1)}h</Text>
                    </View>
                  </TouchableOpacity>
                </View>
                {SHOW_DEBUG_ONLY_OPERATIONS ? <TouchableOpacity 
                  style={[styles.messageBtn, styles.actionSecondary]}
                  onPress={() => navigation.navigate('Chat', { prefillText: `@${m.userName} ` })}
                >
                  <Text style={styles.messageBtnText}>Message {m.userName.split(' ')[0]}</Text>
                </TouchableOpacity> : null}
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
    </View>
    </PizzaFireScreen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: PIZZA_FIRE.divider,
  },
  back: { fontSize: 18, fontWeight: 'bold', color: PIZZA_FIRE.gold },
  title: { fontSize: 20, fontWeight: 'bold', color: PIZZA_FIRE.textPrimary },
  list: { padding: 16, gap: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { textAlign: 'center', marginTop: 40, color: PIZZA_FIRE.textMuted },
  card: {
    backgroundColor: PIZZA_FIRE.surface,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
  },
  worksiteName: {
    fontSize: 18,
    fontWeight: '700',
    color: PIZZA_FIRE.textPrimary,
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
    color: PIZZA_FIRE.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: PIZZA_FIRE.textSecondary,
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
    color: PIZZA_FIRE.accent,
    letterSpacing: 1.5,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  personCard: {
    backgroundColor: PIZZA_FIRE.surface,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
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
    color: PIZZA_FIRE.textPrimary,
  },
  personWorksite: {
    fontSize: 12,
    color: PIZZA_FIRE.textMuted,
    marginTop: 2,
  },
  timerBadge: {
    backgroundColor: PIZZA_FIRE.surfaceInset,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  timerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4CAF50',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  messageBtn: {
    backgroundColor: PIZZA_FIRE.qlFill,
    paddingVertical: 10,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
  },
  messageBtnText: {
    color: PIZZA_FIRE.textSecondary,
    fontWeight: '800',
    fontSize: 13,
  },
  actionSecondary: {},
  hourBadge: {
    backgroundColor: PIZZA_FIRE.surfaceInset,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.accent,
  },
  hourText: {
    fontSize: 16,
    fontWeight: '900',
    color: PIZZA_FIRE.accent,
  },
  scroll: {
    flex: 1,
  },
  auditCard: {
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.accent,
  },
  auditSubLabel: {
    fontSize: 12,
    color: PIZZA_FIRE.textMuted,
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
    borderColor: PIZZA_FIRE.cardBorder,
  },
  auditAvatarActive: {
    borderColor: PIZZA_FIRE.accent,
    borderWidth: 2,
  },
  auditUserName: {
    fontSize: 11,
    color: PIZZA_FIRE.textMuted,
    marginTop: 6,
    textAlign: 'center',
  },
  auditUserNameActive: {
    color: PIZZA_FIRE.accent,
    fontWeight: 'bold',
  },
  periodRow: {
    flexDirection: 'row',
    gap: 8,
  },
  periodBtn: {
    flex: 1,
    backgroundColor: PIZZA_FIRE.surfaceInset,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  periodBtnActive: {
    backgroundColor: PIZZA_FIRE.accent,
    borderColor: PIZZA_FIRE.accent,
  },
  periodBtnText: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 10,
    fontWeight: 'bold',
  },
  periodBtnTextActive: {
    color: PIZZA_FIRE.charcoal,
  },
  auditResultContainer: {
    marginTop: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: PIZZA_FIRE.surfaceInset,
    padding: 16,
    borderRadius: 12,
  },
  auditResultLabel: {
    fontSize: 14,
    color: PIZZA_FIRE.textSecondary,
    fontWeight: '600',
  },
  auditResultPeriod: {
    fontSize: 12,
    color: PIZZA_FIRE.textMuted,
    marginTop: 2,
  },
  auditResultValue: {
    fontSize: 28,
    fontWeight: '900',
    color: PIZZA_FIRE.accent,
  },
  auditShiftList: {
    marginTop: 12,
    gap: 8,
  },
  auditShiftRow: {
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#2E241D',
  },
  auditShiftTime: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  auditShiftScheduled: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 11,
    marginTop: 4,
    fontStyle: 'italic',
  },
  customRangeRow: {
    flexDirection: 'row',
    marginTop: 16,
    padding: 12,
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  label: {
    fontSize: 10,
    color: PIZZA_FIRE.textMuted,
    fontWeight: 'bold',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: PIZZA_FIRE.surfaceInset,
    color: PIZZA_FIRE.textPrimary,
    padding: 10,
    borderRadius: 8,
    fontSize: 14,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
});
