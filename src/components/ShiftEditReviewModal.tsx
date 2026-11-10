import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import PizzaFireButton from './PizzaFireButton';
import { doc, getDoc, getFirestore } from '@react-native-firebase/firestore';
import type { ShiftEditReviewPayload } from '../notifications/shiftEditReview';
import { approvePendingShiftEdit, rejectPendingShiftEdit, type LiveShift } from '../services/shifts';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import { buildShiftEditReviewView } from '../utils/shiftEditReviewView';

type Props = {
  payload: ShiftEditReviewPayload | null;
  onClose: () => void;
  onResolved: () => void;
};

export default function ShiftEditReviewModal({ payload, onClose, onResolved }: Props) {
  const [shift, setShift] = useState<LiveShift | null>(null);
  const [employeeName, setEmployeeName] = useState(payload?.employeeName || '');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!payload?.shiftId) {
      setShift(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setEmployeeName(payload.employeeName || '');

    void (async () => {
      try {
        const fs = getFirestore();
        const shiftSnap = await getDoc(doc(fs, 'shifts', payload.shiftId));
        if (cancelled) return;
        if (!shiftSnap.exists()) {
          setShift(null);
          return;
        }
        const next = { id: shiftSnap.id, ...shiftSnap.data() } as LiveShift;
        setShift(next);

        const uid = payload.employeeUserId || next.userId;
        if (uid && !payload.employeeName) {
          const userSnap = await getDoc(doc(fs, 'users', uid));
          if (!cancelled && userSnap.exists()) {
            const name = String(userSnap.data()?.name || userSnap.data()?.displayName || '').trim();
            if (name) setEmployeeName(name);
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('[ShiftEdit] failed loading review shift:', error);
          setShift(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [payload?.shiftId, payload?.employeeName, payload?.employeeUserId]);

  const view = shift ? buildShiftEditReviewView(shift, employeeName || payload?.employeeName || 'Employee') : null;

  const handleApprove = async () => {
    if (!payload?.shiftId || busy) return;
    setBusy(true);
    try {
      await approvePendingShiftEdit(payload.shiftId);
      onResolved();
    } catch (error) {
      Alert.alert('Could not approve', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!payload?.shiftId || busy) return;
    setBusy(true);
    try {
      await rejectPendingShiftEdit(payload.shiftId);
      onResolved();
    } catch (error) {
      Alert.alert('Could not reject', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={!!payload} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close shift edit request"
        />
        <View style={styles.card}>
          <Text style={styles.kicker}>Shift edit request</Text>
          {loading ? (
            <ActivityIndicator color={PIZZA_FIRE.flame} />
          ) : view ? (
            <>
              <Text style={styles.name}>{view.employeeName}</Text>
              {view.dateLabel ? <Text style={styles.meta}>{view.dateLabel}</Text> : null}
              <Text style={styles.meta}>{view.kindLabel}</Text>
              {view.worksiteLabel ? <Text style={styles.worksite}>{view.worksiteLabel}</Text> : null}
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Current</Text>
                <Text style={styles.rowValue}>{view.currentRange}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Requested</Text>
                <Text style={styles.rowValue}>{view.requestedLabel}</Text>
              </View>
              {!view.hasPending ? (
                <Text style={styles.handled}>This request was already handled.</Text>
              ) : null}
              <View style={styles.actions}>
                {view.hasPending ? (
                  <>
                    <PizzaFireButton label="Approve" variant="success" onPress={() => void handleApprove()} disabled={busy} />
                    <PizzaFireButton label="Reject" variant="danger" onPress={() => void handleReject()} disabled={busy} />
                  </>
                ) : null}
                <PizzaFireButton label="Close" variant="muted" onPress={onClose} disabled={busy} />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.name}>{payload?.employeeName || 'Employee'}</Text>
              <Text style={styles.handled}>This shift could not be found.</Text>
              <PizzaFireButton label="Close" variant="muted" onPress={onClose} />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: PIZZA_FIRE.overlay,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    backgroundColor: PIZZA_FIRE.bgMid,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.flame,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 10,
  },
  kicker: {
    color: PIZZA_FIRE.flame,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  name: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  meta: {
    color: PIZZA_FIRE.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  worksite: {
    color: PIZZA_FIRE.flame,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  row: {
    backgroundColor: PIZZA_FIRE.surfaceRaised,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  rowLabel: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  rowValue: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  handled: {
    color: PIZZA_FIRE.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
});
