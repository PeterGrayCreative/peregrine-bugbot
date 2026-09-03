export interface Viewer {
  tenantId: string;
  scopes: string[];
}

export interface Report {
  tenantId: string;
  status: "draft" | "published";
}

const READ_SCOPES = new Set(["report:read", "report:admin"]);

export function canReadReport(viewer: Viewer, report: Report): boolean {
  return viewer.tenantId === report.tenantId && viewer.scopes.some((scope) => READ_SCOPES.has(scope));
}
