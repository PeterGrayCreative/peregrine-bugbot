export interface ReturnLine {
  sku: string;
  quantity: number;
  condition: "sealed" | "opened" | "damaged";
  reason: string;
}

export interface ReturnDisposition {
  sku: string;
  restock: number;
  inspect: number;
  discard: number;
}

export function classifyReturn(line: ReturnLine): ReturnDisposition {
  if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error("invalid return quantity");
  if (!line.reason.trim()) throw new Error("return reason is required");
  if (line.condition === "sealed") return { sku: line.sku, restock: line.quantity, inspect: 0, discard: 0 };
  if (line.condition === "opened") return { sku: line.sku, restock: 0, inspect: line.quantity, discard: 0 };
  return { sku: line.sku, restock: 0, inspect: 0, discard: line.quantity };
}

export function classifyReturns(lines: ReturnLine[]): ReturnDisposition[] {
  return lines.map(classifyReturn);
}

export function combineReturnDispositions(lines: ReturnDisposition[]): Map<string, ReturnDisposition> {
  const combined = new Map<string, ReturnDisposition>();
  for (const line of lines) {
    const current = combined.get(line.sku) ?? { sku: line.sku, restock: 0, inspect: 0, discard: 0 };
    combined.set(line.sku, {
      sku: line.sku,
      restock: current.restock + line.restock,
      inspect: current.inspect + line.inspect,
      discard: current.discard + line.discard,
    });
  }
  return combined;
}

export function returnedUnits(disposition: ReturnDisposition): number {
  return disposition.restock + disposition.inspect + disposition.discard;
}

export function dispositionRequiresReview(disposition: ReturnDisposition): boolean {
  return disposition.inspect > 0 || disposition.discard > 0;
}
