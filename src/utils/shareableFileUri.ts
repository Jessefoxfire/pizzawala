/** Build a file/content/data URI Android share/open can parse. Never returns an empty URI. */
export function toShareableFileUri(filePath: string): string {
  const trimmed = String(filePath || '').trim();
  if (!trimmed) {
    throw new Error('Missing export file path.');
  }
  if (
    trimmed.startsWith('file://') ||
    trimmed.startsWith('content://') ||
    trimmed.startsWith('data:')
  ) {
    return trimmed;
  }
  const normalized = trimmed.replace(/\\/g, '/');
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
}

export function csvShareErrorMessage(error: unknown): string {
  const raw =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message || '')
      : String(error || '');
  if (/user did not share/i.test(raw)) return '';
  if (/getScheme|null object reference|NullPointerException/i.test(raw)) {
    return 'Could not open the CSV file for download. Please try again.';
  }
  return raw || 'Could not share the CSV file.';
}
