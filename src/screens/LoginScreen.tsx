
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  ActivityIndicator,
  ScrollView,
  SafeAreaView,
  Platform,
} from 'react-native';
import { loginWithEmail } from '../services/firebase';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { Icons } from '../components/Icons';

type LoginScreenProps = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter your email and password.');
      return;
    }
    setIsLoading(true);
    loginWithEmail(email, password)
      .catch((error) => {
        Alert.alert('Login Failed', 'Invalid email or password.');
      })
      .finally(() => setIsLoading(false));
  };

  return (
    <SafeAreaView style={styles.container}>
     <ScrollView contentContainerStyle={styles.scrollContainer}>
      <View style={styles.card}>
        <Image
          source={{ uri: 'https://firebasestorage.googleapis.com/v0/b/pizza-wala-team.firebasestorage.app/o/Pizza%20Wala%20Logo.png?alt=media&token=60fce49d-2ef0-4e4d-9465-1fd42a6fb612' }}
          style={styles.logo}
        />
        <Text style={styles.title}>Pizza Wala</Text>
        <Text style={styles.subtitle}>Team Member Login</Text>

        <View style={styles.inputGroup}>
            <Text style={styles.label}>Email</Text>
            <TextInput
                placeholder="tony@pizzawala.com"
                value={email}
                onChangeText={setEmail}
                style={styles.input}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholderTextColor="#8F6A48"
            />
        </View>

        <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordContainer}>
                <TextInput
                    placeholder="********"
                    value={password}
                    onChangeText={setPassword}
                    style={styles.passwordInput}
                    secureTextEntry={!showPassword}
                    placeholderTextColor="#8F6A48"
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
                    {showPassword ? <Icons.eyeOff color="#fff" width={20} height={20} /> : <Icons.eye color="#fff" width={20} height={20} />}
                </TouchableOpacity>
            </View>
        </View>

        <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={isLoading}>
          {isLoading ? <ActivityIndicator color="#3D352E" /> : <Text style={styles.buttonText}>Login</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={styles.createAccountButton} onPress={() => navigation.navigate('CreateAccount')}>
            <Text style={styles.createAccountButtonText}>New here? <Text style={styles.underline}>Create Account</Text></Text>
        </TouchableOpacity>
      </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#e77f39' },
  scrollContainer: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20, paddingTop: Platform.OS === 'android' ? 40 : 0 },
  card: { width: '100%', maxWidth: 380, backgroundColor: '#FEF6E4', padding: 24, borderRadius: 24, alignItems: 'center', elevation: 5 },
  logo: { width: 100, height: 100, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#3D352E', marginBottom: 4, fontFamily: 'sans-serif' },
  subtitle: { marginBottom: 24, color: '#3D352E', fontSize: 18, fontWeight: '600', fontFamily: 'sans-serif' },
  inputGroup: { width: '100%', marginBottom: 16 },
  label: { color: '#3D352E', fontSize: 14, fontWeight: '600', marginBottom: 8, fontFamily: 'sans-serif' },
  input: { backgroundColor: '#e77f39', padding: 14, borderRadius: 12, color: '#FFF', fontFamily: 'sans-serif' },
  passwordContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#e77f39', borderRadius: 12 },
  passwordInput: { flex: 1, padding: 14, color: '#FFF', fontFamily: 'sans-serif' },
  eyeIcon: { paddingRight: 16 },
  button: { backgroundColor: '#FDECC8', padding: 16, borderRadius: 12, width: '100%', marginTop: 16, alignItems: 'center' },
  buttonText: { fontWeight: 'bold', fontSize: 16, color: '#3D352E', fontFamily: 'sans-serif' },
  createAccountButton: { marginTop: 24 },
  createAccountButtonText: { color: '#57493E', fontSize: 14, fontFamily: 'sans-serif' },
  underline: { textDecorationLine: 'underline' }
});
