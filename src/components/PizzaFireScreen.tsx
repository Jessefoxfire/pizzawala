import React from 'react';
import { Keyboard, StyleSheet, TouchableWithoutFeedback, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edges } from 'react-native-safe-area-context';
import PizzaFireBackground from './PizzaFireBackground';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';

type Props = {
  children: React.ReactNode;
  style?: ViewStyle;
  /** Top is always applied so headers never sit under the status bar. */
  edges?: Edges;
};

function withStatusBarEdge(edges: Edges): Edges {
  const next = [...edges];
  if (!next.includes('top')) next.unshift('top');
  return next as Edges;
}

/** Full-screen flame + safe area. StatusBar is owned once in App.tsx. */
export default function PizzaFireScreen({
  children,
  style,
  edges = ['top', 'left', 'right', 'bottom'],
}: Props) {
  return (
    <View style={[styles.root, style]}>
      <PizzaFireBackground />
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <SafeAreaView style={styles.safe} edges={withStatusBarEdge(edges)}>
          {children}
        </SafeAreaView>
      </TouchableWithoutFeedback>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: PIZZA_FIRE.bgTop,
  },
  safe: {
    flex: 1,
  },
});
