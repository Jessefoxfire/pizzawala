export type BirthdayMonthDay = { month: number; day: number };

export function birthdayMonthDay(value: unknown): BirthdayMonthDay | null {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  const german = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(input);
  const month = iso ? Number(iso[2]) : german ? Number(german[2]) : Number.NaN;
  const day = iso ? Number(iso[3]) : german ? Number(german[1]) : Number.NaN;

  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const validationDate = new Date(Date.UTC(2024, month - 1, day));
  if (validationDate.getUTCMonth() !== month - 1 || validationDate.getUTCDate() !== day) return null;
  return { month, day };
}

export function isBirthdayToday(value: unknown, today = new Date()): boolean {
  const birthday = birthdayMonthDay(value);
  return birthday?.month === today.getMonth() + 1 && birthday?.day === today.getDate();
}

export function localDateKey(value = new Date()): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

export function firstName(value: unknown): string {
  return typeof value === 'string' ? value.trim().split(/\s+/)[0] || '' : '';
}

export function birthdayGreetingMessage(value: unknown): string {
  const name = firstName(value);
  return name
    ? `Happy Birthday from team Pizza Wala ${name}!`
    : 'Happy Birthday from team Pizza Wala!';
}
