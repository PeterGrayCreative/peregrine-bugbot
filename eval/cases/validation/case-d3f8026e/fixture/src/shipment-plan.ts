export interface ShipmentPackage {
  cartonId: string;
  weightGrams: number;
  declaredValueCents: number;
}

export interface CarrierRate {
  carrier: string;
  service: string;
  maximumWeightGrams: number;
  priceCents: number;
  estimatedDays: number;
}

export interface ShipmentPlan {
  carrier: string;
  service: string;
  packageCount: number;
  totalPriceCents: number;
  estimatedDays: number;
}

export function planShipment(packages: ShipmentPackage[], rates: CarrierRate[], maximumDays: number): ShipmentPlan {
  if (packages.length === 0) throw new Error("shipment needs a package");
  if (!Number.isSafeInteger(maximumDays) || maximumDays <= 0) throw new Error("invalid delivery target");
  const heaviest = Math.max(...packages.map((item) => item.weightGrams));
  const eligible = rates
    .filter((rate) => rate.maximumWeightGrams >= heaviest && rate.estimatedDays <= maximumDays)
    .sort((left, right) => left.priceCents - right.priceCents || left.estimatedDays - right.estimatedDays);
  const selected = eligible[0];
  if (!selected) throw new Error("no carrier rate meets shipment requirements");
  return {
    carrier: selected.carrier,
    service: selected.service,
    packageCount: packages.length,
    totalPriceCents: selected.priceCents * packages.length,
    estimatedDays: selected.estimatedDays,
  };
}

export function declaredShipmentValue(packages: ShipmentPackage[]): number {
  return packages.reduce((sum, item) => sum + item.declaredValueCents, 0);
}

export function shipmentServiceKey(plan: ShipmentPlan): string {
  return `${plan.carrier}:${plan.service}`;
}
