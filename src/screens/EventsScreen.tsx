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
  PermissionsAndroid,
  Pressable,
  Switch,
} from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import Slider from '@react-native-community/slider';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from '@react-native-firebase/firestore';
import { pick, types, errorCodes, isErrorWithCode } from '@react-native-documents/picker';
import { auth } from '../services/firebase';
import { useAuth } from '../auth/useAuth';
import { useFocusEffect } from '@react-navigation/native';
import { parseEventsCsv } from '../utils/parseEventsCsv';
import { readPickedFileAsUtf8 } from '../utils/readPickedDocumentText';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { openUserProfile } from '../navigation/openUserProfile';
import { Icons } from '../components/Icons';
import PizzaFireCalendar from '../components/PizzaFireCalendar';
import { resolveAvatarSource } from '../utils/avatar';
import {
  type EventDay,
  DEFAULT_EVENT_DAY_TIMES,
  formatDayHeading,
  formatOfficialOpeningRange,
  formatTimeLabel24,
  isValidEventOpeningRange,
  normalizeEventDay,
  normalizeEventDays,
  pickLinkedScheduleDate,
  sortEventsByDays,
  timesForNewEventDay,
  eventDayEndsNextDay,
  dateToTimeString,
  timeStringToDate,
  trimOpeningNote,
} from '../utils/eventDays';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { normalizeLatLng } from '../utils/geo';
import type { Geofence } from '../types';
import { getNativeStatus, openBatteryExemptionUi } from '../geofencing/native';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import { SHOW_DEBUG_ONLY_OPERATIONS } from '../config/buildFeatures';
import PizzaFireScreen from '../components/PizzaFireScreen';
import { startNewNamedSeason } from '../services/eventSeasons';
import {
  EVENT_SEASONS_CONFIG_ID,
  parseSeasonDoc,
  splitSortedEventsLiveAndArchived,
  type EventSeason,
} from '../utils/eventSeasons';

type Props = NativeStackScreenProps<RootStackParamList, 'Events'>;

type Event = {
  id: string;
  title: string;
  days?: EventDay[];
  sortDate?: string;
  locationName: string;
  locationUrl: string;
  staffIds: string[];
  adminConfirmedStaffIds?: string[];
  staffNeeded: number;
  notes: string;
  createdAt: any;
  geofenceId?: string | null;
  seasonId?: string | null;
  /** @deprecated legacy fields — use days */
  startDate?: string;
  endDate?: string;
  arrivalDate?: string;
  startTime?: string;
  endTime?: string;
  menuItems?: Array<{ id: string; name: string; price?: string | null }>;
};

type Availability = {
  userId: string;
  userName: string;
  isAvailable: boolean;
  attendanceStatus?: 'confirmed' | 'declined';
  notes: string;
  updatedAt: any;
};

type UserProfile = {
  id: string;
  name: string;
  avatarUrl?: string;
  customAvatarUrl?: string;
};

