import React, { useEffect, useMemo, useState } from 'react';
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
  Linking,
} from 'react-native';
import {
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from '@react-native-firebase/firestore';
import { auth, uploadStorageRef, uploadStorageRefFallback } from '../services/firebase';
import { launchImageLibrary } from 'react-native-image-picker';
import { resolveAvatarSource } from '../utils/avatar';
import { Icons } from '../components/Icons';
import { Avatars, type AvatarKey } from '../../assets/avatars';
import { ensureImagePickerPermission } from '../utils/imagePickerPermissions';
import { putFileAndGetDownloadUrl } from '../utils/storageUpload';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import PizzaFireScreen from '../components/PizzaFireScreen';
import PizzaFireCalendar from '../components/PizzaFireCalendar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/useAuth';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { formatDateTime } from '../services/hygiene';
import { useHygieneCredentialUpload } from '../hooks/useHygieneCredentialUpload';
import PizzaFireButton from '../components/PizzaFireButton';
import {
  CHECKLIST_HELP,
  GERMAN_COMPLIANCE_DOCUMENTS,
  GERMAN_COMPLIANCE_FIELDS,
  GERMAN_COMPLIANCE_INTRO,
  SALUTATION_OPTIONS,
  getMissingComplianceFields,
  getMissingRequiredDocuments,
  getRequiredDocumentTypesForUser,
  readGermanCompliance,
  type GermanComplianceProfile,
  type Salutation,
} from '../constants/germanEmployeeCompliance';

const avatarOptions: { id: AvatarKey }[] = Object.keys(Avatars).map(key => ({
  id: key as AvatarKey,
}));
const DEBUG_TAG = '[EditProfileUploadDebug]';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const padDatePart = (value: number) => String(value).padStart(2, '0');

const localDateKey = (value: Date) =>
  `${value.getFullYear()}-${padDatePart(value.getMonth() + 1)}-${padDatePart(value.getDate())}`;

const monthStartKey = (year: number, month: number) => `${year}-${padDatePart(month)}-01`;

const parseDateKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return { year, month, day };
};

const defaultBirthCalendarMonth = (birthDate: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    const { year, month } = parseDateKey(birthDate);
    return monthStartKey(year, month);
  }
  const fallback = new Date();
  fallback.setFullYear(fallback.getFullYear() - 25);
  return monthStartKey(fallback.getFullYear(), fallback.getMonth() + 1);
};

const formatBirthDate = (birthDate: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return '';
  const { year, month, day } = parseDateKey(birthDate);
  return `${padDatePart(day)}.${padDatePart(month)}.${year}`;
};

const emptyCompliance = (): GermanComplianceProfile => ({
  salutation: '',
  address: '',
  birthDate: '',
  birthPlace: '',
  socialSecurityNumber: '',
  taxIdNumber: '',
});

