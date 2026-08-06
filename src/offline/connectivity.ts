import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

const listeners = new Set<(online: boolean) => void>();
let cachedOnline = true;

function stateIsOnline(state: NetInfoState | null): boolean {
  if (!state) return true;
  // isInternetReachable is often false/null on Android while data still works.
  if (state.isConnected === false) return false;
  return true;
}

export async function isDeviceOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  cachedOnline = stateIsOnline(state);
  return cachedOnline;
}

export function getCachedOnline(): boolean {
  return cachedOnline;
}

export function subscribeConnectivity(onChange: (online: boolean) => void): () => void {
  listeners.add(onChange);
  void isDeviceOnline().then(onChange);

  const unsub = NetInfo.addEventListener(state => {
    const next = stateIsOnline(state);
    if (next === cachedOnline) return;
    cachedOnline = next;
    listeners.forEach(listener => listener(next));
  });

  return () => {
    listeners.delete(onChange);
    unsub();
  };
}
