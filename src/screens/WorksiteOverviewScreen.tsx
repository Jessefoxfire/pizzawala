import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Keyboard,
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
  formatShiftDuration,
  getTimestampMs,
  shiftOverlapsRange,
  type LiveShift,
} from '../services/shifts';
import { formatClockTime, hoursChangeKind } from '../utils/workingHours';
import HoursChangeBadge from '../components/HoursChangeBadge';
import { Avatars, AvatarKey } from '../../assets/avatars';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import PizzaFireScreen from '../components/PizzaFireScreen';
import { employeeSortName, orgStatusLabel } from '../utils/orgStatus';

type Props = NativeStackScreenProps<RootStackParamList, 'WorksiteOverview'>;

type ShiftRecord = LiveShift & {
  geofenceId?: string;
  geofenceName?: string;
};

const NO_WORKSITE_ID = '__none__';

function auditWorksiteId(shift: ShiftRecord): string {
  const id = String(shift.geofenceId || '').trim();
  return id && id !== 'unknown' ? id : NO_WORKSITE_ID;
}

function auditWorksiteName(shift: ShiftRecord): string {
  if (auditWorksiteId(shift) === NO_WORKSITE_ID) return 'No worksite';
  return String(shift.geofenceName || '').trim() || 'Worksite';
}