export default function EditProfileScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'EditProfile'>) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [accountDisabled, setAccountDisabled] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState<AvatarKey | null>(null);
  const [customAvatarUrl, setCustomAvatarUrl] = useState<string | null>(null);
  const [compliance, setCompliance] = useState<GermanComplianceProfile>(emptyCompliance);
  const [extraRequiredDocuments, setExtraRequiredDocuments] = useState<string[]>([]);
  const [credentials, setCredentials] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingDocType, setUploadingDocType] = useState<string | null>(null);
  const [avatarModalVisible, setAvatarModalVisible] = useState(false);
  const [birthDatePickerVisible, setBirthDatePickerVisible] = useState(false);
  const [birthPickerView, setBirthPickerView] = useState<'day' | 'month'>('day');
  const [birthCalendarMonth, setBirthCalendarMonth] = useState(() => defaultBirthCalendarMonth(''));
  const [birthPickerYear, setBirthPickerYear] = useState(() => new Date().getFullYear() - 25);

  const birthDateMax = localDateKey(new Date());
  const birthDateMin = '1920-01-01';

  const openBirthDatePicker = () => {
    const monthKey = defaultBirthCalendarMonth(compliance.birthDate || '');
    setBirthCalendarMonth(monthKey);
    setBirthPickerYear(parseDateKey(monthKey).year);
    setBirthPickerView('day');
    setBirthDatePickerVisible(true);
  };

  const selectBirthPickerMonth = (month: number) => {
    setBirthCalendarMonth(monthStartKey(birthPickerYear, month));
    setBirthPickerView('day');
  };

  const isBirthMonthDisabled = (year: number, month: number) => {
    const today = new Date();
    if (year > today.getFullYear()) return true;
    if (year === today.getFullYear() && month > today.getMonth() + 1) return true;
    if (year < 1920) return true;
    return false;
  };

  const { pickAndUpload, nameConfirmModal, sourcePickerModal, isUploading: isUploadingDoc } = useHygieneCredentialUpload();
  const user = auth.currentUser;
  const authState = useAuth();
  const profileUserId = route.params?.userId || user?.uid || null;
  const isSelf = Boolean(profileUserId && user?.uid && profileUserId === user.uid);
  const isAdmin = authState.status === 'admin';
  const canViewHours = isSelf || isAdmin;
  const canViewDocuments = isSelf || isAdmin;

  const requiredDocumentTypes = useMemo(
    () => getRequiredDocumentTypesForUser(extraRequiredDocuments),
    [extraRequiredDocuments]
  );

  const missingFields = useMemo(() => getMissingComplianceFields(compliance), [compliance]);
  const missingDocuments = useMemo(
    () => getMissingRequiredDocuments(requiredDocumentTypes, credentials),
    [requiredDocumentTypes, credentials]
  );

  const uploadsByDocType = useMemo(() => {
    const map = new Map<string, any>();
    credentials.forEach(item => {
      const docType = String(item.requiredDocumentType || '').trim();
      if (!docType) return;
      const existing = map.get(docType);
      if (!existing) {
        map.set(docType, item);
        return;
      }
      const existingMs = new Date(existing.uploadedAtIso || 0).getTime();
      const nextMs = new Date(item.uploadedAtIso || 0).getTime();
      if (nextMs > existingMs) map.set(docType, item);
    });
    return map;
  }, [credentials]);

  useEffect(() => {
    if (!canViewDocuments || !profileUserId) return undefined;

    const fs = getFirestore();
    const unsubCredentials = onSnapshot(
      query(collection(fs, 'hygieneCredentials'), where('employeeUid', '==', profileUserId)),
      snap => {
        const items = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        items.sort((a: any, b: any) => {
          const aMs = new Date(a.uploadedAtIso || 0).getTime();
          const bMs = new Date(b.uploadedAtIso || 0).getTime();
          return bMs - aMs;
        });
        setCredentials(items);
      }
    );

    return () => unsubCredentials();
  }, [canViewDocuments, profileUserId]);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!profileUserId) {
        setLoading(false);
        return;
      }
      try {
        const snap = await getDoc(doc(getFirestore(), 'users', profileUserId));
        if (snap.exists()) {
          const data = snap.data();
          setName(data?.name || route.params?.userName || '');
          setEmail(data?.email || (isSelf ? user?.email || '' : ''));
          setSelectedAvatar((data?.avatarUrl as AvatarKey) || 'pizzaMaker');
          setCustomAvatarUrl(data?.customAvatarUrl || null);
          setRoles(Array.isArray(data?.roles) ? data.roles.map((value: unknown) => String(value)) : []);
          setAccountDisabled(Boolean(data?.disabled));
          if (isSelf || isAdmin) {
            setExtraRequiredDocuments(
              Array.isArray(data?.requiredDocuments)
                ? data.requiredDocuments.map((value: unknown) => String(value || '').trim()).filter(Boolean)
                : []
            );
          } else {
            setExtraRequiredDocuments([]);
          }
          if (isSelf || isAdmin) {
            setCompliance(readGermanCompliance(data));
          } else {
            setCompliance(emptyCompliance());
          }
        } else {
          setName(isSelf ? user?.displayName || '' : route.params?.userName || '');
          setEmail(isSelf ? user?.email || '' : '');
          setSelectedAvatar('pizzaMaker');
          setCustomAvatarUrl(null);
          setCompliance(emptyCompliance());
          setExtraRequiredDocuments([]);
        }
      } catch (err: any) {
        const msg = err?.message || err?.code || 'Failed to load profile';
        Alert.alert('Error', String(msg));
      } finally {
        setLoading(false);
      }
    };
    void fetchProfile();
  }, [profileUserId, isSelf, isAdmin, user?.displayName, user?.email, route.params?.userName]);

  const updateCompliance = (key: keyof GermanComplianceProfile, value: string) => {
    setCompliance(current => ({ ...current, [key]: value }));
  };

  const handlePickCustomPhoto = async () => {
    const hasPermission = await ensureImagePickerPermission('library');
    if (!hasPermission) return;

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
      setCustomAvatarUrl(downloadUrl);
      setSelectedAvatar(null);
      if (user?.uid) {
        await setDoc(
          doc(getFirestore(), 'users', user.uid),
          {
            customAvatarUrl: downloadUrl,
            avatarUrl: null,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      setAvatarModalVisible(false);
    } catch (err: any) {
      console.error('Profile photo upload:', err);
      Alert.alert('Upload Failed', err?.message || 'Could not upload photo');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleUploadDocument = async (docType: string) => {
    if (!user?.uid || uploadingDocType || isUploadingDoc) return;
    setUploadingDocType(docType);
    try {
      const uploaded = await pickAndUpload(undefined, {
        requiredDocumentType: docType,
        documentCategory: 'required_user_document',
      });
      if (!uploaded) return;
      Alert.alert('Uploaded', `${docType} uploaded successfully.`);
    } catch (error: any) {
      Alert.alert('Upload failed', error?.message || 'Could not upload document.');
    } finally {
      setUploadingDocType(null);
    }
  };

  const handleSave = async () => {
    if (!isSelf || !user?.uid || saving) return;
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName || !trimmedEmail) {
      Alert.alert('Notice', 'Please fill in your name and email.');
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
          germanCompliance: {
            salutation: compliance.salutation || '',
            address: String(compliance.address || '').trim(),
            birthDate: String(compliance.birthDate || '').trim(),
            birthPlace: String(compliance.birthPlace || '').trim(),
            socialSecurityNumber: String(compliance.socialSecurityNumber || '').trim(),
            taxIdNumber: String(compliance.taxIdNumber || '').trim(),
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setAvatarModalVisible(false);

      if (missingFields.length > 0 || missingDocuments.length > 0) {
        Alert.alert(
          'Profile saved',
          `Still missing: ${missingFields.length} detail${missingFields.length === 1 ? '' : 's'} and ${missingDocuments.length} document${missingDocuments.length === 1 ? '' : 's'}.`
        );
      } else {
        navigation.goBack();
      }
    } catch (err: any) {
      console.error('Edit profile save:', err);
      Alert.alert('Error', err?.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const openHours = () => {
    if (!profileUserId || !canViewHours) return;
    if (isSelf) {
      navigation.navigate('WorkingHours');
      return;
    }
    navigation.navigate('WorkingHours', {
      employeeUserId: profileUserId,
      employeeName: name || route.params?.userName,
    });
  };

  const showChecklistHelp = () => {
    Alert.alert('Signed checklist', CHECKLIST_HELP);
  };

  if (loading) {
    return (
      <PizzaFireScreen>
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={PIZZA_FIRE.accent} />
      </View>
      </PizzaFireScreen>
    );
  }

  const complianceComplete = missingFields.length === 0 && missingDocuments.length === 0;

  return (
    <PizzaFireScreen>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Icons.arrowLeft color={PIZZA_FIRE.gold} width={24} height={24} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isSelf ? 'Edit Profile' : name || 'Profile'}</Text>
          {isSelf ? (
          <TouchableOpacity onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color={PIZZA_FIRE.accent} /> : <Text style={styles.saveText}>Save</Text>}
          </TouchableOpacity>
          ) : (
            <View style={{ width: 48 }} />
          )}
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.avatarSection}>
            <TouchableOpacity
              style={styles.mainAvatarContainer}
              onPress={() => isSelf && setAvatarModalVisible(true)}
              disabled={!isSelf}
              activeOpacity={isSelf ? 0.8 : 1}
            >
              <Image source={resolveAvatarSource(selectedAvatar, customAvatarUrl)} style={styles.mainAvatar} />
              {isSelf ? (
              <View style={styles.editOverlay}>
                <Icons.camera color={PIZZA_FIRE.textPrimary} width={20} height={20} />
              </View>
              ) : null}
            </TouchableOpacity>
            <Text style={styles.avatarLabel}>{isSelf ? 'Tap to change identity' : name || 'Team member'}</Text>
            {canViewHours ? (
              <PizzaFireButton
                label="Hours"
                variant="primary"
                onPress={openHours}
                style={styles.hoursBtn}
                textStyle={styles.hoursBtnText}
              />
            ) : null}
          </View>

          {!isSelf ? (
            <View style={styles.form}>
              <View style={styles.complianceIntroCard}>
                <Text style={styles.label}>Full name</Text>
                <Text style={styles.metaValue}>{name || '—'}</Text>
                <Text style={[styles.label, { marginTop: 14 }]}>Email</Text>
                <Text style={styles.metaValue}>{email || 'Not available'}</Text>
                <Text style={[styles.label, { marginTop: 14 }]}>Role</Text>
                <Text style={styles.metaValue}>
                  {roles.includes('admin') ? 'Admin' : 'Member'}
                  {accountDisabled ? ' • Disabled' : ''}
                </Text>
                <Text style={[styles.label, { marginTop: 14 }]}>Title</Text>
                <Text style={styles.metaValue}>{compliance.salutation || '—'}</Text>
                {GERMAN_COMPLIANCE_FIELDS.map(field => (
                  <React.Fragment key={field.key}>
                    <Text style={[styles.label, { marginTop: 14 }]}>{field.label}</Text>
                    <Text style={styles.metaValue}>
                      {field.key === 'birthDate' ? formatBirthDate(String(compliance.birthDate || '')) || '—' : String(compliance[field.key] || '').trim() || '—'}
                    </Text>
                  </React.Fragment>
                ))}
              </View>
              {canViewDocuments ? (
                <>
                  <Text style={styles.sectionHeading}>Documents</Text>
                  <Text style={styles.complianceIntroText}>
                    {requiredDocumentTypes.length
                      ? `${missingDocuments.length} missing of ${requiredDocumentTypes.length} required.`
                      : 'No extra document types assigned.'}
                  </Text>
                  {GERMAN_COMPLIANCE_DOCUMENTS.map(doc => {
                    const upload = uploadsByDocType.get(doc.type);
                    const complete = !!upload;
                    const required = doc.required;
                    return (
                      <View key={doc.type} style={[styles.docCard, complete ? styles.docCardComplete : required ? styles.docCardMissing : null]}>
                        <Text style={styles.docTitle}>{doc.type}</Text>
                        <Text style={[styles.docStatus, complete ? styles.docStatusComplete : required ? styles.docStatusMissing : styles.docStatusOptional]}>
                          {complete ? 'Uploaded' : required ? 'Missing' : 'Optional'}
                        </Text>
                        {upload ? (
                          <View style={styles.uploadMetaCard}>
                            <Text style={styles.uploadMetaText}>{upload.fileName || 'Document'}</Text>
                            {upload.downloadUrl ? (
                              <TouchableOpacity onPress={() => void Linking.openURL(String(upload.downloadUrl))}>
                                <Text style={styles.linkText}>Open uploaded file</Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                  {extraRequiredDocuments
                    .filter(docType => !GERMAN_COMPLIANCE_DOCUMENTS.some(doc => doc.type === docType))
                    .map(docType => {
                      const upload = uploadsByDocType.get(docType);
                      const complete = !!upload;
                      return (
                        <View key={docType} style={[styles.docCard, complete ? styles.docCardComplete : styles.docCardMissing]}>
                          <Text style={styles.docTitle}>{docType}</Text>
                          <Text style={[styles.docStatus, complete ? styles.docStatusComplete : styles.docStatusMissing]}>
                            {complete ? 'Uploaded' : 'Missing'}
                          </Text>
                          {upload?.downloadUrl ? (
                            <TouchableOpacity onPress={() => void Linking.openURL(String(upload.downloadUrl))}>
                              <Text style={styles.linkText}>Open uploaded file</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      );
                    })}
                </>
              ) : (
                <Text style={styles.avatarLabel}>Employment documents are only visible to admins and the account owner.</Text>
              )}
            </View>
          ) : null}

          {isSelf ? (
          <>
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

          {!complianceComplete ? (
            <View style={styles.complianceIntroCard}>
              <Text style={styles.complianceIntroTitle}>Employment records (Germany)</Text>
              <Text style={styles.complianceIntroText}>{GERMAN_COMPLIANCE_INTRO}</Text>
              <Text style={[styles.complianceStatus, styles.complianceStatusPending]}>
                {missingFields.length} detail{missingFields.length === 1 ? '' : 's'} and {missingDocuments.length} document{missingDocuments.length === 1 ? '' : 's'} still needed.
              </Text>
            </View>
          ) : null}

          <Text style={styles.sectionHeading}>Personal details</Text>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Title</Text>
            <View style={styles.salutationRow}>
              {SALUTATION_OPTIONS.map(option => {
                const active = compliance.salutation === option;
                return (
                  <TouchableOpacity
                    key={option}
                    style={[styles.salutationPill, active && styles.salutationPillActive]}
                    onPress={() => updateCompliance('salutation', option as Salutation)}
                  >
                    <Text style={[styles.salutationText, active && styles.salutationTextActive]}>{option}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {GERMAN_COMPLIANCE_FIELDS.map(field => {
            if (field.key === 'birthDate') {
              return (
                <View key={field.key} style={styles.inputGroup}>
                  <Text style={styles.label}>{field.label}</Text>
                  <TouchableOpacity style={styles.dateButton} onPress={openBirthDatePicker}>
                    <Text style={styles.dateButtonText}>{formatBirthDate(compliance.birthDate || '') || field.placeholder}</Text>
                  </TouchableOpacity>
                </View>
              );
            }
            return (
              <View key={field.key} style={styles.inputGroup}>
                <Text style={styles.label}>{field.label}</Text>
                <TextInput
                  style={[styles.input, field.multiline && styles.inputMultiline]}
                  value={String(compliance[field.key] || '')}
                  onChangeText={value => updateCompliance(field.key, value)}
                  placeholder={field.placeholder}
                  placeholderTextColor="#8F6A48"
                  multiline={field.multiline}
                  autoCapitalize={field.autoCapitalize || 'sentences'}
                  keyboardType={field.keyboardType || 'default'}
                />
              </View>
            );
          })}

          <Text style={styles.sectionHeading}>Required uploads</Text>
          {GERMAN_COMPLIANCE_DOCUMENTS.map(doc => {
            const upload = uploadsByDocType.get(doc.type);
            const complete = !!upload;
            const busy = uploadingDocType === doc.type;
            const required = doc.required;
            return (
              <View key={doc.type} style={[styles.docCard, complete ? styles.docCardComplete : required ? styles.docCardMissing : null]}>
                <View style={styles.docHeader}>
                  <View style={styles.docHeaderText}>
                    <Text style={styles.docTitle}>{doc.type}</Text>
                    <Text style={[styles.docStatus, complete ? styles.docStatusComplete : required ? styles.docStatusMissing : styles.docStatusOptional]}>
                      {complete ? 'Uploaded' : required ? 'Missing' : 'Optional'}
                    </Text>
                  </View>
                  {doc.helpTitle ? (
                    <TouchableOpacity style={styles.helpButton} onPress={showChecklistHelp}>
                      <Text style={styles.helpButtonText}>?</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {upload ? (
                  <View style={styles.uploadMetaCard}>
                    <Text style={styles.uploadMetaText}>{upload.fileName || 'Document'}</Text>
                    <Text style={styles.uploadMetaText}>
                      Uploaded {formatDateTime(upload.uploadedAt, upload.uploadedAtIso)}
                    </Text>
                    {upload.downloadUrl ? (
                      <TouchableOpacity onPress={() => void Linking.openURL(String(upload.downloadUrl))}>
                        <Text style={styles.linkText}>Open uploaded file</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : (
                  <Text style={styles.missingHelp}>Please upload a clear photo or PDF of this document.</Text>
                )}

                <TouchableOpacity
                  style={[styles.uploadButton, busy && styles.uploadButtonDisabled]}
                  onPress={() => void handleUploadDocument(doc.type)}
                  disabled={busy || isUploadingDoc}
                >
                  {busy ? (
                    <ActivityIndicator color={PIZZA_FIRE.charcoal} />
                  ) : (
                    <Text style={styles.uploadButtonText}>{complete ? 'Replace upload' : 'Upload / photograph'}</Text>
                  )}
                </TouchableOpacity>
              </View>
            );
          })}

          {extraRequiredDocuments
            .filter(docType => !GERMAN_COMPLIANCE_DOCUMENTS.some(doc => doc.type === docType))
            .map(docType => {
              const upload = uploadsByDocType.get(docType);
              const complete = !!upload;
              const busy = uploadingDocType === docType;
              return (
                <View key={docType} style={[styles.docCard, complete ? styles.docCardComplete : styles.docCardMissing]}>
                  <View style={styles.docHeader}>
                    <View style={styles.docHeaderText}>
                      <Text style={styles.docTitle}>{docType}</Text>
                      <Text style={[styles.docStatus, complete ? styles.docStatusComplete : styles.docStatusMissing]}>
                        {complete ? 'Uploaded' : 'Missing'}
                      </Text>
                    </View>
                  </View>
                  {upload ? (
                    <View style={styles.uploadMetaCard}>
                      <Text style={styles.uploadMetaText}>{upload.fileName || 'Document'}</Text>
                      {upload.downloadUrl ? (
                        <TouchableOpacity onPress={() => void Linking.openURL(String(upload.downloadUrl))}>
                          <Text style={styles.linkText}>Open uploaded file</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ) : null}
                  <TouchableOpacity
                    style={[styles.uploadButton, busy && styles.uploadButtonDisabled]}
                    onPress={() => void handleUploadDocument(docType)}
                    disabled={busy || isUploadingDoc}
                  >
                    {busy ? (
                      <ActivityIndicator color={PIZZA_FIRE.charcoal} />
                    ) : (
                      <Text style={styles.uploadButtonText}>{complete ? 'Replace upload' : 'Upload / photograph'}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })}
          </>
          ) : null}
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
                    <ActivityIndicator color={PIZZA_FIRE.accent} />
                  ) : (
                    <>
                      <View style={styles.uploadIconCircle}>
                        <Icons.camera color={PIZZA_FIRE.accent} width={24} height={24} />
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
                  {avatarOptions.map(opt => (
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

        <Modal visible={birthDatePickerVisible} transparent animationType="fade">
          <View style={styles.modalContainerCenter}>
            <View style={styles.calendarCard}>
              <Text style={styles.calendarTitle}>
                {birthPickerView === 'month' ? 'Select month' : 'Select birth date'}
              </Text>

              {birthPickerView === 'month' ? (
                <>
                  <View style={styles.monthPickerHeader}>
                    <TouchableOpacity
                      style={styles.monthPickerArrow}
                      onPress={() => setBirthPickerYear(year => year - 1)}
                      accessibilityLabel="Previous year"
                    >
                      <Text style={styles.monthPickerArrowText}>‹</Text>
                    </TouchableOpacity>
                    <Text style={styles.monthPickerYear}>{birthPickerYear}</Text>
                    <TouchableOpacity
                      style={styles.monthPickerArrow}
                      onPress={() => setBirthPickerYear(year => year + 1)}
                      accessibilityLabel="Next year"
                    >
                      <Text style={styles.monthPickerArrowText}>›</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.monthGrid}>
                    {MONTH_LABELS.map((label, index) => {
                      const month = index + 1;
                      const disabled = isBirthMonthDisabled(birthPickerYear, month);
                      const selected =
                        compliance.birthDate &&
                        parseDateKey(compliance.birthDate).year === birthPickerYear &&
                        parseDateKey(compliance.birthDate).month === month;
                      const current =
                        parseDateKey(birthCalendarMonth).year === birthPickerYear &&
                        parseDateKey(birthCalendarMonth).month === month;
                      return (
                        <TouchableOpacity
                          key={label}
                          style={[
                            styles.monthCell,
                            current && styles.monthCellCurrent,
                            selected && styles.monthCellSelected,
                            disabled && styles.monthCellDisabled,
                          ]}
                          onPress={() => !disabled && selectBirthPickerMonth(month)}
                          disabled={disabled}
                        >
                          <Text
                            style={[
                              styles.monthCellText,
                              (current || selected) && styles.monthCellTextActive,
                              disabled && styles.monthCellTextDisabled,
                            ]}
                          >
                            {label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <TouchableOpacity style={styles.monthPickerBackBtn} onPress={() => setBirthPickerView('day')}>
                    <Text style={styles.monthPickerBackText}>Back to days</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <PizzaFireCalendar
                  current={birthCalendarMonth}
                  minDate={birthDateMin}
                  maxDate={birthDateMax}
                  onMonthChange={day => setBirthCalendarMonth(monthStartKey(day.year, day.month))}
                  onMonthTitlePress={() => {
                    setBirthPickerYear(parseDateKey(birthCalendarMonth).year);
                    setBirthPickerView('month');
                  }}
                  theme={{
                    backgroundColor: PIZZA_FIRE.surfaceInset,
                    calendarBackground: 'transparent',
                    selectedDayBackgroundColor: PIZZA_FIRE.accent,
                    dayTextColor: '#F6EDE2',
                    monthTextColor: '#F6EDE2',
                    textDisabledColor: '#3A2D24',
                    arrowColor: PIZZA_FIRE.accent,
                  }}
                  onDayPress={(day: { dateString: string }) => {
                    updateCompliance('birthDate', day.dateString);
                    setBirthDatePickerVisible(false);
                    setBirthPickerView('day');
                  }}
                  markedDates={
                    compliance.birthDate
                      ? { [compliance.birthDate]: { selected: true, selectedColor: PIZZA_FIRE.accent } }
                      : {}
                  }
                />
              )}

              <TouchableOpacity
                style={styles.closeCalendarBtn}
                onPress={() => {
                  setBirthDatePickerVisible(false);
                  setBirthPickerView('day');
                }}
              >
                <Text style={styles.closeCalendarBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
      {nameConfirmModal}
      {sourcePickerModal}
    </PizzaFireScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: PIZZA_FIRE.divider,
  },
  headerTitle: { fontSize: 20, fontWeight: '900', color: PIZZA_FIRE.textPrimary },
  saveText: { color: PIZZA_FIRE.accent, fontSize: 16, fontWeight: '900' },
  scrollContent: { padding: 24, paddingBottom: 40 },
  avatarSection: { alignItems: 'center', marginBottom: 24 },
  mainAvatarContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: PIZZA_FIRE.inputBg,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  mainAvatar: { width: '100%', height: '100%' },
  editOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 4,
    alignItems: 'center',
  },
  avatarLabel: { color: PIZZA_FIRE.textMuted, fontSize: 13, marginTop: 12, fontWeight: '600' },
  hoursBtn: {
    marginTop: 16,
    minWidth: 160,
    paddingHorizontal: 28,
  },
  hoursBtnText: {
    fontSize: 16,
    letterSpacing: 0.4,
  },
  metaValue: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
  },
  form: { gap: 20, marginBottom: 24 },
  inputGroup: { gap: 8, marginBottom: 14 },
  label: { color: PIZZA_FIRE.textMuted, fontSize: 12, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
  input: { backgroundColor: PIZZA_FIRE.inputBg, borderRadius: 12, padding: 16, color: PIZZA_FIRE.textPrimary, fontSize: 16 },
  inputMultiline: { minHeight: 88, textAlignVertical: 'top' },
  sectionHeading: { color: PIZZA_FIRE.textPrimary, fontSize: 18, fontWeight: '900', marginTop: 8, marginBottom: 12 },
  complianceIntroCard: {
    backgroundColor: PIZZA_FIRE.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    marginBottom: 18,
  },
  complianceIntroTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '900', marginBottom: 8 },
  complianceIntroText: { color: PIZZA_FIRE.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 10 },
  complianceStatus: { fontSize: 13, fontWeight: '800' },
  complianceStatusPending: { color: '#E2A14A' },
  salutationRow: { flexDirection: 'row', gap: 10 },
  salutationPill: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: PIZZA_FIRE.inputBg,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  salutationPillActive: { backgroundColor: PIZZA_FIRE.accent, borderColor: PIZZA_FIRE.accent },
  salutationText: { color: PIZZA_FIRE.textMuted, fontWeight: '800' },
  salutationTextActive: { color: PIZZA_FIRE.charcoal },
  dateButton: {
    backgroundColor: PIZZA_FIRE.inputBg,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  dateButtonText: { color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '600' },
  docCard: {
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  docCardComplete: { borderColor: '#45664A' },
  docCardMissing: { borderColor: '#6D4C41' },
  docHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  docHeaderText: { flex: 1 },
  docTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 15, fontWeight: '800', marginBottom: 4 },
  docStatus: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  docStatusComplete: { color: '#9BD1A5' },
  docStatusMissing: { color: '#E2A14A' },
  docStatusOptional: { color: PIZZA_FIRE.textMuted },
  helpButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: PIZZA_FIRE.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PIZZA_FIRE.accent,
  },
  helpButtonText: { color: PIZZA_FIRE.accent, fontWeight: '900' },
  uploadMetaCard: {
    backgroundColor: PIZZA_FIRE.crustDark,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    marginBottom: 10,
  },
  uploadMetaText: { color: PIZZA_FIRE.textSecondary, fontSize: 13, marginBottom: 4 },
  linkText: { color: PIZZA_FIRE.accent, fontSize: 13, fontWeight: '800', marginTop: 4 },
  missingHelp: { color: PIZZA_FIRE.textMuted, fontSize: 13, lineHeight: 18, marginBottom: 10 },
  uploadButton: {
    backgroundColor: PIZZA_FIRE.hotAccent,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PIZZA_FIRE.hotAccentBorder,
  },
  uploadButtonDisabled: { opacity: 0.6 },
  uploadButtonText: { color: PIZZA_FIRE.textPrimary, fontSize: 14, fontWeight: '900' },
  modalContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContainerCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 },
  modalContent: {
    backgroundColor: PIZZA_FIRE.bgMid,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    padding: 24,
    maxHeight: '80%',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 18, fontWeight: '900' },
  closeText: { color: PIZZA_FIRE.textMuted, fontWeight: '600' },
  customUploadOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PIZZA_FIRE.inputBg,
    padding: 16,
    borderRadius: 16,
    marginBottom: 24,
  },
  uploadIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: PIZZA_FIRE.surfaceInset,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  uploadTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '700' },
  uploadSub: { color: PIZZA_FIRE.textMuted, fontSize: 12 },
  modalSectionLabel: { color: PIZZA_FIRE.textMuted, fontSize: 11, fontWeight: '900', letterSpacing: 1, marginBottom: 16 },
  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  avatarChoice: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: PIZZA_FIRE.inputBg,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  avatarChoiceSelected: { borderColor: PIZZA_FIRE.accent, backgroundColor: PIZZA_FIRE.accent },
  choiceImage: { width: 44, height: 44 },
  calendarCard: {
    backgroundColor: PIZZA_FIRE.bgMid,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  calendarTitle: { color: PIZZA_FIRE.accent, fontSize: 14, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
  calendarMonthHeader: {
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 4,
  },
  calendarMonthHeaderText: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  calendarMonthHeaderHint: {
    color: PIZZA_FIRE.accent,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  monthPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  monthPickerArrow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PIZZA_FIRE.surfaceInset,
  },
  monthPickerArrowText: {
    color: PIZZA_FIRE.accent,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 28,
  },
  monthPickerYear: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
  },
  monthCell: {
    width: '30%',
    minWidth: 72,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderWidth: 1.5,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  monthCellCurrent: {
    borderColor: PIZZA_FIRE.accent,
  },
  monthCellSelected: {
    backgroundColor: PIZZA_FIRE.accentSoftStrong,
    borderColor: PIZZA_FIRE.accent,
  },
  monthCellDisabled: {
    opacity: 0.35,
  },
  monthCellText: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  monthCellTextActive: {
    color: PIZZA_FIRE.accent,
    fontWeight: '700',
  },
  monthCellTextDisabled: {
    color: PIZZA_FIRE.textMuted,
  },
  monthPickerBackBtn: {
    marginTop: 14,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  monthPickerBackText: {
    color: PIZZA_FIRE.accent,
    fontWeight: '700',
    fontSize: 14,
  },
  closeCalendarBtn: { marginTop: 12, padding: 10, alignItems: 'center' },
  closeCalendarBtnText: { color: PIZZA_FIRE.accent, fontWeight: 'bold' },
});
