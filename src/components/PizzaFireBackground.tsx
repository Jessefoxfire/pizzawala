import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';

type Props = {
  /** Ignored — every screen uses the same stretched flame. Kept so call sites stay valid. */
  variant?: 'home' | 'screen';
};

/**
 * Original Home flame with the brightest bottom sixth removed, remaining five-sixths
 * stretched to fill: dark top → mid oven → muted ember (no hot band behind buttons).
 */
export default function PizzaFireBackground(_props: Props) {
  const { width, height } = useWindowDimensions();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="warmGradient" x1="0" y1="0" x2="0.12" y2="1">
            <Stop offset="0" stopColor={PIZZA_FIRE.bgTop} />
            <Stop offset="0.24" stopColor={PIZZA_FIRE.bgMid} />
            <Stop offset="0.66" stopColor={PIZZA_FIRE.bgMid} />
            <Stop offset="1" stopColor={PIZZA_FIRE.bgBottom} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#warmGradient)" />
      </Svg>
    </View>
  );
}
