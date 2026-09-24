import React from 'react';
import {
  View,
  StyleSheet,
  Text,
  NativeModules,
  Image,
  Alert,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuth } from '../auth/useAuth';

import LoginScreen from '../screens/LoginScreen';
import CreateAccountScreen from '../screens/CreateAccountScreen';
import HomeScreen from '../screens/HomeScreen';
import WorksiteFinderScreen from '../screens/WorksiteFinderScreen';
import ChatScreen from '../screens/ChatScreen';
import TeamMapScreen from '../screens/TeamMapScreen';
import ShiftSetupScreen from '../screens/ShiftSetupScreen';
import GeofenceDebugScreen from '../screens/GeofenceDebugScreen';
import MapPickerScreen from '../screens/MapPickerScreen';
import PermissionsScreen from '../screens/PermissionsScreen';
import ManageUsersScreen from '../screens/ManageUsersScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import WorksiteOverviewScreen from '../screens/WorksiteOverviewScreen';
import GeofenceMonitor from '../components/GeofenceMonitor';
import ShiftOngoingSync from '../components/ShiftOngoingSync';
import ShiftEndReminderSync from '../components/ShiftEndReminderSync';
import PresenceMonitor from '../components/PresenceMonitor';
import LocationMonitor from '../components/LocationMonitor';
import { navigationRef } from './navigationRef';
import { initNativeGeofencing, stopNativeMonitoring } from '../geofencing/native';
import { getLocationFeaturesEnabled } from '../geofencing/storage';
import AdminOptionsScreen from '../screens/AdminOptionsScreen';
import AdminScheduleScreen from '../screens/AdminScheduleScreen';
import AdminCalendarScreen from '../screens/AdminCalendarScreen';
import MyScheduleScreen from '../screens/MyScheduleScreen';
import EventsScreen from '../screens/EventsScreen';
import GeofencesScreen from '../screens/GeofencesScreen';
import AdminAvailabilityScreen from '../screens/AdminAvailabilityScreen';
import AssignShiftsScreen from '../screens/AssignShiftsScreen';
import ManualShiftEntryScreen from '../screens/ManualShiftEntryScreen';
import HygieneScreen from '../screens/HygieneScreen';
import AdminHygieneScreen from '../screens/AdminHygieneScreen';
import TruckManagementScreen from '../screens/TruckManagementScreen';
import DepartureChecklistScreen from '../screens/DepartureChecklistScreen';
import RequiredDocumentsScreen from '../screens/RequiredDocumentsScreen';
import ReceiptsExpensesScreen from '../screens/ReceiptsExpensesScreen';
import WorkingHoursScreen from '../screens/WorkingHoursScreen';
import { SHOW_DEBUG_ONLY_OPERATIONS } from '../config/buildFeatures';

import type { Geofence } from '../types';
import type { GeofencePromptPayload } from '../geofencing/types';

