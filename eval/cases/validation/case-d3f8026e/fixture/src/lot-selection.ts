export interface InventoryLot {
  lotId: string;
  sku: string;
  available: number;
  receivedAt: string;
  expiresAt: string | null;
  quarantined: boolean;
}

export interface LotAllocation {
  lotId: string;
  quantity: number;
}

function lotOrder(left: InventoryLot, right: InventoryLot): number {
  const leftExpiry = left.expiresAt ? Date.parse(left.expiresAt) : Number.MAX_SAFE_INTEGER;
  const rightExpiry = right.expiresAt ? Date.parse(right.expiresAt) : Number.MAX_SAFE_INTEGER;
  return leftExpiry - rightExpiry || left.receivedAt.localeCompare(right.receivedAt) || left.lotId.localeCompare(right.lotId);
}

export function selectLots(lots: InventoryLot[], sku: string, quantity: number, nowMs: number): LotAllocation[] {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("invalid allocation quantity");
  let remaining = quantity;
  const allocations: LotAllocation[] = [];
  const eligible = lots
    .filter((lot) => lot.sku === sku && !lot.quarantined && lot.available > 0)
    .filter((lot) => lot.expiresAt === null || Date.parse(lot.expiresAt) > nowMs)
    .sort(lotOrder);
  for (const lot of eligible) {
    const allocated = Math.min(lot.available, remaining);
    allocations.push({ lotId: lot.lotId, quantity: allocated });
    remaining -= allocated;
    if (remaining === 0) break;
  }
  if (remaining > 0) throw new Error(`insufficient eligible stock: ${sku}`);
  return allocations;
}

export function allocatedQuantity(allocations: LotAllocation[]): number {
  return allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
}

export function allocationByLot(allocations: LotAllocation[]): Map<string, number> {
  return new Map(allocations.map((allocation) => [allocation.lotId, allocation.quantity]));
}
