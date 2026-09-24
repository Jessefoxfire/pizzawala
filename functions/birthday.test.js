const test = require('node:test');
const assert = require('node:assert/strict');
const {
  birthdayMonthDay,
  datePartsInTimeZone,
  dateKeyFromParts,
  firstName,
  birthdayNotificationTitle,
} = require('./birthday');

test('birthdayMonthDay accepts current and legacy profile formats', () => {
  assert.deepEqual(birthdayMonthDay('1990-09-21'), { month: 9, day: 21 });
  assert.deepEqual(birthdayMonthDay('21.09.1990'), { month: 9, day: 21 });
  assert.deepEqual(birthdayMonthDay('2000-02-29'), { month: 2, day: 29 });
});

test('birthdayMonthDay rejects missing and invalid dates', () => {
  assert.equal(birthdayMonthDay(''), null);
  assert.equal(birthdayMonthDay('2020-02-31'), null);
  assert.equal(birthdayMonthDay('31.11.2020'), null);
  assert.equal(birthdayMonthDay('not-a-date'), null);
});

test('Berlin date parts produce a stable notification key', () => {
  const parts = datePartsInTimeZone(new Date('2026-09-20T22:30:00.000Z'), 'Europe/Berlin');
  assert.deepEqual(parts, { year: 2026, month: 9, day: 21 });
  assert.equal(dateKeyFromParts(parts), '2026-09-21');
});

test('firstName uses the first non-empty name segment', () => {
  assert.equal(firstName('  Dylan Imhoff  '), 'Dylan');
  assert.equal(firstName(''), '');
  assert.equal(birthdayNotificationTitle('Dylan Imhoff'), "It's Dylan's birthday!");
});
