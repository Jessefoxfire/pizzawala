import { addDoc, collection, doc, getDoc, getDocs, getFirestore, query, serverTimestamp, where } from '@react-native-firebase/firestore';
import {
  buildShiftEditAdminNotification,
  type ShiftEditReviewPayload,
} from '../notifications/shiftEditReview';
import type { LiveShift } from './shifts';

function userDisplayName(data: Record<string, unknown> | undefined): string {
  const name = typeof data?.name === 'string' ? data.name.trim() : '';
  if (name) return name;
  const displayName = typeof data?.displayName === 'string' ? data.displayName.trim() : '';
  return displayName;
}

export async function resolveShiftEmployeeName(shift: Pick<LiveShift, 'userId'>): Promise<string> {
  if (!shift.userId) return 'An employee';
  try {
    const snap = await getDoc(doc(getFirestore(), 'users', shift.userId));
    return userDisplayName(snap.data() as Record<string, unknown> | undefined) || 'An employee';
  } catch {
    return 'An employee';
  }
}

export async function notifyAdminsOfPendingShiftEdit(input: {
  shift: Pick<LiveShift, 'id' | 'userId' | 'teamId'>;
  employeeName?: string;
}): Promise<void> {
  const shiftId = input.shift.id;
  const employeeUserId = input.shift.userId;
  if (!shiftId || !employeeUserId) return;

  const employeeName = input.employeeName?.trim() || (await resolveShiftEmployeeName(input.shift));
  const payload: ShiftEditReviewPayload = {
    shiftId,
    employeeUserId,
    employeeName,
  };
  const notification = buildShiftEditAdminNotification(payload);
  const teamId = typeof input.shift.teamId === 'string' && input.shift.teamId.trim()
    ? input.shift.teamId.trim()
    : 'team-1';

  const fs = getFirestore();
  const adminsSnap = await getDocs(query(collection(fs, 'users'), where('roles', 'array-contains', 'admin')));
  const recipientIds = adminsSnap.docs
    .filter(adminDoc => {
      if (adminDoc.id === employeeUserId) return false;
      if (adminDoc.get('disabled') === true) return false;
      const recipientTeam = typeof adminDoc.get('teamId') === 'string' && adminDoc.get('teamId').trim()
        ? adminDoc.get('teamId').trim()
        : 'team-1';
      return recipientTeam === teamId;
    })
    .map(adminDoc => adminDoc.id);

  await Promise.allSettled(
    recipientIds.map(userId =>
      addDoc(collection(fs, 'users', userId, 'notifications'), {
        ...notification,
        createdAt: serverTimestamp(),
      })
    )
  );
}
