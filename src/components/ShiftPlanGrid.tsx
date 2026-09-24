import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import type { ShiftPlanCell, ShiftPlanGrid } from '../utils/shiftPlanGrid';

type Props = {
  grid: ShiftPlanGrid;
  onPressEmployee?: (userId: string, userName: string) => void;
  onPressCell?: (cell: ShiftPlanCell, userId: string, userName: string) => void;
};

const NAME_W = 92;
const DAY_W = 108;

export default function ShiftPlanGrid({ grid, onPressEmployee, onPressCell }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{grid.title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={styles.row}>
            <View style={[styles.headerCell, styles.nameCell]}>
              <Text style={styles.headerText}>MITARBEITER</Text>
            </View>
            {grid.dayHeaders.map(day => (
              <View key={day.dateKey} style={[styles.headerCell, styles.dayCell]}>
                <Text style={styles.headerText}>{day.weekday}</Text>
                <Text style={styles.headerSub}>{day.dateLabel}</Text>
              </View>
            ))}
          </View>

          {grid.rows.map(row => (
            <View key={row.userId} style={styles.row}>
              <TouchableOpacity
                style={[styles.bodyCell, styles.nameCell]}
                onPress={() => onPressEmployee?.(row.userId, row.userName)}
                activeOpacity={0.8}
              >
                <Text style={styles.nameText} numberOfLines={2}>
                  {row.userName}
                </Text>
              </TouchableOpacity>
              {row.cells.map(cell => (
                <TouchableOpacity
                  key={cell.dateKey}
                  style={[styles.bodyCell, styles.dayCell, cell.empty && styles.emptyCell]}
                  onPress={() => onPressCell?.(cell, row.userId, row.userName)}
                  activeOpacity={cell.empty ? 1 : 0.8}
                  disabled={cell.empty || !onPressCell}
                >
                  <Text style={[styles.cellText, cell.empty && styles.emptyText]}>{cell.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}

          <View style={styles.row}>
            <View style={[styles.footerCell, styles.nameCell]}>
              <Text style={styles.footerText}>TAGESBESATZUNG</Text>
            </View>
            {grid.staffing.map(item => (
              <View key={item.dateKey} style={[styles.footerCell, styles.dayCell]}>
                <Text style={styles.footerText}>{item.label}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: PIZZA_FIRE.surface,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    borderRadius: 14,
    padding: 10,
  },
  title: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.4,
    marginBottom: 10,
  },
  row: { flexDirection: 'row' },
  nameCell: { width: NAME_W },
  dayCell: { width: DAY_W },
  headerCell: {
    backgroundColor: PIZZA_FIRE.inputBg,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    paddingVertical: 8,
    paddingHorizontal: 6,
    minHeight: 52,
    justifyContent: 'center',
  },
  headerText: {
    color: PIZZA_FIRE.gold,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  headerSub: { color: PIZZA_FIRE.textPrimary, fontSize: 12, fontWeight: '700', marginTop: 2 },
  bodyCell: {
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    paddingVertical: 10,
    paddingHorizontal: 6,
    minHeight: 52,
    justifyContent: 'center',
    backgroundColor: 'rgba(18, 10, 6, 0.28)',
  },
  emptyCell: { backgroundColor: 'transparent' },
  nameText: { color: PIZZA_FIRE.textPrimary, fontSize: 13, fontWeight: '800' },
  cellText: { color: PIZZA_FIRE.textPrimary, fontSize: 12, fontWeight: '700' },
  emptyText: { color: PIZZA_FIRE.textMuted, fontWeight: '600' },
  footerCell: {
    backgroundColor: PIZZA_FIRE.inputBg,
    borderWidth: 1,
    borderColor: PIZZA_FIRE.cardBorder,
    paddingVertical: 8,
    paddingHorizontal: 6,
    minHeight: 40,
    justifyContent: 'center',
  },
  footerText: { color: PIZZA_FIRE.accent, fontSize: 11, fontWeight: '800' },
});
