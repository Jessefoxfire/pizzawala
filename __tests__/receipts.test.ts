import {
  formatAmountInput,
  formatEuro,
  formatReceiptAmount,
  parseMoneyToCents,
} from '../src/domain/receipts/money';
import { formatReceiptDate, parseReceiptDate } from '../src/domain/receipts/dates';
import { parseReceiptText } from '../src/domain/receipts/parseReceiptText';
import {
  applyRecognitionSuggestion,
  canSaveWithoutRecognition,
  readReceipt,
  resolveEventName,
  reviewedReceiptFields,
  validateMemberReceipt,
} from '../src/domain/receipts/receiptRecord';
import { filterReceipts, summarizeReceipts } from '../src/domain/receipts/totals';
import type { RecognitionSnapshot } from '../src/domain/receipts/types';

describe('receipt money', () => {
  it('parses German and US amounts into cents', () => {
    expect(parseMoneyToCents('12,50 €')).toBe(1250);
    expect(parseMoneyToCents('68.42 €')).toBe(6842);
    expect(parseMoneyToCents('1.248,75 €')).toBe(124875);
    expect(parseMoneyToCents('1,248.75')).toBe(124875);
  });

  it('does not invent an amount from empty or date-like text', () => {
    expect(parseMoneyToCents('')).toBeNull();
    expect(parseMoneyToCents('abc')).toBeNull();
    expect(parseMoneyToCents('25.09.2026')).toBeNull();
  });

  it('formats cents without using binary float display', () => {
    expect(formatEuro(6842)).toBe('68,42 €');
    expect(formatEuro(124875)).toBe('1.248,75 €');
    expect(formatAmountInput(42870)).toBe('428,70');
    expect(formatReceiptAmount(null)).toBe('—');
  });
});

describe('receipt type and event', () => {
  it('requires Versorgung or Firma for a new receipt', () => {
    expect(validateMemberReceipt({ type: null, eventId: null, receiptDate: '2026-09-25', amountCents: 100 })).toMatch(/Versorgung/);
    expect(validateMemberReceipt({ type: 'versorgung', eventId: null, receiptDate: '2026-09-25', amountCents: 100 })).toBeNull();
    expect(validateMemberReceipt({ type: 'firma', eventId: null, receiptDate: '2026-09-25', amountCents: 100 })).toBeNull();
  });

  it('allows a real event id or no event', () => {
    expect(validateMemberReceipt({ type: 'firma', eventId: null, receiptDate: '2026-09-25', amountCents: 100 })).toBeNull();
    expect(validateMemberReceipt({ type: 'firma', eventId: 'event-1', receiptDate: '2026-09-25', amountCents: 100 })).toBeNull();
  });

  it('keeps displaying a receipt when its event is renamed or deleted', () => {
    const events = new Map<string, { title?: string | null }>([['event-1', { title: 'Hurricane' }]]);
    expect(resolveEventName('event-1', events)).toBe('Hurricane');
    events.set('event-1', { title: 'Hurricane Festival' });
    expect(resolveEventName('event-1', events)).toBe('Hurricane Festival');
    events.delete('event-1');
    expect(resolveEventName('event-1', events)).toBe('Event unavailable');
    expect(resolveEventName(null, events)).toBe('General / No event');
  });
});

describe('receipt totals', () => {
  const items = [
    { type: 'versorgung' as const, amountCents: 18640, eventId: 'hurricane', monthKey: '2026-09', userId: 'a' },
    { type: 'firma' as const, amountCents: 32418, eventId: 'hurricane', monthKey: '2026-09', userId: 'b' },
    { type: 'versorgung' as const, amountCents: 24230, eventId: null, monthKey: '2026-09', userId: 'a' },
    { type: 'firma' as const, amountCents: 96014, eventId: 'other', monthKey: '2026-09', userId: 'a' },
    { type: 'firma' as const, amountCents: 500, eventId: 'hurricane', monthKey: '2026-08', userId: 'a' },
  ];

  it('sums Versorgung, Firma, and the combined total from saved cents', () => {
    const september = filterReceipts(items, { month: '2026-09', userId: null, type: 'all', event: 'all' });
    expect(summarizeReceipts(september)).toEqual({
      versorgungCents: 42870,
      firmaCents: 128432,
      otherCents: 0,
      totalCents: 171302,
    });
  });

  it('limits totals to receipts that reference the selected event', () => {
    const hurricane = filterReceipts(items, { month: '2026-09', userId: null, type: 'all', event: 'hurricane' });
    expect(summarizeReceipts(hurricane)).toEqual({
      versorgungCents: 18640,
      firmaCents: 32418,
      otherCents: 0,
      totalCents: 51058,
    });
  });
});

