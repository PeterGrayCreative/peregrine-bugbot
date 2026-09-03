export interface PackableLine {
  sku: string;
  quantity: number;
  unitWeightGrams: number;
  fragile: boolean;
}

export interface CartonType {
  cartonId: string;
  maximumWeightGrams: number;
  supportsFragile: boolean;
}

export interface PackingPlan {
  cartonId: string;
  lines: PackableLine[];
  totalWeightGrams: number;
}

export function selectCarton(lines: PackableLine[], cartons: CartonType[]): CartonType {
  const totalWeight = lines.reduce((sum, line) => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error("invalid pack quantity");
    if (!Number.isFinite(line.unitWeightGrams) || line.unitWeightGrams <= 0) throw new Error("invalid unit weight");
    return sum + line.quantity * line.unitWeightGrams;
  }, 0);
  const requiresFragile = lines.some((line) => line.fragile);
  const selected = [...cartons]
    .filter((carton) => carton.maximumWeightGrams >= totalWeight)
    .filter((carton) => !requiresFragile || carton.supportsFragile)
    .sort((left, right) => left.maximumWeightGrams - right.maximumWeightGrams || left.cartonId.localeCompare(right.cartonId))[0];
  if (!selected) throw new Error("no suitable carton");
  return selected;
}

export function buildPackingPlan(lines: PackableLine[], cartons: CartonType[]): PackingPlan {
  const carton = selectCarton(lines, cartons);
  return {
    cartonId: carton.cartonId,
    lines: lines.map((line) => ({ ...line })),
    totalWeightGrams: lines.reduce((sum, line) => sum + line.quantity * line.unitWeightGrams, 0),
  };
}

export function packingSlip(plan: PackingPlan): string[] {
  return plan.lines.map((line) => `${line.sku} x ${line.quantity}`);
}
