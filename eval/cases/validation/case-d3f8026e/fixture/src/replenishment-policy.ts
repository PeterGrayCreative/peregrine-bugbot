export interface StockPosition {
  sku: string;
  available: number;
  inbound: number;
  averageDailyDemand: number;
}

export interface ReplenishmentRule {
  sku: string;
  leadTimeDays: number;
  reviewPeriodDays: number;
  safetyStockDays: number;
  minimumOrderQuantity: number;
  orderMultiple: number;
}

export interface ReplenishmentRecommendation {
  sku: string;
  reorderPoint: number;
  targetStock: number;
  recommendedQuantity: number;
}

export function recommendReplenishment(
  position: StockPosition,
  rule: ReplenishmentRule,
): ReplenishmentRecommendation | null {
  for (const value of [position.available, position.inbound, position.averageDailyDemand]) {
    if (!Number.isFinite(value) || value < 0) throw new Error("invalid stock position");
  }
  for (const value of [rule.leadTimeDays, rule.reviewPeriodDays, rule.safetyStockDays]) {
    if (!Number.isFinite(value) || value < 0) throw new Error("invalid replenishment duration");
  }
  if (!Number.isSafeInteger(rule.minimumOrderQuantity) || rule.minimumOrderQuantity <= 0) throw new Error("invalid minimum order");
  if (!Number.isSafeInteger(rule.orderMultiple) || rule.orderMultiple <= 0) throw new Error("invalid order multiple");
  const reorderPoint = Math.ceil(position.averageDailyDemand * (rule.leadTimeDays + rule.safetyStockDays));
  const effectiveStock = position.available + position.inbound;
  if (effectiveStock > reorderPoint) return null;
  const targetStock = Math.ceil(position.averageDailyDemand * (rule.leadTimeDays + rule.reviewPeriodDays + rule.safetyStockDays));
  const shortfall = Math.max(rule.minimumOrderQuantity, targetStock - effectiveStock);
  const recommendedQuantity = Math.ceil(shortfall / rule.orderMultiple) * rule.orderMultiple;
  return { sku: position.sku, reorderPoint, targetStock, recommendedQuantity };
}

export function prioritizeReplenishment(items: ReplenishmentRecommendation[]): ReplenishmentRecommendation[] {
  return [...items].sort((left, right) =>
    (right.targetStock - right.reorderPoint) - (left.targetStock - left.reorderPoint) || left.sku.localeCompare(right.sku));
}
