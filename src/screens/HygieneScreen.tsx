import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import PizzaFireCalendar from '../components/PizzaFireCalendar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  collection,
  doc,
  getFirestore,
  onSnapshot,
  query,
  where,
} from '@react-native-firebase/firestore';
import { auth } from '../services/firebase';
import { useAuth } from '../auth/useAuth';
import type { RootStackParamList } from '../navigation/AppNavigator';
import {
  deleteHygieneCredential,
  deleteTemperatureLog,
  downloadMonthlyHygieneExport,
  formatDateTime,
  generateMonthlyHygieneExport,
  getTimestampMs,
  localDateKey,
  openOrDownloadHygieneExport,
  recordTemperature,
  renameHygieneCredential,
  TEMPERATURE_TARGETS,
  updateHygieneCredentialFolder,
  updateTemperatureLog,
} from '../services/hygiene';
import { useHygieneCredentialUpload } from '../hooks/useHygieneCredentialUpload';
import { getPendingTemperatureLogs } from '../context/OfflineContext';
import { subscribeOutboxChanges } from '../offline/events';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import PizzaFireScreen from '../components/PizzaFireScreen';
import HygieneFolderPickerModal from '../components/HygieneFolderPickerModal';
import {
  credentialsInFolder,
  HYGIENE_DOCUMENT_FOLDERS,
  hygieneDocumentFolderLabel,
  inferHygieneDocumentFolder,
  type HygieneDocumentFolderKey,
} from '../utils/hygieneDocumentFolders';
import {
  formatHygieneMonthLabel,
  groupTemperatureLogsByMonth,
  splitLogsByCalendarYear,
} from '../utils/hygieneTemperatureLogs';
import { dateToTimeString, timeStringToDate } from '../utils/eventDays';
import { DEFAULT_COOLING_UNITS, saveCoolingUnits, subscribeCoolingUnits, type CoolingUnit } from '../services/hygieneUnits';
import { isPersonnelDocument } from '../utils/personnelDocuments';
import {
  createCustomHygieneDocumentFolder,
  deleteDefaultHygieneDocumentFolder,
  deleteCustomHygieneDocumentFolder,
  renameDefaultHygieneDocumentFolder,
  renameCustomHygieneDocumentFolder,
  subscribeCustomHygieneDocumentFolders,
  subscribeHygieneDocumentFolderPreferences,
  type CustomHygieneDocumentFolder,
  type HygieneDocumentFolderPreferences,
} from '../services/hygieneDocumentFolders';

type Props = NativeStackScreenProps<RootStackParamList, 'Hygiene'>;

const currentMonth = new Date().toISOString().slice(0, 7);

function buildEmptyTemperatures(units: CoolingUnit[] = DEFAULT_COOLING_UNITS) {
  return Object.fromEntries(units.map(target => [target.key, '']));
}

