import React from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import type { DocumentNameSource } from '../utils/suggestDocumentName';

type Props = {
  visible: boolean;
  onSelect: (source: DocumentNameSource) => void;
  onCancel: () => void;
};

const choices: Array<{ label: string; source: DocumentNameSource }> = [
  { label: 'Scan document (AI)', source: 'scan' },
  { label: 'Photo library', source: 'library' },
  { label: 'Take photo', source: 'camera' },
  { label: 'Choose file', source: 'document' },
];

export default function HygieneUploadSourceModal({ visible, onSelect, onCancel }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={event => event.stopPropagation()}>
          <Text style={styles.title}>Upload document</Text>
          <Text style={styles.subtitle}>Photos are enhanced automatically before upload.</Text>
          {choices.map(choice => (
            <TouchableOpacity key={choice.source} style={styles.option} onPress={() => onSelect(choice.source)}>
              <Text style={styles.optionText}>{choice.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.cancel} onPress={onCancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, backgroundColor: 'rgba(0,0,0,0.55)' },
  card: { backgroundColor: PIZZA_FIRE.bgMid, borderRadius: 16, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder, padding: 18 },
  title: { color: PIZZA_FIRE.textPrimary, fontSize: 19, fontWeight: '800' },
  subtitle: { color: PIZZA_FIRE.textMuted, fontSize: 13, lineHeight: 18, marginTop: 6, marginBottom: 14 },
  option: { backgroundColor: PIZZA_FIRE.surfaceInset, borderRadius: 12, borderWidth: 1, borderColor: PIZZA_FIRE.cardBorder, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 8 },
  optionText: { color: PIZZA_FIRE.textPrimary, fontSize: 15, fontWeight: '700' },
  cancel: { alignItems: 'center', paddingVertical: 10, marginTop: 2 },
  cancelText: { color: PIZZA_FIRE.textMuted, fontSize: 14, fontWeight: '700' },
});
