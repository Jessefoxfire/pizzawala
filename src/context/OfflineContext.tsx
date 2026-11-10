import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { deviceLooksOnline, subscribeConnectionDegraded, subscribeConnectivity } from '../offline/connectivity';
import { getOutboxCount, loadOutbox } from '../offline/outbox';
import { subscribeOutboxChanges } from '../offline/events';
import { flushOutbox } from '../offline/sync';
import { preloadOfflineData } from '../offline/preload';
import { nativeAuth } from '../services/firebase';

type OfflineContextValue = {
  isOnline: boolean;
  /** True after a needed request timed out or the radio dropped. Home shows “offline”. */
  offlineHint: boolean;
  pendingCount: number;
  syncing: boolean;
  /** @deprecated Use offlineHint. Kept so older screens compile. */
  syncBannerVisible: boolean;
  refreshPendingCount: () => Promise<void>;
  syncNow: () => Promise<void>;
};

const OfflineContext = createContext<OfflineContextValue>({
  isOnline: true,
  offlineHint: false,
  pendingCount: 0,
  syncing: false,
  syncBannerVisible: false,
  refreshPendingCount: async () => {},
  syncNow: async () => {},
});

const AUTO_SYNC_COOLDOWN_MS = 3000;
const OUTBOX_SYNC_DEBOUNCE_MS = 250;

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [offlineHint, setOfflineHint] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  const isOnlineRef = useRef(true);
  const lastAutoSyncAtRef = useRef(0);
  const pendingRefreshRef = useRef<Promise<void> | null>(null);
  const outboxSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootSyncDoneRef = useRef(false);

  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  const refreshPendingCount = useCallback(async () => {
    if (pendingRefreshRef.current) return pendingRefreshRef.current;

    pendingRefreshRef.current = (async () => {
      const count = await getOutboxCount();
      setPendingCount(count);
    })().finally(() => {
      pendingRefreshRef.current = null;
    });

    return pendingRefreshRef.current;
  }, []);

  const syncNow = useCallback(async () => {
    if (syncingRef.current) return;
    if (!isOnlineRef.current) return;

    syncingRef.current = true;
    setSyncing(true);
    try {
      await flushOutbox();
      await refreshPendingCount();
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [refreshPendingCount]);

  const runAutoSync = useCallback(
    (force = false) => {
      if (!isOnlineRef.current) return;
      const now = Date.now();
      if (!force && now - lastAutoSyncAtRef.current < AUTO_SYNC_COOLDOWN_MS) return;
      lastAutoSyncAtRef.current = now;
      void syncNow();
    },
    [syncNow]
  );

  const scheduleOutboxSync = useCallback(() => {
    if (outboxSyncTimerRef.current) clearTimeout(outboxSyncTimerRef.current);
    outboxSyncTimerRef.current = setTimeout(() => {
      outboxSyncTimerRef.current = null;
      runAutoSync(true);
    }, OUTBOX_SYNC_DEBOUNCE_MS);
  }, [runAutoSync]);

  useEffect(() => {
    return subscribeConnectionDegraded(setOfflineHint);
  }, []);

  useEffect(() => {
    return subscribeConnectivity(nextOnline => {
      setIsOnline(nextOnline);
      if (nextOnline) {
        runAutoSync(true);
      }
    });
  }, [runAutoSync]);

  useEffect(() => {
    return subscribeOutboxChanges(() => {
      void refreshPendingCount();
      scheduleOutboxSync();
    });
  }, [refreshPendingCount, scheduleOutboxSync]);

  useEffect(() => {
    void (async () => {
      await refreshPendingCount();
      if (!bootSyncDoneRef.current) {
        bootSyncDoneRef.current = true;
        runAutoSync(true);
      }
    })();
  }, [refreshPendingCount, runAutoSync]);

  useEffect(() => {
    const unsub = nativeAuth().onAuthStateChanged(user => {
      if (user?.uid) {
        void preloadOfflineData(user.uid);
        runAutoSync(true);
      }
    });
    return unsub;
  }, [runAutoSync]);

  useEffect(() => {
    const onStateChange = (state: AppStateStatus) => {
      if (state === 'active') {
        runAutoSync(false);
      }
    };
    const sub = AppState.addEventListener('change', onStateChange);
    return () => sub.remove();
  }, [runAutoSync]);

  useEffect(() => {
    if (!isOnline || pendingCount === 0 || syncing) return;
    const retryTimer = setInterval(() => runAutoSync(true), 12000);
    return () => clearInterval(retryTimer);
  }, [isOnline, pendingCount, syncing, runAutoSync]);

  useEffect(() => {
    if (!offlineHint) return;
    const retryTimer = setInterval(() => {
      void (async () => {
        const online = await deviceLooksOnline();
        if (online) runAutoSync(true);
      })();
    }, 12000);
    return () => clearInterval(retryTimer);
  }, [offlineHint, runAutoSync]);

  useEffect(
    () => () => {
      if (outboxSyncTimerRef.current) clearTimeout(outboxSyncTimerRef.current);
    },
    []
  );

  const value = useMemo(
    () => ({
      isOnline,
      offlineHint,
      pendingCount,
      syncing,
      syncBannerVisible: offlineHint,
      refreshPendingCount,
      syncNow,
    }),
    [isOnline, offlineHint, pendingCount, syncing, refreshPendingCount, syncNow]
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline() {
  return useContext(OfflineContext);
}

export async function getPendingTemperatureLogs() {
  const items = await loadOutbox();
  return items
    .filter(item => item.type === 'temperature_log')
    .map(item => ({
      id: `pending-${item.id}`,
      pendingSync: true,
      targetKey: item.payload.targetKey,
      targetLabel: item.payload.targetLabel,
      temperatureValue: item.payload.temperatureValue,
      temperatureUnit: item.payload.temperatureUnit,
      notes: item.payload.notes,
      loggedAtIso: item.payload.loggedAtIso,
      dateKey: item.payload.dateKey,
      monthKey: item.payload.monthKey,
      userName: item.payload.actor.userName,
    }));
}