describe('historical receipts', () => {
  it('loads an old receipt that has none of the new fields', () => {
    const receipt = readReceipt('old-1', {
      userId: 'member-1',
      userName: 'Alex',
      amount: 12.5,
      category: 'Fuel',
      imageUrl: 'https://example.com/receipt.jpg',
      submittedAtIso: '2024-05-02T10:00:00.000Z',
    });
    expect(receipt.type).toBeNull();
    expect(receipt.eventId).toBeNull();
    expect(receipt.merchant).toBeNull();
    expect(receipt.receiptDate).toBeNull();
    expect(receipt.vatBreakdown).toEqual([]);
    expect(receipt.amountCents).toBe(1250);
    expect(receipt.pages).toEqual([{ url: 'https://example.com/receipt.jpg', mimeType: 'image/jpeg', fileName: 'receipt' }]);
    expect(receipt.monthKey).toBe('2024-05');
  });
});

describe('receipt recognition review', () => {
  const candidate = parseReceiptText(`
REWE Markt
Datum: 25.09.2026
Beleg-Nr. 48291
Milch 1,29
MwSt 7% 0,25
MwSt 19% 8,92
Summe 60,00
Gesamt 68,42 EUR
`);

  it('suggests the payable total and other fields without treating them as final', () => {
    expect(candidate.merchant).toBe('REWE Markt');
    expect(candidate.receiptDate).toBe('2026-09-25');
    expect(candidate.invoiceNumber).toBe('48291');
    expect(candidate.totalCents).toBe(6842);
    expect(candidate.vatBreakdown).toEqual([
      { ratePercent: 7, taxCents: 25 },
      { ratePercent: 19, taxCents: 892 },
    ]);
    expect(formatReceiptDate(candidate.receiptDate)).toBe('25.09.2026');
    expect(parseReceiptDate('25.09.2026')).toBe('2026-09-25');
  });

  it('keeps a corrected amount authoritative and leaves the OCR snapshot unchanged', () => {
    const recognition: RecognitionSnapshot = { ...candidate, provider: 'mlkit-text-recognition' };
    const saved = reviewedReceiptFields({
      type: 'versorgung',
      eventId: 'event-1',
      merchant: 'REWE',
      receiptDate: '2026-09-25',
      amountCents: 6342,
      invoiceNumber: '48291',
      note: '',
      vatBreakdown: candidate.vatBreakdown,
    }, recognition);
    expect(saved.amountCents).toBe(6342);
    expect(saved.recognition?.totalCents).toBe(6842);
    expect(saved.recognitionStatus).toBe('saved');
  });

  it('does not overwrite fields the member already edited', () => {
    const next = applyRecognitionSuggestion(
      { merchant: '', dateText: '', amountText: '63,42', invoiceNumber: '', vat: [] },
      { merchant: false, date: false, amount: true, invoice: false, vat: false },
      candidate,
      formatReceiptDate,
      formatAmountInput
    );
    expect(next.amountText).toBe('63,42');
    expect(next.merchant).toBe('REWE Markt');
  });

  it('still allows a manual save when recognition fails', () => {
    expect(parseReceiptText('').status).toBe('failed');
    expect(parseReceiptText('').totalCents).toBeNull();
    expect(canSaveWithoutRecognition({
      type: 'firma',
      receiptDate: '2026-09-25',
      amountCents: 1500,
      recognitionStatus: 'failed',
    })).toBe(true);
  });

  it('leaves the amount empty when no payable total is labeled', () => {
    const vague = parseReceiptText('REWE\nMilch 1,29\nBrot 2,49');
    expect(vague.totalCents).toBeNull();
    expect(vague.status).toBe('needs_review');
    expect(vague.merchant).toBe('REWE');
  });
});
