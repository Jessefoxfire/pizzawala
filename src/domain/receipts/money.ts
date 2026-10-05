const CURRENCY = /€|\bEUR\b/gi;

/**
 * Parse a money string into integer euro cents.
 * German and US groupings are both accepted. Empty or ambiguous text returns null.
 */
export function parseMoneyToCents(input: string): number | null {
  const raw = String(input || '')
    .replace(CURRENCY, '')
    .replace(/\s+/g, '')
    .trim();
  if (!raw || !/\d/.test(raw)) return null;
  if (/[^0-9.,]/.test(raw)) return null;

  const normalized = normalizeMoney(raw);
  if (!normalized) return null;
  const [whole, frac] = normalized.split('.');
  if (!/^\d+$/.test(whole) || !/^\d{2}$/.test(frac)) return null;
  if (whole.length > 9) return null;
  const cents = Number(whole) * 100 + Number(frac);
  if (!Number.isSafeInteger(cents)) return null;
  return cents;
}

function normalizeMoney(raw: string): string | null {
  const hasDot = raw.includes('.');
  const hasComma = raw.includes(',');

  if (hasDot && hasComma) {
    const lastDot = raw.lastIndexOf('.');
    const lastComma = raw.lastIndexOf(',');
    const decimalSep = lastDot > lastComma ? '.' : ',';
    const thousandsSep = decimalSep === '.' ? ',' : '.';
    const parts = raw.split(decimalSep);
    if (parts.length !== 2 || !/^\d{1,2}$/.test(parts[1])) return null;
    const whole = parts[0].split(thousandsSep).join('');
    if (!/^\d+$/.test(whole) || parts[0].split(thousandsSep).some(part => part.length === 0)) return null;
    return `${whole}.${parts[1].padEnd(2, '0')}`;
  }

  const sep = hasComma ? ',' : hasDot ? '.' : null;
  if (!sep) {
    if (!/^\d+$/.test(raw)) return null;
    return `${raw}.00`;
  }

  const pieces = raw.split(sep);
  if (pieces.some(part => !/^\d+$/.test(part) || part.length === 0)) return null;
  const last = pieces[pieces.length - 1];

  if (pieces.length > 2) {
    if (last.length === 3 && pieces.every(part => part.length <= 3)) return `${pieces.join('')}.00`;
    if (last.length <= 2 && pieces.slice(0, -1).every(part => part.length <= 3)) {
      return `${pieces.slice(0, -1).join('')}.${last.padEnd(2, '0')}`;
    }
    return null;
  }

  if (last.length === 3 && pieces[0].length <= 3) return `${pieces.join('')}.00`;
  if (last.length <= 2) return `${pieces[0]}.${last.padEnd(2, '0')}`;
  return null;
}

export function formatAmountInput(cents: number): string {
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cents < 0 ? '-' : ''}${grouped},${frac}`;
}

export function formatEuro(cents: number): string {
  return `${formatAmountInput(cents)} €`;
}

export function formatReceiptAmount(cents: number | null | undefined): string {
  if (cents == null || !Number.isInteger(cents)) return '—';
  return formatEuro(cents);
}
