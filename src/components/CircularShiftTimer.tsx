import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { formatShiftDuration } from '../services/shifts';
import { PIZZA_FIRE, PIZZA_FIRE_SHADOW } from '../theme/pizzaFireTheme';
import { SHOW_DEBUG_ONLY_OPERATIONS } from '../config/buildFeatures';

const DEFAULT_SIZE = 248;

function timerMetrics(size: number) {
  const scale = size / DEFAULT_SIZE;
  const stroke = Math.max(8, 11 * scale);
  const pad = 3 * scale;
  const radius = (size - stroke) / 2 - pad;
  const inner = Math.max(0, size - stroke * 2 - 36 * scale);
  return {
    scale,
    stroke,
    radius,
    center: size / 2,
    inner,
    timeSize: Math.max(22, Math.round(40 * scale)),
    labelSize: Math.max(11, Math.round(13 * scale)),
  };
}

export type ShiftTimerState = 'idle' | 'working' | 'driving' | 'pause' | 'overtime';

const PROGRESS_CAP_MS: Record<ShiftTimerState, number> = {
  idle: 1,
  working: 8 * 60 * 60 * 1000,
  driving: 8 * 60 * 60 * 1000,
  pause: 30 * 60 * 1000,
  overtime: 60 * 60 * 1000,
};

type Props = {
  elapsedMs: number;
  label?: string;
  state?: ShiftTimerState;
  progress?: number;
  /** Outer diameter in points. Defaults to the large-phone size. */
  size?: number;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function progressForState(elapsedMs: number, state: ShiftTimerState) {
  const cap = PROGRESS_CAP_MS[state];
  if (state === 'idle' || cap <= 0) return 0;
  return clamp01(elapsedMs / cap);
}

export default function CircularShiftTimer({
  elapsedMs,
  label = 'Ready',
  state = 'idle',
  progress,
  size = DEFAULT_SIZE,
}: Props) {
  const metrics = timerMetrics(size);
  const ringProgress = progress ?? progressForState(elapsedMs, state);
  const circumference = 2 * Math.PI * metrics.radius;
  const dashoffset = circumference * (1 - (state === 'idle' ? 0 : ringProgress));
  const progressStroke = state === 'idle' ? 'transparent' : `url(#progress-${state})`;
  const glowColor = useMemo(() => {
    if (state === 'pause') return PIZZA_FIRE.cheese;
    if (state === 'driving') return '#3B82F6';
    if (state === 'overtime') return PIZZA_FIRE.danger;
    if (state === 'working') return PIZZA_FIRE.flame;
    return PIZZA_FIRE.gold;
  }, [state]);

  const innerStyles = useMemo(() => {
    if (state === 'pause') {
      return {
        cheeseRing: {
          backgroundColor: '#FFF6E5',
          borderColor: '#FFFFFF',
        },
        time: { color: PIZZA_FIRE.crustDark },
        label: { color: PIZZA_FIRE.crust },
      };
    }
    if (state === 'driving') {
      return {
        cheeseRing: {
          backgroundColor: '#D9ECFF',
          borderColor: '#8EC5FF',
        },
        time: { color: '#1A3D66' },
        label: { color: '#2563A8' },
      };
    }
    return {
      cheeseRing: {
        backgroundColor: PIZZA_FIRE.cheese,
        borderColor: '#F4D9A6',
      },
      time: { color: '#2A140A' },
      label: { color: '#5C3018' },
    };
  }, [state]);

  return (
    <View style={[styles.wrap, { width: size, height: size, shadowColor: glowColor }]}>
      <Svg width={size} height={size} style={styles.ring}>
        <Defs>
          <LinearGradient id="progress-working" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={PIZZA_FIRE.ember} />
            <Stop offset="0.55" stopColor={PIZZA_FIRE.flame} />
            <Stop offset="1" stopColor={PIZZA_FIRE.gold} />
          </LinearGradient>
          <LinearGradient id="progress-pause" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#E2C9AE" />
            <Stop offset="1" stopColor="#FFF6E5" />
          </LinearGradient>
          <LinearGradient id="progress-driving" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#2563EB" />
            <Stop offset="1" stopColor="#60A5FA" />
          </LinearGradient>
          <LinearGradient id="progress-overtime" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FF1744" />
            <Stop offset="1" stopColor={PIZZA_FIRE.danger} />
          </LinearGradient>
        </Defs>
        <Circle
          cx={metrics.center}
          cy={metrics.center}
          r={metrics.radius + 6 * metrics.scale}
          stroke="rgba(255, 159, 28, 0.12)"
          strokeWidth={2}
          fill="none"
        />
        <Circle
          cx={metrics.center}
          cy={metrics.center}
          r={metrics.radius}
          stroke={PIZZA_FIRE.crust}
          strokeWidth={metrics.stroke}
          fill="none"
          opacity={0.85}
        />
        {ringProgress > 0 ? (
          <Circle
            cx={metrics.center}
            cy={metrics.center}
            r={metrics.radius}
            stroke={progressStroke}
            strokeWidth={metrics.stroke}
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={dashoffset}
            strokeLinecap="round"
            transform={`rotate(-90, ${metrics.center}, ${metrics.center})`}
          />
        ) : null}
      </Svg>
      <View
        style={[
          styles.innerDisc,
          {
            width: metrics.inner,
            height: metrics.inner,
            borderRadius: metrics.inner / 2,
          },
          state === 'working' && styles.innerDiscWorking,
          state === 'pause' && styles.innerDiscPause,
          state === 'driving' && styles.innerDiscDriving,
        ]}
      >
        <View
          style={[
            styles.cheeseRing,
            { borderRadius: Math.max(0, metrics.inner - 10) / 2 },
            innerStyles.cheeseRing,
            SHOW_DEBUG_ONLY_OPERATIONS && state === 'pause' && styles.cheeseRingPauseOutline,
          ]}
        >
          <Text
            style={[styles.time, innerStyles.time, { fontSize: metrics.timeSize }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.65}
          >
            {formatShiftDuration(elapsedMs)}
          </Text>
          <View style={[styles.statePill, state === 'working' && styles.statePillWorking, state === 'pause' && styles.statePillPause, state === 'driving' && styles.statePillDriving]}>
            <Text style={[styles.label, innerStyles.label, { fontSize: metrics.labelSize }]}>{label}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    ...PIZZA_FIRE_SHADOW.glow,
  },
  ring: {
    position: 'absolute',
  },
  innerDisc: {
    backgroundColor: PIZZA_FIRE.crustDark,
    padding: 5,
    alignItems: 'center',
    justifyContent: 'center',
    ...PIZZA_FIRE_SHADOW.card,
  },
  innerDiscWorking: {
    backgroundColor: PIZZA_FIRE.accent,
  },
  innerDiscPause: {
    backgroundColor: '#4A2A19',
  },
  innerDiscDriving: {
    backgroundColor: '#1E3A5F',
  },
  cheeseRing: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderWidth: 2,
  },
  cheeseRingPauseOutline: {
    borderColor: '#FFFFFF',
  },
  statePill: {
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(42, 20, 10, 0.08)',
  },
  statePillWorking: {
    backgroundColor: 'rgba(255, 87, 34, 0.14)',
  },
  statePillPause: {
    backgroundColor: 'rgba(255, 246, 229, 0.22)',
  },
  statePillDriving: {
    backgroundColor: 'rgba(94, 179, 255, 0.18)',
  },
  time: {
    width: '100%',
    textAlign: 'center',
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
  label: {
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
