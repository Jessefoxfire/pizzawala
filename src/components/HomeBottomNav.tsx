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

const BAR_HEIGHT = 72;
const CENTER_BUTTON_SIZE = 58;

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
  const safeBottom = Math.max(insets.bottom, 8);

  return (
    <View style={[styles.root, { paddingBottom: safeBottom }]} pointerEvents="box-none">
      <View style={[styles.navBlock, { height: BAR_HEIGHT }]}>
        <View style={styles.barSurface} />

        <View style={styles.barContent}>
          <Pressable
            style={({ pressed }) => [styles.sideAction, pressed && styles.sideActionPressed]}
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
            <View style={styles.centerButton}>
              {busy ? (
                <ActivityIndicator color={PIZZA_FIRE.cheese} size="small" />
              ) : (
                <Icons.clock color="#120A06" width={28} height={28} />
              )}
            </View>
            <Text style={styles.centerCaption}>Hours</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.sideAction,
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
    backgroundColor: PIZZA_FIRE.charcoal,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 159, 28, 0.18)',
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
    height: BAR_HEIGHT,
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
    width: CENTER_BUTTON_SIZE,
    height: CENTER_BUTTON_SIZE,
    borderRadius: CENTER_BUTTON_SIZE / 2,
    backgroundColor: PIZZA_FIRE.ember,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 6,
    borderColor: '#120A06',
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
