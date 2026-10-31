import { useWindowDimensions, type ViewStyle } from 'react-native';
import { PIZZA_FIRE_SPACE } from './pizzaFireTheme';

/** Material shortest-width: phones vs tablets, portrait or landscape. */
export const SHORTEST_PHONE = 600;
export const SHORTEST_EXPANDED = 840;
/** Vertical room where Pro-sized Home chrome overflows (SE / landscape phones). */
export const SHORT_WINDOW = 700;

export const HOME_TIMER_MIN = 160;
export const HOME_TIMER_PHONE = 248;
export const HOME_TIMER_TABLET_MAX = 400;

export type LayoutTier = 'compact' | 'regular' | 'expanded';

export type AppLayout = {
  width: number;
  height: number;
  shortest: number;
  longest: number;
  isLandscape: boolean;
  /** True when vertical space is SE-class or a landscape phone. */
  isShort: boolean;
  /** shortest-width ≥ 600 (iPad mini / Android large). */
  isTablet: boolean;
  tier: LayoutTier;
  space: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    screenX: number;
  };
  type: {
    title: number;
    body: number;
    caption: number;
  };
  navBar: number;
  navCenter: number;
  /** Readable column for login / profile / entry forms. */
  formMaxWidth: number;
  /** Centered sheets and dialogs on tablets. */
  sheetMaxWidth: number;
  /** Admin / quick-link tile columns. */
  tileColumns: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function layoutFromDims(width: number, height: number): AppLayout {
  const shortest = Math.min(width, height);
  const longest = Math.max(width, height);
  const isLandscape = width > height;
  const isTablet = shortest >= SHORTEST_PHONE;
  const isShort = height < SHORT_WINDOW;
  const tier: LayoutTier = shortest >= SHORTEST_EXPANDED ? 'expanded' : isTablet ? 'regular' : 'compact';
  const bump = isTablet ? 1.15 : isShort ? 0.92 : 1;

  return {
    width,
    height,
    shortest,
    longest,
    isLandscape,
    isShort,
    isTablet,
    tier,
    space: {
      xs: PIZZA_FIRE_SPACE.xs,
      sm: PIZZA_FIRE_SPACE.sm,
      md: Math.round(PIZZA_FIRE_SPACE.md * bump),
      lg: Math.round(PIZZA_FIRE_SPACE.lg * bump),
      xl: Math.round(PIZZA_FIRE_SPACE.xl * bump),
      screenX: isTablet ? 32 : isShort ? 16 : PIZZA_FIRE_SPACE.screen,
    },
    type: {
      title: isTablet ? 30 : isShort ? 22 : 26,
      body: isTablet ? 16 : 15,
      caption: isTablet ? 13 : 13,
    },
    navBar: isTablet ? 80 : isShort && isLandscape ? 60 : isShort ? 64 : 72,
    navCenter: isTablet ? 64 : isShort ? 52 : 58,
    formMaxWidth: isTablet ? (tier === 'expanded' ? 720 : 560) : 400,
    sheetMaxWidth: 720,
    tileColumns: isTablet ? 4 : 3,
  };
}

export function useAppLayout(): AppLayout {
  const { width, height } = useWindowDimensions();
  return layoutFromDims(width, height);
}

export function homeNavOccupiedHeight(layout: AppLayout, bottomInset: number) {
  const rest = Math.max(bottomInset, layout.isTablet ? 12 : 8);
  return layout.navBar + rest;
}

export function homeTimerSize(
  layout: AppLayout,
  topInset: number,
  bottomInset: number,
  isAdmin: boolean
) {
  const nav = homeNavOccupiedHeight(layout, bottomInset);
  const landscapePhone = layout.isLandscape && !layout.isTablet;
  const header = landscapePhone ? 56 : layout.isShort ? 88 : layout.isTablet ? 168 : 132;
  const admin = isAdmin ? (landscapePhone ? 40 : layout.isShort ? 56 : layout.isTablet ? 88 : 72) : 0;
  const underTimer = landscapePhone ? 52 : layout.isShort ? 100 : 120;
  const topPad = topInset + (layout.isShort ? 4 : 10);
  const bottomPad = 12;
  const budgetH = layout.height - nav - topPad - header - admin - underTimer - bottomPad;
  const budgetW = layout.width - layout.space.screenX * 2;
  const maxByTier = layout.isTablet
    ? Math.min(HOME_TIMER_TABLET_MAX, Math.round(layout.shortest * 0.42))
    : layout.isShort
      ? landscapePhone
        ? 180
        : 200
      : HOME_TIMER_PHONE;
  const minByTier = landscapePhone ? 132 : layout.isShort ? HOME_TIMER_MIN : 200;
  return Math.round(clamp(Math.min(budgetH, budgetW, maxByTier), minByTier, maxByTier));
}

export type HomeChrome = {
  paddingTop: number;
  headerGap: number;
  avatar: number;
  titleSize: number;
  titleGap: number;
  timerPadTop: number;
  hintGap: number;
  statusGap: number;
  adminGap: number;
  adminPad: number;
};

export function homeChrome(layout: AppLayout, topInset: number): HomeChrome {
  const landscapePhone = layout.isLandscape && !layout.isTablet;
  return {
    paddingTop: topInset + (layout.isShort ? 4 : 10),
    headerGap: landscapePhone ? 4 : layout.isShort ? 8 : layout.isTablet ? 28 : 20,
    avatar: landscapePhone ? 44 : layout.isShort ? 56 : layout.isTablet ? 96 : 80,
    titleSize: landscapePhone ? 20 : layout.type.title,
    titleGap: landscapePhone ? 4 : layout.isShort ? 6 : 12,
    timerPadTop: landscapePhone || layout.isShort ? 4 : 18,
    hintGap: layout.isShort ? 8 : 16,
    statusGap: layout.isShort ? 8 : 18,
    adminGap: layout.isShort ? 8 : layout.isTablet ? 28 : 20,
    adminPad: layout.isShort ? 6 : 12,
  };
}

export function formColumnFrame(layout: AppLayout): ViewStyle {
  return {
    width: '100%',
    maxWidth: layout.formMaxWidth,
    alignSelf: 'center',
  };
}

export function formColumnStyle(layout: AppLayout): ViewStyle {
  return {
    ...formColumnFrame(layout),
    paddingHorizontal: layout.space.screenX,
  };
}

export function sheetCardStyle(layout: AppLayout): ViewStyle {
  return {
    width: '100%',
    maxWidth: layout.sheetMaxWidth,
    alignSelf: 'center',
  };
}

export function tilePixelWidth(layout: AppLayout, gap = 12): number {
  const cols = layout.tileColumns;
  const gutter = layout.space.screenX * 2;
  return Math.floor((layout.width - gutter - gap * (cols - 1)) / cols);
}

export function calendarMonthMetrics(layout: AppLayout) {
  const chrome = layout.isShort ? 200 : 232;
  const height = Math.max(layout.isShort ? 280 : 320, layout.height - chrome);
  return {
    height,
    dayHeight: Math.floor(height / 6),
    dayWidth: layout.width / 7 - 4,
  };
}
