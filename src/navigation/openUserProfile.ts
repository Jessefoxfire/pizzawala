import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from './AppNavigator';

export function openUserProfile(
  navigation: NativeStackNavigationProp<RootStackParamList>,
  user: { userId: string; userName?: string | null }
) {
  const userId = String(user.userId || '').trim();
  if (!userId) return;
  navigation.navigate('EditProfile', {
    userId,
    userName: user.userName ? String(user.userName) : undefined,
  });
}
