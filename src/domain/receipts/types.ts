export const RECEIPT_TYPES = ['versorgung', 'firma'] as const;
export type ReceiptType = (typeof RECEIPT_TYPES)[number];

export type VatComponent = {
  ratePercent: number;
  taxCents: number | null;
};

export type RecognitionStatus = 'recognized' | 'needs_review' | 'failed';

export type ReceiptCandidate = {
  merchant: string | null;
  receiptDate: string | null;
  invoiceNumber: string | null;
  totalCents: number | null;
  currency: 'EUR';
  vatBreakdown: VatComponent[];
  status: RecognitionStatus;
};

export type RecognitionSnapshot = ReceiptCandidate & {
  provider: string;
};

export type ReceiptPageRef = {
  url: string;
  storagePath: string;
  mimeType: string;
  fileName: string;
};

export function receiptTypeLabel(type: ReceiptType | null | undefined): string {
  if (type === 'versorgung') return 'Versorgung';
  if (type === 'firma') return 'Firma';
  return 'No type';
}

export function emptyCandidate(status: RecognitionStatus = 'failed'): ReceiptCandidate {
  return {
    merchant: null,
    receiptDate: null,
    invoiceNumber: null,
    totalCents: null,
    currency: 'EUR',
    vatBreakdown: [],
    status,
  };
}
