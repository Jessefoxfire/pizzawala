import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
  Alert,
  Modal,
  ImageBackground,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AvatarKey } from '../../assets/avatars';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from '@react-native-firebase/firestore';
import { auth, uploadStorageRef, uploadStorageRefFallback } from '../services/firebase';
import { resolveAvatarSource } from '../utils/avatar';
import { Icons } from '../components/Icons';
import {
  launchImageLibrary,
  launchCamera,
} from 'react-native-image-picker';
import { ensureImagePickerPermission } from '../utils/imagePickerPermissions';
import { putFileAndGetDownloadUrl } from '../utils/storageUpload';

const chatBg = require('../../assets/Chat background.png');
const DEBUG_TAG = '[ChatImageDebug]';

/** Same collection path as `teamChatMessages()` in firebase — explicit segments match profile’s `doc(fs, 'users', uid)` pattern. */
const chatMessagesCol = () => collection(getFirestore(), 'chats', 'team-1', 'messages');
const chatMessageDoc = (messageId: string) => doc(getFirestore(), 'chats', 'team-1', 'messages', messageId);

function isDeviceOnlyPhotoUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  return url.startsWith('file:') || url.startsWith('content:');
}

const AVATAR_COLORS: { [key: string]: string } = {
  cowboy: '#8B4513', pirate: '#2F4F4F', ninja: '#1A1A1A', wizard: '#4B0082',
  djFemale: '#C71585', pizzaMaker: '#D35400', owl: '#556B2F', bossFemale: '#2980B9',
  womanCasual: '#16A085', djMale: '#2E4053', djFemale2: '#8E44AD', spaceFemale: '#2C3E50',
  fox: '#D35400', bossMale: '#273746', pizzaMaker2: '#C0392B', superheroFemale: '#E91E63',
};

