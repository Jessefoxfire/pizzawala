import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  Switch,
  ActivityIndicator,
  Alert,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { RootStackParamList } from '../navigation/AppNavigator';
import { db } from '../services/firebase';
import { getNativeNotificationsEnabled, setNativeNotificationsEnabled } from '../geofencing/native';

 type Props = NativeStackScreenProps<RootStackParamList, 'AdminOptions'>;

export default function AdminOptionsScreen({ navigation }: Props) {
  const [adminModalVisible, setAdminModalVisible] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [grantAdmin, setGrantAdmin] = useState(true);
  const [adminSaving, setAdminSaving] = useState(false);
  const [alertsEnabled, setAlertsEnabled] = useState(true);

  const [users, setUsers] = useState<any[]>([]);
  const [userPickerVisible, setUserPickerVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  React.useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), snap => {
      if (!snap || !snap.docs || snap.empty) {
        setUsers([]);
        return;
      }
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setUsers(items);
    });
    return () => unsub();
  }, []);

  React.useEffect(() => {
    void getNativeNotificationsEnabled().then(enabled => {
      setAlertsEnabled(enabled);
    });
  }, []);

  const handleToggleAlerts = async (enabled: boolean) => {
    setAlertsEnabled(enabled);
    await setNativeNotificationsEnabled(enabled);
  };

  const handleAdminRoleUpdate = async () => {
    if (adminSaving) return;
    if (!selectedUser) {
      Alert.alert('User required', 'Please select a user to update roles.');
      return;
    }

    setAdminSaving(true);
    try {
      const roles = Array.isArray(selectedUser.roles) ? selectedUser.roles : [];
      const nextRoles = grantAdmin
        ? Array.from(new Set([...roles, 'admin']))
        : roles.filter((role: string) => role !== 'admin');
      
      await updateDoc(doc(db, 'users', selectedUser.id), { 
        roles: nextRoles,
        teamId: selectedUser.teamId || 'team-1',
      });

      Alert.alert('Success', grantAdmin ? 'Admin role granted.' : 'Admin role removed.');
      setSelectedUser(null);
      setAdminModalVisible(false);
    } catch (error: any) {
      const message = error?.message ? String(error.message) : 'Unable to update roles.';
      Alert.alert('Notice', message);
    } finally {
      setAdminSaving(false);
    }
  };

  const filteredUsers = React.useMemo(() => {
    if (!searchQuery.trim()) return users.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const q = searchQuery.toLowerCase();
    return users.filter(u => 
      (u.name || '').toLowerCase().includes(q) || 
      (u.email || '').toLowerCase().includes(q)
    ).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [users, searchQuery]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Home</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Admin Options</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.content}>
        <TouchableOpacity
          style={[styles.button, styles.buttonShift]}
          onPress={() => navigation.navigate('WorksiteOverview')}
        >
          <Text style={styles.buttonText}>Shift Calculator</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.buttonCreate]}
          onPress={() => navigation.navigate('AdminSchedule')}
        >
          <Text style={styles.buttonText}>Create Schedule</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.buttonCalendar]}
          onPress={() => navigation.navigate('AdminCalendar')}
        >
          <Text style={styles.buttonText}>Schedule Overview (Calendar)</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.buttonWorksites]}
          onPress={() => navigation.navigate('Geofences')}
        >
          <Text style={styles.buttonText}>Manage Worksites</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.buttonUsers]}
          onPress={() => navigation.navigate('ManageUsers')}
        >
          <Text style={styles.buttonText}>Manage Users</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.buttonAdminRoles]}
          onPress={() => setAdminModalVisible(true)}
        >
          <Text style={styles.buttonText}>Manage Admin Roles</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.buttonEvents]}
          onPress={() => navigation.navigate('AdminAvailability')}
        >
          <Text style={styles.buttonText}>Manage Availability & Staff</Text>
        </TouchableOpacity>

        <View style={{ height: 12 }} />
        
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => navigation.navigate('GeofenceDebug')}
        >
          <Text style={styles.secondaryButtonText}>System Diagnostics (Debug)</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={adminModalVisible} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Update Admin Role</Text>
            <Text style={styles.modalSub}>Select the user to update.</Text>
            
            <TouchableOpacity 
              style={styles.pickerTrigger} 
              onPress={() => setUserPickerVisible(true)}
            >
              <Text style={[styles.pickerTriggerText, !selectedUser && styles.placeholderText]}>
                {selectedUser ? (selectedUser.name || selectedUser.email) : 'Select a user...'}
              </Text>
              <Text style={styles.pickerArrow}>▼</Text>
            </TouchableOpacity>

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>
                {grantAdmin ? 'Grant admin access' : 'Remove admin access'}
              </Text>
              <Switch value={grantAdmin} onValueChange={setGrantAdmin} />
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalLink}
                onPress={() => setAdminModalVisible(false)}
              >
                <Text style={styles.modalLinkText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalButton}
                onPress={handleAdminRoleUpdate}
                disabled={adminSaving}
              >
                {adminSaving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalButtonText}>Update Role</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={userPickerVisible} transparent animationType="slide">
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { maxHeight: '80%' }]}>
            <Text style={styles.modalTitle}>Select User</Text>
            
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name or email..."
              placeholderTextColor="#A88E73"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
            />

            <FlatList
              data={filteredUsers}
              keyExtractor={item => item.id}
              style={{ marginTop: 12 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.userItem}
                  onPress={() => {
                    setSelectedUser(item);
                    setUserPickerVisible(false);
                    setSearchQuery('');
                  }}
                >
                  <Text style={styles.userItemName}>{item.name || 'Unnamed'}</Text>
                  <Text style={styles.userItemEmail}>{item.email}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No users found.</Text>
              }
            />

            <TouchableOpacity
              style={styles.closePickerBtn}
              onPress={() => setUserPickerVisible(false)}
            >
              <Text style={styles.closePickerBtnText}>Close</Text>
            </TouchableOpacity>
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
  back: { fontSize: 18, fontWeight: 'bold', color: '#EBDCCB' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#F6EDE2' },
  content: {
    padding: 16,
    gap: 12,
  },
  button: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  /** Warm palette: gold → orange → deep browns → bronze → sienna → coffee */
  buttonShift: { backgroundColor: '#D9A441' },
  buttonCreate: { backgroundColor: '#C9782B' },
  buttonCalendar: { backgroundColor: '#3A2D24' },
  buttonWorksites: { backgroundColor: '#8B6914' },
  buttonUsers: { backgroundColor: '#A0522D' },
  buttonAdminRoles: { backgroundColor: '#6D4C41' },
  buttonEvents: { backgroundColor: '#4E342E' },
  buttonText: {
    color: '#FFF',
    fontWeight: '700',
  },
  preferenceCard: {
    backgroundColor: '#1E1813',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3A2D24',
    marginBottom: 8,
  },
  prefRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  prefTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F6EDE2',
  },
  prefSub: {
    fontSize: 13,
    color: '#C8B29A',
    marginTop: 2,
  },
  secondaryButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#D9A441',
    fontWeight: '600',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
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
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#F6EDE2' },
  modalSub: { marginTop: 6, color: '#C8B29A' },
  pickerTrigger: {
    backgroundColor: '#3A2D24',
    padding: 14,
    borderRadius: 12,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#5A4739',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pickerTriggerText: {
    color: '#EBDCCB',
    fontSize: 15,
    fontWeight: '600',
  },
  placeholderText: {
    color: '#7C6854',
  },
  pickerArrow: {
    color: '#D9A441',
    fontSize: 12,
  },
  searchInput: {
    backgroundColor: '#3A2D24',
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
    color: '#EBDCCB',
    borderWidth: 1,
    borderColor: '#5A4739',
  },
  userItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#3A2D24',
  },
  userItemName: {
    color: '#F6EDE2',
    fontSize: 15,
    fontWeight: '600',
  },
  userItemEmail: {
    color: '#A88E73',
    fontSize: 13,
    marginTop: 2,
  },
  emptyText: {
    color: '#7C6854',
    textAlign: 'center',
    marginTop: 20,
    fontStyle: 'italic',
  },
  closePickerBtn: {
    marginTop: 16,
    alignItems: 'center',
    padding: 10,
  },
  closePickerBtnText: {
    color: '#D9A441',
    fontWeight: '700',
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
