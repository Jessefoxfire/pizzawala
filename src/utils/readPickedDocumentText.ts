import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { keepLocalCopy, type DocumentPickerResponse } from '@react-native-documents/picker';

function safeFileName(file: DocumentPickerResponse): string {
  const raw = (file.name || 'import.csv').replace(/^.*[/\\]/, '').trim() || 'import.csv';
  return raw;
}

/** Strip `file://` and decode (spaces etc.) for native file reads. */
function toFilesystemPath(uri: string): string {
  if (uri.startsWith('file://')) {
    try {
      return decodeURIComponent(uri.replace(/^file:\/\//, ''));
    } catch {
      return uri.replace(/^file:\/\//, '');
    }
  }
  return uri;
}

function readUriAsTextXHR(uri: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 0) {
        resolve(String(xhr.responseText ?? ''));
        return;
      }
      reject(new Error(`Could not read file (status ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error('Network request failed'));
    xhr.open('GET', uri, true);
    xhr.responseType = 'text';
    xhr.send();
  });
}

/**
 * Read UTF-8 bytes from a local or remote URI. RN `fetch`/`XHR` on `file://` often throws
 * "Network request failed"; {@link RNFS.readFile} uses the native filesystem.
 */
async function readUriAsText(uri: string): Promise<string> {
  if (/^https?:\/\//i.test(uri)) {
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`Could not read file (HTTP ${res.status}).`);
    return res.text();
  }

  const path = toFilesystemPath(uri);
  try {
    return await RNFS.readFile(path, 'utf8');
  } catch (err) {
    try {
      return await readUriAsTextXHR(uri);
    } catch {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}

async function materializeToCache(
  file: DocumentPickerResponse,
  uri: string,
  convertVirtualFileToType?: string
): Promise<string> {
  const fileName = safeFileName(file);
  const [copy] = await keepLocalCopy({
    destination: 'cachesDirectory',
    files: [{ uri, fileName, ...(convertVirtualFileToType ? { convertVirtualFileToType } : {}) }],
  });
  if (copy.status !== 'success') {
    throw new Error(copy.copyError || 'Could not copy file for import.');
  }
  return copy.localUri;
}

/**
 * Read UTF-8 text from a document-picker result.
 * - Android `content://`: copy to cache first, then {@link RNFS.readFile}.
 * - Android virtual (Drive, etc.): export via `convertVirtualFileToType`, then read file.
 * - iOS: {@link RNFS.readFile} on picked `file://`; on failure, copy to cache and read again.
 */
export async function readPickedFileAsUtf8(file: DocumentPickerResponse): Promise<string> {
  if (file.error) {
    throw new Error(file.error);
  }

  const uri = file.uri;
  if (!uri) {
    throw new Error('No file URI returned.');
  }

  if (Platform.OS === 'android' && file.isVirtual === true && file.convertibleToMimeTypes?.length) {
    const pickMime =
      file.convertibleToMimeTypes.find(m => /csv|comma-separated|plain|text/i.test(m.mimeType)) ??
      file.convertibleToMimeTypes[0];
    const localUri = await materializeToCache(file, uri, pickMime.mimeType);
    return readUriAsText(localUri);
  }

  if (Platform.OS === 'android' && uri.startsWith('content://')) {
    const localUri = await materializeToCache(file, uri);
    return readUriAsText(localUri);
  }

  try {
    let text = await readUriAsText(uri);
    if (Platform.OS === 'ios' && text.trim().length === 0) {
      const localUri = await materializeToCache(file, uri);
      text = await readUriAsText(localUri);
    }
    return text;
  } catch {
    const localUri = await materializeToCache(file, uri);
    return readUriAsText(localUri);
  }
}
