export interface SerializedUnit {
  serial: string;
  sku: string;
  warehouseId: string;
  status: "available" | "reserved" | "shipped" | "retired";
  reservationId: string | null;
}

export function normalizeSerial(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{5,39}$/.test(normalized)) throw new Error("invalid serial");
  return normalized;
}

export function registerUnits(existing: Map<string, SerializedUnit>, additions: SerializedUnit[]): Map<string, SerializedUnit> {
  const next = new Map(existing);
  for (const unit of additions) {
    const serial = normalizeSerial(unit.serial);
    if (next.has(serial)) throw new Error(`duplicate serial: ${serial}`);
    if (unit.status !== "available" || unit.reservationId !== null) throw new Error("new unit must be available");
    next.set(serial, { ...unit, serial });
  }
  return next;
}

export function reserveSerials(
  existing: Map<string, SerializedUnit>,
  serials: string[],
  reservationId: string,
): Map<string, SerializedUnit> {
  const normalized = serials.map(normalizeSerial);
  if (new Set(normalized).size !== normalized.length) throw new Error("duplicate requested serial");
  for (const serial of normalized) {
    if (existing.get(serial)?.status !== "available") throw new Error(`serial unavailable: ${serial}`);
  }
  const next = new Map(existing);
  for (const serial of normalized) {
    next.set(serial, { ...next.get(serial)!, status: "reserved", reservationId });
  }
  return next;
}

export function serialsForReservation(existing: Map<string, SerializedUnit>, reservationId: string): string[] {
  return [...existing.values()]
    .filter((unit) => unit.reservationId === reservationId)
    .map((unit) => unit.serial)
    .sort();
}
