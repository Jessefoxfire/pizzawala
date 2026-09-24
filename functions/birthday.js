const BIRTHDAY_DATE_PATTERNS = [
  /^(\d{4})-(\d{2})-(\d{2})$/,
  /^(\d{2})\.(\d{2})\.(\d{4})$/,
];

/**
 * Accept the ISO format written by the current date picker and the older
 * German display format used by existing profiles.
 * @param {unknown} value
 * @returns {{ month: number, day: number } | null}
 */
function birthdayMonthDay(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  let month;
  let day;

  const iso = BIRTHDAY_DATE_PATTERNS[0].exec(input);
  if (iso) {
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    const german = BIRTHDAY_DATE_PATTERNS[1].exec(input);
    if (!german) return null;
    day = Number(german[1]);
    month = Number(german[2]);
  }

  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const validationDate = new Date(Date.UTC(2024, month - 1, day));
  if (validationDate.getUTCMonth() !== month - 1 || validationDate.getUTCDate() !== day) return null;
  return { month, day };
}

/** @param {Date} value @param {string} timeZone */
function datePartsInTimeZone(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const read = type => Number(parts.find(part => part.type === type)?.value || 0);
  return { year: read('year'), month: read('month'), day: read('day') };
}

/** @param {{ year: number, month: number, day: number }} parts */
function dateKeyFromParts(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/** @param {unknown} value */
function firstName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().split(/\s+/)[0] || '';
}

/** @param {unknown} value */
function birthdayNotificationTitle(value) {
  const name = firstName(value) || 'A team member';
  return `It's ${name}'s birthday!`;
}

module.exports = {
  birthdayMonthDay,
  datePartsInTimeZone,
  dateKeyFromParts,
  firstName,
  birthdayNotificationTitle,
};
