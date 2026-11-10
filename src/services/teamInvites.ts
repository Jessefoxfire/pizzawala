import {
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from '@react-native-firebase/firestore';
import {
  TEAM_INVITE_ROLE,
  TEAM_INVITE_TEAM_ID,
  TEAM_INVITE_TTL_DAYS,
  buildInviteHttpsUrl,
  canAcceptInvite,
  generateInviteToken,
  inviteFailureReason,
  nextInviteStatus,
  normalizeInviteToken,
  type TeamInviteRecord,
} from '../utils/teamInvites';

const invitationsCol = () => collection(getFirestore(), 'invitations');
const invitationDoc = (token: string) => doc(getFirestore(), 'invitations', token);

export function asTeamInvite(id: string, data: Record<string, unknown> | undefined): TeamInviteRecord {
  return { id, token: id, ...(data || {}) };
}

export async function createTeamInvite(createdBy: string): Promise<TeamInviteRecord & { url: string }> {
  const token = generateInviteToken();
  const expiresAt = new Date(Date.now() + TEAM_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  await setDoc(invitationDoc(token), {
    token,
    teamId: TEAM_INVITE_TEAM_ID,
    role: TEAM_INVITE_ROLE,
    status: 'pending',
    createdBy,
    createdAt: serverTimestamp(),
    expiresAt,
  });
  return {
    id: token,
    token,
    teamId: TEAM_INVITE_TEAM_ID,
    role: TEAM_INVITE_ROLE,
    status: 'pending',
    createdBy,
    expiresAt,
    url: buildInviteHttpsUrl(token),
  };
}

export async function fetchTeamInvite(token: string): Promise<TeamInviteRecord | null> {
  const normalized = normalizeInviteToken(token);
  if (!normalized) return null;
  const snap = await getDoc(invitationDoc(normalized));
  if (!snap.exists()) return null;
  return asTeamInvite(snap.id, snap.data() as Record<string, unknown>);
}

export async function validateTeamInvite(token: string): Promise<TeamInviteRecord> {
  const invite = await fetchTeamInvite(token);
  const reason = inviteFailureReason(invite);
  if (reason || !invite) throw new Error(reason || 'This invite link is not valid.');
  return invite;
}

export async function acceptTeamInvite(token: string, uid: string): Promise<void> {
  const invite = await fetchTeamInvite(token);
  if (!canAcceptInvite(invite) || !invite?.token) {
    throw new Error(inviteFailureReason(invite) || 'This invite link is not valid.');
  }
  if (nextInviteStatus(invite.status, 'accept', invite.expiresAt) !== 'accepted') {
    throw new Error(inviteFailureReason(invite) || 'This invite is no longer available.');
  }
  await updateDoc(invitationDoc(invite.token), {
    status: 'accepted',
    acceptedBy: uid,
    acceptedAt: serverTimestamp(),
  });
}

export async function revokeTeamInvite(token: string): Promise<void> {
  const invite = await fetchTeamInvite(token);
  if (!invite?.token) throw new Error('This invite link is not valid.');
  if (nextInviteStatus(invite.status, 'revoke', invite.expiresAt) !== 'revoked') {
    throw new Error(inviteFailureReason(invite) || 'Only pending invites can be revoked.');
  }
  await updateDoc(invitationDoc(invite.token), { status: 'revoked' });
}

export function subscribePendingTeamInvites(
  onChange: (invites: TeamInviteRecord[]) => void,
  onError: (message: string) => void
): () => void {
  return onSnapshot(
    query(invitationsCol(), where('status', '==', 'pending')),
    snap => {
      const items = (snap?.docs || []).map(docSnap =>
        asTeamInvite(docSnap.id, docSnap.data() as Record<string, unknown>)
      );
      items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      onChange(items);
    },
    err => onError(err?.message || 'Unable to load invitations.')
  );
}
