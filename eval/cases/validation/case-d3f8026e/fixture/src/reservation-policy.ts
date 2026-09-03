import type { ReservationRequest, StockSnapshot } from "./inventory-types.ts";

export interface ReservationPolicy {
  maximumLines: number;
  maximumUnitsPerLine: number;
  maximumUnitsPerRequest: number;
  staleAfterMs: number;
}

export const DEFAULT_RESERVATION_POLICY: ReservationPolicy = {
  maximumLines: 50,
  maximumUnitsPerLine: 100,
  maximumUnitsPerRequest: 500,
  staleAfterMs: 60_000,
};

export function validateReservationRequest(
  request: ReservationRequest,
  snapshots: ReadonlyMap<string, StockSnapshot>,
  nowMs: number,
  policy = DEFAULT_RESERVATION_POLICY,
): void {
  if (request.lines.length === 0 || request.lines.length > policy.maximumLines) {
    throw new Error("invalid reservation line count");
  }
  let units = 0;
  const seen = new Set<string>();
  for (const line of request.lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0 || line.quantity > policy.maximumUnitsPerLine) {
      throw new Error(`invalid quantity: ${line.sku}`);
    }
    if (seen.has(line.sku)) throw new Error(`duplicate sku: ${line.sku}`);
    seen.add(line.sku);
    units += line.quantity;
    const snapshot = snapshots.get(line.sku);
    if (!snapshot || snapshot.warehouseId !== request.warehouseId) throw new Error(`stock unavailable: ${line.sku}`);
    if (nowMs - Date.parse(snapshot.observedAt) > policy.staleAfterMs) throw new Error(`stale stock: ${line.sku}`);
  }
  if (units > policy.maximumUnitsPerRequest) throw new Error("reservation is too large");
}

export function isFulfillable(request: ReservationRequest, snapshots: ReadonlyMap<string, StockSnapshot>): boolean {
  return request.lines.every((line) => (snapshots.get(line.sku)?.available ?? 0) >= line.quantity);
}
