export interface QuarantineHold {
  holdId: string;
  sku: string;
  lotId: string | null;
  quantity: number;
  reason: string;
  createdAt: string;
  releasedAt: string | null;
}

export function createQuarantineHold(input: Omit<QuarantineHold, "releasedAt">): QuarantineHold {
  if (!input.holdId.trim() || !input.sku.trim() || !input.reason.trim()) throw new Error("quarantine hold is incomplete");
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) throw new Error("invalid quarantine quantity");
  if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error("invalid quarantine timestamp");
  return { ...input, releasedAt: null };
}

export function releaseQuarantineHold(hold: QuarantineHold, releasedAt: string): QuarantineHold {
  if (hold.releasedAt !== null) throw new Error("quarantine hold is already released");
  if (!Number.isFinite(Date.parse(releasedAt))) throw new Error("invalid release timestamp");
  if (Date.parse(releasedAt) < Date.parse(hold.createdAt)) throw new Error("release precedes hold");
  return { ...hold, releasedAt };
}

export function activeQuarantineQuantity(holds: QuarantineHold[], sku: string): number {
  return holds
    .filter((hold) => hold.sku === sku && hold.releasedAt === null)
    .reduce((sum, hold) => sum + hold.quantity, 0);
}

export function activeHoldsForLot(holds: QuarantineHold[], lotId: string): QuarantineHold[] {
  return holds
    .filter((hold) => hold.lotId === lotId && hold.releasedAt === null)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function holdDurationMs(hold: QuarantineHold, nowMs: number): number {
  const end = hold.releasedAt ? Date.parse(hold.releasedAt) : nowMs;
  return Math.max(0, end - Date.parse(hold.createdAt));
}
