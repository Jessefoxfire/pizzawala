import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  collection,
  getFirestore,
  limit,
  onSnapshot,
  query,
  where,
} from '@react-native-firebase/firestore';
import EventDayTimeModal from './EventDayTimeModal';
import HoursChangeBadge from './HoursChangeBadge';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import { offlineOpenShiftToLiveShift, submitDaySummary, type LiveShift } from '../services/shifts';
import { getOfflineOpenShift } from '../offline/outbox';
import { subscribeOutboxChanges } from '../offline/events';
import type { WriteResult } from '../offline/types';
import {
  applyTimesToRow,
  buildDaySummaryRows,
  dailyShiftBreakdown,
  createAddedShiftRow,
  formatHoursMinutesLabel,
  formatIsoTimeRange,
  formatScheduledLabel,
  mergeDaySummaryRows,
  rowChangeKind,
  totalActualMs,
  validateDaySummaryRows,
  type DaySummaryRow,
} from '../utils/daySummary';
import { localDateKey, msToTimeValue, type ScheduledShiftRow } from '../utils/workingHours';

type Props = {
  visible: boolean;
  userId: string | null;
  activeShift?: LiveShift | null;
  onCancel: () => void;
  onConfirmed: (result: WriteResult) => void | Promise<void>;
};

function isLiveShift(shift: LiveShift) {
  return !shift.isScheduled && (shift.status === 'open' || shift.status === 'closed');
}

