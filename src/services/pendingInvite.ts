import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeInviteToken } from '../utils/teamInvites';

export const PENDING_TEAM_INVITE_KEY = 'pending_team_invite_token';

export async function persistPendingInviteToken(token: string | null | undefined): Promise<string | null> {
  const normalized = normalizeInviteToken(token);
  if (!normalized) return null;
  await AsyncStorage.setItem(PENDING_TEAM_INVITE_KEY, normalized);
  return normalized;
}

export async function readPendingInviteToken(): Promise<string | null> {
  const stored = await AsyncStorage.getItem(PENDING_TEAM_INVITE_KEY);
  return normalizeInviteToken(stored);
}

export async function clearPendingInviteToken(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_TEAM_INVITE_KEY);
}