export default function WorksiteOverviewScreen({ navigation }: Props) {
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [auditUserId, setAuditUserId] = useState<string | null>(null);
  const [auditGeofenceId, setAuditGeofenceId] = useState<string | null>(null);
  const [auditPeriod, setAuditPeriod] = useState<'today' | 'week' | 'month' | 'all' | 'custom'>('all');
  const [customStart, setCustomStart] = useState(new Date().toISOString().split('T')[0]);
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().split('T')[0]);
  const [auditDayKey, setAuditDayKey] = useState<string | null>(null);
  const [auditFolderId, setAuditFolderId] = useState<string | null>(null);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const [worksitePickerOpen, setWorksitePickerOpen] = useState(false);
  const [worksiteQuery, setWorksiteQuery] = useState('');

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setAuditDayKey(null);
    setAuditFolderId(null);
  }, [auditPeriod, auditUserId, auditGeofenceId]);

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
        if (auditGeofenceId && auditWorksiteId(shift) !== auditGeofenceId) return false;
        const endMs = getTimestampMs(shift.endAt);
        if (!endMs) return false;
        if (auditPeriod === 'all') return true;
        return shiftOverlapsRange(shift, auditRange.rangeStart, auditRange.rangeEnd, endMs);
      })
      .sort((a, b) => getTimestampMs(b.startAt) - getTimestampMs(a.startAt));
  }, [shifts, auditUserId, auditGeofenceId, auditPeriod, auditRange]);

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

  const auditWorksiteFolders = useMemo(() => {
    const map = new Map<string, { id: string; name: string; shifts: ShiftRecord[] }>();
    auditShifts.forEach(shift => {
      const id = auditWorksiteId(shift);
      const prev = map.get(id);
      if (prev) {
        prev.shifts.push(shift);
        if (id !== NO_WORKSITE_ID && !prev.name) prev.name = auditWorksiteName(shift);
        return;
      }
      map.set(id, { id, name: auditWorksiteName(shift), shifts: [shift] });
    });
    return [...map.values()].sort((a, b) => {
      if (a.id === NO_WORKSITE_ID) return 1;
      if (b.id === NO_WORKSITE_ID) return -1;
      return a.name.localeCompare(b.name);
    });
  }, [auditShifts]);

  const openWorksiteFolderId = auditFolderId || auditGeofenceId;
  const showingWorksiteFolders = Boolean(auditUserId && !openWorksiteFolderId);
  const folderShifts = useMemo(() => {
    if (!openWorksiteFolderId) return [];
    return auditShifts.filter(shift => auditWorksiteId(shift) === openWorksiteFolderId);
  }, [auditShifts, openWorksiteFolderId]);

  const auditDays = useMemo(() => {
    const byDay = new Map<string, ShiftRecord[]>();
    folderShifts.forEach(shift => {
      const startMs = getTimestampMs(shift.startAt, shift.workPeriods?.[0]?.startIso);
      if (!startMs) return;
      const date = new Date(startMs);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      byDay.set(key, [...(byDay.get(key) || []), shift]);
    });
    return [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [folderShifts]);
  const auditUsesDayNavigation = auditPeriod === 'week' || auditPeriod === 'month' || auditPeriod === 'all';
  const displayedAuditShifts = auditUsesDayNavigation && auditDayKey
    ? auditDays.find(([key]) => key === auditDayKey)?.[1] || []
    : folderShifts;

  const formatElapsed = (shift: LiveShift) => formatShiftDuration(calcWorkedMs(shift, now));

  const auditMembers = useMemo(() => {
    const lastActivity = new Map<string, { open: number; at: number }>();
    shifts.forEach(shift => {
      if (shift.isScheduled) return;
      const startMs = getTimestampMs(shift.startAt, shift.workPeriods?.[0]?.startIso);
      const endMs = getTimestampMs(shift.endAt);
      const prev = lastActivity.get(shift.userId) || { open: 0, at: 0 };
      if (shift.status === 'open') {
        lastActivity.set(shift.userId, { open: 1, at: Math.max(prev.at, startMs || 0) });
        return;
      }
      if (prev.open) return;
      lastActivity.set(shift.userId, { open: 0, at: Math.max(prev.at, endMs || startMs || 0) });
    });

    return [...users].sort((a, b) => {
      const aAct = lastActivity.get(a.id) || { open: 0, at: 0 };
      const bAct = lastActivity.get(b.id) || { open: 0, at: 0 };
      if (bAct.open !== aAct.open) return bAct.open - aAct.open;
      if (bAct.at !== aAct.at) return bAct.at - aAct.at;
      return employeeSortName(a).localeCompare(employeeSortName(b));
    });
  }, [shifts, users]);

  const selectedAuditUser = users.find(u => u.id === auditUserId);
  const memberQueryNorm = memberQuery.trim().toLowerCase();
  const visibleAuditMembers = memberQueryNorm
    ? auditMembers.filter(u => {
        const name = String(u.name || '');
        const email = String(u.email || u.emailLower || '');
        return name.toLowerCase().includes(memberQueryNorm) || email.toLowerCase().includes(memberQueryNorm);
      })
    : auditMembers;

  const closeMemberPicker = () => {
    setMemberPickerOpen(false);
    setMemberQuery('');
    Keyboard.dismiss();
  };

  const closeWorksitePicker = () => {
    setWorksitePickerOpen(false);
    setWorksiteQuery('');
    Keyboard.dismiss();
  };

  const selectAuditMember = (userId: string) => {
    setAuditUserId(userId);
    closeMemberPicker();
  };

  const auditWorksites = useMemo(() => {
    const map = new Map<string, { id: string; name: string; open: number; at: number }>();
    shifts.forEach(shift => {
      const id = auditWorksiteId(shift);
      const name = auditWorksiteName(shift);
      const prev = map.get(id) || { id, name, open: 0, at: 0 };
      const startMs = getTimestampMs(shift.startAt, shift.workPeriods?.[0]?.startIso);
      const endMs = getTimestampMs(shift.endAt);
      if (shift.status === 'open') {
        map.set(id, { id, name: name || prev.name, open: 1, at: Math.max(prev.at, startMs || 0) });
        return;
      }
      if (prev.open) {
        map.set(id, { ...prev, name: prev.name || name });
        return;
      }
      map.set(id, {
        id,
        name: name || prev.name,
        open: 0,
        at: Math.max(prev.at, endMs || startMs || 0),
      });
    });
    return [...map.values()].sort((a, b) => {
      if (b.open !== a.open) return b.open - a.open;
      if (b.at !== a.at) return b.at - a.at;
      return a.name.localeCompare(b.name);
    });
  }, [shifts]);

  const selectedAuditWorksite = auditWorksites.find(site => site.id === auditGeofenceId);
  const worksiteQueryNorm = worksiteQuery.trim().toLowerCase();
  const visibleAuditWorksites = worksiteQueryNorm
    ? auditWorksites.filter(site => site.name.toLowerCase().includes(worksiteQueryNorm))
    : auditWorksites;

  const selectAuditWorksite = (geofenceId: string | null) => {
    setAuditGeofenceId(geofenceId);
    closeWorksitePicker();
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
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.section}>
            <Text style={styles.fieldLabel}>Member</Text>
            <View style={styles.auditDropdown}>
              <TouchableOpacity
                style={styles.auditDropdownTrigger}
                onPress={() => {
                  if (memberPickerOpen) {
                    closeMemberPicker();
                    return;
                  }
                  closeWorksitePicker();
                  setMemberPickerOpen(true);
                }}
                accessibilityRole="button"
                accessibilityState={{ expanded: memberPickerOpen }}
                accessibilityLabel={
                  selectedAuditUser
                    ? `Member ${selectedAuditUser.name || selectedAuditUser.email || 'Member'}`
                    : 'Select member'
                }
              >
                {selectedAuditUser ? (
                  <Image
                    source={Avatars[(selectedAuditUser.avatarUrl as AvatarKey) || 'man-1']}
                    style={styles.auditAvatar}
                  />
                ) : null}
                <Text
                  style={[styles.auditDropdownValue, !selectedAuditUser && styles.auditDropdownPlaceholder]}
                  numberOfLines={1}
                >
                  {selectedAuditUser
                    ? `${selectedAuditUser.name || selectedAuditUser.email || 'Member'}${
                        orgStatusLabel(selectedAuditUser) ? ' · Inactive' : ''
                      }`
                    : 'Select member'}
                </Text>
                <Text style={styles.auditDropdownChevron}>{memberPickerOpen ? '⌃' : '⌄'}</Text>
              </TouchableOpacity>
              {memberPickerOpen ? (
                <View>
                  <TextInput
                    style={styles.auditSearch}
                    value={memberQuery}
                    onChangeText={setMemberQuery}
                    placeholder="Search name"
                    placeholderTextColor={PIZZA_FIRE.textMuted}
                    autoCorrect={false}
                    autoCapitalize="none"
                    accessibilityLabel="Search members"
                  />
                  <ScrollView
                    style={styles.auditDropdownList}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                  >
                    {visibleAuditMembers.length === 0 ? (
                      <Text style={styles.auditDropdownEmpty}>No matches</Text>
                    ) : (
                      visibleAuditMembers.map(u => {
                        const selected = auditUserId === u.id;
                        const inactive = orgStatusLabel(u);
                        return (
                          <TouchableOpacity
                            key={u.id}
                            style={[styles.auditDropdownItem, selected && styles.auditUserItemActive]}
                            onPress={() => selectAuditMember(u.id)}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                          >
                            <Image
                              source={Avatars[(u.avatarUrl as AvatarKey) || 'man-1']}
                              style={[styles.auditAvatar, selected && styles.auditAvatarActive]}
                            />
                            <Text
                              style={[styles.auditUserName, selected && styles.auditUserNameActive]}
                              numberOfLines={1}
                            >
                              {u.name || u.email || 'Member'}
                              {inactive ? ' · Inactive' : ''}
                            </Text>
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </ScrollView>
                </View>
              ) : null}
            </View>

            <Text style={styles.fieldLabel}>Worksite</Text>
            <View style={styles.auditDropdown}>
              <TouchableOpacity
                style={styles.auditDropdownTrigger}
                onPress={() => {
                  if (worksitePickerOpen) {
                    closeWorksitePicker();
                    return;
                  }
                  closeMemberPicker();
                  setWorksitePickerOpen(true);
                }}
                accessibilityRole="button"
                accessibilityState={{ expanded: worksitePickerOpen }}
                accessibilityLabel={
                  selectedAuditWorksite
                    ? `Worksite ${selectedAuditWorksite.name}`
                    : 'All worksites'
                }
              >
                <Text
                  style={[styles.auditDropdownValue, !selectedAuditWorksite && styles.auditDropdownPlaceholder]}
                  numberOfLines={1}
                >
                  {selectedAuditWorksite ? selectedAuditWorksite.name : 'All worksites'}
                </Text>
                <Text style={styles.auditDropdownChevron}>{worksitePickerOpen ? '⌃' : '⌄'}</Text>
              </TouchableOpacity>
              {worksitePickerOpen ? (
                <View>
                  <TextInput
                    style={styles.auditSearch}
                    value={worksiteQuery}
                    onChangeText={setWorksiteQuery}
                    placeholder="Search worksite"
                    placeholderTextColor={PIZZA_FIRE.textMuted}
                    autoCorrect={false}
                    autoCapitalize="none"
                    accessibilityLabel="Search worksites"
                  />
                  <ScrollView
                    style={styles.auditDropdownList}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                  >
                    <TouchableOpacity
                      style={[styles.auditDropdownItem, !auditGeofenceId && styles.auditUserItemActive]}
                      onPress={() => selectAuditWorksite(null)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: !auditGeofenceId }}
                    >
                      <Text
                        style={[styles.auditUserName, !auditGeofenceId && styles.auditUserNameActive]}
                        numberOfLines={1}
                      >
                        All worksites
                      </Text>
                    </TouchableOpacity>
                    {visibleAuditWorksites.length === 0 ? (
                      <Text style={styles.auditDropdownEmpty}>No matches</Text>
                    ) : (
                      visibleAuditWorksites.map(site => {
                        const selected = auditGeofenceId === site.id;
                        return (
                          <TouchableOpacity
                            key={site.id}
                            style={[styles.auditDropdownItem, selected && styles.auditUserItemActive]}
                            onPress={() => selectAuditWorksite(site.id)}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                          >
                            <Text
                              style={[styles.auditUserName, selected && styles.auditUserNameActive]}
                              numberOfLines={1}
                            >
                              {site.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </ScrollView>
                </View>
              ) : null}
            </View>

            <Text style={styles.fieldLabel}>Period</Text>
            <View style={styles.periodRow}>
              {(['today', 'week', 'month', 'all', 'custom'] as const).map(p => (
                <TouchableOpacity
                  key={p}
                  style={[styles.periodBtn, auditPeriod === p && styles.periodBtnActive]}
                  onPress={() => setAuditPeriod(p)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: auditPeriod === p }}
                >
                  <Text style={[styles.periodBtnText, auditPeriod === p && styles.periodBtnTextActive]}>
                    {p === 'today' ? 'Today' : p === 'week' ? 'Week' : p === 'month' ? 'Month' : p === 'all' ? 'All' : 'Custom'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {auditPeriod === 'custom' ? (
              <View style={styles.customRangeRow}>
                <View style={styles.customDateField}>
                  <Text style={styles.label}>Start</Text>
                  <TextInput
                    style={styles.input}
                    value={customStart}
                    onChangeText={setCustomStart}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={PIZZA_FIRE.textMuted}
                  />
                </View>
                <View style={styles.customDateField}>
                  <Text style={styles.label}>End</Text>
                  <TextInput
                    style={styles.input}
                    value={customEnd}
                    onChangeText={setCustomEnd}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={PIZZA_FIRE.textMuted}
                  />
                </View>
              </View>
            ) : null}

            <View style={styles.auditResultContainer}>
              <Text style={styles.auditResultLabel} numberOfLines={2}>
                Total {auditResult.toFixed(1)}h
                <Text style={styles.auditResultPeriod}>
                  {' · '}
                  {auditPeriod === 'all'
                    ? 'Lifetime'
                    : auditPeriod === 'custom'
                      ? `${customStart} – ${customEnd}`
                      : auditPeriod === 'today'
                        ? 'Today'
                        : `This ${auditPeriod}`}
                  {selectedAuditWorksite ? ` · ${selectedAuditWorksite.name}` : ''}
                </Text>
              </Text>
            </View>
            {auditUserId && showingWorksiteFolders && auditWorksiteFolders.length > 0 ? (
              <View style={styles.auditShiftList}>
                {auditWorksiteFolders.map(folder => (
                  <TouchableOpacity
                    key={folder.id}
                    style={styles.auditShiftRow}
                    onPress={() => {
                      setAuditDayKey(null);
                      setAuditFolderId(folder.id);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${folder.name}, ${folder.shifts.length} ${folder.shifts.length === 1 ? 'shift' : 'shifts'}`}
                  >
                    <Text style={styles.auditShiftTime}>{folder.name}</Text>
                    <Text style={styles.auditShiftScheduled}>
                      {folder.shifts.length} {folder.shifts.length === 1 ? 'shift' : 'shifts'} ›
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            {auditUserId && !showingWorksiteFolders && folderShifts.length > 0 ? (
              <View style={styles.auditShiftList}>
                {!auditGeofenceId ? (
                  <TouchableOpacity
                    onPress={() => {
                      setAuditDayKey(null);
                      setAuditFolderId(null);
                    }}
                    hitSlop={8}
                  >
                    <Text style={styles.auditShiftScheduled}>‹ Worksites</Text>
                  </TouchableOpacity>
                ) : null}
                {auditUsesDayNavigation && !auditDayKey ? auditDays.map(([dayKey, dayShifts]) => (
                  <TouchableOpacity key={dayKey} style={styles.auditShiftRow} onPress={() => setAuditDayKey(dayKey)}>
                    <Text style={styles.auditShiftTime}>{new Date(`${dayKey}T00:00:00`).toLocaleDateString()}</Text>
                    <Text style={styles.auditShiftScheduled}>{dayShifts.length} {dayShifts.length === 1 ? 'shift' : 'shifts'} ›</Text>
                  </TouchableOpacity>
                )) : (
                  <>
                    {auditUsesDayNavigation ? (
                      <TouchableOpacity onPress={() => setAuditDayKey(null)} hitSlop={8}>
                        <Text style={styles.auditShiftScheduled}>‹ All days</Text>
                      </TouchableOpacity>
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

          {activeShifts.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionHeader}>Active People ({activeShifts.length})</Text>
              {activeShifts.map(s => {
                const userName = s.user?.name || s.user?.email || 'Unknown';
                return (
                  <TouchableOpacity
                    key={s.id}
                    style={styles.activeRow}
                    onPress={() => openEmployeeProfile(s.userId, userName)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={`${userName}, ${s.geofenceName || 'worksite'}, ${formatElapsed(s)}`}
                  >
                    <Image
                      source={Avatars[(s.user?.avatarUrl as AvatarKey) || 'man-1']}
                      style={styles.activeAvatar}
                    />
                    <View style={styles.activeCopy}>
                      <Text style={styles.activeName} numberOfLines={1}>{userName}</Text>
                      <Text style={styles.activeWorksite} numberOfLines={1}>{s.geofenceName || '—'}</Text>
                    </View>
                    <Text style={styles.activeTimer} numberOfLines={1}>{formatElapsed(s)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
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
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: PIZZA_FIRE.divider,
  },
  back: { fontSize: 17, fontWeight: '700', color: PIZZA_FIRE.gold, minWidth: 64 },
  title: { fontSize: 18, fontWeight: '700', color: PIZZA_FIRE.textPrimary },
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  section: {
    marginBottom: 18,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: PIZZA_FIRE.textSecondary,
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: PIZZA_FIRE.textMuted,
    marginBottom: 6,
  },
  scroll: {
    flex: 1,
  },
  auditDropdown: {
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    borderRadius: 8,
    marginBottom: 10,
    overflow: 'hidden',
  },
  auditDropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  auditDropdownValue: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: PIZZA_FIRE.textPrimary,
  },
  auditDropdownPlaceholder: {
    color: PIZZA_FIRE.textMuted,
    fontWeight: '500',
  },
  auditDropdownChevron: {
    fontSize: 14,
    color: PIZZA_FIRE.textMuted,
    paddingLeft: 4,
  },
  auditSearch: {
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'android' ? 6 : 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: PIZZA_FIRE.divider,
    color: PIZZA_FIRE.textPrimary,
    fontSize: 15,
  },
  auditDropdownList: {
    maxHeight: 240,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: PIZZA_FIRE.divider,
  },
  auditDropdownEmpty: {
    paddingHorizontal: 10,
    paddingVertical: 12,
    color: PIZZA_FIRE.textMuted,
    fontSize: 13,
  },
  auditDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  auditUserItemActive: {
    backgroundColor: PIZZA_FIRE.accentSoft,
  },
  auditAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  auditAvatarActive: {
    borderColor: PIZZA_FIRE.accent,
  },
  auditUserName: {
    flex: 1,
    fontSize: 13,
    color: PIZZA_FIRE.textSecondary,
    flexShrink: 1,
  },
  auditUserNameActive: {
    color: PIZZA_FIRE.textPrimary,
    fontWeight: '700',
  },
  periodRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  periodBtn: {
    minHeight: 40,
    minWidth: 56,
    flexGrow: 1,
    flexBasis: '18%',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  periodBtnActive: {
    backgroundColor: PIZZA_FIRE.accent,
    borderColor: PIZZA_FIRE.accent,
  },
  periodBtnText: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  periodBtnTextActive: {
    color: PIZZA_FIRE.charcoal,
  },
  auditResultContainer: {
    marginTop: 4,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: PIZZA_FIRE.divider,
  },
  auditResultLabel: {
    fontSize: 15,
    color: PIZZA_FIRE.textPrimary,
    fontWeight: '700',
  },
  auditResultPeriod: {
    fontSize: 13,
    color: PIZZA_FIRE.textMuted,
    fontWeight: '500',
  },
  auditShiftList: {
    marginTop: 8,
    gap: 6,
  },
  auditShiftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 8,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: PIZZA_FIRE.divider,
  },
  auditShiftTime: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  auditShiftScheduled: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  customRangeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  customDateField: {
    flex: 1,
  },
  label: {
    fontSize: 11,
    color: PIZZA_FIRE.textMuted,
    fontWeight: '600',
    marginBottom: 4,
  },
  input: {
    color: PIZZA_FIRE.textPrimary,
    paddingVertical: 8,
    paddingHorizontal: 8,
    minHeight: 40,
    borderRadius: 6,
    fontSize: 14,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingVertical: 6,
  },
  activeAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  activeCopy: {
    flex: 1,
    minWidth: 0,
  },
  activeName: {
    fontSize: 15,
    fontWeight: '700',
    color: PIZZA_FIRE.textPrimary,
  },
  activeWorksite: {
    fontSize: 12,
    color: PIZZA_FIRE.textMuted,
    marginTop: 1,
  },
  activeTimer: {
    fontSize: 13,
    fontWeight: '700',
    color: PIZZA_FIRE.success,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginLeft: 8,
    flexShrink: 0,
    maxWidth: '38%',
  },
});
