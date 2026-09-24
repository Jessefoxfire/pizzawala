import {
  birthdayGreetingMessage,
  birthdayMonthDay,
  firstName,
  isBirthdayToday,
  localDateKey,
} from '../src/utils/birthday';

describe('birthday utilities', () => {
  it('accepts ISO and legacy German birthday formats', () => {
    expect(birthdayMonthDay('1990-09-21')).toEqual({ month: 9, day: 21 });
    expect(birthdayMonthDay('21.09.1990')).toEqual({ month: 9, day: 21 });
  });

  it('rejects invalid dates', () => {
    expect(birthdayMonthDay('2020-02-31')).toBeNull();
    expect(birthdayMonthDay('31.11.2020')).toBeNull();
    expect(birthdayMonthDay('')).toBeNull();
  });

  it('matches the local calendar day without considering the birth year', () => {
    expect(isBirthdayToday('1990-09-21', new Date(2026, 8, 21, 12))).toBe(true);
    expect(isBirthdayToday('1990-09-20', new Date(2026, 8, 21, 12))).toBe(false);
  });

  it('builds dismissal keys and first names', () => {
    expect(localDateKey(new Date(2026, 8, 21, 12))).toBe('2026-09-21');
    expect(firstName(' Dylan Imhoff ')).toBe('Dylan');
    expect(birthdayGreetingMessage('Dylan Imhoff')).toBe('Happy Birthday from team Pizza Wala Dylan!');
  });
});
