import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  ToastAndroid,
  Image,
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  addDoc,
  collection,
  doc,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from '@react-native-firebase/firestore';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { auth } from '../services/firebase';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { resolveAvatarSource } from '../utils/avatar';

type Props = NativeStackScreenProps<RootStackParamList, 'AwardMedal'>;

type AwardType = 'star' | 'hug' | 'kiss' | 'medal' | 'heart' | 'fire' | 'cool' | 'trophy' | 'crown' | 'pizza';

type UserRecord = {
  id: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  customAvatarUrl?: string | null;
  teamId?: string;
};

const awardOptions: { type: AwardType; label: string; icon: string }[] = [
  { type: 'medal', label: 'Medal', icon: '🏅' },
  { type: 'star', label: 'Star', icon: '⭐' },
  { type: 'fire', label: 'Fire', icon: '🔥' },
  { type: 'heart', label: 'Heart', icon: '❤️' },
  { type: 'cool', label: 'Cool', icon: '😎' },
  { type: 'trophy', label: 'Trophy', icon: '🏆' },
  { type: 'crown', label: 'Crown', icon: '👑' },
  { type: 'pizza', label: 'Pizza', icon: '🍕' },
  { type: 'hug', label: 'Hug', icon: '🤗' },
  { type: 'kiss', label: 'Kiss', icon: '💋' },
];

