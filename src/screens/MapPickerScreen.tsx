
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
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import Geolocation from 'react-native-geolocation-service';
import { ensureLocationPermission } from '../utils/geo';
import { PIZZA_FIRE } from '../theme/pizzaFireTheme';
import PizzaFireScreen from '../components/PizzaFireScreen';

const REGION_DELTA = {
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
};

type LatLng = { lat: number; lng: number };

function isValidLocation(value: unknown): value is LatLng {
    if (!value || typeof value !== 'object') return false;
    const { lat, lng } = value as LatLng;
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export default function MapPickerScreen({ route, navigation }: any) {
    const onLocationSelected = route?.params?.onLocationSelected;
    const routeLocation = route?.params?.initialLocation as LatLng | undefined;
    const initialLocation = isValidLocation(routeLocation) ? routeLocation : undefined;
    const [selectedLocation, setSelectedLocation] = useState<LatLng | null>(initialLocation ?? null);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [searching, setSearching] = useState(false);
    const [locating, setLocating] = useState(!initialLocation);
    const [mapReady, setMapReady] = useState(false);
    const [mapLoadTimedOut, setMapLoadTimedOut] = useState(false);
    const mapRef = useRef<MapView | null>(null);
    const pendingRegionRef = useRef<{ latitude: number; longitude: number } | null>(
        initialLocation
            ? { latitude: initialLocation.lat, longitude: initialLocation.lng }
            : null
    );

    const moveMapTo = (lat: number, lng: number) => {
        const region = {
            latitude: lat,
            longitude: lng,
            ...REGION_DELTA,
        };
        pendingRegionRef.current = { latitude: lat, longitude: lng };
        mapRef.current?.animateToRegion(region, 400);
    };

    useEffect(() => {
        let cancelled = false;

        const focusMap = async () => {
            if (initialLocation) {
                setLocating(false);
                return;
            }

            const allowed = await ensureLocationPermission();
            if (cancelled) return;
            if (!allowed) {
                setLocating(false);
                return;
            }

            Geolocation.getCurrentPosition(
                pos => {
                    if (cancelled) return;
                    const lat = pos.coords.latitude;
                    const lng = pos.coords.longitude;
                    setSelectedLocation({ lat, lng });
                    moveMapTo(lat, lng);
                    setLocating(false);
                },
                () => {
                    if (!cancelled) setLocating(false);
                },
                {
                    enableHighAccuracy: true,
                    timeout: 12000,
                    maximumAge: 15000,
                }
            );
        };

        void focusMap();
        return () => {
            cancelled = true;
        };
    }, [initialLocation]);

    useEffect(() => {
        if (mapReady) return undefined;
        const timeout = setTimeout(() => setMapLoadTimedOut(true), 12000);
        return () => clearTimeout(timeout);
    }, [mapReady]);

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
            const mapped = (json || [])
                .map((r: any) => ({ lat: parseFloat(r.lat), lng: parseFloat(r.lon), display: r.display_name }))
                .filter(isValidLocation);
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
        moveMapTo(item.lat, item.lng);
    };

    return (
        <PizzaFireScreen edges={['top', 'left', 'right']}>
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
            <View style={[styles.searchBarContainer, { top: 72 }]}>
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
                userInterfaceStyle="light"
                showsUserLocation
                showsMyLocationButton
                initialRegion={
                    initialLocation
                        ? {
                              latitude: initialLocation.lat,
                              longitude: initialLocation.lng,
                              ...REGION_DELTA,
                          }
                        : {
                              latitude: 52.52,
                              longitude: 13.405,
                              latitudeDelta: 0.08,
                              longitudeDelta: 0.08,
                          }
                }
                onMapReady={() => {
                    setMapReady(true);
                    setMapLoadTimedOut(false);
                    const pending = pendingRegionRef.current;
                    if (pending) {
                        mapRef.current?.animateToRegion(
                            { ...pending, ...REGION_DELTA },
                            250
                        );
                    }
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

            {locating ? (
                <View style={styles.locatingBanner} pointerEvents="none">
                    <ActivityIndicator color={PIZZA_FIRE.gold} />
                    <Text style={styles.locatingText}>Finding your location…</Text>
                </View>
            ) : null}

            {mapLoadTimedOut ? (
                <View style={styles.mapErrorBanner}>
                    <Text style={styles.mapErrorText}>Map could not load. Check your internet connection and Google Maps setup.</Text>
                </View>
            ) : null}

            {/* Search results dropdown */}
            {results.length > 0 && (
                <View style={[styles.resultsContainer, { top: 120 }]}>
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
        </PizzaFireScreen>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: PIZZA_FIRE.bgTop },
    header: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: PIZZA_FIRE.divider, backgroundColor: 'transparent' },
    backBtn: { fontSize: 16, fontWeight: 'bold', color: PIZZA_FIRE.gold },
    title: { fontSize: 18, fontWeight: 'bold', color: PIZZA_FIRE.textPrimary },
    map: { flex: 1 },
    instructions: { position: 'absolute', bottom: 40, width: '100%', alignItems: 'center' },
    instructionText: { backgroundColor: PIZZA_FIRE.bgMid, color: PIZZA_FIRE.textPrimary, padding: 10, borderRadius: 20, borderWidth: 1, borderColor: PIZZA_FIRE.accent }
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
        backgroundColor: PIZZA_FIRE.accent,
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
    locatingBanner: {
        position: 'absolute',
        top: 128,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: PIZZA_FIRE.bgMid,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: PIZZA_FIRE.accent,
        zIndex: 20,
    },
    locatingText: { color: PIZZA_FIRE.textPrimary, fontWeight: '600' },
    mapErrorBanner: {
        position: 'absolute',
        top: 128,
        left: 20,
        right: 20,
        backgroundColor: PIZZA_FIRE.bgMid,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: PIZZA_FIRE.hotAccentBorder,
        padding: 12,
        zIndex: 20,
    },
    mapErrorText: { color: PIZZA_FIRE.textPrimary, textAlign: 'center', fontWeight: '600' },
});
