
import React, { useRef, useState, useEffect } from 'react';
import {
    View,
    StyleSheet,
    TouchableOpacity,
    Text,
    TextInput,
    Platform,
    FlatList,
    ActivityIndicator,
    Keyboard,
    Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import Geolocation from 'react-native-geolocation-service';
import { ensureLocationPermission } from '../utils/geo';

export default function MapPickerScreen({ route, navigation }: any) {
    const onLocationSelected = route?.params?.onLocationSelected;
    const [selectedLocation, setSelectedLocation] = useState<{lat: number, lng: number} | null>(null);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [searching, setSearching] = useState(false);
    const mapRef = useRef<MapView | null>(null);
    const insets = useSafeAreaInsets();

    const handleConfirm = () => {
        if (selectedLocation) {
            if (typeof onLocationSelected === 'function') {
                onLocationSelected(selectedLocation.lat, selectedLocation.lng);
            } else {
                Alert.alert('Notice', 'Unable to return selected location. Please try again.');
            }
            navigation.goBack();
        }
    };

    const performSearch = async () => {
        if (!query || query.trim() === '') return;
        setSearching(true);
        Keyboard.dismiss();
        try {
            // Use Nominatim OpenStreetMap geocoding (no API key)
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
                query
            )}&limit=6`;
            const res = await fetch(url, { headers: { 'User-Agent': 'PizzaWala/1.0' } });
            const json = await res.json();
            const mapped = (json || []).map((r: any) => ({
                lat: parseFloat(r.lat),
                lng: parseFloat(r.lon),
                display: r.display_name,
            }));
            setResults(mapped);
        } catch (e) {
            setResults([]);
        } finally {
            setSearching(false);
        }
    };

    const selectResult = (item: any) => {
        setSelectedLocation({ lat: item.lat, lng: item.lng });
        setResults([]);
        // move map
        if (mapRef.current) {
            mapRef.current.animateToRegion(
                {
                    latitude: item.lat,
                    longitude: item.lng,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                },
                300
            );
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
            {/* Search bar */}
            <View style={[styles.searchBarContainer, { top: 72 + insets.top }]}>
                <TextInput
                    placeholder="Search address or place"
                    value={query}
                    onChangeText={setQuery}
                    onSubmitEditing={performSearch}
                    style={styles.searchInput}
                    returnKeyType="search"
                />
                <TouchableOpacity onPress={performSearch} style={styles.searchBtn}>
                    {searching ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={styles.searchBtnText}>Search</Text>
                    )}
                </TouchableOpacity>
            </View>

            <MapView
                ref={mapRef}
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
                    // Immediately return the picked coordinates to the caller and close picker
                    if (typeof onLocationSelected === 'function') {
                        onLocationSelected(latitude, longitude);
                    }
                    navigation.goBack();
                }}
            >
                {selectedLocation && (
                    <Marker coordinate={{ latitude: selectedLocation.lat, longitude: selectedLocation.lng }} />
                )}
            </MapView>

            {/* Search results dropdown */}
            {results.length > 0 && (
                <View style={[styles.resultsContainer, { top: 120 + insets.top }]}>
                    <FlatList
                        data={results}
                        keyExtractor={(i, idx) => `${i.lat}-${i.lng}-${idx}`}
                        renderItem={({ item }) => (
                            <TouchableOpacity onPress={() => selectResult(item)} style={styles.resultRow}>
                                <Text numberOfLines={1} style={styles.resultText}>{item.display}</Text>
                            </TouchableOpacity>
                        )}
                    />
                </View>
            )}

            <View style={styles.instructions}>
                <Text style={styles.instructionText}>Tap the map to place a pin</Text>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#2A211B' },
    header: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#3A2D24', backgroundColor: '#1E1813' },
    backBtn: { fontSize: 16, fontWeight: 'bold', color: '#D9A441' },
    title: { fontSize: 18, fontWeight: 'bold', color: '#F6EDE2' },
    map: { flex: 1 },
    instructions: { position: 'absolute', bottom: 40, width: '100%', alignItems: 'center' },
    instructionText: { backgroundColor: 'rgba(31, 41, 55, 0.95)', color: '#F6EDE2', padding: 10, borderRadius: 20, borderWidth: 1, borderColor: '#C9782B' }
    ,
    searchBarContainer: {
        position: 'absolute',
        top: 72,
        left: 16,
        right: 16,
        zIndex: 30,
        flexDirection: 'row',
        alignItems: 'center',
    },
    searchInput: {
        flex: 1,
        backgroundColor: '#FFF',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        marginRight: 8,
    },
    searchBtn: {
        backgroundColor: '#C9782B',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
    },
    searchBtnText: { color: '#FFF', fontWeight: 'bold' },
    resultsContainer: {
        position: 'absolute',
        top: 120,
        left: 16,
        right: 16,
        maxHeight: 240,
        backgroundColor: '#FFF',
        borderRadius: 8,
        zIndex: 40,
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    resultRow: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#EBDCCB' },
    resultText: { fontSize: 14 },
});
