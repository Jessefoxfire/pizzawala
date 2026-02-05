
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Switch,
  Alert,
  Modal,
  TextInput,
  SafeAreaView,
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import { db, auth } from '../services/firebase';
import {
  collection,
  query,
  onSnapshot,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp
} from 'firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import Geolocation from 'react-native-geolocation-service';
import Slider from '@react-native-community/slider';

type GeofencesScreenProps = NativeStackScreenProps<RootStackParamList, 'Geofences'>;

export default function GeofencesScreen({ navigation }: GeofencesScreenProps) {
  const [geofences, setGeofences] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);

  const [newName, setNewName] = useState('');
  const [newRadius, setNewRadius] = useState(50);
  const [newLocation, setNewLocation] = useState<{lat: number, lng: number} | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  
  const user = auth.currentUser;

  useEffect(() => {
    const q = query(collection(db, 'geofences'));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const fences = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setGeofences(fences);
      setIsLoading(false);
    });
    return unsubscribe;
  }, []);

  const requestLocationPermission = async () => {
    if (Platform.OS === 'ios') return true;
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (err) {
      return false;
    }
  };

  const handleGetCurrentLocation = async () => {
    const hasPermission = await requestLocationPermission();
    if (!hasPermission) {
      Alert.alert('Permission Denied', 'Please enable location permissions.');
      return;
    }

    setIsGettingLocation(true);
    Geolocation.getCurrentPosition(
      (position) => {
        setNewLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
        setIsGettingLocation(false);
      },
      (error) => {
        Alert.alert('Error', 'Could not get location.');
        setIsGettingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  };

  const handleSaveGeofence = async () => {
    if (!newName || !newLocation) {
        Alert.alert('Error', 'Please set name and location.');
        return;
    }
    setIsSaving(true);
    try {
        await addDoc(collection(db, 'geofences'), {
            name: newName,
            radiusMeters: newRadius,
            center: newLocation,
            active: true,
            teamId: 'team-1',
            createdBy: user?.uid,
            createdAt: serverTimestamp(),
        });
        resetModal();
    } catch (error) {
        Alert.alert('Error', 'Could not save worksite.');
    } finally {
        setIsSaving(false);
    }
  };

  const resetModal = () => {
      setNewName('');
      setNewRadius(50);
      setNewLocation(null);
      setModalVisible(false);
  }

  const renderItem = ({ item }: { item: any }) => (
    <View style={styles.itemContainer}>
      <View style={styles.itemTextContainer}>
        <Text style={styles.itemName}>{item.name}</Text>
        <Text style={styles.itemDetails}>Radius: {item.radiusMeters}m</Text>
      </View>
      <Switch
        trackColor={{ false: '#D4CFCF', true: '#e77f39' }}
        thumbColor={item.active ? '#FEF6E4' : '#f4f3f4'}
        onValueChange={async () => {
            const ref = doc(db, 'geofences', item.id);
            await updateDoc(ref, { active: !item.active });
        }}
        value={item.active}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
        <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()}>
                <Text style={styles.backButton}>‹ Home</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Worksites</Text>
            <View style={{ width: 60 }} />
        </View>

        {isLoading ? (
            <ActivityIndicator size="large" color="#FEF6E4" style={{ marginTop: 40 }} />
        ) : (
            <FlatList
                data={geofences}
                renderItem={renderItem}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.list}
            />
        )}

        <View style={styles.footer}>
            <TouchableOpacity style={styles.addButton} onPress={() => setModalVisible(true)}>
                <Text style={styles.addButtonText}>+ Add New Worksite</Text>
            </TouchableOpacity>
        </View>

        <Modal visible={modalVisible} animationType="slide" transparent={true}>
            <View style={styles.modalBackdrop}>
                <View style={styles.modalView}>
                    <Text style={styles.modalTitle}>New Worksite</Text>
                    
                    <Text style={styles.label}>Worksite Name</Text>
                    <TextInput style={styles.input} value={newName} onChangeText={setNewName} />

                    <Text style={styles.label}>Radius: {newRadius}m</Text>
                    <Slider
                        style={{ width: '100%', height: 40 }}
                        minimumValue={10}
                        maximumValue={500}
                        step={5}
                        value={newRadius}
                        onValueChange={setNewRadius}
                        minimumTrackTintColor="#e77f39"
                        maximumTrackTintColor="#D4CFCF"
                    />

                    <Text style={styles.label}>Location</Text>
                    <View style={styles.locationActions}>
                        <TouchableOpacity style={styles.locationBtn} onPress={handleGetCurrentLocation}>
                            {isGettingLocation ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Use GPS</Text>}
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.locationBtn, {backgroundColor: '#3D352E'}]} onPress={() => navigation.navigate('MapPicker', {
                            onLocationSelected: (lat, lng) => {
                                setNewLocation({lat, lng});
                                setModalVisible(true);
                            }
                        })}>
                            <Text style={styles.btnText}>Pick on Map</Text>
                        </TouchableOpacity>
                    </View>
                    {newLocation && <Text style={styles.locationText}>✓ Location Set</Text>}
                    
                    <View style={styles.modalActions}>
                        <TouchableOpacity style={styles.cancelBtn} onPress={resetModal}><Text>Cancel</Text></TouchableOpacity>
                        <TouchableOpacity style={styles.saveBtn} onPress={handleSaveGeofence} disabled={isSaving}>
                            <Text style={styles.btnText}>Save</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#e77f39' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#FEF6E4' },
  backButton: { fontSize: 18, color: '#3D352E', fontWeight: 'bold' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#3D352E' },
  list: { padding: 16 },
  itemContainer: { backgroundColor: '#FEF6E4', padding: 16, borderRadius: 16, flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  itemName: { fontSize: 18, fontWeight: 'bold', color: '#3D352E' },
  itemDetails: { fontSize: 14, color: '#57493E' },
  footer: { padding: 16, backgroundColor: '#FEF6E4' },
  addButton: { backgroundColor: '#3D352E', padding: 16, borderRadius: 12, alignItems: 'center' },
  addButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold' },
  modalBackdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)' },
  modalView: { width: '90%', backgroundColor: '#FEF6E4', borderRadius: 24, padding: 24 },
  modalTitle: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
  label: { fontWeight: '600', marginBottom: 8, marginTop: 12 },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#D4CFCF' },
  locationActions: { flexDirection: 'row', gap: 10 },
  locationBtn: { flex: 1, backgroundColor: '#e77f39', padding: 12, borderRadius: 8, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: 'bold' },
  locationText: { textAlign: 'center', marginTop: 10, color: 'green', fontWeight: 'bold' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 24, gap: 12 },
  cancelBtn: { padding: 12 },
  saveBtn: { backgroundColor: '#3D352E', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 }
});
