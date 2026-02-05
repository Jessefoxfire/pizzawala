
import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, SafeAreaView } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

export default function MapPickerScreen({ route, navigation }: any) {
    const { onLocationSelected } = route.params;
    const [selectedLocation, setSelectedLocation] = useState<{lat: number, lng: number} | null>(null);

    const handleConfirm = () => {
        if (selectedLocation) {
            onLocationSelected(selectedLocation.lat, selectedLocation.lng);
            navigation.goBack();
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()}>
                    <Text style={styles.backBtn}>Cancel</Text>
                </TouchableOpacity>
                <Text style={styles.title}>Pick Location</Text>
                <TouchableOpacity onPress={handleConfirm} disabled={!selectedLocation}>
                    <Text style={[styles.backBtn, !selectedLocation && {color: '#ccc'}]}>Confirm</Text>
                </TouchableOpacity>
            </View>
            <MapView
                style={styles.map}
                provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                initialRegion={{
                    latitude: 34.0522,
                    longitude: -118.2437,
                    latitudeDelta: 0.0922,
                    longitudeDelta: 0.0421,
                }}
                onPress={(e) => {
                    const { latitude, longitude } = e.nativeEvent.coordinate;
                    setSelectedLocation({ lat: latitude, lng: longitude });
                }}
            >
                {selectedLocation && (
                    <Marker coordinate={{ latitude: selectedLocation.lat, longitude: selectedLocation.lng }} />
                )}
            </MapView>
            <View style={styles.instructions}>
                <Text style={styles.instructionText}>Tap the map to place a pin</Text>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#FFF' },
    header: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
    backBtn: { fontSize: 16, fontWeight: 'bold', color: '#e77f39' },
    title: { fontSize: 18, fontWeight: 'bold' },
    map: { flex: 1 },
    instructions: { position: 'absolute', bottom: 40, width: '100%', alignItems: 'center' },
    instructionText: { backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff', padding: 10, borderRadius: 20 }
});
