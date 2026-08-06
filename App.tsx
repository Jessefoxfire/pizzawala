import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { OfflineProvider } from './src/context/OfflineContext';
import { initFirestoreOffline } from './src/offline/initFirestore';

initFirestoreOffline();

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      <OfflineProvider>
        <AppNavigator />
      </OfflineProvider>
    </SafeAreaProvider>
  );
}