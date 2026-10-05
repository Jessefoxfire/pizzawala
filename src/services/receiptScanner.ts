import DocumentScanner, {
  ResponseType,
  ScanDocumentResponseStatus,
} from 'react-native-document-scanner-plugin';

const MAX_PAGES = 10;

function normalizeUri(path: string) {
  if (path.startsWith('file://') || path.startsWith('content://')) return path;
  return `file://${path}`;
}

/**
 * Opens the Android ML Kit / iOS VisionKit document scanner.
 * The native scanner detects edges, crops, corrects perspective, and enhances the page.
 */
export async function scanReceiptDocument(maxNumDocuments = MAX_PAGES): Promise<string[] | null> {
  const result = await DocumentScanner.scanDocument({
    maxNumDocuments,
    croppedImageQuality: 95,
    responseType: ResponseType.ImageFilePath,
  });
  if (result.status === ScanDocumentResponseStatus.Cancel || !result.scannedImages?.length) {
    return null;
  }
  return result.scannedImages.map(normalizeUri);
}