export default function ChatScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingMessage, setEditingMessage] = useState<any | null>(null);
  const [editText, setEditText] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  /** Local file URIs for uploads in progress — never write these to Firestore (other devices cannot open them). */
  const [localPhotoByMessageId, setLocalPhotoByMessageId] = useState<Record<string, string>>({});
  /** Resolved download URLs for messages that store only a storage path/gs URL. */
  const [resolvedPhotoByMessageId, setResolvedPhotoByMessageId] = useState<Record<string, string>>({});
  /** Image render failures by message id (diagnostic overlay in bubble). */
  const [photoRenderErrorByMessageId, setPhotoRenderErrorByMessageId] = useState<Record<string, string>>({});

  const flatListRef = useRef<FlatList>(null);
  /** Dedup storage resolves; must not depend on `resolvedPhotoByMessageId` in an effect — that effect's cleanup was cancelling other in-flight `getDownloadURL` calls. */
  const resolvedStorageIdsRef = useRef<Set<string>>(new Set());
  /** Latest `getDownloadURL` helper so `Image.onError` can retry from `photoStoragePath` (profile upload shows the URL immediately; chat often loads path → URL asynchronously). */
  const resolveStorageToUrlRef = useRef<(messageId: string, pathOrGsUrl: string) => Promise<void>>(async () => {});
  const user = auth.currentUser;
  const prefillText = route?.params?.prefillText;

  useEffect(() => {
    if (!user?.uid) return;
    const fs = getFirestore();
    const unsub = onSnapshot(doc(fs, 'users', user.uid), snap => {
      if (!snap || !snap.exists()) return;
      const data = snap.data();
      if (data) setUserProfile(data);
    });
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    const q = query(chatMessagesCol(), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(
      q,
      snapshot => {
        if (!snapshot || !snapshot.docs || snapshot.empty) {
          setMessages([]);
          setIsLoading(false);
          return;
        }
        if (snapshot.docs) {
          setMessages(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
        }
        setIsLoading(false);
      },
      err => {
        console.error('Chat messages listener:', err);
        setIsLoading(false);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (prefillText) setInputText(prev => (prev ? prev : prefillText));
  }, [prefillText]);

  useEffect(() => {
    let cancelled = false;

    const resolveUrl = async (messageId: string, pathOrGsUrl: string) => {
      const raw = typeof pathOrGsUrl === 'string' ? pathOrGsUrl.trim() : '';
      if (!raw || resolvedStorageIdsRef.current.has(messageId)) return;
      try {
        const storagePath = raw.startsWith('gs://') ? raw.replace(/^gs:\/\/[^/]+\//, '') : raw;
        console.log(`${DEBUG_TAG} resolve-start`, { messageId, storagePath });
        let resolvedUrl: string;
        try {
          resolvedUrl = await uploadStorageRef(storagePath).getDownloadURL();
        } catch (firstErr: any) {
          console.log(`${DEBUG_TAG} resolve-retry-fallback-bucket`, { messageId, code: firstErr?.code });
          resolvedUrl = await uploadStorageRefFallback(storagePath).getDownloadURL();
        }
        if (!cancelled && resolvedUrl) {
          resolvedStorageIdsRef.current.add(messageId);
          setResolvedPhotoByMessageId(prev => ({ ...prev, [messageId]: resolvedUrl }));
          console.log(`${DEBUG_TAG} resolve-success`, { messageId, resolvedUrl });
        }
      } catch (err: any) {
        console.log(`${DEBUG_TAG} resolve-failed`, {
          messageId,
          pathOrGsUrl: raw,
          code: err?.code,
          message: err?.message,
        });
      }
    };

    resolveStorageToUrlRef.current = resolveUrl;

    messages.forEach(item => {
      const messageId = item?.id as string | undefined;
      if (!messageId) return;
      const urlStr = typeof item.photoUrl === 'string' ? item.photoUrl.trim() : '';
      if (!urlStr && typeof item.photoStoragePath === 'string' && item.photoStoragePath.trim()) {
        void resolveUrl(messageId, item.photoStoragePath);
      } else if (urlStr.startsWith('gs://')) {
        void resolveUrl(messageId, urlStr);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [messages]);

  const sendMessage = async (photoUrl?: string | null, status: 'sent' | 'uploading' = 'sent') => {
    if (!inputText.trim() && !photoUrl && status !== 'uploading') return null;
    const text = inputText;
    if (status === 'sent') setInputText('');

    return addDoc(chatMessagesCol(), {
      text,
      // Do not persist device file/content URIs — other clients (and APK installs) cannot resolve them.
      photoUrl: status === 'uploading' ? null : photoUrl || null,
      photoStoragePath: null,
      pendingPhoto: status === 'uploading',
      senderId: user?.uid,
      senderName: userProfile?.name || user?.email || 'User',
      senderAvatar: userProfile?.avatarUrl || 'pizzaMaker',
      senderCustomAvatarUrl: userProfile?.customAvatarUrl || null,
      status,
      createdAt: serverTimestamp(),
    });
  };

  const uploadImage = async (uri: string, messageId: string, contentType = 'image/jpeg') => {
    if (!user?.uid) {
      Alert.alert('Upload Failed', 'You must be signed in to send photos.');
      return;
    }
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    // Must match Storage rules: chatImages/{userId}/{fileName}
    const storagePath = `chatImages/${user.uid}/${Date.now()}-${messageId}.${ext}`;
    try {
      console.log(`${DEBUG_TAG} upload-start`, {
        messageId,
        uid: user.uid,
        storagePath,
        contentType,
        uriScheme: uri.split(':')[0],
      });
      const reference = uploadStorageRef(storagePath);
      const downloadUrl = await putFileAndGetDownloadUrl(reference, uri, {
        contentType,
      }, {
        fallbackReference: () => uploadStorageRefFallback(storagePath),
      });
      console.log(`${DEBUG_TAG} upload-success`, { messageId, storagePath, downloadUrl });
      // Same idea as Edit Profile: show the Storage download URL immediately; don’t wait for Firestore snapshot.
      resolvedStorageIdsRef.current.add(messageId);
      setResolvedPhotoByMessageId(prev => ({ ...prev, [messageId]: downloadUrl }));
      await updateDoc(chatMessageDoc(messageId), {
        photoUrl: downloadUrl,
        photoStoragePath: storagePath,
        status: 'sent',
        pendingPhoto: false,
      });
      console.log(`${DEBUG_TAG} message-updated`, {
        messageId,
        status: 'sent',
        photoStoragePath: storagePath,
      });
      setLocalPhotoByMessageId(prev => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
    } catch (error: any) {
      console.error('Chat image upload:', error);
      try {
        await updateDoc(chatMessageDoc(messageId), {
          status: 'error',
          pendingPhoto: false,
        });
      } catch {
        // ignore secondary failure
      }
      setLocalPhotoByMessageId(prev => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });
      Alert.alert(
        'Upload Failed',
        error?.message || error?.code || 'Could not upload this photo'
      );
    }
  };

  const handleImagePick = async (useCamera: boolean) => {
    const source = useCamera ? 'camera' : 'library';
    const hasPermission = await ensureImagePickerPermission(source);
    if (!hasPermission) {
      Alert.alert('Permission needed', 'Allow camera access to take a new photo.');
      return;
    }

    const options: any = { mediaType: 'photo', quality: 0.7, maxWidth: 1000, maxHeight: 1000 };
    try {
      const result = useCamera ? await launchCamera(options) : await launchImageLibrary(options);
      if (result.errorCode) {
        Alert.alert('Photo', result.errorMessage || result.errorCode);
        return;
      }
      if (result.didCancel) return;

      const asset = result.assets?.[0];
      const uri = asset?.uri || asset?.originalPath;
      if (!uri) {
        Alert.alert('Photo', 'Could not read the selected image.');
        return;
      }

      const contentType =
        typeof asset?.type === 'string' && asset.type.startsWith('image/')
          ? asset.type
          : 'image/jpeg';

      const msgRef = await sendMessage(null, 'uploading');
      if (!msgRef) {
        Alert.alert('Chat', 'Could not create message. Try again.');
        return;
      }
      setLocalPhotoByMessageId(prev => ({ ...prev, [msgRef.id]: uri }));
      void uploadImage(uri, msgRef.id, contentType);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to share photo');
    }
  };

  const handleLongPress = (item: any) => {
    if (item.senderId !== user?.uid) return;
    Alert.alert('Message Options', 'Choose an action:', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Edit', onPress: () => { setEditingMessage(item); setEditText(item.text); setEditModalVisible(true); } },
      { text: 'Delete', style: 'destructive', onPress: () => confirmDelete(item.id) },
    ]);
  };

  const confirmDelete = (id: string) => {
    Alert.alert('Delete Message', 'Are you sure you want to delete this message?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteDoc(chatMessageDoc(id)) }
    ]);
  };

  const handleUpdateMessage = async () => {
    if (!editingMessage || !editText.trim()) return;
    setEditSaving(true);
    try {
      await updateDoc(chatMessageDoc(editingMessage.id), { text: editText });
      setEditModalVisible(false);
      setEditingMessage(null);
    } catch (err: any) {
      Alert.alert('Error', 'Failed to update message');
    } finally {
      setEditSaving(false);
    }
  };

  const renderMessage = ({ item }: { item: any }) => {
    const isMe = item.senderId === user?.uid;
    const avatarSource = resolveAvatarSource(
      isMe ? userProfile?.avatarUrl : item.senderAvatar,
      isMe ? userProfile?.customAvatarUrl : item.senderCustomAvatarUrl
    );
    const displayName = isMe ? 'You' : item.senderName;
    const avatarKey = (isMe ? userProfile?.avatarUrl : item.senderAvatar) as AvatarKey;
    const avatarColor = AVATAR_COLORS[avatarKey] || '#5B4B3A';
    const localPreviewUri = isMe ? localPhotoByMessageId[item.id] : undefined;
    const firestorePhotoUrl = typeof item.photoUrl === 'string' ? item.photoUrl.trim() : '';
    const storedPhoto =
      firestorePhotoUrl && !isDeviceOnlyPhotoUrl(firestorePhotoUrl) ? firestorePhotoUrl : null;
    const resolvedUrl = resolvedPhotoByMessageId[item.id];
    const photoUri =
      storedPhoto ||
      resolvedUrl ||
      (item.pendingPhoto && localPreviewUri ? localPreviewUri : null);
    const showOthersPhotoPending = item.pendingPhoto && !isMe && !firestorePhotoUrl;

    return (
      <TouchableOpacity 
        activeOpacity={0.9} 
        onLongPress={() => handleLongPress(item)}
        style={[styles.messageBubble, isMe ? styles.myMessage : { ...styles.theirMessage, backgroundColor: `${avatarColor}E6` }]}
      >
        <View style={[styles.senderHeader, isMe && styles.senderHeaderMe]}>
          {avatarSource && <Image source={avatarSource} style={[styles.miniAvatar, isMe && styles.miniAvatarMe]} />}
          <Text style={styles.senderName}>{displayName}</Text>
        </View>

        {photoUri && (
          <View style={styles.photoContainer}>
            <Image
              key={`chat-img-${item.id}-${String(photoUri).slice(0, 80)}`}
              source={{ uri: photoUri }}
              style={[styles.messagePhoto, item.status === 'uploading' && { opacity: 0.5 }]}
              resizeMode="cover"
              onLoad={() => {
                console.log(`${DEBUG_TAG} image-rendered`, { messageId: item.id, photoUri });
                setPhotoRenderErrorByMessageId(prev => {
                  if (!prev[item.id]) return prev;
                  const next = { ...prev };
                  delete next[item.id];
                  return next;
                });
              }}
              onError={evt => {
                const msg = evt?.nativeEvent?.error || 'unknown-image-error';
                console.log(`${DEBUG_TAG} image-render-error`, { messageId: item.id, photoUri, error: msg });
                setPhotoRenderErrorByMessageId(prev => ({ ...prev, [item.id]: msg }));
                const path = typeof item.photoStoragePath === 'string' ? item.photoStoragePath.trim() : '';
                if (
                  path &&
                  photoUri &&
                  !photoUri.startsWith('file') &&
                  !photoUri.startsWith('content')
                ) {
                  resolvedStorageIdsRef.current.delete(item.id);
                  setResolvedPhotoByMessageId(prev => {
                    const next = { ...prev };
                    delete next[item.id];
                    return next;
                  });
                  void resolveStorageToUrlRef.current(item.id, path);
                }
              }}
            />
            {item.status === 'uploading' && <ActivityIndicator style={styles.photoLoader} color="#fff" />}
            {item.status === 'error' && <Text style={styles.errorText}>⚠️ Upload Failed</Text>}
          </View>
        )}
        {photoRenderErrorByMessageId[item.id] && (
          <Text style={styles.errorText}>⚠️ Image render failed</Text>
        )}
        {showOthersPhotoPending && (
          <View style={styles.photoPendingRow}>
            <ActivityIndicator size="small" color="#F6EDE2" />
            <Text style={styles.photoPendingText}>Sending photo…</Text>
          </View>
        )}
        
        {item.text ? <Text style={[styles.messageText, isMe ? styles.myMessageText : styles.theirMessageText]}>{item.text}</Text> : null}

        <View style={styles.timeContainer}>
          <Text style={styles.messageTime}>
            {item.createdAt?.toDate?.()
              ? item.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : '...'}
          </Text>
          {isMe && item.status === 'sent' && <Text style={styles.sentCheck}> ✓</Text>}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Icons.arrowLeft color="#F6EDE2" width={24} height={24} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Team Chat</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 52 : 0}
      >
        <View style={{ flex: 1 }}>
          <ImageBackground source={chatBg} style={styles.chatBg}>
            {isLoading ? (
              <View style={styles.centered}><ActivityIndicator size="large" color="#F3E6D3" /></View>
            ) : (
              <FlatList
                ref={flatListRef}
                style={{ flex: 1 }}
                data={messages}
                extraData={{
                  localPhotoByMessageId,
                  resolvedPhotoByMessageId,
                  photoRenderErrorByMessageId,
                }}
                renderItem={renderMessage}
                keyExtractor={item => item.id}
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
                onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
              />
            )}
          </ImageBackground>

          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="Type a message…"
              placeholderTextColor="#8696A0"
              value={inputText}
              onChangeText={setInputText}
              multiline
            />
            <TouchableOpacity style={styles.sendButton} onPress={() => void sendMessage()}>
              <Text style={styles.sendButtonText}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={editModalVisible} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Message</Text>
            <TextInput style={styles.modalInput} value={editText} onChangeText={setEditText} multiline />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setEditModalVisible(false)}><Text style={styles.modalCancel}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={handleUpdateMessage} style={styles.modalSave} disabled={editSaving}>
                {editSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSaveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#2A211B' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#1E1813' },
  headerTitle: { fontSize: 20, fontWeight: '900', color: '#F6EDE2' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  chatBg: { flex: 1 },
  listContent: { padding: 16 },
  messageBubble: { maxWidth: '85%', padding: 10, borderRadius: 16, marginBottom: 12 },
  myMessage: { alignSelf: 'flex-end', backgroundColor: '#C9782B' },
  theirMessage: { alignSelf: 'flex-start' },
  senderHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  senderHeaderMe: { justifyContent: 'flex-end', flexDirection: 'row-reverse' },
  miniAvatar: { width: 28, height: 28, borderRadius: 14, marginRight: 8 },
  miniAvatarMe: { marginRight: 0, marginLeft: 8 },
  senderName: { fontSize: 10, fontWeight: '900', color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' },
  messageText: { fontSize: 15, color: '#F6EDE2' },
  myMessageText: { color: '#FFF' },
  theirMessageText: { color: '#F6EDE2' },
  photoContainer: { width: '100%', marginBottom: 6, borderRadius: 12, overflow: 'hidden' },
  messagePhoto: { width: '100%', height: 220, backgroundColor: '#1E1813' },
  photoLoader: { position: 'absolute', top: '45%', left: '45%' },
  errorText: { color: '#fff', fontSize: 10, fontWeight: 'bold', marginTop: 4 },
  photoPendingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  photoPendingText: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '600' },
  timeContainer: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 4 },
  messageTime: { fontSize: 10, color: 'rgba(255,255,255,0.6)' },
  sentCheck: { fontSize: 10, color: 'rgba(255,255,255,0.6)' },
  inputContainer: { flexDirection: 'row', padding: 12, backgroundColor: '#1E1813', alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#2A211B', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, marginRight: 10, color: '#F6EDE2', maxHeight: 100 },
  sendButton: { backgroundColor: '#C9782B', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },
  sendButtonText: { color: '#1E1813', fontWeight: '900' },
  attachButton: { marginRight: 12 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#1E1813', padding: 20, borderRadius: 20, borderWidth: 1, borderColor: '#3A2D24' },
  modalTitle: { color: '#F6EDE2', fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
  modalInput: { backgroundColor: '#2A211B', color: '#F6EDE2', padding: 16, borderRadius: 12, fontSize: 16, minHeight: 100, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 16, gap: 20 },
  modalCancel: { color: '#A88E73', fontWeight: '600' },
  modalSave: { backgroundColor: '#C9782B', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  modalSaveText: { color: '#1E1813', fontWeight: 'bold' },
});
