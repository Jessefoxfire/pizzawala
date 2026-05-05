import type { FirebaseStorageTypes } from '@react-native-firebase/storage';
import { nativeAuth } from '../services/firebase';

type UploadRetryOptions = {
  fallbackReference?: () => FirebaseStorageTypes.Reference;
};

/**
 * Upload a local file URI to Storage and resolve the download URL.
 * Awaits the native upload task promise (RN Firebase) instead of only relying on
 * `task.on(..., complete)`, which can be flaky on some Android builds.
 */
export async function putFileAndGetDownloadUrl(
  reference: FirebaseStorageTypes.Reference,
  fileUri: string,
  metadata: FirebaseStorageTypes.SettableMetadata = { contentType: 'image/jpeg' },
  options: UploadRetryOptions = {}
): Promise<string> {
  const runUpload = async (targetRef: FirebaseStorageTypes.Reference) => {
    const task = targetRef.putFile(fileUri, metadata);
    // UploadTask is thenable: resolves when the native upload completes.
    await (task as unknown as Promise<unknown>);
    return targetRef.getDownloadURL();
  };

  try {
    return await runUpload(reference);
  } catch (error: any) {
    const code = String(error?.code || '');
    const unauthorized = code.includes('storage/unauthorized');
    if (!unauthorized) throw error;

    // Token can be stale right after sign-in; refresh and retry once.
    await nativeAuth().currentUser?.getIdToken(true);

    if (typeof options.fallbackReference === 'function') {
      return runUpload(options.fallbackReference());
    }
    return runUpload(reference);
  }
}
