export interface ExpirableReservation {
  reservationId: string;
  status: "active" | "released" | "fulfilled" | "expired";
  expiresAt: string;
  lines: Array<{ sku: string; quantity: number }>;
}

export interface ExpiryRelease {
  reservationId: string;
  released: Array<{ sku: string; quantity: number }>;
  expiredAt: string;
}

export function isExpired(reservation: ExpirableReservation, nowMs: number): boolean {
  const expiresAt = Date.parse(reservation.expiresAt);
  if (!Number.isFinite(expiresAt)) throw new Error("invalid reservation expiry");
  return reservation.status === "active" && expiresAt <= nowMs;
}

export function releaseExpired(reservation: ExpirableReservation, nowMs: number): ExpiryRelease | null {
  if (!isExpired(reservation, nowMs)) return null;
  return {
    reservationId: reservation.reservationId,
    released: reservation.lines.map((line) => ({ ...line })),
    expiredAt: new Date(nowMs).toISOString(),
  };
}

export function dueForExpiry(reservations: ExpirableReservation[], nowMs: number, limit: number): ExpirableReservation[] {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("invalid expiry batch limit");
  return reservations
    .filter((reservation) => isExpired(reservation, nowMs))
    .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt) || left.reservationId.localeCompare(right.reservationId))
    .slice(0, limit);
}

export function releasedUnitCount(releases: ExpiryRelease[]): number {
  return releases.reduce(
    (total, release) => total + release.released.reduce((subtotal, line) => subtotal + line.quantity, 0),
    0,
  );
}

export function expiryPartition(reservation: ExpirableReservation): string {
  return reservation.expiresAt.slice(0, 10);
}
