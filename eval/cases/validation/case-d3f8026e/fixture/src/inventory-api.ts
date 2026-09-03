import { buildAllocationPlan } from "./allocation-plan.ts";
import type { ReservationReceipt, ReservationRequest, StockSnapshot } from "./inventory-types.ts";
import { isFulfillable, validateReservationRequest } from "./reservation-policy.ts";

export interface ReservationResponse {
  status: 201 | 409 | 422;
  body: { receipt?: ReservationReceipt; error?: string };
}

export function previewReservation(
  request: ReservationRequest,
  snapshots: ReadonlyMap<string, StockSnapshot>,
  nowMs: number,
): ReservationResponse {
  try {
    validateReservationRequest(request, snapshots, nowMs);
    if (!isFulfillable(request, snapshots)) {
      return { status: 409, body: { error: "insufficient stock" } };
    }
    const plan = buildAllocationPlan(request, snapshots);
    return {
      status: 201,
      body: {
        receipt: {
          requestId: plan.requestId,
          warehouseId: request.warehouseId,
          lines: plan.lines,
          reservedAt: new Date(nowMs).toISOString(),
        },
      },
    };
  } catch (error) {
    return { status: 422, body: { error: error instanceof Error ? error.message : "invalid reservation" } };
  }
}

export function reservationLocation(receipt: ReservationReceipt): string {
  return `/warehouses/${encodeURIComponent(receipt.warehouseId)}/reservations/${encodeURIComponent(receipt.requestId)}`;
}
