import type { RunFailureTelemetry } from "../types.js";

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
  readonly telemetry?: RunFailureTelemetry;

  constructor(kind: RunFailureKind, message: string, options?: ErrorOptions & { telemetry?: RunFailureTelemetry }) {
    super(message, options);
    this.name = "RunFailureError";
    this.kind = kind;
    this.telemetry = options?.telemetry;
  }
}

export function runFailureTelemetry(error: unknown): RunFailureTelemetry | undefined {
  return error instanceof RunFailureError ? error.telemetry : undefined;
}

export function runFailureKind(error: unknown): RunFailureKind {
  return error instanceof RunFailureError ? error.kind : "unknown";
}
