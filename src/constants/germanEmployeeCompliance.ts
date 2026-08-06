export type Salutation = 'Mr' | 'Ms' | 'Mrs';

export type GermanComplianceProfile = {
  salutation?: Salutation | '';
  address?: string;
  birthDate?: string;
  birthPlace?: string;
  socialSecurityNumber?: string;
  taxIdNumber?: string;
};

export const GERMAN_COMPLIANCE_INTRO =
  'This information is required by German law for employment records. Please complete your details and upload each document below.';

export const CHECKLIST_HELP =
  'This is a German government requirement for all employees. Upload the completed and signed employee checklist provided by your employer.';

export const GERMAN_COMPLIANCE_FIELDS: Array<{
  key: keyof GermanComplianceProfile;
  label: string;
  placeholder: string;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words';
  keyboardType?: 'default' | 'numeric';
}> = [
  { key: 'address', label: 'Address', placeholder: 'Street, postal code, city', multiline: true },
  { key: 'birthDate', label: 'Birth date', placeholder: 'YYYY-MM-DD' },
  { key: 'birthPlace', label: 'Birthplace', placeholder: 'City, country' },
  {
    key: 'socialSecurityNumber',
    label: 'German social security number',
    placeholder: 'e.g. 12 345678 A 123',
  },
  {
    key: 'taxIdNumber',
    label: 'Tax ID number (Steuer-ID)',
    placeholder: '11-digit tax ID',
    keyboardType: 'numeric',
  },
];

export const GERMAN_COMPLIANCE_DOCUMENTS = [
  {
    type: 'Identification (passport / EU ID card) — front',
    shortLabel: 'ID — front',
  },
  {
    type: 'Identification (passport / EU ID card) — back',
    shortLabel: 'ID — back',
  },
  {
    type: 'Health insurance proof',
    shortLabel: 'Health insurance',
  },
  {
    type: 'Signed checklist',
    shortLabel: 'Signed checklist',
    helpTitle: 'Signed checklist',
    helpText: CHECKLIST_HELP,
  },
  {
    type: 'Signed contract',
    shortLabel: 'Signed contract',
  },
] as const;

export const GERMAN_COMPLIANCE_DOCUMENT_TYPES = GERMAN_COMPLIANCE_DOCUMENTS.map(doc => doc.type);

export const SALUTATION_OPTIONS: Salutation[] = ['Mr', 'Ms', 'Mrs'];

export function readGermanCompliance(data: Record<string, unknown> | null | undefined): GermanComplianceProfile {
  const raw = data?.germanCompliance;
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const typed = raw as GermanComplianceProfile;
  return {
    salutation: typed.salutation || '',
    address: typed.address || '',
    birthDate: typed.birthDate || '',
    birthPlace: typed.birthPlace || '',
    socialSecurityNumber: typed.socialSecurityNumber || '',
    taxIdNumber: typed.taxIdNumber || '',
  };
}

export function getMissingComplianceFields(compliance: GermanComplianceProfile) {
  const missing: string[] = [];
  if (!compliance.salutation) missing.push('Title (Mr / Ms / Mrs)');
  if (!String(compliance.address || '').trim()) missing.push('Address');
  if (!String(compliance.birthDate || '').trim()) missing.push('Birth date');
  if (!String(compliance.birthPlace || '').trim()) missing.push('Birthplace');
  if (!String(compliance.socialSecurityNumber || '').trim()) missing.push('German social security number');
  if (!String(compliance.taxIdNumber || '').trim()) missing.push('Tax ID number');
  return missing;
}

export function getRequiredDocumentTypesForUser(requiredDocuments?: string[] | null) {
  const extra = Array.isArray(requiredDocuments)
    ? requiredDocuments.map(value => String(value || '').trim()).filter(Boolean)
    : [];
  return Array.from(new Set([...GERMAN_COMPLIANCE_DOCUMENT_TYPES, ...extra]));
}

export function getMissingRequiredDocuments(
  requiredDocuments: string[],
  credentials: Array<{ requiredDocumentType?: string | null }>
) {
  const uploaded = new Set(
    credentials.map(item => String(item.requiredDocumentType || '').trim()).filter(Boolean)
  );
  return requiredDocuments.filter(docType => !uploaded.has(docType));
}
