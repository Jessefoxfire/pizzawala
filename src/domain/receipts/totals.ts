import type { ReceiptType } from './types';

export type ReceiptTotalSource = {
  type: ReceiptType | null;
  amountCents: number | null;
  eventId: string | null;
  monthKey: string | null;
  userId: string | null;
};

export type ReceiptFilter = {
  month: string;
  userId: string | null;
  type: 'all' | ReceiptType;
  event: 'all' | 'none' | string;
};

export type ReceiptTotals = {
  versorgungCents: number;
  firmaCents: number;
  otherCents: number;
  totalCents: number;
};

export function filterReceipts<T extends ReceiptTotalSource>(items: T[], filter: ReceiptFilter): T[] {
  return items.filter(item => {
    if (item.monthKey !== filter.month) return false;
    if (filter.userId && item.userId !== filter.userId) return false;
    if (filter.type !== 'all' && item.type !== filter.type) return false;
    if (filter.event === 'none' && item.eventId) return false;
    if (filter.event !== 'all' && filter.event !== 'none' && item.eventId !== filter.event) return false;
    return true;
  });
}

export function summarizeReceipts(items: { type: ReceiptType | null; amountCents: number | null }[]): ReceiptTotals {
  const totals: ReceiptTotals = { versorgungCents: 0, firmaCents: 0, otherCents: 0, totalCents: 0 };
  items.forEach(item => {
    if (item.amountCents == null || !Number.isInteger(item.amountCents)) return;
    totals.totalCents += item.amountCents;
    if (item.type === 'versorgung') totals.versorgungCents += item.amountCents;
    else if (item.type === 'firma') totals.firmaCents += item.amountCents;
    else totals.otherCents += item.amountCents;
  });
  return totals;
}
