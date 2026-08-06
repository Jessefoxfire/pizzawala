import React from 'react';
import {
  View,
  StyleSheet,
  Text,
  NativeModules,
  Image,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuth } from '../auth/useAuth';

import LoginScreen from '../screens/LoginScreen';
import CreateAccountScreen from '../screens/CreateAccountScreen';
import HomeScreen from '../screens/HomeScreen';
import GeofencesScreen from '../screens/GeofencesScreen';
import WorksiteFinderScreen from '../screens/WorksiteFinderScreen';
import ChatScreen from '../screens/ChatScreen';
import TeamMapScreen from '../screens/TeamMapScreen';
import AwardMedalScreen from '../screens/AwardMedalScreen';
import HallOfFameScreen from '../screens/HallOfFameScreen';
import ShiftSetupScreen from '../screens/ShiftSetupScreen';
import GeofenceDebugScreen from '../screens/GeofenceDebugScreen';
import MapPickerScreen from '../screens/MapPickerScreen';
import PermissionsScreen from '../screens/PermissionsScreen';
import ManageUsersScreen from '../screens/ManageUsersScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import WorksiteOverviewScreen from '../screens/WorksiteOverviewScreen';
import GeofenceMonitor from '../components/GeofenceMonitor';
import PresenceMonitor from '../components/PresenceMonitor';
import LocationMonitor from '../components/LocationMonitor';
import { navigationRef } from './navigationRef';
import { initNativeGeofencing } from '../geofencing/native';
import { handleGeofenceReminderAction } from '../geofencing/notificationPolicy';
import { muteGeofenceNotificationsForMs } from '../geofencing/storage';
import AdminOptionsScreen from '../screens/AdminOptionsScreen';
import AdminScheduleScreen from '../screens/AdminScheduleScreen';
import AdminCalendarScreen from '../screens/AdminCalendarScreen';
import MyScheduleScreen from '../screens/MyScheduleScreen';
import EventsScreen from '../screens/EventsScreen';
import AdminAvailabilityScreen from '../screens/AdminAvailabilityScreen';
import AssignShiftsScreen from '../screens/AssignShiftsScreen';
import ManualShiftEntryScreen from '../screens/ManualShiftEntryScreen';
import HygieneScreen from '../screens/HygieneScreen';
import AdminHygieneScreen from '../screens/AdminHygieneScreen';
import TruckManagementScreen from '../screens/TruckManagementScreen';
import DepartureChecklistScreen from '../screens/DepartureChecklistScreen';
import RequiredDocumentsScreen from '../screens/RequiredDocumentsScreen';
import WorkingHoursScreen from '../screens/WorkingHoursScreen';

import type { Geofence } from '../types';
import type { GeofencePromptPayload } from '../geofencing/types';

