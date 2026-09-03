import type { ReservationRequest, WarehouseId } from "./inventory-types.ts";

export interface WarehouseRoute {
  warehouseId: WarehouseId;
  region: string;
  priority: number;
  supportedPrefixes: string[];
}

export function selectWarehouse(
  request: Pick<ReservationRequest, "lines">,
  routes: WarehouseRoute[],
  region: string,
): WarehouseId {
  const requiredPrefixes = new Set(request.lines.map((line) => line.sku.split("_")[0]));
  const candidates = routes
    .filter((route) => route.region === region)
    .filter((route) => [...requiredPrefixes].every((prefix) => route.supportedPrefixes.includes(prefix)))
    .sort((left, right) => left.priority - right.priority || left.warehouseId.localeCompare(right.warehouseId));
  const selected = candidates[0];
  if (!selected) throw new Error("no warehouse can fulfill the requested product families");
  return selected.warehouseId;
}

export function groupRoutesByRegion(routes: WarehouseRoute[]): Map<string, WarehouseRoute[]> {
  const grouped = new Map<string, WarehouseRoute[]>();
  for (const route of routes) {
    const existing = grouped.get(route.region) ?? [];
    existing.push(route);
    grouped.set(route.region, existing);
  }
  for (const group of grouped.values()) {
    group.sort((left, right) => left.priority - right.priority);
  }
  return grouped;
}

export function routeSupports(route: WarehouseRoute, sku: string): boolean {
  return route.supportedPrefixes.includes(sku.split("_")[0] ?? "");
}
