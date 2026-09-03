export interface InventoryMetricInput {
  sku: string;
  onHand: number;
  reserved: number;
  shippedLast30Days: number;
  stockoutHoursLast30Days: number;
}

export interface InventoryMetrics {
  sku: string;
  available: number;
  reservationRate: number;
  daysOfSupply: number | null;
  stockoutRate: number;
}

export function calculateInventoryMetrics(input: InventoryMetricInput): InventoryMetrics {
  for (const value of [input.onHand, input.reserved, input.shippedLast30Days, input.stockoutHoursLast30Days]) {
    if (!Number.isFinite(value) || value < 0) throw new Error("invalid metric input");
  }
  if (input.reserved > input.onHand) throw new Error("reserved stock exceeds on-hand stock");
  if (input.stockoutHoursLast30Days > 30 * 24) throw new Error("stockout duration exceeds metric window");
  const available = input.onHand - input.reserved;
  const averageDailyDemand = input.shippedLast30Days / 30;
  return {
    sku: input.sku,
    available,
    reservationRate: input.onHand === 0 ? 0 : input.reserved / input.onHand,
    daysOfSupply: averageDailyDemand === 0 ? null : available / averageDailyDemand,
    stockoutRate: input.stockoutHoursLast30Days / (30 * 24),
  };
}

export function averageDaysOfSupply(metrics: InventoryMetrics[]): number | null {
  const measured = metrics.flatMap((metric) => metric.daysOfSupply === null ? [] : [metric.daysOfSupply]);
  return measured.length === 0 ? null : measured.reduce((sum, value) => sum + value, 0) / measured.length;
}

export function stockoutSkus(metrics: InventoryMetrics[], threshold: number): string[] {
  if (threshold < 0 || threshold > 1) throw new Error("invalid stockout threshold");
  return metrics.filter((metric) => metric.stockoutRate >= threshold).map((metric) => metric.sku).sort();
}

export function metricKey(warehouseId: string, metric: InventoryMetrics): string {
  return `${warehouseId}:${metric.sku}`;
}
