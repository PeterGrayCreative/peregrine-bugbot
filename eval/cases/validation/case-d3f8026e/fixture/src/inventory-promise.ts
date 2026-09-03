export interface PromiseInput {
  sku: string;
  requested: number;
  available: number;
  inbound: Array<{ quantity: number; arrivesAt: string }>;
  cutoffAt: string;
}

export interface InventoryPromise {
  sku: string;
  promised: number;
  backordered: number;
  source: "available" | "inbound" | "mixed" | "none";
}

export function makeInventoryPromise(input: PromiseInput): InventoryPromise {
  if (!Number.isSafeInteger(input.requested) || input.requested <= 0) throw new Error("invalid requested units");
  if (!Number.isSafeInteger(input.available) || input.available < 0) throw new Error("invalid available units");
  const cutoff = Date.parse(input.cutoffAt);
  if (!Number.isFinite(cutoff)) throw new Error("invalid promise cutoff");
  const inbound = input.inbound
    .filter((receipt) => Date.parse(receipt.arrivesAt) <= cutoff)
    .reduce((sum, receipt) => {
      if (!Number.isSafeInteger(receipt.quantity) || receipt.quantity < 0) throw new Error("invalid inbound units");
      return sum + receipt.quantity;
    }, 0);
  const promised = Math.min(input.requested, input.available + inbound);
  const backordered = input.requested - promised;
  let source: InventoryPromise["source"] = "none";
  if (promised > 0 && promised <= input.available) source = "available";
  else if (input.available === 0 && promised > 0) source = "inbound";
  else if (promised > 0) source = "mixed";
  return { sku: input.sku, promised, backordered, source };
}

export function promiseFillRate(promises: InventoryPromise[]): number {
  const requested = promises.reduce((sum, item) => sum + item.promised + item.backordered, 0);
  return requested === 0 ? 1 : promises.reduce((sum, item) => sum + item.promised, 0) / requested;
}

export function unfulfilledSkus(promises: InventoryPromise[]): string[] {
  return promises.filter((item) => item.backordered > 0).map((item) => item.sku).sort();
}
