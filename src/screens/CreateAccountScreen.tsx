import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { createAccountWithEmail, uploadStorageRef, uploadStorageRefFallback } from '../services/firebase';
import { doc, getFirestore, updateDoc } from '@react-native-firebase/firestore';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { Icons } from '../components/Icons';
import { Avatars, type AvatarKey } from '../../assets/avatars';
import { ensureImagePickerPermission } from '../utils/imagePickerPermissions';
import { putFileAndGetDownloadUrl } from '../utils/storageUpload';
import PizzaFireScreen from '../components/PizzaFireScreen';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';

type CreateAccountScreenProps = NativeStackScreenProps<RootStackParamList, 'CreateAccount'>;

const avatarOptions: { id: AvatarKey }[] = Object.keys(Avatars).map(key => ({
  id: key as AvatarKey,
}));

export default function CreateAccountScreen({ navigation }: CreateAccountScreenProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState<AvatarKey | null>(null);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    return () => { isMounted.current = false; };
  }, []);

  const handleImagePick = async (useCamera: boolean) => {
    const source = useCamera ? 'camera' : 'library';
    const hasPermission = await ensureImagePickerPermission(source);
    if (!hasPermission) {
      Alert.alert('Permission needed', 'Allow camera access to take a new photo.');
      return;
    }

    const options: any = { mediaType: 'photo', quality: 0.7, maxWidth: 800, maxHeight: 800, saveToPhotos: useCamera };
    try {
      const result = useCamera ? await launchCamera(options) : await launchImageLibrary(options);
      if (result.didCancel || !result.assets?.[0]?.uri) return;

      const uri = result.assets[0].uri;
      setLocalUri(uri);
      setSelectedAvatar(null);
    } catch (err) {
      Alert.alert('Error', 'Failed to pick image.');
    }
  };

  const handleCreateAccount = async () => {
    if (!name.trim() || !email.trim() || !password.trim() || (!selectedAvatar && !localUri)) {
      Alert.alert('Notice', 'Please fill in all fields and choose an identity.');
      return;
    }

    setIsLoading(true);
    try {
      const userCredential = await createAccountWithEmail(name, email, password, selectedAvatar);
      const user = userCredential.user;

      if (localUri) {
        const storagePath = `users/${user.uid}/photos/profile.jpg`;
        try {
          const reference = uploadStorageRef(storagePath);
          const downloadUrl = await putFileAndGetDownloadUrl(reference, localUri, {
            contentType: 'image/jpeg',
          }, {
            fallbackReference: () => uploadStorageRefFallback(storagePath),
          });
          await updateDoc(doc(getFirestore(), 'users', user.uid), {
            customAvatarUrl: downloadUrl,
            avatarUrl: null,
          });
        } catch (uploadErr: any) {
          console.error('Signup photo upload:', uploadErr);
          if (isMounted.current) {
            Alert.alert(
              'Photo upload',
              'Your account was created but the profile photo could not be uploaded. You can add one from Edit Profile.'
            );
          }
        }
      }
    } catch (error: any) {
      if (isMounted.current) {
        const code = error?.code ? String(error.code) : '';
        if (code === 'auth/email-already-in-use') {
          Alert.alert('Email already registered', 'Please log in instead.');
        } else {
          Alert.alert('Creation Failed', error.message || 'Please try again.');
        }
      }
    } finally {
      if (isMounted.current) setIsLoading(false);
    }
  };

  return (
    <PizzaFireScreen>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
            <View style={styles.card}>
              <TouchableOpacity style={styles.homeButton} onPress={() => navigation.replace('Login')}>
                <View style={styles.homeButtonContent}>
                  <Icons.arrowLeft color="#EBDCCB" width={16} height={16} />
                  <Text style={styles.homeButtonText}>Back to Login</Text>
                </View>
              </TouchableOpacity>
              <Text style={styles.title}>Create Account</Text>
              <Text style={styles.subtitle}>Select an Avatar or Upload a Profile Pic</Text>

              <View style={styles.avatarSection}>
                <View style={styles.avatarGrid}>
                  <TouchableOpacity 
                    style={[styles.uploadPill, localUri && styles.avatarSelectedPill]} 
                    onPress={() => {
                      Alert.alert('Identity Photo', 'Choose a source:', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Camera', onPress: () => handleImagePick(true) },
                        { text: 'Gallery', onPress: () => handleImagePick(false) },
                      ]);
                    }}
                  >
                    {localUri ? (
                      <Image source={{ uri: localUri }} style={styles.customPreview} />
                    ) : (
                      <View style={styles.cameraIconBg}><Icons.camera color={PIZZA_FIRE.accent} width={24} height={24} /></View>
                    )}
                    <Text style={[styles.uploadText, localUri && {color: PIZZA_FIRE.textPrimary}]}>{localUri ? 'Photo Selected ✓' : 'Upload Real Photo'}</Text>
                  </TouchableOpacity>

                  <Text style={styles.orText}>— or pick an icon —</Text>

                  <View style={styles.iconGrid}>
                    {avatarOptions.map((avatar) => (
                      <TouchableOpacity
                        key={avatar.id}
                        style={[styles.avatarWrapper, selectedAvatar === avatar.id && styles.avatarSelected]}
                        onPress={() => { setSelectedAvatar(avatar.id); setLocalUri(null); }}
                      >
                        <Image source={Avatars[avatar.id]} style={styles.avatarImage} />
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Full Name</Text>
                <TextInput placeholder="e.g. Tony Pepperoni" value={name} onChangeText={setName} style={styles.input} placeholderTextColor="#8F6A48" />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email Address</Text>
                <TextInput placeholder="tony@pizzawala.com" value={email} onChangeText={setEmail} style={styles.input} autoCapitalize="none" keyboardType="email-address" placeholderTextColor="#8F6A48" />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Password</Text>
                <View style={styles.passwordContainer}>
                  <TextInput placeholder="Min. 6 characters" value={password} onChangeText={setPassword} style={styles.passwordInput} secureTextEntry={!showPassword} placeholderTextColor="#8F6A48" />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
                    {showPassword ? <Icons.eyeOff color="#fff" width={20} height={20} /> : <Icons.eye color="#fff" width={20} height={20} />}
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity style={styles.button} onPress={handleCreateAccount} disabled={isLoading}>
                {isLoading ? <ActivityIndicator color={PIZZA_FIRE.textPrimary} /> : <Text style={styles.buttonText}>Join the Team</Text>}
              </TouchableOpacity>

              <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
                <Text style={styles.backButtonText}>Already have an account? <Text style={styles.underline}>Log in</Text></Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
    </PizzaFireScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContainer: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20, paddingVertical: 60 },
  card: { width: '100%', maxWidth: 380, backgroundColor: PIZZA_FIRE.surfaceInset, paddingHorizontal: 24, paddingVertical: 32, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: PIZZA_FIRE.qlBorder },
  homeButton: { alignSelf: 'flex-start', marginBottom: 16, backgroundColor: PIZZA_FIRE.inputBg, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, marginTop: -8 },
  homeButtonContent: { flexDirection: 'row', alignItems: 'center' },
  homeButtonText: { fontSize: 13, color: PIZZA_FIRE.textSecondary, fontWeight: '600', marginLeft: 6 },
  title: { fontSize: 26, fontWeight: '900', color: PIZZA_FIRE.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 15, color: PIZZA_FIRE.textSecondary, marginBottom: 24, textAlign: 'center' },
  avatarSection: { width: '100%', marginBottom: 20, alignItems: 'center' },
  avatarGrid: { width: '100%', alignItems: 'center' },
  uploadPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: PIZZA_FIRE.inputBg, padding: 10, borderRadius: 40, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder, marginBottom: 12, width: '100%', justifyContent: 'center' },
  avatarSelectedPill: { borderColor: PIZZA_FIRE.accent, backgroundColor: PIZZA_FIRE.accentSoft },
  cameraIconBg: { backgroundColor: PIZZA_FIRE.inputBg, padding: 10, borderRadius: 20, marginRight: 12 },
  customPreview: { width: 44, height: 44, borderRadius: 22, marginRight: 12, borderWidth: 2, borderColor: PIZZA_FIRE.accent },
  uploadText: { color: PIZZA_FIRE.accent, fontWeight: 'bold', fontSize: 15 },
  orText: { color: PIZZA_FIRE.textMuted, fontSize: 11, fontWeight: '900', marginVertical: 12, textTransform: 'uppercase' },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  avatarWrapper: { width: 50, height: 50, borderRadius: 25, backgroundColor: PIZZA_FIRE.inputBg, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'transparent' },
  avatarImage: { width: 36, height: 36 },
  avatarSelected: { borderColor: PIZZA_FIRE.accent, backgroundColor: PIZZA_FIRE.accent },
  inputGroup: { width: '100%', marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '800', color: PIZZA_FIRE.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 },
  input: { width: '100%', backgroundColor: PIZZA_FIRE.inputBg, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, fontSize: 16, color: PIZZA_FIRE.textSecondary },
  passwordContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: PIZZA_FIRE.inputBg, borderRadius: 12, width: '100%' },
  passwordInput: { flex: 1, paddingVertical: 14, paddingHorizontal: 16, fontSize: 16, color: PIZZA_FIRE.textSecondary },
  eyeIcon: { paddingRight: 16 },
  button: { backgroundColor: PIZZA_FIRE.accent, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 10, width: '100%', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 4 },
  buttonText: { fontWeight: '900', fontSize: 16, color: PIZZA_FIRE.textPrimary, textTransform: 'uppercase' },
  backButton: { marginTop: 24 },
  backButtonText: { color: PIZZA_FIRE.textMuted, fontSize: 14, textAlign: 'center' },
  underline: { color: PIZZA_FIRE.accent, fontWeight: 'bold', textDecorationLine: 'underline' },
});
