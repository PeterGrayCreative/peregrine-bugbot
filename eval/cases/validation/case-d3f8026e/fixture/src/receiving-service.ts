export interface PurchaseOrderLine {
  sku: string;
  ordered: number;
  previouslyReceived: number;
}

export interface ReceiptLine {
  sku: string;
  received: number;
  damaged: number;
}

export interface AppliedReceipt {
  sku: string;
  accepted: number;
  quarantined: number;
  cumulativeReceived: number;
}

export function applyReceipt(order: PurchaseOrderLine[], receipt: ReceiptLine[]): AppliedReceipt[] {
  const bySku = new Map(order.map((line) => [line.sku, line]));
  const seen = new Set<string>();
  return receipt.map((line) => {
    if (seen.has(line.sku)) throw new Error(`duplicate receipt line: ${line.sku}`);
    seen.add(line.sku);
    const ordered = bySku.get(line.sku);
    if (!ordered) throw new Error(`sku is not on purchase order: ${line.sku}`);
    if (![line.received, line.damaged].every((value) => Number.isSafeInteger(value) && value >= 0)) {
      throw new Error("invalid receipt quantity");
    }
    if (line.damaged > line.received) throw new Error("damaged quantity exceeds received quantity");
    if (ordered.previouslyReceived + line.received > ordered.ordered) throw new Error("receipt exceeds order quantity");
    return {
      sku: line.sku,
      accepted: line.received - line.damaged,
      quarantined: line.damaged,
      cumulativeReceived: ordered.previouslyReceived + line.received,
    };
  });
}

export function receiptAcceptedUnits(lines: AppliedReceipt[]): number {
  return lines.reduce((sum, line) => sum + line.accepted, 0);
}

export function receiptComplete(order: PurchaseOrderLine[], applied: AppliedReceipt[]): boolean {
  const received = new Map(applied.map((line) => [line.sku, line.cumulativeReceived]));
  return order.every((line) => (received.get(line.sku) ?? line.previouslyReceived) === line.ordered);
}

export function outstandingUnits(order: PurchaseOrderLine): number {
  return Math.max(0, order.ordered - order.previouslyReceived);
}
