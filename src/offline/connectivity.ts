import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

const listeners = new Set<(online: boolean) => void>();
const degradedListeners = new Set<(degraded: boolean) => void>();
let cachedOnline = true;
let connectionDegraded = false;

function stateIsOnline(state: NetInfoState | null): boolean {
  if (!state) return true;
  // isInternetReachable is often false/null on Android while data still works.
  if (state.isConnected === false) return false;
  return true;
}

export async function isDeviceOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  cachedOnline = stateIsOnline(state);
  if (!cachedOnline) markConnectionDegraded();
  else markConnectionHealthy();
  return cachedOnline;
}

export function getCachedOnline(): boolean {
  return cachedOnline;
}

/** False if NetInfo hangs — treat as offline so clock-in/out is not blocked. */
export async function deviceLooksOnline(timeoutMs = 2500): Promise<boolean> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      isDeviceOnline(),
      new Promise<never>((_, reject) => {
        handle = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
  } catch {
    markConnectionDegraded();
    return false;
  } finally {
    if (handle) clearTimeout(handle);
  }
}

export function getConnectionDegraded(): boolean {
  return connectionDegraded;
}

/**
 * When Home shows gray “offline”, probe before a user write.
 * true = recovered (write online / flush). false = not degraded, or still offline.
 */
export async function probeDegradedConnection(timeoutMs = 2500): Promise<boolean> {
  if (!connectionDegraded) return false;
  const online = await deviceLooksOnline(timeoutMs);
  if (!online) return false;
  markConnectionHealthy();
  return true;
}

/** A needed request timed out or the radio is down — show Home “offline”. */
export function markConnectionDegraded() {
  if (connectionDegraded) return;
  connectionDegraded = true;
  degradedListeners.forEach(listener => listener(true));
}

/** A needed request succeeded — hide “offline” with no “online” toast. */
export function markConnectionHealthy() {
  if (!connectionDegraded) return;
  connectionDegraded = false;
  degradedListeners.forEach(listener => listener(false));
}

export function subscribeConnectionDegraded(onChange: (degraded: boolean) => void): () => void {
  degradedListeners.add(onChange);
  onChange(connectionDegraded);
  return () => {
    degradedListeners.delete(onChange);
  };
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
