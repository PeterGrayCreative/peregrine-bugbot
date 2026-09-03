export interface QuotaChange {
  workspaceId: string;
  delta: number;
}

export function applyQuotaChanges(current: Map<string, number>, changes: QuotaChange[]): Map<string, number> {
  const next = new Map(current);
  for (const change of changes) {
    if (!Number.isSafeInteger(change.delta)) throw new Error("invalid delta");
    const value = (next.get(change.workspaceId) ?? 0) + change.delta;
    if (value < 0) throw new Error("quota cannot be negative");
    next.set(change.workspaceId, value);
  }
  return next;
}