function coolingUnitKey(label: string) {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export default function HygieneScreen({ navigation }: Props) {
  const { pickAndUpload, nameConfirmModal, sourcePickerModal, isPicking, isConfirming, isUploading } = useHygieneCredentialUpload();
  const userId = auth.currentUser?.uid || null;
  const authState = useAuth();
  const isAdmin = authState.status === 'admin';
  const [teamId, setTeamId] = useState('team-1');
  const [coolingUnits, setCoolingUnits] = useState<CoolingUnit[]>(DEFAULT_COOLING_UNITS);
  const [editingCoolingUnits, setEditingCoolingUnits] = useState(false);
  const [draftCoolingUnits, setDraftCoolingUnits] = useState<CoolingUnit[]>([]);
  const [newCoolingUnit, setNewCoolingUnit] = useState('');
  const [savingCoolingUnits, setSavingCoolingUnits] = useState(false);
  const [credentials, setCredentials] = useState<any[]>([]);
  const [customDocFolders, setCustomDocFolders] = useState<CustomHygieneDocumentFolder[]>([]);
  const [renamingCredential, setRenamingCredential] = useState<any | null>(null);
  const [documentActionItem, setDocumentActionItem] = useState<any | null>(null);
  const [folderAction, setFolderAction] = useState<{ folder: { key: HygieneDocumentFolderKey; label: string }; isDefault: boolean } | null>(null);
  const [credentialNameDraft, setCredentialNameDraft] = useState('');
  const [savingCredentialName, setSavingCredentialName] = useState(false);
  const [docFolderPreferences, setDocFolderPreferences] = useState<HygieneDocumentFolderPreferences>({ hiddenDefaultFolderKeys: [], defaultFolderLabels: {} });
  const [newDocFolderName, setNewDocFolderName] = useState('');
  const [newDocFolderModalOpen, setNewDocFolderModalOpen] = useState(false);
  const [editingDocFolder, setEditingDocFolder] = useState<CustomHygieneDocumentFolder | null>(null);
  const [editingDefaultDocFolder, setEditingDefaultDocFolder] = useState<HygieneDocumentFolderKey | null>(null);
  const [savingDocFolder, setSavingDocFolder] = useState(false);
  const [temperatureHistory, setTemperatureHistory] = useState<any[]>([]);
  const [temperatures, setTemperatures] = useState<Record<string, string>>(buildEmptyTemperatures);
  const [unitNotes, setUnitNotes] = useState<Record<string, string>>(buildEmptyTemperatures);
  const [noteModalKey, setNoteModalKey] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingUnitKey, setSavingUnitKey] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [uploadButtonState, setUploadButtonState] = useState<'idle' | 'uploading' | 'success'>('idle');
  const uploadSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [deletingCredentialId, setDeletingCredentialId] = useState<string | null>(null);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logYear, setLogYear] = useState<string | null>(null);
  const [openDocFolder, setOpenDocFolder] = useState<HygieneDocumentFolderKey | null>(null);
  const [folderPicker, setFolderPicker] = useState<{
    mode: 'upload' | 'move';
    credential?: any;
  } | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [deletingTempId, setDeletingTempId] = useState<string | null>(null);
  const [editingLog, setEditingLog] = useState<{
    id: string;
    label: string;
    value: string;
    notes: string;
    dateKey: string;
    time: string;
  } | null>(null);
  const [addingLog, setAddingLog] = useState<{
    targetKey: string;
    label: string;
    value: string;
    notes: string;
    dateKey: string;
  } | null>(null);
  const [addDatePickerOpen, setAddDatePickerOpen] = useState(false);
  const [editTimePickerOpen, setEditTimePickerOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [savingAdd, setSavingAdd] = useState(false);
  const [pendingTemps, setPendingTemps] = useState<any[]>([]);
  const [monthKey, setMonthKey] = useState(currentMonth);
  const [exporting, setExporting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadingExportId, setDownloadingExportId] = useState<string | null>(null);
  const [exportsList, setExportsList] = useState<any[]>([]);
  const editTimeValue = useMemo(
    () => timeStringToDate(editingLog?.time || '09:00'),
    [editingLog?.time]
  );

  const refreshPendingTemps = React.useCallback(async () => {
    const items = await getPendingTemperatureLogs();
    setPendingTemps(items);
  }, []);

  useEffect(() => {
    return () => {
      if (uploadSuccessTimeoutRef.current) clearTimeout(uploadSuccessTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    void refreshPendingTemps();
    return subscribeOutboxChanges(() => {
      void refreshPendingTemps();
    });
  }, [refreshPendingTemps]);

  useEffect(() => {
    const fs = getFirestore();
    const unsubTemps = onSnapshot(query(collection(fs, 'hygieneTemperatureLogs')), snap => {
      const items = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
      items.sort(
        (a: any, b: any) =>
          getTimestampMs(a.loggedAt, a.loggedAtIso) - getTimestampMs(b.loggedAt, b.loggedAtIso)
      );
      setTemperatureHistory(items);
    });

    const unsubExports = onSnapshot(query(collection(fs, 'hygieneExports')), snap => {
      const items = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
      items.sort(
        (a: any, b: any) => getTimestampMs(b.createdAt, b.createdAtIso) - getTimestampMs(a.createdAt, a.createdAtIso)
      );
      setExportsList(items.slice(0, 10));
    });

    if (!userId) {
      setCredentials([]);
      return () => {
        unsubTemps();
        unsubExports();
      };
    }

    const credentialQuery = query(
      collection(fs, 'hygieneCredentials'),
      where('employeeUid', '==', userId)
    );
    const unsubCredentials = onSnapshot(credentialQuery, snap => {
      const items = snap.docs
        .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
        .filter(item => !isPersonnelDocument(item));
      items.sort((a: any, b: any) => {
        const aMs = new Date(a.uploadedAtIso || 0).getTime();
        const bMs = new Date(b.uploadedAtIso || 0).getTime();
        return bMs - aMs;
      });
      setCredentials(items);
    });

    return () => {
      unsubTemps();
      unsubCredentials();
      unsubExports();
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setTeamId('team-1');
      return undefined;
    }
    return onSnapshot(doc(getFirestore(), 'users', userId), snapshot => {
      setTeamId(String(snapshot.data()?.teamId || '').trim() || 'team-1');
    });
  }, [userId]);

  useEffect(() => subscribeCoolingUnits(teamId, setCoolingUnits), [teamId]);

  useEffect(() => subscribeCustomHygieneDocumentFolders(userId, setCustomDocFolders), [userId]);

  useEffect(() => subscribeHygieneDocumentFolderPreferences(userId, setDocFolderPreferences), [userId]);

  const canUpload =
    !!userId && uploadButtonState === 'idle' && !isPicking && !isConfirming && !isUploading;
  const uploadButtonBusy = isUploading;
  const mergedTemperatureHistory = useMemo(
    () =>
      [...temperatureHistory, ...pendingTemps].sort(
        (a, b) => getTimestampMs(a.loggedAt, a.loggedAtIso) - getTimestampMs(b.loggedAt, b.loggedAtIso)
      ),
    [temperatureHistory, pendingTemps]
  );
  const targets = coolingUnits;
  const visibleTargets = editingCoolingUnits ? draftCoolingUnits : targets;
  const latestByUnit = useMemo(
    () =>
      targets.map(target => {
        const entries = mergedTemperatureHistory.filter(item => String(item.targetKey) === target.key);
        return {
          target,
          latest: entries.length > 0 ? entries[entries.length - 1] : null,
        };
      }).sort((a, b) => {
        const bMs = b.latest ? getTimestampMs(b.latest.loggedAt, b.latest.loggedAtIso) : -1;
        const aMs = a.latest ? getTimestampMs(a.latest.loggedAt, a.latest.loggedAtIso) : -1;
        return bMs - aMs;
      }),
    [targets, mergedTemperatureHistory]
  );
  const consolidatedLogEntries = useMemo(
    () =>
      mergedTemperatureHistory
        .slice()
        .sort(
          (a, b) =>
            getTimestampMs(b.loggedAt, b.loggedAtIso) - getTimestampMs(a.loggedAt, a.loggedAtIso)
        ),
    [mergedTemperatureHistory]
  );
  const hasAnyTemperatureLogs = consolidatedLogEntries.length > 0;
  const coolingYearSplit = useMemo(
    () => splitLogsByCalendarYear(consolidatedLogEntries),
    [consolidatedLogEntries]
  );
  const openedYearLogs = logYear
    ? coolingYearSplit.previousYears.find(group => group.year === logYear)?.items || []
    : [];
  const documentFolders = useMemo(
    () => [
      ...HYGIENE_DOCUMENT_FOLDERS
        .filter(folder => !docFolderPreferences.hiddenDefaultFolderKeys.includes(folder.key))
        .map(folder => ({ ...folder, label: docFolderPreferences.defaultFolderLabels[folder.key] || folder.label })),
      ...customDocFolders,
    ],
    [customDocFolders, docFolderPreferences]
  );
  const folderCounts = useMemo(
    () =>
      Object.fromEntries(
        documentFolders.map(folder => [
          folder.key,
          credentialsInFolder(credentials, folder.key).length,
        ])
      ) as Record<HygieneDocumentFolderKey, number>,
    [credentials, documentFolders]
  );
  const folderDocuments = useMemo(
    () => (openDocFolder ? credentialsInFolder(credentials, openDocFolder) : []),
    [credentials, openDocFolder]
  );

  const updateTemperature = (targetKey: string, value: string) => {
    const cleaned = value.replace(/[^0-9.-]/g, '');
    setTemperatures(current => ({ ...current, [targetKey]: cleaned }));
  };

  const openUnitNote = (targetKey: string) => {
    setNoteModalKey(targetKey);
    setNoteDraft(String(unitNotes[targetKey] || ''));
  };

  const closeUnitNote = () => {
    setNoteModalKey(null);
    setNoteDraft('');
  };

  const saveUnitNote = () => {
    if (!noteModalKey) return;
    setUnitNotes(current => ({ ...current, [noteModalKey]: noteDraft.trim() }));
    closeUnitNote();
  };

  const collectFilledEntries = () =>
    targets
      .map(target => ({
        target,
        value: String(temperatures[target.key] || '').trim(),
        note: String(unitNotes[target.key] || '').trim(),
      }))
      .filter(entry => entry.value);

  const handleConfirmUnit = (target: CoolingUnit) => {
    const value = String(temperatures[target.key] || '').trim();
    if (!value) {
      Alert.alert('Temperature required', `Enter a temperature for ${target.label}.`);
      return;
    }

    if (!Number.isFinite(Number.parseFloat(value))) {
      Alert.alert('Invalid temperature', `Enter a valid number for ${target.label}.`);
      return;
    }

    const note = String(unitNotes[target.key] || '').trim();
    Alert.alert(
      'Confirm temperature',
      note
        ? `Log ${target.label}: ${value}°C?\n\nNote: ${note}`
        : `Log ${target.label}: ${value}°C?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: () => void submitUnitTemperature(target, value, note),
        },
      ]
    );
  };

  const handleLogAll = () => {
    const filled = collectFilledEntries();
    if (filled.length === 0) {
      Alert.alert('Temperature required', 'Enter at least one temperature to log.');
      return;
    }

    const invalid = filled.filter(entry => !Number.isFinite(Number.parseFloat(entry.value)));
    if (invalid.length > 0) {
      Alert.alert(
        'Invalid temperature',
        `Enter a valid number for ${invalid.map(entry => entry.target.label).join(', ')}.`
      );
      return;
    }

    const summary = filled
      .map(entry =>
        entry.note
          ? `${entry.target.label}: ${entry.value}°C (Note: ${entry.note})`
          : `${entry.target.label}: ${entry.value}°C`
      )
      .join('\n');

    Alert.alert(
      'Confirm temperatures',
      `Log ${filled.length} ${filled.length === 1 ? 'entry' : 'entries'}?\n\n${summary}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => void submitAllTemperatures(filled) },
      ]
    );
  };

  const submitUnitTemperature = async (
    target: CoolingUnit,
    value: string,
    note: string
  ) => {
    setSavingUnitKey(target.key);
    try {
      const result = await recordTemperature(target, value, 'C', note);
      await refreshPendingTemps();
      setTemperatures(current => ({ ...current, [target.key]: '' }));
      setUnitNotes(current => ({ ...current, [target.key]: '' }));
      Alert.alert(
        result.queued ? 'Saved offline' : 'Saved',
        result.queued
          ? `${target.label} saved on this device and will sync when you are back online.`
          : `${target.label} temperature logged.`
      );
    } catch (error: any) {
      Alert.alert('Could not save', error?.message || 'Temperature log failed.');
    } finally {
      setSavingUnitKey(null);
    }
  };

  const submitAllTemperatures = async (
    entries: { target: CoolingUnit; value: string; note: string }[]
  ) => {
    setSavingAll(true);
    try {
      let saved = 0;
      let queued = 0;
      const failed: string[] = [];
      const succeededKeys: string[] = [];

      for (const entry of entries) {
        try {
          const result = await recordTemperature(entry.target, entry.value, 'C', entry.note);
          succeededKeys.push(entry.target.key);
          if (result.queued) queued += 1;
          else saved += 1;
        } catch {
          failed.push(entry.target.label);
        }
      }

      if (succeededKeys.length > 0) {
        setTemperatures(current => {
          const next = { ...current };
          for (const key of succeededKeys) next[key] = '';
          return next;
        });
        setUnitNotes(current => {
          const next = { ...current };
          for (const key of succeededKeys) next[key] = '';
          return next;
        });
        await refreshPendingTemps();
      }

      if (failed.length === entries.length) {
        Alert.alert('Could not save', `Temperature log failed for ${failed.join(', ')}.`);
        return;
      }

      const parts: string[] = [];
      if (saved) parts.push(`${saved} logged.`);
      if (queued) parts.push(`${queued} saved offline and will sync when you are back online.`);
      if (failed.length) parts.push(`Could not save: ${failed.join(', ')}.`);

      Alert.alert(
        queued && !saved ? 'Saved offline' : failed.length ? 'Partially saved' : 'Saved',
        parts.join(' ')
      );
    } finally {
      setSavingAll(false);
    }
  };

  const openConsolidatedLog = () => {
    setReviewMode(false);
    setEditingLog(null);
    setAddingLog(null);
    setLogYear(null);
    setLogModalOpen(true);
  };

  const closeConsolidatedLog = () => {
    setLogModalOpen(false);
    setReviewMode(false);
    setEditingLog(null);
    setAddingLog(null);
    setAddDatePickerOpen(false);
    setEditTimePickerOpen(false);
    setLogYear(null);
  };

  const goLogBack = () => {
    if (logYear) {
      setLogYear(null);
      setReviewMode(false);
      setEditingLog(null);
      setAddingLog(null);
      setAddDatePickerOpen(false);
      setEditTimePickerOpen(false);
    }
  };

  const buildAddEntryState = (prefill: { targetKey: string; label: string }) => ({
    ...prefill,
    value: '',
    notes: '',
    dateKey: localDateKey(new Date()),
  });

  const combineDateKeyWithTime = (dateKey: string, time = '') => {
    const [year, month, day] = dateKey.split('-').map(part => Number(part));
    const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    const hours = match ? Number(match[1]) : new Date().getHours();
    const minutes = match ? Number(match[2]) : new Date().getMinutes();
    return new Date(year, month - 1, day, hours, minutes, 0, 0);
  };

  const combineDateKeyWithNow = (dateKey: string) => combineDateKeyWithTime(dateKey);

  const formatLogDateLabel = (dateKey: string) =>
    new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

  const dateKeyFromLog = (item: any) => {
    const dateKey = String(item?.dateKey || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
    const ms = getTimestampMs(item?.loggedAt, item?.loggedAtIso);
    return ms ? localDateKey(new Date(ms)) : localDateKey(new Date());
  };

  const timeFromLog = (item: any) => {
    const ms = getTimestampMs(item?.loggedAt, item?.loggedAtIso);
    return dateToTimeString(ms ? new Date(ms) : new Date());
  };

  const openAddEntry = (prefill?: { targetKey: string; label: string }) => {
    setEditingLog(null);
    setEditTimePickerOpen(false);
    if (prefill) {
      setAddingLog(buildAddEntryState(prefill));
      return;
    }

    Alert.alert(
      'Add entry',
      'Choose cooling unit',
      [
        ...targets.map(target => ({
          text: target.label,
          onPress: () => setAddingLog(buildAddEntryState({ targetKey: target.key, label: target.label })),
        })),
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleLogLongPress = () => {
    Alert.alert('Cooling log', 'Choose an action', [
      { text: 'Cancel', style: 'cancel' },
      reviewMode
        ? {
            text: 'Exit review',
            onPress: () => {
              setReviewMode(false);
              setEditingLog(null);
            },
          }
        : { text: 'Review entries', onPress: () => setReviewMode(true) },
      { text: 'Add entry', onPress: () => openAddEntry() },
    ]);
  };

  const resolveTargetFromItem = (item: any) => {
    const key = String(item.targetKey || '');
    const found = targets.find(target => target.key === key);
    return found || { key, label: String(item.targetLabel || 'Unit') };
  };

  const handleReviewLogEntry = (item: any) => {
    if (!reviewMode) return;
    const target = resolveTargetFromItem(item);
    Alert.alert(
      'Review entry',
      `${item.targetLabel || 'Unit'} · ${item.temperatureValue || '-'}°${item.temperatureUnit || 'C'}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add entry',
          onPress: () => openAddEntry({ targetKey: target.key, label: target.label }),
        },
        {
          text: 'Edit',
          onPress: () => {
            setAddingLog(null);
            setEditingLog({
              id: item.id,
              label: String(item.targetLabel || 'Unit'),
              value: String(item.temperatureValue || ''),
              notes: String(item.notes || ''),
              dateKey: dateKeyFromLog(item),
              time: timeFromLog(item),
            });
          },
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => confirmDeleteTempLog(item),
        },
      ]
    );
  };

  const confirmDeleteTempLog = (item: any) => {
    Alert.alert(
      'Delete record',
      `Remove ${item.targetLabel} ${item.temperatureValue}°${item.temperatureUnit} recorded by ${item.userName || 'Unknown'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void handleDeleteTempLog(item.id),
        },
      ]
    );
  };

  const handleDeleteTempLog = async (logId: string) => {
    setDeletingTempId(logId);
    try {
      await deleteTemperatureLog(logId);
      if (editingLog?.id === logId) setEditingLog(null);
    } catch (error: any) {
      Alert.alert('Could not delete', error?.message || 'Delete failed.');
    } finally {
      setDeletingTempId(null);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingLog) return;
    const when = combineDateKeyWithTime(editingLog.dateKey, editingLog.time);
    if (Number.isNaN(when.getTime())) {
      Alert.alert('Invalid time', 'Choose a valid date and time.');
      return;
    }
    setSavingEdit(true);
    try {
      await updateTemperatureLog(editingLog.id, editingLog.value, editingLog.notes, when);
      setEditingLog(null);
      setAddDatePickerOpen(false);
      setEditTimePickerOpen(false);
      Alert.alert('Saved', 'Temperature record updated.');
    } catch (error: any) {
      Alert.alert('Could not save', error?.message || 'Update failed.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleSaveAdd = async () => {
    if (!addingLog) return;
    const value = addingLog.value.trim();
    if (!value) {
      Alert.alert('Temperature required', 'Enter a temperature before saving.');
      return;
    }
    if (!Number.isFinite(Number.parseFloat(value))) {
      Alert.alert('Invalid temperature', 'Enter a valid number.');
      return;
    }

    const target =
      targets.find(item => item.key === addingLog.targetKey) ||
      ({ key: addingLog.targetKey, label: addingLog.label } as (typeof TEMPERATURE_TARGETS)[number]);

    setSavingAdd(true);
    try {
      const loggedAt = combineDateKeyWithNow(addingLog.dateKey);
      const result = await recordTemperature(target, value, 'C', addingLog.notes, loggedAt);
      await refreshPendingTemps();
      setAddingLog(null);
      setAddDatePickerOpen(false);
      Alert.alert(
        result.queued ? 'Saved offline' : 'Saved',
        result.queued
          ? `${target.label} saved on this device and will sync when you are back online.`
          : `${target.label} temperature logged.`
      );
    } catch (error: any) {
      Alert.alert('Could not save', error?.message || 'Save failed.');
    } finally {
      setSavingAdd(false);
    }
  };

  const renderLogRow = (item: any, interactive: boolean) => {
    const row = (
      <>
        <Text style={[styles.auditTableText, styles.colUnit]}>{item.targetLabel || '-'}</Text>
        <Text style={[styles.auditTableText, styles.colTemp]}>
          {item.temperatureValue || '-'}°{item.temperatureUnit || ''}
        </Text>
        <Text style={[styles.auditTableText, styles.colBy]} numberOfLines={1}>
          {item.userName || 'Unknown'}
        </Text>
        <Text style={[styles.auditTableText, styles.colWhen]} numberOfLines={2}>
          {formatDateTime(item.loggedAt, item.loggedAtIso)}
        </Text>
      </>
    );

    if (!interactive) {
      return (
        <View key={item.id} style={styles.auditTableRow}>
          {row}
        </View>
      );
    }

    return (
      <Pressable
        key={item.id}
        style={[styles.auditTableRow, reviewMode && styles.auditTableRowReview]}
        onPress={() => handleReviewLogEntry(item)}
        disabled={!reviewMode || deletingTempId === item.id}
      >
        {row}
      </Pressable>
    );
  };

  const renderMonthGroupedLogs = (logs: any[]) => {
    const groups = groupTemperatureLogsByMonth(logs);
    if (!groups.length) {
      return (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No temperature history yet.</Text>
        </View>
      );
    }
    return groups.map(group => (
      <View key={group.monthKey} style={styles.seasonMonthBlock}>
        <Text style={styles.seasonMonthLabel}>
          {group.monthKey === 'unknown' ? 'Undated' : formatHygieneMonthLabel(group.monthKey)}
        </Text>
        <View style={styles.auditLedger}>
          <View style={styles.auditTableHeader}>
            <Text style={[styles.auditTableHeadText, styles.colUnit]}>Unit</Text>
            <Text style={[styles.auditTableHeadText, styles.colTemp]}>Temp</Text>
            <Text style={[styles.auditTableHeadText, styles.colBy]}>Recorded By</Text>
            <Text style={[styles.auditTableHeadText, styles.colWhen]}>When</Text>
          </View>
          {group.items.map(item => renderLogRow(item, true))}
        </View>
      </View>
    ));
  };

  const confirmDeleteCredential = (item: any) => {
    Alert.alert(
      'Delete upload',
      `Remove ${item.fileName || 'this file'}?`,
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

  const openDocumentActionMenu = (item: any) => {
    setDocumentActionItem(item);
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

  const handleUploadCredential = async (folder: HygieneDocumentFolderKey) => {
    if (!canUpload) return;
    if (uploadSuccessTimeoutRef.current) {
      clearTimeout(uploadSuccessTimeoutRef.current);
      uploadSuccessTimeoutRef.current = null;
    }
    try {
      const uploaded = await pickAndUpload(undefined, { folder });
      if (!uploaded) {
        setUploadButtonState('idle');
        return;
      }
      setOpenDocFolder(folder);
      setUploadButtonState('success');
      uploadSuccessTimeoutRef.current = setTimeout(() => {
        setUploadButtonState('idle');
        uploadSuccessTimeoutRef.current = null;
      }, 2500);
      Alert.alert(
        'Uploaded',
        `Document saved to ${hygieneDocumentFolderLabel(folder)}. Next recurring education reminder is due ${new Date(
          uploaded.nextEducationDueAtIso
        ).toLocaleDateString()}.`
      );
    } catch (error: any) {
      setUploadButtonState('idle');
      Alert.alert('Upload failed', error?.message || 'Could not upload document.');
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await generateMonthlyHygieneExport(monthKey);
      if (result.downloadUrl) {
        Alert.alert('Export ready', `${result.fileName} downloaded and saved to archive.`);
      } else {
        Alert.alert('Export ready', `${result.fileName} downloaded to your device.`);
      }
    } catch (error: any) {
      Alert.alert('Export failed', error?.message || 'Could not generate report.');
    } finally {
      setExporting(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const result = await downloadMonthlyHygieneExport(monthKey);
      Alert.alert('Download ready', `${result.fileName} is ready to save or share.`);
    } catch (error: any) {
      Alert.alert('Download failed', error?.message || 'Could not download report.');
    } finally {
      setDownloading(false);
    }
  };

  const handleRenameCredential = async () => {
    if (!renamingCredential?.id || savingCredentialName) return;
    const fileName = credentialNameDraft.trim();
    if (!fileName) {
      Alert.alert('Name required', 'Enter a name for this document.');
      return;
    }
    setSavingCredentialName(true);
    try {
      await renameHygieneCredential(renamingCredential.id, fileName);
      setRenamingCredential(null);
      setCredentialNameDraft('');
    } catch (error: any) {
      Alert.alert('Could not rename document', error?.message || 'Please try again.');
    } finally {
      setSavingCredentialName(false);
    }
  };

  const handleSaveDocumentFolder = async () => {
    if (!userId || savingDocFolder) return;
    const label = newDocFolderName.trim();
    if (!label) {
      Alert.alert('Name required', 'Enter a name for the new file.');
      return;
    }
    const editingKey = editingDocFolder?.key || editingDefaultDocFolder;
    if (documentFolders.some(folder => folder.key !== editingKey && folder.label.toLowerCase() === label.toLowerCase())) {
      Alert.alert('Name already used', 'Choose a different file name.');
      return;
    }
    setSavingDocFolder(true);
    try {
      const folder = editingDefaultDocFolder
        ? await renameDefaultHygieneDocumentFolder(userId, editingDefaultDocFolder, label).then(() => ({ key: editingDefaultDocFolder, label }))
        : editingDocFolder
        ? await renameCustomHygieneDocumentFolder(userId, editingDocFolder.key, label).then(() => ({ ...editingDocFolder, label }))
        : await createCustomHygieneDocumentFolder(userId, label);
      setNewDocFolderName('');
      setNewDocFolderModalOpen(false);
      setEditingDocFolder(null);
      setEditingDefaultDocFolder(null);
      setOpenDocFolder(folder.key);
    } catch (error: any) {
      Alert.alert(editingDocFolder || editingDefaultDocFolder ? 'Could not rename file' : 'Could not create file', error?.message || 'Please try again.');
    } finally {
      setSavingDocFolder(false);
    }
  };

  const handleFolderLongPress = (folder: { key: HygieneDocumentFolderKey; label: string }, isDefault: boolean) => {
    setFolderAction({ folder, isDefault });
  };

  const confirmDeleteFolder = (folder: { key: HygieneDocumentFolderKey; label: string }, isDefault: boolean) => {
    const documentCount = folderCounts[folder.key] || 0;
    if (documentCount > 0) {
      Alert.alert('Move documents first', 'Move or delete the documents in this file before deleting it.');
      return;
    }
    Alert.alert('Delete file?', `Delete “${folder.label}”?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (!userId) return;
          const deletion = isDefault
            ? deleteDefaultHygieneDocumentFolder(userId, folder.key)
            : deleteCustomHygieneDocumentFolder(userId, folder.key);
          void deletion.catch(error => {
            Alert.alert('Could not delete file', error?.message || 'Please try again.');
          });
        },
      },
    ]);
  };

  const saveCoolingUnitChanges = async () => {
    const label = newCoolingUnit.trim();
    const baseKey = coolingUnitKey(label);
    if (savingCoolingUnits) return;
    if (label && (!baseKey || draftCoolingUnits.some(unit => unit.label.toLowerCase() === label.toLowerCase()))) {
      Alert.alert('Cooling unit exists', 'A cooling unit with that name already exists.');
      return;
    }
    const nextUnits = [...draftCoolingUnits];
    if (label) {
      let key = baseKey;
      let suffix = 2;
      while (nextUnits.some(unit => unit.key === key)) {
        key = `${baseKey}_${suffix}`;
        suffix += 1;
      }
      nextUnits.push({ key, label });
    }
    if (nextUnits.length === 0) {
      Alert.alert('Keep one unit', 'At least one cooling unit is required.');
      return;
    }
    setSavingCoolingUnits(true);
    try {
      await saveCoolingUnits(teamId, nextUnits);
      setNewCoolingUnit('');
      setEditingCoolingUnits(false);
    } catch (error: any) {
      Alert.alert('Could not save units', error?.message || 'Please try again.');
    } finally {
      setSavingCoolingUnits(false);
    }
  };

  const beginCoolingUnitEdit = () => {
    setDraftCoolingUnits(coolingUnits);
    setNewCoolingUnit('');
    setEditingCoolingUnits(true);
  };

  const handleDownloadSavedExport = async (item: any) => {
    setDownloadingExportId(item.id);
    try {
      await openOrDownloadHygieneExport(item);
    } catch (error: any) {
      Alert.alert('Download failed', error?.message || 'Could not download export.');
    } finally {
      setDownloadingExportId(null);
    }
  };

  return (
    <PizzaFireScreen>
    <View style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Home</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Hygiene</Text>
        <View style={{ width: 56 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Temperature Logs</Text>
          <Text style={styles.sectionSub}>
            Entries are saved with your account and the current date and time.
          </Text>
          <View style={styles.card}>
            {visibleTargets.map(target => {
              const note = String(unitNotes[target.key] || '').trim();
              const saving = savingUnitKey === target.key || savingAll;
              return (
                <View key={target.key} style={styles.coolerRow}>
                  <Text style={styles.coolerLabel} numberOfLines={2}>
                    {target.label}
                  </Text>
                  <TouchableOpacity
                    style={styles.noteLinkButton}
                    onPress={() => openUnitNote(target.key)}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                  >
                    <Text style={[styles.noteLinkText, note ? styles.noteLinkTextActive : null]}>
                      {note ? 'Note*' : 'Note'}
                    </Text>
                  </TouchableOpacity>
                  <View style={styles.tempInputWrap}>
                    <TextInput
                      value={temperatures[target.key] || ''}
                      onChangeText={value => updateTemperature(target.key, value)}
                      placeholder="—"
                      placeholderTextColor="#8F6A48"
                      keyboardType="numbers-and-punctuation"
                      returnKeyType="done"
                      style={styles.tempInput}
                    />
                    <Text style={styles.tempUnit}>°C</Text>
                  </View>
                  {editingCoolingUnits ? (
                    <TouchableOpacity
                      style={styles.unitDeleteInlineButton}
                      onPress={() => setDraftCoolingUnits(current => current.filter(unit => unit.key !== target.key))}
                      disabled={savingCoolingUnits}
                    >
                      <Text style={styles.unitDeleteInlineText}>✕</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.rowConfirmButton, saving ? styles.rowConfirmButtonDisabled : null]}
                      onPress={() => handleConfirmUnit(target)}
                      disabled={saving}
                    >
                      {savingUnitKey === target.key ? (
                        <ActivityIndicator color={PIZZA_FIRE.textPrimary} size="small" />
                      ) : (
                        <Text style={styles.rowConfirmButtonText}>Log</Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}

            {editingCoolingUnits ? (
              <View style={styles.coolerRow}>
                <TextInput
                  value={newCoolingUnit}
                  onChangeText={setNewCoolingUnit}
                  placeholder="e.g. New cooling unit"
                  placeholderTextColor={PIZZA_FIRE.textMuted}
                  style={styles.newUnitInlineInput}
                  editable={!savingCoolingUnits}
                />
              </View>
            ) : null}

            {isAdmin ? (
              <TouchableOpacity
                style={[styles.unitManagementButton, savingCoolingUnits && styles.rowConfirmButtonDisabled]}
                onPress={() => (editingCoolingUnits ? void saveCoolingUnitChanges() : beginCoolingUnitEdit())}
                disabled={savingCoolingUnits}
              >
                {savingCoolingUnits ? (
                  <ActivityIndicator color={PIZZA_FIRE.accent} />
                ) : (
                  <Text style={styles.unitManagementButtonText}>{editingCoolingUnits ? 'Save' : '+ Add/Remove Unit'}</Text>
                )}
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={[
                styles.secondaryButton,
                savingAll || savingUnitKey ? styles.rowConfirmButtonDisabled : null,
              ]}
              onPress={handleLogAll}
              disabled={savingAll || !!savingUnitKey}
            >
              {savingAll ? (
                <ActivityIndicator color={PIZZA_FIRE.accent} />
              ) : (
                <Text style={styles.secondaryButtonText}>Log All</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Temperature Record</Text>
          <Text style={styles.sectionSub}>
            Latest reading per cooling unit. Tap a row to open the cooling log.
          </Text>
          <View style={styles.auditLedger}>
            <View style={styles.auditTableHeader}>
              <Text style={[styles.auditTableHeadText, styles.colUnit]}>Unit</Text>
              <Text style={[styles.auditTableHeadText, styles.colTemp]}>Temp</Text>
              <Text style={[styles.auditTableHeadText, styles.colBy]}>Recorded By</Text>
              <Text style={[styles.auditTableHeadText, styles.colWhen]}>When</Text>
            </View>
            {latestByUnit.map(({ target, latest }) => (
              <TouchableOpacity
                key={target.key}
                style={styles.auditTableRowTouchable}
                onPress={openConsolidatedLog}
                activeOpacity={0.75}
              >
                <Text style={[styles.auditTableText, styles.colUnit]}>{target.label}</Text>
                <Text style={[styles.auditTableText, styles.colTemp]}>
                  {latest ? `${latest.temperatureValue}°${latest.temperatureUnit || 'C'}` : '—'}
                </Text>
                <Text style={[styles.auditTableText, styles.colBy]} numberOfLines={1}>
                  {latest?.userName || '—'}
                </Text>
                <Text style={[styles.auditTableText, styles.colWhen]} numberOfLines={2}>
                  {latest
                    ? `${formatDateTime(latest.loggedAt, latest.loggedAtIso)}${latest.pendingSync ? ' · pending sync' : ''}`
                    : '—'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {!hasAnyTemperatureLogs ? (
            <Text style={styles.logHint}>No temperature history yet.</Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Hygiene Documents</Text>
          <Text style={styles.sectionSub}>
            Use the ⋮ menu to manage files and documents.
          </Text>
          <TouchableOpacity
            style={[
              styles.primaryButton,
              uploadButtonBusy && styles.uploadButtonUploading,
              uploadButtonState === 'success' && styles.uploadButtonSuccess,
            ]}
            onPress={() => setFolderPicker({ mode: 'upload' })}
            disabled={!canUpload}
          >
            <Text style={styles.primaryButtonText}>
              {uploadButtonBusy
                ? 'Uploading'
                : uploadButtonState === 'success'
                  ? 'Uploaded!'
                  : 'Upload Photo or File'}
            </Text>
          </TouchableOpacity>
          <View style={{ height: 12 }} />
          {documentFolders.map(folder => (
            <View
              key={folder.key}
              style={styles.folderRow}
            >
              <TouchableOpacity style={styles.folderRowOpen} onPress={() => setOpenDocFolder(folder.key)}>
                <View style={styles.folderRowBody}>
                  <Text style={styles.folderRowTitle}>{folder.label}</Text>
                  <Text style={styles.folderRowMeta}>
                    {folderCounts[folder.key]} {folderCounts[folder.key] === 1 ? 'file' : 'files'}
                  </Text>
                </View>
              </TouchableOpacity>
              {(customDocFolders.some(item => item.key === folder.key) || isAdmin) ? (
                <TouchableOpacity
                  style={styles.overflowButton}
                  onPress={() => {
                    const customFolder = customDocFolders.find(item => item.key === folder.key);
                    if (customFolder) handleFolderLongPress(customFolder, false);
                    else if (isAdmin) handleFolderLongPress(folder, true);
                  }}
                >
                  <Text style={styles.overflowButtonText}>⋮</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
          <TouchableOpacity
            style={styles.createFileLink}
            onPress={() => {
              setEditingDocFolder(null);
              setEditingDefaultDocFolder(null);
              setNewDocFolderName('');
              setNewDocFolderModalOpen(true);
            }}
          >
            <Text style={styles.createFileLinkText}>Create new file</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Monthly Export</Text>
          <Text style={styles.sectionSub}>
            Generate an Excel-compatible CSV report for authorities or archive.
          </Text>
          <View style={styles.card}>
            <Text style={styles.formLabel}>Report Month</Text>
            <TextInput
              value={monthKey}
              onChangeText={setMonthKey}
              placeholder="YYYY-MM"
              placeholderTextColor="#8F6A48"
              style={styles.input}
            />
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => void handleDownload()}
              disabled={downloading || exporting}
            >
              {downloading ? (
                <ActivityIndicator color={PIZZA_FIRE.textPrimary} />
              ) : (
                <Text style={styles.primaryButtonText}>Download CSV</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryButton, styles.exportArchiveButton]}
              onPress={() => void handleExport()}
              disabled={exporting || downloading}
            >
              {exporting ? (
                <ActivityIndicator color={PIZZA_FIRE.accent} />
              ) : (
                <Text style={styles.secondaryButtonText}>Generate & Archive</Text>
              )}
            </TouchableOpacity>
          </View>
          {exportsList.map(item => (
            <View key={item.id} style={styles.card}>
              <Text style={styles.cardTitle}>{item.fileName}</Text>
              <Text style={styles.muted}>Created {formatDateTime(item.createdAt, item.createdAtIso)}</Text>
              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={styles.linkButton}
                  onPress={() => void handleDownloadSavedExport(item)}
                  disabled={downloadingExportId === item.id}
                >
                  {downloadingExportId === item.id ? (
                    <ActivityIndicator color={PIZZA_FIRE.accent} size="small" />
                  ) : (
                    <Text style={styles.linkText}>Download</Text>
                  )}
                </TouchableOpacity>
                {item.downloadUrl ? (
                  <TouchableOpacity
                    style={styles.linkButton}
                    onPress={() => void Linking.openURL(String(item.downloadUrl))}
                  >
                    <Text style={styles.linkText}>Open link</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <Modal visible={noteModalKey !== null} transparent animationType="fade" onRequestClose={closeUnitNote}>
        <Pressable style={styles.noteModalBackdrop} onPress={closeUnitNote}>
          <View style={styles.noteModalCard}>
            <Text style={styles.noteModalTitle}>
              {targets.find(target => target.key === noteModalKey)?.label || 'Unit'} note
            </Text>
            <TextInput
              value={noteDraft}
              onChangeText={setNoteDraft}
              placeholder="Optional note"
              placeholderTextColor="#8F6A48"
              style={styles.noteModalInput}
              multiline
              autoFocus
            />
            <View style={styles.noteModalActions}>
              <TouchableOpacity style={styles.noteModalCancel} onPress={closeUnitNote}>
                <Text style={styles.noteModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.noteModalSave} onPress={saveUnitNote}>
                <Text style={styles.noteModalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={logModalOpen} animationType="slide" onRequestClose={closeConsolidatedLog}>
        <SafeAreaView style={styles.logModalSafe}>
          <View style={styles.logModalHeader}>
            {logYear ? (
              <TouchableOpacity onPress={goLogBack}>
                <Text style={styles.logModalClose}>‹ Back</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: 56 }} />
            )}
            <Text style={styles.logModalTitle}>
              {logYear || 'Cooling Log'}
            </Text>
            <TouchableOpacity onPress={closeConsolidatedLog}>
              <Text style={styles.logModalClose}>Close</Text>
            </TouchableOpacity>
          </View>

          {reviewMode ? (
            <View style={styles.reviewBar}>
              <Text style={styles.reviewBarTitle}>Review</Text>
              <Text style={styles.reviewBarText}>Tap an entry to add, edit, or delete.</Text>
            </View>
          ) : null}

          <Pressable style={styles.logModalBody} onLongPress={handleLogLongPress} delayLongPress={450}>
            <ScrollView contentContainerStyle={styles.logModalScroll}>
              {logYear ? (
                <>
                  <Text style={styles.logModalHint}>Long press for review or add entry.</Text>
                  {renderMonthGroupedLogs(openedYearLogs)}
                </>
              ) : (
                <>
                  <Text style={styles.logModalHint}>
                    This year’s months first. Scroll past them to earlier year files. Long press a log to review.
                  </Text>
                  {coolingYearSplit.currentLogs.length ? (
                    renderMonthGroupedLogs(coolingYearSplit.currentLogs)
                  ) : null}
                  {coolingYearSplit.previousYears.map(group => (
                    <TouchableOpacity
                      key={group.year}
                      style={styles.navRow}
                      onPress={() => setLogYear(group.year)}
                    >
                      <View style={styles.folderRowBody}>
                        <Text style={styles.folderRowTitle}>{group.year}</Text>
                        <Text style={styles.folderRowMeta}>
                          {group.items.length} {group.items.length === 1 ? 'entry' : 'entries'}
                        </Text>
                      </View>
                      <Text style={styles.folderRowArrow}>›</Text>
                    </TouchableOpacity>
                  ))}
                  {!coolingYearSplit.currentLogs.length && coolingYearSplit.previousYears.length === 0 ? (
                    <View style={styles.emptyCard}>
                      <Text style={styles.emptyText}>No temperature history yet.</Text>
                    </View>
                  ) : null}
                </>
              )}
            </ScrollView>
          </Pressable>

          {addingLog ? (
            <View style={styles.editPanel}>
              <Text style={styles.editPanelTitle}>Add entry · {addingLog.label}</Text>
              <Text style={styles.editFieldLabel}>Date</Text>
              <TouchableOpacity
                style={styles.editDateButton}
                onPress={() => setAddDatePickerOpen(true)}
                activeOpacity={0.85}
              >
                <Text style={styles.editDateButtonText}>{formatLogDateLabel(addingLog.dateKey)}</Text>
              </TouchableOpacity>
              <Text style={styles.editFieldLabel}>Temperature</Text>
              <View style={styles.editPanelRow}>
                <TextInput
                  value={addingLog.value}
                  onChangeText={value =>
                    setAddingLog(current =>
                      current ? { ...current, value: value.replace(/[^0-9.-]/g, '') } : current
                    )
                  }
                  keyboardType="numbers-and-punctuation"
                  placeholder="Temperature"
                  placeholderTextColor="#8F6A48"
                  style={styles.editInput}
                />
                <Text style={styles.tempUnit}>°C</Text>
              </View>
              <TextInput
                value={addingLog.notes}
                onChangeText={notes =>
                  setAddingLog(current => (current ? { ...current, notes } : current))
                }
                placeholder="Optional note"
                placeholderTextColor="#8F6A48"
                style={styles.editNotesInput}
              />
              <View style={styles.editPanelActions}>
                <TouchableOpacity
                  style={styles.editCancelButton}
                  onPress={() => {
                    setAddingLog(null);
                    setAddDatePickerOpen(false);
                  }}
                >
                  <Text style={styles.editCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryButton, styles.editSaveButton]}
                  onPress={() => void handleSaveAdd()}
                  disabled={savingAdd}
                >
                  {savingAdd ? (
                    <ActivityIndicator color={PIZZA_FIRE.textPrimary} />
                  ) : (
                    <Text style={styles.primaryButtonText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {editingLog ? (
            <View style={styles.editPanel}>
              <Text style={styles.editPanelTitle}>Edit {editingLog.label}</Text>
              <Text style={styles.editFieldLabel}>Date</Text>
              <TouchableOpacity
                style={styles.editDateButton}
                onPress={() => {
                  setEditTimePickerOpen(false);
                  setAddDatePickerOpen(true);
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.editDateButtonText}>{formatLogDateLabel(editingLog.dateKey)}</Text>
              </TouchableOpacity>
              <Text style={styles.editFieldLabel}>Time</Text>
              <TouchableOpacity
                style={styles.editDateButton}
                onPress={() => {
                  setAddDatePickerOpen(false);
                  setEditTimePickerOpen(open => !open);
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.editDateButtonText}>{editingLog.time}</Text>
              </TouchableOpacity>
              {editTimePickerOpen ? (
                <>
                  <DateTimePicker
                    value={editTimeValue}
                    mode="time"
                    is24Hour
                    display="default"
                    onChange={(_event: DateTimePickerEvent, selected?: Date) => {
                      if (!selected) return;
                      const nextTime = dateToTimeString(selected);
                      setEditingLog(current =>
                        current && current.time !== nextTime ? { ...current, time: nextTime } : current
                      );
                    }}
                    themeVariant="dark"
                  />
                  <TouchableOpacity
                    style={styles.datePickerCloseButton}
                    onPress={() => setEditTimePickerOpen(false)}
                  >
                    <Text style={styles.datePickerCloseText}>Done</Text>
                  </TouchableOpacity>
                </>
              ) : null}
              <Text style={styles.editFieldLabel}>Temperature</Text>
              <View style={styles.editPanelRow}>
                <TextInput
                  value={editingLog.value}
                  onChangeText={value =>
                    setEditingLog(current =>
                      current ? { ...current, value: value.replace(/[^0-9.-]/g, '') } : current
                    )
                  }
                  keyboardType="numbers-and-punctuation"
                  placeholder="Temperature"
                  placeholderTextColor="#8F6A48"
                  style={styles.editInput}
                />
                <Text style={styles.tempUnit}>°C</Text>
              </View>
              <TextInput
                value={editingLog.notes}
                onChangeText={notes =>
                  setEditingLog(current => (current ? { ...current, notes } : current))
                }
                placeholder="Optional note"
                placeholderTextColor="#8F6A48"
                style={styles.editNotesInput}
              />
              <View style={styles.editPanelActions}>
                <TouchableOpacity
                  style={styles.editCancelButton}
                  onPress={() => {
                    setEditingLog(null);
                    setAddDatePickerOpen(false);
                    setEditTimePickerOpen(false);
                  }}
                >
                  <Text style={styles.editCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryButton, styles.editSaveButton]}
                  onPress={() => void handleSaveEdit()}
                  disabled={savingEdit}
                >
                  {savingEdit ? (
                    <ActivityIndicator color={PIZZA_FIRE.textPrimary} />
                  ) : (
                    <Text style={styles.primaryButtonText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </SafeAreaView>
      </Modal>

      <Modal visible={addDatePickerOpen} transparent animationType="fade" onRequestClose={() => setAddDatePickerOpen(false)}>
        <View style={styles.datePickerBackdrop}>
          <View style={styles.datePickerCard}>
            <Text style={styles.datePickerTitle}>Entry date</Text>
            <PizzaFireCalendar
              current={editingLog?.dateKey || addingLog?.dateKey}
              theme={{
                backgroundColor: PIZZA_FIRE.surfaceInset,
                calendarBackground: 'transparent',
                selectedDayBackgroundColor: PIZZA_FIRE.accent,
                dayTextColor: '#F6EDE2',
                monthTextColor: '#F6EDE2',
                arrowColor: PIZZA_FIRE.accent,
                todayTextColor: '#E9B261',
              }}
              onDayPress={day => {
                setAddingLog(current => (current ? { ...current, dateKey: day.dateString } : current));
                setEditingLog(current => (current ? { ...current, dateKey: day.dateString } : current));
                setAddDatePickerOpen(false);
              }}
              markedDates={
                editingLog
                  ? { [editingLog.dateKey]: { selected: true, selectedColor: PIZZA_FIRE.accent } }
                  : addingLog
                    ? { [addingLog.dateKey]: { selected: true, selectedColor: PIZZA_FIRE.accent } }
                    : undefined
              }
            />
            <TouchableOpacity style={styles.datePickerCloseButton} onPress={() => setAddDatePickerOpen(false)}>
              <Text style={styles.datePickerCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {nameConfirmModal}
      {sourcePickerModal}
      <Modal visible={!!openDocFolder} animationType="slide" onRequestClose={() => setOpenDocFolder(null)}>
        <SafeAreaView style={styles.documentFolderModalSafe}>
          <View style={styles.documentFolderModalHeader}>
            <Text style={styles.documentFolderModalTitle}>
              {openDocFolder ? documentFolders.find(folder => folder.key === openDocFolder)?.label || hygieneDocumentFolderLabel(openDocFolder) : 'Hygiene file'}
            </Text>
            <TouchableOpacity style={styles.documentFolderModalClose} onPress={() => setOpenDocFolder(null)}>
              <Text style={styles.documentFolderModalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.documentFolderModalContent} keyboardShouldPersistTaps="handled">
            <TouchableOpacity
              style={[
                styles.primaryButton,
                uploadButtonBusy && styles.uploadButtonUploading,
                uploadButtonState === 'success' && styles.uploadButtonSuccess,
              ]}
              onPress={() => openDocFolder && void handleUploadCredential(openDocFolder)}
              disabled={!canUpload}
            >
              <Text style={styles.primaryButtonText}>
                {uploadButtonBusy ? 'Uploading' : uploadButtonState === 'success' ? 'Uploaded!' : 'Upload Photo or File'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.documentFolderModalHint}>Long-press a document to move or delete it.</Text>
            {folderDocuments.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No documents in this file yet.</Text>
              </View>
            ) : (
              folderDocuments.map(item => (
                <Pressable
                  key={item.id}
                  style={styles.card}
                >
                  <View style={styles.documentCardHeader}>
                    <Text style={[styles.cardTitle, styles.documentCardTitle]}>{item.fileName || 'Document'}</Text>
                    <TouchableOpacity style={styles.overflowButton} onPress={() => openDocumentActionMenu(item)}>
                      <Text style={styles.overflowButtonText}>⋮</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.muted}>Uploaded: {formatDateTime(item.uploadedAt, item.uploadedAtIso)}</Text>
                  {openDocFolder === 'belehrung' ? (
                    <Text style={styles.muted}>
                      Education due: {item.nextEducationDueAtIso ? new Date(item.nextEducationDueAtIso).toLocaleDateString() : 'Unknown'}
                    </Text>
                  ) : null}
                  <View style={styles.cardActions}>
                    <TouchableOpacity style={styles.linkButton} onPress={() => void Linking.openURL(String(item.downloadUrl || ''))}>
                      <Text style={styles.linkText}>Open document</Text>
                    </TouchableOpacity>
                  </View>
                </Pressable>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <Modal visible={!!documentActionItem} transparent animationType="fade" onRequestClose={() => setDocumentActionItem(null)}>
        <Pressable style={styles.actionMenuBackdrop} onPress={() => setDocumentActionItem(null)}>
          <Pressable style={styles.actionMenuCard} onPress={() => undefined}>
            <Text style={styles.actionMenuTitle} numberOfLines={1}>{documentActionItem?.fileName || 'Document'}</Text>
            <TouchableOpacity
              style={styles.actionMenuOption}
              onPress={() => {
                const item = documentActionItem;
                setDocumentActionItem(null);
                setRenamingCredential(item);
                setCredentialNameDraft(String(item?.fileName || 'Document'));
              }}
            >
              <Text style={styles.actionMenuOptionText}>Rename</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionMenuOption}
              onPress={() => {
                const item = documentActionItem;
                setDocumentActionItem(null);
                if (item) setFolderPicker({ mode: 'move', credential: item });
              }}
            >
              <Text style={styles.actionMenuOptionText}>Move</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionMenuOption}
              onPress={() => {
                const item = documentActionItem;
                setDocumentActionItem(null);
                if (item) confirmDeleteCredential(item);
              }}
            >
              <Text style={styles.actionMenuDeleteText}>Delete</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionMenuCancel} onPress={() => setDocumentActionItem(null)}>
              <Text style={styles.actionMenuCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={!!folderAction} transparent animationType="fade" onRequestClose={() => setFolderAction(null)}>
        <Pressable style={styles.actionMenuBackdrop} onPress={() => setFolderAction(null)}>
          <Pressable style={styles.actionMenuCard} onPress={() => undefined}>
            <Text style={styles.actionMenuTitle} numberOfLines={1}>{folderAction?.folder.label || 'File'}</Text>
            <TouchableOpacity
              style={styles.actionMenuOption}
              onPress={() => {
                const action = folderAction;
                setFolderAction(null);
                if (!action) return;
                setEditingDocFolder(action.isDefault ? null : action.folder as CustomHygieneDocumentFolder);
                setEditingDefaultDocFolder(action.isDefault ? action.folder.key : null);
                setNewDocFolderName(action.folder.label);
                setNewDocFolderModalOpen(true);
              }}
            >
              <Text style={styles.actionMenuOptionText}>Modify name</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionMenuOption}
              onPress={() => {
                const action = folderAction;
                setFolderAction(null);
                if (action) confirmDeleteFolder(action.folder, action.isDefault);
              }}
            >
              <Text style={styles.actionMenuDeleteText}>Delete</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionMenuCancel} onPress={() => setFolderAction(null)}>
              <Text style={styles.actionMenuCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        visible={!!renamingCredential}
        transparent
        animationType="fade"
        onRequestClose={() => !savingCredentialName && setRenamingCredential(null)}
      >
        <KeyboardAvoidingView style={styles.keyboardAvoiding} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={styles.datePickerBackdrop} onPress={() => !savingCredentialName && setRenamingCredential(null)}>
            <Pressable style={styles.newFileModalCard} onPress={() => undefined}>
              <Text style={styles.datePickerTitle}>Rename document</Text>
              <TextInput
                style={styles.newFileModalInput}
                value={credentialNameDraft}
                onChangeText={setCredentialNameDraft}
                placeholder="Document name"
                placeholderTextColor={PIZZA_FIRE.textMuted}
                autoFocus
                editable={!savingCredentialName}
              />
              <View style={styles.newFileModalActions}>
                <TouchableOpacity
                  style={styles.newFileModalCancel}
                  onPress={() => setRenamingCredential(null)}
                  disabled={savingCredentialName}
                >
                  <Text style={styles.newFileModalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.newFileModalSave}
                  onPressIn={() => Keyboard.dismiss()}
                  onPress={() => void handleRenameCredential()}
                  disabled={savingCredentialName}
                >
                  {savingCredentialName ? <ActivityIndicator color={PIZZA_FIRE.charcoal} size="small" /> : <Text style={styles.newFileModalSaveText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        visible={newDocFolderModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!savingDocFolder) {
            setNewDocFolderModalOpen(false);
            setEditingDocFolder(null);
            setEditingDefaultDocFolder(null);
          }
        }}
      >
        <KeyboardAvoidingView style={styles.keyboardAvoiding} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={styles.datePickerBackdrop} onPress={() => {
            if (!savingDocFolder) {
              setNewDocFolderModalOpen(false);
              setEditingDocFolder(null);
              setEditingDefaultDocFolder(null);
            }
          }}>
            <Pressable style={styles.newFileModalCard} onPress={() => undefined}>
            <Text style={styles.datePickerTitle}>{editingDocFolder || editingDefaultDocFolder ? 'Modify file name' : 'Create new file'}</Text>
            <Text style={styles.newFileModalHint}>Name the new space for your hygiene documents.</Text>
            <TextInput
              style={styles.newFileModalInput}
              value={newDocFolderName}
              onChangeText={setNewDocFolderName}
              placeholder="e.g. Training certificates"
              placeholderTextColor={PIZZA_FIRE.textMuted}
              autoFocus
              editable={!savingDocFolder}
            />
            <View style={styles.newFileModalActions}>
              <TouchableOpacity
                style={styles.newFileModalCancel}
                onPress={() => {
                  setNewDocFolderModalOpen(false);
                  setEditingDocFolder(null);
                  setEditingDefaultDocFolder(null);
                }}
                disabled={savingDocFolder}
              >
                <Text style={styles.newFileModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.newFileModalSave}
                onPressIn={() => Keyboard.dismiss()}
                onPress={() => void handleSaveDocumentFolder()}
                disabled={savingDocFolder}
              >
                {savingDocFolder ? <ActivityIndicator color={PIZZA_FIRE.charcoal} size="small" /> : <Text style={styles.newFileModalSaveText}>{editingDocFolder || editingDefaultDocFolder ? 'Save' : 'Create'}</Text>}
              </TouchableOpacity>
            </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
      <HygieneFolderPickerModal
        visible={folderPicker !== null}
        title={folderPicker?.mode === 'move' ? 'Move to folder' : 'Save document to'}
        folders={documentFolders}
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
          setFolderPicker(null);
          void handleUploadCredential(folder);
        }}
      />
    </View>
    </PizzaFireScreen>
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
  back: { color: PIZZA_FIRE.accent, fontSize: 16, fontWeight: '700' },
  title: { color: PIZZA_FIRE.textPrimary, fontSize: 24, fontWeight: '800' },
  content: { paddingHorizontal: 18, paddingBottom: 28 },
  section: { marginBottom: 24 },
  sectionTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 22, fontWeight: '800', marginBottom: 6 },
  sectionSub: { color: PIZZA_FIRE.textMuted, fontSize: 14, lineHeight: 20, marginBottom: 14 },
  card: {
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  emptyCard: {
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    borderRadius: 14,
    padding: 16,
  },
  emptyText: { color: PIZZA_FIRE.textMuted, fontSize: 14 },
  cardTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 18, fontWeight: '800', marginBottom: 8 },
  muted: { color: PIZZA_FIRE.textMuted, fontSize: 13, lineHeight: 18, marginBottom: 8 },
  input: {
    backgroundColor: PIZZA_FIRE.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    color: PIZZA_FIRE.textPrimary,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 10,
  },
  formLabel: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  coolerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  unitManageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: PIZZA_FIRE.divider,
  },
  unitRemoveButton: {
    borderWidth: 1,
    borderColor: PIZZA_FIRE.hotAccentBorder,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  unitRemoveText: { color: PIZZA_FIRE.hotAccent, fontSize: 12, fontWeight: '800' },
  unitAddRow: { flexDirection: 'row', gap: 8, paddingTop: 12 },
  unitAddInput: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    borderRadius: 8,
    color: PIZZA_FIRE.textPrimary,
    paddingHorizontal: 10,
  },
  unitAddButton: {
    minWidth: 62,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: PIZZA_FIRE.accent,
  },
  unitAddButtonDisabled: { opacity: 0.55 },
  unitAddText: { color: PIZZA_FIRE.charcoal, fontWeight: '800' },
  unitDeleteInlineButton: {
    width: 42,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.hotAccentBorder,
    backgroundColor: 'rgba(220, 74, 45, 0.16)',
  },
  unitDeleteInlineText: { color: PIZZA_FIRE.hotAccent, fontSize: 18, fontWeight: '800' },
  newUnitInlineInput: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    borderRadius: 8,
    color: PIZZA_FIRE.textPrimary,
    paddingHorizontal: 10,
  },
  unitManagementButton: {
    alignSelf: 'center',
    minHeight: 38,
    minWidth: 158,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    marginTop: 4,
    marginBottom: 10,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.accent,
    backgroundColor: 'rgba(255, 159, 28, 0.12)',
  },
  unitManagementButtonText: { color: PIZZA_FIRE.cheese, fontSize: 13, fontWeight: '800' },
  coolerLabel: {
    flex: 1,
    flexShrink: 1,
    color: PIZZA_FIRE.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  noteLinkButton: {
    paddingHorizontal: 2,
  },
  noteLinkText: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  noteLinkTextActive: {
    color: '#E9B261',
  },
  tempInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PIZZA_FIRE.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    paddingHorizontal: 8,
    width: 72,
  },
  tempInput: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    paddingVertical: 8,
    flex: 1,
    textAlign: 'right',
  },
  rowConfirmButton: {
    backgroundColor: PIZZA_FIRE.accent,
    borderRadius: 10,
    width: 44,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowConfirmButtonDisabled: {
    opacity: 0.7,
  },
  rowConfirmButtonText: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 12,
    fontWeight: '800',
  },
  tempUnit: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 4,
  },
  primaryButton: {
    backgroundColor: PIZZA_FIRE.accent,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: PIZZA_FIRE.textPrimary, fontSize: 15, fontWeight: '800' },
  uploadButtonUploading: { backgroundColor: '#3182CE' },
  uploadButtonSuccess: { backgroundColor: '#48BB78' },
  noteModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  noteModalCard: {
    backgroundColor: PIZZA_FIRE.bgMid,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    padding: 18,
  },
  noteModalTitle: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
  },
  noteModalInput: {
    backgroundColor: PIZZA_FIRE.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    color: PIZZA_FIRE.textPrimary,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 88,
    textAlignVertical: 'top',
  },
  noteModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 14,
  },
  noteModalCancel: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  noteModalCancelText: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  noteModalSave: {
    backgroundColor: PIZZA_FIRE.accent,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  noteModalSaveText: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  secondaryButton: {
    marginTop: 10,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PIZZA_FIRE.accent,
    backgroundColor: PIZZA_FIRE.accentSoft,
  },
  secondaryButtonText: { color: PIZZA_FIRE.accent, fontSize: 15, fontWeight: '800' },
  exportArchiveButton: { marginTop: 10 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  folderRow: {
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  folderRowOpen: { flex: 1 },
  navRow: {
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  folderRowBody: { flex: 1 },
  folderRowTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '800', marginBottom: 4 },
  folderRowMeta: { color: PIZZA_FIRE.textMuted, fontSize: 13 },
  folderRowArrow: { color: PIZZA_FIRE.accent, fontSize: 22, fontWeight: '800' },
  documentCardHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  documentCardTitle: { flex: 1, marginRight: 8 },
  overflowButton: { alignItems: 'center', justifyContent: 'center', minHeight: 30, minWidth: 30, marginRight: -6, marginTop: -5 },
  overflowButtonText: { color: PIZZA_FIRE.textMuted, fontSize: 23, fontWeight: '800', lineHeight: 25 },
  folderBack: { marginBottom: 8 },
  folderBackText: { color: PIZZA_FIRE.accent, fontSize: 15, fontWeight: '700' },
  folderHeading: { color: PIZZA_FIRE.textPrimary, fontSize: 18, fontWeight: '800', marginBottom: 10 },
  documentFolderModalSafe: { flex: 1, backgroundColor: PIZZA_FIRE.bgMid },
  documentFolderModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: PIZZA_FIRE.divider, paddingHorizontal: 18, paddingVertical: 14 },
  documentFolderModalTitle: { color: PIZZA_FIRE.textPrimary, flex: 1, fontSize: 20, fontWeight: '800', paddingRight: 12 },
  documentFolderModalClose: { paddingVertical: 8, paddingLeft: 12 },
  documentFolderModalCloseText: { color: PIZZA_FIRE.accent, fontSize: 14, fontWeight: '800' },
  documentFolderModalContent: { padding: 18, paddingBottom: 34 },
  documentFolderModalHint: { color: PIZZA_FIRE.textMuted, fontSize: 12, lineHeight: 17, marginTop: 12, marginBottom: 12 },
  createFileLink: { alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 2, marginTop: 6 },
  createFileLinkText: { color: PIZZA_FIRE.textMuted, fontSize: 12, fontWeight: '700' },
  newFileModalCard: { backgroundColor: PIZZA_FIRE.bgMid, borderRadius: 14, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder, padding: 18 },
  newFileModalHint: { color: PIZZA_FIRE.textMuted, fontSize: 13, lineHeight: 18, marginBottom: 14 },
  newFileModalInput: { backgroundColor: PIZZA_FIRE.inputBg, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder, borderRadius: 10, color: PIZZA_FIRE.textPrimary, fontSize: 15, paddingHorizontal: 12, paddingVertical: 11 },
  newFileModalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  newFileModalCancel: { paddingHorizontal: 14, paddingVertical: 10 },
  newFileModalCancelText: { color: PIZZA_FIRE.textMuted, fontSize: 14, fontWeight: '700' },
  newFileModalSave: { minWidth: 76, alignItems: 'center', backgroundColor: PIZZA_FIRE.accent, borderRadius: 9, paddingHorizontal: 16, paddingVertical: 10 },
  newFileModalSaveText: { color: PIZZA_FIRE.charcoal, fontSize: 14, fontWeight: '800' },
  keyboardAvoiding: { flex: 1 },
  actionMenuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end', padding: 16 },
  actionMenuCard: { backgroundColor: PIZZA_FIRE.bgMid, borderRadius: 16, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder, padding: 10 },
  actionMenuTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 15, fontWeight: '800', paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10 },
  actionMenuOption: { paddingHorizontal: 12, paddingVertical: 13, borderTopWidth: 1, borderTopColor: PIZZA_FIRE.divider },
  actionMenuOptionText: { color: PIZZA_FIRE.textPrimary, fontSize: 15, fontWeight: '700' },
  actionMenuDeleteText: { color: '#E16B62', fontSize: 15, fontWeight: '800' },
  actionMenuCancel: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  actionMenuCancelText: { color: PIZZA_FIRE.textMuted, fontSize: 14, fontWeight: '800' },
  linkButton: { paddingTop: 4 },
  linkText: { color: '#E9B261', fontSize: 14, fontWeight: '700' },
  deleteButton: {
    borderWidth: 1,
    borderColor: '#67483B',
    backgroundColor: PIZZA_FIRE.crustDark,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  deleteButtonText: { color: '#D89A79', fontWeight: '800', fontSize: 12 },
  logHint: { color: PIZZA_FIRE.textMuted, fontSize: 13, marginTop: 10 },
  seasonHeader: { marginBottom: 10, marginTop: 4 },
  seasonHeaderLabel: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  seasonHeaderName: { color: PIZZA_FIRE.gold, fontSize: 20, fontWeight: '900' },
  seasonMonthBlock: { marginBottom: 14 },
  seasonMonthLabel: { color: PIZZA_FIRE.textPrimary, fontSize: 15, fontWeight: '800', marginBottom: 8 },
  auditLedger: {
    borderWidth: 1,
    borderColor: '#3C342C',
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: PIZZA_FIRE.crustDark,
  },
  auditTableHeader: {
    flexDirection: 'row',
    backgroundColor: '#211B17',
    borderBottomWidth: 1,
    borderBottomColor: '#3C342C',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  auditTableHeadText: {
    color: '#D5C6B4',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  auditTableRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2D2621',
  },
  auditTableRowTouchable: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2D2621',
    backgroundColor: PIZZA_FIRE.crustDark,
  },
  auditTableRowReview: {
    backgroundColor: 'rgba(201, 120, 43, 0.08)',
  },
  emptyRow: { padding: 16 },
  auditTableText: {
    color: '#F1E8D8',
    fontSize: 12,
    lineHeight: 16,
    paddingRight: 8,
  },
  colUnit: { flex: 1.35 },
  colTemp: { flex: 0.7 },
  colBy: { flex: 1.1 },
  colWhen: { flex: 1.45 },
  logModalSafe: { flex: 1, backgroundColor: PIZZA_FIRE.bgMid },
  logModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: PIZZA_FIRE.divider,
  },
  logModalTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 22, fontWeight: '800' },
  logModalClose: { color: PIZZA_FIRE.accent, fontSize: 16, fontWeight: '700' },
  reviewBar: {
    backgroundColor: 'rgba(201, 120, 43, 0.14)',
    borderBottomWidth: 1,
    borderBottomColor: '#5B4638',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  reviewBarTitle: { color: '#E9B261', fontSize: 16, fontWeight: '800', marginBottom: 4 },
  reviewBarText: { color: PIZZA_FIRE.textMuted, fontSize: 13 },
  logModalBody: { flex: 1 },
  logModalScroll: { paddingHorizontal: 18, paddingBottom: 24 },
  logModalHint: { color: PIZZA_FIRE.textMuted, fontSize: 12, marginVertical: 12 },
  editPanel: {
    borderTopWidth: 1,
    borderTopColor: PIZZA_FIRE.divider,
    backgroundColor: PIZZA_FIRE.surfaceInset,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 18,
  },
  editPanelTitle: { color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '800', marginBottom: 10 },
  editFieldLabel: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  editDateButton: {
    backgroundColor: PIZZA_FIRE.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 12,
  },
  editDateButtonText: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  editPanelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  editInput: {
    flex: 1,
    backgroundColor: PIZZA_FIRE.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    color: PIZZA_FIRE.textPrimary,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
    fontWeight: '700',
  },
  editNotesInput: {
    backgroundColor: PIZZA_FIRE.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    color: PIZZA_FIRE.textPrimary,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    marginBottom: 12,
  },
  editPanelActions: { flexDirection: 'row', gap: 10 },
  editCancelButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#5B4638',
  },
  editCancelText: { color: PIZZA_FIRE.textMuted, fontSize: 15, fontWeight: '800' },
  editSaveButton: { flex: 1 },
  datePickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 20,
  },
  datePickerCard: {
    backgroundColor: PIZZA_FIRE.bgMid,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  datePickerTitle: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  datePickerCloseButton: {
    marginTop: 12,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  datePickerCloseText: {
    color: PIZZA_FIRE.accent,
    fontSize: 15,
    fontWeight: '800',
  },
});
