import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SALUTATION_OPTIONS, type Salutation } from '../constants/germanEmployeeCompliance';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';

type Props = {
  value?: Salutation | '';
  onChange: (next: Salutation) => void;
};

export default function SalutationDropdown({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const label = value || 'Select';

  return (
    <View>
      <TouchableOpacity
        style={styles.trigger}
        onPress={() => setOpen(current => !current)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={[styles.triggerText, !value && styles.placeholder]}>{label}</Text>
        <Text style={styles.chevron}>{open ? '⌃' : '⌄'}</Text>
      </TouchableOpacity>
      {open ? (
        <View style={styles.menu}>
          {SALUTATION_OPTIONS.map(option => {
            const selected = value === option;
            return (
              <TouchableOpacity
                key={option}
                style={[styles.option, selected && styles.optionSelected]}
                onPress={() => {
                  onChange(option);
                  setOpen(false);
                }}
              >
                <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    backgroundColor: PIZZA_FIRE.inputBg,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 54,
  },
  triggerText: { color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '600' },
  placeholder: { color: PIZZA_FIRE.textMuted },
  chevron: { color: PIZZA_FIRE.gold, fontSize: 16, fontWeight: '700' },
  menu: {
    marginTop: 6,
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    overflow: 'hidden',
  },
  option: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: PIZZA_FIRE.divider,
  },
  optionSelected: { backgroundColor: PIZZA_FIRE.accentSoft },
  optionText: { color: PIZZA_FIRE.textPrimary, fontSize: 16, fontWeight: '600' },
  optionTextSelected: { color: PIZZA_FIRE.accent, fontWeight: '800' },
});
