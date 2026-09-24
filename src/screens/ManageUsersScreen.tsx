import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  Switch,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
} from 'react-native';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from '@react-native-firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { resetPassword } from '../services/firebase';
import { deleteHygieneCredential, formatDateTime } from '../services/hygiene';
import { RootStackParamList } from '../navigation/AppNavigator';
import { openUserProfile } from '../navigation/openUserProfile';
import { Icons } from '../components/Icons';
import { useHygieneCredentialUpload } from '../hooks/useHygieneCredentialUpload';
import { getRequiredDocumentTypesForUser } from '../constants/germanEmployeeCompliance';
import type { HygieneEmployeeOverride } from '../utils/hygieneCredentialPicker';
import PizzaFireButton from '../components/PizzaFireButton';
import PizzaFireScreen from '../components/PizzaFireScreen';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import { SHOW_DEBUG_ONLY_OPERATIONS } from '../config/buildFeatures';
import { isPersonnelDocument } from '../utils/personnelDocuments';
import {
  GERMAN_COMPLIANCE_FIELDS,
  SALUTATION_OPTIONS,
  readGermanCompliance,
  type GermanComplianceProfile,
  type Salutation,
} from '../constants/germanEmployeeCompliance';

type Props = NativeStackScreenProps<RootStackParamList, 'ManageUsers'>;

type UserRecord = {
  id: string;
  name?: string;
  email?: string;
  emailLower?: string;
  roles?: string[];
  disabled?: boolean;
  avatarUrl?: string | null;
  lastLocation?: { lat: number; lng: number } | null;
  lastLocationUpdate?: any;
  requiredDocuments?: string[];
  germanCompliance?: GermanComplianceProfile;
};

const DOC_REQUIREMENTS_CONFIG_ID = 'userRequiredDocuments';

const isImageCredential = (fileName: string) => /\.(png|jpe?g|heic|heif|webp)$/i.test(fileName);

