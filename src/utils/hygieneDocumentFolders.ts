export const HYGIENE_DOCUMENT_FOLDERS = [
  { key: 'hygiene_cards', label: 'Employee Hygiene Cards' },
  { key: 'belehrung', label: 'Recurring Education' },
  { key: 'other', label: 'Other' },
] as const;

export type HygieneDocumentFolderKey = string;

function normalizeDocToken(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_]+/g, '-')
    .replace(/\s+/g, ' ');
}

export function isHygieneDocumentFolder(value: unknown): value is HygieneDocumentFolderKey {
  const key = String(value || '').trim();
  return HYGIENE_DOCUMENT_FOLDERS.some(folder => folder.key === key);
}

export function hygieneDocumentFolderLabel(key: HygieneDocumentFolderKey) {
  return HYGIENE_DOCUMENT_FOLDERS.find(folder => folder.key === key)?.label || key;
}

function isBelehrungToken(value: unknown) {
  const text = normalizeDocToken(value);
  if (!text) return false;
  if (text.includes('belehrung')) return true;
  if (text.includes('instruction-nachweis') || text.includes('instruction nachweis')) return true;
  if (text === 'instruction' || text === 'instructions') return true;
  return false;
}

function isHygieneCardToken(value: unknown) {
  const text = normalizeDocToken(value);
  if (!text) return false;
  if (text === 'hygiene_cards' || text === 'hygiene-cards' || text === 'hygiene cards') return true;
  if (text === 'hygiene_card' || text === 'hygiene-card' || text === 'hygiene card') return true;
  if (text.includes('hygiene card') || text.includes('hygiene-card')) return true;
  if (text.includes('employee hygiene')) return true;
  return false;
}

export function inferHygieneDocumentFolder(item: {
  folder?: string | null;
  documentFolder?: string | null;
  documentCategory?: string | null;
  requiredDocumentType?: string | null;
  fileName?: string | null;
}): HygieneDocumentFolderKey {
  const stored = String(item.folder || item.documentFolder || '').trim();
  if (stored) return stored;

  if (
    isBelehrungToken(stored) ||
    isBelehrungToken(item.documentCategory) ||
    isBelehrungToken(item.requiredDocumentType) ||
    isBelehrungToken(item.fileName)
  ) {
    return 'belehrung';
  }

  if (
    isHygieneCardToken(stored) ||
    isHygieneCardToken(item.documentCategory) ||
    isHygieneCardToken(item.requiredDocumentType)
  ) {
    return 'hygiene_cards';
  }

  const requiredType = String(item.requiredDocumentType || '').trim();
  const category = String(item.documentCategory || '').trim();
  if (!requiredType && (!category || category === 'hygiene_card')) {
    return 'hygiene_cards';
  }

  return 'other';
}

export function credentialsInFolder<T extends Parameters<typeof inferHygieneDocumentFolder>[0]>(
  items: T[],
  folder: HygieneDocumentFolderKey
) {
  return items.filter(item => inferHygieneDocumentFolder(item) === folder);
}
