import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  StatusBar,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { loginWithEmail, resetPassword } from '../services/firebase';
import { RootStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsLoadingResetting] = useState(false);

  const handleSignIn = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      Alert.alert('Notice', 'Email and password are required.');
      return;
    }

    setIsLoading(true);
    try {
      const credential = await loginWithEmail(trimmedEmail.toLowerCase(), password);
      if (!credential?.user) {
        Alert.alert('Sign In Failed', 'Unable to complete sign-in. Try again.');
      }
    } catch (err: any) {
      const code = String(err?.code || '');
      const friendly =
        code === 'auth/invalid-credential' || code === 'auth/wrong-password'
          ? 'Invalid email or password. Double-check and try again.'
          : code === 'auth/user-not-found'
            ? 'No account found for that email. Try Create Account.'
            : code === 'auth/too-many-requests'
              ? 'Too many attempts. Please wait a moment and try again.'
              : err?.message
                ? String(err.message)
                : 'Unable to sign in.';
      Alert.alert('Sign In Failed', friendly);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      Alert.alert('Email required', 'Enter your email to receive a reset link.');
      return;
    }

    setIsLoadingResetting(true);
    try {
      await resetPassword(trimmedEmail.toLowerCase());
      Alert.alert('Reset Email Sent', 'Check your inbox for a password reset link.');
    } catch (err: any) {
      const code = String(err?.code || '');
      const friendly =
        code === 'auth/user-not-found'
          ? 'No account found for that email.'
          : err?.message
            ? String(err.message)
            : 'Unable to send reset email.';
      const debug = code ? `\n\nCode: ${code}` : '';
      Alert.alert('Reset Failed', `${friendly}${debug}`);
    } finally {
      setIsLoadingResetting(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      <ImageBackground
        source={require('../../assets/Flames background.png')}
        style={styles.background}
        resizeMode="cover"
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.content}>
              <Image
                source={require('../../assets/Pizza Wala Logo.png')}
                style={styles.logo}
                resizeMode="contain"
              />
              <Text style={styles.title}>PizzaWala</Text>
              <Text style={styles.subtitle}>
                Welcome to The Pizza Wala Team!{"\n"}
                Create your account or sign in.
              </Text>

              <View style={styles.form}>
                <TextInput
                  style={styles.input}
                  placeholder="Email"
                  placeholderTextColor="#8F6A48"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                />
                <View style={styles.passwordRow}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="Password"
                    placeholderTextColor="#8F6A48"
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={setPassword}
                  />
                  <TouchableOpacity
                    style={styles.toggleButton}
                    onPress={() => setShowPassword(prev => !prev)}
                  >
                    <Text style={styles.toggleText}>{showPassword ? 'Hide' : 'Show'}</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={handleSignIn}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#3D352E" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Sign In</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.resetButton}
                  onPress={handleResetPassword}
                  disabled={isResetting}
                >
                  {isResetting ? (
                    <ActivityIndicator color="#B35412" />
                  ) : (
                    <Text style={styles.resetButtonText}>Forgot Password?</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => navigation.navigate('CreateAccount')}
                >
                  <Text style={styles.secondaryButtonText}>Create Account</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#2A211B',
  },
  background: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  logo: {
    width: 180,
    height: 90,
  },
  title: {
    marginTop: 16,
    fontSize: 30,
    fontWeight: '700',
    color: '#F6EDE2',
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 17,
    lineHeight: 24,
    textAlign: 'center',
    color: '#F6EDE2',
    paddingHorizontal: 24,
  },
  form: {
    width: '100%',
    marginTop: 24,
    backgroundColor: 'rgba(31, 41, 55, 0.92)',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
  input: {
    backgroundColor: '#3A2D24',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    fontSize: 16,
    color: '#EBDCCB',
    marginBottom: 12,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3A2D24',
    borderRadius: 10,
    marginBottom: 12,
  },
  passwordInput: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#EBDCCB',
  },
  toggleButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  toggleText: {
    color: '#C9782B',
    fontWeight: '600',
    fontSize: 13,
  },
  primaryButton: {
    backgroundColor: '#C9782B',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F6EDE2',
  },
  secondaryButton: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  secondaryButtonText: {
    fontSize: 14,
    textDecorationLine: 'underline',
    color: '#D9A441',
  },
  resetButton: {
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 6,
  },
  resetButtonText: {
    fontSize: 13,
    textDecorationLine: 'underline',
    color: '#D9A441',
  },
});
