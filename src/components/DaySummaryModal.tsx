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
import PizzaFireButton from './PizzaFireButton';
import HoursChangeBadge from './HoursChangeBadge';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import { sheetCardStyle, useAppLayout } from '../theme/responsiveLayout';
import {
  applyPendingShiftEnds,
  loadLocalOfflineShifts,
  submitDaySummary,
  type LiveShift,
} from '../services/shifts';
import { getPendingShiftEnds } from '../offline/outbox';
import { subscribeOutboxChanges } from '../offline/events';
import type { PendingShiftEnd, WriteResult } from '../offline/types';
import {
  applyTimesToRow,
  buildDaySummaryRows,
  dailyShiftBreakdown,
  createAddedShiftRow,
  formatHoursMinutesLabel,
  formatIsoTimeRange,
  formatScheduledLabel,
  findOverlappingDaySummaryRow,
  mergeDaySummaryRows,
  rowChangeKind,
  totalWorkedMsFromSummaryRows,
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
  const layout = useAppLayout();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [liveShifts, setLiveShifts] = useState<LiveShift[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledShiftRow[]>([]);
  const [rows, setRows] = useState<DaySummaryRow[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [dateKey, setDateKey] = useState(() => localDateKey(new Date()));
  const [removedShiftIds, setRemovedShiftIds] = useState<string[]>([]);
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
  const offlineRef = useRef<LiveShift[]>([]);
  const pendingEndsRef = useRef<PendingShiftEnd[]>([]);
  const omittedShiftIdsRef = useRef<Set<string>>(new Set());
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
    for (const offline of offlineRef.current) {
      byId.set(offline.id, offline);
    }
    const active = activeShiftRef.current;
    if (active && !active.isScheduled) byId.set(active.id, active);
    setLiveShifts(applyPendingShiftEnds([...byId.values()], pendingEndsRef.current));
  };

  useEffect(() => {
    publishLiveShifts();
  }, [activeShift]);

  useEffect(() => {
    if (!visible) {
      setRows([]);
      setEditor(null);
      setRemovedShiftIds([]);
      setSaving(false);
      setLiveShifts([]);
      recentRef.current = [];
      openRef.current = [];
      offlineRef.current = [];
      omittedShiftIdsRef.current = new Set();
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
      const [offlineShifts, pending] = await Promise.all([
        loadLocalOfflineShifts(userId),
        getPendingShiftEnds(),
      ]);
      pendingEndsRef.current = pending;
      offlineRef.current = offlineShifts;
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
    setRows(current =>
      mergeDaySummaryRows(current, incoming).filter(
        row => !row.shiftId || !removedShiftIds.includes(row.shiftId)
      )
    );
  }, [visible, liveShifts, scheduled, dateKey, nowMs, removedShiftIds]);

  const totalLabel = formatHoursMinutesLabel(totalWorkedMsFromSummaryRows(rows, liveShifts, nowMs));
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
      const overlap = findOverlappingDaySummaryRow(rows, created);
      if (overlap) {
        Alert.alert('Cannot save', 'This shift overlaps another shift.');
        return;
      }
      setRows(rows =>
        [...rows, created].sort((a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime())
      );
      setEditor(null);
      return;
    }
    const existing = rows.find(row => row.draftId === current.draftId);
    if (!existing) {
      setEditor(null);
      return;
    }
    const next = applyTimesToRow(existing, dateKey, startTime, endTime);
    if (typeof next === 'string') {
      Alert.alert('Invalid times', next);
      return;
    }
    const overlap = findOverlappingDaySummaryRow(rows, next, current.draftId);
    if (overlap) {
      Alert.alert('Cannot save', 'This shift overlaps another shift.');
      return;
    }
    setRows(currentRows => currentRows.map(row => (row.draftId === current.draftId ? next : row)));
    setEditor(null);
  };

  const dropRow = (row: DaySummaryRow) => {
    if (row.shiftId) omittedShiftIdsRef.current.add(row.shiftId);
    setRows(current => current.filter(item => item.draftId !== row.draftId));
    setEditor(null);
  };

  const removeAdded = (draftId: string) => {
    const row = rows.find(item => item.draftId === draftId);
    if (row) dropRow(row);
    else setRows(current => current.filter(item => item.draftId !== draftId));
  };

  const handleEditorRemove = () => {
    const current = editorRef.current;
    if (!current || current.mode !== 'edit' || !current.draftId) {
      setEditor(null);
      return;
    }
    const row = rows.find(item => item.draftId === current.draftId);
    if (!row) {
      setEditor(null);
      return;
    }
    if (row.shiftId) {
      setRemovedShiftIds(ids => (ids.includes(row.shiftId!) ? ids : [...ids, row.shiftId!]));
    }
    setRows(currentRows => currentRows.filter(item => item.draftId !== row.draftId));
    setEditor(null);
  };

  const handleConfirmDay = async () => {
    if (!userId || saving) return;
    const error =
      rows.length === 0 && removedShiftIds.length > 0 ? null : validateDaySummaryRows(rows);
    if (error) {
      Alert.alert('Cannot confirm', error);
      return;
    }
    setSaving(true);
    try {
      const result = await submitDaySummary({
        userId,
        dateKey,
        removedShiftIds,
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
        <View style={[styles.card, sheetCardStyle(layout), { maxHeight: layout.isShort ? '92%' : '88%' }]}>
          <Text style={styles.title}>Day Summary</Text>
          <Text style={styles.subtitle}>Today's shifts</Text>

          {loading && rows.length === 0 ? (
            <ActivityIndicator color={PIZZA_FIRE.gold} style={{ marginVertical: 24 }} />
          ) : (
            <ScrollView
              style={[styles.list, { maxHeight: layout.isShort ? Math.round(layout.height * 0.42) : 360 }]}
              contentContainerStyle={styles.listContent}
            >
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

              <PizzaFireButton label="+ Add Shift" onPress={openAdd} fontSize={15} style={styles.addBtn} />
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
            <PizzaFireButton label="Cancel" variant="muted" onPress={handleCancel} disabled={saving} />
            <PizzaFireButton
              label="Confirm Day"
              onPress={() => void handleConfirmDay()}
              disabled={saving}
              loading={saving}
            />
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
        onDelete={editor?.mode === 'edit' ? handleEditorRemove : undefined}
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
    borderRadius: 8,
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
    borderRadius: 8,
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
    marginTop: 4,
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
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
});
