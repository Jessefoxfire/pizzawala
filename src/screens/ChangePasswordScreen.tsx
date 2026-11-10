import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import PizzaFireScreen from '../components/PizzaFireScreen';
import { Icons } from '../components/Icons';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { auth, changePassword, resetPassword } from '../services/firebase';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import { pizzaFireUi } from '../theme/pizzaFireUi';
import { formColumnFrame, useAppLayout } from '../theme/responsiveLayout';

type Props = NativeStackScreenProps<RootStackParamList, 'ChangePassword'>;

export default function ChangePasswordScreen({ navigation }: Props) {
  const layout = useAppLayout();
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleChange = async () => {
    if (saving) return;
    if (!currentPassword || !nextPassword || !confirmPassword) {
      Alert.alert('Notice', 'Enter your current password and the new password twice.');
      return;
    }
    if (nextPassword.length < 6) {
      Alert.alert('Notice', 'New password must be at least 6 characters.');
      return;
    }
    if (nextPassword !== confirmPassword) {
      Alert.alert('Notice', 'New passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      await changePassword(currentPassword, nextPassword);
      Alert.alert('Password updated', 'Use the new password the next time you sign in.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err: any) {
      const code = String(err?.code || '');
      const message =
        code === 'auth/invalid-credential' || code === 'auth/wrong-password'
          ? 'Current password is incorrect.'
          : code === 'auth/weak-password'
            ? 'Choose a stronger password (at least 6 characters).'
            : code === 'auth/too-many-requests'
              ? 'Too many attempts. Wait a moment and try again.'
              : err?.message || 'Unable to change password.';
      Alert.alert('Notice', message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    const email = String(auth.currentUser?.email || '').trim().toLowerCase();
    if (!email) {
      Alert.alert('No email', 'This account has no email on file.');
      return;
    }
    setResetting(true);
    try {
      await resetPassword(email);
      Alert.alert('Reset Email Sent', `Sent to ${email}.`);
    } catch (err: any) {
      Alert.alert('Reset Failed', err?.message || 'Unable to send reset email.');
    } finally {
      setResetting(false);
    }
  };

  return (
    <PizzaFireScreen>
      <View style={styles.container}>
        <View style={pizzaFireUi.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button">
            <Icons.arrowLeft color={PIZZA_FIRE.gold} width={24} height={24} />
          </TouchableOpacity>
          <View style={styles.headerTitles}>
            <Text style={styles.headerContext}>Settings</Text>
            <Text style={[pizzaFireUi.headerTitle, styles.headerTitle]}>Change password</Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>

        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={[styles.scrollContent, formColumnFrame(layout)]}
            keyboardShouldPersistTaps="handled"
          >
            <TextInput
              style={styles.input}
              placeholder="Current password"
              placeholderTextColor={PIZZA_FIRE.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={currentPassword}
              onChangeText={setCurrentPassword}
            />
            <TextInput
              style={styles.input}
              placeholder="New password"
              placeholderTextColor={PIZZA_FIRE.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={nextPassword}
              onChangeText={setNextPassword}
            />
            <TextInput
              style={styles.input}
              placeholder="Confirm new password"
              placeholderTextColor={PIZZA_FIRE.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />
            <TouchableOpacity style={styles.saveBtn} onPress={() => void handleChange()} disabled={saving}>
              {saving ? (
                <ActivityIndicator color={PIZZA_FIRE.charcoal} />
              ) : (
                <Text style={styles.saveLabel}>Update password</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.resetBtn} onPress={() => void handleReset()} disabled={resetting}>
              {resetting ? (
                <ActivityIndicator color={PIZZA_FIRE.gold} />
              ) : (
                <Text style={styles.resetLabel}>Reset password</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </PizzaFireScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  backBtn: { padding: 4, minWidth: 32 },
  headerSpacer: { width: 32 },
  headerTitles: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 0 },
  headerContext: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 1,
  },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },
  input: {
    backgroundColor: PIZZA_FIRE.inputBg,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    borderRadius: 7,
    color: PIZZA_FIRE.textPrimary,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  saveBtn: {
    marginTop: 8,
    minHeight: 48,
    borderRadius: 7,
    backgroundColor: PIZZA_FIRE.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveLabel: { color: PIZZA_FIRE.charcoal, fontSize: 16, fontWeight: '800' },
  resetBtn: { marginTop: 16, alignItems: 'center', minHeight: 40, justifyContent: 'center' },
  resetLabel: { color: PIZZA_FIRE.gold, fontSize: 15, fontWeight: '700' },
});
