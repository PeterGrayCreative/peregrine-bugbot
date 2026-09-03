export interface CustomerRecord {
  externalId: string;
  displayName: string;
}

export function normalizeExternalId(input: string): string {
  const trimmed = input.trim();
  if (!/^\d{1,12}$/.test(trimmed)) throw new Error("invalid external id");
  return String(Number(trimmed));
}

export function indexCustomers(records: CustomerRecord[]): Map<string, CustomerRecord> {
  return new Map(records.map((record) => [normalizeExternalId(record.externalId), record]));
}
