/** Shared pizza-oven / flame palette for the home experience. */
export const PIZZA_FIRE = {
  bgTop: '#160804',
  bgMid: '#5C1E0C',
  bgBottom: '#D45318',
  ember: '#FF5722',
  flame: '#FF9F1C',
  gold: '#FFD166',
  cheese: '#FFF6E5',
  crust: '#6B3A22',
  crustDark: '#2A140A',
  charcoal: '#120A06',
  card: 'rgba(18, 10, 6, 0.55)',
  cardBorder: 'rgba(255, 159, 28, 0.28)',
  textPrimary: '#FFF8EE',
  textSecondary: 'rgba(255, 248, 238, 0.82)',
  textMuted: 'rgba(255, 248, 238, 0.58)',
  danger: '#FF453A',
  pause: '#5EB3FF',
  success: '#7DDB6A',
} as const;

export const PIZZA_FIRE_SHADOW = {
  glow: {
    shadowColor: '#FF6B2C',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 8,
  },
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 6,
  },
} as const;