export default function ManageUsersScreen({ navigation }: Props) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<UserRecord | null>(null);
  const [editVisible, setEditVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editAdmin, setEditAdmin] = useState(false);
  const [editCompliance, setEditCompliance] = useState<GermanComplianceProfile>({});
  const [saving, setSaving] = useState(false);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [availableDocTypes, setAvailableDocTypes] = useState<string[]>([]);
  const [selectedRequiredDocs, setSelectedRequiredDocs] = useState<string[]>([]);
  const [newDocType, setNewDocType] = useState('');
  const [newDocTypeMemberOnly, setNewDocTypeMemberOnly] = useState(false);
  const [addingDocType, setAddingDocType] = useState(false);
  const [credentials, setCredentials] = useState<any[]>([]);
  const [documentsModalUser, setDocumentsModalUser] = useState<UserRecord | null>(null);
  const [deletingCredentialId, setDeletingCredentialId] = useState<string | null>(null);
  const [deletingDocType, setDeletingDocType] = useState<string | null>(null);
  const [uploadingDocType, setUploadingDocType] = useState<string | null>(null);
  const [uploadTargetUserId, setUploadTargetUserId] = useState<string | null>(null);
  const [expandedUserIds, setExpandedUserIds] = useState<string[]>([]);

  const { pickAndUpload, nameConfirmModal, sourcePickerModal, isUploading: isUploadingDoc } = useHygieneCredentialUpload();

  useEffect(() => {
    const fs = getFirestore();
    setLoadError(null);
    const unsub = onSnapshot(
      collection(fs, 'users'),
      snap => {
        if (!snap || !snap.docs || snap.empty) {
          setUsers([]);
          setLoading(false);
          return;
        }
        const items = snap.docs.map(docSnap => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<UserRecord, 'id'>),
        }));
        setUsers(items);
        setLoading(false);
      },
      err => {
        setLoadError(err?.message || String(err));
        setUsers([]);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  useEffect(() => {
    const fs = getFirestore();
    const unsub = onSnapshot(doc(fs, 'appConfig', DOC_REQUIREMENTS_CONFIG_ID), snap => {
      const next: string[] = snap.exists() && Array.isArray(snap.data()?.options)
        ? (snap.data()?.options as unknown[])
            .map((value: unknown) => String(value || '').trim())
            .filter((value): value is string => Boolean(value))
        : [];
      setAvailableDocTypes(Array.from(new Set(next)).sort((a, b) => a.localeCompare(b)));
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    const fs = getFirestore();
    const unsub = onSnapshot(query(collection(fs, 'hygieneCredentials')), snap => {
      const items = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
      items.sort((a: any, b: any) => {
        const aMs = new Date(a.uploadedAtIso || 0).getTime();
        const bMs = new Date(b.uploadedAtIso || 0).getTime();
        return bMs - aMs;
      });
      setCredentials(items);
    });
    return () => unsub();
  }, []);

  const documentsForModalUser = useMemo(() => {
    if (!documentsModalUser) return [];
    return credentials.filter(
      item => String(item.employeeUid || '') === documentsModalUser.id && isPersonnelDocument(item)
    );
  }, [credentials, documentsModalUser]);

  const uploadsByDocTypeForUser = useCallback(
    (userId: string) => {
      const map = new Map<string, any>();
      credentials
        .filter(item => String(item.employeeUid || '') === userId && isPersonnelDocument(item))
        .forEach(item => {
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
    },
    [credentials]
  );

  const uploadsByDocTypeForSelectedUser = useMemo(
    () => (selected ? uploadsByDocTypeForUser(selected.id) : new Map<string, any>()),
    [selected, uploadsByDocTypeForUser]
  );

  const uploadsByDocTypeForModalUser = useMemo(
    () => (documentsModalUser ? uploadsByDocTypeForUser(documentsModalUser.id) : new Map<string, any>()),
    [documentsModalUser, uploadsByDocTypeForUser]
  );

  const requiredDocTypesForModalUser = useMemo(() => {
    if (!documentsModalUser) return [];
    return getRequiredDocumentTypesForUser(documentsModalUser.requiredDocuments);
  }, [documentsModalUser]);

  const documentTypesForSelectedUser = useMemo(() => {
    const memberOnly = selectedRequiredDocs.filter(docType =>
      !availableDocTypes.some(sharedType => sharedType.toLowerCase() === docType.toLowerCase())
    );
    return Array.from(new Set([
      ...getRequiredDocumentTypesForUser(selectedRequiredDocs),
      ...availableDocTypes,
      ...memberOnly,
    ])).sort((a, b) => a.localeCompare(b));
  }, [availableDocTypes, selectedRequiredDocs]);

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      const aName = (a.name || a.emailLower || a.email || '').toLowerCase();
      const bName = (b.name || b.emailLower || b.email || '').toLowerCase();
      return aName.localeCompare(bName);
    });
  }, [users]);

  const openEdit = (user: UserRecord) => {
    setSelected(user);
    setEditName(user.name || '');
    const roles = Array.isArray(user.roles) ? user.roles : [];
    setEditAdmin(roles.includes('admin'));
    setEditCompliance(readGermanCompliance(user as Record<string, unknown>));
    setEditVisible(true);
  };

  const openDocuments = (user: UserRecord) => {
    setSelected(user);
    setSelectedRequiredDocs(
      Array.isArray(user.requiredDocuments)
        ? user.requiredDocuments.map(value => String(value || '').trim()).filter(Boolean)
        : []
    );
    setNewDocType('');
    setNewDocTypeMemberOnly(false);
    setDocumentsModalUser(user);
  };

  const handleSave = async () => {
    if (!selected) return;
    if (saving) return;
    const trimmed = editName.trim();

    console.log('handleSave: starting', { selectedId: selected.id, trimmed, editAdmin });
    setSaving(true);
    try {
      const roles = Array.isArray(selected.roles) ? selected.roles : [];
      const nextRoles = editAdmin
        ? Array.from(new Set([...roles, 'admin']))
        : roles.filter(role => role !== 'admin');

      console.log('handleSave: updating with', { name: trimmed, roles: nextRoles });
      await updateDoc(doc(getFirestore(), 'users', selected.id), {
        name: trimmed,
        roles: nextRoles,
        teamId: (selected as any).teamId || 'team-1',
        germanCompliance: {
          salutation: editCompliance.salutation || '',
          address: String(editCompliance.address || '').trim(),
          birthDate: String(editCompliance.birthDate || '').trim(),
          birthPlace: String(editCompliance.birthPlace || '').trim(),
          socialSecurityNumber: String(editCompliance.socialSecurityNumber || '').trim(),
          taxIdNumber: String(editCompliance.taxIdNumber || '').trim(),
        },
      });

      console.log('handleSave: success');
      setEditVisible(false);
      setSelected(null);
      setEditName('');
      setEditAdmin(false);
      setEditCompliance({});
      Alert.alert('Success', 'Member updated successfully');
    } catch (err: any) {
      console.error('handleSave: error', err);
      const msg = err?.message ? String(err.message) : 'Unable to update user.';
      Alert.alert('Notice', msg);
    } finally {
      console.log('handleSave: finally block');
      setSaving(false);
    }
  };

  const toggleRequiredDoc = (docType: string) => {
    setSelectedRequiredDocs(current =>
      current.includes(docType)
        ? current.filter(value => value !== docType)
        : [...current, docType].sort((a, b) => a.localeCompare(b))
    );
  };

  const handleAddDocType = async () => {
    const trimmed = newDocType.trim();
    if (!trimmed || addingDocType) return;
    const normalized = trimmed.replace(/\s+/g, ' ');
    const exists = availableDocTypes.some(value => value.toLowerCase() === normalized.toLowerCase());
    if (exists) {
      setNewDocType('');
      setNewDocTypeMemberOnly(false);
      if (!selectedRequiredDocs.includes(normalized)) {
        toggleRequiredDoc(
          availableDocTypes.find(value => value.toLowerCase() === normalized.toLowerCase()) || normalized
        );
      }
      return;
    }

    setAddingDocType(true);
    try {
      if (newDocTypeMemberOnly) {
        setSelectedRequiredDocs(current => [...current, normalized].sort((a, b) => a.localeCompare(b)));
        setNewDocType('');
        setNewDocTypeMemberOnly(false);
        return;
      }
      const fs = getFirestore();
      const nextOptions = [...availableDocTypes, normalized].sort((a, b) => a.localeCompare(b));
      await setDoc(
        doc(fs, 'appConfig', DOC_REQUIREMENTS_CONFIG_ID),
        {
          options: nextOptions,
        },
        { merge: true }
      );
      setSelectedRequiredDocs(current => [...current, normalized].sort((a, b) => a.localeCompare(b)));
      setNewDocType('');
      setNewDocTypeMemberOnly(false);
    } catch (err: any) {
      const msg = err?.message ? String(err.message) : 'Unable to add document type.';
      Alert.alert('Notice', msg);
    } finally {
      setAddingDocType(false);
    }
  };

  const handleDeleteDocType = (docType: string) => {
    Alert.alert(
      'Remove document type',
      `Delete "${docType}" from the available document list? It will be removed from required documents for all users.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void performDeleteDocType(docType),
        },
      ]
    );
  };

  const performDeleteDocType = async (docType: string) => {
    setDeletingDocType(docType);
    try {
      const fs = getFirestore();
      const nextOptions = availableDocTypes.filter(value => value !== docType);
      await setDoc(
        doc(fs, 'appConfig', DOC_REQUIREMENTS_CONFIG_ID),
        { options: nextOptions },
        { merge: true }
      );
      setSelectedRequiredDocs(current => current.filter(value => value !== docType));

      const affectedUsers = users.filter(
        user =>
          Array.isArray(user.requiredDocuments) && user.requiredDocuments.includes(docType)
      );
      await Promise.all(
        affectedUsers.map(user =>
          updateDoc(doc(fs, 'users', user.id), {
            requiredDocuments: user.requiredDocuments!.filter(value => value !== docType),
          })
        )
      );
    } catch (err: any) {
      Alert.alert('Notice', err?.message || 'Unable to delete document type.');
    } finally {
      setDeletingDocType(null);
    }
  };

  const handleResetPassword = async (user: UserRecord) => {
    const targetEmail = user.emailLower || user.email || '';
    if (!targetEmail) {
      Alert.alert('No email', 'This user has no email on file.');
      return;
    }

    setResettingId(user.id);
    try {
      await resetPassword(targetEmail);
      Alert.alert('Reset Email Sent', `Sent to ${targetEmail}.`);
    } catch (err: any) {
      const msg = err?.message ? String(err.message) : 'Unable to send reset email.';
      Alert.alert('Reset Failed', msg);
    } finally {
      setResettingId(null);
    }
  };

  const handleToggleDisabled = async (user: UserRecord) => {
    try {
      const next = !user.disabled;
      await updateDoc(doc(getFirestore(), 'users', user.id), { disabled: next });
    } catch (err: any) {
      const msg = err?.message ? String(err.message) : 'Unable to update status.';
      Alert.alert('Notice', msg);
    }
  };

  const handleDeleteProfile = (user: UserRecord) => {
    Alert.alert(
      'Delete Profile Data',
      `Remove profile data for ${user.email || user.name || 'this user'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDoc(doc(getFirestore(), 'users', user.id));
            } catch (err: any) {
              const msg = err?.message ? String(err.message) : 'Unable to delete.';
              Alert.alert('Notice', msg);
            }
          },
        },
      ]
    );
  };

  const confirmDeleteCredential = (item: any) => {
    const label = item.fileName || 'this document';
    Alert.alert(
      'Delete upload',
      `Remove ${label} for ${documentsModalUser?.name || documentsModalUser?.email || 'this user'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void handleDeleteCredential(item),
        },
      ]
    );
  };

  const handleDeleteCredential = async (item: any) => {
    setDeletingCredentialId(item.id);
    try {
      await deleteHygieneCredential(item.id, item.storagePath);
    } catch (err: any) {
      Alert.alert('Could not delete', err?.message || 'Delete failed.');
    } finally {
      setDeletingCredentialId(null);
    }
  };

  const buildEmployeeOverride = (user: UserRecord): HygieneEmployeeOverride => ({
    userId: user.id,
    userName: user.name || user.email || 'User',
    userEmail: user.emailLower || user.email || '',
    avatarUrl: user.avatarUrl ?? null,
  });

  const handleAdminUploadDocument = async (user: UserRecord, docType: string) => {
    if (uploadingDocType || isUploadingDoc) return;
    setUploadingDocType(docType);
    setUploadTargetUserId(user.id);
    try {
      const uploaded = await pickAndUpload(buildEmployeeOverride(user), {
        requiredDocumentType: docType,
        documentCategory: 'required_user_document',
      });
      if (!uploaded) return;
      Alert.alert('Uploaded', `${docType} uploaded for ${user.name || user.email || 'this user'}.`);
    } catch (err: any) {
      Alert.alert('Upload failed', err?.message || 'Could not upload document.');
    } finally {
      setUploadingDocType(null);
      setUploadTargetUserId(null);
    }
  };

  const updateEditCompliance = (key: keyof GermanComplianceProfile, value: string) => {
    setEditCompliance(current => ({ ...current, [key]: value }));
  };

  const handleSaveDocumentRequirements = async () => {
    if (!documentsModalUser || saving) return;
    const existing = Array.isArray(documentsModalUser.requiredDocuments)
      ? documentsModalUser.requiredDocuments.map(value => String(value || '').trim().toLowerCase()).filter(Boolean)
      : [];
    const newlyRequested = selectedRequiredDocs.filter(docType => !existing.includes(docType.toLowerCase()));
    setSaving(true);
    try {
      await updateDoc(doc(getFirestore(), 'users', documentsModalUser.id), {
        requiredDocuments: selectedRequiredDocs,
      });
      if (newlyRequested.length > 0) {
        await addDoc(collection(getFirestore(), 'users', documentsModalUser.id, 'notifications'), {
          title: 'New document requested',
          body: `Please provide: ${newlyRequested.join(', ')}.`,
          nav: { screen: 'RequiredDocuments' },
          createdAt: serverTimestamp(),
        });
      }
      setDocumentsModalUser(current => current ? { ...current, requiredDocuments: selectedRequiredDocs } : current);
      setSelected(current => current ? { ...current, requiredDocuments: selectedRequiredDocs } : current);
      Alert.alert('Saved', 'Document requirements updated.');
    } catch (err: any) {
      Alert.alert('Could not save', err?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const isUploadBusyFor = (userId: string, docType: string) =>
    uploadingDocType === docType && uploadTargetUserId === userId && (isUploadingDoc || !!uploadingDocType);

  const renderItem = ({ item }: { item: UserRecord }) => {
    const roles = Array.isArray(item.roles) ? item.roles : [];
    const requiredDocs = Array.isArray(item.requiredDocuments)
      ? item.requiredDocuments.map(value => String(value || '').trim()).filter(Boolean)
      : [];
    const label = item.name || item.email || 'Unnamed member';
    const expanded = expandedUserIds.includes(item.id);

    return (
      <View style={styles.userCard}>
        <View style={styles.userHeader}>
          <TouchableOpacity
            style={styles.userSummaryTap}
            onPress={() => setExpandedUserIds(current =>
              current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id]
            )}
            activeOpacity={0.85}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.userName}>{label}</Text>
              <Text style={styles.userMeta}>
                {roles.includes('admin') ? 'Admin' : 'Member'}
                {item.disabled ? ' • Disabled' : ''}
              </Text>
            </View>
            <Text style={styles.expandIndicator}>{expanded ? '⌃' : '⌄'}</Text>
          </TouchableOpacity>
        </View>

        {expanded ? <>
        {!!item.email && <Text style={styles.userEmail}>{item.email}</Text>}
        <Text style={styles.userDocsMeta}>
          Documents required: {requiredDocs.length ? requiredDocs.join(', ') : 'None set'}
        </Text>
        <TouchableOpacity onPress={() => openUserProfile(navigation, { userId: item.id, userName: label })}>
          <Text style={styles.profileLink}>View profile</Text>
        </TouchableOpacity>

        <View style={styles.actionsRow}>
          <PizzaFireButton label="Edit" variant="primary" onPress={() => openEdit(item)} style={styles.actionBtn} />
          {!SHOW_DEBUG_ONLY_OPERATIONS ? <PizzaFireButton
            label="Send Reset"
            variant="primary"
            onPress={() => handleResetPassword(item)}
            disabled={resettingId === item.id}
            loading={resettingId === item.id}
            style={styles.actionBtn}
          /> : null}
          <PizzaFireButton
            label={item.disabled ? 'Activate' : 'Disable'}
            variant="muted"
            onPress={() => handleToggleDisabled(item)}
            style={styles.actionBtn}
          />
          <PizzaFireButton
            label="Delete Profile"
            variant="danger"
            onPress={() => handleDeleteProfile(item)}
            style={styles.actionBtn}
          />
        </View>

        <View style={styles.actionsRow}>
          <PizzaFireButton
            label="Documents"
            variant="muted"
            onPress={() => openDocuments(item)}
            style={styles.actionBtn}
          />
        </View>
        </> : null}
      </View>
    );
  };

  return (
    <PizzaFireScreen>
    <View style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icons.arrowLeft color={PIZZA_FIRE.gold} width={24} height={24} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Manage Members</Text>
          <Text style={styles.subtitle}>{users.length} Total Members</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {loadError ? (
        <Text style={styles.errorBanner}>{loadError}</Text>
      ) : null}
      {loading ? (
        <ActivityIndicator size="large" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={sortedUsers}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>No members found.</Text>
          }
        />
      )}

      <Modal visible={editVisible} transparent animationType="fade">
        <KeyboardAvoidingView style={styles.modalBg} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modalCard, styles.editModalCard]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Member</Text>
              <TouchableOpacity
                onPress={() => {
                  setEditVisible(false);
                  setSelected(null);
                  setEditName('');
                  setEditAdmin(false);
                  setEditCompliance({});
                  setSaving(false);
                  setDeletingDocType(null);
                }}
                style={styles.closeBtn}
              >
                <Text style={styles.closeText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.editModalScroll} keyboardShouldPersistTaps="always" showsVerticalScrollIndicator={false}>
            <TextInput
              style={styles.input}
              value={editName}
              onChangeText={setEditName}
              placeholder="Full name"
            />
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Admin access</Text>
              <Switch value={editAdmin} onValueChange={setEditAdmin} />
            </View>

            <View style={styles.profileDetailsSection}>
              <Text style={styles.docsTitle}>Member details</Text>
              <Text style={styles.docsSub}>Enter the employment-record details on the member’s behalf.</Text>
              <Text style={styles.profileFieldLabel}>Title</Text>
              <View style={styles.salutationRow}>
                {SALUTATION_OPTIONS.map(option => (
                  <TouchableOpacity
                    key={option}
                    style={[styles.salutationPill, editCompliance.salutation === option && styles.salutationPillActive]}
                    onPress={() => updateEditCompliance('salutation', option as Salutation)}
                  >
                    <Text style={[styles.salutationPillText, editCompliance.salutation === option && styles.salutationPillTextActive]}>{option}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {GERMAN_COMPLIANCE_FIELDS.map(field => (
                <View key={field.key} style={styles.profileFieldGroup}>
                  <Text style={styles.profileFieldLabel}>{field.label}</Text>
                  <TextInput
                    style={[styles.input, field.multiline && styles.profileMultilineInput]}
                    value={String(editCompliance[field.key] || '')}
                    onChangeText={value => updateEditCompliance(field.key, value)}
                    placeholder={field.key === 'birthDate' ? 'YYYY-MM-DD' : field.placeholder}
                    placeholderTextColor="#8F7E6D"
                    multiline={field.multiline}
                    autoCapitalize={field.autoCapitalize || 'sentences'}
                    keyboardType={field.keyboardType || 'default'}
                  />
                </View>
              ))}
            </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalLink}
                onPress={() => {
                  setEditVisible(false);
                  setSelected(null);
                  setEditName('');
                  setEditAdmin(false);
                  setEditCompliance({});
                  setSaving(false);
                }}
              >
                <Text style={styles.modalLinkText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalButton}
                onPressIn={() => Keyboard.dismiss()}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalButtonText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!documentsModalUser} transparent animationType="fade">
        <KeyboardAvoidingView style={styles.modalBg} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modalCard, styles.documentsModalCard]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Documents</Text>
                <Text style={styles.documentsModalSubtitle}>
                  {documentsModalUser?.name || documentsModalUser?.email || 'Member'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setDocumentsModalUser(null);
                  setDeletingCredentialId(null);
                }}
                style={styles.closeBtn}
              >
                <Text style={styles.closeText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.documentsScroll} keyboardShouldPersistTaps="always" showsVerticalScrollIndicator={false}>
              {documentsModalUser ? (
                <View style={styles.docsSection}>
                  <Text style={styles.docsTitle}>Required documents</Text>
                  <Text style={styles.docsSub}>Add or manage the documents required from this member.</Text>
                  <View style={styles.addDocRow}>
                    <TextInput
                      style={[styles.input, styles.docInput]}
                      value={newDocType}
                      onChangeText={setNewDocType}
                      placeholder="e.g. Food Hygiene Certificate"
                      placeholderTextColor="#8F7E6D"
                    />
                    <TouchableOpacity
                      style={[styles.addDocBtn, (!newDocType.trim() || addingDocType) && styles.addDocBtnDisabled]}
                      onPress={handleAddDocType}
                      disabled={!newDocType.trim() || addingDocType}
                    >
                      {addingDocType ? <ActivityIndicator color="#FFF" /> : <Text style={styles.addDocBtnText}>Add</Text>}
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={styles.memberOnlyToggle} onPress={() => setNewDocTypeMemberOnly(current => !current)}>
                    <View style={[styles.docCheckbox, newDocTypeMemberOnly && styles.docCheckboxSelected]}>
                      <Text style={styles.docCheckboxText}>{newDocTypeMemberOnly ? '✓' : ''}</Text>
                    </View>
                    <Text style={styles.memberOnlyText}>This member only</Text>
                  </TouchableOpacity>
                  <View style={styles.docOptionsWrap}>
                    {documentTypesForSelectedUser.map(docType => {
                      const required = selectedRequiredDocs.includes(docType);
                      const upload = uploadsByDocTypeForModalUser.get(docType);
                      const memberOnly = !availableDocTypes.some(type => type.toLowerCase() === docType.toLowerCase());
                      return (
                        <View key={docType} style={[styles.docOption, required && styles.docOptionSelected]}>
                          <TouchableOpacity style={styles.docOptionMain} onPress={() => toggleRequiredDoc(docType)}>
                            <View style={[styles.docCheckbox, required && styles.docCheckboxSelected]}>
                              <Text style={styles.docCheckboxText}>{required ? '✓' : ''}</Text>
                            </View>
                            <View style={styles.docOptionBody}>
                              <Text style={[styles.docOptionText, required && styles.docOptionTextSelected]}>{docType}</Text>
                              {memberOnly ? <Text style={styles.memberOnlyTag}>This member only</Text> : null}
                              <Text style={[styles.docUploadStatus, upload ? styles.docUploadStatusDone : styles.docUploadStatusMissing]}>{upload ? 'Uploaded' : 'Not uploaded'}</Text>
                            </View>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.docUploadBtn}
                            onPress={() => void handleAdminUploadDocument(documentsModalUser, docType)}
                            disabled={isUploadBusyFor(documentsModalUser.id, docType)}
                          >
                            {isUploadBusyFor(documentsModalUser.id, docType) ? <ActivityIndicator color={PIZZA_FIRE.gold} size="small" /> : <Text style={styles.docUploadBtnText}>{upload ? 'Replace' : 'Upload'}</Text>}
                          </TouchableOpacity>
                          {!memberOnly ? (
                            <TouchableOpacity style={styles.docTypeDeleteBtn} onPress={() => handleDeleteDocType(docType)} disabled={deletingDocType === docType}>
                              {deletingDocType === docType ? <ActivityIndicator color="#D89A79" /> : <Text style={styles.docTypeDeleteText}>Delete</Text>}
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {documentsModalUser ? (
                <View style={styles.documentRequirementsSaveSection}>
                  <TouchableOpacity style={styles.modalButton} onPressIn={() => Keyboard.dismiss()} onPress={() => void handleSaveDocumentRequirements()} disabled={saving}>
                    {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.modalButtonText}>Save document requirements</Text>}
                  </TouchableOpacity>
                </View>
              ) : null}

              <Text style={styles.uploadedFilesHeading}>Uploaded files</Text>
              {documentsForModalUser.length === 0 ? (
                <Text style={styles.docsEmpty}>No uploaded documents for this user yet.</Text>
              ) : (
                <View style={styles.credentialGrid}>
                  {documentsForModalUser.map(item => {
                    const fileName = String(item.fileName || 'Document');
                    const previewableImage = isImageCredential(fileName) && !!item.downloadUrl;
                    const docType = String(item.requiredDocumentType || '').trim();
                    return (
                      <View key={item.id} style={styles.credentialTile}>
                        <TouchableOpacity
                          style={styles.credentialPreview}
                          onPress={() => void Linking.openURL(String(item.downloadUrl || ''))}
                          disabled={!item.downloadUrl}
                        >
                          {previewableImage ? (
                            <Image
                              source={{ uri: String(item.downloadUrl) }}
                              style={styles.credentialImage}
                              resizeMode="cover"
                            />
                          ) : (
                            <View style={styles.credentialDocPreview}>
                              <Text style={styles.credentialDocLabel}>PDF</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                        <Text style={styles.credentialName} numberOfLines={2}>
                          {docType || fileName}
                        </Text>
                        {docType ? (
                          <Text style={styles.credentialMeta} numberOfLines={1}>
                            {fileName}
                          </Text>
                        ) : null}
                        <Text style={styles.credentialMeta} numberOfLines={2}>
                          Uploaded {formatDateTime(item.uploadedAt, item.uploadedAtIso)}
                        </Text>
                        <View style={styles.credentialTileActions}>
                          <TouchableOpacity
                            style={styles.tileLinkButton}
                            onPress={() => void Linking.openURL(String(item.downloadUrl || ''))}
                          >
                            <Text style={styles.tileLinkText}>Open</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.deleteDocButton}
                            onPress={() => confirmDeleteCredential(item)}
                            disabled={deletingCredentialId === item.id}
                          >
                            {deletingCredentialId === item.id ? (
                              <ActivityIndicator color="#D89A79" />
                            ) : (
                              <Text style={styles.deleteDocButtonText}>Delete</Text>
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      {nameConfirmModal}
      {sourcePickerModal}
    </View>
    </PizzaFireScreen>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: 'transparent',
    borderBottomWidth: 1,
    borderBottomColor: PIZZA_FIRE.divider,
  },
  backBtn: { padding: 4, marginRight: 4 },
  back: { fontSize: 18, fontWeight: 'bold', color: PIZZA_FIRE.textSecondary },
  errorBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(158, 60, 46, 0.2)',
    color: PIZZA_FIRE.textPrimary,
    fontSize: 13,
  },
  title: { fontSize: 20, fontWeight: 'bold', color: PIZZA_FIRE.textPrimary },
  subtitle: { fontSize: 12, color: PIZZA_FIRE.textMuted, marginTop: 2 },
  list: { padding: 16 },
  empty: { textAlign: 'center', marginTop: 40, color: PIZZA_FIRE.textMuted },
  userCard: {
    backgroundColor: PIZZA_FIRE.surface,
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userSummaryTap: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingRight: 12 },
  userName: { fontSize: 16, fontWeight: 'bold', color: PIZZA_FIRE.textPrimary },
  userEmail: { fontSize: 13, color: PIZZA_FIRE.textMuted, marginTop: 2 },
  userMeta: { fontSize: 12, color: PIZZA_FIRE.textMuted, marginTop: 6 },
  userDocsMeta: { fontSize: 12, color: PIZZA_FIRE.textSecondary, marginTop: 6, lineHeight: 17 },
  profileLink: { color: PIZZA_FIRE.gold, fontSize: 12, fontWeight: '700', marginTop: 10 },
  expandIndicator: { color: PIZZA_FIRE.gold, fontSize: 20, fontWeight: '800', marginLeft: 10, lineHeight: 18 },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  actionBtn: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 96,
  },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
  },
  modalCard: {
    margin: 20,
    backgroundColor: PIZZA_FIRE.bgMid,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  editModalCard: {
    maxHeight: '88%',
  },
  editModalScroll: {
    paddingBottom: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold', flex: 1, color: PIZZA_FIRE.textPrimary },
  closeBtn: {
    padding: 4,
    marginLeft: 8,
  },
  closeText: {
    fontSize: 24,
    color: PIZZA_FIRE.textMuted,
    fontWeight: '300',
  },
  input: {
    backgroundColor: PIZZA_FIRE.inputBg,
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
    color: PIZZA_FIRE.textSecondary,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
  },
  toggleLabel: { fontSize: 14, color: PIZZA_FIRE.textSecondary },
  docsSection: {
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: PIZZA_FIRE.divider,
  },
  docsTitle: { fontSize: 16, fontWeight: '700', color: PIZZA_FIRE.textPrimary },
  docsSub: { fontSize: 12, color: PIZZA_FIRE.textMuted, marginTop: 4, lineHeight: 17 },
  addDocRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  docInput: {
    flex: 1,
    marginTop: 0,
  },
  addDocBtn: {
    backgroundColor: '#8A5A44',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addDocBtnDisabled: {
    opacity: 0.5,
  },
  addDocBtnText: {
    color: '#FFF',
    fontWeight: '700',
  },
  docOptionsWrap: {
    marginTop: 14,
    gap: 8,
  },
  profileDetailsSection: {
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: PIZZA_FIRE.divider,
  },
  profileFieldGroup: { marginTop: 14 },
  profileFieldLabel: { color: PIZZA_FIRE.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: 7 },
  profileMultilineInput: { minHeight: 78, textAlignVertical: 'top' },
  salutationRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  salutationPill: { flex: 1, alignItems: 'center', borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder, borderRadius: 9, paddingVertical: 10, backgroundColor: PIZZA_FIRE.surfaceInset },
  salutationPillActive: { backgroundColor: PIZZA_FIRE.accentSoft, borderColor: PIZZA_FIRE.accent },
  salutationPillText: { color: PIZZA_FIRE.textSecondary, fontSize: 13, fontWeight: '700' },
  salutationPillTextActive: { color: PIZZA_FIRE.accent, fontWeight: '800' },
  memberOnlyToggle: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: 10 },
  memberOnlyText: { color: PIZZA_FIRE.textSecondary, fontSize: 12, fontWeight: '700' },
  memberOnlyTag: { color: PIZZA_FIRE.gold, fontSize: 10, fontWeight: '800', marginTop: 3 },
  docsEmpty: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
  },
  docOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    gap: 8,
  },
  docOptionMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  docOptionBody: {
    flex: 1,
  },
  docUploadStatus: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 4,
  },
  docUploadStatusDone: {
    color: '#9BD1A5',
  },
  docUploadStatusMissing: {
    color: '#E2A14A',
  },
  docUploadLink: {
    color: PIZZA_FIRE.gold,
    fontSize: 11,
    fontWeight: '800',
  },
  docUploadLinkBtn: {
    paddingHorizontal: 6,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  docUploadBtn: {
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    backgroundColor: PIZZA_FIRE.crustDark,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    minWidth: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docUploadBtnText: {
    color: PIZZA_FIRE.gold,
    fontWeight: '800',
    fontSize: 11,
  },
  docTypeDeleteBtn: {
    borderWidth: 1,
    borderColor: '#67483B',
    backgroundColor: PIZZA_FIRE.crustDark,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docTypeDeleteText: {
    color: '#D89A79',
    fontWeight: '800',
    fontSize: 11,
  },
  docOptionSelected: {
    backgroundColor: PIZZA_FIRE.inputBg,
    borderColor: PIZZA_FIRE.gold,
  },
  docCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#7C6854',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    backgroundColor: PIZZA_FIRE.surfaceInset,
  },
  docCheckboxSelected: {
    backgroundColor: PIZZA_FIRE.gold,
    borderColor: PIZZA_FIRE.gold,
  },
  docCheckboxText: {
    color: PIZZA_FIRE.charcoal,
    fontWeight: '900',
    fontSize: 12,
  },
  docOptionText: {
    color: PIZZA_FIRE.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  docOptionTextSelected: {
    color: '#FFF7EE',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 20,
  },
  modalLink: { padding: 8 },
  modalLinkText: { color: PIZZA_FIRE.gold, fontWeight: '600' },
  modalButton: {
    backgroundColor: PIZZA_FIRE.accent,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
  },
  modalButtonText: { color: '#FFF', fontWeight: '600' },
  documentsModalCard: {
    maxHeight: '85%',
  },
  documentsModalSubtitle: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  documentsScroll: {
    paddingBottom: 8,
  },
  documentRequirementsSaveSection: {
    marginTop: 18,
    marginBottom: 22,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: PIZZA_FIRE.divider,
  },
  adminUploadSection: {
    marginBottom: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: PIZZA_FIRE.divider,
    gap: 8,
  },
  adminUploadTitle: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  adminUploadSub: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 4,
  },
  adminUploadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  adminUploadRowText: {
    flex: 1,
  },
  adminUploadDocType: {
    color: PIZZA_FIRE.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  adminUploadBtn: {
    backgroundColor: PIZZA_FIRE.accent,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 72,
    alignItems: 'center',
  },
  adminUploadBtnDisabled: {
    opacity: 0.6,
  },
  adminUploadBtnText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 12,
  },
  uploadedFilesHeading: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
  },
  credentialGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  credentialTile: {
    width: '47%',
    minWidth: 140,
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    borderRadius: 12,
    padding: 10,
  },
  credentialPreview: {
    height: 96,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: PIZZA_FIRE.crustDark,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    marginBottom: 8,
  },
  credentialImage: {
    width: '100%',
    height: '100%',
  },
  credentialDocPreview: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#211915',
  },
  credentialDocLabel: {
    color: PIZZA_FIRE.gold,
    fontSize: 22,
    fontWeight: '800',
  },
  credentialName: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 4,
  },
  credentialMeta: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 2,
  },
  credentialTileActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  tileLinkButton: {
    paddingVertical: 4,
    paddingRight: 8,
  },
  tileLinkText: {
    color: PIZZA_FIRE.gold,
    fontSize: 12,
    fontWeight: '700',
  },
  deleteDocButton: {
    borderWidth: 1,
    borderColor: '#67483B',
    backgroundColor: PIZZA_FIRE.crustDark,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  deleteDocButtonText: {
    color: '#D89A79',
    fontWeight: '800',
    fontSize: 11,
  },
});
