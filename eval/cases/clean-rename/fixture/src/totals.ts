export interface LineItem {
  price: number;
  quantity: number;
}

export function calculateOrderTotal(items: LineItem[]): number {
  return items.reduce((total, item) => total + item.price * item.quantity, 0);
}
