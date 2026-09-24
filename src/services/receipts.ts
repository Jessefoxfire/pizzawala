import { addDoc, collection, doc, getDoc, getFirestore, serverTimestamp } from '@react-native-firebase/firestore';
import { auth, uploadStorageRef, uploadStorageRefFallback } from './firebase';
import { putFileAndGetDownloadUrl } from '../utils/storageUpload';

export const RECEIPT_CATEGORIES = ['Fuel', 'Parking', 'Toll', 'Supplies', 'Other'] as const;
export type ReceiptCategory = (typeof RECEIPT_CATEGORIES)[number];

export type ReceiptDraft = {
  localUri: string;
  fileName: string;
  mimeType: string;
  receiptDate: string;
  amount: string;
  category: ReceiptCategory;
  merchant: string;
  note?: string;
  association?: { id: string; label: string; kind: 'worksite' | 'event' } | null;
};

export async function submitReceipt(draft: ReceiptDraft) {
  const user = auth.currentUser;
  if (!user?.uid) throw new Error('You must be signed in to submit a receipt.');
  const amount = Number(String(draft.amount).replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid amount.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.receiptDate)) throw new Error('Use the receipt date format YYYY-MM-DD.');

  const fs = getFirestore();
  const profile = await getDoc(doc(fs, 'users', user.uid));
  const data = profile.exists() ? profile.data() : {};
  const userName = String(data?.name || data?.displayName || user.displayName || user.email || 'Team member').trim();
  const teamId = String(data?.teamId || 'team-1').trim() || 'team-1';
  const safeName = draft.fileName.replace(/[^A-Za-z0-9._-]+/g, '_') || `receipt-${Date.now()}.jpg`;
  const storagePath = `receipts/${teamId}/${user.uid}/${Date.now()}-${safeName}`;
  const downloadUrl = await putFileAndGetDownloadUrl(
    uploadStorageRef(storagePath),
    draft.localUri,
    { contentType: draft.mimeType || 'image/jpeg' },
    { fallbackReference: () => uploadStorageRefFallback(storagePath) }
  );

  await addDoc(collection(fs, 'receipts'), {
    userId: user.uid,
    userName,
    userEmail: user.email || '',
    teamId,
    receiptDate: draft.receiptDate,
    amount,
    currency: 'EUR',
    category: draft.category,
    merchant: draft.merchant.trim(),
    note: String(draft.note || '').trim(),
    associationId: draft.association?.id || null,
    associationLabel: draft.association?.label || null,
    associationKind: draft.association?.kind || null,
    imageUrl: downloadUrl,
    storagePath,
    submittedAtIso: new Date().toISOString(),
    submittedAt: serverTimestamp(),
    ocr: { status: 'not_started', merchant: null, receiptDate: null, grossTotal: null, vat: null, receiptNumber: null },
  });
}
