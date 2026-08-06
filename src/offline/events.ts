type OutboxListener = () => void;

const outboxListeners = new Set<OutboxListener>();

export function subscribeOutboxChanges(listener: OutboxListener): () => void {
  outboxListeners.add(listener);
  return () => outboxListeners.delete(listener);
}

export function notifyOutboxChanged(): void {
  outboxListeners.forEach(listener => listener());
}
