export const ADMIN_ROLE = 'admin';
export const MEMBER_ROLE = 'member';

export const LAST_ADMIN_NOTICE = 'The team must keep at least one admin.';

export type RoleHolder = {
  id: string;
  roles?: string[] | null;
  disabled?: boolean;
};

export function hasAdminRole(roles?: string[] | null): boolean {
  return Array.isArray(roles) && roles.includes(ADMIN_ROLE);
}

export function roleLabel(roles?: string[] | null, disabled?: boolean): string {
  const role = hasAdminRole(roles) ? 'Admin' : 'Member';
  return disabled ? `${role} • Disabled` : role;
}

export function isActiveAdmin(user: RoleHolder): boolean {
  return hasAdminRole(user.roles) && user.disabled !== true;
}

export function countActiveAdmins(users: RoleHolder[]): number {
  return users.filter(isActiveAdmin).length;
}

export function withAdminRole(roles: string[] | undefined, grantAdmin: boolean): string[] {
  const current = Array.isArray(roles) ? roles : [];
  if (grantAdmin) {
    return Array.from(new Set([...current, ADMIN_ROLE]));
  }
  return current.filter(role => role !== ADMIN_ROLE);
}

/** True when the proposed change would leave the team with no active admin. */
export function wouldLeaveNoActiveAdmin(
  members: RoleHolder[],
  targetId: string,
  change: { grantAdmin?: boolean; disabled?: boolean }
): boolean {
  const remaining = members.filter(member => {
    const isTarget = member.id === targetId;
    const admin = isTarget ? (change.grantAdmin ?? hasAdminRole(member.roles)) : hasAdminRole(member.roles);
    const disabled = isTarget ? (change.disabled ?? Boolean(member.disabled)) : Boolean(member.disabled);
    return admin && !disabled;
  });
  return remaining.length === 0;
}
