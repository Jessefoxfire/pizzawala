import { StyleSheet } from 'react-native';
import { PIZZA_FIRE, PIZZA_FIRE_RADIUS } from './pizzaFireTheme';

/**
 * Outline action buttons (Save / Cancel / Delete). Prefer `PizzaFireButton`.
 * Home Quick Link tiles stay separate (qlFill) — they are not these buttons.
 */
export const pizzaFireUi = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: PIZZA_FIRE_RADIUS.lg,
    backgroundColor: 'transparent',
    borderWidth: 1.8,
    borderColor: PIZZA_FIRE.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.88,
  },
  buttonPrimary: {
    backgroundColor: 'transparent',
    borderColor: PIZZA_FIRE.accent,
  },
  buttonMuted: {
    backgroundColor: 'transparent',
    borderColor: PIZZA_FIRE.textMuted,
  },
  buttonSuccess: {
    backgroundColor: 'rgba(125, 219, 106, 0.16)',
    borderColor: 'rgba(125, 219, 106, 0.65)',
  },
  buttonDanger: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(255, 69, 58, 0.65)',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonLabel: {
    color: PIZZA_FIRE.accent,
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  buttonLabelPrimary: {
    color: PIZZA_FIRE.accent,
  },
  buttonLabelMuted: {
    color: PIZZA_FIRE.textMuted,
  },
  buttonLabelSuccess: {
    color: 'rgba(125, 219, 106, 0.65)',
  },
  buttonLabelDanger: {
    color: 'rgba(255, 69, 58, 0.65)',
  },
  card: {
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderRadius: PIZZA_FIRE_RADIUS.md,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
    padding: 16,
  },
  cardInner: {
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderRadius: PIZZA_FIRE_RADIUS.md,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: PIZZA_FIRE.divider,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: PIZZA_FIRE.textPrimary,
    textAlign: 'center',
  },
});
