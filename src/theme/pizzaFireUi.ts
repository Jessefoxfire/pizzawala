import { StyleSheet } from 'react-native';
import { PIZZA_FIRE, PIZZA_FIRE_RADIUS } from './pizzaFireTheme';

/** Shared Quick Links–inspired controls. Home tiles remain the visual source of truth. */
export const pizzaFireUi = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: PIZZA_FIRE_RADIUS.lg,
    backgroundColor: PIZZA_FIRE.qlFill,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.88,
  },
  buttonPrimary: {
    backgroundColor: 'rgba(212, 72, 32, 0.32)',
    borderColor: PIZZA_FIRE.hotAccentBorder,
  },
  buttonMuted: {
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderColor: PIZZA_FIRE.qlBorder,
  },
  buttonSuccess: {
    backgroundColor: 'rgba(125, 219, 106, 0.16)',
    borderColor: 'rgba(125, 219, 106, 0.42)',
  },
  buttonDanger: {
    backgroundColor: 'rgba(255, 69, 58, 0.34)',
    borderColor: 'rgba(255, 160, 150, 0.75)',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonLabel: {
    color: PIZZA_FIRE.textSecondary,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  buttonLabelPrimary: {
    color: PIZZA_FIRE.textPrimary,
  },
  buttonLabelMuted: {
    color: PIZZA_FIRE.textSecondary,
  },
  buttonLabelSuccess: {
    color: PIZZA_FIRE.success,
  },
  buttonLabelDanger: {
    color: '#FFE4E0',
  },
  card: {
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.qlBorder,
    padding: 16,
  },
  cardInner: {
    backgroundColor: PIZZA_FIRE.surfaceInset,
    borderRadius: 14,
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
