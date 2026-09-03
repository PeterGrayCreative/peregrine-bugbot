export type WarehouseId = string & { readonly warehouseId: unique symbol };
export type Sku = string & { readonly sku: unique symbol };

export interface StockSnapshot {
  warehouseId: WarehouseId;
  sku: Sku;
  available: number;
  reserved: number;
  observedAt: string;
}

export interface ReservationRequest {
  requestId: string;
  customerId: string;
  warehouseId: WarehouseId;
  lines: Array<{ sku: Sku; quantity: number }>;
  requestedAt: string;
}

export interface ReservedLine {
  sku: Sku;
  quantity: number;
  remainingAvailable: number;
}

export interface ReservationReceipt {
  requestId: string;
  warehouseId: WarehouseId;
  lines: ReservedLine[];
  reservedAt: string;
}

export function warehouseId(value: string): WarehouseId {
  if (!/^wh_[a-z0-9]{4,24}$/.test(value)) throw new Error("invalid warehouse id");
  return value as WarehouseId;
}

export function sku(value: string): Sku {
  if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(value)) throw new Error("invalid sku");
  return value as Sku;
}
