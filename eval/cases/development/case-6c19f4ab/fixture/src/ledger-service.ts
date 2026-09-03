export interface Account {
  id: string;
  balanceCents: number;
}

export function transfer(accounts: Map<string, Account>, fromId: string, toId: string, cents: number): void {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error("invalid amount");
  const from = accounts.get(fromId);
  const to = accounts.get(toId);
  if (!from || !to) throw new Error("account not found");
  if (from.balanceCents < cents) throw new Error("insufficient funds");

  from.balanceCents -= cents;
  if (to.id.startsWith("locked-")) throw new Error("destination locked");
  to.balanceCents += cents;
}