export default function DaySummaryModal({ visible, userId, activeShift = null, onCancel, onConfirmed }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [liveShifts, setLiveShifts] = useState<LiveShift[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledShiftRow[]>([]);
  const [rows, setRows] = useState<DaySummaryRow[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [dateKey, setDateKey] = useState(() => localDateKey(new Date()));
  const [editor, setEditor] = useState<{
    mode: 'edit' | 'add';
    draftId?: string;
    startTime: string;
    endTime: string;
  } | null>(null);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const recentRef = useRef<LiveShift[]>([]);
  const openRef = useRef<LiveShift[]>([]);
  const offlineRef = useRef<LiveShift | null>(null);
  const activeShiftRef = useRef<LiveShift | null>(activeShift);
  activeShiftRef.current = activeShift;

  const publishLiveShifts = () => {
    const byId = new Map<string, LiveShift>();
    for (const shift of recentRef.current) {
      if (isLiveShift(shift)) byId.set(shift.id, shift);
    }
    for (const shift of openRef.current) {
      if (!shift.isScheduled) byId.set(shift.id, shift);
    }
    const offline = offlineRef.current;
    if (offline) byId.set(offline.id, offline);
    const active = activeShiftRef.current;
    if (active && !active.isScheduled) byId.set(active.id, active);
    setLiveShifts([...byId.values()]);
  };

  useEffect(() => {
    publishLiveShifts();
  }, [activeShift]);

  useEffect(() => {
    if (!visible) {
      setRows([]);
      setEditor(null);
      setSaving(false);
      setLiveShifts([]);
      recentRef.current = [];
      openRef.current = [];
      offlineRef.current = null;
      return;
    }
    if (!userId) return undefined;

    const openedKey = localDateKey(new Date());
    const openedNow = Date.now();
    setDateKey(openedKey);
    setNowMs(openedNow);
    setLoading(true);
    publishLiveShifts();
    const fs = getFirestore();

    const unsubOpen = onSnapshot(
      query(
        collection(fs, 'shifts'),
        where('userId', '==', userId),
        where('status', '==', 'open'),
        limit(5)
      ),
      snap => {
        openRef.current = (snap?.docs || []).map(
          docSnap => ({ id: docSnap.id, ...docSnap.data() } as LiveShift)
        );
        publishLiveShifts();
        setLoading(false);
      },
      () => setLoading(false)
    );
    const unsubRecent = onSnapshot(
      query(collection(fs, 'shifts'), where('userId', '==', userId), limit(200)),
      snap => {
        recentRef.current = (snap?.docs || []).map(
          docSnap => ({ id: docSnap.id, ...docSnap.data() } as LiveShift)
        );
        publishLiveShifts();
        setLoading(false);
      },
      () => setLoading(false)
    );
    const unsubScheduled = onSnapshot(
      query(
        collection(fs, 'shifts'),
        where('userId', '==', userId),
        where('isScheduled', '==', true)
      ),
      snap => {
        setScheduled(
          (snap?.docs || []).map(docSnap => {
            const data = docSnap.data() as ScheduledShiftRow;
            return {
              id: docSnap.id,
              date: data.date,
              startTime: data.startTime,
              endTime: data.endTime,
            };
          })
        );
      }
    );

    const refreshOffline = async () => {
      const offline = await getOfflineOpenShift();
      offlineRef.current =
        offline && offline.userId === userId ? offlineOpenShiftToLiveShift(offline) : null;
      publishLiveShifts();
    };
    void refreshOffline();
    const unsubOutbox = subscribeOutboxChanges(() => {
      void refreshOffline();
    });

    return () => {
      unsubOpen();
      unsubRecent();
      unsubScheduled();
      unsubOutbox();
    };
  }, [visible, userId]);

  useEffect(() => {
    if (!visible) return;
    const incoming = buildDaySummaryRows(liveShifts, scheduled, dateKey, nowMs);
    setRows(current => mergeDaySummaryRows(current, incoming));
  }, [visible, liveShifts, scheduled, dateKey, nowMs]);

  const totalLabel = formatHoursMinutesLabel(totalActualMs(rows));
  const breakdown = useMemo(
    () => dailyShiftBreakdown(liveShifts, dateKey, nowMs),
    [liveShifts, dateKey, nowMs]
  );

  const handleCancel = () => {
    if (saving) return;
    onCancel();
  };

  const openAdd = () => {
    const last = rows[rows.length - 1];
    const fallbackStart = last ? msToTimeValue(new Date(last.endIso).getTime()) : '18:00';
    const fallbackEnd = last
      ? msToTimeValue(new Date(last.endIso).getTime() + 60 * 60 * 1000)
      : '20:00';
    setEditor({ mode: 'add', startTime: fallbackStart, endTime: fallbackEnd });
  };

  const openEdit = (row: DaySummaryRow) => {
    setEditor({
      mode: 'edit',
      draftId: row.draftId,
      startTime: msToTimeValue(new Date(row.startIso).getTime()),
      endTime: msToTimeValue(new Date(row.endIso).getTime()),
    });
  };

  const handleEditorConfirm = (startTime: string, endTime: string) => {
    const current = editorRef.current;
    if (!current) return;
    if (current.mode === 'add') {
      const created = createAddedShiftRow(dateKey, startTime, endTime);
      if (typeof created === 'string') {
        Alert.alert('Invalid times', created);
        return;
      }
      setRows(rows =>
        [...rows, created].sort((a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime())
      );
      setEditor(null);
      return;
    }
    let applied: DaySummaryRow | null = null;
    let error: string | null = null;
    setRows(rows =>
      rows.map(row => {
        if (row.draftId !== current.draftId) return row;
        const next = applyTimesToRow(row, dateKey, startTime, endTime);
        if (typeof next === 'string') {
          error = next;
          return row;
        }
        applied = next;
        return next;
      })
    );
    if (error) {
      Alert.alert('Invalid times', error);
      return;
    }
    if (applied) {
      setEditor(null);
    }
  };

  const removeAdded = (draftId: string) => {
    setRows(current => current.filter(row => row.draftId !== draftId));
  };

  const handleConfirmDay = async () => {
    if (!userId || saving) return;
    const error = validateDaySummaryRows(rows);
    if (error) {
      Alert.alert('Cannot confirm', error);
      return;
    }
    setSaving(true);
    try {
      const result = await submitDaySummary({
        userId,
        dateKey,
        rows: rows.map(row => ({
          shiftId: row.shiftId,
          added: row.added,
          isOpen: row.isOpen,
          startIso: row.startIso,
          endIso: row.endIso,
          originalStartIso: row.originalStartIso,
          originalEndIso: row.originalEndIso,
          scheduledShiftId: row.scheduledShiftId,
          scheduledStartTime: row.scheduledStartTime,
          scheduledEndTime: row.scheduledEndTime,
          timesChanged: row.added || rowChangeKind(row) === 'edited',
        })),
      });
      await onConfirmed(result);
    } catch (err: unknown) {
      Alert.alert('Could not confirm', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  return (
    <>
    <Modal visible transparent animationType="fade" onRequestClose={handleCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Day Summary</Text>
          <Text style={styles.subtitle}>Today's shifts</Text>

          {loading && rows.length === 0 ? (
            <ActivityIndicator color={PIZZA_FIRE.gold} style={{ marginVertical: 24 }} />
          ) : (
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {rows.length === 0 ? (
                <Text style={styles.empty}>No shifts recorded for today yet. Add a shift if you worked.</Text>
              ) : (
                rows.map(row => {
                  const kind = rowChangeKind(row);
                  return (
                    <View key={row.draftId} style={styles.row}>
                      <View style={{ flex: 1 }}>
                        <View style={styles.rowTitle}>
                          <Text style={styles.range}>{formatIsoTimeRange(row.startIso, row.endIso)}</Text>
                          <HoursChangeBadge added={kind === 'added'} edited={kind === 'edited'} />
                        </View>
                        {formatScheduledLabel(row.scheduledStartTime, row.scheduledEndTime) ? (
                          <Text style={styles.scheduled}>
                            {formatScheduledLabel(row.scheduledStartTime, row.scheduledEndTime)}
                          </Text>
                        ) : row.added ? (
                          <Text style={styles.scheduled}>Manually added</Text>
                        ) : null}
                      </View>
                      <View style={styles.rowActions}>
                        <TouchableOpacity onPress={() => openEdit(row)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Text style={styles.editText}>Edit</Text>
                        </TouchableOpacity>
                        {row.added && !row.shiftId ? (
                          <TouchableOpacity onPress={() => removeAdded(row.draftId)}>
                            <Text style={styles.removeText}>Remove</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </View>
                  );
                })
              )}

              <TouchableOpacity style={styles.addBtn} onPress={openAdd} activeOpacity={0.8}>
                <Text style={styles.addBtnText}>+ Add Shift</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          <View style={styles.breakdown}>
            {Object.entries(breakdown.worksites).filter(([, durationMs]) => durationMs > 0).map(([name, durationMs]) => (
              <Text key={name} style={styles.total}>{name}: {formatHoursMinutesLabel(durationMs)}</Text>
            ))}
            {breakdown.unassignedMs > 0 ? (
              <Text style={styles.total}>No worksite: {formatHoursMinutesLabel(breakdown.unassignedMs)}</Text>
            ) : null}
            {breakdown.breakMs > 0 ? (
              <Text style={styles.total}>Break: {formatHoursMinutesLabel(breakdown.breakMs)}</Text>
            ) : null}
            {breakdown.drivingMs > 0 ? (
              <Text style={styles.total}>Driving: {formatHoursMinutesLabel(breakdown.drivingMs)}</Text>
            ) : null}
            <Text style={styles.total}>Total: {totalLabel}</Text>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} disabled={saving}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmBtn} onPress={() => void handleConfirmDay()} disabled={saving}>
              <Text style={styles.confirmText}>{saving ? 'Saving…' : 'Confirm Day'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>

      <EventDayTimeModal
        visible={!!editor}
        dayLabel={editor?.mode === 'add' ? 'Add Shift' : 'Edit actual hours'}
        startTime={editor?.startTime || '09:00'}
        endTime={editor?.endTime || '17:00'}
        onClose={() => setEditor(null)}
        onConfirm={handleEditorConfirm}
      />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: PIZZA_FIRE.bgMid,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    maxHeight: '88%',
  },
  title: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 20,
    fontWeight: '900',
  },
  subtitle: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 13,
    marginTop: 4,
    marginBottom: 12,
    fontWeight: '600',
  },
  list: {
    maxHeight: 360,
  },
  listContent: {
    gap: 10,
    paddingBottom: 8,
  },
  empty: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PIZZA_FIRE.crustDark,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#2E241D',
    gap: 8,
  },
  rowTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  range: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  scheduled: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 12,
    marginTop: 4,
    fontStyle: 'italic',
  },
  rowActions: {
    alignItems: 'flex-end',
    gap: 6,
  },
  editText: {
    color: PIZZA_FIRE.accent,
    fontWeight: '800',
    fontSize: 13,
  },
  removeText: {
    color: '#9E3C2E',
    fontWeight: '700',
    fontSize: 12,
  },
  addBtn: {
    borderWidth: 1,
    borderColor: PIZZA_FIRE.accent,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  addBtnText: {
    color: PIZZA_FIRE.accent,
    fontWeight: '800',
    fontSize: 15,
  },
  total: {
    color: PIZZA_FIRE.gold,
    fontWeight: '900',
    fontSize: 16,
  },
  breakdown: {
    marginTop: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: PIZZA_FIRE.inputBg,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelText: {
    color: PIZZA_FIRE.textPrimary,
    fontWeight: '800',
  },
  confirmBtn: {
    flex: 1,
    backgroundColor: PIZZA_FIRE.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmText: {
    color: PIZZA_FIRE.charcoal,
    fontWeight: '900',
  },
});
