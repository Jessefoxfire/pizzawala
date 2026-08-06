import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@react-native-firebase/firestore';
import { auth, uploadStorageRef, uploadStorageRefFallback } from './firebase';
import { putFileAndGetDownloadUrl } from '../utils/storageUpload';
import { isDeviceOnline } from '../offline/connectivity';
import { createOutboxId, enqueueOutbox } from '../offline/outbox';
import type { WriteResult } from '../offline/types';

export const TEMPERATURE_TARGETS = [
  { key: 'truck_fridge', label: 'Truck fridge' },
  { key: 'truck_top_cooler', label: 'Truck top cooler' },
  { key: 'tent_top_cooler', label: 'Tent top cooler' },
  { key: 'cool_trailer', label: 'Cool trailer' },
] as const;

export type TemperatureTargetKey = (typeof TEMPERATURE_TARGETS)[number]['key'];

export type HygieneActor = {
  userId: string;
  userName: string;
  userEmail: string;
  avatarUrl: string | null;
  customAvatarUrl: string | null;
  teamId: string;
};

export function localDateKey(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function localMonthKey(value = new Date()) {
  return localDateKey(value).slice(0, 7);
}

export function addYearsIso(isoLike: string, years: number) {
  const date = new Date(isoLike);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  date.setFullYear(date.getFullYear() + years);
  return date.toISOString();
}

export function getTimestampMs(raw: any, fallbackIso?: string | null) {
  if (raw && typeof raw.toDate === 'function') {
    try {
      return raw.toDate().getTime();
    } catch {
      // fall through
    }
  }
  if (typeof raw === 'string') {
    const parsed = new Date(raw).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (fallbackIso) {
    const parsed = new Date(fallbackIso).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

export function formatDateTime(raw: any, fallbackIso?: string | null) {
  const ms = getTimestampMs(raw, fallbackIso);
  if (!ms) return 'Pending timestamp';
  return new Date(ms).toLocaleString();
}

export function escapeCsv(value: unknown) {
  const text = value == null ? '' : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function getCurrentHygieneActor(): Promise<HygieneActor> {
  const user = auth.currentUser;
  if (!user?.uid) {
    throw new Error('You must be signed in.');
  }

  const fs = getFirestore();
  const snap = await getDoc(doc(fs, 'users', user.uid));
  const data = snap.exists() ? snap.data() : {};
  const fallbackEmail = user.email || '';
  const fallbackName = user.displayName || fallbackEmail.split('@')[0] || 'Team member';

  return {
    userId: user.uid,
    userName: typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : fallbackName,
    userEmail: typeof data?.email === 'string' && data.email.trim() ? data.email.trim() : fallbackEmail,
    avatarUrl: typeof data?.avatarUrl === 'string' ? data.avatarUrl : null,
    customAvatarUrl: typeof data?.customAvatarUrl === 'string' ? data.customAvatarUrl : null,
    teamId: typeof data?.teamId === 'string' && data.teamId.trim() ? data.teamId : 'team-1',
  };
}

export async function recordTemperature(
  target: { key: string; label: string },
  temperatureValue: string,
  unit: 'C' | 'F',
  notes = '',
  loggedAt = new Date()
): Promise<WriteResult> {
  const actor = await getCurrentHygieneActor();
  const when = loggedAt instanceof Date && !Number.isNaN(loggedAt.getTime()) ? loggedAt : new Date();
  const payload = {
    targetKey: target.key,
    targetLabel: target.label,
    temperatureValue: temperatureValue.trim(),
    temperatureUnit: unit,
    notes: notes.trim(),
    actor,
    dateKey: localDateKey(when),
    monthKey: localMonthKey(when),
    loggedAtIso: when.toISOString(),
  };

  const writeDoc = async () => {
    const fs = getFirestore();
    await addDoc(collection(fs, 'hygieneTemperatureLogs'), {
      targetKey: payload.targetKey,
      targetLabel: payload.targetLabel,
      temperatureValue: payload.temperatureValue,
      temperatureUnit: payload.temperatureUnit,
      notes: payload.notes,
      userId: actor.userId,
      userName: actor.userName,
      userEmail: actor.userEmail,
      avatarUrl: actor.avatarUrl,
      customAvatarUrl: actor.customAvatarUrl,
      teamId: actor.teamId,
      dateKey: payload.dateKey,
      monthKey: payload.monthKey,
      loggedAtIso: payload.loggedAtIso,
      loggedAt: serverTimestamp(),
    });
  };

  const clearlyOffline = (await isDeviceOnline()) === false;
  if (!clearlyOffline) {
    try {
      await writeDoc();
      return { queued: false };
    } catch {
      // Fall back to outbox if the live write fails.
    }
  }

  await enqueueOutbox({
    id: createOutboxId(),
    type: 'temperature_log',
    createdAt: when.toISOString(),
    payload,
  });
  return { queued: true };
}

export async function deleteTemperatureLog(logId: string) {
  const fs = getFirestore();
  await deleteDoc(doc(fs, 'hygieneTemperatureLogs', logId));
}

export async function updateTemperatureLog(
  logId: string,
  temperatureValue: string,
  notes = ''
) {
  const trimmed = temperatureValue.trim();
  if (!trimmed || !Number.isFinite(Number.parseFloat(trimmed))) {
    throw new Error('Enter a valid temperature.');
  }
  const fs = getFirestore();
  await updateDoc(doc(fs, 'hygieneTemperatureLogs', logId), {
    temperatureValue: trimmed,
    notes: notes.trim(),
    reviewedAt: serverTimestamp(),
    reviewedAtIso: new Date().toISOString(),
  });
}

export async function deleteHygieneCredential(credentialId: string, storagePath?: string | null) {
  const fs = getFirestore();
  await deleteDoc(doc(fs, 'hygieneCredentials', credentialId));
  const path = String(storagePath || '').trim();
  if (!path) return;

  const tryDelete = async (deleteRef: { delete: () => Promise<void> }) => {
    await deleteRef.delete();
  };

  try {
    await tryDelete(uploadStorageRef(path));
  } catch {
    try {
      await tryDelete(uploadStorageRefFallback(path));
    } catch {
      /* storage file may already be gone */
    }
  }
}

const HYGIENE_ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/heic',
  'image/heif',
  'image/webp',
]);

export function hygieneMimeForUpload(fileName: string, mimeType?: string | null) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime === 'image/jpg') return 'image/jpeg';
  if (mime.startsWith('image/')) return mime;
  if (HYGIENE_ALLOWED_MIMES.has(mime)) return mime;
  const name = fileName.toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpeg') || name.endsWith('.jpg')) return 'image/jpeg';
  if (name.endsWith('.heic')) return 'image/heic';
  if (name.endsWith('.heif')) return 'image/heif';
  if (name.endsWith('.webp')) return 'image/webp';
  return 'application/pdf';
}

export async function uploadHygieneCredential(file: {
  localUri: string;
  fileName: string;
  mimeType?: string | null;
}, employeeOverride?: Partial<HygieneActor> & { userId: string; userName: string; userEmail: string }, options?: {
  requiredDocumentType?: string | null;
  documentCategory?: string | null;
}) {
  const actor = await getCurrentHygieneActor();
  const employee = employeeOverride
    ? {
        userId: employeeOverride.userId,
        userName: employeeOverride.userName,
        userEmail: employeeOverride.userEmail,
        avatarUrl: employeeOverride.avatarUrl ?? null,
        customAvatarUrl: employeeOverride.customAvatarUrl ?? null,
        teamId: employeeOverride.teamId || actor.teamId,
      }
    : actor;
  const fs = getFirestore();
  const now = new Date();
  const uploadedAtIso = now.toISOString();
  const nextEducationDueAtIso = addYearsIso(uploadedAtIso, 2);
  const safeName = file.fileName.replace(/[^A-Za-z0-9._-]+/g, '_');
  const storagePath = `hygiene/${employee.userId}/credentials/${Date.now()}-${safeName}`;
  const reference = uploadStorageRef(storagePath);
  const downloadUrl = await putFileAndGetDownloadUrl(
    reference,
    file.localUri,
    { contentType: hygieneMimeForUpload(file.fileName, file.mimeType) },
    { fallbackReference: () => uploadStorageRefFallback(storagePath) }
  );

  await addDoc(collection(fs, 'hygieneCredentials'), {
    employeeUid: employee.userId,
    employeeName: employee.userName,
    employeeEmail: employee.userEmail,
    avatarUrl: employee.avatarUrl,
    customAvatarUrl: employee.customAvatarUrl,
    teamId: employee.teamId,
    uploadedByUid: actor.userId,
    uploadedByName: actor.userName,
    fileName: file.fileName,
    requiredDocumentType: String(options?.requiredDocumentType || '').trim() || null,
    documentCategory: String(options?.documentCategory || '').trim() || 'hygiene_card',
    downloadUrl,
    storagePath,
    status: 'active',
    uploadedAtIso,
    uploadedAt: serverTimestamp(),
    nextEducationDueAtIso,
    nextEducationDueDateKey: localDateKey(new Date(nextEducationDueAtIso)),
    reminderSentForDateKey: null,
  });

  return { downloadUrl, nextEducationDueAtIso };
}

async function isCurrentUserAdmin() {
  const user = auth.currentUser;
  if (!user?.uid) return false;
  const snap = await getDoc(doc(getFirestore(), 'users', user.uid));
  const roles = snap.data()?.roles;
  return Array.isArray(roles) && roles.includes('admin');
}

export type MonthlyHygieneCsv = {
  csv: string;
  fileName: string;
  monthKey: string;
};

export async function buildMonthlyHygieneCsv(monthKey: string): Promise<MonthlyHygieneCsv> {
  const trimmedMonth = monthKey.trim();
  if (!/^\d{4}-\d{2}$/.test(trimmedMonth)) {
    throw new Error('Month must use YYYY-MM format.');
  }

  const fs = getFirestore();
  const temperatureSnap = await getDocs(
    query(collection(fs, 'hygieneTemperatureLogs'), where('monthKey', '==', trimmedMonth))
  );

  const rows: string[] = [
    [
      'Record Type',
      'Timestamp',
      'Date Key',
      'Employee',
      'Email',
      'Target',
      'Task',
      'Temperature',
      'Unit',
      'Notes',
    ].join(','),
  ];

  temperatureSnap.docs
    .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
    .sort((a: any, b: any) => getTimestampMs(b.loggedAt, b.loggedAtIso) - getTimestampMs(a.loggedAt, a.loggedAtIso))
    .forEach((item: any) => {
      rows.push(
        [
          escapeCsv('Temperature'),
          escapeCsv(item.loggedAtIso || ''),
          escapeCsv(item.dateKey || ''),
          escapeCsv(item.userName || ''),
          escapeCsv(item.userEmail || ''),
          escapeCsv(item.targetLabel || ''),
          '',
          escapeCsv(item.temperatureValue || ''),
          escapeCsv(item.temperatureUnit || ''),
          escapeCsv(item.notes || ''),
        ].join(',')
      );
    });

  const fileName = `PizzaWala-hygiene-${trimmedMonth}.csv`;
  return { csv: rows.join('\n'), fileName, monthKey: trimmedMonth };
}

export async function writeHygieneCsvLocalFile(csv: string, fileName: string) {
  const directory = RNFS.DocumentDirectoryPath || RNFS.CachesDirectoryPath;
  const filePath = `${directory}/${fileName}`;
  await RNFS.writeFile(filePath, csv, 'utf8');
  const stat = await RNFS.stat(filePath);
  if (!stat.size) {
    await RNFS.unlink(filePath).catch(() => undefined);
    throw new Error('Could not save CSV file.');
  }
  return {
    filePath,
    fileUri: filePath.startsWith('file://') ? filePath : `file://${filePath}`,
    fileName,
  };
}

export async function shareHygieneCsvFile(params: {
  filePath: string;
  fileUri: string;
  fileName: string;
  monthKey: string;
}) {
  await Share.open({
    title: `Hygiene report ${params.monthKey}`,
    message: `PizzaWala hygiene CSV for ${params.monthKey}`,
    url: params.fileUri,
    type: 'text/csv',
    filename: params.fileName,
    failOnCancel: false,
    showAppsToView: true,
  });
}

/** Build CSV locally and open the device share/download sheet. */
export async function downloadMonthlyHygieneExport(monthKey: string) {
  const built = await buildMonthlyHygieneCsv(monthKey);
  const local = await writeHygieneCsvLocalFile(built.csv, built.fileName);
  await shareHygieneCsvFile({ ...local, monthKey: built.monthKey });
  return {
    fileName: built.fileName,
    filePath: local.filePath,
    monthKey: built.monthKey,
  };
}

/** Download from cloud when available; otherwise regenerate locally. */
export async function openOrDownloadHygieneExport(item: {
  monthKey?: string;
  downloadUrl?: string | null;
  fileName?: string | null;
}) {
  const monthKey = String(item.monthKey || '').trim();
  const fileName =
    String(item.fileName || '').trim() ||
    (monthKey ? `PizzaWala-hygiene-${monthKey}.csv` : 'PizzaWala-hygiene.csv');

  if (item.downloadUrl) {
    try {
      const directory = RNFS.CachesDirectoryPath || RNFS.DocumentDirectoryPath;
      const filePath = `${directory}/${Date.now()}-${fileName}`;
      const result = await RNFS.downloadFile({ fromUrl: String(item.downloadUrl), toFile: filePath }).promise;
      if (result.statusCode && result.statusCode >= 400) {
        throw new Error(`Download failed (${result.statusCode}).`);
      }
      const fileUri = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
      await shareHygieneCsvFile({ filePath, fileUri, fileName, monthKey: monthKey || fileName });
      return { fileName, filePath, monthKey, source: 'cloud' as const };
    } catch {
      /* fall through to local rebuild */
    }
  }

  if (!monthKey) {
    throw new Error('Export month is missing.');
  }
  const local = await downloadMonthlyHygieneExport(monthKey);
  return { ...local, source: 'local' as const };
}

export async function generateMonthlyHygieneExport(monthKey: string) {
  if (!(await isCurrentUserAdmin())) {
    throw new Error('Only admins can save exports to the archive.');
  }

  const actor = await getCurrentHygieneActor();
  const fs = getFirestore();
  const built = await buildMonthlyHygieneCsv(monthKey);
  const local = await writeHygieneCsvLocalFile(built.csv, built.fileName);

  const storagePath = `hygiene/exports/${built.monthKey}/${Date.now()}-${built.fileName}`;
  const downloadUrl = await putFileAndGetDownloadUrl(
    uploadStorageRef(storagePath),
    local.fileUri,
    { contentType: 'text/csv' },
    { fallbackReference: () => uploadStorageRefFallback(storagePath) }
  );

  await addDoc(collection(fs, 'hygieneExports'), {
    monthKey: built.monthKey,
    fileName: built.fileName,
    downloadUrl,
    storagePath,
    createdByUid: actor.userId,
    createdByName: actor.userName,
    createdAt: serverTimestamp(),
    createdAtIso: new Date().toISOString(),
  });

  return { fileName: built.fileName, downloadUrl, filePath: local.filePath, monthKey: built.monthKey };
}
