import { Alert, Platform } from 'react-native';
import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
  types,
  type DocumentPickerResponse,
} from '@react-native-documents/picker';
import {
  hygieneMimeForUpload,
  uploadHygieneCredential,
  type HygieneActor,
} from '../services/hygiene';
import { ensureImagePickerPermission } from './imagePickerPermissions';
import { pickPreparedHygienePhoto } from './prepareUploadImage';
import { applyAiDocumentFix, scanDocumentWithAi } from './documentAiEnhance';
import {
  finalizeDocumentFileName,
  getDocumentExtension,
  isImageDocument,
  type DocumentNameSource,
} from './suggestDocumentName';

export type HygieneEmployeeOverride = Partial<HygieneActor> & {
  userId: string;
  userName: string;
  userEmail: string;
};

export type HygieneUploadOptions = {
  requiredDocumentType?: string | null;
  documentCategory?: string | null;
};

export type HygieneCredentialDraft = {
  localUri: string;
  originalFileName: string;
  mimeType: string;
  extension: string;
  source: DocumentNameSource;
  previewUri?: string | null;
};

function sanitizePickedName(file: DocumentPickerResponse) {
  const raw = (file.name || 'hygiene-document').replace(/^.*[/\\]/, '').trim();
  return raw || 'hygiene-document';
}

async function materializePickedFile(file: DocumentPickerResponse) {
  if (!file.uri) {
    throw new Error('No file URI returned.');
  }
  if (file.uri.startsWith('file://')) {
    return file.uri;
  }

  const fileName = sanitizePickedName(file);
  const mimeType = hygieneMimeForUpload(fileName, typeof file.type === 'string' ? file.type : null);
  const [copy] = await keepLocalCopy({
    destination: 'cachesDirectory',
    files: [{ uri: file.uri, fileName, convertVirtualFileToType: mimeType }],
  });
  if (copy.status !== 'success') {
    throw new Error(copy.copyError || 'Could not copy file locally.');
  }
  return copy.localUri;
}

function buildDraft(
  localUri: string,
  originalFileName: string,
  mimeType: string,
  source: DocumentNameSource
): HygieneCredentialDraft {
  const extension = getDocumentExtension(originalFileName, mimeType);
  return {
    localUri,
    originalFileName,
    mimeType,
    extension,
    source,
    previewUri: isImageDocument(originalFileName, mimeType) ? localUri : null,
  };
}

export function promptHygieneUploadSource(): Promise<DocumentNameSource | null> {
  return new Promise(resolve => {
    Alert.alert(
      'Upload document',
      'Photos are AI-enhanced automatically: crop, straighten, and colour correct.',
      [
        { text: 'Scan document (AI)', onPress: () => resolve('scan') },
        { text: 'Photo library', onPress: () => resolve('library') },
        { text: 'Take photo', onPress: () => resolve('camera') },
        { text: 'Choose file', onPress: () => resolve('document') },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ]
    );
  });
}

async function pickScanDraft() {
  const scanned = await scanDocumentWithAi();
  if (!scanned) return null;
  return buildDraft(scanned.localUri, scanned.originalFileName, scanned.mimeType, 'scan');
}

async function pickPhotoDraft(source: 'library' | 'camera') {
  const hasPermission = await ensureImagePickerPermission(source === 'camera' ? 'camera' : 'library');
  if (!hasPermission) {
    throw new Error('Camera permission is required to take a photo.');
  }

  const prepared = await pickPreparedHygienePhoto(source);
  if (!prepared) return null;

  const enhanced = await applyAiDocumentFix(
    prepared.localUri,
    prepared.originalFileName,
    prepared.mimeType
  );

  return buildDraft(enhanced.localUri, enhanced.originalFileName, enhanced.mimeType, source);
}

async function pickDocumentDraft() {
  const result = await pick({
    type: [types.pdf, types.images],
    allowMultiSelection: false,
    ...(Platform.OS === 'android' ? { allowVirtualFiles: true } : {}),
  });
  const file = result[0];
  const localUri = await materializePickedFile(file);
  const originalFileName = sanitizePickedName(file);
  const mimeType = hygieneMimeForUpload(originalFileName, typeof file.type === 'string' ? file.type : null);

  if (isImageDocument(originalFileName, mimeType)) {
    const enhanced = await applyAiDocumentFix(localUri, originalFileName, mimeType, {
      allowManualCropFallback: true,
    });
    return buildDraft(enhanced.localUri, enhanced.originalFileName, enhanced.mimeType, 'document');
  }

  return buildDraft(localUri, originalFileName, mimeType, 'document');
}

/** Pick a file only; name confirmation happens before upload. */
export async function pickHygieneCredentialDraft(_uploadOptions?: HygieneUploadOptions) {
  const source = await promptHygieneUploadSource();
  if (!source) return null;

  try {
    if (source === 'scan') {
      return pickScanDraft();
    }
    if (source === 'library' || source === 'camera') {
      return pickPhotoDraft(source);
    }
    return pickDocumentDraft();
  } catch (error: any) {
    if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED) {
      return null;
    }
    throw error;
  }
}

export async function uploadHygieneCredentialDraft(
  draft: HygieneCredentialDraft,
  displayName: string,
  employeeOverride?: HygieneEmployeeOverride,
  uploadOptions?: HygieneUploadOptions
) {
  const fileName = finalizeDocumentFileName(displayName, draft.extension);
  return uploadHygieneCredential(
    { localUri: draft.localUri, fileName, mimeType: draft.mimeType },
    employeeOverride,
    uploadOptions
  );
}
