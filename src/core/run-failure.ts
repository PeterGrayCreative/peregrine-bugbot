export const RUN_FAILURE_KINDS = [
  "timeout",
  "provider",
  "parse",
  "configuration",
  "unknown",
] as const;

export type RunFailureKind = (typeof RUN_FAILURE_KINDS)[number];

/** A stable, machine-readable failure raised at a known review boundary. */
export class RunFailureError extends Error {
  readonly kind: RunFailureKind;

  constructor(kind: RunFailureKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RunFailureError";
    this.kind = kind;
  }
}

export function runFailureKind(error: unknown): RunFailureKind {
  return error instanceof RunFailureError ? error.kind : "unknown";
}
