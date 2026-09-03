export interface StockLine {
  sku: string;
  available: number;
}

export interface ReservationLine {
  sku: string;
  quantity: number;
}

export function reserve(stock: Map<string, StockLine>, lines: ReservationLine[]): void {
  for (const line of lines) {
    const item = stock.get(line.sku);
    if (!item) throw new Error(`unknown sku: ${line.sku}`);
    if (line.quantity <= 0 || item.available < line.quantity) throw new Error(`cannot reserve: ${line.sku}`);
    item.available -= line.quantity;
  }
}
