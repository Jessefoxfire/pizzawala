import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Image,
  TextInput,
  Linking,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  collection,
  onSnapshot,
  query,
  where,
  doc,
  deleteDoc,
  getFirestore,
} from '@react-native-firebase/firestore';
import { Calendar } from 'react-native-calendars';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { Avatars, AvatarKey } from '../../assets/avatars';
import { Icons } from '../components/Icons';
import {
  defaultExportRange,
  downloadSchedulePdfToDevice,
  exportSchedulePdfAndShare,
  filterScheduledInRange,
  formatPeriodLabel,
  type ScheduledShiftRow,
} from '../services/schedulePdf';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminSchedule'>;

type ScheduledShift = ScheduledShiftRow & { id: string };

const SCHEDULE_EXPORT_PHONES_KEY = 'scheduleExportWhatsAppPhones';
const MAX_SAVED_PHONES = 12;

async function loadSavedExportPhones(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(SCHEDULE_EXPORT_PHONES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  } catch {
    return [];
  }
}

async function rememberExportPhone(phone: string) {
  const trimmed = phone.trim();
  if (!trimmed) return;
  const existing = await loadSavedExportPhones();
  const next = [trimmed, ...existing.filter(entry => entry !== trimmed)].slice(0, MAX_SAVED_PHONES);
  await AsyncStorage.setItem(SCHEDULE_EXPORT_PHONES_KEY, JSON.stringify(next));
}

