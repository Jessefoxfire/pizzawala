import React, { useEffect } from "react";
import { SafeAreaView, Text, StyleSheet } from "react-native";
import { initLocation } from "./src/location";

export default function App() {
  useEffect(() => {
    initLocation();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.text}>PizzaWala is running</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontSize: 18,
    fontWeight: "600",
  },
});
