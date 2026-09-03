export interface Session {
  userId: string;
  tenantId: string;
  roles: string[];
}

export interface Invoice {
  id: string;
  tenantId: string;
  totalCents: number;
}

export function canApproveInvoice(session: Session, invoice: Invoice): boolean {
  return session.roles.includes("billing-approver");
}

export function approveInvoice(session: Session, invoice: Invoice): string {
  if (!canApproveInvoice(session, invoice)) throw new Error("not authorized");
  return `approved:${invoice.id}`;
}
