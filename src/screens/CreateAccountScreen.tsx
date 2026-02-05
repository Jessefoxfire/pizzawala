
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  SafeAreaView,
  Image,
} from 'react-native';
import { createAccountWithEmail } from '../services/firebase';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { Icons } from '../components/Icons';

type CreateAccountScreenProps = NativeStackScreenProps<RootStackParamList, 'CreateAccount'>;

const avatarOptions = [
    { id: 'mummy', url: 'https://img.icons8.com/color/96/mummy.png' },
    { id: 'ninja', url: 'https://img.icons8.com/color/96/ninja.png' },
    { id: 'alien', url: 'https://img.icons8.com/color/96/alien.png' },
    { id: 'robot', url: 'https://img.icons8.com/color/96/robot-upper-body.png' },
    { id: 'ghost', url: 'https://img.icons8.com/color/96/ghost.png' },
    { id: 'cat', url: 'https://img.icons8.com/color/96/cat--v1.png' },
    { id: 'dog', url: 'https://img.icons8.com/color/96/dog.png' },
    { id: 'panda', url: 'https://img.icons8.com/color/96/panda.png' },
    { id: 'pizza', url: 'https://img.icons8.com/color/96/pizza.png' },
    { id: 'burger', url: 'https://img.icons8.com/color/96/hamburger.png' },
    { id: 'taco', url: 'https://img.icons8.com/color/96/taco.png' },
    { id: 'iceCream', url: 'https://img.icons8.com/color/96/ice-cream-cone.png' },
    { id: 'cookie', url: 'https://img.icons8.com/color/96/cookie.png' },
    { id: 'hotdog', url: 'https://img.icons8.com/color/96/hot-dog.png' },
    { id: 'coffee', url: 'https://img.icons8.com/color/96/coffee-to-go.png' },
    { id: 'croissant', url: 'https://img.icons8.com/color/96/croissant.png' },
    { id: 'rocket', url: 'https://img.icons8.com/color/96/rocket.png' },
    { id: 'gamepad', url: 'https://img.icons8.com/color/96/game-controller.png' },
    { id: 'crown', url: 'https://img.icons8.com/color/96/crown.png' },
    { id: 'gift', url: 'https://img.icons8.com/color/96/gift.png' },
    { id: 'camera', url: 'https://img.icons8.com/color/96/camera.png' },
    { id: 'star', url: 'https://img.icons8.com/color/96/star.png' },
    { id: 'heart', url: 'https://img.icons8.com/color/96/like--v1.png' },
    { id: 'piggyBank', url: 'https://img.icons8.com/color/96/piggy-bank.png' }
];

