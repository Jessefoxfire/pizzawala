export const COMPANY_CONFIG_ID = 'company';
export const COMPANY_TEAM_ID = 'team-1';

export type CompanyProfile = {
  teamId: string;
  // Name
  displayName: string;
  email: string;
  phone: string;
  address: string;
  // Legal
  legalName: string;
  legalForm: string;
  registeredOffice: string;
  registerCourt: string;
  registerNumber: string;
  // People
  managingDirector: string;
  invoiceContactName: string;
  invoiceContactEmail: string;
  invoiceContactPhone: string;
  // Tax
  taxNumber: string;
  vatId: string;
  smallBusiness: boolean;
  // Billing
  billingAddress: string;
  bankAccountHolder: string;
  iban: string;
  bic: string;
  paymentTerms: string;
  invoiceFooter: string;
  // Notes
  notes: string;
};

export const DEFAULT_COMPANY_PROFILE: CompanyProfile = {
  teamId: COMPANY_TEAM_ID,
  displayName: 'Pizza Wala',
  email: '',
  phone: '',
  address: '',
  legalName: '',
  legalForm: '',
  registeredOffice: '',
  registerCourt: '',
  registerNumber: '',
  managingDirector: '',
  invoiceContactName: '',
  invoiceContactEmail: '',
  invoiceContactPhone: '',
  taxNumber: '',
  vatId: '',
  smallBusiness: false,
  billingAddress: '',
  bankAccountHolder: '',
  iban: '',
  bic: '',
  paymentTerms: '',
  invoiceFooter: '',
  notes: '',
};

const asTrimmed = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const asBool = (value: unknown, fallback = false) => (typeof value === 'boolean' ? value : fallback);

export function readCompanyProfile(data: unknown): CompanyProfile {
  const raw = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const displayName = asTrimmed(raw.displayName) || DEFAULT_COMPANY_PROFILE.displayName;
  return {
    teamId: COMPANY_TEAM_ID,
    displayName,
    email: asTrimmed(raw.email),
    phone: asTrimmed(raw.phone),
    address: asTrimmed(raw.address),
    legalName: asTrimmed(raw.legalName),
    legalForm: asTrimmed(raw.legalForm),
    registeredOffice: asTrimmed(raw.registeredOffice),
    registerCourt: asTrimmed(raw.registerCourt),
    registerNumber: asTrimmed(raw.registerNumber),
    managingDirector: asTrimmed(raw.managingDirector),
    invoiceContactName: asTrimmed(raw.invoiceContactName),
    invoiceContactEmail: asTrimmed(raw.invoiceContactEmail),
    invoiceContactPhone: asTrimmed(raw.invoiceContactPhone),
    taxNumber: asTrimmed(raw.taxNumber),
    vatId: asTrimmed(raw.vatId),
    smallBusiness: asBool(raw.smallBusiness, false),
    billingAddress: asTrimmed(raw.billingAddress),
    bankAccountHolder: asTrimmed(raw.bankAccountHolder),
    iban: asTrimmed(raw.iban),
    bic: asTrimmed(raw.bic),
    paymentTerms: asTrimmed(raw.paymentTerms),
    invoiceFooter: asTrimmed(raw.invoiceFooter),
    notes: asTrimmed(raw.notes),
  };
}

export function companyProfileForSave(profile: CompanyProfile): CompanyProfile {
  if (!asTrimmed(profile.displayName)) {
    throw new Error('Display name is required.');
  }
  return readCompanyProfile(profile);
}
