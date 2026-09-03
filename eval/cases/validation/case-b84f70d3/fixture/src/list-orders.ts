export interface Order { id: string }
export interface OrderStore { list(input: { limit: number; offset: number }): Promise<Order[]> }

export async function listOrders(store: OrderStore, page: number, limit: number): Promise<Order[]> {
  if (!Number.isInteger(page) || page < 1) throw new RangeError("page must be positive");
  const offset = page * limit;
  return store.list({ limit, offset });
}
