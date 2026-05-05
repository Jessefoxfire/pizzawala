import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Linking,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
  Image,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from '@react-native-firebase/firestore';
import { pick, types, errorCodes, isErrorWithCode } from '@react-native-documents/picker';
import { auth } from '../services/firebase';
import { parseEventsCsv } from '../utils/parseEventsCsv';
import { readPickedFileAsUtf8 } from '../utils/readPickedDocumentText';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { Icons } from '../components/Icons';
import { Calendar } from 'react-native-calendars';
import { resolveAvatarSource } from '../utils/avatar';

type Props = NativeStackScreenProps<RootStackParamList, 'Events'>;

type Event = {
  id: string;
  title: string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
  arrivalDate: string; // "YYYY-MM-DD"
  startTime: string;
  endTime: string;
  locationName: string;
  locationUrl: string;
  staffIds: string[];
  staffNeeded: number;
  notes: string;
  createdAt: any;
};

type Availability = {
  userId: string;
  userName: string;
  isAvailable: boolean;
  notes: string;
  updatedAt: any;
};

type UserProfile = {
  id: string;
  name: string;
  avatarUrl?: string;
  customAvatarUrl?: string;
};

export default function EventsScreen({ navigation }: Props) {
  const [events, setEvents] = useState<Event[]>([]);
  const [availabilityMap, setAvailabilityMap] = useState<Record<string, Availability[]>>({});
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  
  // Create/Edit Event Modal
  const [modalVisible, setModalVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [arrivalDate, setArrivalDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [locationName, setLocationName] = useState('');
  const [locationUrl, setLocationUrl] = useState('');
  const [staffIds, setStaffIds] = useState<string[]>([]);
  const [staffNeeded, setStaffNeeded] = useState('1');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [csvImporting, setCsvImporting] = useState(false);

  // Date Picker Modal
  const [datePickerConfig, setDatePickerConfig] = useState<{ visible: boolean; field: 'start' | 'end' | 'arrival' }>({
    visible: false,
    field: 'start',
  });

  // Availability Modal
  const [availModalVisible, setAvailModalVisible] = useState(false);
  const [availEventId, setAvailEventId] = useState<string | null>(null);
  const [availNotes, setAvailNotes] = useState('');
  const [submittingAvail, setSubmittingAvail] = useState(false);

  useEffect(() => {
    const user = auth.currentUser;
    if (user) {
      const fs = getFirestore();
    const unsubProfile = onSnapshot(
      doc(fs, 'users', user.uid),
      snap => {
        if (!snap || !snap.exists()) {
          setUserProfile(null);
          setIsAdmin(false);
          return;
        }
        const data = snap.data();
        setUserProfile(data);
        setIsAdmin(Array.isArray(data?.roles) && data.roles.includes('admin'));
      },
      err => {
        setUserProfile(null);
        setIsAdmin(false);
      }
    );
      return () => unsubProfile();
    }
  }, []);

  useEffect(() => {
    const fs = getFirestore();
    setLoadError(null);
    const availUnsubs: Array<() => void> = [];

    const unsubUsers = onSnapshot(
      collection(fs, 'users'),
      snap => {
        if (!snap || !snap.docs) {
          setAllUsers([]);
          return;
        }
        const users = snap.docs.map(d => ({ id: d.id, ...d.data() } as UserProfile));
        setAllUsers(users);
      },
      () => {
        setAllUsers([]);
      }
    );

    const q = query(collection(fs, 'events'), orderBy('startDate', 'asc'));
    const unsubEvents = onSnapshot(
      q,
      snap => {
        if (!snap || !snap.docs || snap.empty) {
          setEvents([]);
          setLoading(false);
          return;
        }
        availUnsubs.forEach(u => u());
        availUnsubs.length = 0;

        const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Event));
        setEvents(items);
        setLoading(false);

        items.forEach(event => {
          const u = onSnapshot(
            collection(fs, 'events', event.id, 'availability'),
            availSnap => {
              if (!availSnap || !availSnap.docs || availSnap.empty) return;
              const avails = availSnap.docs.map(ad => ad.data() as Availability);
              setAvailabilityMap(prev => ({ ...prev, [event.id]: avails }));
            }
          );
          availUnsubs.push(u);
        });
      },
      err => {
        setLoadError(err?.message || String(err));
        setLoading(false);
      }
    );

    return () => {
      unsubUsers();
      unsubEvents();
      availUnsubs.forEach(u => u());
    };
  }, [retryToken]);

  const handleSave = async () => {
    if (!title || !startDate || !endDate || !arrivalDate || !locationName) {
      Alert.alert('Notice', 'Title, Dates, and Location are required.');
      return;
    }

    setSaving(true);
    const fs = getFirestore();
    const payload = {
      title,
      startDate,
      endDate,
      arrivalDate,
      startTime,
      endTime,
      locationName,
      locationUrl,
      staffIds: staffIds || [],
      staffNeeded: parseInt(staffNeeded, 10) || 1,
      notes,
      updatedAt: serverTimestamp(),
    };

    try {
      if (editingId) {
        await updateDoc(doc(fs, 'events', editingId), payload);
      } else {
        await addDoc(collection(fs, 'events'), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      setModalVisible(false);
      resetForm();
    } catch (err: any) {
      Alert.alert('Notice', err.message);
    } finally {
      setSaving(false);
    }
  };

  const submitAvailability = async () => {
    if (!availEventId || !auth.currentUser) return;
    setSubmittingAvail(true);
    try {
      const user = auth.currentUser;
      const fs = getFirestore();
      const availabilityRef = doc(fs, 'events', availEventId, 'availability', user.uid);
      await setDoc(availabilityRef, {
        userId: user.uid,
        userName: userProfile?.name || user.email,
        isAvailable: true,
        notes: availNotes,
        updatedAt: serverTimestamp(),
      });
      setAvailModalVisible(false);
      setAvailNotes('');
      Alert.alert('Success', "Availability saved!");
    } catch (err: any) {
      Alert.alert('Notice', err.message);
    } finally {
      setSubmittingAvail(false);
    }
  };

  const handleImportCsv = async () => {
    if (!isAdmin) return;
    Alert.alert(
      'Import events from CSV',
      'Use a header row:\n' +
        'title,startDate,endDate,arrivalDate,startTime,endTime,locationName,locationUrl,staffNeeded,notes,staffIds\n\n' +
        'Dates: YYYY-MM-DD. staffIds: optional UIDs separated by | or ;\n\n' +
        'Or omit the header and use columns in that exact order.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Choose file',
          onPress: () => void importCsvFromPicker(),
        },
      ]
    );
  };

  const importCsvFromPicker = async () => {
    try {
      const result = await pick({
        type: [types.csv, types.plainText, 'text/comma-separated-values'],
        allowMultiSelection: false,
        ...(Platform.OS === 'android' ? { allowVirtualFiles: true } : {}),
      });
      const file = result[0];
      const name = (file.name || '').toLowerCase();
      const mime = (file.type || '').toLowerCase();
      const looksLikeCsv =
        !name ||
        name.endsWith('.csv') ||
        name.endsWith('.txt') ||
        mime.includes('csv') ||
        mime.includes('comma-separated') ||
        mime.includes('text/plain');
      if (!looksLikeCsv) {
        Alert.alert('Notice', 'Please pick a CSV or plain-text file.');
        return;
      }
      const text = await readPickedFileAsUtf8(file);
      const { rows, errors } = parseEventsCsv(text);
      if (rows.length === 0) {
        Alert.alert(
          'CSV',
          errors.length ? errors.slice(0, 12).join('\n') : 'No valid event rows found.'
        );
        return;
      }
      setCsvImporting(true);
      const fs = getFirestore();
      let ok = 0;
      const writeErrors: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        try {
          await addDoc(collection(fs, 'events'), {
            title: r.title,
            startDate: r.startDate,
            endDate: r.endDate,
            arrivalDate: r.arrivalDate,
            startTime: r.startTime,
            endTime: r.endTime,
            locationName: r.locationName,
            locationUrl: r.locationUrl,
            staffIds: r.staffIds,
            staffNeeded: r.staffNeeded,
            notes: r.notes,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          ok++;
        } catch (e: any) {
          writeErrors.push(`Row ${i + 1}: ${e?.message || 'write failed'}`);
        }
      }
      const warn = errors.length ? `\n\nWarnings:\n${errors.slice(0, 8).join('\n')}` : '';
      const werr = writeErrors.length ? `\n\nWrite errors:\n${writeErrors.slice(0, 6).join('\n')}` : '';
      Alert.alert('Import complete', `Imported ${ok} of ${rows.length} events.${warn}${werr}`);
    } catch (e: any) {
      if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return;
      Alert.alert('Import failed', e?.message || String(e));
    } finally {
      setCsvImporting(false);
    }
  };

  const resetForm = () => {
    setTitle('');
    setStartDate('');
    setEndDate('');
    setArrivalDate('');
    setStartTime('');
    setEndTime('');
    setLocationName('');
    setLocationUrl('');
    setStaffIds([]);
    setStaffNeeded('1');
    setNotes('');
    setEditingId(null);
  };

  const openEdit = (event: Event) => {
    setTitle(event.title);
    setStartDate(event.startDate);
    setEndDate(event.endDate || event.startDate);
    setArrivalDate(event.arrivalDate || event.startDate);
    setStartTime(event.startTime || '');
    setEndTime(event.endTime || '');
    setLocationName(event.locationName);
    setLocationUrl(event.locationUrl);
    setStaffIds(event.staffIds || []);
    setStaffNeeded((event.staffNeeded || 1).toString());
    setNotes(event.notes);
    setEditingId(event.id);
    setModalVisible(true);
  };

  const openAvail = (eventId: string) => {
    const existing = availabilityMap[eventId]?.find(a => a.userId === auth.currentUser?.uid);
    setAvailNotes(existing?.notes || '');
    setAvailEventId(eventId);
    setAvailModalVisible(true);
  };

  const toggleStaffSelection = (uid: string) => {
    setStaffIds(prev => 
      prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]
    );
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'Select';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return dateStr; }
  };

  const renderEvent = ({ item }: { item: Event }) => {
    const avails = availabilityMap[item.id] || [];
    const filteredAvails = avails.filter(a => a.isAvailable && !(item.staffIds || []).includes(a.userId));
    const availableCount = filteredAvails.length;
    const myAvail = filteredAvails.find(a => a.userId === auth.currentUser?.uid);
    const confirmedCount = (item.staffIds || []).length;
    const neededCount = (item.staffNeeded || 1) - confirmedCount;
    const isComplete = neededCount <= 0;

    const dateRange = item.startDate === item.endDate 
      ? formatDate(item.startDate) 
      : `${formatDate(item.startDate)} - ${formatDate(item.endDate)}`;

    return (
      <View style={styles.eventCard}>
        <View style={styles.eventHeader}>
          <View style={{flex: 1}}>
            <Text style={styles.eventTitle}>{item.title}</Text>
            <Text style={styles.eventDateRange}>{dateRange}</Text>
          </View>
          <View style={styles.arrivalBox}>
            <Text style={styles.arrivalLabel}>TEAM ARRIVAL</Text>
            <Text style={styles.arrivalDateText}>{formatDate(item.arrivalDate)} @ {item.startTime || 'TBD'}</Text>
          </View>
        </View>
        
        <TouchableOpacity 
          style={styles.locationRow} 
          onPress={() => item.locationUrl && Linking.openURL(item.locationUrl)}
        >
          <Icons.location color="#C9782B" width={14} height={14} />
          <Text style={[styles.locationText, item.locationUrl && styles.linkText]}>
            {item.locationName}
          </Text>
          {item.endTime ? <Text style={styles.timeText}> • Finish: {item.endTime}</Text> : null}
        </TouchableOpacity>

        <View style={styles.staffStatusRow}>
          <View style={styles.staffRow}>
            <Icons.users color={isComplete ? '#4CAF50' : '#A88E73'} width={16} height={16} />
            <Text style={[styles.staffText, isComplete && styles.staffTextComplete]}>
              Team: {isComplete ? 'Complete' : `${neededCount} more needed`}
            </Text>
          </View>
          <View style={styles.miniAvatarRow}>
            {(item.staffIds || []).slice(0, 5).map(uid => {
              const u = allUsers.find(user => user.id === uid);
              return (
                <Image 
                  key={uid}
                  source={resolveAvatarSource(u?.avatarUrl, u?.customAvatarUrl)}
                  style={styles.tinyAvatar}
                />
              );
            })}
            {confirmedCount > 5 && <Text style={styles.plusMore}>+{confirmedCount - 5}</Text>}
          </View>
        </View>

        <View style={styles.availSummary}>
          <View style={{flex: 1}}>
            <Text style={styles.availCount}>{availableCount} Member{availableCount !== 1 ? 's' : ''} Available</Text>
            {availableCount > 0 && <Text style={styles.availPreview}>{filteredAvails.map(a => a.userName).join(', ')}</Text>}
          </View>
          {!(item.staffIds || []).includes(auth.currentUser?.uid || '') && (
            <TouchableOpacity style={[styles.availBtn, myAvail && styles.availBtnActive]} onPress={() => openAvail(item.id)}>
              <Text style={[styles.availBtnText, myAvail && styles.availBtnTextActive]}>{myAvail ? '✓ Update' : 'I am available'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {isAdmin && (
          <View style={styles.adminActions}>
            <View style={{flexDirection: 'row', gap: 12}}>
              <TouchableOpacity onPress={() => openEdit(item)} style={styles.editBtn}><Text style={styles.editBtnText}>Edit Event</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => { Alert.alert('Delete', 'Delete this event?', [{text:'Cancel'}, {text:'Delete', style:'destructive', onPress:()=>deleteDoc(doc(getFirestore(),'events',item.id))}])}} style={styles.deleteBtn}><Text style={styles.deleteBtnText}>Delete</Text></TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  };

  const getActiveDatePickerValue = () => {
    if (datePickerConfig.field === 'start') return startDate;
    if (datePickerConfig.field === 'end') return endDate;
    if (datePickerConfig.field === 'arrival') return arrivalDate;
    return '';
  };

  const setDateValue = (val: string) => {
    if (datePickerConfig.field === 'start') setStartDate(val);
    if (datePickerConfig.field === 'end') setEndDate(val);
    if (datePickerConfig.field === 'arrival') setArrivalDate(val);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Icons.arrowLeft color="#F6EDE2" width={24} height={24} /></TouchableOpacity>
        <Text style={styles.title}>Events Hub</Text>
        {isAdmin ? (
          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={handleImportCsv}
              disabled={csvImporting}
              style={styles.csvBtn}
            >
              {csvImporting ? (
                <ActivityIndicator color="#C9782B" size="small" />
              ) : (
                <Text style={styles.csvBtnText}>CSV</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { resetForm(); setModalVisible(true); }}>
              <Icons.plus color="#C9782B" width={28} height={28} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ width: 28 }} />
        )}
      </View>

      {loadError ? (
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{loadError}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => {
              setLoadError(null);
              setLoading(true);
              setRetryToken(t => t + 1);
            }}
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : loading ? (
        <ActivityIndicator size="large" color="#C9782B" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={events}
          keyExtractor={item => item.id}
          renderItem={renderEvent}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No upcoming events.</Text>}
        />
      )}

      {/* Main Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalBg}>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.modalTitle}>{editingId ? 'Edit Event' : 'New Event'}</Text>
            
            <Text style={styles.label}>Event Title</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Glastonbury Festival" placeholderTextColor="#5A4739" />

            <View style={styles.gridRow}>
              <View style={{flex:1}}>
                <Text style={styles.label}>Start Date</Text>
                <TouchableOpacity style={styles.dateBtn} onPress={() => setDatePickerConfig({ visible: true, field: 'start' })}><Text style={styles.dateBtnText}>{startDate || 'Select'}</Text></TouchableOpacity>
              </View>
              <View style={{flex:1}}>
                <Text style={styles.label}>End Date</Text>
                <TouchableOpacity style={styles.dateBtn} onPress={() => setDatePickerConfig({ visible: true, field: 'end' })}><Text style={styles.dateBtnText}>{endDate || 'Select'}</Text></TouchableOpacity>
              </View>
            </View>

            <View style={styles.gridRow}>
              <View style={{flex:1}}>
                <Text style={styles.label}>Team Arrival Date</Text>
                <TouchableOpacity style={styles.dateBtn} onPress={() => setDatePickerConfig({ visible: true, field: 'arrival' })}><Text style={styles.dateBtnText}>{arrivalDate || 'Select'}</Text></TouchableOpacity>
              </View>
              <View style={{flex:1}}>
                <Text style={styles.label}>Arrival Time</Text>
                <TextInput style={styles.input} value={startTime} onChangeText={setStartTime} placeholder="e.g. 2 PM" placeholderTextColor="#5A4739" />
              </View>
            </View>

            <View style={styles.gridRow}>
              <View style={{flex:1}}>
                <Text style={styles.label}>Shift End Time</Text>
                <TextInput style={styles.input} value={endTime} onChangeText={setEndTime} placeholder="e.g. 10 PM" placeholderTextColor="#5A4739" />
              </View>
              <View style={{flex:1}}>
                <Text style={styles.label}>People Needed</Text>
                <TextInput style={styles.input} value={staffNeeded} onChangeText={setStaffNeeded} keyboardType="numeric" placeholder="1" placeholderTextColor="#5A4739" />
              </View>
            </View>

            <Text style={styles.label}>Location Name</Text>
            <TextInput style={styles.input} value={locationName} onChangeText={setLocationName} placeholder="Central Park" placeholderTextColor="#5A4739" />

            <Text style={styles.label}>Google Maps Link</Text>
            <TextInput style={styles.input} value={locationUrl} onChangeText={setLocationUrl} placeholder="https://goo.gl/maps/..." placeholderTextColor="#5A4739" />

            <Text style={styles.label}>Confirmed Staff</Text>
            <View style={styles.staffPicker}>
              {allUsers.map(user => {
                const isSelected = staffIds.includes(user.id);
                return (
                  <TouchableOpacity key={user.id} style={[styles.staffPickerItem, isSelected && styles.staffPickerItemActive]} onPress={() => toggleStaffSelection(user.id)}>
                    <Image source={resolveAvatarSource(user.avatarUrl, user.customAvatarUrl)} style={styles.pickerAvatar} />
                    <Text style={[styles.staffPickerName, isSelected && styles.staffPickerNameActive]}>{user.name}</Text>
                    {isSelected && <Text style={styles.checkMark}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.label}>Event Notes</Text>
            <TextInput style={[styles.input, styles.textArea]} value={notes} onChangeText={setNotes} multiline numberOfLines={4} placeholder="Load-in at arrival gate 4..." placeholderTextColor="#5A4739" />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setModalVisible(false); resetForm(); }}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>{saving ? <ActivityIndicator color="#1E1813" /> : <Text style={styles.saveText}>Save Event</Text>}</TouchableOpacity>
            </View>
          </ScrollView>
        </View>

        {/* Calendar Picker Modal */}
        <Modal visible={datePickerConfig.visible} transparent animationType="fade">
          <View style={styles.datePickerOverlay}>
            <View style={styles.calendarCard}>
              <Text style={styles.calendarTitle}>Select {datePickerConfig.field.toUpperCase()} Date</Text>
              <Calendar
                theme={{
                  backgroundColor: '#1E1813', calendarBackground: '#1E1813', selectedDayBackgroundColor: '#C9782B',
                  dayTextColor: '#F6EDE2', monthTextColor: '#F6EDE2', textDisabledColor: '#3A2D24',
                }}
                onDayPress={(day: any) => { setDateValue(day.dateString); setDatePickerConfig({ ...datePickerConfig, visible: false }); }}
                markedDates={{ [getActiveDatePickerValue()]: { selected: true, selectedColor: '#C9782B' } }}
              />
              <TouchableOpacity onPress={() => setDatePickerConfig({ ...datePickerConfig, visible: false })} style={styles.closeCalendarBtn}><Text style={styles.closeCalendarBtnText}>Close</Text></TouchableOpacity>
            </View>
          </View>
        </Modal>
      </Modal>

      {/* Availability Notes Modal */}
      <Modal visible={availModalVisible} animationType="fade" transparent>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Set Availability</Text>
            <Text style={styles.label}>Availability Notes (Optional)</Text>
            <TextInput style={[styles.input, styles.textArea]} value={availNotes} onChangeText={setAvailNotes} placeholder="Available Friday & Saturday only." placeholderTextColor="#5A4739" multiline />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setAvailModalVisible(false)}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={submitAvailability} disabled={submittingAvail}>{submittingAvail ? <ActivityIndicator color="#1E1813" /> : <Text style={styles.saveText}>Confirm Availability</Text>}</TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#2A211B' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, backgroundColor: '#1E1813', alignItems: 'center' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  csvBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#C9782B', minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  csvBtnText: { color: '#C9782B', fontWeight: '900', fontSize: 13 },
  title: { color: '#F6EDE2', fontSize: 20, fontWeight: '900' },
  list: { padding: 16, paddingBottom: 40 },
  eventCard: { backgroundColor: '#1E1813', padding: 16, borderRadius: 16, marginBottom: 16, borderWidth: 1, borderColor: '#3A2D24' },
  eventHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  eventTitle: { color: '#F6EDE2', fontSize: 18, fontWeight: '800', flex: 1 },
  eventDateRange: { color: '#C9782B', fontSize: 13, fontWeight: '700', marginTop: 2 },
  arrivalBox: { backgroundColor: '#2A211B', padding: 6, borderRadius: 8, borderWidth: 1, borderColor: '#3A2D24', alignItems: 'flex-end' },
  arrivalLabel: { color: '#7C6854', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  arrivalDateText: { color: '#F6EDE2', fontSize: 11, fontWeight: '700' },
  locationRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  locationText: { color: '#EBDCCB', marginLeft: 6, fontSize: 14 },
  timeText: { color: '#A88E73', fontSize: 12 },
  linkText: { textDecorationLine: 'underline', color: '#D9A441' },
  staffStatusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  staffRow: { flexDirection: 'row', alignItems: 'center' },
  staffText: { color: '#A88E73', marginLeft: 8, fontSize: 13, fontWeight: '600' },
  staffTextComplete: { color: '#4CAF50' },
  miniAvatarRow: { flexDirection: 'row', alignItems: 'center' },
  tinyAvatar: { width: 24, height: 24, borderRadius: 12, marginLeft: -8, borderWidth: 1, borderColor: '#1E1813' },
  plusMore: { color: '#A88E73', fontSize: 10, marginLeft: 4, fontWeight: '800' },
  availSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTopWidth: 1, borderTopColor: '#3A2D24' },
  availCount: { color: '#C8B29A', fontSize: 12, fontWeight: '700' },
  availPreview: { color: '#7C6854', fontSize: 10, marginTop: 1 },
  availBtn: { backgroundColor: '#3A2D24', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  availBtnActive: { backgroundColor: 'rgba(76, 175, 80, 0.1)', borderWidth: 1, borderColor: '#4CAF50' },
  availBtnText: { color: '#F6EDE2', fontSize: 11, fontWeight: '700' },
  availBtnTextActive: { color: '#4CAF50' },
  adminActions: { marginTop: 16, gap: 12, borderTopWidth: 1, borderTopColor: '#3A2D24', paddingTop: 16 },
  viewAvailBtn: { backgroundColor: 'rgba(201, 120, 43, 0.1)', paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  viewAvailBtnText: { color: '#C9782B', fontSize: 12, fontWeight: '700' },
  editBtn: { paddingVertical: 8, borderRadius: 8, backgroundColor: '#3A2D24', flex: 1, alignItems: 'center' },
  editBtnText: { color: '#F6EDE2', fontSize: 13, fontWeight: '700' },
  deleteBtn: { paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(158, 60, 46, 0.1)', flex: 1, alignItems: 'center' },
  deleteBtnText: { color: '#9E3C2E', fontSize: 13, fontWeight: '700' },
  empty: { color: '#A88E73', textAlign: 'center', marginTop: 40, fontStyle: 'italic' },
  errorWrap: { padding: 24, marginTop: 24, alignItems: 'center' },
  errorText: { color: '#9E3C2E', textAlign: 'center', fontSize: 14, marginBottom: 16 },
  retryBtn: { backgroundColor: '#3A2D24', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#C9782B' },
  retryBtnText: { color: '#C9782B', fontWeight: '800' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#1E1813', borderRadius: 24, padding: 24, borderWidth: 1, borderColor: '#3A2D24' },
  modalContent: { backgroundColor: '#1E1813', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '95%' },
  modalTitle: { color: '#F6EDE2', fontSize: 20, fontWeight: '900', marginBottom: 16, textAlign: 'center' },
  label: { color: '#A88E73', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', marginTop: 14, marginBottom: 4, letterSpacing: 1 },
  gridRow: { flexDirection: 'row', gap: 12 },
  input: { backgroundColor: '#2A211B', color: '#F6EDE2', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#3A2D24' },
  dateBtn: { backgroundColor: '#2A211B', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#3A2D24', alignItems: 'center' },
  dateBtnText: { color: '#F6EDE2', fontSize: 14 },
  staffPicker: { backgroundColor: '#2A211B', borderRadius: 12, padding: 6, borderWidth: 1, borderColor: '#3A2D24', marginTop: 4 },
  staffPickerItem: { flexDirection: 'row', alignItems: 'center', padding: 8, borderRadius: 8, marginBottom: 2 },
  staffPickerItemActive: { backgroundColor: 'rgba(201, 120, 43, 0.15)' },
  pickerAvatar: { width: 28, height: 28, borderRadius: 14, marginRight: 10 },
  staffPickerName: { color: '#A88E73', fontSize: 14, flex: 1 },
  staffPickerNameActive: { color: '#F6EDE2', fontWeight: '700' },
  checkMark: { color: '#C9782B', fontSize: 16, fontWeight: '900' },
  textArea: { height: 80, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', marginTop: 24, gap: 12, marginBottom: 40 },
  cancelBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#3A2D24' },
  cancelText: { color: '#A88E73', fontWeight: 'bold' },
  saveBtn: { flex: 2, backgroundColor: '#C9782B', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  saveText: { color: '#1E1813', fontWeight: '900', fontSize: 15 },
  datePickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 },
  calendarCard: { backgroundColor: '#1E1813', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: '#3A2D24' },
  calendarTitle: { color: '#C9782B', fontSize: 14, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
  closeCalendarBtn: { marginTop: 12, padding: 10, alignItems: 'center' },
  closeCalendarBtnText: { color: '#C9782B', fontWeight: 'bold' },
});
