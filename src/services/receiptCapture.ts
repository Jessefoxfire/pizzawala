import { Platform } from 'react-native';
import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
  types,
  type DocumentPickerResponse,
} from '@react-native-documents/picker';
import { applyAiDocumentFix } from '../utils/documentAiEnhance';
import { ensureImagePickerPermission } from '../utils/imagePickerPermissions';
import { pickPreparedHygienePhoto, cropPreparedHygienePhoto, type PreparedUploadImage } from '../utils/prepareUploadImage';
import { scanReceiptDocument } from './receiptScanner';

export type LocalReceiptPage = {
  localUri: string;
  fileName: string;
  mimeType: string;
};

function pageFromPrepared(prepared: PreparedUploadImage): LocalReceiptPage {
  return {
    localUri: prepared.localUri,
    fileName: prepared.originalFileName,
    mimeType: prepared.mimeType,
  };
}

export function isPdfPage(page: { mimeType: string; fileName: string }) {
  return page.mimeType === 'application/pdf' || /\.pdf$/i.test(page.fileName);
}

export function isImagePage(page: { mimeType: string; fileName: string }) {
  return page.mimeType.startsWith('image/') || /\.(png|jpe?g|heic|heif|webp)$/i.test(page.fileName);
}

export async function captureScannedReceipt(maxPages = 10): Promise<LocalReceiptPage[] | null> {
  const images = await scanReceiptDocument(maxPages);
  if (!images?.length) return null;
  return images.map((localUri, index) => ({
    localUri,
    fileName: `receipt-scan-${Date.now()}-${index + 1}.jpg`,
    mimeType: 'image/jpeg',
  }));
}

export async function captureReceiptPhoto(): Promise<LocalReceiptPage | null> {
  if (!(await ensureImagePickerPermission('library'))) {
    throw new Error('Photo library permission is required.');
  }
  const prepared = await pickPreparedHygienePhoto('library');
  if (!prepared) return null;
  const enhanced = await applyAiDocumentFix(prepared.localUri, prepared.originalFileName, prepared.mimeType);
  return pageFromPrepared(enhanced);
}

async function materializePickedFile(file: DocumentPickerResponse) {
  if (!file.uri) throw new Error('No file URI returned.');
  if (file.uri.startsWith('file://')) return file.uri;
  const fileName = (file.name || 'receipt').replace(/^.*[/\\]/, '').trim() || 'receipt';
  const [copy] = await keepLocalCopy({
    destination: 'cachesDirectory',
    files: [{ uri: file.uri, fileName, convertVirtualFileToType: file.type || undefined }],
  });
  if (copy.status !== 'success') throw new Error(copy.copyError || 'Could not copy the file.');
  return copy.localUri;
}

export async function captureReceiptDocument(): Promise<LocalReceiptPage | null> {
  try {
    const result = await pick({
      type: [types.pdf, types.images],
      allowMultiSelection: false,
      ...(Platform.OS === 'android' ? { allowVirtualFiles: true } : {}),
    });
    const file = result[0];
    const localUri = await materializePickedFile(file);
    const fileName = (file.name || 'receipt').replace(/^.*[/\\]/, '').trim() || 'receipt';
    const mimeType = file.type || (/\.pdf$/i.test(fileName) ? 'application/pdf' : 'image/jpeg');
    const page = { localUri, fileName, mimeType };
    if (!isImagePage(page)) return page;
    const enhanced = await applyAiDocumentFix(localUri, fileName, mimeType);
    return pageFromPrepared(enhanced);
  } catch (error) {
    if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED) return null;
    throw error;
  }
}

export async function adjustReceiptCrop(page: LocalReceiptPage): Promise<LocalReceiptPage | null> {
  const cropped = await cropPreparedHygienePhoto(page.localUri);
  if (!cropped) return null;
  return pageFromPrepared(cropped);
}
