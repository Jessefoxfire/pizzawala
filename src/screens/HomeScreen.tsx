import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Alert,
  Image,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  collection,
  doc,
  getFirestore,
  limit,
  onSnapshot,
  query,
  where,
} from '@react-native-firebase/firestore';
import { signOutUser, nativeAuth } from '../services/firebase';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { setLastUserName } from '../geofencing/storage';
import { resolveAvatarSource } from '../utils/avatar';
import { useAuth } from '../auth/useAuth';
import Geolocation from 'react-native-geolocation-service';
import { startShift } from '../geofencing/processor';
import {
  calcCurrentPauseMs,
  calcWorkedMs,
  endLiveShift,
  isShiftPaused,
  offlineOpenShiftToLiveShift,
  pauseLiveShift,
  resumeLiveShift,
  type LiveShift,
} from '../services/shifts';
import { getOfflineOpenShift } from '../offline/outbox';
import { subscribeOutboxChanges } from '../offline/events';
import CircularShiftTimer from '../components/CircularShiftTimer';
import HomeBottomNav from '../components/HomeBottomNav';
import PizzaFireBackground from '../components/PizzaFireBackground';
import { Icons } from '../components/Icons';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import type { Geofence } from '../types';
import { getDistanceMeters, normalizeLatLng } from '../utils/geo';
import { getMissingRequiredDocuments, getRequiredDocumentTypesForUser } from '../constants/germanEmployeeCompliance';

type ShiftDoc = LiveShift & {
  worksiteName?: string;
};

type QuickLink = {
  label: string;
  icon: any;
  route: keyof RootStackParamList;
};

const QUICK_LINKS: QuickLink[] = [
  { label: 'Shift', icon: require('../../assets/Icons/Shift.png'), route: 'ShiftSetup' },
  { label: 'Working Hours', icon: require('../../assets/Icons/Schedule.png'), route: 'WorkingHours' },
  { label: 'Schedule', icon: require('../../assets/Icons/Schedule.png'), route: 'MySchedule' },
  { label: 'Events', icon: require('../../assets/Icons/Events.png'), route: 'Events' },
  { label: 'Chat', icon: require('../../assets/Icons/Chat.png'), route: 'Chat' },
  { label: 'My Docs', icon: require('../../assets/Icons/Profile.png'), route: 'RequiredDocuments' },
  { label: 'Profile', icon: require('../../assets/Icons/Profile.png'), route: 'EditProfile' },
];

