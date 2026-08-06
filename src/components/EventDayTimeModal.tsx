import React, { useEffect, useState } from 'react';
import { Alert, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import {
  dateToTimeString,
  formatTimeRange,
  isValidTimeRange,
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

export default function EventDayTimeModal({
  visible,
  dayLabel,
  startTime,
  endTime,
  onClose,
  onConfirm,
}: Props) {
  const [startDraft, setStartDraft] = useState(() => timeStringToDate(startTime));
  const [endDraft, setEndDraft] = useState(() => timeStringToDate(endTime));

  useEffect(() => {
    if (!visible) return;
    setStartDraft(timeStringToDate(startTime));
    setEndDraft(timeStringToDate(endTime));
  }, [visible, startTime, endTime]);

  const handleStartChange = (_event: DateTimePickerEvent, selected?: Date) => {
    if (selected) setStartDraft(selected);
  };

  const handleEndChange = (_event: DateTimePickerEvent, selected?: Date) => {
    if (selected) setEndDraft(selected);
  };

  const confirm = () => {
    const nextStart = dateToTimeString(startDraft);
    const nextEnd = dateToTimeString(endDraft);
    if (!isValidTimeRange(nextStart, nextEnd)) {
      Alert.alert('Invalid times', 'Finish time must be after start time.');
      return;
    }
    onConfirm(nextStart, nextEnd);
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{dayLabel || 'Day hours'}</Text>
          <Text style={styles.subtitle}>Set start and finish for this day</Text>

          <View style={styles.previewRow}>
            <Text style={styles.previewText}>
              {formatTimeRange(dateToTimeString(startDraft), dateToTimeString(endDraft))}
            </Text>
          </View>

          <Text style={styles.fieldLabel}>Start</Text>
          <DateTimePicker
            value={startDraft}
            mode="time"
            is24Hour={false}
            display={Platform.OS === 'ios' ? 'spinner' : 'spinner'}
            onChange={handleStartChange}
            themeVariant="dark"
          />

          <Text style={styles.fieldLabel}>Finish</Text>
          <DateTimePicker
            value={endDraft}
            mode="time"
            is24Hour={false}
            display={Platform.OS === 'ios' ? 'spinner' : 'spinner'}
            onChange={handleEndChange}
            themeVariant="dark"
          />

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmBtn} onPress={confirm}>
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
    backgroundColor: '#1E1813',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
  title: {
    color: '#F6EDE2',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    color: '#A88E73',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  previewRow: {
    backgroundColor: '#2A211B',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
  previewText: {
    color: '#C9782B',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  fieldLabel: {
    color: '#A88E73',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 4,
    marginBottom: 2,
    marginLeft: 4,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 12,
  },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cancelText: {
    color: '#A88E73',
    fontWeight: '700',
  },
  confirmBtn: {
    backgroundColor: '#C9782B',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  confirmText: {
    color: '#1E1813',
    fontWeight: '900',
  },
});
