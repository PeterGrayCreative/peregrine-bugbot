import { sha } from "./prediction-contract.js";
import { closeSync, constants, fstatSync, ftruncateSync, openSync, readFileSync, writeSync } from "node:fs";

export const FORWARDER_REDACTION_KIND = "forwarding-capability-sha256-v1";
/** The digest occupies the token's original position solely for exact offline
 * cross-record comparisons. Metadata explicitly marks it as a redaction, never
 * as a live capability. This object stays in memory and cannot authorize I/O. */
export function predictionEvidenceRedactor(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("invalid forwarding capability shape");
  const capability = Object.freeze({ kind: FORWARDER_REDACTION_KIND, sha256: sha(token) });
  const redact = (value: string) => value.replaceAll(token, capability.sha256);
  const validate = (value: unknown) => {
    const walk = (v: unknown): void => {
      if (typeof v === "string") {
        // Inspect stdout is JSON text inside a stream; argv is already an array.
        for (const match of v.matchAll(/(?:MCP_FORWARDER_TOKEN=|http:\/\/(?:mcp-forwarder:8082|host\.docker\.internal:[0-9]+)\/mcp\/)([^"\\\s/?#]+)/g))
          if (match[1] !== token) throw new Error("forwarding capability differs from the live attempt");
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    }; walk(value);
  };
  return Object.freeze({ capability, validate, text: redact,
    value<T>(value: T): T { return JSON.parse(redact(JSON.stringify(value))); },
    error(error: unknown): Error {
      const seen = new Set<unknown>();
      const visit = (value: unknown, depth: number): Error => {
        if (depth > 4 || seen.has(value)) return new AggregateError([], "error redaction truncated; cleanup unproven");
        if (value && typeof value === "object") seen.add(value);
        if (value instanceof AggregateError) {
          const errors = value.errors.slice(0, 16).map(e => visit(e, depth + 1));
          if (value.errors.length > 16) errors.push(new Error("error redaction truncated; cleanup unproven"));
          return new AggregateError(errors, redact(value.message));
        }
        return new Error(redact(value instanceof Error ? value.message : "execution rejected"), value instanceof Error && value.cause !== undefined ? { cause: visit(value.cause, depth + 1) } : undefined);
      };
      try { return visit(error, 0); }
      catch { return new AggregateError([], "error redaction failed; cleanup unproven"); }
    } });
}

/** Called only after the contained output reader has validated this attempt's
 * single output, and the client has exited and been removed. Preserve original
 * byte identity, not a second durable copy of the forwarding capability. */
export function redactPredictionOutput(path: string, original: string, redactor: ReturnType<typeof predictionEvidenceRedactor>) {
  const safe = redactor.text(original), binding = { kind: FORWARDER_REDACTION_KIND, originalSha256: sha(original), persistedSha256: sha(safe) };
  if (safe !== original) {
    const fd = openSync(path, constants.O_RDWR | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o022) !== 0 || readFileSync(fd, "utf8") !== original) throw new Error("output changed before capability redaction");
      ftruncateSync(fd, 0); const bytes = Buffer.from(safe);
      let offset = 0; while (offset < bytes.length) { const written = writeSync(fd, bytes, offset, bytes.length - offset, offset); if (written <= 0) throw new Error("output redaction persistence failed"); offset += written; }
    } finally { closeSync(fd); }
  }
  return { safe, binding };
}
