import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Linking,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
  Image,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from '@react-native-firebase/firestore';
import { pick, types, errorCodes, isErrorWithCode } from '@react-native-documents/picker';
import { auth } from '../services/firebase';
import { useAuth } from '../auth/useAuth';
import { useFocusEffect } from '@react-navigation/native';
import { parseEventsCsv } from '../utils/parseEventsCsv';
import { readPickedFileAsUtf8 } from '../utils/readPickedDocumentText';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { Icons } from '../components/Icons';
import { Calendar } from 'react-native-calendars';
import { resolveAvatarSource } from '../utils/avatar';
import {
  type EventDay,
  DEFAULT_EVENT_DAY_TIMES,
  findCurrentOrUpcomingEventIndex,
  formatDayHeading,
  formatTimeRange,
  isValidTimeRange,
  normalizeEventDays,
  pickLinkedScheduleDate,
  sortEventsByDays,
  timesForNewEventDay,
} from '../utils/eventDays';
import EventDayTimeModal from '../components/EventDayTimeModal';

type Props = NativeStackScreenProps<RootStackParamList, 'Events'>;

type Event = {
  id: string;
  title: string;
  days?: EventDay[];
  sortDate?: string;
  locationName: string;
  locationUrl: string;
  staffIds: string[];
  staffNeeded: number;
  notes: string;
  createdAt: any;
  /** @deprecated legacy fields — use days */
  startDate?: string;
  endDate?: string;
  arrivalDate?: string;
  startTime?: string;
  endTime?: string;
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
  name: string;
  avatarUrl?: string;
  customAvatarUrl?: string;
};

/** Estimated card height for scroll positioning (includes margin). */
const EVENT_CARD_ESTIMATED_HEIGHT = 430;

