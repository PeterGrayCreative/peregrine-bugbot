export interface CountedStock {
  sku: string;
  warehouseId: string;
  systemQuantity: number;
  countedQuantity: number;
  countedAt: string;
}

export interface ReconciliationAdjustment {
  sku: string;
  warehouseId: string;
  delta: number;
  reason: "count-surplus" | "count-shortage";
  countedAt: string;
}

export function reconcileCount(count: CountedStock): ReconciliationAdjustment | null {
  if (!Number.isSafeInteger(count.systemQuantity) || count.systemQuantity < 0) throw new Error("invalid system quantity");
  if (!Number.isSafeInteger(count.countedQuantity) || count.countedQuantity < 0) throw new Error("invalid counted quantity");
  if (!Number.isFinite(Date.parse(count.countedAt))) throw new Error("invalid count timestamp");
  const delta = count.countedQuantity - count.systemQuantity;
  if (delta === 0) return null;
  return {
    sku: count.sku,
    warehouseId: count.warehouseId,
    delta,
    reason: delta > 0 ? "count-surplus" : "count-shortage",
    countedAt: count.countedAt,
  };
}

export function reconcileBatch(counts: CountedStock[]): ReconciliationAdjustment[] {
  const seen = new Set<string>();
  const adjustments: ReconciliationAdjustment[] = [];
  for (const count of counts) {
    const key = `${count.warehouseId}\0${count.sku}`;
    if (seen.has(key)) throw new Error(`duplicate count: ${count.sku}`);
    seen.add(key);
    const adjustment = reconcileCount(count);
    if (adjustment) adjustments.push(adjustment);
  }
  return adjustments;
}

export function netAdjustment(adjustments: ReconciliationAdjustment[]): number {
  return adjustments.reduce((total, adjustment) => total + adjustment.delta, 0);
}

export function reconciliationKey(adjustment: ReconciliationAdjustment): string {
  return `${adjustment.warehouseId}:${adjustment.sku}:${adjustment.countedAt}`;
}
