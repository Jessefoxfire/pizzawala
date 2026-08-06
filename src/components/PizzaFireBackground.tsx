import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';

export default function PizzaFireBackground() {
  const { width, height } = useWindowDimensions();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="warmGradient" x1="0" y1="0" x2="0.15" y2="1">
            <Stop offset="0" stopColor={PIZZA_FIRE.bgTop} />
            <Stop offset="0.2" stopColor={PIZZA_FIRE.bgMid} />
            <Stop offset="0.55" stopColor={PIZZA_FIRE.bgMid} />
            <Stop offset="1" stopColor={PIZZA_FIRE.bgBottom} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#warmGradient)" />
      </Svg>
    </View>
  );
}
