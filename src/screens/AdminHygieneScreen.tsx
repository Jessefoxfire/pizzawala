import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import PizzaFireScreen from '../components/PizzaFireScreen';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { collection, getFirestore, onSnapshot, query } from '@react-native-firebase/firestore';
import { resolveAvatarSource } from '../utils/avatar';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { openUserProfile } from '../navigation/openUserProfile';
import {
  deleteHygieneCredential,
  deleteTemperatureLog,
  formatDateTime,
  getTimestampMs,
  updateHygieneCredentialFolder,
} from '../services/hygiene';
import { useHygieneCredentialUpload } from '../hooks/useHygieneCredentialUpload';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import { SHOW_DEBUG_ONLY_OPERATIONS } from '../config/buildFeatures';
import HygieneFolderPickerModal from '../components/HygieneFolderPickerModal';
import {
  credentialsInFolder,
  HYGIENE_DOCUMENT_FOLDERS,
  hygieneDocumentFolderLabel,
  inferHygieneDocumentFolder,
  type HygieneDocumentFolderKey,
} from '../utils/hygieneDocumentFolders';
import { isPersonnelDocument } from '../utils/personnelDocuments';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminHygiene'>;

export default function AdminHygieneScreen({ navigation }: Props) {
  const { pickAndUpload, nameConfirmModal, sourcePickerModal } = useHygieneCredentialUpload();
  const [temperatureLogs, setTemperatureLogs] = useState<any[]>([]);
  const [credentials, setCredentials] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [uploadingEmployeeId, setUploadingEmployeeId] = useState<string | null>(null);
  const [deletingTempId, setDeletingTempId] = useState<string | null>(null);
  const [deletingCredentialId, setDeletingCredentialId] = useState<string | null>(null);
  const [expandedEmployeeIds, setExpandedEmployeeIds] = useState<Record<string, boolean>>({});
  const [folderPicker, setFolderPicker] = useState<{
    mode: 'upload' | 'move';
    employee?: any;
    credential?: any;
  } | null>(null);

  useEffect(() => {
    const fs = getFirestore();
    const unsubUsers = onSnapshot(query(collection(fs, 'users')), snap => {
      const items = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
      items.sort((a: any, b: any) => String(a.name || a.email || '').localeCompare(String(b.name || b.email || '')));
      setUsers(items);
    });
    const unsubTemps = onSnapshot(query(collection(fs, 'hygieneTemperatureLogs')), snap => {
      const items = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
      items.sort(
        (a: any, b: any) => getTimestampMs(b.loggedAt, b.loggedAtIso) - getTimestampMs(a.loggedAt, a.loggedAtIso)
      );
      setTemperatureLogs(items.slice(0, 50));
    });
    const unsubCredentials = onSnapshot(query(collection(fs, 'hygieneCredentials')), snap => {
      const items = snap.docs
        .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
        .filter(item => !isPersonnelDocument(item));
      items.sort(
        (a: any, b: any) => getTimestampMs(b.uploadedAt, b.uploadedAtIso) - getTimestampMs(a.uploadedAt, a.uploadedAtIso)
      );
      setCredentials(items);
    });
    return () => {
      unsubUsers();
      unsubTemps();
      unsubCredentials();
    };
  }, []);

  const dueTodayKey = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const credentialsByEmployee = useMemo(() => {
    const grouped: Record<string, any[]> = {};
    credentials.forEach(item => {
      const key = String(item.employeeUid || '').trim();
      if (!key) return;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(item);
    });
    return grouped;
  }, [credentials]);

  const orphanCredentials = useMemo(() => {
    const userIds = new Set(users.map(user => String(user.id)));
    return credentials.filter(item => {
      const employeeUid = String(item.employeeUid || '').trim();
      return employeeUid && !userIds.has(employeeUid);
    });
  }, [credentials, users]);

  const handleUploadForEmployee = async (employee: any, folder: HygieneDocumentFolderKey) => {
    try {
      setUploadingEmployeeId(employee.id);
      const uploaded = await pickAndUpload(
        {
          userId: employee.id,
          userName: employee.name || employee.email || 'Team member',
          userEmail: employee.email || '',
          avatarUrl: employee.avatarUrl || null,
          customAvatarUrl: employee.customAvatarUrl || null,
          teamId: employee.teamId || 'team-1',
        },
        { folder }
      );
      if (!uploaded) return;
      Alert.alert(
        'Uploaded',
        `Saved to ${hygieneDocumentFolderLabel(folder)} for ${employee.name || employee.email || 'employee'}.`
      );
    } catch (error: any) {
      Alert.alert('Upload failed', error?.message || 'Could not upload document.');
    } finally {
      setUploadingEmployeeId(null);
    }
  };

  const confirmDeleteCredential = (item: any) => {
    Alert.alert(
      'Delete upload',
      `Remove ${item.fileName || 'this file'} for ${item.employeeName || 'this employee'}?`,
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
    } catch (error: any) {
      Alert.alert('Could not delete', error?.message || 'Delete failed.');
    } finally {
      setDeletingCredentialId(null);
    }
  };

  const handleCredentialLongPress = (item: any) => {
    Alert.alert(item.fileName || 'Document', 'Choose an action', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Move',
        onPress: () => setFolderPicker({ mode: 'move', credential: item }),
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => confirmDeleteCredential(item),
      },
    ]);
  };

  const handleMoveCredential = async (folder: HygieneDocumentFolderKey) => {
    const item = folderPicker?.credential;
    setFolderPicker(null);
    if (!item?.id) return;
    if (inferHygieneDocumentFolder(item) === folder) return;
    setDeletingCredentialId(item.id);
    try {
      await updateHygieneCredentialFolder(item.id, folder);
    } catch (error: any) {
      Alert.alert('Could not move', error?.message || 'Move failed.');
    } finally {
      setDeletingCredentialId(null);
    }
  };

  const confirmDeleteTemp = (item: any) => {
    Alert.alert(
      'Delete temperature record',
      `Remove ${item.targetLabel} ${item.temperatureValue}°${item.temperatureUnit} recorded by ${item.userName || 'Unknown'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void handleDeleteTemp(item.id),
        },
      ]
    );
  };

  const handleDeleteTemp = async (logId: string) => {
    setDeletingTempId(logId);
    try {
      await deleteTemperatureLog(logId);
    } catch (error: any) {
      Alert.alert('Could not delete', error?.message || 'Delete failed.');
    } finally {
      setDeletingTempId(null);
    }
  };

  const toggleEmployeeExpanded = (employeeId: string, hasCredentials: boolean) => {
    if (!hasCredentials) return;
    setExpandedEmployeeIds(current => ({
      ...current,
      [employeeId]: !current[employeeId],
    }));
  };

  const isImageCredential = (fileName: string) => /\.(png|jpe?g|heic|heif|webp)$/i.test(fileName);

  const renderCredentialCard = (item: any) => {
    const dueKey = String(item.nextEducationDueDateKey || '');
    const overdue = !!dueKey && dueKey <= dueTodayKey;
    const fileName = String(item.fileName || 'File');
    const previewableImage = isImageCredential(fileName) && !!item.downloadUrl;

    return (
      <Pressable
        key={item.id}
        style={styles.credentialTile}
        onLongPress={() => handleCredentialLongPress(item)}
        delayLongPress={450}
      >
        <TouchableOpacity
          style={styles.credentialPreview}
          onPress={() => void Linking.openURL(String(item.downloadUrl || ''))}
          disabled={!item.downloadUrl}
        >
          {previewableImage ? (
            <Image source={{ uri: String(item.downloadUrl) }} style={styles.credentialImage} resizeMode="cover" />
          ) : (
            <View style={styles.credentialDocPreview}>
              <Text style={styles.credentialDocLabel}>PDF</Text>
            </View>
          )}
        </TouchableOpacity>
        <Text style={styles.credentialName} numberOfLines={2}>{fileName}</Text>
        <Text style={styles.credentialMeta} numberOfLines={2}>
          Uploaded {formatDateTime(item.uploadedAt, item.uploadedAtIso)}
        </Text>
        {inferHygieneDocumentFolder(item) === 'belehrung' ? (
          <Text style={[styles.credentialMeta, overdue && styles.overdue]} numberOfLines={2}>
            Due {item.nextEducationDueAtIso ? new Date(item.nextEducationDueAtIso).toLocaleDateString() : 'Unknown'}
          </Text>
        ) : null}
        <View style={styles.credentialTileActions}>
          <TouchableOpacity style={styles.tileLinkButton} onPress={() => void Linking.openURL(String(item.downloadUrl || ''))}>
            <Text style={styles.linkText}>Open</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    );
  };

  return (
    <>
    <PizzaFireScreen>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Admin</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Admin Hygiene</Text>
        <View style={{ width: 56 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Compliance Dashboard</Text>
          <Text style={styles.sectionSub}>
            Audit-facing hygiene records for temperature monitoring, certification storage, and monthly export.
          </Text>
          <View style={styles.auditPanel}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryCell}>
                <Text style={styles.summaryLabel}>Temperature logs</Text>
                <Text style={styles.summaryValue}>{temperatureLogs.length}</Text>
              </View>
              <View style={styles.summaryCell}>
                <Text style={styles.summaryLabel}>Cards on file</Text>
                <Text style={styles.summaryValue}>{credentials.length}</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.linkPanel} onPress={() => navigation.navigate('Hygiene')}>
              <View>
                <Text style={styles.linkPanelTitle}>Temps</Text>
                <Text style={styles.linkPanelText}>Log fridge and cooler temperatures in the field.</Text>
              </View>
              <Text style={styles.linkPanelArrow}>›</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Temperature Monitoring</Text>
          <Text style={styles.sectionSub}>
            Latest field readings. Administrators may remove incorrect records from the log.
          </Text>

          <View style={styles.tableCard}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeadText, styles.colUnit]}>Unit</Text>
              <Text style={[styles.tableHeadText, styles.colTemp]}>Temp</Text>
              <Text style={[styles.tableHeadText, styles.colBy]}>Recorded By</Text>
              <Text style={[styles.tableHeadText, styles.colWhen]}>When</Text>
              <Text style={[styles.tableHeadText, styles.colAction]}>Action</Text>
            </View>
            {temperatureLogs.length === 0 ? (
              <View style={styles.emptyRow}><Text style={styles.emptyText}>No temperature logs yet.</Text></View>
            ) : (
              temperatureLogs.slice(0, 10).map(item => (
                <View key={item.id} style={styles.tableRow}>
                  <Text style={[styles.tableText, styles.colUnit]}>{item.targetLabel || '-'}</Text>
                  <Text style={[styles.tableText, styles.colTemp]}>{item.temperatureValue || '-'}°{item.temperatureUnit || ''}</Text>
                  <Text style={[styles.tableText, styles.colBy]} numberOfLines={1}>{item.userName || 'Unknown'}</Text>
                  <Text style={[styles.tableText, styles.colWhen]} numberOfLines={2}>{formatDateTime(item.loggedAt, item.loggedAtIso)}</Text>
                  <View style={styles.colAction}>
                    <TouchableOpacity style={styles.deleteButton} onPress={() => confirmDeleteTemp(item)} disabled={deletingTempId === item.id}>
                      {deletingTempId === item.id ? <ActivityIndicator color="#C97934" /> : <Text style={styles.deleteButtonText}>Delete</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        </View>

        <View style={[styles.section, SHOW_DEBUG_ONLY_OPERATIONS && styles.hiddenPersonnelDocuments]}>
          <Text style={styles.sectionTitle}>Documents</Text>
          <Text style={styles.sectionSub}>
            Employee hygiene files in Employee Hygiene Cards, Recurring Education, and Other. Long-press a file to move or delete it.
          </Text>
          {users.map(user => {
            const busy = uploadingEmployeeId === user.id;
            const employeeCredentials = credentialsByEmployee[user.id] || [];
            const uploadCount = employeeCredentials.length;
            const expanded = !!expandedEmployeeIds[user.id];
            return (
              <View key={user.id} style={styles.personCardWrap}>
                <TouchableOpacity
                  activeOpacity={uploadCount ? 0.9 : 1}
                  style={styles.personCard}
                  onPress={() => toggleEmployeeExpanded(user.id, uploadCount > 0)}
                >
                  <TouchableOpacity
                    onPress={() =>
                      openUserProfile(navigation, {
                        userId: user.id,
                        userName: user.name || user.email,
                      })
                    }
                    activeOpacity={0.85}
                  >
                    <Image source={resolveAvatarSource(user.avatarUrl, user.customAvatarUrl)} style={styles.avatar} />
                  </TouchableOpacity>
                  <View style={styles.personBody}>
                    <Text style={styles.personTitle}>{user.name || user.email || 'Team member'}</Text>
                    <Text style={styles.personMeta}>{uploadCount === 0 ? (user.email || 'No email on file') : `${uploadCount} file${uploadCount === 1 ? '' : 's'} uploaded`}</Text>
                    {uploadCount > 0 ? (
                      <Text style={styles.personHint}>{expanded ? 'Tap to hide files' : 'Tap to view files'}</Text>
                    ) : null}
                  </View>
                  <View style={styles.personActions}>
                    {uploadCount > 0 ? <Text style={styles.expandIndicator}>{expanded ? '−' : '+'}</Text> : null}
                    <TouchableOpacity
                      style={styles.inlineAction}
                      onPress={() => setFolderPicker({ mode: 'upload', employee: user })}
                      disabled={busy}
                    >
                      {busy ? <ActivityIndicator color="#C97934" /> : <Text style={styles.inlineActionText}>Upload file</Text>}
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
                {expanded ? (
                  <View style={styles.credentialFolders}>
                    {HYGIENE_DOCUMENT_FOLDERS.map(folder => {
                      const items = credentialsInFolder(employeeCredentials, folder.key);
                      if (items.length === 0) return null;
                      return (
                        <View key={folder.key} style={styles.folderBlock}>
                          <Text style={styles.folderLabel}>{folder.label}</Text>
                          <View style={styles.credentialGrid}>{items.map(renderCredentialCard)}</View>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          })}
          {orphanCredentials.length > 0 ? (
            <View style={styles.recordCard}>
              <Text style={styles.recordTitle}>Uploads without matching employee record</Text>
              <View style={styles.credentialFolders}>
                {HYGIENE_DOCUMENT_FOLDERS.map(folder => {
                  const items = credentialsInFolder(orphanCredentials, folder.key);
                  if (items.length === 0) return null;
                  return (
                    <View key={folder.key} style={styles.folderBlock}>
                      <Text style={styles.folderLabel}>{folder.label}</Text>
                      <View style={styles.credentialGrid}>{items.map(renderCredentialCard)}</View>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </PizzaFireScreen>
    {nameConfirmModal}
    {sourcePickerModal}
    <HygieneFolderPickerModal
      visible={folderPicker !== null}
      title={folderPicker?.mode === 'move' ? 'Move to folder' : 'Save document to'}
      excludeFolder={
        folderPicker?.mode === 'move' && folderPicker.credential
          ? inferHygieneDocumentFolder(folderPicker.credential)
          : null
      }
      onClose={() => setFolderPicker(null)}
      onSelect={folder => {
        if (folderPicker?.mode === 'move') {
          void handleMoveCredential(folder);
          return;
        }
        const employee = folderPicker?.employee;
        setFolderPicker(null);
        if (employee) void handleUploadForEmployee(employee, folder);
      }}
    />
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 14,
  },
  back: { color: PIZZA_FIRE.gold, fontSize: 16, fontWeight: '700' },
  title: { color: PIZZA_FIRE.textPrimary, fontSize: 24, fontWeight: '800' },
  content: { paddingHorizontal: 18, paddingBottom: 28 },
  section: { marginBottom: 26 },
  hiddenPersonnelDocuments: { display: 'none' },
  sectionTitle: { color: '#F4EFE8', fontSize: 22, fontWeight: '800', marginBottom: 6 },
  sectionSub: { color: '#B9AA9A', fontSize: 14, lineHeight: 20, marginBottom: 14 },
  auditPanel: {
    backgroundColor: PIZZA_FIRE.surface,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  summaryCell: {
    flex: 1,
    backgroundColor: PIZZA_FIRE.crustDark,
    borderWidth: 1,
    borderColor: '#39312C',
    borderRadius: 6,
    padding: 10,
  },
  summaryLabel: {
    color: '#B9AA9A',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  summaryValue: { color: '#F4EFE8', fontSize: 22, fontWeight: '800' },
  linkPanel: {
    borderWidth: 1,
    borderColor: '#4A3B31',
    borderRadius: 6,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: PIZZA_FIRE.crustDark,
  },
  linkPanelTitle: { color: '#F4EFE8', fontSize: 16, fontWeight: '800', marginBottom: 4 },
  linkPanelText: { color: '#B9AA9A', fontSize: 13, lineHeight: 18, maxWidth: '90%' },
  linkPanelArrow: { color: '#C97934', fontSize: 22, fontWeight: '800' },
  auditCard: {
    backgroundColor: PIZZA_FIRE.surface,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  tableCard: {
    backgroundColor: PIZZA_FIRE.surface,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
    borderRadius: 16,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: PIZZA_FIRE.crustDark,
    borderBottomWidth: 1,
    borderBottomColor: '#39312C',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  tableHeadText: {
    color: '#D5C6B8',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  tableRow: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2D2722',
  },
  tableText: { color: '#F4EFE8', fontSize: 12, lineHeight: 16, paddingRight: 8 },
  colUnit: { flex: 1.25 },
  colTemp: { flex: 0.65 },
  colBy: { flex: 1.0 },
  colWhen: { flex: 1.25 },
  colAction: { flex: 0.7, alignItems: 'flex-end', justifyContent: 'center' },
  deleteButton: {
    borderWidth: 1,
    borderColor: 'rgba(255, 160, 150, 0.75)',
    backgroundColor: 'rgba(255, 69, 58, 0.34)',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  deleteButtonText: { color: '#FFE4E0', fontWeight: '800', fontSize: 12 },
  personCardWrap: { marginBottom: 10 },
  personCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PIZZA_FIRE.surface,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
    borderRadius: 16,
    padding: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: '#4B372B',
    backgroundColor: PIZZA_FIRE.inputBg,
    marginRight: 12,
  },
  personBody: { flex: 1 },
  personTitle: { color: '#F4EFE8', fontSize: 15, fontWeight: '800', marginBottom: 3 },
  personMeta: { color: '#B9AA9A', fontSize: 12 },
  personHint: { color: '#8F7E6D', fontSize: 11, marginTop: 4 },
  personActions: { alignItems: 'flex-end', gap: 8 },
  expandIndicator: { color: '#C97934', fontSize: 24, fontWeight: '500', lineHeight: 24 },
  inlineAction: {
    borderWidth: 1,
    borderColor: '#5B473A',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: PIZZA_FIRE.crustDark,
  },
  inlineActionText: { color: '#C97934', fontWeight: '800', fontSize: 12 },
  recordCard: {
    backgroundColor: PIZZA_FIRE.surface,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  recordTitle: { color: '#F4EFE8', fontSize: 15, fontWeight: '800', marginBottom: 5 },
  recordMeta: { color: '#B9AA9A', fontSize: 12, lineHeight: 17, marginBottom: 4 },
  overdue: { color: '#D6AA90' },
  recordActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  linkButton: { paddingTop: 4 },
  linkText: { color: '#E9B261', fontSize: 14, fontWeight: '700' },
  credentialGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  credentialFolders: {
    marginTop: 10,
    gap: 12,
  },
  folderBlock: {
    width: '100%',
  },
  folderLabel: {
    color: '#D5C6B8',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  credentialTile: {
    width: '48%',
    minWidth: 150,
    backgroundColor: PIZZA_FIRE.crustDark,
    borderWidth: 1,
    borderColor: '#39312C',
    borderRadius: 8,
    padding: 10,
  },
  credentialPreview: {
    height: 96,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderWidth: 1,
    borderColor: '#332B25',
    marginBottom: 10,
  },
  credentialImage: {
    width: '100%',
    height: '100%',
  },
  credentialDocPreview: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#211914',
  },
  credentialDocLabel: {
    color: '#E9B261',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 1,
  },
  credentialName: { color: '#F4EFE8', fontSize: 13, fontWeight: '800', marginBottom: 5 },
  credentialTileActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  tileLinkButton: { paddingVertical: 4, paddingRight: 8 },
  credentialMeta: { color: '#B9AA9A', fontSize: 11, lineHeight: 16 },
  formLabel: {
    color: '#D5C6B8',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  input: {
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#39312C',
    color: '#F4EFE8',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: '#C97934',
    borderRadius: 6,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: '#F4EFE8', fontSize: 15, fontWeight: '800' },
  emptyRow: { padding: 16 },
  emptyText: { color: '#B9AA9A', fontSize: 14 },
});
