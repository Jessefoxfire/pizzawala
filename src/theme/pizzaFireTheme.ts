/** Shared pizza-oven / flame palette — Home / Admin / Events are the visual source of truth. */
export const PIZZA_FIRE = {
  bgTop: '#160804',
  bgMid: '#5C1E0C',
  /**
   * Lower flame after dropping the brightest bottom sixth of the original Home
   * gradient and stretching the remaining five-sixths to fill the screen.
   */
  bgBottom: '#A83F14',
  bgBottomSoft: '#A83F14',
  /** Bright ember — keep for small flame accents (timer glow), not large fills. */
  ember: '#FF5722',
  flame: '#FF9F1C',
  gold: '#FFD166',
  cheese: '#FFF6E5',
  crust: '#6B3A22',
  crustDark: '#2A140A',
  /** Dark ink on gold/accent fills only — not for panels. */
  charcoal: '#120A06',
  /**
   * Events Official Opening inner card. Use this for panels, calendars, sheets.
   */
  surface: 'rgba(18, 10, 6, 0.35)',
  surfaceRaised: 'rgba(18, 10, 6, 0.55)',
  surfaceInset: 'rgba(18, 10, 6, 0.35)',
  card: 'rgba(18, 10, 6, 0.35)',
  cardSolid: 'rgba(18, 10, 6, 0.55)',
  cardBorder: 'rgba(255, 159, 28, 0.28)',
  textPrimary: '#FFF8EE',
  textSecondary: 'rgba(255, 248, 238, 0.82)',
  textMuted: 'rgba(255, 248, 238, 0.58)',
  danger: '#FF453A',
  pause: '#FFF6E5',
  driving: '#5EB3FF',
  success: '#7DDB6A',
  accent: '#E07A32',
  accentDeep: '#C45E20',
  accentSoft: 'rgba(224, 122, 50, 0.16)',
  accentSoftStrong: 'rgba(224, 122, 50, 0.28)',
  accentBorder: 'rgba(255, 209, 102, 0.38)',
  hotAccent: '#D44820',
  hotAccentBorder: 'rgba(255, 150, 80, 0.45)',
  qlFill: 'rgba(255, 159, 28, 0.14)',
  qlFillStrong: 'rgba(255, 159, 28, 0.22)',
  qlInner: 'rgba(255, 159, 28, 0.18)',
  qlBorder: 'rgba(255, 159, 28, 0.28)',
  chrome: 'rgba(18, 10, 6, 0.45)',
  inputBg: 'rgba(18, 10, 6, 0.42)',
  overlay: 'rgba(0, 0, 0, 0.62)',
  divider: 'rgba(255, 159, 28, 0.18)',
} as const;

export const PIZZA_FIRE_RADIUS = {
  sm: 10,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
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

/** react-native-calendars — matches the Events opening-times card. */
export const PIZZA_FIRE_CALENDAR_THEME = {
  backgroundColor: 'transparent',
  calendarBackground: 'transparent',
  selectedDayBackgroundColor: PIZZA_FIRE.accent,
  selectedDayTextColor: PIZZA_FIRE.charcoal,
  todayTextColor: PIZZA_FIRE.gold,
  dayTextColor: PIZZA_FIRE.textPrimary,
  monthTextColor: PIZZA_FIRE.textPrimary,
  textDisabledColor: 'rgba(255, 248, 238, 0.28)',
  textSectionTitleColor: PIZZA_FIRE.textMuted,
  arrowColor: PIZZA_FIRE.gold,
  indicatorColor: PIZZA_FIRE.accent,
} as const;
