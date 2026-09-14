import { createHash } from "node:crypto";
import type { ExecResult } from "../src/util/exec.js";

/** No strings originating in command output or diagnostics cross this boundary.
 * Hashes bind the in-memory bytes; they are not reversible redactions. */
export function privateByteBinding(bytes: string | Buffer) {
  const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, "utf8");
  return Object.freeze({ bytes: value.length, sha256: createHash("sha256").update(value).digest("hex") });
}

export function privateCommandBinding(command: string, args: readonly string[], env?: Readonly<Record<string, string>>) {
  if (command !== "docker" || !Array.isArray(args) || args.length > 1000 || args.some(v => typeof v !== "string")) throw new Error("unregistered mechanical command");
  const argv = JSON.stringify(args);
  if (Buffer.byteLength(argv) > 1_048_576) throw new Error("mechanical command exceeds memory policy");
  return Object.freeze({ command: "docker" as const, argumentCount: args.length, argv: privateByteBinding(argv),
    environment: privateByteBinding(JSON.stringify(Object.entries(env ?? {}).sort(([a], [b]) => a.localeCompare(b)))) });
}

export function privateResultBinding(value: ExecResult) {
  if (!value || typeof value.stdout !== "string" || typeof value.stderr !== "string" ||
      value.code !== null && (!Number.isSafeInteger(value.code) || value.code < -1 || value.code > 255) ||
      typeof value.timedOut !== "boolean" || value.processId !== undefined && value.processId !== null &&
      (!Number.isSafeInteger(value.processId) || value.processId <= 0 || value.processId > 2_147_483_647) ||
      value.outputLimitExceeded !== undefined && typeof value.outputLimitExceeded !== "boolean" ||
      value.cleanupErrors !== undefined && (!Array.isArray(value.cleanupErrors) || value.cleanupErrors.some(v => typeof v !== "string")))
    throw new Error("invalid mechanical result metadata");
  // Deliberately select fields. Never spread or serialize the producer object.
  return Object.freeze({ kind: "prediction-private-result-v1" as const, code: value.code, timedOut: value.timedOut,
    processId: value.processId ?? null, cleanupFailed: Boolean(value.cleanupErrors?.length),
    outputLimitExceeded: value.outputLimitExceeded === true,
    stdout: privateByteBinding(value.stdout), stderr: privateByteBinding(value.stderr),
    cleanup: privateByteBinding(JSON.stringify(value.cleanupErrors ?? [])) });
}

/** Diagnostics are hashes only, including nested or malformed errors. Unknown
 * aggregate/cause shapes conservatively leave cleanup unproven. */
export function privateFailureBinding(error: unknown) {
  const seen = new Set<unknown>();
  let cleanupUnproven = false, truncated = false;
  const messages: ReturnType<typeof privateByteBinding>[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (depth > 4 || seen.has(value) || messages.length >= 16) { truncated = cleanupUnproven = true; return; }
    if (value && typeof value === "object") seen.add(value);
    const own = value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "message") : undefined;
    messages.push(privateByteBinding(typeof own?.value === "string" ? own.value : typeof value === "string" ? value : "unavailable"));
    if (value instanceof AggregateError) {
      cleanupUnproven = true;
      const children = Object.getOwnPropertyDescriptor(value, "errors")?.value;
      if (!Array.isArray(children)) { truncated = true; return; }
      if (children.length > 16) truncated = true;
      for (const child of children.slice(0, 16)) visit(child, depth + 1);
    }
    if (value && typeof value === "object") {
      const cause = Object.getOwnPropertyDescriptor(value, "cause");
      if (cause) { cleanupUnproven = true; if ("value" in cause) visit(cause.value, depth + 1); else truncated = true; }
    }
  };
  try { visit(error, 0); } catch { truncated = cleanupUnproven = true; }
  return Object.freeze({ kind: "prediction-private-failure-v1" as const, cleanupUnproven, truncated, messages });
}

export function privateExecutionError(error: unknown): Error {
  return privateFailureBinding(error).cleanupUnproven
    ? new AggregateError([], "private execution failed; cleanup unproven") : new Error("private execution failed");
}
