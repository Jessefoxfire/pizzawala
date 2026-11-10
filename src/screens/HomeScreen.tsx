import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Alert,
  Image,
  Linking,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from '@react-native-firebase/firestore';
import { signOutUser, nativeAuth } from '../services/firebase';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/AppNavigator';
import {
  getLastSelectedWorksiteId,
  getWorksiteAlertsEnabled,
  getWorksiteLocationEnabled,
  setLastSelectedWorksiteId,
  setLastUserName,
  subscribeLocationFeatureSettings,
} from '../geofencing/storage';
import { effectiveGeofenceRadiusMeters } from '../geofencing/effectiveRadius';
import { resolveAvatarSource } from '../utils/avatar';
import { useAuth } from '../auth/useAuth';
import Geolocation from 'react-native-geolocation-service';
import {
  calcCurrentPauseMs,
  calcWorkedMs,
  coalesceExtraOpenLiveShifts,
  isShiftPaused,
  offlineOpenShiftToLiveShift,
  pauseLiveShift,
  resolveHomeActiveShift,
  resumeLiveShift,
  startLiveShift,
  type LiveShift,
} from '../services/shifts';
import { getOfflineOpenShift } from '../offline/outbox';
import { subscribeOutboxChanges } from '../offline/events';
import { usePendingShiftEnds } from '../offline/usePendingShiftEnds';
import { useOffline } from '../context/OfflineContext';
import CircularShiftTimer from '../components/CircularShiftTimer';
import HomeBottomNav from '../components/HomeBottomNav';
import DaySummaryModal from '../components/DaySummaryModal';
import ShiftEditReviewModal from '../components/ShiftEditReviewModal';
import PizzaFireBackground from '../components/PizzaFireBackground';
import { Icons } from '../components/Icons';
import { PIZZA_FIRE, PIZZA_FIRE_RADIUS } from '../theme/pizzaFireTheme';
import { homeChrome, homeTimerSize, useAppLayout } from '../theme/responsiveLayout';
import type { Geofence } from '../types';
import { getDistanceMeters, normalizeLatLng } from '../utils/geo';
import {
  formatDistanceFromWorksite,
  activeWorksites as filterActiveWorksites,
  isActiveWorksite,
  pickDefaultWorksiteId,
  shouldShowOutsideSiteStartPrompt,
  worksiteGoogleMapsUrl,
} from '../utils/locationPrompt';
import { USE_INLINE_WORKSITE_DROPDOWN } from '../config/homeWorksitePicker';
import {
  clearPendingShiftReview,
  loadPersistedShiftReview,
  parseShiftEditReviewFromData,
  takePendingShiftReview,
  wasShiftReviewDismissed,
  type ShiftEditReviewPayload,
} from '../notifications/shiftEditReview';
import {
  getMissingComplianceFields,
  getMissingRequiredDocuments,
  getRequiredDocumentTypesForUser,
  readGermanCompliance,
  type GermanComplianceProfile,
} from '../constants/germanEmployeeCompliance';

const WORKSITE_OPTION_ROW_HEIGHT = 40;
const WORKSITE_LIST_VISIBLE_ROWS = 4;
const WORKSITE_LIST_PADDING_TOP = 4;
const WORKSITE_LIST_PADDING_BOTTOM = 8;
const WORKSITE_LIST_MAX_HEIGHT =
  WORKSITE_OPTION_ROW_HEIGHT * WORKSITE_LIST_VISIBLE_ROWS +
  WORKSITE_LIST_PADDING_TOP +
  WORKSITE_LIST_PADDING_BOTTOM;
const WORKSITE_SHEET_CORNER_RADIUS = 17;
const WORKSITE_OPTION_SELECTED_RADIUS = 12;

type WorksiteGlyph = 'location' | 'truck' | 'clock' | null;

type ShiftDoc = LiveShift & {
  worksiteName?: string;
};

type QuickLink = {
  label: string;
  icon: any;
  route: keyof RootStackParamList;
};

const QUICK_LINKS: QuickLink[] = [
  { label: 'Working Hours', icon: require('../../assets/Icons/Schedule.png'), route: 'WorkingHours' },
  { label: 'Schedule', icon: require('../../assets/Icons/Schedule.png'), route: 'MySchedule' },
  { label: 'Events', icon: require('../../assets/Icons/Events.png'), route: 'Events' },
  { label: 'Chat', icon: require('../../assets/Icons/Chat.png'), route: 'Chat' },
  { label: 'Documents', icon: require('../../assets/Icons/Profile.png'), route: 'RequiredDocuments' },
  { label: 'Profile', icon: require('../../assets/Icons/Profile.png'), route: 'EditProfile' },
  { label: 'Settings', icon: require('../../assets/Icons/Admin.png'), route: 'Settings' },
];