export default function CreateAccountScreen({ navigation }: CreateAccountScreenProps) {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleCreateAccount = () => {
        if (!name.trim() || !email.trim() || !password.trim() || !selectedAvatar) {
            Alert.alert('Error', 'Please fill in all fields and select an avatar.');
            return;
        }

        setIsLoading(true);
        const avatarUrl = avatarOptions.find(a => a.id === selectedAvatar)?.url || '';
        
        createAccountWithEmail(name, email, password, avatarUrl)
            .catch((error) => {
                Alert.alert('Account Creation Failed', 'Please try a different email or password.');
            })
            .finally(() => {
                setIsLoading(false);
            });
    };

    return (
        <SafeAreaView style={styles.container}>
            <ScrollView contentContainerStyle={styles.scrollContainer}>
                <View style={styles.card}>
                    <Text style={styles.title}>Create Account</Text>
                    <Text style={styles.subtitle}>Join the Pizza Wala team.</Text>

                    <View style={styles.avatarSection}>
                        <Text style={styles.label}>Choose Your Avatar</Text>
                        <View style={styles.avatarGrid}>
                            {avatarOptions.map((avatar) => (
                                <TouchableOpacity
                                    key={avatar.id}
                                    style={[
                                        styles.avatarWrapper,
                                        selectedAvatar === avatar.id && styles.avatarSelected,
                                    ]}
                                    onPress={() => setSelectedAvatar(avatar.id)}
                                >
                                    <Image source={{ uri: avatar.url }} style={styles.avatarImage} />
                                    {selectedAvatar === avatar.id && (
                                        <View style={styles.avatarCheckmark}>
                                            <Icons.check color="#fff" width={16} height={16} />
                                        </View>
                                    )}
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>
                    
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Full Name</Text>
                        <TextInput
                            placeholder="e.g. Tony Pepperoni"
                            value={name}
                            onChangeText={setName}
                            style={styles.input}
                            placeholderTextColor="#8F6A48"
                        />
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Email</Text>
                        <TextInput
                            placeholder="tony@pizzawala.com"
                            value={email}
                            onChangeText={setEmail}
                            style={styles.input}
                            autoCapitalize="none"
                            keyboardType="email-address"
                            placeholderTextColor="#8F6A48"
                        />
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Password</Text>
                        <View style={styles.passwordContainer}>
                            <TextInput
                                placeholder="Min. 6 characters"
                                value={password}
                                onChangeText={setPassword}
                                style={styles.passwordInput}
                                secureTextEntry={!showPassword}
                                placeholderTextColor="#8F6A48"
                            />
                            <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
                                {showPassword ? <Icons.eyeOff color="#fff" width={20} height={20} /> : <Icons.eye color="#fff" width={20} height={20} />}
                            </TouchableOpacity>
                        </View>
                    </View>

                    <TouchableOpacity
                        style={styles.button}
                        onPress={handleCreateAccount}
                        disabled={isLoading}
                    >
                        {isLoading ? <ActivityIndicator color="#3D352E" /> : <Text style={styles.buttonText}>Create Account</Text>}
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
                        <Text style={styles.backButtonText}>Already have an account? <Text style={styles.underline}>Log in</Text></Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#e77f39' },
    scrollContainer: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
    card: { width: '100%', maxWidth: 380, backgroundColor: '#FEF6E4', paddingHorizontal: 24, paddingVertical: 32, borderRadius: 24, alignItems: 'center', elevation: 5 },
    title: { fontSize: 28, fontWeight: 'bold', color: '#3D352E', marginBottom: 8, fontFamily: 'sans-serif' },
    subtitle: { fontSize: 16, color: '#57493E', marginBottom: 24, textAlign: 'center', fontFamily: 'sans-serif' },
    inputGroup: { width: '100%', marginBottom: 16 },
    input: { width: '100%', backgroundColor: '#e77f39', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, fontSize: 16, color: '#FFFFFF', fontWeight: '500', fontFamily: 'sans-serif' },
    passwordContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#e77f39', borderRadius: 12, width: '100%' },
    passwordInput: { flex: 1, paddingVertical: 14, paddingHorizontal: 16, fontSize: 16, color: '#FFFFFF', fontWeight: '500', fontFamily: 'sans-serif' },
    eyeIcon: { paddingRight: 16 },
    button: { backgroundColor: '#FDECC8', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 10, width: '100%' },
    buttonText: { fontWeight: '600', fontSize: 16, color: '#3D352E', fontFamily: 'sans-serif' },
    backButton: { marginTop: 24, padding: 10 },
    backButtonText: { color: '#57493E', fontSize: 14, textAlign: 'center', fontFamily: 'sans-serif' },
    underline: { textDecorationLine: 'underline' },
    avatarSection: { width: '100%', marginBottom: 20 },
    label: { fontSize: 14, fontWeight: '500', color: '#3D352E', marginBottom: 8, fontFamily: 'sans-serif' },
    avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 },
    avatarWrapper: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#FDECC8', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'transparent' },
    avatarImage: { width: 48, height: 48 },
    avatarSelected: { borderColor: '#e77f39', backgroundColor: '#e77f39' },
    avatarCheckmark: { position: 'absolute', bottom: -2, right: -2, backgroundColor: '#3D352E', borderRadius: 12, width: 24, height: 24, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#FEF6E4' }
});
