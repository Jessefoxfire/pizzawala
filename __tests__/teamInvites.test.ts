import {
  buildInviteHttpsUrl,
  buildInviteSchemeUrl,
  canAcceptInvite,
  inviteFailureReason,
  inviteShareMessage,
  nextInviteStatus,
  normalizeInviteToken,
  parseInviteTokenFromUrl,
} from '../src/utils/teamInvites';

const token = 'a'.repeat(64);

describe('teamInvites', () => {
  it('parses invite tokens from https, custom-scheme, and pasted values', () => {
    expect(parseInviteTokenFromUrl(`https://pizzawala-admin.vercel.app/invite?invite=${token}`)).toBe(token);
    expect(parseInviteTokenFromUrl(`pizzawala://invite?invite=${token}`)).toBe(token);
    expect(parseInviteTokenFromUrl(`https://pizzawala-admin.vercel.app/invite/${token}`)).toBe(token);
    expect(parseInviteTokenFromUrl(token.toUpperCase())).toBe(token);
    expect(parseInviteTokenFromUrl('https://example.com/nope')).toBeNull();
    expect(normalizeInviteToken(' short ')).toBeNull();
  });

  it('builds shareable https and scheme URLs without granting admin', () => {
    expect(buildInviteHttpsUrl(token)).toBe(`https://pizzawala-admin.vercel.app/invite?invite=${token}`);
    expect(buildInviteSchemeUrl(token)).toBe(`pizzawala://invite?invite=${token}`);
    expect(inviteShareMessage(token)).toContain(token);
    expect(inviteShareMessage(token)).toContain('Pizza Wala');
  });

  it('accepts only unused pending invites that have not expired', () => {
    const pending = {
      token,
      teamId: 'team-1',
      role: 'member',
      status: 'pending' as const,
      expiresAt: Date.now() + 60_000,
    };
    expect(canAcceptInvite(pending)).toBe(true);
    expect(nextInviteStatus('pending', 'accept', pending.expiresAt)).toBe('accepted');
    expect(inviteFailureReason({ ...pending, status: 'accepted' })).toMatch(/already been used/i);
    expect(inviteFailureReason({ ...pending, status: 'revoked' })).toMatch(/revoked/i);
    expect(inviteFailureReason({ ...pending, expiresAt: Date.now() - 1000 })).toMatch(/expired/i);
    expect(inviteFailureReason({ ...pending, role: 'admin' })).toMatch(/role/i);
    expect(nextInviteStatus('accepted', 'accept', pending.expiresAt)).toBeNull();
    expect(nextInviteStatus('pending', 'revoke', pending.expiresAt)).toBe('revoked');
    expect(nextInviteStatus('revoked', 'revoke', pending.expiresAt)).toBeNull();
    expect(nextInviteStatus('pending', 'accept', Date.now() - 1)).toBeNull();
  });
});
