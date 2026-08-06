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
  Linking,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
} from '@react-native-firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { resetPassword } from '../services/firebase';
import { deleteHygieneCredential, formatDateTime } from '../services/hygiene';
import { RootStackParamList } from '../navigation/AppNavigator';
import { Icons } from '../components/Icons';
import { useHygieneCredentialUpload } from '../hooks/useHygieneCredentialUpload';
import { getRequiredDocumentTypesForUser } from '../constants/germanEmployeeCompliance';
import type { HygieneEmployeeOverride } from '../utils/hygieneCredentialPicker';

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
  const [saving, setSaving] = useState(false);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [availableDocTypes, setAvailableDocTypes] = useState<string[]>([]);
  const [selectedRequiredDocs, setSelectedRequiredDocs] = useState<string[]>([]);
  const [newDocType, setNewDocType] = useState('');
  const [addingDocType, setAddingDocType] = useState(false);
  const [credentials, setCredentials] = useState<any[]>([]);
  const [documentsModalUser, setDocumentsModalUser] = useState<UserRecord | null>(null);
  const [deletingCredentialId, setDeletingCredentialId] = useState<string | null>(null);
  const [deletingDocType, setDeletingDocType] = useState<string | null>(null);
  const [uploadingDocType, setUploadingDocType] = useState<string | null>(null);
  const [uploadTargetUserId, setUploadTargetUserId] = useState<string | null>(null);

  const { pickAndUpload, nameConfirmModal, isUploading: isUploadingDoc } = useHygieneCredentialUpload();

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
    return credentials.filter(item => String(item.employeeUid || '') === documentsModalUser.id);
  }, [credentials, documentsModalUser]);

  const uploadsByDocTypeForUser = useCallback(
    (userId: string) => {
      const map = new Map<string, any>();
      credentials
        .filter(item => String(item.employeeUid || '') === userId)
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
    setSelectedRequiredDocs(
      Array.isArray(user.requiredDocuments)
        ? user.requiredDocuments.map(value => String(value || '').trim()).filter(Boolean)
        : []
    );
    setNewDocType('');
    setEditVisible(true);
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
        requiredDocuments: selectedRequiredDocs,
      });

      console.log('handleSave: success');
      setEditVisible(false);
      setSelected(null);
      setEditName('');
      setEditAdmin(false);
      Alert.alert('Success', 'User updated successfully');
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
      if (!selectedRequiredDocs.includes(normalized)) {
        toggleRequiredDoc(
          availableDocTypes.find(value => value.toLowerCase() === normalized.toLowerCase()) || normalized
        );
      }
      return;
    }

    setAddingDocType(true);
    try {
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

  const isUploadBusyFor = (userId: string, docType: string) =>
    uploadingDocType === docType && uploadTargetUserId === userId && (isUploadingDoc || !!uploadingDocType);

  const renderItem = ({ item }: { item: UserRecord }) => {
    const roles = Array.isArray(item.roles) ? item.roles : [];
    const requiredDocs = Array.isArray(item.requiredDocuments)
      ? item.requiredDocuments.map(value => String(value || '').trim()).filter(Boolean)
      : [];
    const label = item.name || item.email || 'Unnamed user';

    return (
      <View style={styles.userCard}>
        <View style={styles.userHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{label}</Text>
            {!!item.email && <Text style={styles.userEmail}>{item.email}</Text>}
            <Text style={styles.userMeta}>
              {roles.includes('admin') ? 'Admin' : 'Member'}
              {item.disabled ? ' • Disabled' : ''}
            </Text>
            <Text style={styles.userDocsMeta}>
              Documents required: {requiredDocs.length ? requiredDocs.join(', ') : 'None set'}
            </Text>
          </View>
          <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(item)}>
            <Text style={styles.editBtnText}>Edit</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handleResetPassword(item)}
            disabled={resettingId === item.id}
          >
            {resettingId === item.id ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.actionText}>Send Reset</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#6D4C41' }]}
            onPress={() => handleToggleDisabled(item)}
          >
            <Text style={styles.actionText}>
              {item.disabled ? 'Activate' : 'Disable'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#B71C1C' }]}
            onPress={() => handleDeleteProfile(item)}
          >
            <Text style={styles.actionText}>Delete Profile</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#2E6B5A' }]}
            onPress={() => setDocumentsModalUser(item)}
          >
            <Text style={styles.actionText}>View Uploaded Documents</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#5B4B3A' }]}
            onPress={() => navigation.navigate('Chat', { prefillText: `@${label} ` })}
          >
            <Text style={styles.actionText}>Message</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icons.arrowLeft color="#F6EDE2" width={24} height={24} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Manage Users</Text>
          <Text style={styles.subtitle}>{users.length} Total Users</Text>
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
            <Text style={styles.empty}>No users found.</Text>
          }
        />
      )}

      <Modal visible={editVisible} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, styles.editModalCard]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit User</Text>
              <TouchableOpacity
                onPress={() => {
                  setEditVisible(false);
                  setSelected(null);
                  setEditName('');
                  setEditAdmin(false);
                  setSaving(false);
                  setDeletingDocType(null);
                }}
                style={styles.closeBtn}
              >
                <Text style={styles.closeText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.editModalScroll} keyboardShouldPersistTaps="handled">
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

            <View style={styles.docsSection}>
              <Text style={styles.docsTitle}>Documents Required</Text>
              <Text style={styles.docsSub}>Choose required files for this user, or create a new document type.</Text>

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
                  {addingDocType ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={styles.addDocBtnText}>Add</Text>
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.docOptionsWrap}>
                {availableDocTypes.length === 0 ? (
                  <Text style={styles.docsEmpty}>No document types yet. Add one above.</Text>
                ) : (
                  availableDocTypes.map(docType => {
                    const selectedDoc = selectedRequiredDocs.includes(docType);
                    const upload = uploadsByDocTypeForSelectedUser.get(docType);
                    const busyDelete = deletingDocType === docType;
                    return (
                      <View
                        key={docType}
                        style={[styles.docOption, selectedDoc && styles.docOptionSelected]}
                      >
                        <TouchableOpacity
                          style={styles.docOptionMain}
                          onPress={() => toggleRequiredDoc(docType)}
                          activeOpacity={0.75}
                        >
                          <View style={[styles.docCheckbox, selectedDoc && styles.docCheckboxSelected]}>
                            <Text style={styles.docCheckboxText}>{selectedDoc ? '✓' : ''}</Text>
                          </View>
                          <View style={styles.docOptionBody}>
                            <Text style={[styles.docOptionText, selectedDoc && styles.docOptionTextSelected]}>
                              {docType}
                            </Text>
                            <Text
                              style={[
                                styles.docUploadStatus,
                                upload ? styles.docUploadStatusDone : styles.docUploadStatusMissing,
                              ]}
                            >
                              {upload ? 'Uploaded' : 'Not uploaded'}
                            </Text>
                          </View>
                        </TouchableOpacity>
                        {upload?.downloadUrl ? (
                          <TouchableOpacity
                            style={styles.docUploadLinkBtn}
                            onPress={() => void Linking.openURL(String(upload.downloadUrl))}
                          >
                            <Text style={styles.docUploadLink}>View</Text>
                          </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity
                          style={styles.docUploadBtn}
                          onPress={() => selected && void handleAdminUploadDocument(selected, docType)}
                          disabled={!selected || isUploadBusyFor(selected.id, docType)}
                        >
                          {selected && isUploadBusyFor(selected.id, docType) ? (
                            <ActivityIndicator color="#D9A441" size="small" />
                          ) : (
                            <Text style={styles.docUploadBtnText}>{upload ? 'Replace' : 'Upload'}</Text>
                          )}
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.docTypeDeleteBtn}
                          onPress={() => handleDeleteDocType(docType)}
                          disabled={busyDelete}
                        >
                          {busyDelete ? (
                            <ActivityIndicator color="#D89A79" />
                          ) : (
                            <Text style={styles.docTypeDeleteText}>Delete</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    );
                  })
                )}
              </View>
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
                  setSaving(false);
                }}
              >
                <Text style={styles.modalLinkText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalButton}
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
        </View>
      </Modal>

      <Modal visible={!!documentsModalUser} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, styles.documentsModalCard]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Uploaded Documents</Text>
                <Text style={styles.documentsModalSubtitle}>
                  {documentsModalUser?.name || documentsModalUser?.email || 'User'}
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

            <ScrollView contentContainerStyle={styles.documentsScroll}>
              {documentsModalUser ? (
                <View style={styles.adminUploadSection}>
                  <Text style={styles.adminUploadTitle}>Upload for this user</Text>
                  <Text style={styles.adminUploadSub}>
                    Upload required documents on behalf of {documentsModalUser.name || documentsModalUser.email || 'this user'}.
                  </Text>
                  {requiredDocTypesForModalUser.map(docType => {
                    const upload = uploadsByDocTypeForModalUser.get(docType);
                    const busy = isUploadBusyFor(documentsModalUser.id, docType);
                    return (
                      <View key={docType} style={styles.adminUploadRow}>
                        <View style={styles.adminUploadRowText}>
                          <Text style={styles.adminUploadDocType} numberOfLines={2}>
                            {docType}
                          </Text>
                          <Text
                            style={[
                              styles.docUploadStatus,
                              upload ? styles.docUploadStatusDone : styles.docUploadStatusMissing,
                            ]}
                          >
                            {upload ? 'Uploaded' : 'Missing'}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.adminUploadBtn, busy && styles.adminUploadBtnDisabled]}
                          onPress={() => void handleAdminUploadDocument(documentsModalUser, docType)}
                          disabled={busy}
                        >
                          {busy ? (
                            <ActivityIndicator color="#1E1813" size="small" />
                          ) : (
                            <Text style={styles.adminUploadBtnText}>{upload ? 'Replace' : 'Upload'}</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    );
                  })}
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
        </View>
      </Modal>
      {nameConfirmModal}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#2A211B',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#1E1813',
    borderBottomWidth: 1,
    borderBottomColor: '#3A2D24',
  },
  backBtn: { padding: 4, marginRight: 4 },
  back: { fontSize: 18, fontWeight: 'bold', color: '#EBDCCB' },
  errorBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(158, 60, 46, 0.2)',
    color: '#F6EDE2',
    fontSize: 13,
  },
  title: { fontSize: 20, fontWeight: 'bold', color: '#F6EDE2' },
  subtitle: { fontSize: 12, color: '#A88E73', marginTop: 2 },
  list: { padding: 16 },
  empty: { textAlign: 'center', marginTop: 40, color: '#A88E73' },
  userCard: {
    backgroundColor: '#1E1813',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userName: { fontSize: 16, fontWeight: 'bold', color: '#F6EDE2' },
  userEmail: { fontSize: 13, color: '#A88E73', marginTop: 2 },
  userMeta: { fontSize: 12, color: '#7C6854', marginTop: 6 },
  userDocsMeta: { fontSize: 12, color: '#C8B29A', marginTop: 6, lineHeight: 17 },
  editBtn: {
    backgroundColor: '#D9A441',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  editBtnText: { color: '#FFF', fontWeight: '600', fontSize: 12 },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: '#C9782B',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionBtnDisabled: {
    opacity: 0.5,
  },
  actionText: { color: '#FFF', fontWeight: '600', fontSize: 12 },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
  },
  modalCard: {
    margin: 20,
    backgroundColor: '#1E1813',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#3A2D24',
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
  modalTitle: { fontSize: 18, fontWeight: 'bold', flex: 1, color: '#F6EDE2' },
  closeBtn: {
    padding: 4,
    marginLeft: 8,
  },
  closeText: {
    fontSize: 24,
    color: '#A88E73',
    fontWeight: '300',
  },
  input: {
    backgroundColor: '#3A2D24',
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
    color: '#EBDCCB',
    borderWidth: 1,
    borderColor: '#5A4739',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
  },
  toggleLabel: { fontSize: 14, color: '#C8B29A' },
  docsSection: {
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#3A2D24',
  },
  docsTitle: { fontSize: 16, fontWeight: '700', color: '#F6EDE2' },
  docsSub: { fontSize: 12, color: '#A88E73', marginTop: 4, lineHeight: 17 },
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
  docsEmpty: {
    color: '#7C6854',
    fontSize: 13,
    fontStyle: 'italic',
  },
  docOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#2A211B',
    borderWidth: 1,
    borderColor: '#4A3A30',
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
    color: '#D9A441',
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
    borderColor: '#5A4739',
    backgroundColor: '#171311',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    minWidth: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docUploadBtnText: {
    color: '#D9A441',
    fontWeight: '800',
    fontSize: 11,
  },
  docTypeDeleteBtn: {
    borderWidth: 1,
    borderColor: '#67483B',
    backgroundColor: '#171311',
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
    backgroundColor: '#3A2D24',
    borderColor: '#D9A441',
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
    backgroundColor: '#1E1813',
  },
  docCheckboxSelected: {
    backgroundColor: '#D9A441',
    borderColor: '#D9A441',
  },
  docCheckboxText: {
    color: '#1E1813',
    fontWeight: '900',
    fontSize: 12,
  },
  docOptionText: {
    color: '#EBDCCB',
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
  modalLinkText: { color: '#D9A441', fontWeight: '600' },
  modalButton: {
    backgroundColor: '#C9782B',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
  },
  modalButtonText: { color: '#FFF', fontWeight: '600' },
  documentsModalCard: {
    maxHeight: '85%',
  },
  documentsModalSubtitle: {
    color: '#A88E73',
    fontSize: 13,
    marginTop: 4,
  },
  documentsScroll: {
    paddingBottom: 8,
  },
  adminUploadSection: {
    marginBottom: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#3A2D24',
    gap: 8,
  },
  adminUploadTitle: {
    color: '#F6EDE2',
    fontSize: 15,
    fontWeight: '700',
  },
  adminUploadSub: {
    color: '#A88E73',
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
    backgroundColor: '#2A211B',
    borderWidth: 1,
    borderColor: '#4A3A30',
  },
  adminUploadRowText: {
    flex: 1,
  },
  adminUploadDocType: {
    color: '#EBDCCB',
    fontSize: 13,
    fontWeight: '600',
  },
  adminUploadBtn: {
    backgroundColor: '#C9782B',
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
    color: '#F6EDE2',
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
    backgroundColor: '#2A211B',
    borderWidth: 1,
    borderColor: '#3A2D24',
    borderRadius: 12,
    padding: 10,
  },
  credentialPreview: {
    height: 96,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#171311',
    borderWidth: 1,
    borderColor: '#4A3A30',
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
    color: '#D9A441',
    fontSize: 22,
    fontWeight: '800',
  },
  credentialName: {
    color: '#F6EDE2',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 4,
  },
  credentialMeta: {
    color: '#A88E73',
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
    color: '#D9A441',
    fontSize: 12,
    fontWeight: '700',
  },
  deleteDocButton: {
    borderWidth: 1,
    borderColor: '#67483B',
    backgroundColor: '#171311',
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
