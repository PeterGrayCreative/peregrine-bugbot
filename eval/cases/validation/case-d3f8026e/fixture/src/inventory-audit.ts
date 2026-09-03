export interface AuditActor {
  actorId: string;
  actorType: "user" | "service" | "system";
}

export interface InventoryAuditEntry {
  eventId: string;
  occurredAt: string;
  actor: AuditActor;
  action: string;
  warehouseId: string;
  sku: string | null;
  attributes: Record<string, string | number | boolean | null>;
}

export function createAuditEntry(entry: InventoryAuditEntry): InventoryAuditEntry {
  if (!entry.eventId.trim() || !entry.actor.actorId.trim() || !entry.action.trim()) throw new Error("audit identity is incomplete");
  if (!Number.isFinite(Date.parse(entry.occurredAt))) throw new Error("invalid audit timestamp");
  if (!entry.warehouseId.trim()) throw new Error("warehouse is required");
  return structuredClone(entry);
}

export function auditEntriesForSku(entries: InventoryAuditEntry[], sku: string): InventoryAuditEntry[] {
  return entries
    .filter((entry) => entry.sku === sku)
    .map(createAuditEntry)
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId));
}

export function summarizeAuditActions(entries: InventoryAuditEntry[]): Map<string, number> {
  const summary = new Map<string, number>();
  for (const entry of entries) summary.set(entry.action, (summary.get(entry.action) ?? 0) + 1);
  return summary;
}

export function serializeAuditEntry(entry: InventoryAuditEntry): string {
  const safe = createAuditEntry(entry);
  return JSON.stringify({
    ...safe,
    attributes: Object.fromEntries(Object.entries(safe.attributes).sort(([left], [right]) => left.localeCompare(right))),
  });
}

export function latestAuditEntry(entries: InventoryAuditEntry[]): InventoryAuditEntry | null {
  return [...entries].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0] ?? null;
}
