import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Calendar } from 'react-native-calendars';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  collection,
  getFirestore,
  onSnapshot,
  query,
  where,
} from '@react-native-firebase/firestore';
import { auth } from '../services/firebase';
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
  TEMPERATURE_TARGETS,
  updateTemperatureLog,
} from '../services/hygiene';
import { useHygieneCredentialUpload } from '../hooks/useHygieneCredentialUpload';
import { getPendingTemperatureLogs } from '../context/OfflineContext';
import { subscribeOutboxChanges } from '../offline/events';

type Props = NativeStackScreenProps<RootStackParamList, 'Hygiene'>;

const currentMonth = new Date().toISOString().slice(0, 7);

function buildEmptyTemperatures() {
  return Object.fromEntries(TEMPERATURE_TARGETS.map(target => [target.key, '']));
}

export default function HygieneScreen({ navigation }: Props) {
  const { pickAndUpload, nameConfirmModal, isPicking, isConfirming, isUploading } = useHygieneCredentialUpload();
  const userId = auth.currentUser?.uid || null;
  const [credentials, setCredentials] = useState<any[]>([]);
  const [temperatureHistory, setTemperatureHistory] = useState<any[]>([]);
  const [temperatures, setTemperatures] = useState<Record<string, string>>(buildEmptyTemperatures);
  const [unitNotes, setUnitNotes] = useState<Record<string, string>>(buildEmptyTemperatures);
  const [noteModalKey, setNoteModalKey] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingUnitKey, setSavingUnitKey] = useState<string | null>(null);
  const [uploadButtonState, setUploadButtonState] = useState<'idle' | 'uploading' | 'success'>('idle');
  const uploadSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [deletingCredentialId, setDeletingCredentialId] = useState<string | null>(null);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [deletingTempId, setDeletingTempId] = useState<string | null>(null);
  const [editingLog, setEditingLog] = useState<{
    id: string;
    label: string;
    value: string;
    notes: string;
  } | null>(null);
  const [addingLog, setAddingLog] = useState<{
    targetKey: string;
    label: string;
    value: string;
    notes: string;
    dateKey: string;
  } | null>(null);
  const [addDatePickerOpen, setAddDatePickerOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [savingAdd, setSavingAdd] = useState(false);
  const [pendingTemps, setPendingTemps] = useState<any[]>([]);
  const [monthKey, setMonthKey] = useState(currentMonth);
  const [exporting, setExporting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadingExportId, setDownloadingExportId] = useState<string | null>(null);
  const [exportsList, setExportsList] = useState<any[]>([]);

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
      const items = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
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
  const targets = useMemo(() => TEMPERATURE_TARGETS, []);
  const latestByUnit = useMemo(
    () =>
      targets.map(target => {
        const entries = mergedTemperatureHistory.filter(item => String(item.targetKey) === target.key);
        return {
          target,
          latest: entries.length > 0 ? entries[entries.length - 1] : null,
        };
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

  const handleConfirmUnit = (target: (typeof TEMPERATURE_TARGETS)[number]) => {
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

  const submitUnitTemperature = async (
    target: (typeof TEMPERATURE_TARGETS)[number],
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

  const handleViewLog = () => {
    openConsolidatedLog();
  };

  const openConsolidatedLog = () => {
    setReviewMode(false);
    setEditingLog(null);
    setAddingLog(null);
    setLogModalOpen(true);
  };

  const closeConsolidatedLog = () => {
    setLogModalOpen(false);
    setReviewMode(false);
    setEditingLog(null);
    setAddingLog(null);
    setAddDatePickerOpen(false);
  };

  const buildAddEntryState = (prefill: { targetKey: string; label: string }) => ({
    ...prefill,
    value: '',
    notes: '',
    dateKey: localDateKey(new Date()),
  });

  const combineDateKeyWithNow = (dateKey: string) => {
    const [year, month, day] = dateKey.split('-').map(part => Number(part));
    const combined = new Date();
    combined.setFullYear(year, month - 1, day);
    return combined;
  };

  const formatAddEntryDateLabel = (dateKey: string) =>
    new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

  const openAddEntry = (prefill?: { targetKey: string; label: string }) => {
    setEditingLog(null);
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
          onPress: () => setAddingLog(buildAddEntryState(target)),
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
    setSavingEdit(true);
    try {
      await updateTemperatureLog(editingLog.id, editingLog.value, editingLog.notes);
      setEditingLog(null);
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

  const handleUploadCredential = async () => {
    if (!canUpload) return;
    if (uploadSuccessTimeoutRef.current) {
      clearTimeout(uploadSuccessTimeoutRef.current);
      uploadSuccessTimeoutRef.current = null;
    }
    try {
      const uploaded = await pickAndUpload();
      if (!uploaded) {
        setUploadButtonState('idle');
        return;
      }
      setUploadButtonState('success');
      uploadSuccessTimeoutRef.current = setTimeout(() => {
        setUploadButtonState('idle');
        uploadSuccessTimeoutRef.current = null;
      }, 2500);
      Alert.alert(
        'Uploaded',
        `Card uploaded. Next recurring education reminder is due ${new Date(
          uploaded.nextEducationDueAtIso
        ).toLocaleDateString()}.`
      );
    } catch (error: any) {
      setUploadButtonState('idle');
      Alert.alert('Upload failed', error?.message || 'Could not upload hygiene card.');
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
    <SafeAreaView style={styles.safe}>
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
            {targets.map(target => {
              const note = String(unitNotes[target.key] || '').trim();
              const saving = savingUnitKey === target.key;
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
                  <TouchableOpacity
                    style={[styles.rowConfirmButton, saving ? styles.rowConfirmButtonDisabled : null]}
                    onPress={() => handleConfirmUnit(target)}
                    disabled={saving}
                  >
                    {saving ? (
                      <ActivityIndicator color="#F6EDE2" size="small" />
                    ) : (
                      <Text style={styles.rowConfirmButtonText}>Log</Text>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })}

            <TouchableOpacity style={styles.secondaryButton} onPress={handleViewLog}>
              <Text style={styles.secondaryButtonText}>View Log</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Temperature Record</Text>
          <Text style={styles.sectionSub}>
            Latest reading per cooling unit. Tap a row to open the full consolidated log.
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
          <Text style={styles.sectionTitle}>Employee Hygiene Cards</Text>
          <Text style={styles.sectionSub}>
            Upload photos or documents (PDF, PNG, JPEG, HEIC) for inspections and recurring education tracking.
          </Text>
          <TouchableOpacity
            style={[
              styles.primaryButton,
              uploadButtonBusy && styles.uploadButtonUploading,
              uploadButtonState === 'success' && styles.uploadButtonSuccess,
            ]}
            onPress={() => void handleUploadCredential()}
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
          {credentials.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No hygiene cards uploaded yet.</Text>
            </View>
          ) : (
            credentials.map(item => (
              <View key={item.id} style={styles.card}>
                <Text style={styles.cardTitle}>{item.fileName || 'Hygiene card'}</Text>
                <Text style={styles.muted}>Uploaded: {formatDateTime(item.uploadedAt, item.uploadedAtIso)}</Text>
                <Text style={styles.muted}>
                  Education due: {item.nextEducationDueAtIso ? new Date(item.nextEducationDueAtIso).toLocaleDateString() : 'Unknown'}
                </Text>
                <View style={styles.cardActions}>
                  <TouchableOpacity style={styles.linkButton} onPress={() => void Linking.openURL(String(item.downloadUrl || ''))}>
                    <Text style={styles.linkText}>Open file</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => confirmDeleteCredential(item)}
                    disabled={deletingCredentialId === item.id}
                  >
                    {deletingCredentialId === item.id ? (
                      <ActivityIndicator color="#C97934" />
                    ) : (
                      <Text style={styles.deleteButtonText}>Delete</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
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
                <ActivityIndicator color="#F6EDE2" />
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
                <ActivityIndicator color="#C9782B" />
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
                    <ActivityIndicator color="#C9782B" size="small" />
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
            <Text style={styles.logModalTitle}>Cooling Log</Text>
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
              <Text style={styles.logModalHint}>
                Long press for review or add entry.
              </Text>
              <View style={styles.auditLedger}>
                <View style={styles.auditTableHeader}>
                  <Text style={[styles.auditTableHeadText, styles.colUnit]}>Unit</Text>
                  <Text style={[styles.auditTableHeadText, styles.colTemp]}>Temp</Text>
                  <Text style={[styles.auditTableHeadText, styles.colBy]}>Recorded By</Text>
                  <Text style={[styles.auditTableHeadText, styles.colWhen]}>When</Text>
                </View>
                {consolidatedLogEntries.length === 0 ? (
                  <View style={styles.emptyRow}>
                    <Text style={styles.emptyText}>No temperature history yet.</Text>
                  </View>
                ) : (
                  consolidatedLogEntries.map(item => renderLogRow(item, true))
                )}
              </View>
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
                <Text style={styles.editDateButtonText}>{formatAddEntryDateLabel(addingLog.dateKey)}</Text>
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
                    <ActivityIndicator color="#F6EDE2" />
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
                <TouchableOpacity style={styles.editCancelButton} onPress={() => setEditingLog(null)}>
                  <Text style={styles.editCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryButton, styles.editSaveButton]}
                  onPress={() => void handleSaveEdit()}
                  disabled={savingEdit}
                >
                  {savingEdit ? (
                    <ActivityIndicator color="#F6EDE2" />
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
            <Calendar
              theme={{
                backgroundColor: '#1E1813',
                calendarBackground: '#1E1813',
                selectedDayBackgroundColor: '#C9782B',
                dayTextColor: '#F6EDE2',
                monthTextColor: '#F6EDE2',
                arrowColor: '#C9782B',
                todayTextColor: '#E9B261',
              }}
              onDayPress={day => {
                setAddingLog(current => (current ? { ...current, dateKey: day.dateString } : current));
                setAddDatePickerOpen(false);
              }}
              markedDates={
                addingLog
                  ? { [addingLog.dateKey]: { selected: true, selectedColor: '#C9782B' } }
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#1B140F' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 14,
  },
  back: { color: '#C9782B', fontSize: 16, fontWeight: '700' },
  title: { color: '#F6EDE2', fontSize: 24, fontWeight: '800' },
  content: { paddingHorizontal: 18, paddingBottom: 28 },
  section: { marginBottom: 24 },
  sectionTitle: { color: '#F6EDE2', fontSize: 22, fontWeight: '800', marginBottom: 6 },
  sectionSub: { color: '#C9B29A', fontSize: 14, lineHeight: 20, marginBottom: 14 },
  card: {
    backgroundColor: '#241B15',
    borderWidth: 1,
    borderColor: '#3A2D24',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
  },
  emptyCard: {
    backgroundColor: '#241B15',
    borderWidth: 1,
    borderColor: '#3A2D24',
    borderRadius: 18,
    padding: 16,
  },
  emptyText: { color: '#C9B29A', fontSize: 14 },
  cardTitle: { color: '#F6EDE2', fontSize: 18, fontWeight: '800', marginBottom: 8 },
  muted: { color: '#C9B29A', fontSize: 13, lineHeight: 18, marginBottom: 8 },
  input: {
    backgroundColor: '#140F0B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3A2D24',
    color: '#F6EDE2',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 10,
  },
  formLabel: {
    color: '#C9B29A',
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
  coolerLabel: {
    flex: 1,
    flexShrink: 1,
    color: '#F6EDE2',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  noteLinkButton: {
    paddingHorizontal: 2,
  },
  noteLinkText: {
    color: '#8F6A48',
    fontSize: 12,
    fontWeight: '800',
  },
  noteLinkTextActive: {
    color: '#E9B261',
  },
  tempInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#140F0B',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3A2D24',
    paddingHorizontal: 8,
    width: 72,
  },
  tempInput: {
    color: '#F6EDE2',
    fontSize: 16,
    fontWeight: '700',
    paddingVertical: 8,
    flex: 1,
    textAlign: 'right',
  },
  rowConfirmButton: {
    backgroundColor: '#C9782B',
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
    color: '#F6EDE2',
    fontSize: 12,
    fontWeight: '800',
  },
  tempUnit: {
    color: '#C9B29A',
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 4,
  },
  primaryButton: {
    backgroundColor: '#C9782B',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: '#F6EDE2', fontSize: 15, fontWeight: '800' },
  uploadButtonUploading: { backgroundColor: '#3182CE' },
  uploadButtonSuccess: { backgroundColor: '#48BB78' },
  noteModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  noteModalCard: {
    backgroundColor: '#241B15',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#3A2D24',
    padding: 18,
  },
  noteModalTitle: {
    color: '#F6EDE2',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
  },
  noteModalInput: {
    backgroundColor: '#140F0B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3A2D24',
    color: '#F6EDE2',
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
    color: '#C9B29A',
    fontSize: 14,
    fontWeight: '700',
  },
  noteModalSave: {
    backgroundColor: '#C9782B',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  noteModalSaveText: {
    color: '#F6EDE2',
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
    borderColor: '#C9782B',
    backgroundColor: 'rgba(201, 120, 43, 0.12)',
  },
  secondaryButtonText: { color: '#C9782B', fontSize: 15, fontWeight: '800' },
  exportArchiveButton: { marginTop: 10 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  linkButton: { paddingTop: 4 },
  linkText: { color: '#E9B261', fontSize: 14, fontWeight: '700' },
  deleteButton: {
    borderWidth: 1,
    borderColor: '#67483B',
    backgroundColor: '#171311',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  deleteButtonText: { color: '#D89A79', fontWeight: '800', fontSize: 12 },
  logHint: { color: '#8F6A48', fontSize: 13, marginTop: 10 },
  auditLedger: {
    borderWidth: 1,
    borderColor: '#3C342C',
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#171311',
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
    backgroundColor: '#171311',
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
  logModalSafe: { flex: 1, backgroundColor: '#1B140F' },
  logModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#3A2D24',
  },
  logModalTitle: { color: '#F6EDE2', fontSize: 22, fontWeight: '800' },
  logModalClose: { color: '#C9782B', fontSize: 16, fontWeight: '700' },
  reviewBar: {
    backgroundColor: 'rgba(201, 120, 43, 0.14)',
    borderBottomWidth: 1,
    borderBottomColor: '#5B4638',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  reviewBarTitle: { color: '#E9B261', fontSize: 16, fontWeight: '800', marginBottom: 4 },
  reviewBarText: { color: '#C9B29A', fontSize: 13 },
  logModalBody: { flex: 1 },
  logModalScroll: { paddingHorizontal: 18, paddingBottom: 24 },
  logModalHint: { color: '#8F6A48', fontSize: 12, marginVertical: 12 },
  editPanel: {
    borderTopWidth: 1,
    borderTopColor: '#3A2D24',
    backgroundColor: '#241B15',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 18,
  },
  editPanelTitle: { color: '#F6EDE2', fontSize: 16, fontWeight: '800', marginBottom: 10 },
  editFieldLabel: {
    color: '#C9B29A',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  editDateButton: {
    backgroundColor: '#140F0B',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3A2D24',
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 12,
  },
  editDateButtonText: {
    color: '#F6EDE2',
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
    backgroundColor: '#140F0B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3A2D24',
    color: '#F6EDE2',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
    fontWeight: '700',
  },
  editNotesInput: {
    backgroundColor: '#140F0B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3A2D24',
    color: '#F6EDE2',
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
  editCancelText: { color: '#C9B29A', fontSize: 15, fontWeight: '800' },
  editSaveButton: { flex: 1 },
  datePickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 20,
  },
  datePickerCard: {
    backgroundColor: '#1E1813',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
  datePickerTitle: {
    color: '#F6EDE2',
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
    color: '#C9782B',
    fontSize: 15,
    fontWeight: '800',
  },
});
