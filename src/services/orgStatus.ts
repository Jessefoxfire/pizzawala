import { doc, getDoc, getFirestore, updateDoc } from '@react-native-firebase/firestore';
import {
  orgActivationWrite,
  shouldApplyOrgActivation,
  type OrgStatusFields,
} from '../utils/orgStatus';

export async function applyOrgActivation(userId: string, autoKey: string): Promise<boolean> {
  const uid = String(userId || '').trim();
  const key = String(autoKey || '').trim();
  if (!uid || !key) return false;
  const ref = doc(getFirestore(), 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;
  const data = snap.data() as OrgStatusFields;
  if (!shouldApplyOrgActivation(data, key)) return false;
  await updateDoc(ref, orgActivationWrite(key));
  return true;
}

export async function applyOrgActivationForUsers(
  userIds: string[],
  autoKeyFor: (userId: string) => string
): Promise<void> {
  const unique = Array.from(new Set(userIds.map(id => String(id || '').trim()).filter(Boolean)));
  await Promise.allSettled(unique.map(userId => applyOrgActivation(userId, autoKeyFor(userId))));
}
