import type { ReservationReceipt, ReservedLine, WarehouseId } from "./inventory-types.ts";

export interface InventoryReservedEvent {
  type: "inventory.reserved";
  version: 1;
  occurredAt: string;
  payload: {
    requestId: string;
    warehouseId: WarehouseId;
    lines: Array<Pick<ReservedLine, "sku" | "quantity">>;
  };
}

export function reservationEvent(receipt: ReservationReceipt): InventoryReservedEvent {
  return {
    type: "inventory.reserved",
    version: 1,
    occurredAt: receipt.reservedAt,
    payload: {
      requestId: receipt.requestId,
      warehouseId: receipt.warehouseId,
      lines: receipt.lines.map(({ sku, quantity }) => ({ sku, quantity })),
    },
  };
}

export function eventPartitionKey(event: InventoryReservedEvent): string {
  return `${event.payload.warehouseId}:${event.payload.requestId}`;
}

export function serializeInventoryEvent(event: InventoryReservedEvent): string {
  if (event.payload.lines.length === 0) throw new Error("reservation event needs lines");
  return JSON.stringify(event);
}

export function totalReservedUnits(event: InventoryReservedEvent): number {
  return event.payload.lines.reduce((sum, line) => sum + line.quantity, 0);
}
