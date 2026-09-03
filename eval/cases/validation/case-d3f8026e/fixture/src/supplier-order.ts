export interface SupplierOffer {
  supplierId: string;
  sku: string;
  unitPriceCents: number;
  minimumQuantity: number;
  orderMultiple: number;
  leadTimeDays: number;
}

export interface SupplierOrderLine {
  supplierId: string;
  sku: string;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
}

export function chooseSupplierOffer(offers: SupplierOffer[], sku: string, desiredQuantity: number): SupplierOrderLine {
  if (!Number.isSafeInteger(desiredQuantity) || desiredQuantity <= 0) throw new Error("invalid desired quantity");
  const candidates = offers.filter((offer) => offer.sku === sku).map((offer) => {
    if (!Number.isSafeInteger(offer.unitPriceCents) || offer.unitPriceCents <= 0) throw new Error("invalid supplier price");
    if (!Number.isSafeInteger(offer.orderMultiple) || offer.orderMultiple <= 0) throw new Error("invalid order multiple");
    const minimum = Math.max(desiredQuantity, offer.minimumQuantity);
    const quantity = Math.ceil(minimum / offer.orderMultiple) * offer.orderMultiple;
    return {
      supplierId: offer.supplierId,
      sku,
      quantity,
      unitPriceCents: offer.unitPriceCents,
      totalPriceCents: quantity * offer.unitPriceCents,
      leadTimeDays: offer.leadTimeDays,
    };
  });
  const selected = candidates.sort((left, right) =>
    left.totalPriceCents - right.totalPriceCents || left.leadTimeDays - right.leadTimeDays || left.supplierId.localeCompare(right.supplierId))[0];
  if (!selected) throw new Error(`no supplier offer: ${sku}`);
  const { leadTimeDays: _, ...line } = selected;
  return line;
}

export function supplierOrderTotal(lines: SupplierOrderLine[]): number {
  return lines.reduce((sum, line) => sum + line.totalPriceCents, 0);
}

export function groupOrdersBySupplier(lines: SupplierOrderLine[]): Map<string, SupplierOrderLine[]> {
  const grouped = new Map<string, SupplierOrderLine[]>();
  for (const line of lines) grouped.set(line.supplierId, [...(grouped.get(line.supplierId) ?? []), line]);
  return grouped;
}
