import React, { useEffect, useState } from 'react';
import { Alert, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import {
  dateToTimeString,
  formatOfficialOpeningRange,
  isValidEventOpeningRange,
  timeStringToDate,
} from '../utils/eventDays';

type Props = {
  visible: boolean;
  dayLabel: string;
  startTime: string;
  endTime: string;
  onClose: () => void;
  onConfirm: (startTime: string, endTime: string) => void;
};

export default function EventOpeningHoursModal({
  visible,
  dayLabel,
  startTime,
  endTime,
  onClose,
  onConfirm,
}: Props) {
  const [startDraft, setStartDraft] = useState(startTime);
  const [endDraft, setEndDraft] = useState(endTime);
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);

  useEffect(() => {
    if (!visible) {
      setPicking(null);
      return;
    }
    setStartDraft(startTime);
    setEndDraft(endTime);
  }, [visible, startTime, endTime]);

  const onPick = (event: DateTimePickerEvent, selected?: Date) => {
    if (event.type === 'dismissed') {
      setPicking(null);
      return;
    }
    if (!selected) return;
    const next = dateToTimeString(selected);
    if (picking === 'start') setStartDraft(next);
    if (picking === 'end') setEndDraft(next);
    if (Platform.OS === 'android') setPicking(null);
  };

  const confirm = () => {
    if (!isValidEventOpeningRange(startDraft, endDraft)) {
      Alert.alert('Invalid times', 'Opening and closing times must be valid and different.');
      return;
    }
    onConfirm(startDraft, endDraft);
    onClose();
  };

  if (!visible) return null;

  return (
    <>
      <Modal visible transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.title}>{dayLabel || 'Official opening'}</Text>
            <Text style={styles.subtitle}>24-hour clock. Closing may be after midnight.</Text>

            <View style={styles.previewRow}>
              <Text style={styles.previewText}>{formatOfficialOpeningRange(startDraft, endDraft)}</Text>
            </View>

            <TouchableOpacity style={styles.timeRow} onPress={() => setPicking('start')}>
              <Text style={styles.timeRowLabel}>Opens</Text>
              <Text style={styles.timeRowValue}>{startDraft}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.timeRow} onPress={() => setPicking('end')}>
              <Text style={styles.timeRowLabel}>Closes</Text>
              <Text style={styles.timeRowValue}>{endDraft}</Text>
            </TouchableOpacity>

            {picking && Platform.OS === 'ios' ? (
              <DateTimePicker
                value={timeStringToDate(picking === 'start' ? startDraft : endDraft)}
                mode="time"
                is24Hour
                display="spinner"
                onChange={onPick}
                themeVariant="dark"
              />
            ) : null}

            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={confirm}>
                <Text style={styles.confirmText}>Save hours</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {picking && Platform.OS === 'android' ? (
        <DateTimePicker
          value={timeStringToDate(picking === 'start' ? startDraft : endDraft)}
          mode="time"
          is24Hour
          display="default"
          onChange={onPick}
        />
      ) : null}
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
  },
  title: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  previewRow: {
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  previewText: {
    color: PIZZA_FIRE.accent,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  timeRowLabel: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  timeRowValue: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 8,
  },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cancelText: {
    color: PIZZA_FIRE.textMuted,
    fontWeight: '700',
  },
  confirmBtn: {
    backgroundColor: PIZZA_FIRE.accent,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  confirmText: {
    color: PIZZA_FIRE.charcoal,
    fontWeight: '900',
  },
});