export type RootStackParamList = {
  Login: undefined;
  CreateAccount: undefined;
  Permissions: undefined;
  Home: undefined;
  Geofences: undefined;
  ManageUsers: undefined;
  EditProfile: undefined;
  WorksiteFinder: { geofence: Geofence };
  Chat: { prefillText?: string; dmUserId?: string; eventId?: string; eventTitle?: string } | undefined;
  AwardMedal: undefined;
  HallOfFame: undefined;
  MySchedule: { prompt?: GeofencePromptPayload; initialView?: 'calendar' | 'list'; initialDate?: string } | undefined;
  ShiftSetup: undefined;
  GeofenceDebug: undefined;
  AdminOptions: undefined;
  WorksiteOverview: undefined;
  AdminSchedule: undefined;
  AdminCalendar: undefined;
  TeamMap: { focusUserId?: string } | undefined;
  MapPicker: { onLocationSelected: (lat: number, lng: number) => void };
  Events: undefined;
  AdminAvailability: { event?: any };
  AssignShifts: undefined;
  ManualShiftEntry: undefined;
  Hygiene: undefined;
  AdminHygiene: undefined;
  TruckManagement: undefined;
  DepartureChecklist: undefined;
  RequiredDocuments: undefined;
  WorkingHours: { initialDateKey?: string } | undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

import notifee, { EventType } from '@notifee/react-native';
import messaging from '@react-native-firebase/messaging';
import { nativeAuth } from '../services/firebase';
import { registerPushForCurrentUser } from '../services/pushRegistration';
import {
  routeNotificationOpen,
  flushPendingNotificationRoutes,
} from '../notifications/notificationRouting';
import { displayForegroundRemoteMessage } from '../notifications/displayForegroundRemoteMessage';
import { setNativeNotificationsEnabled } from '../geofencing/native';
import OfflineBanner from '../components/OfflineBanner';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';

export default function AppNavigator() {
  const auth = useAuth();

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
    void initNativeGeofencing().catch(err => console.error('Init geofence failed:', err));

    const unsubscribeNotifee = notifee.onForegroundEvent(async ({ type, detail }) => {
      if (type === EventType.ACTION_PRESS) {
        const actionId = detail.pressAction?.id;
        if (actionId === 'mute_geofence_1h') {
          await muteGeofenceNotificationsForMs(60 * 60 * 1000);
          if (detail.notification?.id) {
            await notifee.cancelNotification(detail.notification.id);
          }
          return;
        }
        if (actionId === 'keep_geofence_enabled') {
          if (detail.notification?.id) {
            await notifee.cancelNotification(detail.notification.id);
          }
          return;
        }
        if (actionId === 'keep_reminding' || actionId === 'stop_reminders') {
          await handleGeofenceReminderAction(actionId);
          if (detail.notification?.id) {
            await notifee.cancelNotification(detail.notification.id);
          }
          return;
        }
      }
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
      const uid = nativeAuth().currentUser?.uid;
      const data = remoteMessage.data;
      const type = data?.type;
      if (
        (type === 'chat_message' || type === 'broadcast') &&
        navigationRef.getCurrentRoute()?.name === 'Chat'
      ) {
        return;
      }
      if (type === 'award_received' && data?.toUserId && data.toUserId !== uid) {
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
            <Stack.Screen name="Permissions" component={PermissionsScreen} />
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Geofences" component={GeofencesScreen} />
            <Stack.Screen name="ManageUsers" component={ManageUsersScreen} />
            <Stack.Screen name="EditProfile" component={EditProfileScreen} />
            <Stack.Screen
              name="WorksiteFinder"
              component={WorksiteFinderScreen}
            />
            <Stack.Screen name="AwardMedal" component={AwardMedalScreen} />
            <Stack.Screen name="HallOfFame" component={HallOfFameScreen} />
            <Stack.Screen name="MySchedule" component={MyScheduleScreen} />
            <Stack.Screen name="ShiftSetup" component={ShiftSetupScreen} />
            <Stack.Screen name="GeofenceDebug" component={GeofenceDebugScreen} />
            <Stack.Screen name="AdminOptions" component={AdminOptionsScreen} />
            <Stack.Screen name="WorksiteOverview" component={WorksiteOverviewScreen} />
            <Stack.Screen name="AdminSchedule" component={AdminScheduleScreen} />
            <Stack.Screen name="AdminCalendar" component={AdminCalendarScreen} />
            <Stack.Screen name="TeamMap" component={TeamMapScreen} />
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="MapPicker" component={MapPickerScreen} />
            <Stack.Screen name="Events" component={EventsScreen} />
            <Stack.Screen name="AdminAvailability" component={AdminAvailabilityScreen} />
            <Stack.Screen name="AssignShifts" component={AssignShiftsScreen} />
            <Stack.Screen name="ManualShiftEntry" component={ManualShiftEntryScreen} />
            <Stack.Screen name="Hygiene" component={HygieneScreen} />
            <Stack.Screen name="AdminHygiene" component={AdminHygieneScreen} />
            <Stack.Screen name="TruckManagement" component={TruckManagementScreen} />
            <Stack.Screen name="DepartureChecklist" component={DepartureChecklistScreen} />
            <Stack.Screen name="RequiredDocuments" component={RequiredDocumentsScreen} />
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
    backgroundColor: '#C9782B',
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
    color: '#F3E6D3',
    fontWeight: '500',
  },
});
