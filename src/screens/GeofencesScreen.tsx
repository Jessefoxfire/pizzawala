import React, { useEffect, useRef, useState } from 'react';
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
    ActivityIndicator,
  PermissionsAndroid,
  Platform,
  ToastAndroid,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Geolocation from 'react-native-geolocation-service';
import Slider from '@react-native-community/slider';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from '@react-native-firebase/firestore';

import { auth } from '../services/firebase';
import { RootStackParamList } from '../navigation/AppNavigator';
import { Icons } from '../components/Icons';
import { cacheGeofences, loadCachedGeofences } from '../geofencing/storage';
import { normalizeLatLng } from '../utils/geo';
import { startNativeMonitoring, getNativeStatus, openBatteryExemptionUi } from '../geofencing/native';
import { useIsFocused } from '@react-navigation/native';

type Props = NativeStackScreenProps<RootStackParamList, 'Geofences'>;
type TimeoutHandle = ReturnType<typeof setTimeout>;

export default function GeofencesScreen({ navigation }: Props) {
  const [geofences, setGeofences] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [ignoringBattery, setIgnoringBattery] = useState(true);
  const isFocused = useIsFocused();

  const [name, setName] = useState('');
  const [radius, setRadius] = useState(50);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const saveWatchdogRef = useRef<TimeoutHandle | null>(null);
  const savingRef = useRef(false);
  const saveCompletedRef = useRef(false);
  const cachedSeedRef = useRef(false);
  const cachedGeofencesRef = useRef<any[]>([]);
  const pendingSaveRef = useRef<{
    name: string;
    location: { lat: number; lng: number };
    radius: number;
    editingId: string | null;
  } | null>(null);
  
  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }
    const profileRef = doc(getFirestore(), 'users', user.uid);
    const unsub = onSnapshot(profileRef, snap => {
      if (!mounted.current) return;
      if (!snap || !snap.exists()) {
        setIsAdmin(false);
        return;
      }
      const data = snap.data();
      if (!data) {
        setIsAdmin(false);
        return;
      }
      setUserProfile(data);
      const roles = data.roles;
      setIsAdmin(Array.isArray(roles) && roles.includes('admin'));
    });
    return () => unsub();
  }, [user]);

  const mounted = useRef(true);
  const user = auth.currentUser;

  /* ───────────────────────── lifecycle ───────────────────────── */

  useEffect(() => {
    mounted.current = true;
    const seedFromCache = async () => {
      const cached = await loadCachedGeofences();
      if (!mounted.current) return;
      if (cached.length > 0) {
        cachedSeedRef.current = true;
        cachedGeofencesRef.current = cached;
        setGeofences(cached);
        setLoading(false);
      }
    };
    void seedFromCache();

    const q = query(collection(getFirestore(), 'geofences'));
    const unsub = onSnapshot(
      q,
      snap => {
        if (!mounted.current) return;
        if (!snap || !snap.docs || snap.empty) {
          setLoading(false);
          return;
        }
        const items = snap.docs
          .map(d => {
            const data = d.data() as any;
            const center = normalizeLatLng(data.center ?? data.location ?? data.coords);
            if (!center) return null;
            return { id: d.id, ...data, center };
          })
          .filter(Boolean) as any[];
        cachedGeofencesRef.current = items;
        setGeofences(items);
        setSelectedIds(prev => {
          if (prev.size === 0) return prev;
          const validIds = new Set(items.map(item => item.id));
          const next = new Set(Array.from(prev).filter(id => validIds.has(id)));
          return next.size === prev.size ? prev : next;
        });
        setLoading(false);
      },
      error => {
        console.warn('Failed to load geofences:', error);
        if (mounted.current) {
          setLoading(false);
          Alert.alert('Notice', `Unable to load worksites: ${error?.message || error}`);
        }
      }
    );
    return () => {
      mounted.current = false;
      if (saveWatchdogRef.current) {
        clearTimeout(saveWatchdogRef.current);
        saveWatchdogRef.current = null;
      }
      unsub();
    };
  }, []);

  useEffect(() => {
    if (isFocused && Platform.OS === 'android') {
      const checkBattery = async () => {
        const status = await getNativeStatus();
        if (status) {
          setIgnoringBattery(status.ignoringBatteryOptimizations);
        }
      };
      void checkBattery();
    }
  }, [isFocused]);

  // Registration is handled globally by GeofenceMonitor to avoid duplicates
  useEffect(() => {
    void cacheGeofences(geofences as any);
  }, [geofences]);


  const finalizeSaveSuccess = (savedName: string) => {
    if (saveCompletedRef.current) return;
    saveCompletedRef.current = true;

    setSaving(false);
    setMessage(null);
    setModalVisible(false);
    setEditingId(null);
    setName('');
    setRadius(50);
    setLocation(null);
    pendingSaveRef.current = null;

    const successMessage = `Worksite ${savedName} Saved!`;
    if (Platform.OS === 'android') {
      ToastAndroid.show(successMessage, ToastAndroid.SHORT);
    } else {
      Alert.alert('Success', successMessage);
    }
  };

  useEffect(() => {
    if (!savingRef.current || !pendingSaveRef.current) return;
    const pending = pendingSaveRef.current;

    const matches = pending.editingId
      ? geofences.find(item => item.id === pending.editingId)
      : geofences.find(
          item =>
            String(item?.name || '').trim().toLowerCase() ===
              pending.name.toLowerCase()
        );

    if (!matches) return;

    const sameCenter =
      !!matches.center &&
      Math.abs(matches.center.lat - pending.location.lat) < 0.0005 &&
      Math.abs(matches.center.lng - pending.location.lng) < 0.0005;
    const sameRadius = matches.radiusMeters === pending.radius;

    if (sameCenter || sameRadius) {
      finalizeSaveSuccess(pending.name);
    }
  }, [geofences]);

  useEffect(() => {
    if (message !== 'Save is taking longer than expected...') return;
    const timeoutId = setTimeout(() => {
      if (mounted.current) {
        setMessage(null);
      }
    }, 5000);

    return () => clearTimeout(timeoutId);
  }, [message]);

  useEffect(() => {
    if (!modalVisible && !saving) {
      setMessage(null);
    }
  }, [modalVisible, saving]);

  /* ───────────────────────── permissions ───────────────────────── */

  const ensureLocationPermission = async () => {
    console.log('Checking location permission...');
    
    if (Platform.OS === 'ios') {
      try {
        const authStatus = await Geolocation.requestAuthorization('whenInUse');
        console.log('iOS auth status:', authStatus);
        
        if (authStatus === 'granted') {
          return true;
        }
        
        Alert.alert(
          'Location Permission Required',
          'Please enable location access in Settings > PizzaWala > Location',
          [{ text: 'OK' }]
        );
        return false;
      } catch (err) {
        console.error('iOS permission error:', err);
        return false;
      }
    }

    if (Platform.OS !== 'android') return true;

    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: 'Location Access',
        message: 'Location is required to set a worksite center.',
        buttonPositive: 'Allow',
        buttonNegative: 'Cancel',
      }
    );

    const granted = result === PermissionsAndroid.RESULTS.GRANTED;
    console.log('Android permission granted:', granted);
    return granted;
  };

  /* ───────────────────────── location ───────────────────────── */

  const getCurrentLocation = async () => {
    if (locating) return;

    const granted = await ensureLocationPermission();
    if (!granted) {
      Alert.alert('Permission denied', 'Location access is required.');
      return;
    }

    setLocating(true);
    console.log('Starting location acquisition...');

    try {
      const requestPosition = (options: any) =>
        new Promise<any>((resolve, reject) => {
          Geolocation.getCurrentPosition(resolve, reject, options);
        });

      let pos: any;

      try {
        pos = await requestPosition({
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
          showLocationDialog: true,
          forceRequestLocation: true,
        });
      } catch (err: any) {
        if (err?.code !== 2 && err?.code !== 3) {
          throw err;
        }

        console.warn('High-accuracy location failed, retrying low-accuracy', err);
        pos = await requestPosition({
          enableHighAccuracy: false,
          timeout: 15000,
          maximumAge: 60000,
          showLocationDialog: true,
          forceRequestLocation: true,
        });
      }

      console.log('✅ Location success:', {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      });

      if (!mounted.current) {
        console.log('Component unmounted, ignoring location');
        return;
      }

      const newLocation = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      };

      setLocation(newLocation);
      console.log('Location state updated:', newLocation);
    } catch (err: any) {
      console.error('❌ Location error:', {
        code: err?.code,
        message: err?.message,
        PERMISSION_DENIED: err?.code === 1,
        POSITION_UNAVAILABLE: err?.code === 2,
        TIMEOUT: err?.code === 3,
      });

      if (!mounted.current) return;

      let errorMsg = 'Unable to get location.';
      if (err?.code === 1) {
        errorMsg = 'Location permission denied. Check Settings > PizzaWala > Location.';
      } else if (err?.code === 2) {
        errorMsg = 'Location unavailable. Make sure Location Services are enabled in Settings.';
      } else if (err?.code === 3) {
        errorMsg = 'Location request timed out. Please try again.';
      } else if (err?.message) {
        errorMsg = `Location service failed: ${err.message}`;
      }

      Alert.alert('Location Error', errorMsg);
    } finally {
      if (mounted.current) setLocating(false);
    }
  };

  /* ───────────────────────── save ───────────────────────── */

  const saveGeofence = async () => {
    if (saving) return;
    console.log('saveGeofence: invoked', { name, location, radius, editingId });
    // reset previous error state
    setSaveError(null);
    setMessage('Saving worksite...');
    const trimmedName = name.trim();
    if (!trimmedName || !location) {
      Alert.alert('Notice', 'Name and location are required.');
      setMessage(null);
      return;
    }
    if (!editingId) {
      const normalized = trimmedName.toLowerCase();
      const hasDuplicate = geofences.some(
        g => String(g?.name || '').trim().toLowerCase() === normalized
      );
      if (hasDuplicate) {
        Alert.alert('Duplicate', 'A worksite with this name already exists.');
        setMessage(null);
        return;
      }
    }

    setSaving(true);
    savingRef.current = true;
    saveCompletedRef.current = false;
    pendingSaveRef.current = {
      name: trimmedName,
      location,
      radius,
      editingId,
    };

    // Remove setModalVisible(false) from here to keep it open until success
    if (saveWatchdogRef.current) {
      clearTimeout(saveWatchdogRef.current);
    }
    saveWatchdogRef.current = setTimeout(() => {
      if (!mounted.current || !savingRef.current) return;



      setMessage('Save is taking longer than expected...');
    }, 8000);
    try {
      const payload: any = {
        name: trimmedName,
        radiusMeters: radius,
        center: location,
        active: true,
        teamId: userProfile?.teamId || 'team-1',
      };

      if (editingId) {

        console.log('saveGeofence: updating docId=', editingId);
        await updateDoc(doc(getFirestore(), 'geofences', editingId), payload);
        setGeofences(prev => {
          const next = prev.map(item =>
            item.id === editingId ? { ...item, ...payload } : item
          );
          cachedGeofencesRef.current = next;
          return next;
        });

      } else {

        if (user && user.uid) payload.createdBy = user.uid;
        payload.createdAt = serverTimestamp();

        await addDoc(collection(getFirestore(), 'geofences'), payload);
        // List updates from onSnapshot only — optimistic prepend duplicated the new doc in UI.
      }


      if (!mounted.current) return;
      
      finalizeSaveSuccess(trimmedName);
    } catch (err: any) {
      console.error('saveGeofence error:', err);


      if (!mounted.current) return;

      if (saveCompletedRef.current) {
        return;
      }












      
      setSaving(false);
      const msg = err?.message || String(err);
      setSaveError(`Save failed: ${msg}`);
      Alert.alert('Notice', `Save failed: ${msg}`);



    } finally {
      savingRef.current = false;
      if (saveWatchdogRef.current) {
        clearTimeout(saveWatchdogRef.current);
        saveWatchdogRef.current = null;
      }
      if (mounted.current) {
        setMessage(null);
      }
    }
  };

  const resetModal = () => {
    setName('');
    setRadius(50);
    setLocation(null);
    setEditingId(null);
    setModalVisible(false);
    setMessage(null);
    setSaveError(null);
  };

  const openEditModal = (worksite: any) => {
    setName(worksite.name);
    setRadius(worksite.radiusMeters);
    setLocation(worksite.center);
    setEditingId(worksite.id);
    setModalVisible(true);
  };

  const deleteWorksite = (id: string, name: string) => {
    Alert.alert('Delete Worksite', `Are you sure you want to delete "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        onPress: async () => {
          try {
            setMessage('Deleting worksite...');



            const docRef = doc(getFirestore(), 'geofences', id);
            await deleteDoc(docRef);
            setGeofences(prev => {
              const next = prev.filter(item => item.id !== id);
              cachedGeofencesRef.current = next;
              return next;
            });
            setMessage(null);
            Alert.alert('Success', 'Worksite deleted');
          } catch (err: any) {



            console.error('Delete worksite error:', err);
            const msg = err?.message || String(err);
            setMessage(null);
            Alert.alert('Notice', `Failed to delete worksite: ${msg}`);
          }
        },
        style: 'destructive',
      },
    ]);
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    Alert.alert(
      'Delete Worksites',
      `Are you sure you want to delete ${ids.length} worksite(s)?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          onPress: async () => {
            try {
              setMessage(`Deleting ${ids.length} worksite(s)...`);
              const fs = getFirestore();
              const batch = writeBatch(fs);
              const idSet = new Set(ids);
              ids.forEach(id => batch.delete(doc(fs, 'geofences', id)));
              await batch.commit();
              setSelectedIds(new Set());
              setGeofences(prev => {
                const next = prev.filter(item => !idSet.has(item.id));
                cachedGeofencesRef.current = next;
                return next;
              });
              setMessage(null);
              Alert.alert('Success', `${ids.length} worksite(s) deleted`);
            } catch (err: any) {
              const msg = err?.message ? String(err.message) : String(err);
              setMessage(null);
              Alert.alert('Notice', `Failed to delete worksites: ${msg}`);
            }
          },
          style: 'destructive',
        },
      ]
    );
  };

  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(getFirestore(), 'geofences', id), { active: !currentStatus });
    } catch (err: any) {
      Alert.alert('Notice', 'Failed to toggle worksite status.');
    }
  };

  /* ───────────────────────── list item ───────────────────────── */

  const renderItem = ({ item }: { item: any }) => {
    const isSelected = selectedIds.has(item.id);
    return (
      <View style={[styles.item, isSelected && styles.itemSelected]}>
        <View style={{flex: 1}}>
          <Text style={styles.itemName}>{item.name}</Text>
          <Text style={styles.itemSub}>Radius: {item.radiusMeters}m</Text>
          <View style={{ flexDirection: 'row', marginTop: 8, gap: 8, alignItems: 'center' }}>
            <TouchableOpacity
              style={styles.checkbox}
              onPress={() => toggleSelect(item.id)}
            >
              <Text style={styles.checkboxText}>{isSelected ? '✓' : ''}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => openEditModal(item)}
            >
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.viewBtn}
              onPress={() => navigation.navigate('WorksiteFinder', { geofence: item })}
            >
              <Text style={styles.viewBtnText}>View location</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => deleteWorksite(item.id, item.name)}
            >
              <Text style={styles.deleteBtnText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
        <Switch
          value={item.active}



          onValueChange={() => handleToggleActive(item.id, item.active)}
        />
      </View>
    );
  };

  /* ───────────────────────── UI ───────────────────────── */

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icons.home width={28} height={28} color="#2E6B5A" />
        </TouchableOpacity>
        <Text style={styles.title}>Manage Worksites</Text>
        <View style={{ width: 60 }} />
      </View>

      {isAdmin === false ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Access Denied. Admin role required.</Text>
        </View>
      ) : loading ? (
        <ActivityIndicator size="large" style={{ marginTop: 40 }} />
      ) : (
        <>
          {!ignoringBattery && Platform.OS === 'android' && (
            <TouchableOpacity 
              style={styles.batteryBanner} 
              onPress={() => void openBatteryExemptionUi()}
            >
              <Text style={styles.batteryTitle}>⚠️ Battery Optimization is ON</Text>
              <Text style={styles.batteryText}>
                Background alerts may be delayed. Tap here to set "No restrictions".
              </Text>
            </TouchableOpacity>
          )}
          <FlatList
            data={geofences}
            renderItem={renderItem}
            keyExtractor={i => i.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <Text style={styles.empty}>
                No worksites found. Add one to get started!
              </Text>
            }
          />
        </>
      )}

      <View style={styles.footer}>
        {selectedIds.size > 0 && (
          <TouchableOpacity style={styles.deleteSelectedBtn} onPress={deleteSelected}>
            <Text style={styles.deleteSelectedText}>
              Delete {selectedIds.size} Worksite{selectedIds.size !== 1 ? 's' : ''}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.addBtn} onPress={() => setModalVisible(true)}>
          <Text style={styles.addText}>+ Add New Worksite</Text>
        </TouchableOpacity>
      </View>

      {/* ───────────── modal ───────────── */}

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalBg}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingId ? 'Edit Worksite' : 'New Worksite'}
              </Text>
              <TouchableOpacity onPress={resetModal} style={styles.closeBtn}>
                <Text style={styles.closeText}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Worksite Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Downtown Pizzeria"
            />

            <Text style={styles.label}>Radius (meters): {radius}</Text>
            <Slider
              minimumValue={10}
              maximumValue={500}
              step={5}
              value={radius}
              onValueChange={setRadius}
            />

            <View style={styles.locBtns}>
              <TouchableOpacity style={styles.locBtn} onPress={getCurrentLocation}>
                {locating ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnText}>Use Current Location</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.locBtn, { backgroundColor: '#3D352E' }]}
                onPress={() => {
                  // Close modal before navigating to the full-screen map picker
                  setModalVisible(false);
                  navigation.navigate('MapPicker', {
                    onLocationSelected: (lat, lng) => {
                      setLocation({ lat, lng });
                      // reopen modal when a location is picked
                      setModalVisible(true);
                    },
                  });
                }}
              >
                <Text style={styles.btnText}>Pick on Map</Text>
              </TouchableOpacity>
            </View>

            {location && <Text style={styles.ok}>✓ Location set</Text>}

            <View style={styles.actions}>
              <TouchableOpacity onPress={resetModal}>
                <Text>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={saveGeofence}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnText}>
                    {editingId ? 'Update Worksite' : 'Save Worksite'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {saveError && (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorText}>{saveError}</Text>
          <View style={{ flexDirection: 'row', marginTop: 8 }}>
            <TouchableOpacity
              style={[styles.retryBtn, { marginRight: 8 }]}
              onPress={() => {
                setSaveError(null);
                saveGeofence();
              }}
            >
              <Text style={{ color: '#fff' }}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: '#777' }]}
              onPress={() => setSaveError(null)}
            >
              <Text style={{ color: '#fff' }}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {message && (
        <View style={styles.messageBanner} pointerEvents="none">
          <Text style={styles.messageText}>{message}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

/* ───────────────────────── styles ───────────────────────── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#2A211B' },
  batteryBanner: {
    backgroundColor: '#9E3C2E',
    padding: 12,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F6EDE2',
  },
  batteryTitle: {
    color: '#FFF8F0',
    fontWeight: 'bold',
    fontSize: 14,
    marginBottom: 2,
  },
  batteryText: {
    color: '#F6EDE2',
    fontSize: 12,
    lineHeight: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#1E1813',
    borderBottomWidth: 1,
    borderBottomColor: '#3A2D24',
  },
  backBtn: { padding: 4 },
  back: { fontSize: 18, fontWeight: 'bold', color: '#EBDCCB' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#F6EDE2' },
  list: { padding: 16 },
  empty: { textAlign: 'center', marginTop: 40, color: '#A88E73' },
  item: {
    backgroundColor: '#1E1813',
    padding: 16,
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
  itemSelected: {
    backgroundColor: '#5C2420',
    borderWidth: 2,
    borderColor: '#9E3C2E',
  },
  checkbox: {
    width: 28,
    height: 28,
    borderWidth: 2,
    borderColor: '#C9782B',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxText: { fontSize: 16, color: '#C9782B', fontWeight: 'bold' },
  itemName: { fontSize: 18, fontWeight: 'bold', color: '#F6EDE2' },
  itemSub: { fontSize: 14, color: '#A88E73' },
  editBtn: {
    backgroundColor: '#D9A441',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  editBtnText: { color: '#FFF', fontSize: 12, fontWeight: 'bold' },
  viewBtn: {
    backgroundColor: '#CFA15A',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  viewBtnText: { color: '#FFF', fontSize: 12, fontWeight: 'bold' },
  deleteBtn: {
    backgroundColor: '#9E3C2E',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  deleteBtnText: { color: '#FFF', fontSize: 12, fontWeight: 'bold' },
  footer: { padding: 16, backgroundColor: '#1E1813', borderTopWidth: 1, borderTopColor: '#3A2D24' },
  addBtn: {
    backgroundColor: '#C9782B',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  addText: { color: '#FFF', fontWeight: 'bold' },
  deleteSelectedBtn: {
    backgroundColor: '#9E3C2E',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  deleteSelectedText: { color: '#FFF', fontWeight: 'bold' },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
  },
  modal: {
    margin: 20,
    backgroundColor: '#1E1813',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: { fontSize: 22, fontWeight: 'bold', flex: 1, color: '#F6EDE2' },
  closeBtn: {
    padding: 4,
    marginLeft: 8,
  },
  closeText: {
    fontSize: 28,
    color: '#A88E73',
    fontWeight: '300',
  },
  label: { marginTop: 12, fontWeight: '600', color: '#C8B29A' },
  input: { backgroundColor: '#3A2D24', padding: 12, borderRadius: 8, color: '#EBDCCB', borderWidth: 1, borderColor: '#5A4739' },
  locBtns: { flexDirection: 'row', gap: 10, marginTop: 12 },
  locBtn: {
    flex: 1,
    backgroundColor: '#C9782B',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnText: { color: '#FFF', fontWeight: 'bold' },
  ok: {
    textAlign: 'center',
    marginTop: 10,
    color: '#CFA15A',
    fontWeight: 'bold',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 24,
  },
  saveBtn: {
    backgroundColor: '#C9782B',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  messageBanner: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.75)',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
    zIndex: 999,
  },
  messageText: { color: '#fff', fontWeight: '600' },
  errorOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
    zIndex: 1000,
  },
  errorText: { color: '#3D352E', fontWeight: '600' },
  retryBtn: {
    backgroundColor: '#3D352E',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
});