export default function EventsScreen({ navigation }: Props) {
  const authState = useAuth();
  const isAdmin = authState.status === 'admin';
  const [events, setEvents] = useState<Event[]>([]);
  const [availabilityMap, setAvailabilityMap] = useState<Record<string, Availability[]>>({});
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [userProfile, setUserProfile] = useState<any>(null);
  
  // Create/Edit Event Modal
  const [modalVisible, setModalVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [eventDays, setEventDays] = useState<EventDay[]>([]);
  const [locationName, setLocationName] = useState('');
  const [locationUrl, setLocationUrl] = useState('');
  const [staffIds, setStaffIds] = useState<string[]>([]);
  const [staffNeeded, setStaffNeeded] = useState('1');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [unreadByEventId, setUnreadByEventId] = useState<Record<string, number>>({});
  const listRef = useRef<FlatList<Event>>(null);
  const didAutoScrollRef = useRef(false);
  const focusEventIndex = useMemo(
    () => (events.length ? findCurrentOrUpcomingEventIndex(events) : 0),
    [events]
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<Event> | null | undefined, index: number) => ({
      length: EVENT_CARD_ESTIMATED_HEIGHT,
      offset: EVENT_CARD_ESTIMATED_HEIGHT * index,
      index,
    }),
    []
  );

  const scrollToCurrentEvent = useCallback((animated = true) => {
    if (!events.length) return;
    listRef.current?.scrollToIndex({
      index: focusEventIndex,
      animated,
      viewPosition: 0,
    });
  }, [events.length, focusEventIndex]);

  useEffect(() => {
    didAutoScrollRef.current = false;
  }, [retryToken, focusEventIndex]);

  useFocusEffect(
    useCallback(() => {
      if (loading || events.length === 0) return undefined;
      const timer = setTimeout(() => scrollToCurrentEvent(false), 60);
      return () => clearTimeout(timer);
    }, [loading, events.length, focusEventIndex, scrollToCurrentEvent])
  );

  useEffect(() => {
    if (loading || events.length === 0 || didAutoScrollRef.current) return;
    didAutoScrollRef.current = true;
    requestAnimationFrame(() => {
      scrollToCurrentEvent(false);
      setTimeout(() => scrollToCurrentEvent(true), 80);
    });
  }, [loading, events.length, focusEventIndex, scrollToCurrentEvent]);

  const handleListContentSizeChange = useCallback(() => {
    if (loading || events.length === 0 || didAutoScrollRef.current) return;
    didAutoScrollRef.current = true;
    scrollToCurrentEvent(false);
  }, [loading, events.length, scrollToCurrentEvent]);

  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      const estimated = info.averageItemLength || EVENT_CARD_ESTIMATED_HEIGHT;
      listRef.current?.scrollToOffset({
        offset: Math.max(0, estimated * info.index),
        animated: false,
      });
      setTimeout(() => scrollToCurrentEvent(false), 50);
      setTimeout(() => scrollToCurrentEvent(true), 180);
    },
    [scrollToCurrentEvent]
  );

  // Add-day calendar picker
  const [addDayPickerVisible, setAddDayPickerVisible] = useState(false);
  const [editingDayDate, setEditingDayDate] = useState<string | null>(null);

  // Availability Modal
  const [availModalVisible, setAvailModalVisible] = useState(false);
  const [availEventId, setAvailEventId] = useState<string | null>(null);
  const [availNotes, setAvailNotes] = useState('');
  const [submittingAvail, setSubmittingAvail] = useState(false);

  useEffect(() => {
    const user = auth.currentUser;
    if (user) {
      const fs = getFirestore();
    const unsubProfile = onSnapshot(
      doc(fs, 'users', user.uid),
      snap => {
        if (!snap || !snap.exists()) {
          setUserProfile(null);
          return;
        }
        setUserProfile(snap.data());
      },
      err => {
        setUserProfile(null);
      }
    );
      return () => unsubProfile();
    }
  }, []);

  useEffect(() => {
    const fs = getFirestore();
    setLoadError(null);
    const availUnsubs: Array<() => void> = [];
    const eventChatUnsubs: Array<() => void> = [];
    const readMarks: Record<string, number> = {};
    const messageTimesByEvent: Record<string, Array<{ createdAtMs: number; senderId: string | null }>> = {};
    const currentUid = auth.currentUser?.uid || null;

    const recalcUnread = () => {
      if (!currentUid) {
        setUnreadByEventId({});
        return;
      }
      const next: Record<string, number> = {};
      Object.entries(messageTimesByEvent).forEach(([eventId, rows]) => {
        const readAt = readMarks[eventId] || 0;
        next[eventId] = rows.filter(row => row.senderId !== currentUid && row.createdAtMs > readAt).length;
      });
      setUnreadByEventId(next);
    };

    const readUnsub = currentUid
      ? onSnapshot(
          collection(fs, 'users', currentUid, 'chatReads'),
          snap => {
            if (!snap?.docs) return;
            Object.keys(readMarks).forEach(k => delete readMarks[k]);
            snap.docs.forEach(d => {
              const data = d.data() as any;
              if (data?.scope !== 'event') return;
              const raw = data?.lastReadAt;
              const ms = raw?.toDate?.()?.getTime?.() ?? (raw ? new Date(raw).getTime() : 0);
              if (Number.isFinite(ms)) readMarks[d.id] = ms;
            });
            recalcUnread();
          },
          err => {
            console.warn('Event read markers listener:', err);
          }
        )
      : () => undefined;

    const unsubUsers = onSnapshot(
      collection(fs, 'users'),
      snap => {
        if (!snap || !snap.docs) {
          setAllUsers([]);
          return;
        }
        const users = snap.docs.map(d => ({ id: d.id, ...d.data() } as UserProfile));
        setAllUsers(users);
      },
      () => {
        setAllUsers([]);
      }
    );

    const q = query(collection(fs, 'events'));
    const unsubEvents = onSnapshot(
      q,
      snap => {
        if (!snap || !snap.docs || snap.empty) {
          setEvents([]);
          setUnreadByEventId({});
          setLoading(false);
          return;
        }
        availUnsubs.forEach(u => u());
        availUnsubs.length = 0;
        eventChatUnsubs.forEach(u => u());
        eventChatUnsubs.length = 0;
        Object.keys(messageTimesByEvent).forEach(k => delete messageTimesByEvent[k]);

        const items = sortEventsByDays(
          snap.docs.map(d => ({ id: d.id, ...d.data() } as Event))
        );
        setEvents(items);
        setLoading(false);

        items.forEach(event => {
          const u = onSnapshot(
            collection(fs, 'events', event.id, 'availability'),
            availSnap => {
              if (!availSnap || !availSnap.docs || availSnap.empty) return;
              const avails = availSnap.docs.map(ad => ad.data() as Availability);
              setAvailabilityMap(prev => ({ ...prev, [event.id]: avails }));
            }
          );
          availUnsubs.push(u);

          const eventThreadDocRef = doc(collection(doc(fs, 'chats', 'events'), 'threads'), event.id);
          const messagesQuery = query(
            collection(eventThreadDocRef, 'messages'),
            orderBy('createdAt', 'desc'),
            limit(120)
          );
          const chatUnsub = onSnapshot(
            messagesQuery,
            chatSnap => {
              if (!chatSnap?.docs) {
                messageTimesByEvent[event.id] = [];
                recalcUnread();
                return;
              }
              messageTimesByEvent[event.id] = chatSnap.docs.map(md => {
                const data = md.data() as any;
                const raw = data?.createdAt;
                const createdAtMs = raw?.toDate?.()?.getTime?.() ?? (raw ? new Date(raw).getTime() : 0);
                return {
                  createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0,
                  senderId: typeof data?.senderId === 'string' ? data.senderId : null,
                };
              });
              recalcUnread();
            },
            err => {
              console.warn(`Event chat unread listener failed for ${event.id}:`, err);
              messageTimesByEvent[event.id] = [];
              recalcUnread();
            }
          );
          eventChatUnsubs.push(chatUnsub);
        });
      },
      err => {
        setLoadError(err?.message || String(err));
        setLoading(false);
      }
    );

    return () => {
      unsubUsers();
      unsubEvents();
      readUnsub();
      availUnsubs.forEach(u => u());
      eventChatUnsubs.forEach(u => u());
    };
  }, [retryToken]);

  const handleSave = async () => {
    if (!isAdmin) {
      Alert.alert('Notice', 'Only admins can create or edit events.');
      return;
    }
    const sortedDays = [...eventDays].sort((a, b) => a.date.localeCompare(b.date));
    if (!title || sortedDays.length === 0 || !locationName) {
      Alert.alert('Notice', 'Title, at least one day, and location are required.');
      return;
    }
    const invalidDay = sortedDays.find(day => !isValidTimeRange(day.startTime, day.endTime));
    if (invalidDay) {
      Alert.alert(
        'Invalid times',
        `${formatDayHeading(invalidDay.date)}: finish time must be after start time.`
      );
      return;
    }

    setSaving(true);
    const fs = getFirestore();
    const payload = {
      title,
      days: sortedDays,
      sortDate: sortedDays[0].date,
      locationName,
      locationUrl,
      staffIds: staffIds || [],
      staffNeeded: parseInt(staffNeeded, 10) || 1,
      notes,
      updatedAt: serverTimestamp(),
    };

    try {
      if (editingId) {
        await updateDoc(doc(fs, 'events', editingId), payload);
      } else {
        await addDoc(collection(fs, 'events'), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      setModalVisible(false);
      resetForm();
    } catch (err: any) {
      Alert.alert('Notice', err.message);
    } finally {
      setSaving(false);
    }
  };

  const submitAvailability = async () => {
    if (!availEventId || !auth.currentUser) return;
    setSubmittingAvail(true);
    try {
      const user = auth.currentUser;
      const fs = getFirestore();
      const availabilityRef = doc(fs, 'events', availEventId, 'availability', user.uid);
      await setDoc(availabilityRef, {
        userId: user.uid,
        userName: userProfile?.name || user.email,
        isAvailable: true,
        notes: availNotes,
        updatedAt: serverTimestamp(),
      });
      setAvailModalVisible(false);
      setAvailNotes('');
      Alert.alert('Success', "Availability saved!");
    } catch (err: any) {
      Alert.alert('Notice', err.message);
    } finally {
      setSubmittingAvail(false);
    }
  };

  const handleImportCsv = async () => {
    if (!isAdmin) return;
    Alert.alert(
      'Import events from CSV',
      'Use a header row:\n' +
        'title,startDate,endDate,arrivalDate,startTime,endTime,locationName,locationUrl,staffNeeded,notes,staffIds\n\n' +
        'Dates: YYYY-MM-DD. staffIds: optional UIDs separated by | or ;\n\n' +
        'Or omit the header and use columns in that exact order.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Choose file',
          onPress: () => void importCsvFromPicker(),
        },
      ]
    );
  };

  const importCsvFromPicker = async () => {
    try {
      const result = await pick({
        type: [types.csv, types.plainText, 'text/comma-separated-values'],
        allowMultiSelection: false,
        ...(Platform.OS === 'android' ? { allowVirtualFiles: true } : {}),
      });
      const file = result[0];
      const name = (file.name || '').toLowerCase();
      const mime = (file.type || '').toLowerCase();
      const looksLikeCsv =
        !name ||
        name.endsWith('.csv') ||
        name.endsWith('.txt') ||
        mime.includes('csv') ||
        mime.includes('comma-separated') ||
        mime.includes('text/plain');
      if (!looksLikeCsv) {
        Alert.alert('Notice', 'Please pick a CSV or plain-text file.');
        return;
      }
      const text = await readPickedFileAsUtf8(file);
      const { rows, errors } = parseEventsCsv(text);
      if (rows.length === 0) {
        Alert.alert(
          'CSV',
          errors.length ? errors.slice(0, 12).join('\n') : 'No valid event rows found.'
        );
        return;
      }
      setCsvImporting(true);
      const fs = getFirestore();
      let ok = 0;
      const writeErrors: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        try {
          await addDoc(collection(fs, 'events'), {
            title: r.title,
            days: [
              {
                date: r.arrivalDate || r.startDate,
                startTime: r.startTime || DEFAULT_EVENT_DAY_TIMES.startTime,
                endTime: r.endTime || DEFAULT_EVENT_DAY_TIMES.endTime,
              },
            ],
            sortDate: r.arrivalDate || r.startDate,
            locationName: r.locationName,
            locationUrl: r.locationUrl,
            staffIds: r.staffIds,
            staffNeeded: r.staffNeeded,
            notes: r.notes,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          ok++;
        } catch (e: any) {
          writeErrors.push(`Row ${i + 1}: ${e?.message || 'write failed'}`);
        }
      }
      const warn = errors.length ? `\n\nWarnings:\n${errors.slice(0, 8).join('\n')}` : '';
      const werr = writeErrors.length ? `\n\nWrite errors:\n${writeErrors.slice(0, 6).join('\n')}` : '';
      Alert.alert('Import complete', `Imported ${ok} of ${rows.length} events.${warn}${werr}`);
    } catch (e: any) {
      if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return;
      Alert.alert('Import failed', e?.message || String(e));
    } finally {
      setCsvImporting(false);
    }
  };

  const resetForm = () => {
    setTitle('');
    setEventDays([]);
    setLocationName('');
    setLocationUrl('');
    setStaffIds([]);
    setStaffNeeded('1');
    setNotes('');
    setEditingId(null);
  };

  useEffect(() => {
    if (!isAdmin && modalVisible) {
      setModalVisible(false);
      resetForm();
    }
  }, [isAdmin, modalVisible]);

  const openEdit = (event: Event) => {
    if (!isAdmin) return;
    setTitle(event.title);
    setEventDays(normalizeEventDays(event));
    setLocationName(event.locationName);
    setLocationUrl(event.locationUrl);
    setStaffIds(event.staffIds || []);
    setStaffNeeded((event.staffNeeded || 1).toString());
    setNotes(event.notes);
    setEditingId(event.id);
    setModalVisible(true);
  };

  const addEventDay = (dateKey: string) => {
    let shouldPromptTimes = false;
    setEventDays(prev => {
      if (prev.some(day => day.date === dateKey)) return prev;
      shouldPromptTimes = prev.length === 0;
      const times = timesForNewEventDay(prev, dateKey);
      return [...prev, { date: dateKey, ...times }].sort((a, b) => a.date.localeCompare(b.date));
    });
    setAddDayPickerVisible(false);
    if (shouldPromptTimes) {
      setEditingDayDate(dateKey);
    }
  };

  const removeEventDay = (dateKey: string) => {
    setEventDays(prev => prev.filter(day => day.date !== dateKey));
    if (editingDayDate === dateKey) setEditingDayDate(null);
  };

  const updateEventDayTimes = (dateKey: string, startTime: string, endTime: string) => {
    setEventDays(prev =>
      prev
        .map(day => (day.date === dateKey ? { ...day, startTime, endTime } : day))
        .sort((a, b) => a.date.localeCompare(b.date))
    );
  };

  const editingDay = editingDayDate
    ? eventDays.find(day => day.date === editingDayDate) || null
    : null;

  const openAvail = (eventId: string) => {
    const existing = availabilityMap[eventId]?.find(a => a.userId === auth.currentUser?.uid);
    setAvailNotes(existing?.notes || '');
    setAvailEventId(eventId);
    setAvailModalVisible(true);
  };

  const toggleStaffSelection = (uid: string) => {
    setStaffIds(prev =>
      prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]
    );
  };

  const handleDeleteEvent = (event: Event) => {
    if (!isAdmin) return;
    Alert.alert('Delete', 'Delete this event?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void deleteDoc(doc(getFirestore(), 'events', event.id)),
      },
    ]);
  };

  const renderEvent = ({ item }: { item: Event }) => {
    const avails = availabilityMap[item.id] || [];
    const filteredAvails = avails.filter(a => a.isAvailable && !(item.staffIds || []).includes(a.userId));
    const availableCount = filteredAvails.length;
    const myAvail = filteredAvails.find(a => a.userId === auth.currentUser?.uid);
    const confirmedCount = (item.staffIds || []).length;
    const neededCount = (item.staffNeeded || 1) - confirmedCount;
    const isComplete = neededCount <= 0;
    const days = normalizeEventDays(item);
    const linkedDate = pickLinkedScheduleDate(item);

    return (
      <View style={styles.eventCard}>
        <View style={styles.eventHeader}>
          <Text style={styles.eventTitle}>{item.title}</Text>
        </View>

        <View style={styles.daysSection}>
          {days.length === 0 ? (
            <Text style={styles.dayEmpty}>No days scheduled yet.</Text>
          ) : (
            days.map(day => (
              <View key={`${item.id}-${day.date}`} style={styles.dayRow}>
                <Text style={styles.dayDate}>{formatDayHeading(day.date)}</Text>
                <Text style={styles.dayTimes}>{formatTimeRange(day.startTime, day.endTime)}</Text>
              </View>
            ))
          )}
        </View>
        
        <TouchableOpacity 
          style={styles.locationRow} 
          onPress={() => item.locationUrl && Linking.openURL(item.locationUrl)}
        >
          <Icons.location color="#C9782B" width={14} height={14} />
          <Text style={[styles.locationText, item.locationUrl && styles.linkText]}>
            {item.locationName}
          </Text>
        </TouchableOpacity>

        <View style={styles.linkRow}>
          <TouchableOpacity
            style={styles.linkChip}
            onPress={() =>
              navigation.navigate('MySchedule', {
                initialDate: linkedDate,
                initialView: 'calendar',
              })
            }
          >
            <Text style={styles.linkChipText}>My Schedule</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.linkChip}
            onPress={() =>
              navigation.navigate('WorkingHours', linkedDate ? { initialDateKey: linkedDate } : undefined)
            }
          >
            <Text style={styles.linkChipText}>Working Hours</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.staffStatusRow}>
          <View style={styles.staffRow}>
            <Icons.users color={isComplete ? '#4CAF50' : '#A88E73'} width={16} height={16} />
            <Text style={[styles.staffText, isComplete && styles.staffTextComplete]}>
              Team: {isComplete ? 'Complete' : `${neededCount} more needed`}
            </Text>
          </View>
          <View style={styles.miniAvatarRow}>
            {(item.staffIds || []).slice(0, 5).map(uid => {
              const u = allUsers.find(user => user.id === uid);
              return (
                <Image 
                  key={uid}
                  source={resolveAvatarSource(u?.avatarUrl, u?.customAvatarUrl)}
                  style={styles.tinyAvatar}
                />
              );
            })}
            {confirmedCount > 5 && <Text style={styles.plusMore}>+{confirmedCount - 5}</Text>}
          </View>
        </View>

        <View style={styles.availSummary}>
          <View style={{flex: 1}}>
            <Text style={styles.availCount}>{availableCount} Member{availableCount !== 1 ? 's' : ''} Available</Text>
            {availableCount > 0 && <Text style={styles.availPreview}>{filteredAvails.map(a => a.userName).join(', ')}</Text>}
          </View>
          {!(item.staffIds || []).includes(auth.currentUser?.uid || '') && (
            <TouchableOpacity style={[styles.availBtn, myAvail && styles.availBtnActive]} onPress={() => openAvail(item.id)}>
              <Text style={[styles.availBtnText, myAvail && styles.availBtnTextActive]}>{myAvail ? '✓ Update' : 'I am available'}</Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={styles.eventChatBtn}
          onPress={() => navigation.navigate('Chat', { eventId: item.id, eventTitle: item.title })}
        >
          <Text style={styles.eventChatBtnText}>Open Event Chat</Text>
          {(unreadByEventId[item.id] || 0) > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>{unreadByEventId[item.id]}</Text>
            </View>
          )}
        </TouchableOpacity>

        {isAdmin && (
          <View style={styles.adminActions}>
            <View style={{flexDirection: 'row', gap: 12}}>
              <TouchableOpacity onPress={() => openEdit(item)} style={styles.editBtn}><Text style={styles.editBtnText}>Edit Event</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => handleDeleteEvent(item)} style={styles.deleteBtn}><Text style={styles.deleteBtnText}>Delete</Text></TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  };

  const markedAddDays = eventDays.reduce<Record<string, { selected: boolean; selectedColor: string }>>(
    (acc, day) => {
      acc[day.date] = { selected: true, selectedColor: '#C9782B' };
      return acc;
    },
    {}
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Icons.arrowLeft color="#F6EDE2" width={24} height={24} /></TouchableOpacity>
        <Text style={styles.title}>Events Hub</Text>
        {isAdmin ? (
          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={handleImportCsv}
              disabled={csvImporting}
              style={styles.csvBtn}
            >
              {csvImporting ? (
                <ActivityIndicator color="#C9782B" size="small" />
              ) : (
                <Text style={styles.csvBtnText}>CSV</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { resetForm(); setModalVisible(true); }}>
              <Icons.plus color="#C9782B" width={28} height={28} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ width: 28 }} />
        )}
      </View>

      {loadError ? (
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{loadError}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => {
              setLoadError(null);
              setLoading(true);
              setRetryToken(t => t + 1);
            }}
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : loading ? (
        <ActivityIndicator size="large" color="#C9782B" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          ref={listRef}
          data={events}
          keyExtractor={item => item.id}
          renderItem={renderEvent}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No upcoming events.</Text>}
          initialScrollIndex={events.length > 0 ? focusEventIndex : undefined}
          getItemLayout={getItemLayout}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          onContentSizeChange={handleListContentSizeChange}
        />
      )}

      {/* Main Modal */}
      <Modal visible={modalVisible && isAdmin} animationType="slide" transparent>
        <View style={styles.modalBg}>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.modalTitle}>{editingId ? 'Edit Event' : 'New Event'}</Text>
            
            <Text style={styles.label}>Event Title</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Glastonbury Festival" placeholderTextColor="#5A4739" />

            <Text style={styles.label}>Event Days</Text>
            <Text style={styles.hintInline}>
              Add days from the calendar. New days copy the previous day's hours. Tap a day to edit times.
            </Text>
            {eventDays.map(day => (
              <View key={day.date} style={styles.dayEditorRow}>
                <View style={styles.dayEditorHeader}>
                  <Text style={styles.dayEditorDate}>{formatDayHeading(day.date)}</Text>
                  <TouchableOpacity onPress={() => removeEventDay(day.date)}>
                    <Text style={styles.dayRemoveText}>Remove</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.dayTimeButton} onPress={() => setEditingDayDate(day.date)}>
                  <Text style={styles.dayTimeButtonValue}>{formatTimeRange(day.startTime, day.endTime)}</Text>
                  <Text style={styles.dayTimeButtonHint}>Tap to set start & finish</Text>
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={styles.addDayBtn} onPress={() => setAddDayPickerVisible(true)}>
              <Icons.plus color="#C9782B" width={18} height={18} />
              <Text style={styles.addDayBtnText}>Add day</Text>
            </TouchableOpacity>

            <Text style={styles.label}>Location Name</Text>
            <TextInput style={styles.input} value={locationName} onChangeText={setLocationName} placeholder="Central Park" placeholderTextColor="#5A4739" />

            <Text style={styles.label}>Google Maps Link</Text>
            <TextInput style={styles.input} value={locationUrl} onChangeText={setLocationUrl} placeholder="https://goo.gl/maps/..." placeholderTextColor="#5A4739" />

            <Text style={styles.label}>People Needed</Text>
            <TextInput style={styles.input} value={staffNeeded} onChangeText={setStaffNeeded} keyboardType="numeric" placeholder="1" placeholderTextColor="#5A4739" />

            <Text style={styles.label}>Confirmed Staff</Text>
            <View style={styles.staffPicker}>
              {allUsers.map(user => {
                const isSelected = staffIds.includes(user.id);
                return (
                  <TouchableOpacity key={user.id} style={[styles.staffPickerItem, isSelected && styles.staffPickerItemActive]} onPress={() => toggleStaffSelection(user.id)}>
                    <Image source={resolveAvatarSource(user.avatarUrl, user.customAvatarUrl)} style={styles.pickerAvatar} />
                    <Text style={[styles.staffPickerName, isSelected && styles.staffPickerNameActive]}>{user.name}</Text>
                    {isSelected && <Text style={styles.checkMark}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.label}>Event Notes</Text>
            <TextInput style={[styles.input, styles.textArea]} value={notes} onChangeText={setNotes} multiline numberOfLines={4} placeholder="Load-in at arrival gate 4..." placeholderTextColor="#5A4739" />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setModalVisible(false); resetForm(); }}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>{saving ? <ActivityIndicator color="#1E1813" /> : <Text style={styles.saveText}>Save Event</Text>}</TouchableOpacity>
            </View>
          </ScrollView>
        </View>

        {/* Add-day calendar */}
        <Modal visible={addDayPickerVisible} transparent animationType="fade">
          <View style={styles.datePickerOverlay}>
            <View style={styles.calendarCard}>
              <Text style={styles.calendarTitle}>Add event day</Text>
              <Calendar
                theme={{
                  backgroundColor: '#1E1813', calendarBackground: '#1E1813', selectedDayBackgroundColor: '#C9782B',
                  dayTextColor: '#F6EDE2', monthTextColor: '#F6EDE2', textDisabledColor: '#3A2D24',
                }}
                onDayPress={(day: any) => addEventDay(day.dateString)}
                markedDates={markedAddDays}
              />
              <TouchableOpacity onPress={() => setAddDayPickerVisible(false)} style={styles.closeCalendarBtn}><Text style={styles.closeCalendarBtnText}>Close</Text></TouchableOpacity>
            </View>
          </View>
        </Modal>
      </Modal>

      <EventDayTimeModal
        visible={isAdmin && editingDayDate !== null && !!editingDay}
        dayLabel={editingDayDate ? formatDayHeading(editingDayDate) : ''}
        startTime={editingDay?.startTime || DEFAULT_EVENT_DAY_TIMES.startTime}
        endTime={editingDay?.endTime || DEFAULT_EVENT_DAY_TIMES.endTime}
        onClose={() => setEditingDayDate(null)}
        onConfirm={(startTime, endTime) => {
          if (!editingDayDate) return;
          updateEventDayTimes(editingDayDate, startTime, endTime);
          setEditingDayDate(null);
        }}
      />

      {/* Availability Notes Modal */}
      <Modal visible={availModalVisible} animationType="fade" transparent>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Set Availability</Text>
            <Text style={styles.label}>Availability Notes (Optional)</Text>
            <TextInput style={[styles.input, styles.textArea]} value={availNotes} onChangeText={setAvailNotes} placeholder="Available Friday & Saturday only." placeholderTextColor="#5A4739" multiline />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setAvailModalVisible(false)}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={submitAvailability} disabled={submittingAvail}>{submittingAvail ? <ActivityIndicator color="#1E1813" /> : <Text style={styles.saveText}>Confirm Availability</Text>}</TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#2A211B' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, backgroundColor: '#1E1813', alignItems: 'center' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  csvBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#C9782B', minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  csvBtnText: { color: '#C9782B', fontWeight: '900', fontSize: 13 },
  title: { color: '#F6EDE2', fontSize: 20, fontWeight: '900' },
  list: { padding: 16, paddingBottom: 40 },
  eventCard: { backgroundColor: '#1E1813', padding: 16, borderRadius: 16, marginBottom: 16, borderWidth: 1, borderColor: '#3A2D24' },
  eventHeader: { marginBottom: 10 },
  eventTitle: { color: '#F6EDE2', fontSize: 18, fontWeight: '800' },
  daysSection: {
    backgroundColor: '#2A211B',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#3A2D24',
    gap: 8,
  },
  dayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  dayDate: { color: '#EBDCCB', fontSize: 14, fontWeight: '700', flex: 1 },
  dayTimes: { color: '#C9782B', fontSize: 13, fontWeight: '700' },
  dayEmpty: { color: '#7C6854', fontSize: 13, fontStyle: 'italic' },
  linkRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  linkChip: {
    flex: 1,
    backgroundColor: 'rgba(201, 120, 43, 0.12)',
    borderWidth: 1,
    borderColor: '#C9782B',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  linkChipText: { color: '#C9782B', fontSize: 12, fontWeight: '800' },
  locationRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  locationText: { color: '#EBDCCB', marginLeft: 6, fontSize: 14, flex: 1 },
  linkText: { textDecorationLine: 'underline', color: '#D9A441' },
  staffStatusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  staffRow: { flexDirection: 'row', alignItems: 'center' },
  staffText: { color: '#A88E73', marginLeft: 8, fontSize: 13, fontWeight: '600' },
  staffTextComplete: { color: '#4CAF50' },
  miniAvatarRow: { flexDirection: 'row', alignItems: 'center' },
  tinyAvatar: { width: 24, height: 24, borderRadius: 12, marginLeft: -8, borderWidth: 1, borderColor: '#1E1813' },
  plusMore: { color: '#A88E73', fontSize: 10, marginLeft: 4, fontWeight: '800' },
  availSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTopWidth: 1, borderTopColor: '#3A2D24' },
  availCount: { color: '#C8B29A', fontSize: 12, fontWeight: '700' },
  availPreview: { color: '#7C6854', fontSize: 10, marginTop: 1 },
  availBtn: { backgroundColor: '#3A2D24', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  availBtnActive: { backgroundColor: 'rgba(76, 175, 80, 0.1)', borderWidth: 1, borderColor: '#4CAF50' },
  availBtnText: { color: '#F6EDE2', fontSize: 11, fontWeight: '700' },
  availBtnTextActive: { color: '#4CAF50' },
  eventChatBtn: {
    marginTop: 12,
    backgroundColor: 'rgba(201, 120, 43, 0.16)',
    borderWidth: 1,
    borderColor: '#C9782B',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
  },
  eventChatBtnText: {
    color: '#C9782B',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  unreadBadge: {
    position: 'absolute',
    right: 10,
    top: 8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#E53935',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    borderWidth: 1,
    borderColor: '#fff',
  },
  unreadBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '900',
  },
  adminActions: { marginTop: 16, gap: 12, borderTopWidth: 1, borderTopColor: '#3A2D24', paddingTop: 16 },
  viewAvailBtn: { backgroundColor: 'rgba(201, 120, 43, 0.1)', paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  viewAvailBtnText: { color: '#C9782B', fontSize: 12, fontWeight: '700' },
  editBtn: { paddingVertical: 8, borderRadius: 8, backgroundColor: '#3A2D24', flex: 1, alignItems: 'center' },
  editBtnText: { color: '#F6EDE2', fontSize: 13, fontWeight: '700' },
  deleteBtn: { paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(158, 60, 46, 0.1)', flex: 1, alignItems: 'center' },
  deleteBtnText: { color: '#9E3C2E', fontSize: 13, fontWeight: '700' },
  empty: { color: '#A88E73', textAlign: 'center', marginTop: 40, fontStyle: 'italic' },
  errorWrap: { padding: 24, marginTop: 24, alignItems: 'center' },
  errorText: { color: '#9E3C2E', textAlign: 'center', fontSize: 14, marginBottom: 16 },
  retryBtn: { backgroundColor: '#3A2D24', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#C9782B' },
  retryBtnText: { color: '#C9782B', fontWeight: '800' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#1E1813', borderRadius: 24, padding: 24, borderWidth: 1, borderColor: '#3A2D24' },
  modalContent: { backgroundColor: '#1E1813', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '95%' },
  modalTitle: { color: '#F6EDE2', fontSize: 20, fontWeight: '900', marginBottom: 16, textAlign: 'center' },
  label: { color: '#A88E73', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginTop: 14, marginBottom: 4, letterSpacing: 1 },
  hintInline: { color: '#7C6854', fontSize: 12, marginBottom: 8 },
  gridRow: { flexDirection: 'row', gap: 12 },
  dayEditorRow: {
    backgroundColor: '#2A211B',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
  dayEditorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  dayEditorDate: { color: '#F6EDE2', fontSize: 14, fontWeight: '800' },
  dayRemoveText: { color: '#9E3C2E', fontSize: 12, fontWeight: '700' },
  dayTimeButton: {
    backgroundColor: '#171311',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4A3A30',
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  dayTimeButtonValue: {
    color: '#C9782B',
    fontSize: 16,
    fontWeight: '800',
  },
  dayTimeButtonHint: {
    color: '#7C6854',
    fontSize: 11,
    marginTop: 4,
    fontWeight: '600',
  },
  addDayBtn: {
    marginTop: 4,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#C9782B',
    borderRadius: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(201, 120, 43, 0.1)',
  },
  addDayBtnText: { color: '#C9782B', fontWeight: '800', fontSize: 14 },
  input: { backgroundColor: '#2A211B', color: '#F6EDE2', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#3A2D24' },
  dateBtn: { backgroundColor: '#2A211B', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#3A2D24', alignItems: 'center' },
  dateBtnText: { color: '#F6EDE2', fontSize: 14 },
  staffPicker: { backgroundColor: '#2A211B', borderRadius: 12, padding: 6, borderWidth: 1, borderColor: '#3A2D24', marginTop: 4 },
  staffPickerItem: { flexDirection: 'row', alignItems: 'center', padding: 8, borderRadius: 8, marginBottom: 2 },
  staffPickerItemActive: { backgroundColor: 'rgba(201, 120, 43, 0.15)' },
  pickerAvatar: { width: 28, height: 28, borderRadius: 14, marginRight: 10 },
  staffPickerName: { color: '#A88E73', fontSize: 14, flex: 1 },
  staffPickerNameActive: { color: '#F6EDE2', fontWeight: '700' },
  checkMark: { color: '#C9782B', fontSize: 16, fontWeight: '900' },
  textArea: { height: 80, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', marginTop: 24, gap: 12, marginBottom: 40 },
  cancelBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#3A2D24' },
  cancelText: { color: '#A88E73', fontWeight: 'bold' },
  saveBtn: { flex: 2, backgroundColor: '#C9782B', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  saveText: { color: '#1E1813', fontWeight: '900', fontSize: 15 },
  datePickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 },
  calendarCard: { backgroundColor: '#1E1813', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: '#3A2D24' },
  calendarTitle: { color: '#C9782B', fontSize: 14, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
  closeCalendarBtn: { marginTop: 12, padding: 10, alignItems: 'center' },
  closeCalendarBtnText: { color: '#C9782B', fontWeight: 'bold' },
});
