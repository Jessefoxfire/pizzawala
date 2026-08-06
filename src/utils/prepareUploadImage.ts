import ImagePicker from 'react-native-image-crop-picker';

const PICK_OPTIONS = {
  mediaType: 'photo' as const,
  cropping: false,
  includeBase64: false,
  compressImageQuality: 0.92,
  compressImageMaxWidth: 2600,
  compressImageMaxHeight: 2600,
  forceJpg: true,
};

const CROP_OPTIONS = {
  mediaType: 'photo' as const,
  cropping: true,
  freeStyleCropEnabled: true,
  includeBase64: false,
  compressImageQuality: 0.85,
  compressImageMaxWidth: 2400,
  compressImageMaxHeight: 2400,
  forceJpg: true,
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

export type PreparedUploadImage = {
  localUri: string;
  originalFileName: string;
  mimeType: string;
};

export async function pickPreparedHygienePhoto(
  source: 'library' | 'camera'
): Promise<PreparedUploadImage | null> {
  try {
    const image =
      source === 'camera'
        ? await ImagePicker.openCamera(PICK_OPTIONS)
        : await ImagePicker.openPicker(PICK_OPTIONS);

    const localUri = normalizeUri(image.path);
    const mimeType = image.mime || 'image/jpeg';
    const originalFileName =
      image.filename || `hygiene-photo-${Date.now()}.${mimeType.includes('png') ? 'png' : 'jpg'}`;

    return { localUri, originalFileName, mimeType };
  } catch (error) {
    if (isPickerCancelled(error)) return null;
    throw error;
  }
}

export async function cropPreparedHygienePhoto(localUri: string): Promise<PreparedUploadImage | null> {
  try {
    const image = await ImagePicker.openCropper({
      ...CROP_OPTIONS,
      path: normalizePath(localUri),
    });

    const croppedUri = normalizeUri(image.path);
    const mimeType = image.mime || 'image/jpeg';
    const originalFileName =
      image.filename || `hygiene-photo-${Date.now()}.${mimeType.includes('png') ? 'png' : 'jpg'}`;

    return { localUri: croppedUri, originalFileName, mimeType };
  } catch (error) {
    if (isPickerCancelled(error)) return null;
    throw error;
  }
}
