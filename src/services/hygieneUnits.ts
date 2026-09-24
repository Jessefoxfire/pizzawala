import { doc, getFirestore, onSnapshot, setDoc } from '@react-native-firebase/firestore';

export type CoolingUnit = { key: string; label: string };

export const DEFAULT_COOLING_UNITS: CoolingUnit[] = [
  { key: 'truck_fridge', label: 'Truck fridge' },
  { key: 'truck_top_cooler', label: 'Truck top cooler' },
  { key: 'tent_top_cooler', label: 'Tent top cooler' },
  { key: 'cool_trailer', label: 'Cool trailer' },
];

const settingsRef = (teamId: string) => doc(getFirestore(), 'hygieneSettings', teamId);

export function subscribeCoolingUnits(teamId: string, onChange: (units: CoolingUnit[]) => void) {
  return onSnapshot(settingsRef(teamId), snapshot => {
    const stored = snapshot.data()?.coolingUnits;
    onChange(Array.isArray(stored) && stored.every(unit => unit?.key && unit?.label) ? stored : DEFAULT_COOLING_UNITS);
  });
}

export async function saveCoolingUnits(teamId: string, units: CoolingUnit[]) {
  await setDoc(settingsRef(teamId), { coolingUnits: units }, { merge: true });
}
