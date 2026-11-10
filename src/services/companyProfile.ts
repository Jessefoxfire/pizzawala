import { doc, getFirestore, onSnapshot, serverTimestamp, setDoc } from '@react-native-firebase/firestore';
import {
  COMPANY_CONFIG_ID,
  companyProfileForSave,
  readCompanyProfile,
  type CompanyProfile,
} from '../utils/companyProfile';

export function subscribeCompanyProfile(
  onChange: (profile: CompanyProfile) => void,
  onError: (message: string) => void
): () => void {
  return onSnapshot(
    doc(getFirestore(), 'appConfig', COMPANY_CONFIG_ID),
    snap => {
      onChange(readCompanyProfile(snap.exists() ? snap.data() : null));
    },
    err => {
      onError(err?.message || 'Unable to load company details.');
    }
  );
}

export async function saveCompanyProfile(profile: CompanyProfile): Promise<void> {
  const next = companyProfileForSave(profile);
  await setDoc(
    doc(getFirestore(), 'appConfig', COMPANY_CONFIG_ID),
    {
      ...next,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
