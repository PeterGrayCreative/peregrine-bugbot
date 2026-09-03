export interface ShipmentReference {
  region: string;
  account: string;
  sequence: string;
}

export function parseShipmentKey(value: string): ShipmentReference {
  const [region, account, sequence] = value.split("-");
  if (!region || !account || !sequence) throw new Error("invalid shipment key");
  return { region, account, sequence };
}

export function routingKey(value: string): string {
  const reference = parseShipmentKey(value);
  return `${reference.region}/${reference.account}/${reference.sequence}`;
}
