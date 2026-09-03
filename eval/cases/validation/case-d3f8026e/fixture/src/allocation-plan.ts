import type { ReservationRequest, ReservedLine, StockSnapshot } from "./inventory-types.ts";

export interface AllocationPlan {
  requestId: string;
  lines: ReservedLine[];
  totalUnits: number;
}

export function buildAllocationPlan(
  request: ReservationRequest,
  snapshots: ReadonlyMap<string, StockSnapshot>,
): AllocationPlan {
  const lines = request.lines.map((line) => {
    const snapshot = snapshots.get(line.sku);
    if (!snapshot) throw new Error(`missing stock: ${line.sku}`);
    if (snapshot.available < line.quantity) throw new Error(`insufficient stock: ${line.sku}`);
    return {
      sku: line.sku,
      quantity: line.quantity,
      remainingAvailable: snapshot.available - line.quantity,
    };
  });
  return {
    requestId: request.requestId,
    lines,
    totalUnits: lines.reduce((sum, line) => sum + line.quantity, 0),
  };
}

export function mergeAllocationPlans(plans: AllocationPlan[]): Map<string, number> {
  const allocated = new Map<string, number>();
  for (const plan of plans) {
    for (const line of plan.lines) {
      allocated.set(line.sku, (allocated.get(line.sku) ?? 0) + line.quantity);
    }
  }
  return allocated;
}

export function describeAllocation(plan: AllocationPlan): string {
  const lineSummary = plan.lines.map((line) => `${line.sku}:${line.quantity}`).join(",");
  return `${plan.requestId}[${lineSummary}]=${plan.totalUnits}`;
}
