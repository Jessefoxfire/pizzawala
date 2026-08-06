import React, { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import DocumentNameConfirmModal from '../components/DocumentNameConfirmModal';
import {
  pickHygieneCredentialDraft,
  uploadHygieneCredentialDraft,
  type HygieneCredentialDraft,
  type HygieneEmployeeOverride,
  type HygieneUploadOptions,
} from '../utils/hygieneCredentialPicker';
import { rerunAiDocumentFix, isImageForAiEnhance } from '../utils/documentAiEnhance';
import { suggestDocumentName } from '../utils/suggestDocumentName';

type PendingUpload = {
  draft: HygieneCredentialDraft;
  suggestedName: string;
  employeeOverride?: HygieneEmployeeOverride;
  uploadOptions?: HygieneUploadOptions;
  aiEnhanced: boolean;
};

export function useHygieneCredentialUpload() {
  const pendingRef = useRef<{
    resolve: (value: Awaited<ReturnType<typeof uploadHygieneCredentialDraft>> | null) => void;
    reject: (reason?: unknown) => void;
  } | null>(null);
  const pendingUploadRef = useRef<PendingUpload | null>(null);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const pickAndUpload = useCallback(
    async (employeeOverride?: HygieneEmployeeOverride, uploadOptions?: HygieneUploadOptions) => {
      setIsPicking(true);
      let draft: HygieneCredentialDraft | null = null;
      try {
        draft = await pickHygieneCredentialDraft(uploadOptions);
      } finally {
        setIsPicking(false);
      }
      if (!draft) return null;

      const suggestedName = suggestDocumentName({
        requiredDocumentType: uploadOptions?.requiredDocumentType,
        originalFileName: draft.originalFileName,
        source: draft.source,
      });

      const aiEnhanced = isImageForAiEnhance(draft.originalFileName, draft.mimeType);
      const pending: PendingUpload = {
        draft,
        suggestedName,
        employeeOverride,
        uploadOptions,
        aiEnhanced,
      };
      pendingUploadRef.current = pending;
      setPendingUpload(pending);

      return new Promise<Awaited<ReturnType<typeof uploadHygieneCredentialDraft>> | null>((resolve, reject) => {
        pendingRef.current = { resolve, reject };
      });
    },
    []
  );

  const cancelUpload = useCallback(() => {
    pendingUploadRef.current = null;
    setPendingUpload(null);
    pendingRef.current?.resolve(null);
    pendingRef.current = null;
  }, []);

  const confirmUpload = useCallback(async (displayName: string) => {
    const pending = pendingUploadRef.current;
    if (!pending) return;

    pendingUploadRef.current = null;
    setPendingUpload(null);
    setIsUploading(true);

    try {
      const result = await uploadHygieneCredentialDraft(
        pending.draft,
        displayName,
        pending.employeeOverride,
        pending.uploadOptions
      );
      pendingRef.current?.resolve(result);
    } catch (error) {
      pendingRef.current?.reject(error);
    } finally {
      setIsUploading(false);
      pendingRef.current = null;
    }
  }, []);

  const handleAiFix = useCallback(async () => {
    const pending = pendingUploadRef.current;
    if (!pending || isEnhancing) return;

    setIsEnhancing(true);
    try {
      const enhanced = await rerunAiDocumentFix(
        pending.draft.localUri,
        pending.draft.originalFileName,
        pending.draft.mimeType
      );
      if (!enhanced) {
        Alert.alert('AI Fix', 'Could not improve this image further. Try Scan document (AI) when uploading.');
        return;
      }

      const nextDraft: HygieneCredentialDraft = {
        ...pending.draft,
        localUri: enhanced.localUri,
        originalFileName: enhanced.originalFileName,
        mimeType: enhanced.mimeType,
        previewUri: enhanced.localUri,
      };
      const nextPending = { ...pending, draft: nextDraft, aiEnhanced: true };
      pendingUploadRef.current = nextPending;
      setPendingUpload(nextPending);
    } catch (error: any) {
      Alert.alert('AI Fix failed', error?.message || 'Could not enhance this document.');
    } finally {
      setIsEnhancing(false);
    }
  }, [isEnhancing]);

  const nameConfirmModal = (
    <DocumentNameConfirmModal
      visible={!!pendingUpload}
      suggestedName={pendingUpload?.suggestedName ?? ''}
      subtitle={
        pendingUpload?.uploadOptions?.requiredDocumentType
          ? `Uploading as: ${pendingUpload.uploadOptions.requiredDocumentType}`
          : 'AI crop, straighten, and colour correction are applied automatically.'
      }
      previewUri={pendingUpload?.draft.previewUri}
      aiEnhanced={pendingUpload?.aiEnhanced}
      aiFixBusy={isEnhancing}
      onCancel={cancelUpload}
      onConfirm={displayName => void confirmUpload(displayName)}
      onAiFix={
        pendingUpload && isImageForAiEnhance(pendingUpload.draft.originalFileName, pendingUpload.draft.mimeType)
          ? () => void handleAiFix()
          : undefined
      }
    />
  );

  return {
    pickAndUpload,
    nameConfirmModal,
    isPicking,
    isEnhancing,
    isConfirming: !!pendingUpload,
    isUploading,
  };
}
