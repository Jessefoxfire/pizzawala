
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
  SafeAreaView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { db, auth } from '../services/firebase';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  doc,
  getDoc,
} from 'firebase/firestore';

export default function ChatScreen({ navigation }: any) {
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<any>(null);
  const flatListRef = useRef<FlatList>(null);
  const user = auth.currentUser;

  useEffect(() => {
    if (!user) return;

    getDoc(doc(db, 'users', user.uid)).then(snap => {
        if (snap.exists()) setUserProfile(snap.data());
    });

    const q = query(
      collection(db, 'chats/team-1/messages'),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMessages(msgs);
      setIsLoading(false);
    });

    return unsubscribe;
  }, [user]);

  const sendMessage = async () => {
    if (!inputText.trim() || !user || !userProfile) return;

    const textToSend = inputText;
    setInputText('');

    try {
      await addDoc(collection(db, 'chats/team-1/messages'), {
        text: textToSend,
        senderId: user.uid,
        senderName: userProfile.name,
        senderAvatar: userProfile.avatarUrl,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.error(e);
    }
  };

  const renderMessage = ({ item }: { item: any }) => {
    const isMe = item.senderId === user?.uid;
    return (
      <View style={[styles.messageBubble, isMe ? styles.myMessage : styles.theirMessage]}>
        {!isMe && (
            <View style={styles.senderHeader}>
                {item.senderAvatar && <Image source={{ uri: item.senderAvatar }} style={styles.miniAvatar} />}
                <Text style={styles.senderName}>{item.senderName}</Text>
            </View>
        )}
        <Text style={[styles.messageText, isMe ? styles.myMessageText : styles.theirMessageText]}>
          {item.text}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Team Chat</Text>
        <View style={{ width: 50 }} />
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#FEF6E4" />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        />
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            value={inputText}
            onChangeText={setInputText}
            multiline
          />
          <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#e77f39' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#FEF6E4' },
  backButton: { fontSize: 18, color: '#3D352E', fontWeight: '600' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#3D352E' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 16 },
  messageBubble: { maxWidth: '80%', padding: 12, borderRadius: 16, marginBottom: 8 },
  myMessage: { alignSelf: 'flex-end', backgroundColor: '#3D352E' },
  theirMessage: { alignSelf: 'flex-start', backgroundColor: '#FEF6E4' },
  senderHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  miniAvatar: { width: 20, height: 20, marginRight: 6, borderRadius: 10 },
  senderName: { fontSize: 12, fontWeight: 'bold', color: '#8F6A48' },
  messageText: { fontSize: 16 },
  myMessageText: { color: '#FFF' },
  theirMessageText: { color: '#3D352E' },
  inputContainer: { flexDirection: 'row', padding: 12, backgroundColor: '#FEF6E4', alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#FFF', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, marginRight: 8, fontSize: 16, maxHeight: 100 },
  sendButton: { backgroundColor: '#e77f39', borderRadius: 20, paddingHorizontal: 20, paddingVertical: 10 },
  sendButtonText: { color: '#FFF', fontWeight: 'bold' }
});
