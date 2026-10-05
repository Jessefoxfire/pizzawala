export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && validIso(value) === value;
}

export function parseReceiptDate(input: string): string | null {
  const text = String(input || '').trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return validIso(`${iso[1]}-${iso[2]}-${iso[3]}`);
  const local = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/);
  if (!local) return null;
  const day = local[1].padStart(2, '0');
  const month = local[2].padStart(2, '0');
  let year = local[3];
  if (year.length === 2) {
    const yy = Number(year);
    year = String(yy >= 70 ? 1900 + yy : 2000 + yy);
  }
  return validIso(`${year}-${month}-${day}`);
}

export function formatReceiptDate(iso: string | null | undefined): string {
  if (!iso || !isIsoDate(iso)) return '';
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

export function monthKeyFromIso(iso: string | null | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}/.test(iso)) return null;
  const key = iso.slice(0, 7);
  const month = Number(key.slice(5, 7));
  if (month < 1 || month > 12) return null;
  return key;
}

export function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function monthTitle(monthKey: string): string {
  const month = Number(monthKey.slice(5, 7));
  const year = monthKey.slice(0, 4);
  return `${MONTH_NAMES[month - 1] || monthKey} ${year}`;
}

function validIso(iso: string): string | null {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return iso;
}
