export interface StoredReservation {
  reservationId: string;
  requestId: string;
  warehouseId: string;
  status: "active" | "released" | "fulfilled" | "expired";
  createdAt: string;
  updatedAt: string;
}

export class ReservationStore {
  readonly #byId = new Map<string, StoredReservation>();
  readonly #byRequest = new Map<string, string>();

  create(reservation: StoredReservation): void {
    if (this.#byId.has(reservation.reservationId)) throw new Error("reservation already exists");
    if (this.#byRequest.has(reservation.requestId)) throw new Error("request already reserved");
    if (reservation.status !== "active") throw new Error("new reservation must be active");
    this.#byId.set(reservation.reservationId, structuredClone(reservation));
    this.#byRequest.set(reservation.requestId, reservation.reservationId);
  }

  get(reservationId: string): StoredReservation | null {
    const value = this.#byId.get(reservationId);
    return value ? structuredClone(value) : null;
  }

  findByRequest(requestId: string): StoredReservation | null {
    const reservationId = this.#byRequest.get(requestId);
    return reservationId ? this.get(reservationId) : null;
  }

  transition(
    reservationId: string,
    status: Exclude<StoredReservation["status"], "active">,
    updatedAt: string,
  ): StoredReservation {
    const existing = this.#byId.get(reservationId);
    if (!existing) throw new Error("reservation not found");
    if (existing.status !== "active") throw new Error("reservation is already terminal");
    if (Date.parse(updatedAt) < Date.parse(existing.updatedAt)) throw new Error("reservation timestamp moved backward");
    const updated = { ...existing, status, updatedAt };
    this.#byId.set(reservationId, updated);
    return structuredClone(updated);
  }

  activeForWarehouse(warehouseId: string): StoredReservation[] {
    return [...this.#byId.values()]
      .filter((reservation) => reservation.warehouseId === warehouseId && reservation.status === "active")
      .map((reservation) => structuredClone(reservation))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  size(): number {
    return this.#byId.size;
  }
}
