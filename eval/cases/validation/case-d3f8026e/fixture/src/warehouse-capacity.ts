export interface CapacityBand {
  warehouseId: string;
  maximumUnits: number;
  usedUnits: number;
  inboundUnits: number;
}

export interface CapacityDecision {
  warehouseId: string;
  acceptedUnits: number;
  rejectedUnits: number;
  utilizationAfter: number;
}

export function remainingCapacity(band: CapacityBand): number {
  for (const value of [band.maximumUnits, band.usedUnits, band.inboundUnits]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid warehouse capacity");
  }
  if (band.usedUnits + band.inboundUnits > band.maximumUnits) throw new Error("warehouse exceeds capacity");
  return band.maximumUnits - band.usedUnits - band.inboundUnits;
}

export function allocateInboundCapacity(band: CapacityBand, requestedUnits: number): CapacityDecision {
  if (!Number.isSafeInteger(requestedUnits) || requestedUnits <= 0) throw new Error("invalid inbound units");
  const available = remainingCapacity(band);
  const acceptedUnits = Math.min(available, requestedUnits);
  const rejectedUnits = requestedUnits - acceptedUnits;
  const utilizationAfter = band.maximumUnits === 0
    ? 1
    : (band.usedUnits + band.inboundUnits + acceptedUnits) / band.maximumUnits;
  return { warehouseId: band.warehouseId, acceptedUnits, rejectedUnits, utilizationAfter };
}

export function rankCapacity(bands: CapacityBand[]): CapacityBand[] {
  return [...bands].sort((left, right) => remainingCapacity(right) - remainingCapacity(left) || left.warehouseId.localeCompare(right.warehouseId));
}

export function networkCapacity(bands: CapacityBand[]): { maximum: number; committed: number; remaining: number } {
  const maximum = bands.reduce((sum, band) => sum + band.maximumUnits, 0);
  const committed = bands.reduce((sum, band) => sum + band.usedUnits + band.inboundUnits, 0);
  for (const band of bands) remainingCapacity(band);
  return { maximum, committed, remaining: maximum - committed };
}
