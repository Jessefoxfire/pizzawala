let pendingOpen: Record<string, unknown> | null = null;

export function setPendingNotificationOpen(data: Record<string, unknown> | null) {
  pendingOpen = data;
}

export function takePendingNotificationOpen(): Record<string, unknown> | null {
  const next = pendingOpen;
  pendingOpen = null;
  return next;
}
