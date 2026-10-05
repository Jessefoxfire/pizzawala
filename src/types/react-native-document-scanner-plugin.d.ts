declare module 'react-native-document-scanner-plugin' {
  export enum ResponseType {
    Base64 = 'base64',
    ImageFilePath = 'imageFilePath',
  }

  export enum ScanDocumentResponseStatus {
    Success = 'success',
    Cancel = 'cancel',
  }

  export interface ScanDocumentOptions {
    croppedImageQuality?: number;
    /** Android only. Maximum pages in one scan session. */
    maxNumDocuments?: number;
    responseType?: ResponseType;
    /** Kept for existing call sites. The native scanner UI already lets the user adjust the crop. */
    letUserAdjustCrop?: boolean;
  }

  export interface ScanDocumentResponse {
    scannedImages?: string[];
    status?: ScanDocumentResponseStatus | 'success' | 'cancel';
  }

  const DocumentScanner: {
    scanDocument(options?: ScanDocumentOptions): Promise<ScanDocumentResponse>;
  };

  export default DocumentScanner;
}
