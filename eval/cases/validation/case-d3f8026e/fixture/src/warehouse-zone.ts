export interface StorageZone {
  zoneId: string;
  warehouseId: string;
  temperature: "ambient" | "chilled" | "frozen";
  maximumUnits: number;
  occupiedUnits: number;
  hazardousAllowed: boolean;
}

export interface StorageRequirement {
  sku: string;
  units: number;
  temperature: StorageZone["temperature"];
  hazardous: boolean;
}

export function zoneRemainingUnits(zone: StorageZone): number {
  if (!Number.isSafeInteger(zone.maximumUnits) || zone.maximumUnits < 0) throw new Error("invalid zone capacity");
  if (!Number.isSafeInteger(zone.occupiedUnits) || zone.occupiedUnits < 0) throw new Error("invalid zone occupancy");
  if (zone.occupiedUnits > zone.maximumUnits) throw new Error("zone is over capacity");
  return zone.maximumUnits - zone.occupiedUnits;
}

export function selectStorageZone(zones: StorageZone[], requirement: StorageRequirement): StorageZone {
  if (!Number.isSafeInteger(requirement.units) || requirement.units <= 0) throw new Error("invalid storage units");
  const selected = zones
    .filter((zone) => zone.temperature === requirement.temperature)
    .filter((zone) => !requirement.hazardous || zone.hazardousAllowed)
    .filter((zone) => zoneRemainingUnits(zone) >= requirement.units)
    .sort((left, right) => zoneRemainingUnits(left) - zoneRemainingUnits(right) || left.zoneId.localeCompare(right.zoneId))[0];
  if (!selected) throw new Error(`no storage zone available: ${requirement.sku}`);
  return { ...selected };
}

export function occupyStorageZone(zone: StorageZone, units: number): StorageZone {
  if (!Number.isSafeInteger(units) || units <= 0) throw new Error("invalid occupancy units");
  if (zoneRemainingUnits(zone) < units) throw new Error("zone capacity exceeded");
  return { ...zone, occupiedUnits: zone.occupiedUnits + units };
}

export function releaseStorageZone(zone: StorageZone, units: number): StorageZone {
  if (!Number.isSafeInteger(units) || units <= 0) throw new Error("invalid release units");
  if (zone.occupiedUnits < units) throw new Error("release exceeds zone occupancy");
  return { ...zone, occupiedUnits: zone.occupiedUnits - units };
}

export function warehouseZoneUtilization(zones: StorageZone[], warehouseId: string): number {
  const matching = zones.filter((zone) => zone.warehouseId === warehouseId);
  const capacity = matching.reduce((sum, zone) => sum + zone.maximumUnits, 0);
  const occupied = matching.reduce((sum, zone) => sum + zone.occupiedUnits, 0);
  return capacity === 0 ? 0 : occupied / capacity;
}
