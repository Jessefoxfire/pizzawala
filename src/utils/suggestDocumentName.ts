export type DocumentNameSource = 'camera' | 'library' | 'document' | 'scan';

export type SuggestDocumentNameInput = {
  requiredDocumentType?: string | null;
  originalFileName?: string | null;
  source: DocumentNameSource;
};

function formatTodayLabel() {
  return new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function stripExtension(fileName: string) {
  return fileName.replace(/\.[a-z0-9]+$/i, '').trim();
}

function cleanOriginalBaseName(fileName: string): string | null {
  const base = stripExtension(fileName.replace(/^.*[/\\]/, '').trim());
  if (!base) return null;
  if (/^screenshot[_-]/i.test(base)) return null;
  if (/^hygiene-photo-/i.test(base)) return null;
  if (/^img[_-]\d+/i.test(base)) return null;
  const cleaned = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length >= 3 ? cleaned : null;
}

export function suggestDocumentName(input: SuggestDocumentNameInput): string {
  const requiredType = String(input.requiredDocumentType || '').trim();
  if (requiredType) {
    return `${requiredType} · ${formatTodayLabel()}`;
  }

  if (input.source === 'camera' || input.source === 'scan') {
    return `Hygiene photo · ${formatTodayLabel()}`;
  }

  const cleaned = cleanOriginalBaseName(String(input.originalFileName || ''));
  if (cleaned) return cleaned;

  if (input.source === 'document') {
    return `Document · ${formatTodayLabel()}`;
  }

  return `Hygiene card · ${formatTodayLabel()}`;
}

export function getDocumentExtension(fileName: string, mimeType?: string | null) {
  const match = fileName.match(/(\.[a-z0-9]+)$/i);
  if (match) return match[1].toLowerCase();

  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('pdf')) return '.pdf';
  if (mime.includes('png')) return '.png';
  if (mime.includes('heic')) return '.heic';
  if (mime.includes('heif')) return '.heif';
  if (mime.includes('webp')) return '.webp';
  return '.jpg';
}

export function finalizeDocumentFileName(displayName: string, extension: string) {
  const trimmed = displayName.trim().slice(0, 120);
  if (!trimmed) {
    throw new Error('Document name is required.');
  }

  const ext = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  const withoutExt = stripExtension(trimmed);
  return `${withoutExt}${ext}`;
}

export function isImageDocument(fileName: string, mimeType?: string | null) {
  if (/\.(png|jpe?g|heic|heif|webp)$/i.test(fileName)) return true;
  const mime = String(mimeType || '').toLowerCase();
  return mime.startsWith('image/');
}
