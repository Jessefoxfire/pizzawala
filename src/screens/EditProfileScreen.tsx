import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Image,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, getDoc, getFirestore, setDoc, serverTimestamp } from '@react-native-firebase/firestore';
import { auth, uploadStorageRef, uploadStorageRefFallback } from '../services/firebase';
import { launchImageLibrary } from 'react-native-image-picker';
import { resolveAvatarSource } from '../utils/avatar';
import { Icons } from '../components/Icons';
import { Avatars, type AvatarKey } from '../../assets/avatars';
import { ensureImagePickerPermission } from '../utils/imagePickerPermissions';
import { putFileAndGetDownloadUrl } from '../utils/storageUpload';

const avatarOptions: { id: AvatarKey }[] = Object.keys(Avatars).map(key => ({
  id: key as AvatarKey,
}));
const DEBUG_TAG = '[EditProfileUploadDebug]';

export default function EditProfileScreen({ navigation }: any) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState<AvatarKey | null>(null);
  const [customAvatarUrl, setCustomAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [avatarModalVisible, setAvatarModalVisible] = useState(false);

  const user = auth.currentUser;

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user?.uid) return;
      try {
        const snap = await getDoc(doc(getFirestore(), 'users', user.uid));
        if (snap.exists()) {
          const data = snap.data();
          setName(data?.name || '');
          setEmail(data?.email || '');
          setSelectedAvatar((data?.avatarUrl as AvatarKey) || 'pizzaMaker');
          setCustomAvatarUrl(data?.customAvatarUrl || null);
        } else {
          setName(user.displayName || '');
          setEmail(user.email || '');
          setSelectedAvatar('pizzaMaker');
          setCustomAvatarUrl(null);
        }
      } catch (err: any) {
        const msg = err?.message || err?.code || 'Failed to load profile';
        Alert.alert('Error', String(msg));
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, [user?.uid]);

  const handlePickCustomPhoto = async () => {
    const hasPermission = await ensureImagePickerPermission('library');
    if (!hasPermission) {
      return;
    }

    const options: any = { mediaType: 'photo', quality: 0.7, maxWidth: 800, maxHeight: 800 };
    try {
      const result = await launchImageLibrary(options);
      if (result.errorCode) {
        Alert.alert('Photo', result.errorMessage || result.errorCode);
        return;
      }
      if (result.didCancel) return;

      const asset = result.assets?.[0];
      const uri = asset?.uri || asset?.originalPath;
      if (!uri) {
        Alert.alert('Photo', 'Could not read the selected image.');
        return;
      }

      setUploadingPhoto(true);
      const storagePath = `users/${user?.uid}/photos/profile-${Date.now()}.jpg`;
      console.log(`${DEBUG_TAG} start`, {
        uid: user?.uid,
        storagePath,
        assetType: asset?.type,
        uriScheme: uri.split(':')[0],
      });
      const reference = uploadStorageRef(storagePath);
      const mime =
        typeof asset?.type === 'string' && asset.type.startsWith('image/')
          ? asset.type
          : 'image/jpeg';

      const downloadUrl = await putFileAndGetDownloadUrl(reference, uri, { contentType: mime }, {
        fallbackReference: () => uploadStorageRefFallback(storagePath),
      });
      console.log(`${DEBUG_TAG} upload-success`, { storagePath, downloadUrl });
      setCustomAvatarUrl(downloadUrl);
      setSelectedAvatar(null);
      if (user?.uid) {
        // Persist immediately so Home reflects the new avatar even before tapping Save.
        await setDoc(
          doc(getFirestore(), 'users', user.uid),
          {
            customAvatarUrl: downloadUrl,
            avatarUrl: null,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        console.log(`${DEBUG_TAG} firestore-updated`, { uid: user.uid, customAvatarUrl: downloadUrl });
      }
      setAvatarModalVisible(false);
    } catch (err: any) {
      console.error('Profile photo upload:', err);
      Alert.alert('Upload Failed', err?.message || 'Could not upload photo');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSave = async () => {
    if (!user?.uid || saving) return;
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName || !trimmedEmail || (!selectedAvatar && !customAvatarUrl)) {
      Alert.alert('Notice', 'Please fill in all fields and select an avatar.');
      return;
    }

    setSaving(true);
    try {
      await setDoc(
        doc(getFirestore(), 'users', user.uid),
        {
          uid: user.uid,
          name: trimmedName,
          email: trimmedEmail,
          avatarUrl: selectedAvatar,
          customAvatarUrl: customAvatarUrl,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setAvatarModalVisible(false);
      navigation.goBack();
    } catch (err: any) {
      console.error('Edit profile save:', err);
      Alert.alert('Error', err?.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}><ActivityIndicator size="large" color="#C9782B" /></View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icons.arrowLeft color="#F6EDE2" width={24} height={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <TouchableOpacity onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color="#C9782B" /> : <Text style={styles.saveText}>Save</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.avatarSection}>
          <TouchableOpacity style={styles.mainAvatarContainer} onPress={() => setAvatarModalVisible(true)}>
            <Image 
              source={resolveAvatarSource(selectedAvatar, customAvatarUrl)} 
              style={styles.mainAvatar} 
            />
            <View style={styles.editOverlay}>
              <Icons.camera color="#F6EDE2" width={20} height={20} />
            </View>
          </TouchableOpacity>
          <Text style={styles.avatarLabel}>Tap to change identity</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Full Name</Text>
            <TextInput 
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor="#8F6A48"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email Address</Text>
            <TextInput 
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="email@pizzawala.com"
              placeholderTextColor="#8F6A48"
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>
        </View>
      </ScrollView>

      <Modal visible={avatarModalVisible} animationType="slide" transparent>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose Identity</Text>
              <TouchableOpacity onPress={() => setAvatarModalVisible(false)}>
                <Text style={styles.closeText}>Close</Text>
              </TouchableOpacity>
            </View>

            <ScrollView>
              <TouchableOpacity 
                style={styles.customUploadOption} 
                onPress={handlePickCustomPhoto}
                disabled={uploadingPhoto}
              >
                {uploadingPhoto ? (
                  <ActivityIndicator color="#C9782B" />
                ) : (
                  <>
                    <View style={styles.uploadIconCircle}>
                      <Icons.camera color="#C9782B" width={24} height={24} />
                    </View>
                    <View>
                      <Text style={styles.uploadTitle}>Upload Real Photo</Text>
                      <Text style={styles.uploadSub}>Use a picture from your gallery</Text>
                    </View>
                  </>
                )}
              </TouchableOpacity>

              <Text style={styles.modalSectionLabel}>OR PICK AN ICON</Text>
              
              <View style={styles.avatarGrid}>
                {avatarOptions.map((opt) => (
                  <TouchableOpacity 
                    key={opt.id}
                    style={[styles.avatarChoice, selectedAvatar === opt.id && styles.avatarChoiceSelected]}
                    onPress={() => {
                      setSelectedAvatar(opt.id);
                      setCustomAvatarUrl(null);
                      setAvatarModalVisible(false);
                    }}
                  >
                    <Image source={Avatars[opt.id]} style={styles.choiceImage} />
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1E1813' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1E1813' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#3A2D24' },
  headerTitle: { fontSize: 20, fontWeight: '900', color: '#F6EDE2' },
  saveText: { color: '#C9782B', fontSize: 16, fontWeight: '900' },
  scrollContent: { padding: 24 },
  avatarSection: { alignItems: 'center', marginBottom: 32 },
  mainAvatarContainer: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#3A2D24', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  mainAvatar: { width: '100%', height: '100%' },
  editOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)', paddingVertical: 4, alignItems: 'center' },
  avatarLabel: { color: '#A88E73', fontSize: 13, marginTop: 12, fontWeight: '600' },
  form: { gap: 20 },
  inputGroup: { gap: 8 },
  label: { color: '#A88E73', fontSize: 12, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
  input: { backgroundColor: '#3A2D24', borderRadius: 12, padding: 16, color: '#F6EDE2', fontSize: 16 },
  modalContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1E1813', borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 24, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalTitle: { color: '#F6EDE2', fontSize: 18, fontWeight: '900' },
  closeText: { color: '#A88E73', fontWeight: '600' },
  customUploadOption: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#3A2D24', padding: 16, borderRadius: 16, marginBottom: 24 },
  uploadIconCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#1E1813', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  uploadTitle: { color: '#F6EDE2', fontSize: 16, fontWeight: '700' },
  uploadSub: { color: '#A88E73', fontSize: 12 },
  modalSectionLabel: { color: '#3A2D24', fontSize: 11, fontWeight: '900', letterSpacing: 1, marginBottom: 16 },
  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  avatarChoice: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#3A2D24', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'transparent' },
  avatarChoiceSelected: { borderColor: '#C9782B', backgroundColor: '#C9782B' },
  choiceImage: { width: 44, height: 44 },
});
