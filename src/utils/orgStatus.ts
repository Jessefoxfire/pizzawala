import { getEventEndDate, type EventLike } from './eventDays';

export type OrgStatusFields = {
  orgActive?: boolean | null;
  orgActiveLastAutoKey?: string | null;
  name?: string | null;
  email?: string | null;
  emailLower?: string | null;
};

export function localDateKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Missing `orgActive` means Active. Do not treat `disabled` as org status. */
export function isOrgActive(user?: OrgStatusFields | null): boolean {
  return user?.orgActive !== false;
}

export function orgStatusLabel(user?: OrgStatusFields | null): string | null {
  return isOrgActive(user) ? null : 'Inactive';
}

export function employeeSortName(user: {
  name?: string | null;
  email?: string | null;
  emailLower?: string | null;
  userName?: string | null;
}): string {
  return String(user.name || user.userName || user.emailLower || user.email || '').toLowerCase();
}

/** Keeps the incoming relative order inside Active, then Inactive. */
export function sortByOrgActivePreserving<T>(items: T[], active: (item: T) => boolean): T[] {
  const live: T[] = [];
  const inactive: T[] = [];
  items.forEach(item => {
    if (active(item)) live.push(item);
    else inactive.push(item);
  });
  return [...live, ...inactive];
}

export function sortEmployeesByOrgActive<T extends OrgStatusFields>(
  items: T[],
  nameOf: (item: T) => string = employeeSortName
): T[] {
  const byName = [...items].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  return sortByOrgActivePreserving(byName, isOrgActive);
}

export function isCurrentOrUpcomingDate(dateKey?: string | null, today = localDateKey()): boolean {
  const key = String(dateKey || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && key >= today;
}

export function isCurrentOrUpcomingEvent(event?: EventLike | null, today = localDateKey()): boolean {
  if (!event) return false;
  const end = getEventEndDate(event);
  return isCurrentOrUpcomingDate(end, today);
}

export function shiftAssignAutoKey(userId: string, dateKeys: string[], today = localDateKey()): string {
  const dates = dateKeys.filter(dateKey => isCurrentOrUpcomingDate(dateKey, today)).sort();
  return `shift-assign:${userId}:${dates.join(',')}`;
}

export function eventAssignAutoKey(eventId: string, userId: string, nonce: string): string {
  return `event-assign:${eventId}:${userId}:${nonce}`;
}

export function eventAcceptAutoKey(eventId: string, userId: string): string {
  return `event-accept:${eventId}:${userId}`;
}

/**
 * Apply automatic activation only for a new qualifying key.
 * Repeating the same key must not override a later manual Inactive.
 */
export function shouldApplyOrgActivation(user: OrgStatusFields | undefined | null, autoKey: string): boolean {
  const key = String(autoKey || '').trim();
  if (!key) return false;
  return user?.orgActiveLastAutoKey !== key;
}

export function orgActivationWrite(autoKey: string): { orgActive: true; orgActiveLastAutoKey: string } {
  return { orgActive: true, orgActiveLastAutoKey: autoKey };
}

export function orgActiveManualWrite(nextActive: boolean): { orgActive: boolean } {
  return { orgActive: nextActive };
}
