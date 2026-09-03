export interface WarehouseStock {
  warehouseId: string;
  sku: string;
  onHand: number;
  reserved: number;
}

export interface StockTransfer {
  transferId: string;
  sku: string;
  quantity: number;
  fromWarehouseId: string;
  toWarehouseId: string;
}

export function validateTransfer(transfer: StockTransfer, source: WarehouseStock, target: WarehouseStock): void {
  if (transfer.fromWarehouseId === transfer.toWarehouseId) throw new Error("transfer endpoints must differ");
  if (source.warehouseId !== transfer.fromWarehouseId || target.warehouseId !== transfer.toWarehouseId) {
    throw new Error("transfer stock endpoint mismatch");
  }
  if (source.sku !== transfer.sku || target.sku !== transfer.sku) throw new Error("transfer sku mismatch");
  if (!Number.isSafeInteger(transfer.quantity) || transfer.quantity <= 0) throw new Error("invalid transfer quantity");
  if (source.onHand - source.reserved < transfer.quantity) throw new Error("insufficient transferable stock");
}

export function applyTransfer(
  transfer: StockTransfer,
  source: WarehouseStock,
  target: WarehouseStock,
): { source: WarehouseStock; target: WarehouseStock } {
  validateTransfer(transfer, source, target);
  return {
    source: { ...source, onHand: source.onHand - transfer.quantity },
    target: { ...target, onHand: target.onHand + transfer.quantity },
  };
}

export function transferConservesStock(before: WarehouseStock[], after: WarehouseStock[], sku: string): boolean {
  const total = (items: WarehouseStock[]) => items.filter((item) => item.sku === sku).reduce((sum, item) => sum + item.onHand, 0);
  return total(before) === total(after);
}

export function transferKey(transfer: StockTransfer): string {
  return `${transfer.fromWarehouseId}>${transfer.toWarehouseId}:${transfer.transferId}`;
}
