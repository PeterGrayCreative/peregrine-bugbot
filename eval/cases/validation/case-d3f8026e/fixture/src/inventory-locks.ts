export interface InventoryLock {
  lockId: string;
  resourceKey: string;
  ownerId: string;
  acquiredAt: string;
  expiresAt: string;
}

export function acquireInventoryLock(
  active: InventoryLock[],
  candidate: InventoryLock,
  nowMs: number,
): InventoryLock[] {
  if (!candidate.lockId.trim() || !candidate.resourceKey.trim() || !candidate.ownerId.trim()) {
    throw new Error("inventory lock identity is incomplete");
  }
  const acquiredAt = Date.parse(candidate.acquiredAt);
  const expiresAt = Date.parse(candidate.expiresAt);
  if (!Number.isFinite(acquiredAt) || !Number.isFinite(expiresAt) || expiresAt <= acquiredAt) {
    throw new Error("invalid inventory lock window");
  }
  if (expiresAt <= nowMs) throw new Error("inventory lock is already expired");
  const retained = active.filter((lock) => Date.parse(lock.expiresAt) > nowMs);
  if (retained.some((lock) => lock.lockId === candidate.lockId)) throw new Error("inventory lock id already exists");
  if (retained.some((lock) => lock.resourceKey === candidate.resourceKey && lock.ownerId !== candidate.ownerId)) {
    throw new Error("inventory resource is locked");
  }
  return [...retained, { ...candidate }];
}

export function releaseInventoryLock(active: InventoryLock[], lockId: string, ownerId: string): InventoryLock[] {
  const lock = active.find((candidate) => candidate.lockId === lockId);
  if (!lock) return active.map((candidate) => ({ ...candidate }));
  if (lock.ownerId !== ownerId) throw new Error("only the lock owner can release it");
  return active.filter((candidate) => candidate.lockId !== lockId).map((candidate) => ({ ...candidate }));
}

export function locksForOwner(active: InventoryLock[], ownerId: string, nowMs: number): InventoryLock[] {
  return active
    .filter((lock) => lock.ownerId === ownerId && Date.parse(lock.expiresAt) > nowMs)
    .map((lock) => ({ ...lock }))
    .sort((left, right) => left.resourceKey.localeCompare(right.resourceKey));
}

export function lockResourceKey(warehouseId: string, sku: string): string {
  if (!warehouseId.trim() || !sku.trim()) throw new Error("lock resource components are required");
  return `${warehouseId.length}:${warehouseId}${sku.length}:${sku}`;
}
