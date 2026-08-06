declare module 'react-native-document-scanner-plugin' {
  export type ScanDocumentResponseStatus = 'success' | 'cancel';

  export type ScanDocumentOptions = {
    maxNumDocuments?: number;
    croppedImageQuality?: number;
    letUserAdjustCrop?: boolean;
  };

  export type ScanDocumentResponse = {
    scannedImages: string[];
    status: ScanDocumentResponseStatus;
  };

  const DocumentScanner: {
    scanDocument(options?: ScanDocumentOptions): Promise<ScanDocumentResponse>;
  };

  export default DocumentScanner;
}
