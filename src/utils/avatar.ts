import { Avatars, type AvatarKey } from '../../assets/avatars';

export const resolveAvatarSource = (avatarUrl?: string | null, customAvatarUrl?: string | null) => {
  if (customAvatarUrl) {
    return { uri: customAvatarUrl };
  }
  if (avatarUrl && avatarUrl in Avatars) {
    return Avatars[avatarUrl as AvatarKey];
  }
  return Avatars.pizzaMaker; // Fallback
};
