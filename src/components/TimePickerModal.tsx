import React, { useEffect, useState } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { dateToTimeString, timeStringToDate } from '../utils/eventDays';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';

type Props = {
  visible: boolean;
  value: string;
  title?: string;
  onClose: () => void;
  onConfirm: (time: string) => void;
};

export default function TimePickerModal({ visible, value, title = 'Select time', onClose, onConfirm }: Props) {
  const [draft, setDraft] = useState(() => timeStringToDate(value));

  useEffect(() => {
    if (visible) {
      setDraft(timeStringToDate(value));
    }
  }, [visible, value]);

  const handleChange = (_event: DateTimePickerEvent, selected?: Date) => {
    if (selected) setDraft(selected);
  };

  const confirm = () => {
    onConfirm(dateToTimeString(draft));
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <DateTimePicker
            value={draft}
            mode="time"
            is24Hour
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={handleChange}
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
    backgroundColor: PIZZA_FIRE.bgMid,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
  },
  title: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
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
