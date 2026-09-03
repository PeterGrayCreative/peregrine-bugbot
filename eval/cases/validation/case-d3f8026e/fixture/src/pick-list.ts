export interface PickInstruction {
  reservationId: string;
  sku: string;
  quantity: number;
  zone: string;
  aisle: string;
  bin: string;
}

export interface PickWave {
  waveId: string;
  instructions: PickInstruction[];
  totalUnits: number;
  zones: string[];
}

export function buildPickWave(waveId: string, instructions: PickInstruction[]): PickWave {
  if (!waveId.trim()) throw new Error("wave id is required");
  const normalized = instructions.map((instruction) => {
    if (!Number.isSafeInteger(instruction.quantity) || instruction.quantity <= 0) throw new Error("invalid pick quantity");
    if (![instruction.zone, instruction.aisle, instruction.bin].every((value) => value.trim())) {
      throw new Error("pick location is incomplete");
    }
    return { ...instruction };
  });
  normalized.sort((left, right) =>
    left.zone.localeCompare(right.zone) ||
    left.aisle.localeCompare(right.aisle) ||
    left.bin.localeCompare(right.bin) ||
    left.sku.localeCompare(right.sku));
  return {
    waveId,
    instructions: normalized,
    totalUnits: normalized.reduce((sum, instruction) => sum + instruction.quantity, 0),
    zones: [...new Set(normalized.map((instruction) => instruction.zone))],
  };
}

export function splitPickWave(wave: PickWave, maximumUnits: number): PickWave[] {
  if (!Number.isSafeInteger(maximumUnits) || maximumUnits <= 0) throw new Error("invalid wave capacity");
  const waves: PickWave[] = [];
  let pending: PickInstruction[] = [];
  let units = 0;
  for (const instruction of wave.instructions) {
    if (instruction.quantity > maximumUnits) throw new Error("one pick exceeds wave capacity");
    if (units + instruction.quantity > maximumUnits) {
      waves.push(buildPickWave(`${wave.waveId}-${waves.length + 1}`, pending));
      pending = [];
      units = 0;
    }
    pending.push(instruction);
    units += instruction.quantity;
  }
  if (pending.length > 0) waves.push(buildPickWave(`${wave.waveId}-${waves.length + 1}`, pending));
  return waves;
}
