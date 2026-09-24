import React from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import {
  HYGIENE_DOCUMENT_FOLDERS,
  type HygieneDocumentFolderKey,
} from '../utils/hygieneDocumentFolders';

type FolderOption = { key: HygieneDocumentFolderKey; label: string };

type Props = {
  visible: boolean;
  title: string;
  folders?: ReadonlyArray<FolderOption>;
  excludeFolder?: HygieneDocumentFolderKey | null;
  onSelect: (folder: HygieneDocumentFolderKey) => void;
  onClose: () => void;
};

export default function HygieneFolderPickerModal({
  visible,
  title,
  folders = HYGIENE_DOCUMENT_FOLDERS,
  excludeFolder,
  onSelect,
  onClose,
}: Props) {
  const selectableFolders = folders.filter(folder => folder.key !== excludeFolder);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => undefined}>
          <Text style={styles.title}>{title}</Text>
          {selectableFolders.map(folder => (
            <TouchableOpacity
              key={folder.key}
              style={styles.option}
              onPress={() => onSelect(folder.key)}
            >
              <Text style={styles.optionText}>{folder.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: PIZZA_FIRE.bgMid,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    padding: 18,
  },
  title: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
  },
  option: {
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  optionText: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 4,
  },
  cancelText: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
});
