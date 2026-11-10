import { DEFAULT_COMPANY_PROFILE, companyProfileForSave, readCompanyProfile } from '../src/utils/companyProfile';

describe('company profile', () => {
  it('defaults to Pizza Wala on team-1 with empty extras', () => {
    expect(readCompanyProfile(null)).toEqual(DEFAULT_COMPANY_PROFILE);
    expect(DEFAULT_COMPANY_PROFILE.displayName).toBe('Pizza Wala');
    expect(DEFAULT_COMPANY_PROFILE.teamId).toBe('team-1');
    expect(DEFAULT_COMPANY_PROFILE.smallBusiness).toBe(false);
    expect(DEFAULT_COMPANY_PROFILE.legalName).toBe('');
    expect(DEFAULT_COMPANY_PROFILE.vatId).toBe('');
    expect(DEFAULT_COMPANY_PROFILE.iban).toBe('');
    expect(readCompanyProfile({ displayName: '  ', teamId: 'other' }).displayName).toBe('Pizza Wala');
    expect(readCompanyProfile({ teamId: 'other' }).teamId).toBe('team-1');
    expect(readCompanyProfile({ displayName: 'Pizza Wala' }).legalName).toBe('');
  });

  it('locks teamId and treats extra strings as optional', () => {
    const read = readCompanyProfile({
      teamId: 'someone-else',
      displayName: 'Pizza Wala',
      legalName: '  Michaud & Imhoff GbR  ',
      smallBusiness: true,
    });
    expect(read.teamId).toBe('team-1');
    expect(read.displayName).toBe('Pizza Wala');
    expect(read.legalName).toBe('Michaud & Imhoff GbR');
    expect(read.smallBusiness).toBe(true);
    expect(read.managingDirector).toBe('');
    expect(read.invoiceFooter).toBe('');
  });

  it('trims fields and requires display name, not company name, to save', () => {
    const saved = companyProfileForSave({
      ...DEFAULT_COMPANY_PROFILE,
      displayName: '  Pizza Wala  ',
      legalName: '',
      email: ' office@pizzawala.com ',
      vatId: ' DE123456789 ',
      iban: ' de89 3704 0044 0532 0130 00 ',
      teamId: 'other',
    });
    expect(saved.displayName).toBe('Pizza Wala');
    expect(saved.legalName).toBe('');
    expect(saved.email).toBe('office@pizzawala.com');
    expect(saved.vatId).toBe('DE123456789');
    expect(saved.iban).toBe('de89 3704 0044 0532 0130 00');
    expect(saved.teamId).toBe('team-1');
    expect(saved.smallBusiness).toBe(false);
    expect(() => companyProfileForSave({ ...DEFAULT_COMPANY_PROFILE, displayName: '   ' })).toThrow(
      'Display name is required.'
    );
  });
});
