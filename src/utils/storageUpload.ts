import type { FirebaseStorageTypes } from '@react-native-firebase/storage';
import { nativeAuth } from '../services/firebase';

type UploadRetryOptions = {
  fallbackReference?: () => FirebaseStorageTypes.Reference;
};

function storageErrorCode(error: unknown): string {
  return String((error as { code?: string })?.code || '');
}

function waitForUploadTask(task: FirebaseStorageTypes.Task): Promise<FirebaseStorageTypes.TaskSnapshot> {
  return new Promise((resolve, reject) => {
    const unsubscribe = task.on(
      'state_changed',
      snapshot => {
        if (snapshot.state === 'error') {
          unsubscribe();
          reject(snapshot.error ?? new Error('Storage upload failed.'));
        }
      },
      error => {
        unsubscribe();
        reject(error);
      },
      () => {
        unsubscribe();
        const snapshot = task.snapshot;
        if (!snapshot) {
          reject(new Error('Storage upload finished without a snapshot.'));
          return;
        }
        resolve(snapshot);
      }
    );
  });
}

async function getDownloadUrlWithRetry(
  reference: FirebaseStorageTypes.Reference,
  attempts = 4
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await reference.getDownloadURL();
    } catch (error) {
      lastError = error;
      const code = storageErrorCode(error);
      if (!code.includes('object-not-found') || attempt === attempts - 1) {
        throw error;
      }
      await new Promise<void>(resolve => {
        setTimeout(resolve, 350 * (attempt + 1));
      });
    }
  }
  throw lastError ?? new Error('Could not resolve download URL.');
}

async function runPutFileUpload(
  reference: FirebaseStorageTypes.Reference,
  fileUri: string,
  metadata: FirebaseStorageTypes.SettableMetadata
): Promise<string> {
  const task = reference.putFile(fileUri, metadata);
  const snapshot = await waitForUploadTask(task);
  const urlRef = snapshot.ref ?? reference;
  return getDownloadUrlWithRetry(urlRef);
}

/**
 * Upload a local file URI to Storage and resolve the download URL.
 */
export async function putFileAndGetDownloadUrl(
  reference: FirebaseStorageTypes.Reference,
  fileUri: string,
  metadata: FirebaseStorageTypes.SettableMetadata = { contentType: 'image/jpeg' },
  options: UploadRetryOptions = {}
): Promise<string> {
  await nativeAuth().currentUser?.getIdToken(true);

  try {
    return await runPutFileUpload(reference, fileUri, metadata);
  } catch (error) {
    const code = storageErrorCode(error);
    const retryable =
      code.includes('storage/unauthorized') || code.includes('storage/object-not-found');
    if (!retryable) throw error;

    await nativeAuth().currentUser?.getIdToken(true);

    if (typeof options.fallbackReference === 'function') {
      return runPutFileUpload(options.fallbackReference(), fileUri, metadata);
    }
    return runPutFileUpload(reference, fileUri, metadata);
  }
}

/**
 * Upload base64 content directly (avoids temp-file issues on some Android builds).
 */
export async function putBase64AndGetDownloadUrl(
  reference: FirebaseStorageTypes.Reference,
  base64: string,
  metadata: FirebaseStorageTypes.SettableMetadata,
  options: UploadRetryOptions = {}
): Promise<string> {
  await nativeAuth().currentUser?.getIdToken(true);

  const runPutString = async (targetRef: FirebaseStorageTypes.Reference) => {
    const task = targetRef.putString(base64, 'base64', metadata);
    const snapshot = await waitForUploadTask(task);
    const urlRef = snapshot.ref ?? targetRef;
    return getDownloadUrlWithRetry(urlRef);
  };

  try {
    return await runPutString(reference);
  } catch (error) {
    const code = storageErrorCode(error);
    const retryable =
      code.includes('storage/unauthorized') || code.includes('storage/object-not-found');
    if (!retryable) throw error;

    await nativeAuth().currentUser?.getIdToken(true);

    if (typeof options.fallbackReference === 'function') {
      return runPutString(options.fallbackReference());
    }
    return runPutString(reference);
  }
}
