import {
  GERMAN_COMPLIANCE_REQUIRED_DOCUMENT_TYPES,
  SALUTATION_OPTIONS,
  getMissingComplianceFields,
  getRequiredDocumentTypesForUser,
} from '../src/constants/germanEmployeeCompliance';

describe('German employee compliance requirements', () => {
  it('requires the requested fields without making address mandatory', () => {
    expect(getMissingComplianceFields({})).toEqual([
      'Title (Mr / Mrs / Other)',
      'Birthday',
      'Birthplace',
      'German social security number',
      'Tax ID number',
    ]);
    expect(getMissingComplianceFields({
      salutation: 'Other',
      birthDate: '2000-01-01',
      birthPlace: 'Berlin',
      socialSecurityNumber: '12 345678 A 123',
      taxIdNumber: '12345678901',
    })).toEqual([]);
  });

  it('requires only ID front, ID back, and health insurance by default', () => {
    expect(SALUTATION_OPTIONS).toEqual(['Mr', 'Mrs', 'Other']);
    expect(GERMAN_COMPLIANCE_REQUIRED_DOCUMENT_TYPES).toEqual([
      'Identification (passport / EU ID card) — front',
      'Identification (passport / EU ID card) — back',
      'Health insurance proof',
    ]);
    expect(getRequiredDocumentTypesForUser()).toEqual(GERMAN_COMPLIANCE_REQUIRED_DOCUMENT_TYPES);
  });
});