export default function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Home'>>();
  const insets = useSafeAreaInsets();
  const authState = useAuth();
  const [userName, setUserName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [customAvatarUrl, setCustomAvatarUrl] = useState<string | null>(null);
  const [profileIsAdmin, setProfileIsAdmin] = useState(false);
  const [sessionUid, setSessionUid] = useState<string | null>(null);
  const [openShift, setOpenShift] = useState<ShiftDoc | null>(null);
  const [offlineShift, setOfflineShift] = useState<ShiftDoc | null>(null);
  const [worksites, setWorksites] = useState<Geofence[]>([]);
  const [shiftActionBusy, setShiftActionBusy] = useState(false);
  const [shiftNowMs, setShiftNowMs] = useState(() => Date.now());
  const [menuOpen, setMenuOpen] = useState(false);
  const [requiredDocuments, setRequiredDocuments] = useState<string[]>([]);
  const [userCredentials, setUserCredentials] = useState<any[]>([]);
  const requiredDocsPromptedRef = useRef(false);

  const isAdmin = authState.status === 'admin' || profileIsAdmin;
  const firstName = userName?.trim().split(/\s+/)[0] || '';
  const welcomeText = firstName ? `Hey, ${firstName}` : 'Hey there';

  const refreshOfflineShift = React.useCallback(async () => {
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
        return;
      }

      setSessionUid(user.uid);

      const fs = getFirestore();
      const profileRef = doc(fs, 'users', user.uid);
      unsubProfile = onSnapshot(profileRef, snap => {
        if (!snap?.exists()) {
          setProfileIsAdmin(false);
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
      return;
    }
    const fs = getFirestore();
    const credentialQuery = query(collection(fs, 'hygieneCredentials'), where('employeeUid', '==', sessionUid));
    const unsub = onSnapshot(credentialQuery, snap => {
      setUserCredentials(snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })));
    });
    return () => unsub();
  }, [sessionUid]);

  const missingRequiredDocuments = useMemo(() => {
    const required = getRequiredDocumentTypesForUser(requiredDocuments);
    return getMissingRequiredDocuments(required, userCredentials);
  }, [requiredDocuments, userCredentials]);

  useEffect(() => {
    if (!sessionUid || missingRequiredDocuments.length === 0 || requiredDocsPromptedRef.current) return;
    requiredDocsPromptedRef.current = true;
    Alert.alert(
      'Required documents',
      `Hi! For German employment records, please upload ${missingRequiredDocuments.length} missing document${missingRequiredDocuments.length === 1 ? '' : 's'}.`,
      [
        { text: 'Later', style: 'cancel' },
        { text: 'Open Profile', onPress: () => navigation.navigate('EditProfile') },
      ]
    );
  }, [missingRequiredDocuments, navigation, sessionUid]);

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
      if (!snap?.docs?.length) {
        setOpenShift(null);
        return;
      }
      const best = [...snap.docs]
        .map(d => ({ ...(d.data() as any), id: d.id } as ShiftDoc))
        .filter(s => !s.isScheduled)
        .sort((a, b) => {
          const toMs = (v: any) => v?.toDate?.()?.getTime?.() ?? (v ? new Date(v as any).getTime() : 0);
          return toMs(b.startAt) - toMs(a.startAt);
        })[0];
      setOpenShift(best || null);
    });
    return () => unsubOpen();
  }, [sessionUid]);

  useEffect(() => {
    const t = setInterval(() => setShiftNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const activeShift = useMemo(() => offlineShift || openShift, [offlineShift, openShift]);
  const shiftPaused = activeShift ? isShiftPaused(activeShift) : false;
  const timerElapsedMs = useMemo(() => {
    if (!activeShift) return 0;
    if (shiftPaused) return calcCurrentPauseMs(activeShift, shiftNowMs);
    return calcWorkedMs(activeShift, shiftNowMs);
  }, [activeShift, shiftPaused, shiftNowMs]);

  const timerLabel = activeShift ? (shiftPaused ? 'Break' : 'Working') : 'Ready';

  const timerState = !activeShift ? 'idle' : shiftPaused ? 'pause' : 'working';

  const tapHint = activeShift
    ? shiftPaused
      ? 'Tap the timer to resume'
      : 'Tap the timer for a break'
    : 'Tap the timer to start your shift';

  const statusText = activeShift
    ? shiftPaused
      ? null
      : 'You are working.'
    : 'Ready to start your shift.';

  const handleStartShift = async () => {
    if (!sessionUid) {
      Alert.alert('Notice', 'Sign in to start a shift.');
      return;
    }
    if (activeShift) return;
    if (!worksites.length) {
      Alert.alert('No worksites', 'Add a worksite first, then start shift.');
      return;
    }

    const activeWorksites = worksites.filter(w => w.active !== false);
    let target = activeWorksites[0] || worksites[0];

    try {
      const pos = await new Promise<Geolocation.GeoPosition | null>(resolve =>
        Geolocation.getCurrentPosition(p => resolve(p), () => resolve(null), {
          enableHighAccuracy: true,
          timeout: 8000,
          maximumAge: 0,
        })
      );
      if (pos) {
        const me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const nearest = [...activeWorksites]
          .map(w => ({ worksite: w, d: getDistanceMeters(me, w.center) }))
          .sort((a, b) => a.d - b.d)[0];
        if (nearest?.worksite) target = nearest.worksite;
      }
    } catch {
      /* fallback worksite */
    }

    setShiftActionBusy(true);
    try {
      await startShift(sessionUid, target.id, target.name);
      await refreshOfflineShift();
    } catch (err: any) {
      Alert.alert('Notice', err?.message || 'Could not start shift.');
    } finally {
      setShiftActionBusy(false);
    }
  };

  const handlePauseResume = async () => {
    if (!activeShift?.id || shiftActionBusy) return;
    setShiftActionBusy(true);
    try {
      const result = shiftPaused
        ? await resumeLiveShift(activeShift.id)
        : await pauseLiveShift(activeShift.id);
      await refreshOfflineShift();
      if (result.queued) {
        Alert.alert('Saved offline', 'Shift change will sync when you are back online.');
      }
    } catch (err: any) {
      Alert.alert('Notice', err?.message || 'Could not update shift.');
    } finally {
      setShiftActionBusy(false);
    }
  };

  const handleEndShift = () => {
    if (!activeShift?.id || shiftActionBusy) return;
    Alert.alert('End shift', 'End your current shift? It will be locked.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End',
        style: 'destructive',
        onPress: () => {
          setShiftActionBusy(true);
          void endLiveShift(activeShift.id, 'manual')
            .then(async result => {
              await refreshOfflineShift();
              if (result.queued) {
                Alert.alert('Saved offline', 'Shift end will sync when you are back online.');
              }
            })
            .catch((err: any) => Alert.alert('Notice', err?.message || 'Could not end shift.'))
            .finally(() => setShiftActionBusy(false));
        },
      },
    ]);
  };

  const navigateQuickLink = (route: keyof RootStackParamList) => {
    setMenuOpen(false);
    navigation.navigate(route as any);
  };

  return (
    <View style={styles.screen}>
      <PizzaFireBackground />

      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <View style={[styles.content, { paddingTop: Math.max(insets.top, 18) + 10 }]}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => navigation.navigate('EditProfile')}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Open profile"
            >
              {(avatarUrl || customAvatarUrl) ? (
                <Image
                  source={resolveAvatarSource(avatarUrl, customAvatarUrl)}
                  style={styles.avatar}
                  resizeMode="cover"
                />
              ) : (
                <Image
                  source={require('../../assets/Pizza Wala Logo.png')}
                  style={styles.logoFallback}
                  resizeMode="contain"
                />
              )}
            </TouchableOpacity>
            <Text style={styles.welcomeTitle}>{welcomeText}</Text>
          </View>

          <View style={styles.timerSection}>
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
              />
            </TouchableOpacity>

            <Text style={styles.tapHint}>{tapHint}</Text>

            <View style={styles.statusBlock}>
              {activeShift?.geofenceName ? (
                <View style={styles.worksiteRow}>
                  <Icons.location color={PIZZA_FIRE.gold} width={14} height={14} />
                  <Text style={styles.worksiteText}>{activeShift.geofenceName}</Text>
                </View>
              ) : null}

              <Text style={[styles.statusText, !statusText && styles.statusTextHidden]}>
                {statusText || ' '}
              </Text>
            </View>
          </View>

          {isAdmin ? (
            <TouchableOpacity
              style={styles.adminButton}
              onPress={() => navigation.navigate('AdminOptions')}
              activeOpacity={0.88}
            >
              <Image source={require('../../assets/Icons/Admin.png')} style={styles.adminIcon} resizeMode="contain" />
              <Text style={styles.adminButtonText}>Admin</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </SafeAreaView>

      <HomeBottomNav
        hasOpenShift={!!activeShift}
        busy={shiftActionBusy}
        onOpenMenu={() => setMenuOpen(true)}
        onOpenWorkingHours={() => navigation.navigate('WorkingHours')}
        onEndShift={handleEndShift}
      />

      <Modal visible={menuOpen} transparent animationType="slide" onRequestClose={() => setMenuOpen(false)}>
        <View style={styles.menuBackdrop}>
          <Pressable
            style={styles.menuDismissArea}
            onPress={() => setMenuOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close quick links"
          />
          <View style={styles.menuSheet}>
            <View style={styles.menuSheetHeader}>
              <View style={styles.menuHandle} />
              <Text style={styles.menuTitle}>Quick links</Text>
              <Text style={styles.menuSubtitle}>Jump to your most-used tools</Text>
            </View>
            <ScrollView contentContainerStyle={styles.menuGrid} showsVerticalScrollIndicator={false}>
              {QUICK_LINKS.map(link => (
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
                style={[styles.menuTile, styles.menuTileDanger]}
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
    paddingBottom: 130,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
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
  },
  tapHint: {
    marginTop: 16,
    fontSize: 13,
    fontWeight: '700',
    color: PIZZA_FIRE.textSecondary,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  statusBlock: {
    marginTop: 18,
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
    gap: 8,
    minHeight: 46,
  },
  worksiteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  worksiteText: {
    fontSize: 14,
    fontWeight: '700',
    color: PIZZA_FIRE.gold,
    textAlign: 'center',
  },
  statusText: {
    fontSize: 15,
    fontWeight: '600',
    color: PIZZA_FIRE.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },
  statusTextHidden: {
    opacity: 0,
  },
  adminButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 33,
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
  },
  menuDismissArea: {
    flex: 1,
    width: '100%',
    minHeight: 48,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  menuSheet: {
    backgroundColor: '#5A2414',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: '72%',
    borderTopWidth: 1,
    borderColor: 'rgba(255, 159, 28, 0.32)',
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
    borderRadius: 16,
    backgroundColor: 'rgba(255, 159, 28, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 159, 28, 0.28)',
  },
  menuTileDanger: {
    backgroundColor: 'rgba(255, 69, 58, 0.08)',
    borderColor: 'rgba(255, 69, 58, 0.22)',
  },
  menuIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
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
