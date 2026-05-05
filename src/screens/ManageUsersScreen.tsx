import React, { useEffect, useMemo, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  updateDoc,
} from '@react-native-firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { resetPassword } from '../services/firebase';
import { RootStackParamList } from '../navigation/AppNavigator';
import { Icons } from '../components/Icons';

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
};

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

  const renderItem = ({ item }: { item: UserRecord }) => {
    const roles = Array.isArray(item.roles) ? item.roles : [];
    const label = item.name || item.email || 'Unnamed user';
    const hasLocation = !!item.lastLocation;

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
            style={[styles.actionBtn, { backgroundColor: '#2E6B5A' }, !hasLocation && styles.actionBtnDisabled]}
            onPress={() => {
              if (!hasLocation) return;
              navigation.navigate('TeamMap', { focusUserId: item.id });
            }}
            disabled={!hasLocation}
          >
            <Text style={styles.actionText}>Show Location</Text>
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
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit User</Text>
              <TouchableOpacity
                onPress={() => {
                  setEditVisible(false);
                  setSelected(null);
                  setEditName('');
                  setEditAdmin(false);
                  setSaving(false);
                }}
                style={styles.closeBtn}
              >
                <Text style={styles.closeText}>✕</Text>
              </TouchableOpacity>
            </View>
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
});
