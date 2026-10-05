import { addDoc, collection, doc, getDoc, getFirestore, serverTimestamp, updateDoc } from '@react-native-firebase/firestore';
import { auth, uploadStorageRef, uploadStorageRefFallback } from './firebase';
import { putFileAndGetDownloadUrl } from '../utils/storageUpload';
import type { ReceiptPageRef, ReceiptType, RecognitionSnapshot, VatComponent } from '../domain/receipts/types';

export type ReceiptUploadPage = {
  localUri: string;
  fileName: string;
  mimeType: string;
};

export type ReceiptSubmitInput = {
  pages: ReceiptUploadPage[];
  type: ReceiptType;
  eventId: string | null;
  merchant: string;
  receiptDate: string;
  amountCents: number;
  invoiceNumber: string;
  note: string;
  vatBreakdown: VatComponent[];
  recognition: RecognitionSnapshot | null;
};

async function uploadReceiptPage(teamId: string, userId: string, page: ReceiptUploadPage): Promise<ReceiptPageRef> {
  const safeName = page.fileName.replace(/[^A-Za-z0-9._-]+/g, '_') || `receipt-${Date.now()}.jpg`;
  const storagePath = `receipts/${teamId}/${userId}/${Date.now()}-${safeName}`;
  const url = await putFileAndGetDownloadUrl(
    uploadStorageRef(storagePath),
    page.localUri,
    { contentType: page.mimeType || 'image/jpeg' },
    { fallbackReference: () => uploadStorageRefFallback(storagePath) }
  );
  return { url, storagePath, mimeType: page.mimeType || 'image/jpeg', fileName: safeName };
}

export async function submitReceipt(draft: ReceiptSubmitInput) {
  const user = auth.currentUser;
  if (!user?.uid) throw new Error('You must be signed in to submit a receipt.');
  if (!draft.pages.length) throw new Error('Add a receipt document before saving.');

  const fs = getFirestore();
  const profile = await getDoc(doc(fs, 'users', user.uid));
  const data = profile.exists() ? profile.data() : {};
  const userName = String(data?.name || data?.displayName || user.displayName || user.email || 'Team member').trim();
  const teamId = String(data?.teamId || 'team-1').trim() || 'team-1';
  const pages: ReceiptPageRef[] = [];
  for (const page of draft.pages) {
    pages.push(await uploadReceiptPage(teamId, user.uid, page));
  }
  const primary = pages[0];

  await addDoc(collection(fs, 'receipts'), {
    userId: user.uid,
    userName,
    userEmail: user.email || '',
    teamId,
    type: draft.type,
    eventId: draft.eventId,
    receiptDate: draft.receiptDate,
    amountCents: draft.amountCents,
    amount: draft.amountCents / 100,
    currency: 'EUR',
    merchant: draft.merchant.trim(),
    invoiceNumber: draft.invoiceNumber.trim() || null,
    note: draft.note.trim(),
    vatBreakdown: draft.vatBreakdown,
    category: null,
    associationId: draft.eventId,
    associationLabel: null,
    associationKind: draft.eventId ? 'event' : null,
    imageUrl: primary.url,
    storagePath: primary.storagePath,
    documentMimeType: primary.mimeType,
    pages,
    submittedAtIso: new Date().toISOString(),
    submittedAt: serverTimestamp(),
    recognitionStatus: 'saved',
    recognition: draft.recognition,
    ocr: draft.recognition
      ? {
          status: draft.recognition.status,
          merchant: draft.recognition.merchant,
          receiptDate: draft.recognition.receiptDate,
          grossTotalCents: draft.recognition.totalCents,
          vat: draft.recognition.vatBreakdown,
          receiptNumber: draft.recognition.invoiceNumber,
        }
      : { status: 'failed', merchant: null, receiptDate: null, grossTotalCents: null, vat: [], receiptNumber: null },
  });
}

export type ReceiptAdminUpdate = {
  type: ReceiptType | null;
  eventId: string | null;
  merchant: string;
  receiptDate: string | null;
  amountCents: number | null;
  invoiceNumber: string | null;
  note: string;
  vatBreakdown: VatComponent[];
  clearLegacyEventAssociation: boolean;
};

export async function updateReceiptDetails(receiptId: string, update: ReceiptAdminUpdate) {
  const fs = getFirestore();
  const payload: Record<string, unknown> = {
    type: update.type,
    eventId: update.eventId,
    merchant: update.merchant.trim(),
    receiptDate: update.receiptDate,
    amountCents: update.amountCents,
    invoiceNumber: update.invoiceNumber,
    note: update.note.trim(),
    vatBreakdown: update.vatBreakdown,
    currency: 'EUR',
  };
  if (update.amountCents != null) payload.amount = update.amountCents / 100;
  if (update.eventId) {
    payload.associationId = update.eventId;
    payload.associationKind = 'event';
    payload.associationLabel = null;
  } else if (update.clearLegacyEventAssociation) {
    payload.associationId = null;
    payload.associationKind = null;
    payload.associationLabel = null;
  }
  await updateDoc(doc(fs, 'receipts', receiptId), payload);
}