export default function EventsScreen({ navigation, route }: Props) {
  const authState = useAuth();
  const [userProfile, setUserProfile] = useState<any>(null);
  const profileIsAdmin = Array.isArray(userProfile?.roles) && userProfile.roles.includes('admin');
  const isAdmin = authState.status === 'admin' || profileIsAdmin;
  const [events, setEvents] = useState<Event[]>([]);
  const [seasons, setSeasons] = useState<EventSeason[]>([]);
  const [currentSeasonId, setCurrentSeasonId] = useState<string | null>(null);
  const [availabilityMap, setAvailabilityMap] = useState<Record<string, Availability[]>>({});
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  
  // Create/Edit Event Modal
  const [modalVisible, setModalVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [eventDays, setEventDays] = useState<EventDay[]>([]);
  const [eventMenuItems, setEventMenuItems] = useState<Array<{ id: string; name: string; price?: string | null }>>([]);
  const [locationName, setLocationName] = useState('');
  const [locationUrl, setLocationUrl] = useState('');
  const [staffIds, setStaffIds] = useState<string[]>([]);
  const [adminConfirmedStaffIds, setAdminConfirmedStaffIds] = useState<string[]>([]);
  const [staffNeeded, setStaffNeeded] = useState('1');
  const [notes, setNotes] = useState('');
  const [notesInputKey, setNotesInputKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [linkedGeofenceId, setLinkedGeofenceId] = useState<string | null>(null);
  const [worksiteCenter, setWorksiteCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [worksiteRadius, setWorksiteRadius] = useState(50);
  const [worksiteActive, setWorksiteActive] = useState(true);
  const [locating, setLocating] = useState(false);
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [ignoringBattery, setIgnoringBattery] = useState(true);
  const [csvImporting, setCsvImporting] = useState(false);
  const [expandedEventIds, setExpandedEventIds] = useState<string[]>([]);
  const [expandedTeamIds, setExpandedTeamIds] = useState<string[]>([]);
  const [menuEditor, setMenuEditor] = useState<{ item?: { id: string; name: string; price?: string | null } } | null>(null);
  const [menuItemName, setMenuItemName] = useState('');
  const [menuItemPrice, setMenuItemPrice] = useState('');
  const [staffPickerOpen, setStaffPickerOpen] = useState(false);
  const [unreadByEventId, setUnreadByEventId] = useState<Record<string, number>>({});
  const [seasonModalVisible, setSeasonModalVisible] = useState(false);
  const [newSeasonName, setNewSeasonName] = useState('');
  const [pendingNewSeasonName, setPendingNewSeasonName] = useState<string | null>(null);
  // This is the authority for filing events into a new season.  It is cleared
  // synchronously when a regular event form opens, so UI state cannot leak it.
  const pendingNewSeasonNameRef = useRef<string | null>(null);
  const eventCreationModeRef = useRef<'event' | 'new-season'>('event');
  const reopenEventFormOnFocusRef = useRef(false);
  const originalGeofenceIdRef = useRef<string | null>(null);
  const originalStaffIdsRef = useRef<string[]>([]);
  const eventsListRef = useRef<FlatList>(null);
  const stickToLatestRef = useRef(true);
  const initialEventFocusDoneRef = useRef(false);
  const [openedSeasonId, setOpenedSeasonId] = useState<string | null>(null);
  const openedFromNotificationRef = useRef<string | null>(null);
  const eventSplit = useMemo(
    () => splitSortedEventsLiveAndArchived(events, seasons, currentSeasonId),
    [events, seasons, currentSeasonId]
  );
  const openedSeason = eventSplit.archives.find(archive => archive.season.id === openedSeasonId) ?? null;
  const eventListRows = useMemo(() => {
    if (openedSeason) {
      return openedSeason.items.map(event => ({ kind: 'event' as const, event }));
    }
    return [
      ...eventSplit.archives.map(archive => ({ kind: 'archive' as const, archive })),
      ...eventSplit.live.map(event => ({ kind: 'event' as const, event })),
      ...(isAdmin ? [{ kind: 'startSeason' as const }] : []),
    ];
  }, [openedSeason, eventSplit, isAdmin]);

  const closestEventIndex = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let closestIndex = -1;
    let closestDistance = Number.POSITIVE_INFINITY;
    eventListRows.forEach((row, index) => {
      if (row.kind !== 'event') return;
      const day = normalizeEventDays(row.event)[0]?.date || row.event.sortDate;
      const dateMs = day ? new Date(`${day}T00:00:00`).getTime() : Number.NaN;
      if (Number.isNaN(dateMs)) return;
      const distance = Math.abs(dateMs - today.getTime());
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    return closestIndex;
  }, [eventListRows]);

  useEffect(() => {
    const eventId = route.params?.eventId?.trim();
    if (!eventId || openedFromNotificationRef.current === eventId) return;

    const targetArchive = eventSplit.archives.find(archive =>
      archive.items.some(event => event.id === eventId)
    );
    if (targetArchive && openedSeasonId !== targetArchive.season.id) {
      setOpenedSeasonId(targetArchive.season.id);
      return;
    }

    const index = eventListRows.findIndex(row => row.kind === 'event' && row.event.id === eventId);
    if (index < 0) return;

    openedFromNotificationRef.current = eventId;
    setExpandedEventIds(current => current.includes(eventId) ? current : [...current, eventId]);
    const timer = setTimeout(() => {
      eventsListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0 });
    }, 260);
    return () => clearTimeout(timer);
  }, [eventListRows, eventSplit.archives, openedSeasonId, route.params?.eventId]);

  useEffect(() => {
    if (initialEventFocusDoneRef.current || closestEventIndex < 0) return;
    const row = eventListRows[closestEventIndex];
    if (!row || row.kind !== 'event') return;
    initialEventFocusDoneRef.current = true;
    stickToLatestRef.current = false;
    const frame = requestAnimationFrame(() => {
      eventsListRef.current?.scrollToIndex({ index: closestEventIndex, animated: false, viewPosition: 0.5 });
    });
    return () => cancelAnimationFrame(frame);
  }, [closestEventIndex, eventListRows]);

  const toggleEventExpanded = (eventId: string) => {
    const wasExpanded = expandedEventIds.includes(eventId);
    setExpandedEventIds(current => wasExpanded ? current.filter(id => id !== eventId) : [...current, eventId]);
    if (!wasExpanded) {
      const index = eventListRows.findIndex(row => row.kind === 'event' && row.event.id === eventId);
      if (index >= 0) {
        setTimeout(() => {
          eventsListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0 });
        }, 220);
      }
    }
  };

  const toggleTeamDetails = (eventId: string) => {
    setExpandedTeamIds(current => current.includes(eventId)
      ? current.filter(id => id !== eventId)
      : [...current, eventId]);
  };

  useFocusEffect(
    useCallback(() => {
      initialEventFocusDoneRef.current = false;
      if (reopenEventFormOnFocusRef.current && isAdmin) {
        reopenEventFormOnFocusRef.current = false;
        setModalVisible(true);
      }
    }, [isAdmin])
  );

  // Add-day calendar picker
  const [addDayPickerVisible, setAddDayPickerVisible] = useState(false);
  const [pendingNewDayDate, setPendingNewDayDate] = useState<string | null>(null);
  const [timePickDate, setTimePickDate] = useState<string | null>(null);
  const [timePickMode, setTimePickMode] = useState<'add' | 'edit' | null>(null);
  const [pickingTimeField, setPickingTimeField] = useState<'start' | 'end' | null>(null);
  const [timeDraftStart, setTimeDraftStart] = useState(DEFAULT_EVENT_DAY_TIMES.startTime);
  const [timeDraftEnd, setTimeDraftEnd] = useState(DEFAULT_EVENT_DAY_TIMES.endTime);
  const timeDraftStartRef = useRef(DEFAULT_EVENT_DAY_TIMES.startTime);

  // Availability Modal
  const [availModalVisible, setAvailModalVisible] = useState(false);
  const [availEventId, setAvailEventId] = useState<string | null>(null);
  const [availNotes, setAvailNotes] = useState('');
  const [submittingAvail, setSubmittingAvail] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'android' || !isAdmin) return;
    void getNativeStatus().then(status => {
      if (status) setIgnoringBattery(status.ignoringBatteryOptimizations);
    });
  }, [isAdmin]);

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

    const eventQuery = isAdmin
      ? query(collection(fs, 'events'))
      : currentUid
        ? query(collection(fs, 'events'), where('staffIds', 'array-contains', currentUid))
        : null;
    setLoadError(null);
    if (!eventQuery) {
      setEvents([]);
      setLoading(false);
      return () => {
        unsubUsers();
        readUnsub();
      };
    }
    const unsubEvents = onSnapshot(
      eventQuery,
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

          if (!SHOW_DEBUG_ONLY_OPERATIONS) return;
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
        // A member may not be assigned to any events yet. Keep this as a
        // friendly empty state instead of surfacing Firestore's raw error.
        if (!isAdmin) {
          setEvents([]);
          setUnreadByEventId({});
          setLoadError(null);
        } else {
          setLoadError(err?.message || String(err));
        }
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
  }, [isAdmin, retryToken]);

  useEffect(() => {
    const q = query(collection(getFirestore(), 'geofences'));
    const unsub = onSnapshot(
      q,
      snap => {
        if (!snap?.docs) {
          setGeofences([]);
          return;
        }
        const items = snap.docs
          .map(d => {
            const data = d.data() as any;
            const center = normalizeLatLng(data.center ?? data.location ?? data.coords);
            if (!center) return null;
            return { id: d.id, ...data, center } as Geofence;
          })
          .filter(Boolean) as Geofence[];
        setGeofences(items);
      },
      () => setGeofences([])
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const fs = getFirestore();
    const unsubSeasons = onSnapshot(
      collection(fs, 'seasons'),
      snap => {
        if (!snap?.docs) {
          setSeasons([]);
          return;
        }
        setSeasons(snap.docs.map(d => parseSeasonDoc(d.id, d.data() as Record<string, unknown>)));
      },
      () => setSeasons([])
    );
    const unsubConfig = onSnapshot(
      doc(fs, 'appConfig', EVENT_SEASONS_CONFIG_ID),
      snap => {
        const raw = snap?.exists() ? (snap.data() as { currentSeasonId?: unknown })?.currentSeasonId : null;
        setCurrentSeasonId(typeof raw === 'string' && raw.trim() ? raw.trim() : null);
      },
      () => setCurrentSeasonId(null)
    );
    return () => {
      unsubSeasons();
      unsubConfig();
    };
  }, [retryToken]);

  const ensureLocationPermission = async () => {
    if (Platform.OS === 'ios') {
      try {
        const authStatus = await Geolocation.requestAuthorization('whenInUse');
        return authStatus === 'granted';
      } catch {
        return false;
      }
    }
    if (Platform.OS !== 'android') return true;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: 'Location Access',
        message: 'Location is required to set the event worksite.',
        buttonPositive: 'Allow',
        buttonNegative: 'Cancel',
      }
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  };

  const getCurrentWorksiteLocation = async () => {
    if (locating) return;
    const granted = await ensureLocationPermission();
    if (!granted) {
      Alert.alert('Permission denied', 'Location access is required.');
      return;
    }
    setLocating(true);
    try {
      const requestPosition = (options: any) =>
        new Promise<any>((resolve, reject) => {
          Geolocation.getCurrentPosition(resolve, reject, options);
        });
      let pos: any;
      try {
        pos = await requestPosition({
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
          showLocationDialog: true,
          forceRequestLocation: true,
        });
      } catch (err: any) {
        if (err?.code !== 2 && err?.code !== 3) throw err;
        pos = await requestPosition({
          enableHighAccuracy: false,
          timeout: 15000,
          maximumAge: 60000,
          showLocationDialog: true,
          forceRequestLocation: true,
        });
      }
      setWorksiteCenter({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      });
    } catch (err: any) {
      Alert.alert('Location Error', err?.message || 'Unable to get location.');
    } finally {
      setLocating(false);
    }
  };

  const handleSave = async () => {
    if (!isAdmin) {
      Alert.alert('Notice', 'Only admins can create or edit events.');
      return;
    }
    const sortedDays = [...eventDays].sort((a, b) => a.date.localeCompare(b.date));
    const trimmedTitle = title.trim();
    const trimmedLocation = locationName.trim() || trimmedTitle;
    if (!trimmedTitle || !trimmedLocation) {
      Alert.alert('Notice', 'Title and location are required.');
      return;
    }
    const invalidDay = sortedDays.find(day => !isValidEventOpeningRange(day.startTime, day.endTime));
    if (invalidDay) {
      Alert.alert(
        'Invalid times',
        `${formatDayHeading(invalidDay.date)}: opening and closing times must be valid and different.`
      );
      return;
    }
    const enteredMapValue = locationUrl.trim();
    const mapsUrl = enteredMapValue
      ? /^https?:\/\//i.test(enteredMapValue)
        ? enteredMapValue
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(enteredMapValue)}`
      : worksiteCenter
        ? `https://maps.google.com/?q=${worksiteCenter.lat},${worksiteCenter.lng}`
        : '';

    setSaving(true);
    const fs = getFirestore();
    try {
      let geofenceId = linkedGeofenceId;
      if (worksiteCenter) {
        const geoPayload: Record<string, unknown> = {
          name: trimmedLocation,
          radiusMeters: worksiteRadius,
          center: worksiteCenter,
          active: worksiteActive,
          teamId: userProfile?.teamId || 'team-1',
        };
        if (geofenceId) {
          await updateDoc(doc(fs, 'geofences', geofenceId), geoPayload);
        } else {
          const nameKey = trimmedLocation.toLowerCase();
          const duplicate = geofences.some(
            g => String(g?.name || '').trim().toLowerCase() === nameKey
          );
          if (duplicate) {
            Alert.alert(
              'Duplicate worksite name',
              'A worksite with this location name already exists. Use a distinct location name, or pick that worksite below.'
            );
            setSaving(false);
            return;
          }
          const user = auth.currentUser;
          if (user?.uid) geoPayload.createdBy = user.uid;
          geoPayload.createdAt = serverTimestamp();
          const geoRef = await addDoc(collection(fs, 'geofences'), geoPayload);
          geofenceId = geoRef.id;
        }
      }

      const daysToSave = sortedDays.map(day => {
        const normalized = normalizeEventDay(day);
        const note = trimOpeningNote(normalized.note);
        return {
          date: normalized.date,
          startTime: normalized.startTime,
          endTime: normalized.endTime,
          endsNextDay: eventDayEndsNextDay(normalized),
          ...(note ? { note } : {}),
        };
      });

      // Ordinary events belong to the active season.  Without this, the first
      // event added after reopening an existing season was untagged and the UI
      // displayed it as a fresh current season.
      const liveSeasonIds = [...new Set(
        eventSplit.live
          .map(event => typeof event.seasonId === 'string' ? event.seasonId.trim() : '')
          .filter(Boolean)
      )];
      const activeSeasonId = !editingId && eventCreationModeRef.current === 'event'
        ? currentSeasonId || (liveSeasonIds.length === 1 ? liveSeasonIds[0] : null)
        : null;

      const payload = {
        title: trimmedTitle,
        days: daysToSave,
        sortDate: sortedDays[0]?.date || null,
        locationName: trimmedLocation,
        locationUrl: mapsUrl,
        staffIds: staffIds || [],
        adminConfirmedStaffIds: adminConfirmedStaffIds.filter(userId => staffIds.includes(userId)),
        staffNeeded: parseInt(staffNeeded, 10) || 1,
        notes,
        ...(eventMenuItems.length > 0 || editingId ? { menuItems: eventMenuItems } : {}),
        ...(activeSeasonId ? { seasonId: activeSeasonId } : {}),
        geofenceId: geofenceId || null,
        updatedAt: serverTimestamp(),
      };

      const selectedStaffIds = Array.from(new Set(staffIds.filter(Boolean)));
      const newlySelectedStaffIds = editingId
        ? selectedStaffIds.filter(userId => !originalStaffIdsRef.current.includes(userId))
        : selectedStaffIds;
      let savedEventId = editingId;
      if (editingId) {
        await updateDoc(doc(fs, 'events', editingId), payload);
        if (geofenceId) {
          await updateDoc(doc(fs, 'geofences', geofenceId), { eventId: editingId });
        }
      } else {
        const eventRef = await addDoc(collection(fs, 'events'), {
          ...payload,
          createdAt: serverTimestamp(),
        });
        savedEventId = eventRef.id;
        setEditingId(eventRef.id);
        if (geofenceId) {
          await updateDoc(doc(fs, 'geofences', geofenceId), { eventId: eventRef.id });
        }
      }
      if (savedEventId) {
        await sendEventAssignmentNotifications(savedEventId, trimmedTitle, newlySelectedStaffIds);
      }
      const previousGeofenceId = originalGeofenceIdRef.current;
      if (previousGeofenceId && previousGeofenceId !== geofenceId) {
        await updateDoc(doc(fs, 'geofences', previousGeofenceId), { eventId: null });
      }
      const seasonName = eventCreationModeRef.current === 'new-season'
        ? pendingNewSeasonNameRef.current
        : null;
      if (seasonName && savedEventId) {
        await startNewNamedSeason(fs, seasonName, events, seasons, savedEventId);
        eventCreationModeRef.current = 'event';
        pendingNewSeasonNameRef.current = null;
        setPendingNewSeasonName(null);
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

  const sendEventAssignmentNotifications = async (eventId: string, eventTitle: string, userIds: string[]) => {
    const recipients = Array.from(new Set(userIds.filter(Boolean)));
    if (!eventId || recipients.length === 0) return;
    const fs = getFirestore();
    await Promise.allSettled(
      recipients.map(userId =>
        addDoc(collection(fs, 'users', userId, 'notifications'), {
          title: 'Event confirmation needed',
          body: `You have been selected for ${eventTitle}. Please confirm if you can attend.`,
          nav: { screen: 'Events', eventId },
          createdAt: serverTimestamp(),
        })
      )
    );
  };

  const setAttendanceResponse = async (eventId: string, attendanceStatus: 'confirmed' | 'declined') => {
    const user = auth.currentUser;
    if (!user?.uid) return;
    try {
      await setDoc(
        doc(getFirestore(), 'events', eventId, 'availability', user.uid),
        {
          userId: user.uid,
          userName: userProfile?.name || user.email || 'Team member',
          isAvailable: false,
          attendanceStatus,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setExpandedEventIds(current => current.filter(id => id !== eventId));
    } catch (err: any) {
      Alert.alert('Notice', err?.message || 'Unable to save your event response.');
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
          const eventRef = await addDoc(collection(fs, 'events'), {
            title: r.title,
            days: [
              normalizeEventDay({
                date: r.arrivalDate || r.startDate,
                startTime: r.startTime || DEFAULT_EVENT_DAY_TIMES.startTime,
                endTime: r.endTime || DEFAULT_EVENT_DAY_TIMES.endTime,
              }),
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
          await sendEventAssignmentNotifications(eventRef.id, r.title, r.staffIds);
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
    // A normal new/edit form must never carry a previously abandoned season flow.
    eventCreationModeRef.current = 'event';
    pendingNewSeasonNameRef.current = null;
    setPendingNewSeasonName(null);
    setTitle('');
    setEventDays([]);
    setEventMenuItems([]);
    setLocationName('');
    setLocationUrl('');
    setStaffIds([]);
    setAdminConfirmedStaffIds([]);
    originalStaffIdsRef.current = [];
    setStaffPickerOpen(false);
    setStaffNeeded('1');
    setNotes('');
    setNotesInputKey(current => current + 1);
    setEditingId(null);
    setLinkedGeofenceId(null);
    originalGeofenceIdRef.current = null;
    setWorksiteCenter(null);
    setWorksiteRadius(50);
    setWorksiteActive(false);
  };

  useEffect(() => {
    if (!isAdmin && modalVisible) {
      setModalVisible(false);
      setPendingNewSeasonName(null);
      resetForm();
    }
  }, [isAdmin, modalVisible]);

  const openEdit = (event: Event) => {
    if (!isAdmin) return;
    eventCreationModeRef.current = 'event';
    pendingNewSeasonNameRef.current = null;
    setPendingNewSeasonName(null);
    setTitle(event.title);
    setEventDays(normalizeEventDays(event));
    setEventMenuItems(Array.isArray(event.menuItems) ? event.menuItems : []);
    setLocationName(event.locationName);
    setLocationUrl(event.locationUrl);
    setStaffIds(event.staffIds || []);
    originalStaffIdsRef.current = Array.isArray(event.staffIds) ? event.staffIds : [];
    setAdminConfirmedStaffIds(Array.isArray(event.adminConfirmedStaffIds) ? event.adminConfirmedStaffIds : []);
    setStaffNeeded((event.staffNeeded || 1).toString());
    setNotes(event.notes);
    setNotesInputKey(current => current + 1);
    setEditingId(event.id);
    const geoId = event.geofenceId || null;
    setLinkedGeofenceId(geoId);
    originalGeofenceIdRef.current = geoId;
    const linked = geoId ? geofences.find(g => g.id === geoId) : undefined;
    setWorksiteCenter(linked?.center || null);
    setWorksiteRadius(linked?.radiusMeters || 50);
    setWorksiteActive(linked ? linked.active !== false : true);
    setModalVisible(true);
  };

  const beginAddEventDay = (dateKey: string) => {
    if (eventDays.some(day => day.date === dateKey)) {
      setAddDayPickerVisible(false);
      return;
    }
    const times = timesForNewEventDay(eventDays, dateKey);
    timeDraftStartRef.current = times.startTime;
    setTimeDraftStart(times.startTime);
    setTimeDraftEnd(times.endTime);
    setPendingNewDayDate(dateKey);
    setTimePickDate(dateKey);
    setTimePickMode('add');
    setAddDayPickerVisible(false);
    setPickingTimeField('start');
  };

  const cancelTimePick = () => {
    setPickingTimeField(null);
    setTimePickMode(null);
    setPendingNewDayDate(null);
    setTimePickDate(null);
  };

  const commitOpeningTimes = (dateKey: string, startTime: string, endTime: string, asNew: boolean) => {
    if (!isValidEventOpeningRange(startTime, endTime)) {
      Alert.alert('Invalid times', 'Opening and closing times must be valid and different.');
      return false;
    }
    if (asNew) {
      setEventDays(prev => {
        if (prev.some(day => day.date === dateKey)) return prev;
        return [...prev, normalizeEventDay({ date: dateKey, startTime, endTime })].sort((a, b) =>
          a.date.localeCompare(b.date)
        );
      });
    } else {
      updateEventDayTimes(dateKey, startTime, endTime);
    }
    return true;
  };

  const onOpeningTimePicked = (event: DateTimePickerEvent, selected?: Date) => {
    if (event.type === 'dismissed') {
      cancelTimePick();
      return;
    }
    if (!selected || !timePickDate || !pickingTimeField) return;
    const next = dateToTimeString(selected);

    if (pickingTimeField === 'start') {
      timeDraftStartRef.current = next;
      setTimeDraftStart(next);
      if (timePickMode === 'add') {
        if (Platform.OS === 'android') {
          setPickingTimeField(null);
          setTimeout(() => setPickingTimeField('end'), 80);
        } else {
          setPickingTimeField('end');
        }
        return;
      }
      const existing = eventDays.find(day => day.date === timePickDate);
      if (commitOpeningTimes(timePickDate, next, existing?.endTime || DEFAULT_EVENT_DAY_TIMES.endTime, false)) {
        cancelTimePick();
      }
      return;
    }

    const startTime = timeDraftStartRef.current;
    if (!commitOpeningTimes(timePickDate, startTime, next, timePickMode === 'add')) {
      if (timePickMode === 'add' && Platform.OS === 'android') {
        setPickingTimeField(null);
        setTimeout(() => setPickingTimeField('end'), 80);
      }
      return;
    }
    cancelTimePick();
  };

  const openStartTimeEditor = (day: EventDay) => {
    timeDraftStartRef.current = day.startTime;
    setTimeDraftStart(day.startTime);
    setTimeDraftEnd(day.endTime);
    setTimePickDate(day.date);
    setTimePickMode('edit');
    setPickingTimeField('start');
  };

  const openEndTimeEditor = (day: EventDay) => {
    timeDraftStartRef.current = day.startTime;
    setTimeDraftStart(day.startTime);
    setTimeDraftEnd(day.endTime);
    setTimePickDate(day.date);
    setTimePickMode('edit');
    setPickingTimeField('end');
  };

  const removeEventDay = (dateKey: string) => {
    setEventDays(prev => prev.filter(day => day.date !== dateKey));
    if (timePickDate === dateKey) cancelTimePick();
  };

  const updateEventDayTimes = (dateKey: string, startTime: string, endTime: string) => {
    setEventDays(prev =>
      prev
        .map(day =>
          day.date === dateKey
            ? normalizeEventDay({ ...day, date: dateKey, startTime, endTime })
            : day
        )
        .sort((a, b) => a.date.localeCompare(b.date))
    );
  };

  const updateEventDayNote = (dateKey: string, note: string) => {
    setEventDays(prev =>
      prev.map(day => (day.date === dateKey ? normalizeEventDay({ ...day, note }) : day))
    );
  };

  const openAvail = (eventId: string) => {
    const existing = availabilityMap[eventId]?.find(a => a.userId === auth.currentUser?.uid);
    setAvailNotes(existing?.notes || '');
    setAvailEventId(eventId);
    setAvailModalVisible(true);
  };

  const toggleStaffSelection = (uid: string) => {
    if (!staffIds.includes(uid)) {
      setStaffIds(prev => [...prev, uid]);
      return;
    }
    if (!adminConfirmedStaffIds.includes(uid)) {
      setAdminConfirmedStaffIds(prev => [...prev, uid]);
      return;
    }
    setStaffIds(prev => prev.filter(id => id !== uid));
    setAdminConfirmedStaffIds(prev => prev.filter(id => id !== uid));
  };

  const selectAllStaff = () => {
    const allUserIds = allUsers.map(user => user.id).filter(Boolean);
    const everyoneSelected = allUserIds.length > 0 && allUserIds.every(userId => staffIds.includes(userId));
    if (everyoneSelected) {
      setStaffIds([]);
      setAdminConfirmedStaffIds([]);
      return;
    }
    setStaffIds(prev => Array.from(new Set([...prev, ...allUserIds])));
  };

  const openStartNewSeason = () => {
    if (!isAdmin) return;
    setNewSeasonName('');
    setSeasonModalVisible(true);
  };

  const handleStartNewSeason = () => {
    if (!isAdmin) return;
    const trimmed = newSeasonName.trim();
    if (!trimmed) {
      Alert.alert('Notice', 'Enter a name for the new season.');
      return;
    }
    resetForm();
    eventCreationModeRef.current = 'new-season';
    pendingNewSeasonNameRef.current = trimmed;
    setPendingNewSeasonName(trimmed);
    setSeasonModalVisible(false);
    setNewSeasonName('');
    setOpenedSeasonId(null);
    stickToLatestRef.current = true;
    setModalVisible(true);
  };

  const handleDeleteEvent = (event: Event) => {
    if (!isAdmin) return;
    Alert.alert(
      'Delete event',
      'Delete this event? If the linked worksite has no clock-in history it will also be removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void deleteEventAndMaybeWorksite(event),
        },
      ]
    );
  };

  const deleteEventAndMaybeWorksite = async (event: Event) => {
    const fs = getFirestore();
    try {
      const geofenceId = event.geofenceId;
      if (geofenceId) {
        const shiftSnap = await getDocs(
          query(collection(fs, 'shifts'), where('geofenceId', '==', geofenceId), limit(1))
        );
        if (shiftSnap.empty) {
          await deleteDoc(doc(fs, 'geofences', geofenceId));
        } else {
          await updateDoc(doc(fs, 'geofences', geofenceId), { eventId: null, active: false });
        }
      }
      await deleteDoc(doc(fs, 'events', event.id));
    } catch (err: any) {
      Alert.alert('Notice', err?.message || 'Failed to delete event.');
    }
  };

  const openMenuEditor = (item?: { id: string; name: string; price?: string | null }) => {
    if (!isAdmin) return;
    setMenuEditor({ item });
    setMenuItemName(item?.name || '');
    setMenuItemPrice(item?.price || '');
  };

  const saveMenuItem = async () => {
    if (!menuEditor || !isAdmin) return;
    const name = menuItemName.trim();
    if (!name) { Alert.alert('Menu item', 'Item name is required.'); return; }
    const items = eventMenuItems;
    const next = { id: menuEditor.item?.id || `menu-${Date.now()}`, name, price: menuItemPrice.trim() || null };
    setEventMenuItems(menuEditor.item ? items.map(item => item.id === next.id ? next : item) : [...items, next]);
    setMenuEditor(null);
  };

  const deleteMenuItem = (itemId: string) => {
    setEventMenuItems(current => current.filter(item => item.id !== itemId));
  };

  const renderEvent = ({ item }: { item: Event }) => {
    const avails = availabilityMap[item.id] || [];
    const filteredAvails = avails.filter(a => a.isAvailable && !(item.staffIds || []).includes(a.userId));
    const availableCount = filteredAvails.length;
    const myAvail = filteredAvails.find(a => a.userId === auth.currentUser?.uid);
    const myAttendance = avails.find(a => a.userId === auth.currentUser?.uid);
    const isSelectedStaff = (item.staffIds || []).includes(auth.currentUser?.uid || '');
    const selectedStaffIds = item.staffIds || [];
    const adminConfirmedIds = new Set(item.adminConfirmedStaffIds || []);
    const confirmedStaffIds = selectedStaffIds.filter(userId => {
      const response = avails.find(availability => availability.userId === userId)?.attendanceStatus;
      return response !== 'declined' && (response === 'confirmed' || adminConfirmedIds.has(userId));
    });
    const pendingCount = selectedStaffIds.length - confirmedStaffIds.length;
    const confirmedCount = confirmedStaffIds.length;
    const neededCount = (item.staffNeeded || 1) - confirmedCount;
    const isComplete = neededCount <= 0;
    const days = normalizeEventDays(item);
    const linkedDate = pickLinkedScheduleDate(item);
    const expanded = expandedEventIds.includes(item.id);
    const menuItems = Array.isArray(item.menuItems) ? item.menuItems : [];
    const firstDay = days[0];
    const lastDay = days[days.length - 1];
    const dateRange = firstDay
      ? lastDay && lastDay.date !== firstDay.date
        ? `${formatDayHeading(firstDay.date)} – ${formatDayHeading(lastDay.date)}`
        : formatDayHeading(firstDay.date)
      : '';
    const eventSummary = [dateRange, item.locationName].filter(Boolean).join(' · ');
    const teamDetailsExpanded = expandedTeamIds.includes(item.id);
    const confirmedColleagues = confirmedStaffIds
      .filter(userId => userId !== auth.currentUser?.uid)
      .map(userId => allUsers.find(user => user.id === userId)?.name || 'Team member');

    return (
      <View style={styles.eventCard}>
        <Pressable onPress={() => toggleEventExpanded(item.id)} accessibilityRole="button">
          <View style={[styles.eventHeader, expanded && styles.eventHeaderExpanded]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.eventTitle}>{item.title}</Text>
              <View style={styles.eventSummaryRow}>
                <Text style={styles.eventSummary} numberOfLines={1}>{eventSummary}</Text>
              </View>
            </View>
            {isSelectedStaff && myAttendance?.attendanceStatus ? (
              <View style={styles.eventHeaderControls}>
                <TouchableOpacity
                  style={[styles.memberResponsePill, myAttendance.attendanceStatus === 'confirmed' ? styles.memberResponseIn : styles.memberResponseOut]}
                  onPress={() => void setAttendanceResponse(item.id, myAttendance.attendanceStatus === 'confirmed' ? 'declined' : 'confirmed')}
                  accessibilityRole="button"
                  accessibilityLabel={myAttendance.attendanceStatus === 'confirmed' ? 'Change attendance to out' : 'Change attendance to in'}
                >
                  <Text style={[styles.memberResponseText, myAttendance.attendanceStatus === 'confirmed' ? styles.memberResponseInText : styles.memberResponseOutText]}>
                    {myAttendance.attendanceStatus === 'confirmed' ? 'In' : 'Out'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </Pressable>
        {expanded ? <>
        {isAdmin && (
          <View style={styles.adminActionsTop}>
            <TouchableOpacity onPress={() => openEdit(item)} style={styles.editBtn}>
              <Text style={styles.editBtnText}>Edit Event</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleDeleteEvent(item)} style={styles.deleteBtn}>
              <Text style={styles.deleteBtnText}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}

        {isAdmin ? (
          <Pressable onPress={() => openEdit(item)}>
            <Text style={styles.openingLabel}>Official opening</Text>
            <View style={styles.daysSection} pointerEvents="none">
              {days.length === 0 ? (
                <Text style={styles.dayEmpty}>No days scheduled yet.</Text>
              ) : (
                days.map(day => (
                  <View key={`${item.id}-${day.date}`}>
                    <View style={styles.dayRow}>
                      <Text style={styles.dayDate} numberOfLines={1}>
                        {formatDayHeading(day.date)}
                      </Text>
                      <Text style={styles.dayTimes} numberOfLines={1}>
                        {formatOfficialOpeningRange(day.startTime, day.endTime, day.endsNextDay)}
                      </Text>
                    </View>
                    {day.note ? <Text style={styles.dayNote}>{day.note}</Text> : null}
                  </View>
                ))
              )}
            </View>
          </Pressable>
        ) : (
          <>
            <Text style={styles.openingLabel}>Official opening</Text>
            <View style={styles.daysSection}>
              {days.length === 0 ? (
                <Text style={styles.dayEmpty}>No days scheduled yet.</Text>
              ) : (
                days.map(day => (
                  <View key={`${item.id}-${day.date}`}>
                    <View style={styles.dayRow}>
                      <Text style={styles.dayDate} numberOfLines={1}>
                        {formatDayHeading(day.date)}
                      </Text>
                      <Text style={styles.dayTimes} numberOfLines={1}>
                        {formatOfficialOpeningRange(day.startTime, day.endTime, day.endsNextDay)}
                      </Text>
                    </View>
                    {day.note ? <Text style={styles.dayNote}>{day.note}</Text> : null}
                  </View>
                ))
              )}
            </View>
          </>
        )}
        
        <TouchableOpacity 
          style={styles.locationRow} 
          onPress={() => item.locationUrl && Linking.openURL(item.locationUrl)}
        >
          <Icons.location color={PIZZA_FIRE.gold} width={14} height={14} />
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
          <TouchableOpacity
            style={styles.staffRow}
            onPress={() => isAdmin ? navigation.navigate('AdminAvailability', { event: item }) : toggleTeamDetails(item.id)}
          >
            <Icons.users color={isComplete ? '#4CAF50' : '#A88E73'} width={16} height={16} />
            <Text style={[styles.staffText, isComplete && styles.staffTextComplete]}>
              Team: {confirmedCount} confirmed
            </Text>
            {isAdmin && pendingCount > 0 ? <Text style={styles.staffPendingText}> · {pendingCount} pending</Text> : null}
          </TouchableOpacity>
          <View style={styles.miniAvatarRow}>
            {selectedStaffIds.slice(0, 5).map(uid => {
              const u = allUsers.find(user => user.id === uid);
              const isConfirmedStaff = confirmedStaffIds.includes(uid);
              return (
                <TouchableOpacity
                  key={uid}
                  onPress={() => openUserProfile(navigation, { userId: uid, userName: u?.name })}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Image
                    source={resolveAvatarSource(u?.avatarUrl, u?.customAvatarUrl)}
                    style={[styles.tinyAvatar, isConfirmedStaff && styles.tinyAvatarConfirmed]}
                  />
                </TouchableOpacity>
              );
            })}
            {selectedStaffIds.length > 5 && <Text style={styles.plusMore}>+{selectedStaffIds.length - 5}</Text>}
          </View>
        </View>
        {!isAdmin && teamDetailsExpanded ? <View style={styles.teamDetails}>
          {confirmedColleagues.length
            ? confirmedColleagues.map((name, index) => <View key={`${item.id}-${name}-${index}`} style={styles.menuRow}><Text style={styles.menuItemName}>{name}</Text></View>)
            : <Text style={styles.teamDetailsText}>No colleagues confirmed yet.</Text>}
        </View> : null}

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

        {SHOW_DEBUG_ONLY_OPERATIONS ? <TouchableOpacity
          style={styles.eventChatBtn}
          onPress={() => navigation.navigate('Chat', { eventId: item.id, eventTitle: item.title })}
        >
          <Text style={styles.eventChatBtnText}>Open Event Chat</Text>
          {(unreadByEventId[item.id] || 0) > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>{unreadByEventId[item.id]}</Text>
            </View>
          )}
        </TouchableOpacity> : null}
        {menuItems.length > 0 ? <View style={styles.menuSection}>
          <Text style={styles.openingLabel}>Menu</Text>
          {menuItems.map(menuItem => <View key={menuItem.id} style={styles.menuRow}><View style={styles.menuItemTap}><Text style={styles.menuItemName}>{menuItem.name}</Text>{menuItem.price ? <Text style={styles.menuItemPrice}>€{menuItem.price}</Text> : null}</View></View>)}
        </View> : null}
        {isSelectedStaff && !myAttendance?.attendanceStatus ? <View style={styles.attendanceActions}>
          <TouchableOpacity
            style={[styles.attendanceBtn, styles.attendanceConfirmBtn, myAttendance?.attendanceStatus === 'confirmed' && styles.attendanceConfirmBtnActive]}
            onPress={() => void setAttendanceResponse(item.id, 'confirmed')}
          >
            <Text style={styles.attendanceConfirmText}>{myAttendance?.attendanceStatus === 'confirmed' ? '✓ I’m in' : 'I’m in'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.attendanceBtn, styles.attendanceDeclineBtn, myAttendance?.attendanceStatus === 'declined' && styles.attendanceDeclineBtnActive]}
            onPress={() => void setAttendanceResponse(item.id, 'declined')}
          >
            <Text style={styles.attendanceDeclineText}>{myAttendance?.attendanceStatus === 'declined' ? '✓ Can’t make it' : 'Can’t make it'}</Text>
          </TouchableOpacity>
        </View> : null}
        </> : null}
      </View>
    );
  };

  const markedAddDays = eventDays.reduce<Record<string, { selected: boolean; selectedColor: string }>>(
    (acc, day) => {
      acc[day.date] = { selected: true, selectedColor: PIZZA_FIRE.accent };
      return acc;
    },
    {}
  );

  return (
    <PizzaFireScreen>
    <View style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            if (openedSeasonId) {
              stickToLatestRef.current = true;
              setOpenedSeasonId(null);
              return;
            }
            navigation.goBack();
          }}
        >
          <Icons.arrowLeft color={PIZZA_FIRE.gold} width={24} height={24} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{openedSeason ? openedSeason.season.name : 'Events'}</Text>
        {isAdmin ? (
          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={handleImportCsv}
              disabled={csvImporting}
              style={styles.csvBtn}
            >
              {csvImporting ? (
                <ActivityIndicator color={PIZZA_FIRE.accent} size="small" />
              ) : (
                <Text style={styles.csvBtnText}>CSV</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { resetForm(); eventCreationModeRef.current = 'event'; setModalVisible(true); }}
              style={styles.newEventBtn}
            >
              <Icons.plus color={PIZZA_FIRE.gold} width={18} height={18} />
              <Text style={styles.newEventBtnText}>New Event</Text>
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
        <ActivityIndicator size="large" color={PIZZA_FIRE.accent} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          ref={eventsListRef}
          data={eventListRows}
          keyExtractor={(item, index) =>
            item.kind === 'event'
              ? item.event.id
              : item.kind === 'archive'
                ? `archive-${item.archive.season.id}`
                : `start-season-${index}`
          }
          renderItem={({ item }) => {
            if (item.kind === 'archive') {
              return (
                <TouchableOpacity
                  style={styles.seasonFileRow}
                  onPress={() => {
                    stickToLatestRef.current = false;
                    setOpenedSeasonId(item.archive.season.id);
                  }}
                  accessibilityRole="button"
                >
                  <View>
                    <Text style={styles.seasonFileLabel}>Season file</Text>
                    <Text style={styles.seasonFileName}>{item.archive.season.name}</Text>
                    <Text style={styles.seasonFileMeta}>
                      {item.archive.items.length} event{item.archive.items.length === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <Text style={styles.seasonFileArrow}>›</Text>
                </TouchableOpacity>
              );
            }
            if (item.kind === 'startSeason') {
              return (
                <TouchableOpacity style={styles.startSeasonBtn} onPress={openStartNewSeason} accessibilityRole="button">
                  <Text style={styles.startSeasonBtnText}>Start New Season</Text>
                </TouchableOpacity>
              );
            }
            return renderEvent({ item: item.event });
          }}
          contentContainerStyle={styles.list}
          onScrollBeginDrag={() => {
            stickToLatestRef.current = false;
          }}
          onContentSizeChange={() => {
            if (!openedSeasonId && stickToLatestRef.current) {
              eventsListRef.current?.scrollToEnd({ animated: false });
            }
          }}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {isAdmin
                ? 'No upcoming events.'
                : 'No events posted yet - speak to your admin about upcoming events.'}
            </Text>
          }
        />
      )}

      <Modal visible={!!menuEditor && isAdmin} transparent animationType="fade" onRequestClose={() => setMenuEditor(null)}>
        <View style={styles.modalBg}><View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{menuEditor?.item ? 'Edit menu item' : 'Add menu item'}</Text>
          <Text style={styles.label}>Item name</Text>
          <TextInput style={styles.input} value={menuItemName} onChangeText={setMenuItemName} placeholder="e.g. Margherita" placeholderTextColor="#5A4739" autoFocus />
          <Text style={styles.label}>Price (optional)</Text>
          <TextInput style={styles.input} value={menuItemPrice} onChangeText={setMenuItemPrice} placeholder="e.g. 11.00" keyboardType="decimal-pad" placeholderTextColor="#5A4739" />
          <View style={styles.modalActions}><TouchableOpacity style={styles.cancelBtn} onPress={() => setMenuEditor(null)}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity><TouchableOpacity style={styles.saveBtn} onPress={() => void saveMenuItem()}><Text style={styles.saveText}>Save item</Text></TouchableOpacity></View>
        </View></View>
      </Modal>

      {/* Main Modal */}
      <Modal visible={modalVisible && isAdmin} animationType="slide" transparent>
        <View style={styles.modalBg}>
          <ScrollView style={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>{editingId && !pendingNewSeasonName ? 'Edit Event' : 'New Event'}</Text>
            {pendingNewSeasonName ? (
              <Text style={styles.hintInline}>
                First event of {pendingNewSeasonName}. The previous season stays current until you save this event.
              </Text>
            ) : null}
            
            <Text style={styles.label}>Event Title</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Glastonbury Festival" placeholderTextColor="#5A4739" />

            <Text style={styles.label}>Event Days & Official Opening</Text>
            <Text style={styles.hintInline}>
              These times are shop/event opening hours, not employee shifts. Tap START or FINISH to edit. Overnight closing shows +1 day.
            </Text>
            {eventDays.map((day, index) => (
              <View key={day.date} style={styles.dayEditorRow}>
                <View style={styles.dayEditorHeader}>
                  <Text style={styles.dayEditorDate}>
                    Day {index + 1} · {formatDayHeading(day.date)}
                  </Text>
                  <TouchableOpacity onPress={() => removeEventDay(day.date)}>
                    <Text style={styles.dayRemoveText}>Remove</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.dayTimeSplit}>
                  <TouchableOpacity style={styles.dayTimeHalf} onPress={() => openStartTimeEditor(day)}>
                    <Text style={styles.dayTimeHalfLabel}>Start</Text>
                    <Text style={styles.dayTimeButtonValue}>{formatTimeLabel24(day.startTime)}</Text>
                  </TouchableOpacity>
                  <Text style={styles.dayTimeDash}>–</Text>
                  <TouchableOpacity style={styles.dayTimeHalf} onPress={() => openEndTimeEditor(day)}>
                    <Text style={styles.dayTimeHalfLabel}>Finish</Text>
                    <Text style={styles.dayTimeButtonValue}>
                      {formatTimeLabel24(day.endTime)}
                      {eventDayEndsNextDay(day) ? ' (+1 day)' : ''}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.dayNoteLabel}>Note</Text>
                <TextInput
                  key={`event-day-note-${day.date}-${notesInputKey}`}
                  style={styles.dayNoteInput}
                  defaultValue={day.note || ''}
                  onChangeText={text => updateEventDayNote(day.date, text)}
                  placeholder="Optional — e.g. Food trucks may arrive from 16:00"
                  placeholderTextColor="#5A4739"
                  multiline
                />
              </View>
            ))}
            <TouchableOpacity style={styles.addDayBtn} onPress={() => setAddDayPickerVisible(true)}>
              <Icons.plus color={PIZZA_FIRE.gold} width={22} height={22} />
              <Text style={styles.addDayBtnText}>Add Day</Text>
            </TouchableOpacity>

            <Text style={styles.label}>Menu (optional)</Text>
            {eventMenuItems.map(item => (
              <View key={item.id} style={styles.menuRow}>
                <TouchableOpacity style={styles.menuItemTap} onPress={() => openMenuEditor(item)}>
                  <Text style={styles.menuItemName}>{item.name}</Text>
                  {item.price ? <Text style={styles.menuItemPrice}>€{item.price}</Text> : null}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteMenuItem(item.id)}><Text style={styles.menuDelete}>×</Text></TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={styles.addDayBtn} onPress={() => openMenuEditor()}>
              <Icons.plus color={PIZZA_FIRE.gold} width={22} height={22} />
              <Text style={styles.addDayBtnText}>Add item</Text>
            </TouchableOpacity>

            {!ignoringBattery && Platform.OS === 'android' && (
              <TouchableOpacity style={styles.batteryBanner} onPress={() => void openBatteryExemptionUi()}>
                <Text style={styles.batteryTitle}>Battery optimization is on</Text>
                <Text style={styles.batteryText}>
                  Background clock-in alerts may be delayed. Tap to set No restrictions.
                </Text>
              </TouchableOpacity>
            )}

            <Text style={styles.label}>Location Name</Text>
            <TextInput style={styles.input} value={locationName} onChangeText={setLocationName} placeholder="Hurricane festival site" placeholderTextColor="#5A4739" />

            <Text style={styles.label}>Worksite pin & geofence</Text>
            <Text style={styles.hintInline}>
              Optional. Pin a location to create or update a linked clock-in worksite, or pick an existing worksite. Worksites can also exist without an event.
            </Text>
            <View style={styles.activeRow}>
              <Text style={styles.activeRowLabel}>Geofence active</Text>
              <Switch value={worksiteActive} onValueChange={setWorksiteActive} />
            </View>
            {worksiteActive ? <>
            {geofences.length > 0 ? (
              <>
                <Text style={styles.label}>Use existing worksite</Text>
                <View style={styles.worksitePickWrap}>
                  {geofences.map(g => {
                    const selected = linkedGeofenceId === g.id;
                    return (
                      <TouchableOpacity
                        key={g.id}
                        style={[styles.worksitePickChip, selected && styles.worksitePickChipActive]}
                        onPress={() => {
                          setLinkedGeofenceId(g.id);
                          setWorksiteCenter(g.center || null);
                          setWorksiteRadius(g.radiusMeters || 50);
                          setWorksiteActive(g.active !== false);
                          if (!locationName.trim()) setLocationName(g.name);
                        }}
                      >
                        <Text style={[styles.worksitePickChipText, selected && styles.worksitePickChipTextActive]}>
                          {g.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            ) : null}
            <TouchableOpacity
              style={styles.manageWorksitesLink}
              onPress={() => {
                reopenEventFormOnFocusRef.current = true;
                setModalVisible(false);
                navigation.navigate('Geofences');
              }}
            >
              <Text style={styles.manageWorksitesLinkText}>Manage worksites</Text>
            </TouchableOpacity>
            <Text style={styles.label}>Radius (meters): {worksiteRadius}</Text>
            <Slider
              minimumValue={10}
              maximumValue={500}
              step={5}
              value={worksiteRadius}
              onValueChange={setWorksiteRadius}
            />
            <View style={styles.locBtns}>
              <TouchableOpacity style={styles.locBtn} onPress={() => void getCurrentWorksiteLocation()}>
                {locating ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.locBtnText}>Use Current Location</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.locBtn, styles.locBtnAlt]}
                onPress={() => {
                  reopenEventFormOnFocusRef.current = true;
                  setModalVisible(false);
                  navigation.navigate('MapPicker', {
                    initialLocation: worksiteCenter || undefined,
                    onLocationSelected: (lat, lng) => {
                      reopenEventFormOnFocusRef.current = false;
                      setWorksiteCenter({ lat, lng });
                      setModalVisible(true);
                    },
                  });
                }}
              >
                <Text style={styles.locBtnText}>Pick on Map</Text>
              </TouchableOpacity>
            </View>
            {worksiteCenter ? (
              <>
                <Text style={styles.ok}>
                  ✓ Pin set ({worksiteCenter.lat.toFixed(5)}, {worksiteCenter.lng.toFixed(5)})
                </Text>
                {linkedGeofenceId ? (
                  <TouchableOpacity
                    style={[styles.locBtn, styles.locBtnAlt, { marginTop: 10 }]}
                    onPress={() => {
                      reopenEventFormOnFocusRef.current = true;
                      setModalVisible(false);
                      navigation.navigate('WorksiteFinder', {
                        geofence: {
                          id: linkedGeofenceId,
                          name: locationName.trim() || title.trim() || 'Worksite',
                          active: worksiteActive,
                          radiusMeters: worksiteRadius,
                          center: worksiteCenter,
                          teamId: userProfile?.teamId || 'team-1',
                          createdBy: '',
                          createdAt: null,
                        },
                      });
                    }}
                  >
                    <Text style={styles.locBtnText}>View worksite location</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            ) : (
              <Text style={styles.pinHint}>Optional pin — this becomes the worksite geofence.</Text>
            )}
            {worksiteCenter || linkedGeofenceId ? (
              <TouchableOpacity
                onPress={() => {
                  setLinkedGeofenceId(null);
                  setWorksiteCenter(null);
                }}
                style={{ marginTop: 8 }}
              >
                <Text style={styles.manageWorksitesLinkText}>Save event without a worksite</Text>
              </TouchableOpacity>
            ) : null}
            </> : <Text style={styles.pinHint}>Geofence is inactive. Turn it on to select or create a worksite.</Text>}

            <Text style={styles.label}>Google Maps link or address (optional)</Text>
            <TextInput style={styles.input} value={locationUrl} onChangeText={setLocationUrl} placeholder="e.g. Alexanderplatz, Berlin" placeholderTextColor="#5A4739" />

            <Text style={styles.label}>People Needed</Text>
            <TextInput style={styles.input} value={staffNeeded} onChangeText={setStaffNeeded} keyboardType="numeric" placeholder="1" placeholderTextColor="#5A4739" />

            <Text style={styles.label}>Event Staff</Text>
            <TouchableOpacity style={styles.staffDropdown} onPress={() => setStaffPickerOpen(open => !open)}>
              <Text style={styles.staffDropdownText}>{staffIds.length ? `${staffIds.length} selected · ${adminConfirmedStaffIds.length} confirmed` : 'Select staff'}</Text>
              <Text style={styles.expandIndicator}>{staffPickerOpen ? '⌃' : '⌄'}</Text>
            </TouchableOpacity>
            {staffPickerOpen ? <View style={styles.staffPicker}>
              <TouchableOpacity style={styles.selectAllStaffBtn} onPress={selectAllStaff}>
                <Text style={styles.selectAllStaffText}>Select all members</Text>
              </TouchableOpacity>
              {allUsers.map(user => {
                const isSelected = staffIds.includes(user.id);
                const isConfirmed = adminConfirmedStaffIds.includes(user.id);
                return (
                  <TouchableOpacity key={user.id} style={[styles.staffPickerItem, isSelected && styles.staffPickerItemActive, isConfirmed && styles.staffPickerItemConfirmed]} onPress={() => toggleStaffSelection(user.id)}>
                    <Image source={resolveAvatarSource(user.avatarUrl, user.customAvatarUrl)} style={styles.pickerAvatar} />
                    <Text style={[styles.staffPickerName, isSelected && styles.staffPickerNameActive, isConfirmed && styles.staffPickerNameConfirmed]}>{user.name}</Text>
                    {isSelected && <Text style={[styles.checkMark, isConfirmed && styles.checkMarkConfirmed]}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </View> : null}

            <Text style={styles.label}>Event Notes</Text>
            <TextInput key={`event-notes-${notesInputKey}`} style={[styles.input, styles.textArea]} defaultValue={notes} onChangeText={setNotes} multiline numberOfLines={4} placeholder="Load-in at arrival gate 4..." placeholderTextColor="#5A4739" />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  setModalVisible(false);
                  setPendingNewSeasonName(null);
                  resetForm();
                }}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>{saving ? <ActivityIndicator color={PIZZA_FIRE.charcoal} /> : <Text style={styles.saveText}>{editingId || !worksiteCenter ? 'Save Event' : 'Save Event & Worksite'}</Text>}</TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={addDayPickerVisible && isAdmin} transparent animationType="fade">
        <View style={styles.datePickerOverlay}>
          <View style={styles.calendarCard}>
            <Text style={styles.calendarTitle}>Add event day</Text>
            <PizzaFireCalendar
              firstDay={1}
              theme={{
                backgroundColor: PIZZA_FIRE.surfaceInset, calendarBackground: 'transparent', selectedDayBackgroundColor: PIZZA_FIRE.accent,
                dayTextColor: '#F6EDE2', monthTextColor: '#F6EDE2', textDisabledColor: '#3A2D24',
              }}
              onDayPress={(day: any) => beginAddEventDay(day.dateString)}
              markedDates={markedAddDays}
            />
            <TouchableOpacity onPress={() => setAddDayPickerVisible(false)} style={styles.closeCalendarBtn}>
              <Text style={styles.closeCalendarBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {pickingTimeField && Platform.OS === 'android' ? (
        <DateTimePicker
          value={timeStringToDate(pickingTimeField === 'start' ? timeDraftStart : timeDraftEnd)}
          mode="time"
          is24Hour
          display="default"
          onChange={onOpeningTimePicked}
        />
      ) : null}

      {pickingTimeField && Platform.OS === 'ios' ? (
        <Modal visible transparent animationType="fade" onRequestClose={cancelTimePick}>
          <View style={styles.datePickerOverlay}>
            <View style={styles.calendarCard}>
              <Text style={styles.calendarTitle}>
                {pickingTimeField === 'start' ? 'Start' : 'Finish'}
                {timePickDate ? ` · ${formatDayHeading(timePickDate)}` : ''}
              </Text>
              <DateTimePicker
                value={timeStringToDate(pickingTimeField === 'start' ? timeDraftStart : timeDraftEnd)}
                mode="time"
                is24Hour
                display="spinner"
                onChange={(_event, selected) => {
                  if (!selected) return;
                  const next = dateToTimeString(selected);
                  if (pickingTimeField === 'start') {
                    timeDraftStartRef.current = next;
                    setTimeDraftStart(next);
                  } else {
                    setTimeDraftEnd(next);
                  }
                }}
                themeVariant="dark"
              />
              <TouchableOpacity
                onPress={() =>
                  onOpeningTimePicked(
                    { type: 'set' } as DateTimePickerEvent,
                    timeStringToDate(pickingTimeField === 'start' ? timeDraftStart : timeDraftEnd)
                  )
                }
                style={styles.closeCalendarBtn}
              >
                <Text style={styles.closeCalendarBtnText}>
                  {timePickMode === 'add' && pickingTimeField === 'start' ? 'Next' : 'Save'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={cancelTimePick} style={styles.closeCalendarBtn}>
                <Text style={styles.closeCalendarBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      ) : null}

      <Modal visible={seasonModalVisible && isAdmin} animationType="fade" transparent onRequestClose={() => setSeasonModalVisible(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Start New Season</Text>
            <Text style={styles.hintInline}>
              Name the file for events so far. Next you will create the first event of the new season. Nothing changes until that event is saved.
            </Text>
            <Text style={styles.label}>Season name</Text>
            <TextInput
              style={styles.input}
              value={newSeasonName}
              onChangeText={setNewSeasonName}
              placeholder="e.g. Season 2026"
              placeholderTextColor="#5A4739"
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  setSeasonModalVisible(false);
                  setNewSeasonName('');
                }}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleStartNewSeason}>
                <Text style={styles.saveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Availability Notes Modal */}
      <Modal visible={availModalVisible} animationType="fade" transparent>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Set Availability</Text>
            <Text style={styles.label}>Availability Notes (Optional)</Text>
            <TextInput style={[styles.input, styles.textArea]} value={availNotes} onChangeText={setAvailNotes} placeholder="Available Friday & Saturday only." placeholderTextColor="#5A4739" multiline />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setAvailModalVisible(false)}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={submitAvailability} disabled={submittingAvail}>{submittingAvail ? <ActivityIndicator color={PIZZA_FIRE.charcoal} /> : <Text style={styles.saveText}>Confirm Availability</Text>}</TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: PIZZA_FIRE.divider,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 28 },
  csvBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
    backgroundColor: PIZZA_FIRE.qlFill,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  csvBtnText: { color: PIZZA_FIRE.textSecondary, fontWeight: '800', fontSize: 12 },
  newEventBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: PIZZA_FIRE.qlFill,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  newEventBtnText: { color: PIZZA_FIRE.textSecondary, fontSize: 12, fontWeight: '800' },
  title: { color: PIZZA_FIRE.textPrimary, fontSize: 18, fontWeight: '900', flex: 1, textAlign: 'center' },
  list: { padding: 16, paddingBottom: 40 },
  seasonHeader: { marginBottom: 10, marginTop: 4 },
  seasonHeaderLabel: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  seasonHeaderName: { color: PIZZA_FIRE.gold, fontSize: 20, fontWeight: '900' },
  startSeasonBtn: {
    alignSelf: 'center',
    marginTop: 4,
    marginBottom: 28,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
    backgroundColor: PIZZA_FIRE.qlFill,
  },
  startSeasonBtnText: { color: PIZZA_FIRE.textSecondary, fontSize: 11, fontWeight: '800' },
  seasonFileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  seasonFileLabel: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  seasonFileName: { color: PIZZA_FIRE.gold, fontSize: 18, fontWeight: '900' },
  seasonFileMeta: { color: PIZZA_FIRE.textMuted, fontSize: 12, marginTop: 4 },
  seasonFileArrow: { color: PIZZA_FIRE.gold, fontSize: 22, fontWeight: '700' },
  seasonFooterSpacer: { height: 12 },
  eventCard: {
    backgroundColor: PIZZA_FIRE.surface,
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  eventHeader: { flexDirection: 'row', alignItems: 'center' },
  eventHeaderExpanded: { marginBottom: 10 },
  eventTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 18, fontWeight: '800' },
  eventHeaderControls: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', marginLeft: 10 },
  memberResponsePill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, borderWidth: 1 },
  memberResponseIn: { backgroundColor: 'rgba(76, 175, 80, 0.12)', borderColor: '#4CAF50' },
  memberResponseOut: { backgroundColor: 'rgba(255, 69, 58, 0.20)', borderColor: 'rgba(255, 160, 150, 0.75)' },
  memberResponseText: { fontSize: 11, fontWeight: '900' },
  memberResponseInText: { color: '#4CAF50' },
  memberResponseOutText: { color: '#FFB4AD' },
  eventSummaryRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  eventSummary: { color: PIZZA_FIRE.textMuted, fontSize: 12, fontWeight: '600', flex: 1, minWidth: 0 },
  expandIndicator: { color: PIZZA_FIRE.gold, fontSize: 21, fontWeight: '800', marginLeft: 10, lineHeight: 18 },
  adminActionsTop: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  openingLabel: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  daysSection: {
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
    gap: 8,
  },
  dayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  dayDate: {
    color: PIZZA_FIRE.textSecondary,
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    marginRight: 8,
  },
  dayTimes: {
    color: PIZZA_FIRE.accent,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
    flexShrink: 0,
    maxWidth: '62%',
  },
  dayEmpty: { color: PIZZA_FIRE.textMuted, fontSize: 13, fontStyle: 'italic' },
  dayNote: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
    fontStyle: 'italic',
  },
  linkRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  linkChip: {
    flex: 1,
    backgroundColor: PIZZA_FIRE.qlFill,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
    borderRadius: 16,
    paddingVertical: 10,
    alignItems: 'center',
  },
  linkChipText: { color: PIZZA_FIRE.textSecondary, fontSize: 12, fontWeight: '800' },
  locationRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  locationText: { color: PIZZA_FIRE.textSecondary, marginLeft: 6, fontSize: 14, flex: 1 },
  linkText: { textDecorationLine: 'underline', color: PIZZA_FIRE.gold },
  staffStatusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  staffRow: { flexDirection: 'row', alignItems: 'center' },
  staffText: { color: PIZZA_FIRE.textMuted, marginLeft: 8, fontSize: 13, fontWeight: '600' },
  staffTextComplete: { color: '#4CAF50' },
  staffPendingText: { color: PIZZA_FIRE.textMuted, fontSize: 12, fontWeight: '700' },
  teamDetails: { marginTop: -7, marginBottom: 14 },
  teamDetailsText: { color: PIZZA_FIRE.textSecondary, fontSize: 13, lineHeight: 18 },
  miniAvatarRow: { flexDirection: 'row', alignItems: 'center' },
  tinyAvatar: { width: 24, height: 24, borderRadius: 12, marginLeft: -8, borderWidth: 1, borderColor: PIZZA_FIRE.charcoal },
  tinyAvatarConfirmed: { borderColor: '#4CAF50', borderWidth: 2 },
  plusMore: { color: PIZZA_FIRE.textMuted, fontSize: 10, marginLeft: 4, fontWeight: '800' },
  availSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTopWidth: 1, borderTopColor: PIZZA_FIRE.divider },
  availCount: { color: PIZZA_FIRE.textSecondary, fontSize: 12, fontWeight: '700' },
  availPreview: { color: PIZZA_FIRE.textMuted, fontSize: 10, marginTop: 1 },
  availBtn: { backgroundColor: PIZZA_FIRE.inputBg, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  availBtnActive: { backgroundColor: 'rgba(76, 175, 80, 0.1)', borderWidth: 1, borderColor: '#4CAF50' },
  availBtnText: { color: PIZZA_FIRE.textPrimary, fontSize: 11, fontWeight: '700' },
  availBtnTextActive: { color: '#4CAF50' },
  attendanceActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  attendanceBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 16, borderWidth: 1 },
  attendanceConfirmBtn: { backgroundColor: 'rgba(76, 175, 80, 0.10)', borderColor: '#4CAF50' },
  attendanceConfirmBtnActive: { backgroundColor: 'rgba(76, 175, 80, 0.22)' },
  attendanceConfirmText: { color: '#4CAF50', fontSize: 13, fontWeight: '800' },
  attendanceDeclineBtn: { backgroundColor: 'rgba(255, 69, 58, 0.34)', borderColor: 'rgba(255, 160, 150, 0.75)' },
  attendanceDeclineBtnActive: { backgroundColor: 'rgba(255, 69, 58, 0.50)' },
  attendanceDeclineText: { color: '#FFB4AD', fontSize: 13, fontWeight: '800' },
  eventChatBtn: {
    marginTop: 12,
    backgroundColor: PIZZA_FIRE.qlFill,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
    paddingVertical: 10,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  eventChatBtnText: {
    color: PIZZA_FIRE.textSecondary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  menuSection: { marginTop: 14, backgroundColor: PIZZA_FIRE.surfaceInset, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: PIZZA_FIRE.qlBorder },
  menuRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: PIZZA_FIRE.divider },
  menuItemTap: { flex: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // Match the text treatment used by the official-opening day rows.
  menuItemName: { color: PIZZA_FIRE.textSecondary, fontSize: 14, fontWeight: '700', flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 },
  menuItemPrice: { color: PIZZA_FIRE.accent, fontSize: 13, fontWeight: '700', textAlign: 'right', flexShrink: 0, maxWidth: '62%' },
  menuDelete: { color: '#E96B5A', fontSize: 24, paddingLeft: 12, paddingVertical: 5 },
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
  adminActions: { marginTop: 16, gap: 12, borderTopWidth: 1, borderTopColor: PIZZA_FIRE.divider, paddingTop: 16 },
  viewAvailBtn: { backgroundColor: PIZZA_FIRE.accentSoft, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  viewAvailBtnText: { color: PIZZA_FIRE.accent, fontSize: 12, fontWeight: '700' },
  editBtn: {
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: PIZZA_FIRE.qlFill,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
    flex: 1,
    alignItems: 'center',
  },
  editBtnText: { color: PIZZA_FIRE.textSecondary, fontSize: 13, fontWeight: '800' },
  deleteBtn: {
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 69, 58, 0.34)',
    borderWidth: 1,
    borderColor: 'rgba(255, 160, 150, 0.75)',
    flex: 1,
    alignItems: 'center',
  },
  deleteBtnText: { color: '#FFE4E0', fontSize: 13, fontWeight: '800' },
  empty: { color: PIZZA_FIRE.textMuted, textAlign: 'center', marginTop: 40, fontStyle: 'italic' },
  errorWrap: { padding: 24, marginTop: 24, alignItems: 'center' },
  errorText: { color: '#9E3C2E', textAlign: 'center', fontSize: 14, marginBottom: 16 },
  retryBtn: { backgroundColor: PIZZA_FIRE.inputBg, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: PIZZA_FIRE.accent },
  retryBtnText: { color: PIZZA_FIRE.accent, fontWeight: '800' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: PIZZA_FIRE.bgMid, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder },
  modalContent: { backgroundColor: PIZZA_FIRE.bgMid, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '95%' },
  modalTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 20, fontWeight: '900', marginBottom: 16, textAlign: 'center' },
  label: { color: PIZZA_FIRE.textMuted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginTop: 14, marginBottom: 4, letterSpacing: 1 },
  hintInline: { color: PIZZA_FIRE.textMuted, fontSize: 12, marginBottom: 8 },
  gridRow: { flexDirection: 'row', gap: 12 },
  dayEditorRow: {
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  dayEditorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  dayEditorDate: { color: PIZZA_FIRE.textPrimary, fontSize: 14, fontWeight: '800' },
  dayRemoveText: { color: '#9E3C2E', fontSize: 12, fontWeight: '700' },
  dayTimeSplit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dayTimeHalf: {
    flex: 1,
    backgroundColor: PIZZA_FIRE.crustDark,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  dayTimeHalfLabel: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  dayTimeDash: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 18,
    fontWeight: '800',
  },
  dayNoteLabel: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 10,
    marginBottom: 4,
  },
  dayNoteInput: {
    backgroundColor: PIZZA_FIRE.crustDark,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    color: PIZZA_FIRE.textPrimary,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 40,
    textAlignVertical: 'top',
  },
  dayTimeButton: {
    backgroundColor: PIZZA_FIRE.crustDark,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  dayTimeButtonValue: {
    color: PIZZA_FIRE.accent,
    fontSize: 16,
    fontWeight: '800',
  },
  dayTimeButtonHint: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 11,
    marginTop: 4,
    fontWeight: '600',
  },
  locBtns: { flexDirection: 'row', gap: 10, marginTop: 8 },
  locBtn: {
    flex: 1,
    backgroundColor: PIZZA_FIRE.accent,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  locBtnAlt: { backgroundColor: '#3D352E' },
  worksitePickWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  worksitePickChip: {
    backgroundColor: PIZZA_FIRE.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  worksitePickChipActive: {
    borderColor: PIZZA_FIRE.accent,
    backgroundColor: PIZZA_FIRE.accentSoft,
  },
  worksitePickChipText: { color: PIZZA_FIRE.textMuted, fontSize: 13 },
  worksitePickChipTextActive: { color: PIZZA_FIRE.accent, fontWeight: 'bold' },
  manageWorksitesLink: { marginBottom: 8 },
  manageWorksitesLinkText: { color: PIZZA_FIRE.gold, fontSize: 13, fontWeight: '700' },
  locBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 12, textAlign: 'center' },
  ok: { textAlign: 'center', marginTop: 10, color: '#CFA15A', fontWeight: 'bold' },
  pinHint: { textAlign: 'center', marginTop: 8, color: PIZZA_FIRE.textMuted, fontSize: 12 },
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 4,
  },
  activeRowLabel: { color: PIZZA_FIRE.textSecondary, fontSize: 13, fontWeight: '700' },
  addDayBtn: {
    marginTop: 4,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.accent,
    borderRadius: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: PIZZA_FIRE.accentSoft,
  },
  addDayBtnText: { color: PIZZA_FIRE.accent, fontWeight: '800', fontSize: 14 },
  batteryBanner: {
    backgroundColor: '#4A2A1A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.accent,
  },
  batteryTitle: { color: PIZZA_FIRE.textPrimary, fontWeight: '800', marginBottom: 4 },
  batteryText: { color: PIZZA_FIRE.textSecondary, fontSize: 12, lineHeight: 18 },
  input: { backgroundColor: PIZZA_FIRE.inputBg, color: PIZZA_FIRE.textPrimary, padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder },
  dateBtn: { backgroundColor: PIZZA_FIRE.inputBg, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder, alignItems: 'center' },
  dateBtnText: { color: PIZZA_FIRE.textPrimary, fontSize: 14 },
  staffPicker: { backgroundColor: PIZZA_FIRE.inputBg, borderRadius: 12, padding: 6, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder, marginTop: 4 },
  selectAllStaffBtn: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 7, marginBottom: 4, borderRadius: 8, backgroundColor: PIZZA_FIRE.qlFill, borderWidth: 1, borderColor: PIZZA_FIRE.qlBorder },
  selectAllStaffText: { color: PIZZA_FIRE.accent, fontSize: 12, fontWeight: '800' },
  staffDropdown: { backgroundColor: PIZZA_FIRE.inputBg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  staffDropdownText: { color: PIZZA_FIRE.textPrimary, fontSize: 14, fontWeight: '700' },
  staffPickerItem: { flexDirection: 'row', alignItems: 'center', padding: 8, borderRadius: 8, marginBottom: 2 },
  staffPickerItemActive: { backgroundColor: 'rgba(201, 120, 43, 0.15)' },
  staffPickerItemConfirmed: { backgroundColor: 'rgba(76, 175, 80, 0.12)' },
  pickerAvatar: { width: 28, height: 28, borderRadius: 14, marginRight: 10 },
  staffPickerName: { color: PIZZA_FIRE.textMuted, fontSize: 14, flex: 1 },
  staffPickerNameActive: { color: PIZZA_FIRE.textPrimary, fontWeight: '700' },
  staffPickerNameConfirmed: { color: '#4CAF50' },
  checkMark: { color: PIZZA_FIRE.accent, fontSize: 16, fontWeight: '900' },
  checkMarkConfirmed: { color: '#4CAF50', borderWidth: 1, borderColor: '#4CAF50', borderRadius: 10, width: 20, height: 20, textAlign: 'center', lineHeight: 18 },
  textArea: { height: 80, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', marginTop: 24, gap: 12, marginBottom: 40 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
    backgroundColor: PIZZA_FIRE.qlFill,
  },
  cancelText: { color: PIZZA_FIRE.textMuted, fontWeight: '800' },
  saveBtn: {
    flex: 2,
    backgroundColor: PIZZA_FIRE.hotAccent,
    paddingVertical: 12,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PIZZA_FIRE.hotAccentBorder,
  },
  saveText: { color: PIZZA_FIRE.textPrimary, fontWeight: '800', fontSize: 15 },
  datePickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 },
  calendarCard: { backgroundColor: PIZZA_FIRE.bgMid, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder },
  calendarTitle: { color: PIZZA_FIRE.accent, fontSize: 14, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
  closeCalendarBtn: { marginTop: 12, padding: 10, alignItems: 'center' },
  closeCalendarBtnText: { color: PIZZA_FIRE.accent, fontWeight: 'bold' },
});
