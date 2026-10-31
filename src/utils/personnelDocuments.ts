/**
 * Documents assigned to a user are kept in the legacy shared collection, but
 * must only be presented through Member → Documents. Hygiene uploads do not
 * carry either of these personnel markers.
 */
export function isPersonnelDocument(item: unknown) {
  const value = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
  return (
    String(value.documentCategory || '').trim() === 'required_user_document' ||
    String(value.requiredDocumentType || '').trim().length > 0
  );
}

export function documentTeamId(item: unknown, fallback = 'team-1') {
  const value = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
  return String(value.teamId || '').trim() || fallback;
}

/** Hygiene uploads are shared across every client of the same team. Identity documents stay on the owner's Documents screen. */
export function isSharedTeamHygieneDocument(item: unknown, teamId: string) {
  if (isPersonnelDocument(item)) return false;
  return documentTeamId(item) === (teamId.trim() || 'team-1');
}
