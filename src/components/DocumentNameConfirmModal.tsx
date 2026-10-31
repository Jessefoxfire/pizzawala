import React, { useEffect, useState } from 'react';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

type Props = {
  visible: boolean;
  suggestedName: string;
  subtitle?: string;
  previewUri?: string | null;
  aiEnhanced?: boolean;
  aiFixBusy?: boolean;
  onCancel: () => void;
  onConfirm: (displayName: string) => void;
  onAiFix?: () => void;
};

export default function DocumentNameConfirmModal({
  visible,
  suggestedName,
  subtitle,
  previewUri,
  aiEnhanced = false,
  aiFixBusy = false,
  onCancel,
  onConfirm,
  onAiFix,
}: Props) {
  const [name, setName] = useState(suggestedName);

  useEffect(() => {
    if (visible) setName(suggestedName);
  }, [visible, suggestedName]);

  const canConfirm = name.trim().length > 0 && !aiFixBusy;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={event => event.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>Name this document</Text>
            <TouchableOpacity
              onPress={onCancel}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          {previewUri ? (
            <View style={styles.previewWrap}>
              <Image source={{ uri: previewUri }} style={styles.preview} resizeMode="contain" />
              {aiEnhanced ? (
                <View style={styles.aiBadge}>
                  <Text style={styles.aiBadgeText}>AI enhanced</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {onAiFix && previewUri ? (
            <TouchableOpacity
              style={[styles.aiFixButton, aiFixBusy && styles.aiFixButtonDisabled]}
              onPress={onAiFix}
              disabled={aiFixBusy}
            >
              {aiFixBusy ? (
                <ActivityIndicator color={PIZZA_FIRE.textPrimary} size="small" />
              ) : (
                <Text style={styles.aiFixText}>AI Fix again</Text>
              )}
            </TouchableOpacity>
          ) : null}
          <Text style={styles.label}>Document name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Enter a name"
            placeholderTextColor="#8F6A48"
            style={styles.input}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={() => {
              if (canConfirm) onConfirm(name);
            }}
          />
          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmButton, !canConfirm && styles.confirmButtonDisabled]}
              onPress={() => onConfirm(name)}
              disabled={!canConfirm}
            >
              <Text style={styles.confirmText}>Confirm upload</Text>
            </TouchableOpacity>
          </View>
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
    borderRadius: 18,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    padding: 18,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    flex: 1,
  },
  closeBtn: {
    padding: 4,
    marginLeft: 8,
  },
  closeText: {
    fontSize: 24,
    color: PIZZA_FIRE.textMuted,
    fontWeight: '300',
  },
  subtitle: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  previewWrap: {
    position: 'relative',
    marginBottom: 12,
  },
  preview: {
    width: '100%',
    height: 140,
    borderRadius: 12,
    backgroundColor: PIZZA_FIRE.inputBg,
  },
  aiBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(201, 120, 43, 0.92)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  aiBadgeText: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  aiFixButton: {
    alignSelf: 'flex-start',
    backgroundColor: PIZZA_FIRE.inputBg,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.accent,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 12,
    minWidth: 118,
    alignItems: 'center',
  },
  aiFixButtonDisabled: {
    opacity: 0.6,
  },
  aiFixText: {
    color: PIZZA_FIRE.gold,
    fontSize: 13,
    fontWeight: '800',
  },
  label: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  input: {
    backgroundColor: PIZZA_FIRE.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    color: PIZZA_FIRE.textPrimary,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  cancelButton: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cancelText: {
    color: PIZZA_FIRE.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  confirmButton: {
    backgroundColor: PIZZA_FIRE.accent,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  confirmButtonDisabled: {
    opacity: 0.45,
  },
  confirmText: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
});