export default function AwardMedalScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<AwardType>('medal');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentUserName, setCurrentUserName] = useState<string>('');
  const [currentTeamId, setCurrentTeamId] = useState<string>('team-1');
  const [latestAward, setLatestAward] = useState<any>(null);

  const currentUserId = auth.currentUser?.uid || null;

  useEffect(() => {
    const fs = getFirestore();
    const unsub = onSnapshot(
      collection(fs, 'users'),
      snap => {
        if (!snap) {
          setUsers([]);
          setLoading(false);
          return;
        }
        const items = snap.docs.map(docSnap => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<UserRecord, 'id'>),
        }));
        setUsers(items);
        setLoading(false);
      },
      err => {
        console.warn('AwardMedal users listener', err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    const fs = getFirestore();
    const unsub = onSnapshot(
      doc(fs, 'users', currentUserId),
      snap => {
        if (!snap || !snap.exists()) return;
        const data = snap.data();
        const name = data?.name || data?.email || '';
        const team = data?.teamId || 'team-1';
        if (name) setCurrentUserName(String(name));
        setCurrentTeamId(String(team));
      },
      err => console.warn('AwardMedal profile listener', err)
    );

    return () => unsub();
  }, [currentUserId]);

  useEffect(() => {
    const fs = getFirestore();
    const q = query(collection(fs, 'awards'), orderBy('createdAt', 'desc'), limit(1));
    const unsub = onSnapshot(
      q,
      snap => {
        if (!snap.empty) {
          setLatestAward(snap.docs[0].data());
        }
      },
      err => console.warn('AwardMedal awards listener', err)
    );
    return () => unsub();
  }, []);

  const userList = useMemo(() => {
    return users
      .filter(user => user.id !== currentUserId)
      .sort((a, b) => {
        const aName = (a.name || a.email || '').toLowerCase();
        const bName = (b.name || b.email || '').toLowerCase();
        return aName.localeCompare(bName);
      });
  }, [users, currentUserId]);

  const selectedUser = useMemo(
    () => userList.find(user => user.id === selectedUserId) || null,
    [userList, selectedUserId]
  );

  const handleAward = async () => {
    if (saving) return;
    if (!currentUserId) {
      Alert.alert('Notice', 'You must be signed in to award medals.');
      return;
    }
    if (!selectedUser) {
      Alert.alert('Select a teammate', 'Choose someone to award.');
      return;
    }

    const trimmedReason = reason.trim();

    setSaving(true);
    try {
      await addDoc(collection(getFirestore(), 'awards'), {
        fromUserId: currentUserId,
        fromUserName: currentUserName || 'Someone',
        toUserId: selectedUser.id,
        toUserName: selectedUser.name || selectedUser.email || 'Teammate',
        type: selectedType,
        reason: trimmedReason || 'a good deed',
        teamId: currentTeamId,
        createdAt: serverTimestamp(),
      });

      const toastMessage = `Award sent to ${selectedUser.name || 'teammate'}!`;
      if (Platform.OS === 'android') {
        ToastAndroid.show(toastMessage, ToastAndroid.SHORT);
      } else {
        Alert.alert('Success', toastMessage);
      }

      setReason('');
      setSelectedType('medal');
      setSelectedUserId(null);
    } catch (err: any) {
      const msg = err?.message ? String(err.message) : 'Unable to send award.';
      Alert.alert('Notice', msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Home</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Award Medal</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#F3E6D3" />
        </View>
      ) : (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 12}
      >
        <View style={styles.mainArea}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: 210 + insets.bottom }]}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.content}>
              {latestAward && (
                <TouchableOpacity
                  style={styles.latestBanner}
                  onPress={() => navigation.navigate('HallOfFame')}
                  activeOpacity={0.9}
                >
                  <View style={styles.bannerLeft}>
                    <Text style={styles.bannerPre}>Current Star</Text>
                    <Text style={styles.bannerName}>{latestAward.toUserName || 'Team Star'}</Text>
                    <Text style={styles.bannerLabel}>Enter Hall of Fame ›</Text>
                  </View>
                  <View style={styles.bannerRight}>
                    <Text style={styles.bannerIcon}>⭐</Text>
                  </View>
                </TouchableOpacity>
              )}

              <Text style={styles.sectionTitle}>Select team member</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.userRow}
              >
                {userList.map(item => {
                  const label = item.name || item.email || 'Teammate';
                  const isSelected = item.id === selectedUserId;
                  const avatarSrc = resolveAvatarSource(item.avatarUrl, item.customAvatarUrl);
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.userCard, isSelected && styles.userCardActive]}
                      onPress={() => setSelectedUserId(item.id)}
                    >
                      <View style={styles.avatarContainer}>
                        <Image source={avatarSrc} style={styles.userAvatar} />
                        {isSelected && (
                          <View style={styles.selectedBadge}>
                            <Text style={styles.checkIcon}>✓</Text>
                          </View>
                        )}
                      </View>
                      <Text
                        style={[styles.userLabel, isSelected && styles.userLabelActive]}
                        numberOfLines={1}
                      >
                        {label.split(' ')[0]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <Text style={styles.sectionTitle}>Choose award</Text>
              <View style={styles.awardRow}>
                {awardOptions.map(option => {
                  const isSelected = option.type === selectedType;
                  return (
                    <TouchableOpacity
                      key={option.type}
                      style={[styles.awardOption, isSelected && styles.awardOptionActive]}
                      onPress={() => setSelectedType(option.type)}
                    >
                      <Text style={styles.awardIcon}>{option.icon}</Text>
                      <Text style={styles.awardLabel}>{option.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </ScrollView>

          <View style={[styles.composer, { paddingBottom: 12 + insets.bottom }]}>
            <Text style={styles.sectionTitle}>Why are you awarding it?</Text>
            <TextInput
              style={styles.reasonInput}
              placeholder="Share the good deed"
              value={reason}
              onChangeText={setReason}
              multiline
            />
            <TouchableOpacity
              style={[styles.awardButton, saving && styles.awardButtonDisabled]}
              onPress={handleAward}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#2A211B" />
              ) : (
                <Text style={styles.awardButtonText}>Send Award</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#2A211B',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#1E1813',
    borderBottomWidth: 1,
    borderBottomColor: '#3A2D24',
  },
  back: { fontSize: 18, fontWeight: 'bold', color: '#EBDCCB' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#F6EDE2' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  mainArea: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: { padding: 16, gap: 16 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#C8B29A' },
  userRow: { paddingVertical: 8, gap: 16 },
  userCard: {
    width: 80,
    alignItems: 'center',
    gap: 8,
  },
  avatarContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#3A2D24',
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'visible',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userCardActive: {
    opacity: 1,
  },
  userAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  selectedBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#C9782B',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#1E1813',
  },
  checkIcon: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  userLabel: {
    color: '#C8B29A',
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '500',
  },
  userLabelActive: {
    color: '#F6EDE2',
    fontWeight: '700',
  },
  userChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: '#3A2D24',
    borderWidth: 1,
    borderColor: '#5A4739',
  },
  userChipActive: {
    backgroundColor: '#C9782B',
    borderColor: '#D9A441',
  },
  userChipText: { color: '#EBDCCB', fontSize: 13 },
  userChipTextActive: { color: '#1E1813', fontWeight: '700' },
  awardRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  awardOption: {
    width: '47%',
    backgroundColor: '#3A2D24',
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#5A4739',
  },
  awardOptionActive: {
    backgroundColor: '#C9782B',
    borderColor: '#D9A441',
  },
  awardIcon: { fontSize: 22 },
  awardLabel: { marginTop: 6, color: '#EBDCCB', fontWeight: '600' },
  reasonInput: {
    minHeight: 80,
    backgroundColor: '#3A2D24',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#EBDCCB',
    borderWidth: 1,
    borderColor: '#5A4739',
  },
  awardButton: {
    backgroundColor: '#D9A441',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  awardButtonDisabled: {
    opacity: 0.6,
  },
  awardButtonText: { color: '#2A211B', fontSize: 16, fontWeight: '900', textTransform: 'uppercase' },
  composer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: 'rgba(30, 24, 19, 0.97)',
    borderTopWidth: 1,
    borderTopColor: '#3A2D24',
  },
  latestBanner: {
    backgroundColor: '#C9782B',
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#C9782B',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  bannerLeft: { flex: 1 },
  bannerPre: { color: 'rgba(30, 24, 19, 0.7)', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  bannerName: { color: '#1E1813', fontSize: 24, fontWeight: '900', marginTop: 2 },
  bannerLabel: { color: '#1E1813', fontSize: 13, fontWeight: '700', marginTop: 8, opacity: 0.8 },
  bannerRight: { width: 60, height: 60, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  bannerIcon: { fontSize: 32 },
  hallLink: { marginTop: 24, paddingVertical: 12, alignItems: 'center' },
  hallLinkText: { color: '#C9782B', fontWeight: 'bold', fontSize: 14, textDecorationLine: 'underline' },
});