export default function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Home'>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Home'>>();
  const insets = useSafeAreaInsets();
  const layout = useAppLayout();
  const chrome = homeChrome(layout, insets.top);
  const { offlineHint } = useOffline();
  const authState = useAuth();
  const [userName, setUserName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [customAvatarUrl, setCustomAvatarUrl] = useState<string | null>(null);
  const [profileIsAdmin, setProfileIsAdmin] = useState(false);
  const [sessionUid, setSessionUid] = useState<string | null>(null);
  const [openShift, setOpenShift] = useState<ShiftDoc | null>(null);
  const [offlineShift, setOfflineShift] = useState<ShiftDoc | null>(null);
  const [worksites, setWorksites] = useState<Geofence[]>([]);
  const [selectedWorksite, setSelectedWorksite] = useState<Geofence | null>(null);
  const [selectedWorkCategory, setSelectedWorkCategory] = useState<'driving' | null>(null);
  const [worksitePickerOpen, setWorksitePickerOpen] = useState(false);
  const [worksiteOptionClusterWidth, setWorksiteOptionClusterWidth] = useState<number | null>(null);
  const [insideWorksiteId, setInsideWorksiteId] = useState<string | null>(null);
  const [worksiteLocationEnabled, setWorksiteLocationEnabled] = useState(false);
  const [outsideStartPrompt, setOutsideStartPrompt] = useState<{
    worksite: Geofence;
    distanceMeters: number;
  } | null>(null);
  const [shiftActionBusy, setShiftActionBusy] = useState(false);
  const shiftActionBusyRef = useRef(false);
  const userPickedWorksiteRef = useRef(false);
  const defaultWorksiteAppliedRef = useRef(false);
  const [daySummaryOpen, setDaySummaryOpen] = useState(false);
  const [shiftNowMs, setShiftNowMs] = useState(() => Date.now());
  const [menuOpen, setMenuOpen] = useState(false);
  const pendingShiftEnds = usePendingShiftEnds();
  const [endedLiveShiftIds, setEndedLiveShiftIds] = useState<string[]>([]);
  const [liveTickerStopped, setLiveTickerStopped] = useState(false);
  const liveTickerStoppedRef = useRef(false);
  const [requiredDocuments, setRequiredDocuments] = useState<string[]>([]);
  const [userCredentials, setUserCredentials] = useState<any[]>([]);
  const [credentialsLoaded, setCredentialsLoaded] = useState(false);
  const [profileFields, setProfileFields] = useState<{ name: string; email: string; compliance: GermanComplianceProfile } | null>(null);
  const requiredDocsPromptedRef = useRef(false);
  const inboxReviewCheckedRef = useRef(false);
  const [shiftReview, setShiftReview] = useState<ShiftEditReviewPayload | null>(null);
  const [timerBlockWidth, setTimerBlockWidth] = useState(0);
  const [timerHintWidth, setTimerHintWidth] = useState(0);

  const isAdmin = authState.status === 'admin' || profileIsAdmin;
  const timerSize = homeTimerSize(layout, insets.top, insets.bottom, isAdmin);
  const worksiteControlWidth = Math.round(timerHintWidth || timerBlockWidth || timerSize);
  const firstName = userName?.trim().split(/\s+/)[0] || '';
  const welcomeText = firstName ? `Hey, ${firstName}` : 'Hey there';

  const openShiftReview = React.useCallback((payload: ShiftEditReviewPayload | null) => {
    if (!payload?.shiftId || wasShiftReviewDismissed(payload.shiftId)) return;
    setShiftReview(payload);
  }, []);

  const dismissShiftReview = React.useCallback(() => {
    const shiftId = shiftReview?.shiftId;
    setShiftReview(null);
    void clearPendingShiftReview(shiftId);
    if (route.params?.shiftReview) {
      navigation.setParams({ shiftReview: undefined });
    }
  }, [navigation, route.params?.shiftReview, shiftReview?.shiftId]);

  useEffect(() => {
    const fromRoute = route.params?.shiftReview;
    if (fromRoute?.shiftId) {
      openShiftReview(fromRoute);
    }
  }, [openShiftReview, route.params?.shiftReview]);

  useEffect(() => {
    const refresh = () => {
      void getWorksiteLocationEnabled().then(setWorksiteLocationEnabled);
    };
    refresh();
    return subscribeLocationFeatureSettings(refresh);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      if (!isAdmin) return undefined;
      let cancelled = false;

      const fromMemory = takePendingShiftReview();
      if (fromMemory) {
        openShiftReview(fromMemory);
        return undefined;
      }

      void (async () => {
        const persisted = await loadPersistedShiftReview();
        if (cancelled) return;
        if (persisted) {
          openShiftReview(persisted);
          return;
        }
        if (inboxReviewCheckedRef.current || !sessionUid) return;
        inboxReviewCheckedRef.current = true;
        try {
          const fs = getFirestore();
          const inboxSnap = await getDocs(
            query(collection(fs, 'users', sessionUid, 'notifications'), orderBy('createdAt', 'desc'), limit(15))
          );
          const match = inboxSnap.docs
            .map(item => {
              const data = item.data() as Record<string, unknown>;
              return parseShiftEditReviewFromData({
                type: String(data.kind || data.type || 'personal_notification'),
                screen: typeof data.nav === 'object' && data.nav ? String((data.nav as any).screen || 'Home') : 'Home',
                shiftId: data.shiftId,
                employeeUserId: data.employeeUserId,
                employeeName: data.employeeName,
                eventId: typeof data.nav === 'object' && data.nav ? (data.nav as any).eventId : undefined,
              });
            })
            .find(item => item && !wasShiftReviewDismissed(item.shiftId));
          if (!cancelled && match) openShiftReview(match);
        } catch (error) {
          console.warn('[ShiftEdit] failed reading admin inbox:', error);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [isAdmin, openShiftReview, sessionUid])
  );

  const refreshOfflineShift = React.useCallback(async () => {
    if (liveTickerStoppedRef.current) {
      setOfflineShift(null);
      return;
    }
    const offline = await getOfflineOpenShift();
    setOfflineShift(offline ? (offlineOpenShiftToLiveShift(offline) as ShiftDoc) : null);
  }, []);

  useEffect(() => {
    void refreshOfflineShift();
    return subscribeOutboxChanges(() => {
      void refreshOfflineShift();
    });
  }, [refreshOfflineShift]);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = nativeAuth().onAuthStateChanged(user => {
      setUserName(user?.displayName || '');

      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      if (!user) {
        setProfileIsAdmin(false);
        setSessionUid(null);
        setProfileFields(null);
        setRequiredDocuments([]);
        setUserCredentials([]);
        setCredentialsLoaded(false);
        requiredDocsPromptedRef.current = false;
        return;
      }

      setSessionUid(user.uid);
      requiredDocsPromptedRef.current = false;
      setProfileFields(null);
      setRequiredDocuments([]);
      setCredentialsLoaded(false);

      const fs = getFirestore();
      const profileRef = doc(fs, 'users', user.uid);
      unsubProfile = onSnapshot(profileRef, snap => {
        if (!snap?.exists()) {
          setProfileIsAdmin(false);
          setProfileFields({ name: '', email: '', compliance: {} });
          return;
        }
        const data = snap.data();
        const roles = data?.roles;
        const name = data?.name;
        const requiredDocs = Array.isArray(data?.requiredDocuments)
          ? data.requiredDocuments.map((value: unknown) => String(value || '').trim()).filter(Boolean)
          : [];
        setProfileIsAdmin(Array.isArray(roles) && roles.includes('admin'));
        if (typeof name === 'string' && name.trim()) {
          setUserName(name);
          void setLastUserName(name);
        } else if (user.email) {
          setUserName(prev => (prev ? prev : user.email!.split('@')[0]));
        }
        setAvatarUrl(typeof data?.avatarUrl === 'string' ? data.avatarUrl : null);
        setCustomAvatarUrl(typeof data?.customAvatarUrl === 'string' ? data.customAvatarUrl : null);
        setRequiredDocuments(requiredDocs);
        setProfileFields({
          name: typeof data?.name === 'string' ? data.name.trim() : '',
          email: typeof data?.email === 'string' ? data.email.trim() : '',
          compliance: readGermanCompliance(data),
        });
      });
    });

    return () => {
      unsubProfile?.();
      unsubAuth();
    };
  }, []);

  useEffect(() => {
    if (!sessionUid) {
      setUserCredentials([]);
      setCredentialsLoaded(false);
      return;
    }
    const fs = getFirestore();
    const credentialQuery = query(collection(fs, 'hygieneCredentials'), where('employeeUid', '==', sessionUid));
    const unsub = onSnapshot(credentialQuery, snap => {
      setUserCredentials(snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })));
      setCredentialsLoaded(true);
    });
    return () => unsub();
  }, [sessionUid]);

  const missingRequiredDocuments = useMemo(() => {
    const required = getRequiredDocumentTypesForUser(requiredDocuments);
    return getMissingRequiredDocuments(required, userCredentials);
  }, [requiredDocuments, userCredentials]);

  const missingProfileFields = useMemo(() => {
    if (!profileFields) return [];
    const missing: string[] = [];
    if (!profileFields.name) missing.push('Name');
    if (!profileFields.email) missing.push('Email');
    return [...missing, ...getMissingComplianceFields(profileFields.compliance)];
  }, [profileFields]);

  useEffect(() => {
    if (
      !sessionUid ||
      !profileFields ||
      !credentialsLoaded ||
      (missingProfileFields.length === 0 && missingRequiredDocuments.length === 0) ||
      requiredDocsPromptedRef.current
    ) return;
    requiredDocsPromptedRef.current = true;
    const missingCount = missingProfileFields.length + missingRequiredDocuments.length;
    Alert.alert(
      'Please complete profile',
      `Your profile is missing ${missingCount} required item${missingCount === 1 ? '' : 's'}.`,
      [
        { text: 'Later', style: 'cancel' },
        { text: 'Complete profile', onPress: () => navigation.navigate('EditProfile') },
      ]
    );
  }, [credentialsLoaded, missingProfileFields, missingRequiredDocuments, navigation, profileFields, sessionUid]);

  useEffect(() => {
    const fs = getFirestore();
    const q = query(collection(fs, 'geofences'));
    const unsub = onSnapshot(q, snap => {
      if (!snap?.docs?.length) {
        setWorksites([]);
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
      setWorksites(items.sort((a, b) => a.name.localeCompare(b.name)));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!sessionUid) {
      setOpenShift(null);
      return;
    }
    const fs = getFirestore();
    const openQuery = query(
      collection(fs, 'shifts'),
      where('userId', '==', sessionUid),
      where('status', '==', 'open'),
      limit(5)
    );
    const unsubOpen = onSnapshot(openQuery, snap => {
      if (liveTickerStoppedRef.current) {
        setOpenShift(null);
        return;
      }
      if (!snap?.docs?.length) {
        setOpenShift(null);
        return;
      }
      const best = [...snap.docs]
        .map(d => ({ ...(d.data() as any), id: d.id } as ShiftDoc))
        .filter(s => !s.isScheduled)
        .sort((a, b) => {
          const toMs = (v: any) => v?.toDate?.()?.getTime?.() ?? (v ? new Date(v as any).getTime() : 0);
          return toMs(b.startAt || b.workPeriods?.[0]?.startIso) - toMs(a.startAt || a.workPeriods?.[0]?.startIso);
        })[0];
      setOpenShift(best || null);
      void coalesceExtraOpenLiveShifts(sessionUid).catch(error => {
        console.warn('Could not coalesce extra open shifts:', error);
      });
    });
    return () => unsubOpen();
  }, [sessionUid]);

  useEffect(() => {
    const t = setInterval(() => setShiftNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const activeShift = useMemo(
    () =>
      resolveHomeActiveShift(
        offlineShift,
        openShift,
        pendingShiftEnds,
        endedLiveShiftIds,
        liveTickerStopped
      ),
    [offlineShift, openShift, pendingShiftEnds, endedLiveShiftIds, liveTickerStopped]
  );
  const activeWorksites = useMemo(() => filterActiveWorksites(worksites), [worksites]);
  const selectedActiveWorksite = useMemo(() => {
    if (!selectedWorksite || !isActiveWorksite(selectedWorksite)) return null;
    return activeWorksites.find(worksite => worksite.id === selectedWorksite.id) || null;
  }, [activeWorksites, selectedWorksite]);
  const insideWorksite = useMemo(
    () => activeWorksites.find(worksite => worksite.id === insideWorksiteId) || null,
    [activeWorksites, insideWorksiteId]
  );
  const otherActiveWorksites = useMemo(
    () => activeWorksites.filter(worksite => worksite.id !== insideWorksite?.id),
    [activeWorksites, insideWorksite]
  );
  const pickerRowCount = otherActiveWorksites.length + (insideWorksite ? 1 : 0) + 2;
  const pickerListScrolls = pickerRowCount > WORKSITE_LIST_VISIBLE_ROWS;
  const displayedWorksite = activeShift
    ? activeWorksites.find(worksite => worksite.id === activeShift.geofenceId) || null
    : selectedActiveWorksite;
  const displayedWorkCategory = activeShift?.workCategory ?? selectedWorkCategory;
  const displayedWorksiteLabel =
    displayedWorkCategory === 'driving'
      ? 'Driving'
      : displayedWorksite?.name ||
        (activeShift?.geofenceName && !activeShift.workCategory ? activeShift.geofenceName : null) ||
        'No worksite';
  const shiftPaused = activeShift ? isShiftPaused(activeShift) : false;
  const timerElapsedMs = useMemo(() => {
    if (!activeShift) return 0;
    if (shiftPaused) return calcCurrentPauseMs(activeShift, shiftNowMs);
    return calcWorkedMs(activeShift, shiftNowMs);
  }, [activeShift, shiftPaused, shiftNowMs]);

  const timerLabel = activeShift
    ? shiftPaused
      ? 'Break'
      : activeShift.workCategory === 'driving'
        ? 'Driving'
        : 'Working'
    : 'Ready';

  const timerState = !activeShift ? 'idle' : shiftPaused ? 'pause' : activeShift.workCategory === 'driving' ? 'driving' : 'working';

  const tapHint = activeShift
    ? shiftPaused
      ? 'Tap the timer to resume'
      : 'Tap the timer for a break'
    : 'Tap the timer to start your shift';

  const statusText = activeShift && !shiftPaused ? 'You are working here:' : null;

  const readCurrentLocation = () =>
    new Promise<{ lat: number; lng: number } | null>(resolve =>
      Geolocation.getCurrentPosition(
        position => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      )
    );

  const rankActiveWorksites = (location: { lat: number; lng: number } | null) =>
    activeWorksites
      .map(worksite => {
        const distance = location ? getDistanceMeters(location, worksite.center) : Number.POSITIVE_INFINITY;
        return {
          worksite,
          id: worksite.id,
          distance,
          isInside: location ? distance <= effectiveGeofenceRadiusMeters(worksite.radiusMeters) : false,
        };
      })
      .sort((a, b) => a.distance - b.distance);

  useEffect(() => {
    if (selectedWorksite && !activeWorksites.some(worksite => worksite.id === selectedWorksite.id)) {
      setSelectedWorksite(null);
      defaultWorksiteAppliedRef.current = false;
    }
  }, [activeWorksites, selectedWorksite]);

  useEffect(() => {
    if (defaultWorksiteAppliedRef.current || userPickedWorksiteRef.current || !activeWorksites.length) {
      return;
    }
    void (async () => {
      const [lastWorksiteId, location] = await Promise.all([
        getLastSelectedWorksiteId(),
        readCurrentLocation(),
      ]);
      if (userPickedWorksiteRef.current || defaultWorksiteAppliedRef.current) return;
      const ranked = rankActiveWorksites(location);
      const nextId = pickDefaultWorksiteId(ranked, {
        locationUsable: !!location,
        lastWorksiteId,
      });
      defaultWorksiteAppliedRef.current = true;
      const next = nextId ? activeWorksites.find(worksite => worksite.id === nextId) || null : null;
      setSelectedWorksite(next);
      if (next) {
        setSelectedWorkCategory(null);
        void setLastSelectedWorksiteId(next.id);
      }
      const inside = ranked.find(item => item.isInside);
      setInsideWorksiteId(inside?.id || null);
    })();
  }, [activeWorksites, selectedWorksite]);

  const openWorksitePicker = () => {
    setWorksiteOptionClusterWidth(null);
    setWorksitePickerOpen(true);
    void readCurrentLocation().then(location => {
      const inside = rankActiveWorksites(location).find(item => item.isInside);
      setInsideWorksiteId(inside?.id || null);
    });
  };

  const toggleWorksitePicker = () => {
    if (worksitePickerOpen) {
      setWorksitePickerOpen(false);
      return;
    }
    openWorksitePicker();
  };

  const drivingSelected = displayedWorkCategory === 'driving';
  const showYouAreHere = Boolean(worksiteLocationEnabled && insideWorksite);

  const renderWorksiteGlyph = (icon: WorksiteGlyph, color: string, size = 16) => {
    if (icon === 'truck') {
      return <Icons.truck color={color} width={size} height={size} />;
    }
    if (icon === 'location') {
      return <Icons.location color={color} width={size} height={size} />;
    }
    if (icon === 'clock') {
      return <Icons.clock color={color} width={size} height={size} />;
    }
    return <View style={styles.worksiteOptionIconSpacer} />;
  };

  const worksiteButtonIcon = drivingSelected
    ? renderWorksiteGlyph('truck', PIZZA_FIRE.flame)
    : renderWorksiteGlyph('location', PIZZA_FIRE.gold);

  const renderWorksiteOption = (
    key: string,
    label: string,
    selected: boolean,
    onPress: () => void,
    icon: WorksiteGlyph
  ) => {
    const iconColor = selected ? PIZZA_FIRE.flame : PIZZA_FIRE.textPrimary;
    return (
      <TouchableOpacity
        key={key}
        style={[styles.worksiteOption, selected && styles.worksiteOptionSelected]}
        onPress={onPress}
      >
        <View style={styles.worksiteOptionAlign}>
          <View
            style={[
              styles.worksiteOptionRow,
              worksiteOptionClusterWidth != null ? { minWidth: worksiteOptionClusterWidth } : null,
            ]}
            onLayout={event => {
              const width = event.nativeEvent.layout.width;
              setWorksiteOptionClusterWidth(prev => (prev == null || width > prev ? width : prev));
            }}
          >
            {renderWorksiteGlyph(icon, iconColor)}
            <Text
              style={[styles.worksiteOptionTitle, selected && styles.worksiteOptionTitleSelected]}
              numberOfLines={1}
            >
              {label}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderSheetWorksiteOptions = () => (
    <>
      {insideWorksite
        ? renderWorksiteOption(
            insideWorksite.id,
            insideWorksite.name,
            displayedWorksite?.id === insideWorksite.id,
            () => void chooseWorksite(insideWorksite),
            'location'
          )
        : null}
      {renderWorksiteOption(
        'driving',
        'Driving',
        drivingSelected,
        () => void chooseWorksite(null, 'driving'),
        'truck'
      )}
      {otherActiveWorksites.map(worksite =>
        renderWorksiteOption(
          worksite.id,
          worksite.name,
          displayedWorksite?.id === worksite.id,
          () => void chooseWorksite(worksite),
          'location'
        )
      )}
      {renderWorksiteOption(
        'none',
        'No worksite',
        !displayedWorksite && !displayedWorkCategory,
        () => void chooseWorksite(null),
        'clock'
      )}
    </>
  );

  const persistWorksiteChoice = (worksite: Geofence | null) => {
    void setLastSelectedWorksiteId(worksite && isActiveWorksite(worksite) ? worksite.id : null);
  };

  const chooseWorksite = async (worksite: Geofence | null, workCategory: 'driving' | null = null) => {
    const nextWorksite = worksite && isActiveWorksite(worksite) ? worksite : null;
    userPickedWorksiteRef.current = true;
    persistWorksiteChoice(nextWorksite);
    if (activeShift) {
      const sameWorksite = (activeShift.geofenceId || null) === (nextWorksite?.id || null);
      const sameCategory = (activeShift.workCategory || null) === workCategory;
      if (sameWorksite && sameCategory) {
        setWorksitePickerOpen(false);
        return;
      }
      await proceedStartShift(nextWorksite, { workCategory });
      return;
    }
    setSelectedWorksite(nextWorksite);
    setSelectedWorkCategory(workCategory);
    setWorksitePickerOpen(false);
  };

  const proceedStartShift = async (
    worksite: Geofence | null,
    options?: { workCategory?: 'driving' | null }
  ) => {
    if (!sessionUid) {
      Alert.alert('Notice', 'Sign in to start a shift.');
      return;
    }
    if (shiftActionBusyRef.current) return;
    const workCategory = options?.workCategory !== undefined ? options.workCategory : selectedWorkCategory;
    shiftActionBusyRef.current = true;
    setShiftActionBusy(true);
    try {
      if (worksite?.id) {
        const { cancelNativeAutoTracking } = require('../geofencing/native');
        cancelNativeAutoTracking(worksite.id);
      }
      await startLiveShift({
        userId: sessionUid,
        geofenceId: worksite?.id ?? null,
        geofenceName: worksite?.name ?? null,
        workCategory,
        startedBy: 'manual',
      });
      liveTickerStoppedRef.current = false;
      setLiveTickerStopped(false);
      setEndedLiveShiftIds([]);
      await refreshOfflineShift();
      const { markEnterHandledForVisit } = require('../geofencing/storage');
      const { onShiftStarted } = require('../geofencing/notificationPolicy');
      if (worksite?.id) void markEnterHandledForVisit(worksite.id);
      void onShiftStarted({
        userId: sessionUid,
        geofenceId: worksite?.id ?? null,
        geofenceName: worksite?.name ?? null,
        paused: false,
      });
      setSelectedWorksite(worksite);
      setSelectedWorkCategory(workCategory);
      setWorksitePickerOpen(false);
    } catch (err: any) {
      Alert.alert('Notice', err?.message || 'Could not start shift.');
    } finally {
      shiftActionBusyRef.current = false;
      setShiftActionBusy(false);
    }
  };

  const handleStartShift = async () => {
    if (!sessionUid) {
      Alert.alert('Notice', 'Sign in to start a shift.');
      return;
    }
    if (activeShift || shiftActionBusyRef.current) return;
    const site = selectedActiveWorksite;
    if (site) {
      const [alertsEnabled, locationEnabled, location] = await Promise.all([
        getWorksiteAlertsEnabled(),
        getWorksiteLocationEnabled(),
        readCurrentLocation(),
      ]);
      if (location) {
        const distanceMeters = getDistanceMeters(location, site.center);
        const isInsideSelectedSite = distanceMeters <= effectiveGeofenceRadiusMeters(site.radiusMeters);
        if (
          shouldShowOutsideSiteStartPrompt({
            worksiteSelected: true,
            worksiteAlertsEnabled: alertsEnabled,
            worksiteLocationEnabled: locationEnabled,
            isInsideSelectedSite,
            worksiteActive: isActiveWorksite(site),
          })
        ) {
          setOutsideStartPrompt({ worksite: site, distanceMeters });
          return;
        }
      }
    }
    await proceedStartShift(site);
  };

  const handlePauseResume = async () => {
    if (!activeShift?.id || shiftActionBusy) return;
    setShiftActionBusy(true);
    try {
      if (activeShift.geofenceId) {
        const { cancelNativeAutoTracking } = require('../geofencing/native');
        cancelNativeAutoTracking(activeShift.geofenceId);
      }
      const { onManualBreak, onManualResume } = require('../geofencing/notificationPolicy');
      if (shiftPaused) {
        await onManualResume(activeShift.geofenceId);
        await resumeLiveShift(activeShift.id);
      } else {
        await onManualBreak();
        await pauseLiveShift(activeShift.id);
      }
      await refreshOfflineShift();
    } catch (err: any) {
      Alert.alert('Notice', err?.message || 'Could not update shift.');
    } finally {
      setShiftActionBusy(false);
    }
  };

  const handleEndDay = () => {
    if (shiftActionBusy) return;
    setDaySummaryOpen(true);
  };

  useEffect(() => {
    if (!route.params?.openEndShift) return;
    setDaySummaryOpen(true);
    navigation.setParams({ openEndShift: undefined });
  }, [navigation, route.params?.openEndShift]);

  const navigateQuickLink = (route: keyof RootStackParamList) => {
    setMenuOpen(false);
    navigation.navigate(route as any);
  };
  const visibleQuickLinks = QUICK_LINKS.filter(link => link.route !== 'Chat');
  const hasSingleFinalMenuItem = (visibleQuickLinks.length + 1) % 3 === 1;

  return (
    <View style={styles.screen}>
      <PizzaFireBackground />

      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <View
          style={[
            styles.content,
            {
              paddingTop: chrome.paddingTop,
              paddingHorizontal: layout.space.screenX,
            },
          ]}
        >
          {offlineHint ? <Text style={styles.offlineHint}>offline</Text> : null}
          <View style={[styles.header, { marginBottom: chrome.headerGap }]}>
            <TouchableOpacity
              onPress={() => navigation.navigate('EditProfile')}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Open profile"
            >
              {(avatarUrl || customAvatarUrl) ? (
                <Image
                  source={resolveAvatarSource(avatarUrl, customAvatarUrl)}
                  style={[
                    styles.avatar,
                    {
                      width: chrome.avatar,
                      height: chrome.avatar,
                      borderRadius: chrome.avatar / 2,
                    },
                  ]}
                  resizeMode="cover"
                />
              ) : (
                <Image
                  source={require('../../assets/Pizza Wala Logo.png')}
                  style={[
                    styles.logoFallback,
                    {
                      width: chrome.avatar,
                      height: chrome.avatar,
                      borderRadius: chrome.avatar / 2,
                    },
                  ]}
                  resizeMode="contain"
                />
              )}
            </TouchableOpacity>
            <Text style={[styles.welcomeTitle, { marginTop: chrome.titleGap, fontSize: chrome.titleSize }]}>
              {welcomeText}
            </Text>
          </View>

          <View style={[styles.timerSection, { paddingTop: chrome.timerPadTop, paddingBottom: layout.isShort ? 0 : 8 }]}>
            <View
              style={styles.timerBlock}
              onLayout={event => {
                const nextWidth = Math.round(event.nativeEvent.layout.width);
                if (nextWidth > 0) {
                  setTimerBlockWidth(prev => (prev === nextWidth ? prev : nextWidth));
                }
              }}
            >
              <TouchableOpacity
                activeOpacity={0.92}
                onPress={() => {
                  if (activeShift) void handlePauseResume();
                  else void handleStartShift();
                }}
                disabled={shiftActionBusy}
                accessibilityRole="button"
                accessibilityLabel={
                  activeShift
                    ? shiftPaused
                      ? 'Resume shift'
                      : 'Take a break'
                    : 'Start shift'
                }
              >
                <CircularShiftTimer
                  elapsedMs={timerElapsedMs}
                  state={timerState}
                  label={timerLabel}
                  size={timerSize}
                />
              </TouchableOpacity>

              <Text
                style={[styles.tapHint, { marginTop: chrome.hintGap }]}
                onLayout={event => {
                  if (activeShift) return;
                  const nextWidth = Math.round(event.nativeEvent.layout.width);
                  if (nextWidth > 0) {
                    setTimerHintWidth(prev => (prev === nextWidth ? prev : nextWidth));
                  }
                }}
              >
                {tapHint}
              </Text>
            </View>

            <View
              style={[
                styles.statusBlock,
                {
                  marginTop: chrome.statusGap,
                  minHeight: layout.isShort ? 0 : 46,
                },
              ]}
            >
              {statusText ? <Text style={styles.statusText}>{statusText}</Text> : null}
              <View
                style={[
                  styles.worksiteSwitch,
                  USE_INLINE_WORKSITE_DROPDOWN ? { width: worksiteControlWidth } : null,
                ]}
                pointerEvents="box-none"
              >
                <TouchableOpacity
                  style={[
                    styles.selectWorksiteButton,
                    { maxWidth: worksiteControlWidth },
                    worksitePickerOpen && styles.selectWorksiteButtonOpen,
                  ]}
                  onPress={toggleWorksitePicker}
                  activeOpacity={0.82}
                  accessibilityRole="button"
                  accessibilityLabel="Select worksite"
                  accessibilityState={{ expanded: worksitePickerOpen }}
                >
                  {worksiteButtonIcon}
                  <Text style={styles.selectWorksiteText} numberOfLines={1}>
                    {displayedWorksiteLabel}
                  </Text>
                  <Icons.chevronDown color={PIZZA_FIRE.gold} width={16} height={16} />
                </TouchableOpacity>
                {USE_INLINE_WORKSITE_DROPDOWN && worksitePickerOpen ? (
                  <ScrollView
                    style={styles.worksiteDropdown}
                    contentContainerStyle={styles.worksiteDropdownContent}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={pickerListScrolls}
                  >
                    {insideWorksite ? (
                      <TouchableOpacity
                        style={[
                          styles.worksiteOption,
                          displayedWorksite?.id === insideWorksite.id && styles.worksiteOptionSelected,
                        ]}
                        onPress={() => void chooseWorksite(insideWorksite)}
                      >
                        <View style={styles.worksiteOptionRow}>
                          {renderWorksiteGlyph(
                            'location',
                            displayedWorksite?.id === insideWorksite.id
                              ? PIZZA_FIRE.flame
                              : PIZZA_FIRE.textPrimary
                          )}
                          <Text
                            style={[
                              styles.worksiteOptionTitle,
                              displayedWorksite?.id === insideWorksite.id && styles.worksiteOptionTitleSelected,
                            ]}
                            numberOfLines={1}
                          >
                            {insideWorksite.name}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      style={[
                        styles.worksiteOption,
                        displayedWorkCategory === 'driving' && styles.worksiteOptionSelected,
                      ]}
                      onPress={() => void chooseWorksite(null, 'driving')}
                    >
                      <View style={styles.worksiteOptionRow}>
                        <Icons.truck
                          color={
                            displayedWorkCategory === 'driving' ? PIZZA_FIRE.flame : PIZZA_FIRE.textPrimary
                          }
                          width={16}
                          height={16}
                        />
                        <Text
                          style={[
                            styles.worksiteOptionTitle,
                            displayedWorkCategory === 'driving' && styles.worksiteOptionTitleSelected,
                          ]}
                        >
                          Driving
                        </Text>
                      </View>
                    </TouchableOpacity>
                    {otherActiveWorksites.map(worksite => (
                      <TouchableOpacity
                        key={worksite.id}
                        style={[
                          styles.worksiteOption,
                          displayedWorksite?.id === worksite.id && styles.worksiteOptionSelected,
                        ]}
                        onPress={() => void chooseWorksite(worksite)}
                      >
                        <View style={styles.worksiteOptionRow}>
                          {renderWorksiteGlyph(
                            'location',
                            displayedWorksite?.id === worksite.id
                              ? PIZZA_FIRE.flame
                              : PIZZA_FIRE.textPrimary
                          )}
                          <Text
                            style={[
                              styles.worksiteOptionTitle,
                              displayedWorksite?.id === worksite.id && styles.worksiteOptionTitleSelected,
                            ]}
                            numberOfLines={1}
                          >
                            {worksite.name}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity
                      style={[
                        styles.worksiteOption,
                        !displayedWorksite && !displayedWorkCategory && styles.worksiteOptionSelected,
                      ]}
                      onPress={() => void chooseWorksite(null)}
                    >
                      <View style={styles.worksiteOptionRow}>
                        <Icons.clock
                          color={
                            !displayedWorksite && !displayedWorkCategory
                              ? PIZZA_FIRE.flame
                              : PIZZA_FIRE.textPrimary
                          }
                          width={16}
                          height={16}
                        />
                        <Text
                          style={[
                            styles.worksiteOptionTitle,
                            !displayedWorksite && !displayedWorkCategory && styles.worksiteOptionTitleSelected,
                          ]}
                        >
                          No worksite
                        </Text>
                      </View>
                    </TouchableOpacity>
                  </ScrollView>
                ) : null}
              </View>
            </View>

            {isAdmin ? (
              <TouchableOpacity
                style={[
                  styles.adminButton,
                  { marginTop: chrome.adminGap, paddingVertical: chrome.adminPad },
                ]}
                onPress={() => navigation.navigate('AdminOptions')}
                activeOpacity={0.88}
              >
                <Image source={require('../../assets/Icons/Admin.png')} style={styles.adminIcon} resizeMode="contain" />
                <Text style={styles.adminButtonText}>Admin</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </SafeAreaView>

      <HomeBottomNav
        busy={shiftActionBusy}
        onOpenMenu={() => setMenuOpen(true)}
        onOpenWorkingHours={() => navigation.navigate('WorkingHours')}
        onEndDay={handleEndDay}
      />

      <ShiftEditReviewModal
        payload={isAdmin ? shiftReview : null}
        onClose={dismissShiftReview}
        onResolved={dismissShiftReview}
      />

      <DaySummaryModal
        visible={daySummaryOpen}
        userId={sessionUid}
        activeShift={activeShift}
        onCancel={() => setDaySummaryOpen(false)}
        onConfirmed={async () => {
          liveTickerStoppedRef.current = true;
          setLiveTickerStopped(true);
          setEndedLiveShiftIds(ids => {
            const next = new Set(ids);
            if (offlineShift?.id) next.add(offlineShift.id);
            if (openShift?.id) next.add(openShift.id);
            return [...next];
          });
          setOfflineShift(null);
          setOpenShift(null);
          setDaySummaryOpen(false);
          await refreshOfflineShift();
        }}
      />

      <Modal
        visible={!USE_INLINE_WORKSITE_DROPDOWN && worksitePickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setWorksitePickerOpen(false)}
      >
        <View style={styles.menuBackdrop}>
          <Pressable
            style={styles.menuDismissArea}
            onPress={() => setWorksitePickerOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close worksite picker"
          />
          <View
            style={[
              styles.menuSheet,
              styles.worksiteSheet,
              { paddingBottom: Math.max(insets.bottom, 20) },
              layout.isTablet && styles.menuSheetTablet,
            ]}
          >
            <View style={styles.menuSheetHeader}>
              <View style={styles.menuHandle} />
              <Text style={styles.menuTitle}>Select Worksite</Text>
              {showYouAreHere && insideWorksite ? (
                <View
                  style={styles.youAreHereLine}
                  accessibilityLabel={`you are here ${insideWorksite.name}`}
                >
                  <Text style={styles.youAreHereText}>you are here</Text>
                  <View style={styles.youAreHereSite}>
                    <Icons.location color={PIZZA_FIRE.gold} width={12} height={12} />
                    <Text style={styles.youAreHereSiteText} numberOfLines={1}>
                      {insideWorksite.name}
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>
            <ScrollView
              style={styles.worksiteSheetScroller}
              contentContainerStyle={styles.worksiteSheetList}
              nestedScrollEnabled
              showsVerticalScrollIndicator={pickerListScrolls}
              keyboardShouldPersistTaps="handled"
            >
              {renderSheetWorksiteOptions()}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={menuOpen} transparent animationType="slide" onRequestClose={() => setMenuOpen(false)}>
        <View style={styles.menuBackdrop}>
          <Pressable
            style={styles.menuDismissArea}
            onPress={() => setMenuOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close quick links"
          />
          <View style={[styles.menuSheet, layout.isTablet && styles.menuSheetTablet]}>
            <View style={styles.menuSheetHeader}>
              <View style={styles.menuHandle} />
              <Text style={styles.menuTitle}>Quick links</Text>
              <Text style={styles.menuSubtitle}>Jump to your most-used tools</Text>
            </View>
            <ScrollView contentContainerStyle={styles.menuGrid} showsVerticalScrollIndicator={false}>
          {visibleQuickLinks.map(link => (
                <TouchableOpacity
                  key={link.label}
                  style={styles.menuTile}
                  onPress={() => navigateQuickLink(link.route)}
                  activeOpacity={0.82}
                >
                  <View style={styles.menuIconWrap}>
                    <Image source={link.icon} style={styles.menuIcon} resizeMode="contain" />
                  </View>
                  <Text style={styles.menuLabel}>{link.label}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[styles.menuTile, styles.menuTileDanger, hasSingleFinalMenuItem && styles.menuTileCentered]}
                onPress={() => {
                  setMenuOpen(false);
                  Alert.alert('Logout', 'Are you sure you want to sign out?', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Sign Out',
                      style: 'destructive',
                      onPress: () => {
                        void signOutUser().catch(() => Alert.alert('Notice', 'Unable to sign out.'));
                      },
                    },
                  ]);
                }}
                activeOpacity={0.82}
              >
                <View style={[styles.menuIconWrap, styles.menuIconWrapDanger]}>
                  <Image source={require('../../assets/Icons/Logout.png')} style={styles.menuIcon} resizeMode="contain" />
                </View>
                <Text style={[styles.menuLabel, styles.menuLabelDanger]}>Logout</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!outsideStartPrompt}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setOutsideStartPrompt(null);
          setWorksitePickerOpen(false);
        }}
      >
        <View style={styles.outsidePromptBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              setOutsideStartPrompt(null);
              setWorksitePickerOpen(false);
            }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss start prompt"
          />
          <View style={styles.outsidePromptCard}>
            <Text style={styles.outsidePromptDistance}>
              You&apos;re {formatDistanceFromWorksite(outsideStartPrompt?.distanceMeters || 0)} from selected worksite
            </Text>
            <TouchableOpacity
              style={styles.outsidePromptSite}
              onPress={() => {
                const center = outsideStartPrompt?.worksite.center;
                if (!center) return;
                void Linking.openURL(worksiteGoogleMapsUrl(center.lat, center.lng));
              }}
              activeOpacity={0.82}
              accessibilityRole="link"
              accessibilityLabel="Open worksite in Google Maps"
            >
              <Icons.location color={PIZZA_FIRE.flame} width={16} height={16} />
              <Text style={styles.outsidePromptSiteName}>{outsideStartPrompt?.worksite.name}</Text>
            </TouchableOpacity>
            <View style={styles.outsidePromptActions}>
              <TouchableOpacity
                style={[styles.outsidePromptAction, styles.outsidePromptStart]}
                onPress={() => {
                  const site = outsideStartPrompt?.worksite || null;
                  setOutsideStartPrompt(null);
                  setWorksitePickerOpen(false);
                  void proceedStartShift(site && isActiveWorksite(site) ? site : null);
                }}
                activeOpacity={0.88}
              >
                <Text style={styles.outsidePromptStartText}>Start anyway</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.outsidePromptAction, styles.outsidePromptSwitch]}
                onPress={() => {
                  setOutsideStartPrompt(null);
                  openWorksitePicker();
                }}
                activeOpacity={0.88}
              >
                <Text style={styles.outsidePromptSwitchText}>Switch</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.outsidePromptAction, styles.outsidePromptCancel]}
                onPress={() => {
                  setOutsideStartPrompt(null);
                  setWorksitePickerOpen(false);
                }}
                activeOpacity={0.88}
              >
                <Text style={styles.outsidePromptCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: PIZZA_FIRE.bgTop,
  },
  safe: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    overflow: 'visible',
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  offlineHint: {
    position: 'absolute',
    top: 0,
    right: 0,
    color: PIZZA_FIRE.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: PIZZA_FIRE.cheese,
  },
  logoFallback: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: PIZZA_FIRE.cheese,
  },
  welcomeTitle: {
    marginTop: 12,
    fontSize: 26,
    fontWeight: '800',
    color: PIZZA_FIRE.textPrimary,
    textAlign: 'center',
  },
  timerSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 18,
    paddingBottom: 8,
    overflow: 'visible',
  },
  timerBlock: {
    alignItems: 'center',
    alignSelf: 'center',
  },
  tapHint: {
    marginTop: 16,
    fontSize: 13,
    fontWeight: '700',
    color: PIZZA_FIRE.textSecondary,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  worksiteSwitch: {
    alignSelf: 'center',
    position: 'relative',
    alignItems: 'center',
    zIndex: 8,
    elevation: 12,
    overflow: 'visible',
  },
  selectWorksiteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    flexGrow: 0,
    gap: 8,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    borderRadius: PIZZA_FIRE_RADIUS.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: PIZZA_FIRE.bgMid,
  },
  selectWorksiteButtonOpen: {
    borderColor: PIZZA_FIRE.gold,
    backgroundColor: 'rgba(255, 209, 102, 0.12)',
  },
  selectWorksiteText: {
    flexShrink: 1,
    color: PIZZA_FIRE.gold,
    fontWeight: '800',
    fontSize: 14,
    textAlign: 'center',
  },
  worksiteDropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    maxHeight: WORKSITE_LIST_MAX_HEIGHT,
    width: '100%',
    backgroundColor: PIZZA_FIRE.bgMid,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.flame,
    borderRadius: PIZZA_FIRE_RADIUS.lg,
    zIndex: 20,
    elevation: 16,
  },
  worksiteDropdownContent: {
    paddingVertical: 2,
  },
  statusBlock: {
    marginTop: 18,
    alignSelf: 'center',
    alignItems: 'center',
    gap: 8,
    minHeight: 46,
    overflow: 'visible',
    zIndex: 8,
  },
  worksiteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  worksiteText: {
    fontSize: 14,
    fontWeight: '700',
    color: PIZZA_FIRE.flame,
    textAlign: 'center',
  },
  statusText: {
    fontSize: 15,
    fontWeight: '600',
    color: PIZZA_FIRE.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },
  adminButton: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 20,
    zIndex: 1,
  },
  adminIcon: {
    width: 28,
    height: 28,
    tintColor: PIZZA_FIRE.gold,
    marginBottom: 6,
  },
  adminButtonText: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  menuBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: PIZZA_FIRE.overlay,
  },
  menuDismissArea: {
    flex: 1,
    width: '100%',
    minHeight: 48,
    backgroundColor: 'transparent',
  },
  menuSheet: {
    backgroundColor: PIZZA_FIRE.bgMid,
    borderTopLeftRadius: WORKSITE_SHEET_CORNER_RADIUS,
    borderTopRightRadius: WORKSITE_SHEET_CORNER_RADIUS,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: '72%',
    borderTopWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
  },
  menuSheetTablet: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 720,
    paddingHorizontal: 28,
    maxHeight: '64%',
  },
  outsidePromptBackdrop: {
    flex: 1,
    backgroundColor: PIZZA_FIRE.overlay,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  outsidePromptCard: {
    backgroundColor: PIZZA_FIRE.bgMid,
    borderRadius: PIZZA_FIRE_RADIUS.xl,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.flame,
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 12,
  },
  outsidePromptDistance: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  outsidePromptSite: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  outsidePromptSiteName: {
    color: PIZZA_FIRE.flame,
    fontSize: 16,
    fontWeight: '800',
  },
  outsidePromptActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  outsidePromptAction: {
    flex: 1,
    minHeight: 44,
    borderRadius: PIZZA_FIRE_RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  outsidePromptStart: {
    backgroundColor: PIZZA_FIRE.flame,
  },
  outsidePromptStartText: {
    color: PIZZA_FIRE.charcoal,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  outsidePromptSwitch: {
    backgroundColor: 'rgba(255, 159, 28, 0.18)',
    borderWidth: 1,
    borderColor: PIZZA_FIRE.flame,
  },
  outsidePromptSwitchText: {
    color: PIZZA_FIRE.flame,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  outsidePromptCancel: {
    backgroundColor: PIZZA_FIRE.inputBg,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  outsidePromptCancelText: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  worksiteSheet: {
    paddingBottom: 12,
    maxHeight: '68%',
  },
  worksiteSheetScroller: {
    maxHeight: WORKSITE_LIST_MAX_HEIGHT,
  },
  worksiteSheetList: {
    paddingTop: WORKSITE_LIST_PADDING_TOP,
    paddingBottom: WORKSITE_LIST_PADDING_BOTTOM,
    alignItems: 'stretch',
    width: '100%',
  },
  youAreHereLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
    marginBottom: 4,
    maxWidth: '100%',
  },
  youAreHereText: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 0,
  },
  youAreHereSite: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
    minWidth: 0,
  },
  youAreHereSiteText: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
  worksiteOptionAlign: {
    width: '100%',
    alignItems: 'center',
  },
  worksiteOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
    maxWidth: '100%',
  },
  worksiteOptionIconSpacer: {
    width: 16,
    height: 16,
  },
  worksiteOption: {
    width: '100%',
    minHeight: WORKSITE_OPTION_ROW_HEIGHT,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: 'stretch',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: PIZZA_FIRE.divider,
  },
  worksiteOptionSelected: {
    backgroundColor: 'rgba(255, 159, 28, 0.16)',
    borderRadius: WORKSITE_OPTION_SELECTED_RADIUS,
    borderBottomWidth: 0,
    overflow: 'hidden',
  },
  worksiteOptionTitle: {
    flexShrink: 1,
    color: PIZZA_FIRE.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'left',
  },
  worksiteOptionTitleSelected: {
    color: PIZZA_FIRE.flame,
  },
  menuSheetHeader: {
    alignItems: 'center',
  },
  menuHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 209, 102, 0.55)',
    marginBottom: 14,
  },
  menuTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: PIZZA_FIRE.textPrimary,
    textAlign: 'center',
  },
  menuSubtitle: {
    marginTop: 4,
    marginBottom: 16,
    fontSize: 13,
    fontWeight: '600',
    color: PIZZA_FIRE.textMuted,
    textAlign: 'center',
  },
  menuGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 8,
  },
  menuTile: {
    width: '30%',
    minWidth: 96,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderRadius: PIZZA_FIRE_RADIUS.lg,
    backgroundColor: 'rgba(255, 159, 28, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 159, 28, 0.28)',
  },
  menuTileDanger: {
    backgroundColor: 'rgba(255, 69, 58, 0.08)',
    borderColor: 'rgba(255, 69, 58, 0.22)',
  },
  menuTileCentered: {
    marginLeft: '35%',
  },
  menuIconWrap: {
    width: 48,
    height: 48,
    borderRadius: PIZZA_FIRE_RADIUS.md,
    backgroundColor: 'rgba(255, 159, 28, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 159, 28, 0.28)',
  },
  menuIconWrapDanger: {
    backgroundColor: 'rgba(255, 69, 58, 0.12)',
    borderColor: 'rgba(255, 69, 58, 0.24)',
  },
  menuIcon: {
    width: 28,
    height: 28,
  },
  menuLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: PIZZA_FIRE.textSecondary,
    textAlign: 'center',
  },
  menuLabelDanger: {
    color: '#FF8A80',
  },
});