export type RootStackParamList = {
  Login: undefined;
  CreateAccount: undefined;
  Permissions: undefined;
  Home: undefined;
  Events: { eventId?: string } | undefined;
  Geofences: undefined;
  ManageUsers: undefined;
  EditProfile: { userId?: string; userName?: string } | undefined;
  WorksiteFinder: { geofence: Geofence };
  Chat: { prefillText?: string; dmUserId?: string; eventId?: string; eventTitle?: string } | undefined;
  MySchedule: { prompt?: GeofencePromptPayload; initialView?: 'calendar' | 'list'; initialDate?: string } | undefined;
  ShiftSetup: undefined;
  GeofenceDebug: undefined;
  AdminOptions: undefined;
  WorksiteOverview: undefined;
  AdminSchedule: undefined;
  AdminCalendar: undefined;
  TeamMap: { focusUserId?: string } | undefined;
  MapPicker: {
    onLocationSelected: (lat: number, lng: number) => void;
    initialLocation?: { lat: number; lng: number };
  };
  AdminAvailability: { event?: any };
  AssignShifts: { eventId?: string; userId?: string } | undefined;
  ManualShiftEntry: undefined;
  Hygiene: undefined;
  AdminHygiene: undefined;
  TruckManagement: undefined;
  DepartureChecklist: undefined;
  RequiredDocuments: undefined;
  ReceiptsExpenses: undefined;
  WorkingHours: { initialDateKey?: string; employeeUserId?: string; employeeName?: string } | undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

import notifee, { EventType } from '@notifee/react-native';
import messaging from '@react-native-firebase/messaging';
import { collection, doc, getDoc, getDocs, getFirestore, query, where } from '@react-native-firebase/firestore';
import { nativeAuth } from '../services/firebase';
import { registerPushForCurrentUser } from '../services/pushRegistration';
import {
  routeNotificationOpen,
  flushPendingNotificationRoutes,
} from '../notifications/notificationRouting';
import { displayForegroundRemoteMessage } from '../notifications/displayForegroundRemoteMessage';
import { setNativeNotificationsEnabled } from '../geofencing/native';
import OfflineBanner from '../components/OfflineBanner';
import PizzaFireBackground from '../components/PizzaFireBackground';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';

export default function AppNavigator() {
  const auth = useAuth();
  const pendingInvitePromptedForUidRef = React.useRef<string | null>(null);

  /* ───────────────────────── NOTIFICATIONS ───────────────────────── */

  React.useEffect(() => {
    if (auth.status !== 'user' && auth.status !== 'admin') return undefined;

    let cancelled = false;
    let tokenUnsub: (() => void) | undefined;

    void (async () => {
      try {
        // Ensure OS-level notifications are enabled for native geofence alerts.
        await notifee.requestPermission({ alert: true, badge: true, sound: true });
      } catch (error) {
        console.warn('[Push] notifee permission request failed:', error);
      }

      try {
        await setNativeNotificationsEnabled(true);
      } catch (error) {
        console.warn('[Push] failed enabling native notifications:', error);
      }

      try {
        const unsub = await registerPushForCurrentUser();
        if (cancelled) {
          unsub();
          return;
        }
        tokenUnsub = unsub;
      } catch (error) {
        console.warn('[Push] register token failed:', error);
      }
    })();

    return () => {
      cancelled = true;
      tokenUnsub?.();
    };
  }, [auth.status]);

  React.useEffect(() => {
    if (auth.status !== 'user' && auth.status !== 'admin') return undefined;
    const user = nativeAuth().currentUser;
    if (!user?.uid || pendingInvitePromptedForUidRef.current === user.uid) return undefined;

    let cancelled = false;
    void (async () => {
      try {
        const fs = getFirestore();
        const eventsSnap = await getDocs(
          query(collection(fs, 'events'), where('staffIds', 'array-contains', user.uid))
        );
        const events = eventsSnap.docs
          .map(eventDoc => ({ id: eventDoc.id, ...(eventDoc.data() as any) }))
          .sort((a, b) => String(a.sortDate || a.startDate || '').localeCompare(String(b.sortDate || b.startDate || '')));
        const pending: Array<{ id: string; title: string }> = [];
        for (const event of events) {
          const response = await getDoc(doc(fs, 'events', event.id, 'availability', user.uid));
          if (!response.data()?.attendanceStatus) {
            pending.push({ id: event.id, title: String(event.title || 'an event') });
          }
        }
        if (cancelled) return;
        pendingInvitePromptedForUidRef.current = user.uid;
        if (pending.length === 0) return;
        const first = pending[0];
        Alert.alert(
          'Event confirmation needed',
          pending.length === 1
            ? `Please respond to ${first.title}.`
            : `You have ${pending.length} event invitations awaiting a response.`,
          [
            { text: 'Later', style: 'cancel' },
            { text: 'View event', onPress: () => navigationRef.navigate('Events', { eventId: first.id }) },
          ]
        );
      } catch (error) {
        console.warn('[Events] failed checking pending invitations:', error);
      }
    })();
    return () => { cancelled = true; };
  }, [auth.status]);

  React.useEffect(() => {
    void getLocationFeaturesEnabled()
      .then(enabled => (enabled ? initNativeGeofencing() : stopNativeMonitoring()))
      .catch(err => console.error('Init geofence failed:', err));

    const unsubscribeNotifee = notifee.onForegroundEvent(async ({ type, detail }) => {
      const isPress = type === EventType.PRESS || type === EventType.ACTION_PRESS;
      if (isPress && detail.notification?.data) {
        routeNotificationOpen(detail.notification.data as Record<string, unknown>);
      }
    });

    void Promise.all([notifee.getInitialNotification(), messaging().getInitialNotification()]).then(
      ([nInitial, mInitial]) => {
        if (mInitial?.data && typeof mInitial.data === 'object') {
          routeNotificationOpen(mInitial.data as Record<string, unknown>);
        } else if (nInitial?.notification?.data) {
          routeNotificationOpen(nInitial.notification.data as Record<string, unknown>);
        }
      }
    );

    const unsubOpened = messaging().onNotificationOpenedApp(remoteMessage => {
      const data = remoteMessage.data as Record<string, unknown> | undefined;
      if (data) routeNotificationOpen(data);
    });

    const unsubForeground = messaging().onMessage(async remoteMessage => {
      const data = remoteMessage.data;
      const type = data?.type;
      if (
        !SHOW_DEBUG_ONLY_OPERATIONS &&
        (type === 'chat_message' || type === 'broadcast')
      ) {
        return;
      }
      if (
        (type === 'chat_message' || type === 'broadcast') &&
        navigationRef.getCurrentRoute()?.name === 'Chat'
      ) {
        return;
      }
      await displayForegroundRemoteMessage(remoteMessage);
    });

    return () => {
      unsubscribeNotifee();
      unsubOpened();
      unsubForeground();
    };
  }, []);

  React.useEffect(() => {
    if (auth.status === 'user' || auth.status === 'admin') {
      flushPendingNotificationRoutes();
    }
  }, [auth.status]);

  React.useEffect(() => {
    const checkPendingAction = async () => {
      try {
        const { GeofenceModule } = NativeModules;
        if (!GeofenceModule) return;

        const pending = await GeofenceModule.getPendingAction();
        const uid = nativeAuth().currentUser?.uid;
        if (pending?.action === 'stop_shift_at' && uid) {
          const { endShift } = require('../geofencing/processor');
          const endTime = pending.endTime ? new Date(pending.endTime) : new Date();
          await endShift(uid, endTime);
          console.log('[NativeAction] Shift ended at:', endTime.toISOString());
        }
      } catch (err) {
        console.warn('[NativeAction] Error checking pending action:', err);
      }
    };
    if (auth.status === 'user' || auth.status === 'admin') {
      checkPendingAction();
    }
  }, [auth.status]);

  /* ───────────────────────── AUTH LOADING ───────────────────────── */

  if (auth.status === 'loading') {
    return (
      <View style={styles.loading}>
        <PizzaFireBackground />
        <Image
          source={require('../../assets/Pizza Wala Logo.png')}
          style={styles.loadingLogo}
          resizeMode="contain"
        />
        <Text style={styles.loadingText}>
          Loading your dashboard…
        </Text>
      </View>
    );
  }

  /* ───────────────────────── NAVIGATION ───────────────────────── */

  return (
    <View style={styles.appRoot}>
      <NavigationContainer
        style={styles.navContainer}
        ref={navigationRef}
        onReady={() => {
          if (auth.status === 'user' || auth.status === 'admin') {
            flushPendingNotificationRoutes();
          }
        }}
      >
        <GeofenceMonitor />
        <ShiftOngoingSync />
        <ShiftEndReminderSync />
        <PresenceMonitor />
        <LocationMonitor />
        <Stack.Navigator screenOptions={{ headerShown: false }}>
        {auth.status === 'signedOut' ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen
              name="CreateAccount"
              component={CreateAccountScreen}
            />
          </>
        ) : (
          <>
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Permissions" component={PermissionsScreen} />
            <Stack.Screen name="Geofences" component={GeofencesScreen} />
            <Stack.Screen name="ManageUsers" component={ManageUsersScreen} />
            <Stack.Screen name="EditProfile" component={EditProfileScreen} />
            <Stack.Screen
              name="WorksiteFinder"
              component={WorksiteFinderScreen}
            />
            <Stack.Screen name="MySchedule" component={MyScheduleScreen} />
            <Stack.Screen name="ShiftSetup" component={ShiftSetupScreen} />
            <Stack.Screen name="GeofenceDebug" component={GeofenceDebugScreen} />
            <Stack.Screen name="AdminOptions" component={AdminOptionsScreen} />
            <Stack.Screen name="WorksiteOverview" component={WorksiteOverviewScreen} />
            <Stack.Screen name="AdminSchedule" component={AdminScheduleScreen} />
            <Stack.Screen name="AdminCalendar" component={AdminCalendarScreen} />
            <Stack.Screen name="TeamMap" component={TeamMapScreen} />
            {SHOW_DEBUG_ONLY_OPERATIONS ? <Stack.Screen name="Chat" component={ChatScreen} /> : null}
            <Stack.Screen name="MapPicker" component={MapPickerScreen} />
            <Stack.Screen name="Events" component={EventsScreen} />
            <Stack.Screen name="AdminAvailability" component={AdminAvailabilityScreen} />
            <Stack.Screen name="AssignShifts" component={AssignShiftsScreen} />
            <Stack.Screen name="ManualShiftEntry" component={ManualShiftEntryScreen} />
            <Stack.Screen name="Hygiene" component={HygieneScreen} />
            <Stack.Screen name="AdminHygiene" component={AdminHygieneScreen} />
            {SHOW_DEBUG_ONLY_OPERATIONS ? <Stack.Screen name="TruckManagement" component={TruckManagementScreen} /> : null}
            {SHOW_DEBUG_ONLY_OPERATIONS ? <Stack.Screen name="DepartureChecklist" component={DepartureChecklistScreen} /> : null}
            <Stack.Screen name="RequiredDocuments" component={RequiredDocumentsScreen} />
            <Stack.Screen name="ReceiptsExpenses" component={ReceiptsExpensesScreen} />
            <Stack.Screen name="WorkingHours" component={WorkingHoursScreen} />
          </>
        )}
      </Stack.Navigator>
      </NavigationContainer>
      <View style={styles.bannerOverlay} pointerEvents="box-none">
        <OfflineBanner />
      </View>
    </View>
  );
}

/* ───────────────────────── STYLES ───────────────────────── */

const styles = StyleSheet.create({
  appRoot: {
    flex: 1,
    backgroundColor: PIZZA_FIRE.bgTop,
  },
  navContainer: {
    flex: 1,
  },
  bannerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  loading: {
    flex: 1,
    backgroundColor: PIZZA_FIRE.bgTop,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingLogo: {
    width: 108,
    height: 108,
    marginBottom: 14,
  },
  loadingText: {
    fontSize: 16,
    color: PIZZA_FIRE.textPrimary,
    fontWeight: '500',
  },
});
