import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { PIZZA_FIRE, PIZZA_FIRE_RADIUS } from '../theme/pizzaFireTheme';

/** Translucent red used for Delete text + border. */
export const PIZZA_FIRE_BUTTON_DANGER = 'rgba(255, 69, 58, 0.65)';
/** Translucent green used for Save text + border. */
export const PIZZA_FIRE_BUTTON_SUCCESS = 'rgba(125, 219, 106, 0.65)';

export type PizzaFireButtonVariant = 'accent' | 'muted' | 'danger' | 'success' | 'primary' | 'default';

type Props = {
  label?: string;
  children?: React.ReactNode;
  onPress?: () => void;
  /** accent = Save; muted = Cancel; danger = Delete. primary/default map to accent. */
  variant?: PizzaFireButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  /** Label size; padding (height) scales from this. Width hugs the letters. */
  fontSize?: number;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

function tone(variant: PizzaFireButtonVariant) {
  if (variant === 'danger') return PIZZA_FIRE_BUTTON_DANGER;
  if (variant === 'muted') return PIZZA_FIRE.textMuted;
  if (variant === 'success') return PIZZA_FIRE_BUTTON_SUCCESS;
  return PIZZA_FIRE.accent;
}

/** Hygiene Log All–style wash: accentSoft is rgba(accent, 0.16). */
function fill(variant: PizzaFireButtonVariant) {
  if (variant === 'danger') return 'transparent';
  if (variant === 'muted') return 'transparent';
  if (variant === 'success') return 'rgba(125, 219, 106, 0.16)';
  return 'transparent';
}

export function pizzaFireButtonPadding(fontSize: number) {
  return {
    paddingVertical: Math.max(6, Math.round(fontSize * 0.71)),
    paddingHorizontal: Math.max(8, Math.round(fontSize * 0.86)),
  };
}

/** Outline action button. Use this for new buttons instead of one-off styles. */
export default function PizzaFireButton({
  label,
  children,
  onPress,
  variant = 'accent',
  disabled,
  loading,
  fontSize = 14,
  style,
  textStyle,
}: Props) {
  const color = tone(variant);
  const pad = pizzaFireButtonPadding(fontSize);

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
      style={[
        styles.base,
        pad,
        { borderColor: color, backgroundColor: fill(variant) },
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color} size="small" />
      ) : children ? (
        children
      ) : (
        <Text style={[styles.label, { color, fontSize }, textStyle]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    backgroundColor: 'transparent',
    borderWidth: 1.8,
    borderRadius: PIZZA_FIRE_RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    fontWeight: '800',
    textAlign: 'center',
  },
});
