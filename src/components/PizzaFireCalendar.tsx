import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Calendar, type CalendarProps, type DateData } from 'react-native-calendars';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';

export const HIDDEN_CALENDAR_HEADER_THEME = {
  'stylesheet.calendar.header': {
    header: {
      height: 0,
      marginTop: 0,
      paddingTop: 0,
      paddingBottom: 0,
      overflow: 'hidden' as const,
    },
    arrow: {
      height: 0,
      padding: 0,
    },
  },
};

export function toMonthStartKey(value?: string | Date): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-01`;
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}/.test(value)) {
    return `${value.slice(0, 7)}-01`;
  }
  return toMonthStartKey(new Date());
}

export function shiftMonthStartKey(monthKey: string, delta: number): string {
  const [year, month] = toMonthStartKey(monthKey).split('-').map(Number);
  return toMonthStartKey(new Date(year, month - 1 + delta, 1));
}

export function formatMonthTitle(monthKey: string): string {
  const [year, month] = toMonthStartKey(monthKey).split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

function toDateData(monthKey: string): DateData {
  const [year, month] = toMonthStartKey(monthKey).split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  return {
    year,
    month,
    day: 1,
    timestamp: date.getTime(),
    dateString: toMonthStartKey(monthKey),
  };
}

type HeaderProps = {
  monthKey: string;
  onChange: (nextMonthKey: string) => void;
  minDate?: string;
  maxDate?: string;
  onTitlePress?: () => void;
};

export function CalendarMonthHeader({
  monthKey,
  onChange,
  minDate,
  maxDate,
  onTitlePress,
}: HeaderProps) {
  const minMonth = minDate ? toMonthStartKey(minDate) : undefined;
  const maxMonth = maxDate ? toMonthStartKey(maxDate) : undefined;
  const prevMonth = shiftMonthStartKey(monthKey, -1);
  const nextMonth = shiftMonthStartKey(monthKey, 1);
  const prevDisabled = Boolean(minMonth && prevMonth < minMonth);
  const nextDisabled = Boolean(maxMonth && nextMonth > maxMonth);

  return (
    <View style={styles.monthNav}>
      <TouchableOpacity
        onPress={() => !prevDisabled && onChange(prevMonth)}
        disabled={prevDisabled}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityRole="button"
        accessibilityLabel="Previous month"
        style={styles.arrowHit}
      >
        <Text style={[styles.arrow, prevDisabled && styles.arrowDisabled]}>‹</Text>
      </TouchableOpacity>
      <View style={styles.titleSlot}>
        {onTitlePress ? (
          <TouchableOpacity
            onPress={onTitlePress}
            style={styles.titleWrap}
            accessibilityRole="button"
            accessibilityLabel="Open month picker"
          >
            <Text style={styles.title} numberOfLines={1}>
              {formatMonthTitle(monthKey)}
            </Text>
            <Text style={styles.titleHint}>Tap to pick month</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.title} numberOfLines={1}>
            {formatMonthTitle(monthKey)}
          </Text>
        )}
      </View>
      <TouchableOpacity
        onPress={() => !nextDisabled && onChange(nextMonth)}
        disabled={nextDisabled}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityRole="button"
        accessibilityLabel="Next month"
        style={styles.arrowHit}
      >
        <Text style={[styles.arrow, nextDisabled && styles.arrowDisabled]}>›</Text>
      </TouchableOpacity>
    </View>
  );
}

type Props = Omit<CalendarProps, 'hideArrows' | 'enableSwipeMonths' | 'customHeader' | 'renderHeader'> & {
  onMonthTitlePress?: () => void;
};

export default function PizzaFireCalendar({
  current,
  initialDate,
  minDate,
  maxDate,
  theme,
  onDayPress,
  onMonthChange,
  onMonthTitlePress,
  ...rest
}: Props) {
  const [visibleMonth, setVisibleMonth] = useState(() =>
    toMonthStartKey(typeof current === 'string' ? current : initialDate)
  );

  useEffect(() => {
    if (typeof current !== 'string') return;
    const next = toMonthStartKey(current);
    setVisibleMonth(prev => (prev === next ? prev : next));
  }, [current]);

  const applyMonth = (next: string) => {
    const nextKey = toMonthStartKey(next);
    if (nextKey === visibleMonth) return;
    setVisibleMonth(nextKey);
    onMonthChange?.(toDateData(nextKey));
  };

  return (
    <View>
      <CalendarMonthHeader
        monthKey={visibleMonth}
        onChange={applyMonth}
        minDate={minDate}
        maxDate={maxDate}
        onTitlePress={onMonthTitlePress}
      />
      <Calendar
        {...rest}
        key={visibleMonth}
        current={visibleMonth}
        minDate={minDate}
        maxDate={maxDate}
        theme={{
          ...(theme || {}),
          ...HIDDEN_CALENDAR_HEADER_THEME,
        }}
        hideArrows
        renderHeader={() => null}
        enableSwipeMonths={false}
        disableMonthChange
        onDayPress={date => {
          if (date?.dateString) {
            applyMonth(date.dateString);
          }
          onDayPress?.(date);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 2,
  },
  arrowHit: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: {
    color: PIZZA_FIRE.gold,
    fontSize: 32,
    fontWeight: '300',
    lineHeight: 36,
    textAlign: 'center',
  },
  arrowDisabled: {
    color: PIZZA_FIRE.textMuted,
    opacity: 0.35,
  },
  titleSlot: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  titleWrap: {
    alignItems: 'center',
  },
  title: {
    color: PIZZA_FIRE.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  titleHint: {
    color: PIZZA_FIRE.accent,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
});
