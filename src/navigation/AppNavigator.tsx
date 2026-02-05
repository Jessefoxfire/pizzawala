import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import HomeScreen from '../screens/HomeScreen';
import LoginScreen from '../screens/LoginScreen';
import CreateAccountScreen from '../screens/CreateAccountScreen';
import GeofencesScreen from '../screens/GeofencesScreen';
import WorksiteFinderScreen from '../screens/WorksiteFinderScreen';
import ChatScreen from '../screens/ChatScreen';
import MapPickerScreen from '../screens/MapPickerScreen';
import { Geofence } from '../types';

export type RootStackParamList = {
  Home: undefined;
  Login: undefined;
  CreateAccount: undefined;
  Geofences: undefined;
  WorksiteFinder: { geofence: Geofence };
  Chat: undefined;
  MapPicker: { onLocationSelected: (lat: number, lng: number) => void };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="CreateAccount" component={CreateAccountScreen} />
        <Stack.Screen name="Geofences" component={GeofencesScreen} />
        <Stack.Screen name="WorksiteFinder" component={WorksiteFinderScreen} />
        <Stack.Screen name="Chat" component={ChatScreen} />
        <Stack.Screen name="MapPicker" component={MapPickerScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
