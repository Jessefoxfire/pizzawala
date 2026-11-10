import {
  countActiveAdmins,
  hasAdminRole,
  isActiveAdmin,
  LAST_ADMIN_NOTICE,
  roleLabel,
  withAdminRole,
  wouldLeaveNoActiveAdmin,
} from '../src/utils/teamRoles';

const admin = { id: 'a1', roles: ['admin'] };
const secondAdmin = { id: 'a2', roles: ['admin', 'member'] };
const member = { id: 'm1', roles: ['member'] };
const disabledAdmin = { id: 'a3', roles: ['admin'], disabled: true };

describe('teamRoles', () => {
  it('treats only the admin role flag as admin', () => {
    expect(hasAdminRole(['admin'])).toBe(true);
    expect(hasAdminRole(['member'])).toBe(false);
    expect(hasAdminRole([])).toBe(false);
    expect(hasAdminRole(undefined)).toBe(false);
  });

  it('ignores disabled admins when counting active admins', () => {
    expect(isActiveAdmin(admin)).toBe(true);
    expect(isActiveAdmin(disabledAdmin)).toBe(false);
    expect(isActiveAdmin(member)).toBe(false);
    expect(countActiveAdmins([admin, secondAdmin, member, disabledAdmin])).toBe(2);
  });

  it('labels existing roles without inventing new ones', () => {
    expect(roleLabel(['admin'])).toBe('Admin');
    expect(roleLabel(['member'], true)).toBe('Member • Disabled');
    expect(LAST_ADMIN_NOTICE).toContain('one admin');
  });

  it('adds or removes admin using the existing roles array', () => {
    expect(withAdminRole(['member'], true)).toEqual(['member', 'admin']);
    expect(withAdminRole(['admin', 'member'], false)).toEqual(['member']);
    expect(withAdminRole(undefined, true)).toEqual(['admin']);
  });

  it('blocks demoting or disabling the last active admin', () => {
    const team = [admin, member, disabledAdmin];
    expect(wouldLeaveNoActiveAdmin(team, 'a1', { grantAdmin: false })).toBe(true);
    expect(wouldLeaveNoActiveAdmin(team, 'a1', { disabled: true })).toBe(true);
  });

  it('allows demoting or disabling an admin when another remains', () => {
    const team = [admin, secondAdmin, member];
    expect(wouldLeaveNoActiveAdmin(team, 'a1', { grantAdmin: false })).toBe(false);
    expect(wouldLeaveNoActiveAdmin(team, 'a1', { disabled: true })).toBe(false);
  });

  it('allows disabling a member and restoring a disabled admin', () => {
    const team = [admin, member, disabledAdmin];
    expect(wouldLeaveNoActiveAdmin(team, 'm1', { disabled: true })).toBe(false);
    expect(wouldLeaveNoActiveAdmin(team, 'a3', { disabled: false })).toBe(false);
  });
});
