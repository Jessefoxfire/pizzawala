import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import RNFS from 'react-native-fs';
import DocumentScanner from 'react-native-document-scanner-plugin';
import NetInfo from '@react-native-community/netinfo';
import ImagePicker from 'react-native-image-crop-picker';
import type { PreparedUploadImage } from './prepareUploadImage';

const MAX_CLOUD_BYTES = 8 * 1024 * 1024;
const ENHANCE_FUNCTION = 'enhanceDocumentImage';

const CROP_OPTIONS = {
  mediaType: 'photo' as const,
  cropping: true,
  freeStyleCropEnabled: true,
  includeBase64: false,
  compressImageQuality: 0.9,
  compressImageMaxWidth: 2600,
  compressImageMaxHeight: 2600,
  forceJpg: true,
  cropperToolbarTitle: 'Adjust document crop',
  cropperChooseText: 'Use',
  cropperCancelText: 'Cancel',
};

function normalizePath(uri: string) {
  return uri.startsWith('file://') ? uri.replace('file://', '') : uri;
}

function normalizeUri(path: string) {
  if (path.startsWith('file://') || path.startsWith('content://')) return path;
  return `file://${path}`;
}

function isPickerCancelled(error: unknown) {
  const code = String((error as { code?: string })?.code || '');
  return code === 'E_PICKER_CANCELLED' || code === 'E_NO_IMAGE_DATA_FOUND';
}

export function isImageForAiEnhance(fileName: string, mimeType?: string | null) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  return /\.(png|jpe?g|heic|heif|webp)$/i.test(fileName);
}

export async function scanDocumentWithAi(): Promise<PreparedUploadImage | null> {
  const result = await DocumentScanner.scanDocument({
    maxNumDocuments: 1,
    croppedImageQuality: 92,
    letUserAdjustCrop: true,
  });

  if (result.status === 'cancel' || !result.scannedImages?.length) {
    return null;
  }

  const localUri = normalizeUri(result.scannedImages[0]);
  return applyAiDocumentFix(localUri, `document-scan-${Date.now()}.jpg`, 'image/jpeg');
}

async function enhanceViaCloud(localUri: string, originalFileName: string): Promise<PreparedUploadImage | null> {
  const net = await NetInfo.fetch();
  if (!net.isConnected) return null;

  const path = normalizePath(localUri);
  const stat = await RNFS.stat(path);
  if (Number(stat.size) > MAX_CLOUD_BYTES) return null;

  const imageBase64 = await RNFS.readFile(path, 'base64');
  const functions = getFunctions(getApp(), 'us-central1');
  const enhance = httpsCallable<{ imageBase64: string }, { imageBase64: string; mimeType: string }>(
    functions,
    ENHANCE_FUNCTION
  );
  const response = await enhance({ imageBase64 });
  const outBase64 = response.data?.imageBase64;
  if (!outBase64) return null;

  const outPath = `${RNFS.CachesDirectoryPath}/ai-enhanced-${Date.now()}.jpg`;
  await RNFS.writeFile(outPath, outBase64, 'base64');
  return {
    localUri: normalizeUri(outPath),
    originalFileName: originalFileName.replace(/\.[^.]+$/, '.jpg') || `document-${Date.now()}.jpg`,
    mimeType: response.data.mimeType || 'image/jpeg',
  };
}

async function enhanceLocally(localUri: string, originalFileName: string): Promise<PreparedUploadImage | null> {
  try {
    const image = await ImagePicker.openCropper({
      ...CROP_OPTIONS,
      path: normalizePath(localUri),
    });
    return {
      localUri: normalizeUri(image.path),
      originalFileName: image.filename || originalFileName,
      mimeType: image.mime || 'image/jpeg',
    };
  } catch (error) {
    if (isPickerCancelled(error)) return null;
    throw error;
  }
}

/** Auto crop / colour correct via cloud AI, with scanner/manual fallbacks. */
export async function applyAiDocumentFix(
  localUri: string,
  originalFileName: string,
  mimeType: string,
  options?: { allowManualCropFallback?: boolean }
): Promise<PreparedUploadImage> {
  const base = { localUri, originalFileName, mimeType };
  if (!isImageForAiEnhance(originalFileName, mimeType)) {
    return base;
  }

  try {
    const cloud = await enhanceViaCloud(localUri, originalFileName);
    if (cloud) return cloud;
  } catch (error) {
    console.warn('Cloud AI document fix failed:', error);
  }

  if (options?.allowManualCropFallback) {
    const manual = await enhanceLocally(localUri, originalFileName);
    if (manual) return manual;
  }

  return base;
}

export async function rerunAiDocumentFix(
  localUri: string,
  originalFileName: string,
  mimeType: string
): Promise<PreparedUploadImage | null> {
  if (!isImageForAiEnhance(originalFileName, mimeType)) return null;
  const enhanced = await applyAiDocumentFix(localUri, originalFileName, mimeType, {
    allowManualCropFallback: true,
  });
  return enhanced.localUri === localUri ? null : enhanced;
}
