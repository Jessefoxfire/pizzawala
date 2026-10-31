import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';

type Props = {
  added?: boolean;
  edited?: boolean;
};

export default function HoursChangeBadge({ added, edited }: Props) {
  if (!added && !edited) return null;
  return (
    <View style={styles.wrap}>
      {added ? (
        <View style={styles.badge}>
          <Text style={styles.text}>Added</Text>
        </View>
      ) : null}
      {edited ? (
        <View style={styles.badge}>
          <Text style={styles.text}>Edited</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badge: {
    backgroundColor: 'rgba(255, 159, 28, 0.18)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(255, 159, 28, 0.28)',
  },
  text: {
    fontSize: 10,
    fontWeight: '800',
    color: PIZZA_FIRE.gold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