export default function AdminScheduleScreen({ navigation }: Props) {
  const [shifts, setShifts] = useState<ScheduledShift[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');
  const [exportPhone, setExportPhone] = useState('');
  const [savedPhones, setSavedPhones] = useState<string[]>([]);
  const [phonePickerVisible, setPhonePickerVisible] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [datePickerTarget, setDatePickerTarget] = useState<'start' | 'end' | null>(null);
  const fs = getFirestore();

  useEffect(() => {
    const q = query(collection(fs, 'shifts'), where('isScheduled', '==', true));
    const unsubShifts = onSnapshot(q, snap => {
      if (!snap || !snap.docs || snap.empty) {
        setShifts([]);
        setLoading(false);
        return;
      }
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as ScheduledShift));
      items.sort((a, b) => b.date.localeCompare(a.date));
      setShifts(items);
      setLoading(false);
    });

    const unsubUsers = onSnapshot(collection(fs, 'users'), snap => {
      if (!snap || !snap.docs) {
        setUsers([]);
        return;
      }
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubShifts();
      unsubUsers();
    };
  }, [fs]);

  useEffect(() => {
    if (exportStartDate && exportEndDate) return;
    const range = defaultExportRange(shifts);
    setExportStartDate(range.startDate);
    setExportEndDate(range.endDate);
  }, [shifts, exportStartDate, exportEndDate]);

  const refreshSavedPhones = useCallback(async () => {
    const phones = await loadSavedExportPhones();
    setSavedPhones(phones);
  }, []);

  useEffect(() => {
    if (!showExportPanel) return;
    void refreshSavedPhones();
  }, [showExportPanel, refreshSavedPhones]);

  const exportPreviewCount = useMemo(() => {
    if (!exportStartDate || !exportEndDate) return 0;
    try {
      return filterScheduledInRange(shifts, exportStartDate, exportEndDate).length;
    } catch {
      return 0;
    }
  }, [shifts, exportStartDate, exportEndDate]);

  const handleDelete = (id: string) => {
    Alert.alert('Delete Shift', 'Are you sure you want to remove this scheduled shift?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteDoc(doc(fs, 'shifts', id)) },
    ]);
  };

  const handleExportWhatsApp = async () => {
    if (!exportStartDate || !exportEndDate) {
      Alert.alert('Select dates', 'Choose a start and end date for the schedule period.');
      return;
    }
    try {
      const preview = filterScheduledInRange(shifts, exportStartDate, exportEndDate);
      if (preview.length === 0) {
        Alert.alert(
          'No shifts in range',
          'No scheduled shifts fall in this date range. Create an empty PDF anyway?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Continue', onPress: () => void runExport() },
          ]
        );
        return;
      }
      await runExport();
    } catch (err: any) {
      const code = err?.code ? `\n\n(${err.code})` : '';
      Alert.alert('Export failed', `${err?.message || 'Could not create schedule PDF.'}${code}`);
    }
  };

  const runExport = async () => {
    setExporting(true);
    try {
      const result = await exportSchedulePdfAndShare({
        shifts,
        startDate: exportStartDate,
        endDate: exportEndDate,
        whatsAppPhone: exportPhone.trim() || undefined,
      });
      if (result.sharedWithPdf) {
        const trimmedPhone = exportPhone.trim();
        if (trimmedPhone) {
          await rememberExportPhone(trimmedPhone);
          await refreshSavedPhones();
        }
        return;
      }
      const opened = await Linking.canOpenURL(result.whatsAppUrl);
      if (!opened) {
        Alert.alert(
          'WhatsApp unavailable',
          `PDF uploaded. Share this link manually:\n\n${result.downloadUrl}`
        );
        return;
      }
      await Linking.openURL(result.whatsAppUrl);
      const trimmedPhone = exportPhone.trim();
      if (trimmedPhone) {
        await rememberExportPhone(trimmedPhone);
        await refreshSavedPhones();
      }
    } catch (err: any) {
      const code = err?.code ? `\n\n(${err.code})` : '';
      Alert.alert('Export failed', `${err?.message || 'Could not create schedule PDF.'}${code}`);
    } finally {
      setExporting(false);
    }
  };

  const runDownload = async () => {
    setDownloadingPdf(true);
    try {
      await downloadSchedulePdfToDevice({
        shifts,
        startDate: exportStartDate,
        endDate: exportEndDate,
      });
    } catch (err: any) {
      const code = err?.code ? `\n\n(${err.code})` : '';
      Alert.alert('Download failed', `${err?.message || 'Could not save schedule PDF.'}${code}`);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!exportStartDate || !exportEndDate) {
      Alert.alert('Select dates', 'Choose a start and end date for the schedule period.');
      return;
    }
    try {
      const preview = filterScheduledInRange(shifts, exportStartDate, exportEndDate);
      if (preview.length === 0) {
        Alert.alert(
          'No shifts in range',
          'No scheduled shifts fall in this date range. Download an empty PDF anyway?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Continue', onPress: () => void runDownload() },
          ]
        );
        return;
      }
      await runDownload();
    } catch (err: any) {
      const code = err?.code ? `\n\n(${err.code})` : '';
      Alert.alert('Download failed', `${err?.message || 'Could not save schedule PDF.'}${code}`);
    }
  };

  const exportBusy = exporting || downloadingPdf;

  const handleDatePick = (day: { dateString: string }) => {
    if (datePickerTarget === 'start') setExportStartDate(day.dateString);
    if (datePickerTarget === 'end') setExportEndDate(day.dateString);
    setDatePickerTarget(null);
  };

  const renderShift = ({ item }: { item: ScheduledShift }) => {
    const user = users.find(u => u.id === item.userId);
    const avatarKey = (user?.avatarUrl as AvatarKey) || 'pizzaMaker';
    const avatarSource = Avatars[avatarKey] || Avatars.pizzaMaker;

    return (
      <View style={styles.shiftCard}>
        <Image source={avatarSource} style={styles.cardAvatar} />
        <View style={styles.shiftInfo}>
          <Text style={styles.shiftUser}>{item.userName}</Text>
          <Text style={styles.shiftWorksite}>{item.worksiteName}</Text>
          <View style={styles.timeBadge}>
            <Text style={styles.shiftTime}>
              {item.date} • {item.startTime} - {item.endTime}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={() => handleDelete(item.id)} style={styles.deleteBtn}>
          <Icons.trash color="#9E3C2E" width={20} height={20} />
        </TouchableOpacity>
      </View>
    );
  };

  const listHeader = (
    <View style={styles.exportSection}>
      <TouchableOpacity
        style={styles.exportToggle}
        onPress={() => setShowExportPanel(v => !v)}
        activeOpacity={0.85}
      >
        <Text style={styles.exportToggleTitle}>Export schedule PDF</Text>
        <Text style={styles.exportToggleHint}>
          {showExportPanel ? 'Hide' : 'Download or WhatsApp'}
        </Text>
      </TouchableOpacity>

      {showExportPanel ? (
        <View style={styles.exportPanel}>
          <Text style={styles.exportHelp}>
            Create one PDF for a date range. Download to your phone or share on WhatsApp with a link.
          </Text>

          <View style={styles.dateRow}>
            <TouchableOpacity
              style={styles.datePickBtn}
              onPress={() => setDatePickerTarget('start')}
            >
              <Text style={styles.datePickLabel}>Start</Text>
              <Text style={styles.datePickValue}>{exportStartDate || 'Pick date'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.datePickBtn}
              onPress={() => setDatePickerTarget('end')}
            >
              <Text style={styles.datePickLabel}>End</Text>
              <Text style={styles.datePickValue}>{exportEndDate || 'Pick date'}</Text>
            </TouchableOpacity>
          </View>

          {exportStartDate && exportEndDate ? (
            <Text style={styles.previewText}>
              {exportPreviewCount} shift{exportPreviewCount === 1 ? '' : 's'} in{' '}
              {formatPeriodLabel(exportStartDate, exportEndDate)}
            </Text>
          ) : null}

          <Text style={styles.phoneLabel}>WhatsApp number (optional)</Text>
          <View style={styles.phoneRow}>
            <TextInput
              value={exportPhone}
              onChangeText={setExportPhone}
              placeholder="Type or pick a saved number"
              placeholderTextColor="#7A6050"
              keyboardType="phone-pad"
              style={styles.phoneInput}
            />
            {savedPhones.length > 0 ? (
              <TouchableOpacity
                style={styles.phonePickerBtn}
                onPress={() => setPhonePickerVisible(true)}
              >
                <Text style={styles.phonePickerBtnText}>Saved</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {savedPhones.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.phoneChipRow}>
              {savedPhones.map(phone => (
                <TouchableOpacity
                  key={phone}
                  style={[styles.phoneChip, exportPhone === phone && styles.phoneChipActive]}
                  onPress={() => setExportPhone(phone)}
                >
                  <Text style={styles.phoneChipText}>{phone}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : null}

          <TouchableOpacity
            style={[styles.downloadBtn, exportBusy && styles.btnDisabled]}
            onPress={() => void handleDownloadPdf()}
            disabled={exportBusy}
          >
            {downloadingPdf ? (
              <ActivityIndicator color="#C9782B" />
            ) : (
              <Text style={styles.downloadBtnText}>Download / save PDF</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.whatsAppBtn, exportBusy && styles.btnDisabled]}
            onPress={() => void handleExportWhatsApp()}
            disabled={exportBusy}
          >
            {exporting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.whatsAppBtnText}>Create PDF & share on WhatsApp</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icons.arrowLeft color="#F6EDE2" width={24} height={24} />
        </TouchableOpacity>
        <Text style={styles.title}>Team Schedule</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => navigation.navigate('AssignShifts')}>
          <Icons.plus color="#C9782B" width={28} height={28} />
        </TouchableOpacity>
      </View>

      <View style={styles.summaryBar}>
        <Text style={styles.summaryText}>{shifts.length} Active Assignments</Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#C9782B" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={shifts}
          keyExtractor={item => item.id}
          renderItem={renderShift}
          ListHeaderComponent={listHeader}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>No scheduled shifts</Text>
              <Text style={styles.emptySub}>Tap the + button to start planning.</Text>
            </View>
          }
        />
      )}

      <Modal visible={datePickerTarget != null} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {datePickerTarget === 'start' ? 'Period start' : 'Period end'}
            </Text>
            <Calendar
              onDayPress={handleDatePick}
              markedDates={{
                ...(exportStartDate
                  ? { [exportStartDate]: { selected: true, selectedColor: '#C9782B' } }
                  : {}),
                ...(exportEndDate
                  ? { [exportEndDate]: { selected: true, selectedColor: '#C9782B' } }
                  : {}),
              }}
              theme={{
                backgroundColor: '#1E1813',
                calendarBackground: '#1E1813',
                dayTextColor: '#F6EDE2',
                monthTextColor: '#F6EDE2',
                arrowColor: '#C9782B',
                todayTextColor: '#C9782B',
              }}
            />
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setDatePickerTarget(null)}
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={phonePickerVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Saved WhatsApp numbers</Text>
            {savedPhones.map(phone => (
              <TouchableOpacity
                key={phone}
                style={styles.phoneOption}
                onPress={() => {
                  setExportPhone(phone);
                  setPhonePickerVisible(false);
                }}
              >
                <Text style={styles.phoneOptionText}>{phone}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setPhonePickerVisible(false)}
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#2A211B' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#1E1813',
    alignItems: 'center',
  },
  title: { color: '#F6EDE2', fontSize: 20, fontWeight: '900' },
  addBtn: { padding: 4 },
  summaryBar: { backgroundColor: '#3A2D24', paddingVertical: 8, paddingHorizontal: 16 },
  summaryText: {
    color: '#A88E73',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  list: { padding: 16, paddingBottom: 40 },
  exportSection: { marginBottom: 16 },
  exportToggle: {
    backgroundColor: '#1E1813',
    borderWidth: 1,
    borderColor: '#3A2D24',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  exportToggleTitle: { color: '#F6EDE2', fontSize: 15, fontWeight: '800' },
  exportToggleHint: { color: '#C9782B', fontSize: 12, fontWeight: '700' },
  exportPanel: {
    marginTop: 10,
    backgroundColor: '#1E1813',
    borderWidth: 1,
    borderColor: '#3A2D24',
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  exportHelp: { color: '#A88E73', fontSize: 13, lineHeight: 18 },
  dateRow: { flexDirection: 'row', gap: 10 },
  datePickBtn: {
    flex: 1,
    backgroundColor: '#2A211B',
    borderWidth: 1,
    borderColor: '#3A2D24',
    borderRadius: 10,
    padding: 12,
  },
  datePickLabel: {
    color: '#7A6050',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  datePickValue: { color: '#F6EDE2', fontSize: 14, fontWeight: '700' },
  previewText: { color: '#D5C6B8', fontSize: 13 },
  phoneLabel: {
    color: '#7A6050',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  phoneRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  phoneInput: {
    flex: 1,
    backgroundColor: '#2A211B',
    borderWidth: 1,
    borderColor: '#3A2D24',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#F6EDE2',
    fontSize: 14,
  },
  phonePickerBtn: {
    backgroundColor: '#3A2D24',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: '#C9782B',
  },
  phonePickerBtnText: { color: '#C9782B', fontSize: 13, fontWeight: '800' },
  phoneChipRow: { marginTop: -2 },
  phoneChip: {
    backgroundColor: '#2A211B',
    borderWidth: 1,
    borderColor: '#3A2D24',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 8,
  },
  phoneChipActive: { borderColor: '#C9782B', backgroundColor: '#3A2D24' },
  phoneChipText: { color: '#F6EDE2', fontSize: 13, fontWeight: '700' },
  phoneOption: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#3A2D24',
  },
  phoneOptionText: { color: '#F6EDE2', fontSize: 15, fontWeight: '700' },
  downloadBtn: {
    backgroundColor: '#2A211B',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#C9782B',
  },
  downloadBtnText: { color: '#C9782B', fontSize: 14, fontWeight: '900' },
  whatsAppBtn: {
    backgroundColor: '#25D366',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  whatsAppBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  btnDisabled: { opacity: 0.6 },
  shiftCard: {
    flexDirection: 'row',
    backgroundColor: '#1E1813',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
  cardAvatar: { width: 50, height: 50, borderRadius: 25, borderWidth: 2, borderColor: '#3A2D24' },
  shiftInfo: { flex: 1, marginLeft: 16 },
  shiftUser: { color: '#F6EDE2', fontSize: 17, fontWeight: '800', marginBottom: 2 },
  shiftWorksite: {
    color: '#C9782B',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  timeBadge: {
    backgroundColor: '#2A211B',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
  shiftTime: { color: '#A88E73', fontSize: 12, fontWeight: '700' },
  deleteBtn: { padding: 8, backgroundColor: 'rgba(158, 60, 46, 0.1)', borderRadius: 10 },
  emptyContainer: { alignItems: 'center', marginTop: 40 },
  emptyTitle: { color: '#F6EDE2', fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  emptySub: { color: '#A88E73', fontSize: 14 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#1E1813',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    paddingBottom: 28,
  },
  modalTitle: { color: '#F6EDE2', fontSize: 16, fontWeight: '800', marginBottom: 8 },
  modalCloseBtn: {
    marginTop: 12,
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  modalCloseText: { color: '#C9782B', fontSize: 14, fontWeight: '800' },
});
