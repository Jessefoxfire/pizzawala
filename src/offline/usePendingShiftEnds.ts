import { useEffect, useState } from 'react';
import { subscribeOutboxChanges } from './events';
import { getPendingShiftEnds } from './outbox';
import type { PendingShiftEnd } from './types';

export function usePendingShiftEnds(): PendingShiftEnd[] {
  const [ends, setEnds] = useState<PendingShiftEnd[]>([]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const next = await getPendingShiftEnds();
      if (!cancelled) setEnds(next);
    };
    void refresh();
    const unsub = subscribeOutboxChanges(() => {
      void refresh();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return ends;
}
