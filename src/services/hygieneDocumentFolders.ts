import { arrayUnion, doc, getDoc, getFirestore, onSnapshot, setDoc } from '@react-native-firebase/firestore';

export type CustomHygieneDocumentFolder = {
  key: string;
  label: string;
};

export type HygieneDocumentFolderPreferences = {
  hiddenDefaultFolderKeys: string[];
  defaultFolderLabels: Record<string, string>;
};

const foldersRef = (userId: string) => doc(getFirestore(), 'hygieneDocumentFolders', userId);

function readFolders(value: unknown): CustomHygieneDocumentFolder[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => ({ key: String(item?.key || '').trim(), label: String(item?.label || '').trim() }))
    .filter(item => item.key && item.label);
}

function readPreferences(value: Record<string, any> | undefined): HygieneDocumentFolderPreferences {
  const labels = value?.defaultFolderLabels;
  return {
    hiddenDefaultFolderKeys: Array.isArray(value?.hiddenDefaultFolderKeys)
      ? value.hiddenDefaultFolderKeys.map(String).filter(Boolean)
      : [],
    defaultFolderLabels:
      labels && typeof labels === 'object'
        ? Object.fromEntries(Object.entries(labels).map(([key, label]) => [key, String(label || '').trim()]).filter(([, label]) => label))
        : {},
  };
}

export function subscribeCustomHygieneDocumentFolders(
  userId: string | null,
  onChange: (folders: CustomHygieneDocumentFolder[]) => void
) {
  if (!userId) {
    onChange([]);
    return () => undefined;
  }
  return onSnapshot(foldersRef(userId), snapshot => onChange(readFolders(snapshot.data()?.customFolders)));
}

export function subscribeHygieneDocumentFolderPreferences(
  userId: string | null,
  onChange: (preferences: HygieneDocumentFolderPreferences) => void
) {
  if (!userId) {
    onChange({ hiddenDefaultFolderKeys: [], defaultFolderLabels: {} });
    return () => undefined;
  }
  return onSnapshot(foldersRef(userId), snapshot => onChange(readPreferences(snapshot.data())));
}

export async function createCustomHygieneDocumentFolder(userId: string, label: string) {
  const cleanedLabel = label.trim().replace(/\s+/g, ' ');
  if (!cleanedLabel) throw new Error('Enter a name for the new file.');
  const key = `custom_${Date.now()}_${cleanedLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'file'}`;
  const folder = { key, label: cleanedLabel };
  await setDoc(foldersRef(userId), { customFolders: arrayUnion(folder) }, { merge: true });
  return folder;
}

export async function renameCustomHygieneDocumentFolder(userId: string, key: string, label: string) {
  const reference = foldersRef(userId);
  const snapshot = await getDoc(reference);
  const folders = readFolders(snapshot.data()?.customFolders);
  if (!folders.some(folder => folder.key === key)) throw new Error('That file no longer exists.');
  await setDoc(
    reference,
    { customFolders: folders.map(folder => (folder.key === key ? { ...folder, label } : folder)) },
    { merge: true }
  );
}

export async function deleteCustomHygieneDocumentFolder(userId: string, key: string) {
  const reference = foldersRef(userId);
  const snapshot = await getDoc(reference);
  const folders = readFolders(snapshot.data()?.customFolders);
  await setDoc(reference, { customFolders: folders.filter(folder => folder.key !== key) }, { merge: true });
}

export async function renameDefaultHygieneDocumentFolder(userId: string, key: string, label: string) {
  await setDoc(foldersRef(userId), { defaultFolderLabels: { [key]: label } }, { merge: true });
}

export async function deleteDefaultHygieneDocumentFolder(userId: string, key: string) {
  await setDoc(foldersRef(userId), { hiddenDefaultFolderKeys: arrayUnion(key) }, { merge: true });
}
