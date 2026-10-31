import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getFirestore, onSnapshot } from '@react-native-firebase/firestore';
import { nativeAuth } from '../services/firebase';
import { birthdayGreetingMessage, firstName, isBirthdayToday, localDateKey } from '../utils/birthday';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';

type Profile = {
  name?: string;
  displayName?: string;
  germanCompliance?: { birthDate?: string };
};

export default function BirthdayGreeting() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [visible, setVisible] = useState(false);
  const userId = nativeAuth().currentUser?.uid || null;

  const refreshVisibility = useCallback(async () => {
    if (!userId || !profile || !isBirthdayToday(profile.germanCompliance?.birthDate)) {
      setVisible(false);
      return;
    }
    const dismissed = await AsyncStorage.getItem(`birthday_greeting_dismissed_${userId}_${localDateKey()}`);
    setVisible(dismissed !== 'true');
  }, [profile, userId]);

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      return undefined;
    }
    return onSnapshot(doc(getFirestore(), 'users', userId), snapshot => {
      setProfile((snapshot.data() as Profile | undefined) || null);
    });
  }, [userId]);

  useEffect(() => {
    refreshVisibility().catch(error => console.warn('[Birthday] Could not check greeting state:', error));
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refreshVisibility().catch(error => console.warn('[Birthday] Could not refresh greeting state:', error));
      }
    });
    return () => subscription.remove();
  }, [refreshVisibility]);

  const dismiss = () => {
    if (userId) {
      AsyncStorage.setItem(`birthday_greeting_dismissed_${userId}_${localDateKey()}`, 'true')
        .catch(error => console.warn('[Birthday] Could not save greeting dismissal:', error));
    }
    setVisible(false);
  };

  const name = firstName(profile?.name) || firstName(profile?.displayName);
  const message = birthdayGreetingMessage(name);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close birthday greeting"
            hitSlop={12}
            onPress={dismiss}
            style={styles.close}
          >
            <Text style={styles.closeText}>×</Text>
          </Pressable>
          <Text style={styles.emoji}>🎉</Text>
          <Text style={styles.message}>{message}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(18, 10, 6, 0.72)',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    paddingHorizontal: 28,
    paddingTop: 36,
    paddingBottom: 32,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.gold,
    backgroundColor: PIZZA_FIRE.bgMid,
    alignItems: 'center',
  },
  close: {
    position: 'absolute',
    right: 14,
    top: 10,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: PIZZA_FIRE.textSecondary,
    fontSize: 30,
    lineHeight: 32,
  },
  emoji: {
    fontSize: 46,
    marginBottom: 16,
  },
  message: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '800',
    textAlign: 'center',
  },
});
