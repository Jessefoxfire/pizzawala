import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
  ImageBackground,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, doc, getFirestore, onSnapshot, query } from '@react-native-firebase/firestore';
import { signOutUser, nativeAuth } from '../services/firebase';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import type { Geofence } from '../types';
import { Avatars, type AvatarKey } from '../../assets/avatars';
import { normalizeLatLng } from '../utils/geo';
import { setLastUserName } from '../geofencing/storage';
import { resolveAvatarSource } from '../utils/avatar';
import { useAuth } from '../auth/useAuth';

export default function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Home'>>();
  const authState = useAuth();
  const [userName, setUserName] = useState<string>('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [customAvatarUrl, setCustomAvatarUrl] = useState<string | null>(null);
  const [profileIsAdmin, setProfileIsAdmin] = useState(false);
  const [worksites, setWorksites] = useState<Geofence[]>([]);
  const [worksitePickerVisible, setWorksitePickerVisible] = useState(false);
  const [selectedWorksite, setSelectedWorksite] = useState<Geofence | null>(null);
  const isAdmin = authState.status === 'admin' || profileIsAdmin;
  const welcomeText = userName ? `Welcome ${userName}` : 'Welcome';
  const sortedWorksites = useMemo(
    () => [...worksites].sort((a, b) => a.name.localeCompare(b.name)),
    [worksites]
  );

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = nativeAuth().onAuthStateChanged(user => {
      setUserName(user?.displayName || '');

      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      if (!user) {
        setProfileIsAdmin(false);
        return;
      }

      const fs = getFirestore();
      const profileRef = doc(fs, 'users', user.uid);
      unsubProfile = onSnapshot(
        profileRef,
        snap => {
          if (!snap || !snap.exists()) {
            setProfileIsAdmin(false);
            return;
          }
          const data = snap.data();
          const roles = data?.roles;
          const name = data?.name;
          const avatar = data?.avatarUrl;
          const customAvatar = data?.customAvatarUrl;
          setProfileIsAdmin(Array.isArray(roles) && roles.includes('admin'));
          if (typeof name === 'string' && name.trim()) {
            setUserName(name);
            void setLastUserName(name);
          } else if (user.email) {
            setUserName(prev => (prev ? prev : user.email!.split('@')[0]));
          }
          setAvatarUrl(avatar || null);
          setCustomAvatarUrl(customAvatar || null);
        },
        err => console.warn('HomeScreen user profile listener:', err)
      );
    });

    return () => {
      if (unsubProfile) {
        unsubProfile();
      }
      unsubAuth();
    };
  }, []);

  useEffect(() => {
    const fs = getFirestore();
    const q = query(collection(fs, 'geofences'));
    const unsub = onSnapshot(q, snap => {
      if (!snap || !snap.docs || snap.empty) {
        setWorksites([]);
        return;
      }
      const items = snap.docs
        .map(d => {
          const data = d.data() as any;
          const center = normalizeLatLng(data.center ?? data.location ?? data.coords);
          if (!center) return null;
          return { id: d.id, ...data, center } as Geofence;
        })
        .filter(Boolean) as Geofence[];
      setWorksites(items);
    });

    return () => unsub();
  }, []);

  const handleNavigatorPress = () => {
    if (sortedWorksites.length === 0) {
      Alert.alert('No worksites', 'There are no worksites available yet.');
      return;
    }
    setWorksitePickerVisible(true);
  };

  const handleSelectWorksite = (worksite: Geofence) => {
    setSelectedWorksite(worksite);
    setWorksitePickerVisible(false);
    navigation.navigate('WorksiteFinder', { geofence: worksite });
  };

  const renderTile = (label: string, iconSource: any, onPress: () => void, fullWidth = false) => (
    <TouchableOpacity 
      style={[styles.tile, fullWidth && styles.fullWidthTile]} 
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Image source={iconSource} style={styles.tileIcon} resizeMode="contain" />
      <Text style={styles.tileLabel}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <ImageBackground
      source={require('../../assets/Flames background.png')}
      style={styles.background}
      resizeMode="cover"
    >
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.profileSection}>
            {(avatarUrl || customAvatarUrl) ? (
              <Image
                source={resolveAvatarSource(avatarUrl, customAvatarUrl)}
                style={styles.avatar}
                resizeMode="cover"
              />
            ) : (
              <Image
                source={require('../../assets/Pizza Wala Logo.png')}
                style={styles.logo}
                resizeMode="contain"
              />
            )}
            <Text style={styles.welcomeTitle}>{welcomeText}</Text>
            {selectedWorksite && (
              <Text style={styles.selectedSubtitle}>Selected: {selectedWorksite.name}</Text>
            )}
          </View>

          <View style={styles.gridContainer}>
            {isAdmin && renderTile('Admin Panel', require('../../assets/Icons/Admin.png'), () => navigation.navigate('AdminOptions'))}
            {renderTile('Shift', require('../../assets/Icons/Shift.png'), () => navigation.navigate('ShiftSetup'))}
            {renderTile('My Schedule', require('../../assets/Icons/Schedule.png'), () => navigation.navigate('MySchedule'))}
            {renderTile('Events', require('../../assets/Icons/Events.png'), () => navigation.navigate('Events'))}
            {renderTile('Team Chat', require('../../assets/Icons/Chat.png'), () => navigation.navigate('Chat'))}
            {renderTile('Navigate', require('../../assets/Icons/Navigate.png'), handleNavigatorPress)}
            
            {renderTile('Award Medal', require('../../assets/Icons/Medal.png'), () => navigation.navigate('AwardMedal'))}
            
            {renderTile('Edit Profile', require('../../assets/Icons/Profile.png'), () => navigation.navigate('EditProfile'))}
            
            {renderTile('Logout', require('../../assets/Icons/Logout.png'), () => {
              Alert.alert('Logout', 'Are you sure you want to sign out?', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Sign Out',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await signOutUser();
                    } catch (e) {
                      console.warn('Sign out failed', e);
                      Alert.alert('Notice', 'Unable to sign out.');
                    }
                  },
                },
              ]);
            })}
          </View>
        </ScrollView>

      <Modal visible={worksitePickerVisible} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Select Worksite</Text>
            <Text style={styles.modalSub}>Choose a worksite to navigate to.</Text>
            <ScrollView
              style={styles.worksiteScroll}
              contentContainerStyle={styles.worksiteList}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={sortedWorksites.length > 4}
            >
              {sortedWorksites.map(worksite => {
                const isSelected = selectedWorksite?.id === worksite.id;
                return (
                  <TouchableOpacity
                    key={worksite.id}
                    style={[styles.worksitePill, isSelected && styles.worksitePillSelected]}
                    onPress={() => handleSelectWorksite(worksite)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.worksitePillText} numberOfLines={2}>
                      {worksite.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalLink}
                onPress={() => setWorksitePickerVisible(false)}
              >
                <Text style={styles.modalLinkText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
  },
  safe: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollContent: {
    flexGrow: 1,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileSection: {
    alignItems: 'center',
    marginBottom: 32,
    width: '100%',
  },
  logo: {
    width: 160,
    height: 64,
    marginBottom: 16,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    marginBottom: 16,
    borderWidth: 3,
    borderColor: '#C9782B',
    backgroundColor: '#1E1813',
  },
  welcomeTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#F6EDE2',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  selectedSubtitle: {
    fontSize: 14,
    color: '#C9782B',
    fontWeight: '700',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    width: '100%',
    gap: 16,
  },
  tile: {
    width: '47.5%',
    backgroundColor: '#1E1813',
    borderRadius: 24,
    paddingVertical: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#C9782B',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  fullWidthTile: {
    width: '100%',
  },
  tileIcon: {
    width: 56,
    height: 56,
    marginBottom: 16,
  },
  tileLabel: {
    color: '#F6EDE2',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#1E1813',
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: '#3A2D24',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
    color: '#F6EDE2',
  },
  modalSub: {
    textAlign: 'center',
    color: '#C8B29A',
    marginBottom: 12,
  },
  input: {
    backgroundColor: '#3A2D24',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    color: '#EBDCCB',
    borderWidth: 1,
    borderColor: '#5A4739',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#C8B29A',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  modalLink: {
    marginRight: 16,
  },
  modalLinkText: {
    fontSize: 14,
    color: '#D9A441',
  },
  modalButton: {
    backgroundColor: '#C9782B',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  modalButtonText: {
    color: '#FFF',
    fontWeight: '600',
  },
  worksiteScroll: {
    maxHeight: 280,
    marginBottom: 12,
  },
  worksiteList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  worksitePill: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: '#3A2D24',
    borderWidth: 1,
    borderColor: '#5A4739',
    maxWidth: '100%',
  },
  worksitePillSelected: {
    borderColor: '#D9A441',
    backgroundColor: '#4A3828',
  },
  worksitePillText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F6EDE2',
    textAlign: 'center',
  },
});
