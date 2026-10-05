import { parseReceiptDate } from './dates';
import { parseMoneyToCents } from './money';
import { emptyCandidate, type ReceiptCandidate, type VatComponent } from './types';

const TOTAL_GROUPS: RegExp[] = [
  /endbetrag|zu zahlen|zahlbetrag|amount due|grand total|gesamtsumme|gesamtbetrag|rechnungsbetrag/,
  /gesamt|summe brutto|\bbrutto\b|\btotal\b/,
  /\bsumme\b/,
];

const SKIP_TOTAL = /zwischen|netto|gegeben|rueckgeld|ruckgeld|change|mwst|mehrwert|umsatzsteuer|\bsteuer\b|\bvat\b|\bust\b/;
const VAT_LINE = /mwst|mehrwert|umsatzsteuer|\bsteuer\b|\bvat\b|\bust\b/;
const KNOWN_RATES = new Set([0, 5, 7, 10, 16, 19]);

function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue');
}

function amountsInLine(line: string): number[] {
  const found: number[] = [];
  const pattern = /(?:€|\bEUR\b)?\s*(\d[\d.,]*)(?:\s*(?:€|\bEUR\b))?/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) {
    const token = match[1];
    const after = line.slice(match.index + match[0].length);
    if (/^\s*%/.test(after)) continue;
    if (!/[.,]\d{2}\b/.test(token) && !/€|\bEUR\b/i.test(match[0])) continue;
    if (/\d{4}/.test(token) && token.split(/[.,]/).some(part => part.length > 3)) continue;
    const cents = parseMoneyToCents(match[0]);
    if (cents == null || cents <= 0) continue;
    found.push(cents);
  }
  return found;
}

function lineHasAmount(line: string): number | null {
  const amounts = amountsInLine(line);
  return amounts.length ? amounts[amounts.length - 1] : null;
}

function findTotal(lines: string[]): { cents: number | null; confident: boolean } {
  let bestGroup = -1;
  let best: number[] = [];
  lines.forEach((line, index) => {
    const folded = fold(line);
    if (SKIP_TOTAL.test(folded)) return;
    const group = TOTAL_GROUPS.findIndex(pattern => pattern.test(folded));
    if (group < 0) return;
    const amount = lineHasAmount(line) ?? (lines[index + 1] ? lineHasAmount(lines[index + 1]) : null);
    if (amount == null) return;
    if (group < bestGroup || bestGroup < 0) {
      bestGroup = group;
      best = [amount];
      return;
    }
    if (group === bestGroup) best.push(amount);
  });
  if (!best.length) return { cents: null, confident: false };
  const unique = Array.from(new Set(best));
  return { cents: best[best.length - 1], confident: unique.length === 1 };
}

function findMerchant(lines: string[]): string | null {
  for (const line of lines) {
    const trimmed = line.trim();
    const folded = fold(trimmed);
    if (trimmed.length < 3 || trimmed.length > 60) continue;
    if (!/[a-z]/i.test(trimmed)) continue;
    if (parseReceiptDate(trimmed)) continue;
    if (VAT_LINE.test(folded) || TOTAL_GROUPS.some(pattern => pattern.test(folded))) continue;
    if (/kassenbon|quittung|rechnung|beleg|bon-nr|tel\.|telefon|www\.|http|uid|steuer|strasse|\bstr\.|datum|uhrzeit/.test(folded)) continue;
    if (/^\d{5}\b/.test(trimmed)) continue;
    return trimmed;
  }
  return null;
}

function findDate(text: string, lines: string[]): string | null {
  const labeled = text.match(/(?:datum|date)\s*[:\-]?\s*(\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  if (labeled) {
    const parsed = parseReceiptDate(labeled[1]);
    if (parsed) return parsed;
  }
  for (const line of lines) {
    const match = line.match(/(\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{4}-\d{2}-\d{2})/);
    if (!match) continue;
    const parsed = parseReceiptDate(match[1]);
    if (parsed) return parsed;
  }
  return null;
}

function findInvoiceNumber(text: string): string | null {
  const match = text.match(
    /(?:rechnungs?(?:nummer|nr\.?|no\.?)|beleg(?:nummer|nr\.?|-nr\.?)|bon(?:-|\s)?nr\.?|invoice(?:\s*(?:no\.?|number|#))?|rnr\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{2,})/i
  );
  return match ? match[1] : null;
}

function findVat(lines: string[]): VatComponent[] {
  const byRate = new Map<number, VatComponent>();
  lines.forEach(line => {
    if (!VAT_LINE.test(fold(line))) return;
    const rates = [...line.matchAll(/(\d{1,2})(?:[.,]00)?\s*%/g)];
    rates.forEach((rateMatch, index) => {
      const rate = Number(rateMatch[1]);
      if (!KNOWN_RATES.has(rate)) return;
      const start = (rateMatch.index || 0) + rateMatch[0].length;
      const end = rates[index + 1]?.index ?? line.length;
      const amounts = amountsInLine(line.slice(start, end));
      const next: VatComponent = { ratePercent: rate, taxCents: amounts[0] ?? null };
      const current = byRate.get(rate);
      if (!current || (current.taxCents == null && next.taxCents != null)) byRate.set(rate, next);
    });
  });
  return [...byRate.values()];
}

/** Turn OCR text into editable suggestions. Missing totals stay null. */
export function parseReceiptText(text: string): ReceiptCandidate {
  const cleaned = String(text || '').replace(/\r/g, '').trim();
  if (!cleaned) return emptyCandidate('failed');
  const lines = cleaned.split('\n').map(line => line.trim()).filter(Boolean);
  const total = findTotal(lines);
  const candidate: ReceiptCandidate = {
    merchant: findMerchant(lines),
    receiptDate: findDate(cleaned, lines),
    invoiceNumber: findInvoiceNumber(cleaned),
    totalCents: total.cents,
    currency: 'EUR',
    vatBreakdown: findVat(lines),
    status: total.cents != null && total.confident ? 'recognized' : 'needs_review',
  };
  return candidate;
}
