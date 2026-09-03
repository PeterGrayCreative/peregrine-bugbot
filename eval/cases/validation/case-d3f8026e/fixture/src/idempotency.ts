export interface IdempotencyRecord<T> {
  key: string;
  requestSha256: string;
  response: T;
  createdAt: string;
  expiresAt: string;
}

export class IdempotencyRegistry<T> {
  readonly #records = new Map<string, IdempotencyRecord<T>>();

  lookup(key: string, requestSha256: string, nowMs: number): T | null {
    const record = this.#records.get(key);
    if (!record) return null;
    if (Date.parse(record.expiresAt) <= nowMs) {
      this.#records.delete(key);
      return null;
    }
    if (record.requestSha256 !== requestSha256) throw new Error("idempotency key reused with different request");
    return structuredClone(record.response);
  }

  remember(record: IdempotencyRecord<T>, nowMs: number): void {
    if (!record.key.trim()) throw new Error("idempotency key is required");
    if (!/^[a-f0-9]{64}$/.test(record.requestSha256)) throw new Error("invalid request digest");
    if (Date.parse(record.expiresAt) <= nowMs) throw new Error("idempotency record is already expired");
    const existing = this.#records.get(record.key);
    if (existing && Date.parse(existing.expiresAt) > nowMs) {
      if (existing.requestSha256 !== record.requestSha256) throw new Error("idempotency key conflict");
      return;
    }
    this.#records.set(record.key, structuredClone(record));
  }

  prune(nowMs: number): number {
    let removed = 0;
    for (const [key, record] of this.#records) {
      if (Date.parse(record.expiresAt) <= nowMs) {
        this.#records.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  activeKeys(nowMs: number): string[] {
    this.prune(nowMs);
    return [...this.#records.keys()].sort();
  }
}
