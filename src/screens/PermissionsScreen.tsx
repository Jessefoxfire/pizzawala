import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Linking,
  Pressable,
  TouchableOpacity,
  } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import notifee, { AuthorizationStatus } from '@notifee/react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { 
  ensureGeofencePermissions, 
  ensureLocationPermission,
  ensureActivityRecognitionPermission,
} from '../utils/geo';

type Props = NativeStackScreenProps<RootStackParamList, 'Permissions'>;

export default function PermissionsScreen({ navigation }: Props) {
  const [requesting, setRequesting] = React.useState(false);

  const requestPermission = async () => {
    if (requesting) {
      return;
    }

    setRequesting(true);
    try {
      const hasLocation = await ensureLocationPermission();
      if (!hasLocation) {
        Alert.alert(
          'Permission required',
          'Location permission is required to detect worksite entry and exit.',
          [
            { text: 'Not now', style: 'cancel' },
            {
              text: 'Open Settings',
              onPress: () => {
                void Linking.openSettings();
              },
            },
          ]
        );
        return;
      }


      const hasActivity = await ensureActivityRecognitionPermission();
      if (!hasActivity) {
        Alert.alert(
          'Physical Activity Permission Required',
          'PizzaWala needs physical activity permission to detect worksite arrival accurately and save battery. Please allow this permission in system settings.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => void Linking.openSettings() },
          ]
        );
        setRequesting(false);
        return;
      }

      const hasBackgroundLocation = await ensureGeofencePermissions();
      if (!hasBackgroundLocation) {
        Alert.alert(
          'Bulletproof mode required',
          'For reliable alerts when PizzaWala is closed, you must select:\n\n1. Location\n2. "Allow all the time"\n3. "Use precise location"\n\nWithout this, geofences may be ignored by the OS.',
          [
            { text: 'Continue', style: 'cancel' },
            {
              text: 'Open Settings',
              onPress: () => {
                void Linking.openSettings();
              },
            },
          ]
        );
      } else {
  // If we have geofence permissions, also check for battery optimization
      const { checkAndPromptBatteryOptimization } = require('../utils/geo');
      await checkAndPromptBatteryOptimization();
    }


    const notifSettings = await notifee.requestPermission({
        alert: true,
        badge: true,
        sound: true,
      });
      const notifyOk =
        notifSettings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
        notifSettings.authorizationStatus === AuthorizationStatus.PROVISIONAL;
      if (!notifyOk) {
        Alert.alert(
          'Enable notifications',
          'PizzaWala uses notifications to tell you when you arrive at or leave a worksite, including when the app is in the background.',
          [
            { text: 'Not now', style: 'cancel' },
            {
              text: 'Notification settings',
              onPress: () => {
                void notifee.openNotificationSettings();
              },
            },
          ]
        );
      }

      navigation.replace('Home');
    } catch (error) {
      console.warn('Permissions error:', error);
      Alert.alert(
        'Setup failed',
        'Location services could not be configured. Please try again.'
      );
    } finally {
      setRequesting(false);
    }
  };

  React.useEffect(() => {
    const checkExistingPermissions = async () => {
      try {
        const hasLocation = await ensureLocationPermission();
        const hasActivity = await ensureActivityRecognitionPermission();
        const hasGeofence = await ensureGeofencePermissions();
        
        // We only skip if all three are granted. 
        // Note: ensureGeofencePermissions might show an alert if not granted, 
        // which might be annoying on startup. 
        // Better to use a "check-only" version if possible.
        
        if (hasLocation && hasActivity && hasGeofence) {
          navigation.replace('Home');
        }
      } catch (err) {
        console.warn('Check permissions failed:', err);
      }
    };
    void checkExistingPermissions();
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Location and notifications</Text>
        <Text style={styles.text}>
          PizzaWala uses your location and physical activity to detect worksite entry and exit accurately,
          and sends notifications when you arrive or leave—even when the app is in the background.
        </Text>
        <Text style={styles.subtext}>
          You will be asked for location, physical activity, and then notification
          permission. All three help shift tracking work reliably.
        </Text>
        <Pressable
          style={[styles.button, requesting && styles.buttonDisabled]}
          onPress={() => {
            void requestPermission();
            // Safety timeout: re-enable after 5s if stuck
            setTimeout(() => setRequesting(false), 5000);
          }}
          disabled={requesting}
        >
          <Text style={styles.buttonText}>
            {requesting ? 'Requesting…' : 'Continue'}
          </Text>
        </Pressable>

        {requesting && (
          <TouchableOpacity 
            style={{ marginTop: 20 }} 
            onPress={() => navigation.replace('Home')}
          >
            <Text style={{ color: '#4E3A2A', textDecorationLine: 'underline', textAlign: 'center' }}>
              Enter Anyway
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#D27A34',
  },
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: '#D27A34',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 12,
    color: '#2F1E12',
    textAlign: 'center',
  },
  text: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 10,
    color: '#4E3A2A',
    textAlign: 'center',
  },
  subtext: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
    color: '#6A5546',
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#1E1813',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#F6EDE2',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFF8F0',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
