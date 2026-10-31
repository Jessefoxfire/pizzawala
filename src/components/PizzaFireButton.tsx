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
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import { pizzaFireUi } from '../theme/pizzaFireUi';

type Variant = 'default' | 'primary' | 'muted' | 'success' | 'danger';

type Props = {
  label?: string;
  children?: React.ReactNode;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

export default function PizzaFireButton({
  label,
  children,
  onPress,
  variant = 'default',
  disabled,
  loading,
  style,
  textStyle,
}: Props) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.88}
      style={[
        pizzaFireUi.button,
        variant === 'primary' && pizzaFireUi.buttonPrimary,
        variant === 'muted' && pizzaFireUi.buttonMuted,
        variant === 'success' && pizzaFireUi.buttonSuccess,
        variant === 'danger' && pizzaFireUi.buttonDanger,
        (disabled || loading) && pizzaFireUi.buttonDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={
            variant === 'danger'
              ? PIZZA_FIRE.danger
              : variant === 'success'
                ? PIZZA_FIRE.success
                : PIZZA_FIRE.gold
          }
          size="small"
        />
      ) : children ? (
        children
      ) : (
        <Text
          style={[
            pizzaFireUi.buttonLabel,
            variant === 'primary' && pizzaFireUi.buttonLabelPrimary,
            variant === 'muted' && pizzaFireUi.buttonLabelMuted,
            variant === 'success' && pizzaFireUi.buttonLabelSuccess,
            variant === 'danger' && pizzaFireUi.buttonLabelDanger,
            textStyle,
          ]}
        >
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

export const pizzaFireButtonFlex = StyleSheet.create({
  grow: { flex: 1 },
});
