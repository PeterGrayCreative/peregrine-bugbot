export interface AvailabilityRow {
  sku: string;
  warehouseId: string;
  available: number;
  expectedReceipts: Array<{ quantity: number; arrivesAt: string }>;
}

export interface AvailabilityAnswer {
  sku: string;
  immediatelyAvailable: number;
  availableByPromiseDate: number;
  contributingWarehouses: string[];
}

export function queryAvailability(
  rows: AvailabilityRow[],
  sku: string,
  promiseDate: string,
): AvailabilityAnswer {
  const promiseMs = Date.parse(promiseDate);
  if (!Number.isFinite(promiseMs)) throw new Error("invalid promise date");
  const matching = rows.filter((row) => row.sku === sku);
  let immediatelyAvailable = 0;
  let availableByPromiseDate = 0;
  const contributingWarehouses: string[] = [];
  for (const row of matching) {
    if (!Number.isSafeInteger(row.available) || row.available < 0) throw new Error("invalid available quantity");
    immediatelyAvailable += row.available;
    const inbound = row.expectedReceipts
      .filter((receipt) => Date.parse(receipt.arrivesAt) <= promiseMs)
      .reduce((sum, receipt) => sum + receipt.quantity, 0);
    availableByPromiseDate += row.available + inbound;
    if (row.available > 0 || inbound > 0) contributingWarehouses.push(row.warehouseId);
  }
  return {
    sku,
    immediatelyAvailable,
    availableByPromiseDate,
    contributingWarehouses: [...new Set(contributingWarehouses)].sort(),
  };
}

export function canPromise(answer: AvailabilityAnswer, quantity: number): boolean {
  return Number.isSafeInteger(quantity) && quantity > 0 && answer.availableByPromiseDate >= quantity;
}

export function availabilityRatio(answer: AvailabilityAnswer, quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("invalid requested quantity");
  return Math.min(1, answer.availableByPromiseDate / quantity);
}
