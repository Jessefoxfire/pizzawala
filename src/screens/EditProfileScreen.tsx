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
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { Calendar } from 'react-native-calendars';
import { formatDateTime } from '../services/hygiene';
import { useHygieneCredentialUpload } from '../hooks/useHygieneCredentialUpload';
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

const emptyCompliance = (): GermanComplianceProfile => ({
  salutation: '',
  address: '',
  birthDate: '',
  birthPlace: '',
  socialSecurityNumber: '',
  taxIdNumber: '',
});

export default function EditProfileScreen({ navigation }: any) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
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
    const monthKey = defaultBirthCalendarMonth(compliance.birthDate);
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

  const { pickAndUpload, nameConfirmModal, isUploading: isUploadingDoc } = useHygieneCredentialUpload();
  const user = auth.currentUser;

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
    if (!user?.uid) return undefined;

    const fs = getFirestore();
    const unsubCredentials = onSnapshot(
      query(collection(fs, 'hygieneCredentials'), where('employeeUid', '==', user.uid)),
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
  }, [user?.uid]);

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
          setCompliance(readGermanCompliance(data));
          setExtraRequiredDocuments(
            Array.isArray(data?.requiredDocuments)
              ? data.requiredDocuments.map((value: unknown) => String(value || '').trim()).filter(Boolean)
              : []
          );
        } else {
          setName(user.displayName || '');
          setEmail(user.email || '');
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
  }, [user?.uid]);

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
    if (!user?.uid || saving) return;
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName || !trimmedEmail || (!selectedAvatar && !customAvatarUrl)) {
      Alert.alert('Notice', 'Please fill in your name, email, and choose an avatar.');
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

  const showChecklistHelp = () => {
    Alert.alert('Signed checklist', CHECKLIST_HELP);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#C9782B" />
      </View>
    );
  }

  const complianceComplete = missingFields.length === 0 && missingDocuments.length === 0;

  return (
    <>
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
              <Image source={resolveAvatarSource(selectedAvatar, customAvatarUrl)} style={styles.mainAvatar} />
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

          <View style={styles.complianceIntroCard}>
            <Text style={styles.complianceIntroTitle}>Employment records (Germany)</Text>
            <Text style={styles.complianceIntroText}>{GERMAN_COMPLIANCE_INTRO}</Text>
            <Text style={[styles.complianceStatus, complianceComplete ? styles.complianceStatusComplete : styles.complianceStatusPending]}>
              {complianceComplete
                ? 'All required details and documents are on file.'
                : `${missingFields.length} detail${missingFields.length === 1 ? '' : 's'} and ${missingDocuments.length} document${missingDocuments.length === 1 ? '' : 's'} still needed.`}
            </Text>
          </View>

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
                    <Text style={styles.dateButtonText}>{compliance.birthDate || field.placeholder}</Text>
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
            return (
              <View key={doc.type} style={[styles.docCard, complete ? styles.docCardComplete : styles.docCardMissing]}>
                <View style={styles.docHeader}>
                  <View style={styles.docHeaderText}>
                    <Text style={styles.docTitle}>{doc.type}</Text>
                    <Text style={[styles.docStatus, complete ? styles.docStatusComplete : styles.docStatusMissing]}>
                      {complete ? 'Uploaded' : 'Missing'}
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
                    <ActivityIndicator color="#1E1813" />
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
                      <ActivityIndicator color="#1E1813" />
                    ) : (
                      <Text style={styles.uploadButtonText}>{complete ? 'Replace upload' : 'Upload / photograph'}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })}
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
                <Calendar
                  key={birthCalendarMonth}
                  current={birthCalendarMonth}
                  minDate={birthDateMin}
                  maxDate={birthDateMax}
                  enableSwipeMonths={false}
                  hideArrows
                  renderHeader={(date: { toString: (format: string) => string }) => (
                    <TouchableOpacity
                      style={styles.calendarMonthHeader}
                      onPress={() => {
                        setBirthPickerYear(Number(date.toString('yyyy')));
                        setBirthPickerView('month');
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Open month picker"
                    >
                      <Text style={styles.calendarMonthHeaderText}>{date.toString('MMMM yyyy')}</Text>
                      <Text style={styles.calendarMonthHeaderHint}>Tap to pick month</Text>
                    </TouchableOpacity>
                  )}
                  theme={{
                    backgroundColor: '#1E1813',
                    calendarBackground: '#1E1813',
                    selectedDayBackgroundColor: '#C9782B',
                    dayTextColor: '#F6EDE2',
                    monthTextColor: '#F6EDE2',
                    textDisabledColor: '#3A2D24',
                    arrowColor: '#C9782B',
                  }}
                  onDayPress={(day: { dateString: string }) => {
                    updateCompliance('birthDate', day.dateString);
                    setBirthDatePickerVisible(false);
                    setBirthPickerView('day');
                  }}
                  markedDates={
                    compliance.birthDate
                      ? { [compliance.birthDate]: { selected: true, selectedColor: '#C9782B' } }
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
      </SafeAreaView>
      {nameConfirmModal}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1E1813' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1E1813' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#3A2D24',
  },
  headerTitle: { fontSize: 20, fontWeight: '900', color: '#F6EDE2' },
  saveText: { color: '#C9782B', fontSize: 16, fontWeight: '900' },
  scrollContent: { padding: 24, paddingBottom: 40 },
  avatarSection: { alignItems: 'center', marginBottom: 24 },
  mainAvatarContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#3A2D24',
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
  avatarLabel: { color: '#A88E73', fontSize: 13, marginTop: 12, fontWeight: '600' },
  form: { gap: 20, marginBottom: 24 },
  inputGroup: { gap: 8, marginBottom: 14 },
  label: { color: '#A88E73', fontSize: 12, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
  input: { backgroundColor: '#3A2D24', borderRadius: 12, padding: 16, color: '#F6EDE2', fontSize: 16 },
  inputMultiline: { minHeight: 88, textAlignVertical: 'top' },
  sectionHeading: { color: '#F6EDE2', fontSize: 18, fontWeight: '900', marginTop: 8, marginBottom: 12 },
  complianceIntroCard: {
    backgroundColor: '#2A211B',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#4B382B',
    marginBottom: 18,
  },
  complianceIntroTitle: { color: '#F6EDE2', fontSize: 16, fontWeight: '900', marginBottom: 8 },
  complianceIntroText: { color: '#C8B29A', fontSize: 14, lineHeight: 20, marginBottom: 10 },
  complianceStatus: { fontSize: 13, fontWeight: '800' },
  complianceStatusComplete: { color: '#9BD1A5' },
  complianceStatusPending: { color: '#E2A14A' },
  salutationRow: { flexDirection: 'row', gap: 10 },
  salutationPill: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#3A2D24',
    borderWidth: 1,
    borderColor: '#5A4739',
  },
  salutationPillActive: { backgroundColor: '#C9782B', borderColor: '#C9782B' },
  salutationText: { color: '#A88E73', fontWeight: '800' },
  salutationTextActive: { color: '#1E1813' },
  dateButton: {
    backgroundColor: '#3A2D24',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#5A4739',
  },
  dateButtonText: { color: '#F6EDE2', fontSize: 16, fontWeight: '600' },
  docCard: {
    backgroundColor: '#2A211B',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  docCardComplete: { borderColor: '#45664A' },
  docCardMissing: { borderColor: '#6D4C41' },
  docHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  docHeaderText: { flex: 1 },
  docTitle: { color: '#F6EDE2', fontSize: 15, fontWeight: '800', marginBottom: 4 },
  docStatus: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  docStatusComplete: { color: '#9BD1A5' },
  docStatusMissing: { color: '#E2A14A' },
  helpButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#3A2D24',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#C9782B',
  },
  helpButtonText: { color: '#C9782B', fontWeight: '900' },
  uploadMetaCard: {
    backgroundColor: '#171311',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#3A2D24',
    marginBottom: 10,
  },
  uploadMetaText: { color: '#D6C0AC', fontSize: 13, marginBottom: 4 },
  linkText: { color: '#C9782B', fontSize: 13, fontWeight: '800', marginTop: 4 },
  missingHelp: { color: '#A88E73', fontSize: 13, lineHeight: 18, marginBottom: 10 },
  uploadButton: {
    backgroundColor: '#C9782B',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  uploadButtonDisabled: { opacity: 0.6 },
  uploadButtonText: { color: '#1E1813', fontSize: 14, fontWeight: '900' },
  modalContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContainerCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 },
  modalContent: {
    backgroundColor: '#1E1813',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    padding: 24,
    maxHeight: '80%',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalTitle: { color: '#F6EDE2', fontSize: 18, fontWeight: '900' },
  closeText: { color: '#A88E73', fontWeight: '600' },
  customUploadOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3A2D24',
    padding: 16,
    borderRadius: 16,
    marginBottom: 24,
  },
  uploadIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1E1813',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  uploadTitle: { color: '#F6EDE2', fontSize: 16, fontWeight: '700' },
  uploadSub: { color: '#A88E73', fontSize: 12 },
  modalSectionLabel: { color: '#A88E73', fontSize: 11, fontWeight: '900', letterSpacing: 1, marginBottom: 16 },
  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  avatarChoice: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#3A2D24',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  avatarChoiceSelected: { borderColor: '#C9782B', backgroundColor: '#C9782B' },
  choiceImage: { width: 44, height: 44 },
  calendarCard: {
    backgroundColor: '#1E1813',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
  calendarTitle: { color: '#C9782B', fontSize: 14, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
  calendarMonthHeader: {
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 4,
  },
  calendarMonthHeaderText: {
    color: '#F6EDE2',
    fontSize: 18,
    fontWeight: '700',
  },
  calendarMonthHeaderHint: {
    color: '#C9782B',
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
    backgroundColor: '#2A211B',
  },
  monthPickerArrowText: {
    color: '#C9782B',
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 28,
  },
  monthPickerYear: {
    color: '#F6EDE2',
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
    backgroundColor: '#2A211B',
    borderWidth: 1.5,
    borderColor: '#3A2D24',
  },
  monthCellCurrent: {
    borderColor: '#C9782B',
  },
  monthCellSelected: {
    backgroundColor: 'rgba(201, 120, 43, 0.2)',
    borderColor: '#C9782B',
  },
  monthCellDisabled: {
    opacity: 0.35,
  },
  monthCellText: {
    color: '#F6EDE2',
    fontSize: 14,
    fontWeight: '500',
  },
  monthCellTextActive: {
    color: '#C9782B',
    fontWeight: '700',
  },
  monthCellTextDisabled: {
    color: '#8F6A48',
  },
  monthPickerBackBtn: {
    marginTop: 14,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  monthPickerBackText: {
    color: '#C9782B',
    fontWeight: '700',
    fontSize: 14,
  },
  closeCalendarBtn: { marginTop: 12, padding: 10, alignItems: 'center' },
  closeCalendarBtnText: { color: '#C9782B', fontWeight: 'bold' },
});
