import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icons } from './Icons';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import { useAppLayout } from '../theme/responsiveLayout';

type Props = {
  hasOpenShift: boolean;
  busy: boolean;
  onOpenMenu: () => void;
  onOpenWorkingHours: () => void;
  onEndShift: () => void;
};

export default function HomeBottomNav({
  hasOpenShift,
  busy,
  onOpenMenu,
  onOpenWorkingHours,
  onEndShift,
}: Props) {
  const insets = useSafeAreaInsets();
  const layout = useAppLayout();
  const safeBottom = Math.max(insets.bottom, layout.isTablet ? 12 : 8);
  const center = layout.navCenter;

  return (
    <View style={[styles.root, { paddingBottom: safeBottom }]} pointerEvents="box-none">
      <View style={[styles.navBlock, { height: layout.navBar }]}>
        <View style={styles.barSurface} />

        <View style={[styles.barContent, { paddingHorizontal: layout.isTablet ? 48 : 28 }]}>
          <Pressable
            style={({ pressed }) => [
              styles.sideAction,
              { height: layout.navBar },
              pressed && styles.sideActionPressed,
            ]}
            onPress={onOpenMenu}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Open quick links menu"
          >
            <Icons.home color={PIZZA_FIRE.gold} width={22} height={22} />
            <Text style={styles.sideLabel}>Menu</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.centerAction, pressed && styles.sideActionPressed]}
            onPress={onOpenWorkingHours}
            disabled={busy}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Open working hours"
          >
            <View
              style={[
                styles.centerButton,
                {
                  width: center,
                  height: center,
                  borderRadius: center / 2,
                },
              ]}
            >
              {busy ? (
                <ActivityIndicator color={PIZZA_FIRE.cheese} size="small" />
              ) : (
                <Icons.clock color="#120A06" width={layout.isTablet ? 32 : 28} height={layout.isTablet ? 32 : 28} />
              )}
            </View>
            <Text style={styles.centerCaption}>Hours</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.sideAction,
              { height: layout.navBar },
              !hasOpenShift && styles.sideActionDisabled,
              pressed && hasOpenShift && !busy && styles.sideActionPressed,
            ]}
            onPress={onEndShift}
            disabled={!hasOpenShift || busy}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="End shift"
          >
            <View style={[styles.endDot, !hasOpenShift && styles.endDotDisabled]} />
            <Text style={[styles.endLabel, !hasOpenShift && styles.endLabelDisabled]}>End</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: 'transparent',
  },
  navBlock: {
    width: '100%',
  },
  barSurface: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: PIZZA_FIRE.bgMid,
    borderTopWidth: 1,
    borderTopColor: PIZZA_FIRE.qlBorder,
  },
  barContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingTop: 2,
  },
  sideAction: {
    minWidth: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  centerAction: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: -18,
  },
  sideActionPressed: {
    opacity: 0.85,
  },
  sideActionDisabled: {
    opacity: 0.45,
  },
  sideLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: PIZZA_FIRE.gold,
    letterSpacing: 0.3,
  },
  centerButton: {
    backgroundColor: PIZZA_FIRE.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 6,
    borderColor: PIZZA_FIRE.bgMid,
  },
  centerCaption: {
    fontSize: 10,
    fontWeight: '800',
    color: PIZZA_FIRE.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  endDot: {
    width: 12,
    height: 12,
    borderRadius: 3,
    backgroundColor: PIZZA_FIRE.danger,
  },
  endDotDisabled: {
    backgroundColor: PIZZA_FIRE.textMuted,
  },
  endLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: PIZZA_FIRE.danger,
    letterSpacing: 0.3,
  },
  endLabelDisabled: {
    color: PIZZA_FIRE.textMuted,
  },
});
