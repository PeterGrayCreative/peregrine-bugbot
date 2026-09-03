export interface Actor {
  tenantId: string;
  permissions: string[];
}

export interface Workspace {
  id: string;
  tenantId: string;
  secret: string;
  setting: string;
}

function canManage(actor: Actor): boolean {
  return actor.permissions.includes("workspace:manage");
}

export function readSecret(actor: Actor, workspace: Workspace): string {
  if (!canManage(actor)) throw new Error("not authorized");
  return workspace.secret;
}

export function updateSetting(actor: Actor, workspace: Workspace, value: string): Workspace {
  if (!canManage(actor)) throw new Error("not authorized");
  return { ...workspace, setting: value };
}
