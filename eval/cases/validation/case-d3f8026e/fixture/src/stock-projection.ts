export interface StockMovement {
  sku: string;
  warehouseId: string;
  quantity: number;
  kind: "receipt" | "reservation" | "release" | "shipment" | "adjustment";
  occurredAt: string;
}

export interface ProjectedStock {
  sku: string;
  warehouseId: string;
  onHand: number;
  reserved: number;
  available: number;
  lastMovementAt: string | null;
}

export function projectStock(sku: string, warehouseId: string, movements: StockMovement[]): ProjectedStock {
  let onHand = 0;
  let reserved = 0;
  let lastMovementAt: string | null = null;
  const ordered = movements
    .filter((movement) => movement.sku === sku && movement.warehouseId === warehouseId)
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  for (const movement of ordered) {
    if (!Number.isSafeInteger(movement.quantity) || movement.quantity <= 0) throw new Error("invalid movement quantity");
    if (movement.kind === "receipt") onHand += movement.quantity;
    else if (movement.kind === "reservation") reserved += movement.quantity;
    else if (movement.kind === "release") reserved -= movement.quantity;
    else if (movement.kind === "shipment") {
      reserved -= movement.quantity;
      onHand -= movement.quantity;
    } else onHand += movement.quantity;
    if (onHand < 0 || reserved < 0 || reserved > onHand) throw new Error("invalid stock projection");
    lastMovementAt = movement.occurredAt;
  }
  return { sku, warehouseId, onHand, reserved, available: onHand - reserved, lastMovementAt };
}

export function projectCatalog(movements: StockMovement[]): Map<string, ProjectedStock> {
  const keys = new Set(movements.map((movement) => `${movement.warehouseId}\0${movement.sku}`));
  const catalog = new Map<string, ProjectedStock>();
  for (const key of keys) {
    const [warehouseId, sku] = key.split("\0");
    catalog.set(key, projectStock(sku!, warehouseId!, movements));
  }
  return catalog;
}

export function stockProjectionKey(stock: Pick<ProjectedStock, "warehouseId" | "sku">): string {
  return `${stock.warehouseId}\0${stock.sku}`;
}
