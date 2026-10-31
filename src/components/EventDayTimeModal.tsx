import React, { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker, {
  DateTimePickerAndroid,
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import {
  dateToTimeString,
  formatTimeLabel24,
  isValidTimeRange,
  timeStringToDate,
} from '../utils/eventDays';

type Props = {
  visible: boolean;
  dayLabel: string;
  startTime: string;
  endTime: string;
  onClose: () => void;
  onConfirm: (startTime: string, endTime: string) => void | Promise<void>;
};

type Field = 'start' | 'end';

export default function EventDayTimeModal({
  visible,
  dayLabel,
  startTime,
  endTime,
  onClose,
  onConfirm,
}: Props) {
  const [startDraft, setStartDraft] = useState(startTime);
  const [endDraft, setEndDraft] = useState(endTime);
  const [picking, setPicking] = useState<Field | null>(null);
  const [wheelDate, setWheelDate] = useState(() => timeStringToDate(startTime));
  const pendingRef = useRef<Date>(timeStringToDate(startTime));
  const pickingRef = useRef<Field | null>(null);
  const confirmingRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      pickingRef.current = null;
      setPicking(null);
      confirmingRef.current = false;
      if (Platform.OS === 'android') {
        void DateTimePickerAndroid.dismiss('time');
      }
      return;
    }
    setStartDraft(startTime);
    setEndDraft(endTime);
    pickingRef.current = null;
    setPicking(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- capture stored shift times only when the editor opens
  }, [visible]);

  const openPicker = (field: Field) => {
    if (pickingRef.current === field && Platform.OS === 'ios') return;
    const seed = timeStringToDate(field === 'start' ? startDraft : endDraft);
    pendingRef.current = seed;
    pickingRef.current = field;
    setWheelDate(seed);

    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: seed,
        mode: 'time',
        is24Hour: true,
        display: 'default',
        onChange: (event: DateTimePickerEvent, selected?: Date) => {
          pickingRef.current = null;
          if (event.type === 'dismissed' || !selected) return;
          const next = dateToTimeString(selected);
          if (field === 'start') setStartDraft(next);
          else setEndDraft(next);
        },
      });
      return;
    }

    setPicking(field);
  };

  const closePicker = () => {
    pickingRef.current = null;
    setPicking(null);
  };

  const onIosWheel = (_event: DateTimePickerEvent, selected?: Date) => {
    if (!selected) return;
    pendingRef.current = selected;
    setWheelDate(selected);
  };

  const handleCancel = () => {
    if (picking) {
      closePicker();
      return;
    }
    onClose();
  };

  const confirm = async () => {
    if (confirmingRef.current) return;
    const start = picking === 'start' ? dateToTimeString(pendingRef.current) : startDraft;
    const end = picking === 'end' ? dateToTimeString(pendingRef.current) : endDraft;
    if (!isValidTimeRange(start, end)) {
      Alert.alert('Invalid times', 'Finish time must be after start time.');
      return;
    }
    confirmingRef.current = true;
    try {
      await onConfirm(start, end);
    } finally {
      confirmingRef.current = false;
    }
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{dayLabel || 'Day hours'}</Text>
          <Text style={styles.subtitle}>24-hour clock. Tap Start or Finish to change a time.</Text>

          <View style={styles.previewRow}>
            <Text style={styles.previewText}>
              {formatTimeLabel24(startDraft)} – {formatTimeLabel24(endDraft)}
            </Text>
          </View>

          <TouchableOpacity style={styles.timeRow} onPress={() => openPicker('start')} activeOpacity={0.8}>
            <Text style={styles.timeRowLabel}>Start</Text>
            <Text style={styles.timeRowValue}>{formatTimeLabel24(startDraft)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.timeRow} onPress={() => openPicker('end')} activeOpacity={0.8}>
            <Text style={styles.timeRowLabel}>Finish</Text>
            <Text style={styles.timeRowValue}>{formatTimeLabel24(endDraft)}</Text>
          </TouchableOpacity>

          {picking && Platform.OS === 'ios' ? (
            <DateTimePicker
              value={wheelDate}
              mode="time"
              is24Hour
              display="spinner"
              onChange={onIosWheel}
              themeVariant="dark"
            />
          ) : null}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmBtn} onPress={() => void confirm()}>
              <Text style={styles.confirmText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
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
