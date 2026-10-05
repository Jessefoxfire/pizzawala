import { monthKeyFromIso } from './dates';
import { type ReceiptCandidate, type ReceiptType, type RecognitionSnapshot, type VatComponent } from './types';

export type NormalizedReceipt = {
  id: string;
  userId: string | null;
  userName: string;
  receiptDate: string | null;
  submittedAtIso: string | null;
  monthKey: string | null;
  amountCents: number | null;
  currency: 'EUR';
  type: ReceiptType | null;
  category: string | null;
  merchant: string | null;
  note: string | null;
  invoiceNumber: string | null;
  eventId: string | null;
  legacyAssociationLabel: string | null;
  legacyAssociationKind: string | null;
  vatBreakdown: VatComponent[];
  imageUrl: string | null;
  pages: { url: string; mimeType: string; fileName: string }[];
  recognition: RecognitionSnapshot | null;
};

export type ReviewInput = {
  type: ReceiptType;
  eventId: string | null;
  merchant: string;
  receiptDate: string;
  amountCents: number;
  invoiceNumber: string;
  note: string;
  vatBreakdown: VatComponent[];
};

export type ReviewDraft = {
  merchant: string;
  dateText: string;
  amountText: string;
  invoiceNumber: string;
  vat: VatComponent[];
};

export type ReviewTouch = {
  merchant: boolean;
  date: boolean;
  amount: boolean;
  invoice: boolean;
  vat: boolean;
};

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isFinite(value)) return null;
  return value;
}

function legacyAmountCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

function asVat(value: unknown): VatComponent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const rate = (item as { ratePercent?: unknown }).ratePercent;
    const tax = (item as { taxCents?: unknown }).taxCents;
    if (typeof rate !== 'number' || !Number.isFinite(rate)) return [];
    return [{
      ratePercent: rate,
      taxCents: typeof tax === 'number' && Number.isInteger(tax) ? tax : null,
    }];
  });
}

export function readReceipt(id: string, data: Record<string, unknown> | null | undefined): NormalizedReceipt {
  const source = data && typeof data === 'object' ? data : {};
  const type = source.type === 'versorgung' || source.type === 'firma' ? source.type : null;
  const explicitEvent = asString(source.eventId);
  const legacyKind = asString(source.associationKind);
  const legacyId = asString(source.associationId);
  const eventId = explicitEvent || (legacyKind === 'event' ? legacyId : null);
  const receiptDate = asString(source.receiptDate);
  const submittedAtIso = asString(source.submittedAtIso);
  const pages = Array.isArray(source.pages)
    ? source.pages.flatMap(page => {
        if (!page || typeof page !== 'object') return [];
        const url = asString((page as { url?: unknown }).url);
        if (!url) return [];
        return [{
          url,
          mimeType: asString((page as { mimeType?: unknown }).mimeType) || 'image/jpeg',
          fileName: asString((page as { fileName?: unknown }).fileName) || 'receipt',
        }];
      })
    : [];
  const imageUrl = asString(source.imageUrl);
  const documentMime = asString(source.documentMimeType) || (pages[0]?.mimeType ?? 'image/jpeg');
  return {
    id,
    userId: asString(source.userId),
    userName: asString(source.userName) || 'Team member',
    receiptDate,
    submittedAtIso,
    monthKey: monthKeyFromIso(receiptDate) || monthKeyFromIso(submittedAtIso),
    amountCents: asCents(source.amountCents) ?? legacyAmountCents(source.amount),
    currency: 'EUR',
    type,
    category: asString(source.category),
    merchant: asString(source.merchant),
    note: asString(source.note),
    invoiceNumber: asString(source.invoiceNumber),
    eventId,
    legacyAssociationLabel: asString(source.associationLabel),
    legacyAssociationKind: legacyKind,
    vatBreakdown: asVat(source.vatBreakdown),
    imageUrl,
    pages: pages.length ? pages : imageUrl ? [{ url: imageUrl, mimeType: documentMime, fileName: 'receipt' }] : [],
    recognition: source.recognition && typeof source.recognition === 'object'
      ? source.recognition as RecognitionSnapshot
      : null,
  };
}

export function validateMemberReceipt(input: {
  type: ReceiptType | null;
  eventId: string | null;
  receiptDate: string | null;
  amountCents: number | null;
}): string | null {
  if (input.type !== 'versorgung' && input.type !== 'firma') return 'Choose Versorgung or Firma.';
  if (input.eventId != null && !input.eventId.trim()) return 'Choose an event or General / No event.';
  if (!input.receiptDate) return 'Enter the receipt date.';
  if (input.amountCents == null) return 'Enter the amount.';
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return 'Enter a valid amount.';
  return null;
}

export function reviewedReceiptFields(review: ReviewInput, recognition: RecognitionSnapshot | null) {
  return {
    type: review.type,
    eventId: review.eventId,
    merchant: review.merchant.trim(),
    receiptDate: review.receiptDate,
    amountCents: review.amountCents,
    currency: 'EUR' as const,
    invoiceNumber: review.invoiceNumber.trim() || null,
    note: review.note.trim(),
    vatBreakdown: review.vatBreakdown,
    recognition,
    recognitionStatus: 'saved' as const,
  };
}

export function applyRecognitionSuggestion(
  draft: ReviewDraft,
  touched: ReviewTouch,
  candidate: ReceiptCandidate,
  formatDate: (iso: string) => string,
  formatAmount: (cents: number) => string
): ReviewDraft {
  return {
    merchant: !touched.merchant && !draft.merchant.trim() && candidate.merchant ? candidate.merchant : draft.merchant,
    dateText: !touched.date && !draft.dateText.trim() && candidate.receiptDate ? formatDate(candidate.receiptDate) : draft.dateText,
    amountText: !touched.amount && !draft.amountText.trim() && candidate.totalCents != null ? formatAmount(candidate.totalCents) : draft.amountText,
    invoiceNumber: !touched.invoice && !draft.invoiceNumber.trim() && candidate.invoiceNumber ? candidate.invoiceNumber : draft.invoiceNumber,
    vat: !touched.vat && draft.vat.length === 0 && candidate.vatBreakdown.length ? candidate.vatBreakdown : draft.vat,
  };
}

export function resolveEventName(
  eventId: string | null,
  events: ReadonlyMap<string, { title?: string | null }>
): string {
  if (!eventId) return 'General / No event';
  const event = events.get(eventId);
  if (!event) return 'Event unavailable';
  const title = String(event.title || '').trim();
  return title || 'Event';
}

export function canSaveWithoutRecognition(input: {
  type: ReceiptType | null;
  receiptDate: string | null;
  amountCents: number | null;
  recognitionStatus: ReceiptCandidate['status'] | null;
}): boolean {
  return validateMemberReceipt({
    type: input.type,
    eventId: null,
    receiptDate: input.receiptDate,
    amountCents: input.amountCents,
  }) == null;
}
