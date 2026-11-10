import { MEMBER_ROLE } from './teamRoles';

export const TEAM_INVITE_TEAM_ID = 'team-1';
export const TEAM_INVITE_ROLE = MEMBER_ROLE;
export const TEAM_INVITE_TTL_DAYS = 14;
export const TEAM_INVITE_HTTPS_ORIGIN = 'https://pizzawala-admin.vercel.app';
export const TEAM_INVITE_SCHEME = 'pizzawala';
export type TeamInviteStatus = 'pending' | 'accepted' | 'revoked';

export type TeamInviteRecord = {
  id?: string;
  token?: string;
  teamId?: string;
  role?: string;
  status?: TeamInviteStatus | string;
  createdBy?: string;
  createdAt?: unknown;
  expiresAt?: unknown;
  acceptedBy?: string | null;
  acceptedAt?: unknown;
};

export function generateInviteToken(): string {
  const bytes = new Uint8Array(32);
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new Error('Secure random generator is unavailable.');
  }
  cryptoObj.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function isInviteToken(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^[a-f0-9]{32,}$/i.test(value.trim());
}

export function normalizeInviteToken(value: string | null | undefined): string | null {
  if (!isInviteToken(value)) return null;
  return String(value).trim().toLowerCase();
}

export function buildInviteHttpsUrl(token: string): string {
  return `${TEAM_INVITE_HTTPS_ORIGIN}/invite?invite=${encodeURIComponent(token)}`;
}

export function buildInviteSchemeUrl(token: string): string {
  return `${TEAM_INVITE_SCHEME}://invite?invite=${encodeURIComponent(token)}`;
}

export function inviteShareMessage(token: string): string {
  const url = buildInviteHttpsUrl(token);
  return [
    "You're invited to join the Pizza Wala team.",
    'Open this link on your phone after installing Pizza Wala:',
    url,
    '',
    'If the link does not open the app, open Pizza Wala, tap Create Account, and enter this invite code:',
    token,
  ].join('\n');
}

export function parseInviteTokenFromUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  const direct = normalizeInviteToken(trimmed);
  if (direct) return direct;

  const queryMatch = trimmed.match(/[?&#](?:invite|token)=([a-f0-9]{32,})/i);
  if (queryMatch) return normalizeInviteToken(queryMatch[1]);

  try {
    const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed.replace(/^pizzawala:\/\//i, 'https://pizzawala.local/')
      : `https://pizzawala.local/${trimmed.replace(/^\/+/, '')}`;
    const parsed = new URL(normalized);
    const fromQuery = parsed.searchParams.get('invite') || parsed.searchParams.get('token');
    const queryToken = normalizeInviteToken(fromQuery);
    if (queryToken) return queryToken;

    const parts = parsed.pathname.split('/').filter(Boolean);
    const inviteIndex = parts.findIndex(part => part.toLowerCase() === 'invite');
    if (inviteIndex >= 0) {
      const pathToken = normalizeInviteToken(parts[inviteIndex + 1]);
      if (pathToken) return pathToken;
    }
  } catch {
    // Fall through to null when the URL cannot be parsed.
  }

  return null;
}

export function toExpiryMs(expiresAt: unknown): number | null {
  if (expiresAt == null) return null;
  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) {
    return expiresAt < 1e12 ? expiresAt * 1000 : expiresAt;
  }
  if (expiresAt instanceof Date) {
    const time = expiresAt.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof expiresAt === 'object') {
    const stamp = expiresAt as { toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof stamp.toDate === 'function') {
      const time = stamp.toDate().getTime();
      return Number.isNaN(time) ? null : time;
    }
    const seconds = typeof stamp.seconds === 'number' ? stamp.seconds : stamp._seconds;
    if (typeof seconds === 'number') return seconds * 1000;
  }
  const parsed = Date.parse(String(expiresAt));
  return Number.isNaN(parsed) ? null : parsed;
}

export function inviteFailureReason(invite: TeamInviteRecord | null | undefined, now = Date.now()): string | null {
  if (!invite || !normalizeInviteToken(invite.token || invite.id)) {
    return 'This invite link is not valid.';
  }
  if (invite.teamId && invite.teamId !== TEAM_INVITE_TEAM_ID) {
    return 'This invite is not for the Pizza Wala team.';
  }
  if (invite.role && invite.role !== TEAM_INVITE_ROLE) {
    return 'This invite cannot grant that role.';
  }
  if (invite.status === 'revoked') return 'This invite has been revoked.';
  if (invite.status === 'accepted') return 'This invite has already been used.';
  if (invite.status && invite.status !== 'pending') return 'This invite is no longer available.';
  const expiry = toExpiryMs(invite.expiresAt);
  if (expiry != null && expiry <= now) return 'This invite has expired.';
  return null;
}

export function canAcceptInvite(invite: TeamInviteRecord | null | undefined, now = Date.now()): boolean {
  return inviteFailureReason(invite, now) === null;
}

export function nextInviteStatus(
  current: TeamInviteStatus | string | undefined,
  action: 'accept' | 'revoke',
  expiresAt?: unknown,
  now = Date.now()
): TeamInviteStatus | null {
  if (current !== 'pending') return null;
  if (action === 'revoke') return 'revoked';
  const expiry = toExpiryMs(expiresAt);
  if (expiry != null && expiry <= now) return null;
  return 'accepted';
}

