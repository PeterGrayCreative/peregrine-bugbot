import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { exec } from "../src/util/exec.js";
import { predictionFailureEvidence, samplePredictionClock } from "./prediction-cli-deadline.js";
import { exact, freeze, hash, sha, text } from "./prediction-contract.js";
import { predictionEvidenceRedactor } from "./prediction-evidence-redaction.js";

export interface MechanicalEvidenceBinding { runId: string; attemptId: string; scopeSha256: string; sourceSha256: string; channel: "client" | "sidecars" }
export function mechanicalEvidenceBinding(value: MechanicalEvidenceBinding) {
  exact(value, ["runId", "attemptId", "scopeSha256", "sourceSha256", "channel"], "mechanical binding");
  text(value.runId); text(value.attemptId); hash(value.scopeSha256); hash(value.sourceSha256);
  if (!["client", "sidecars"].includes(value.channel)) throw new Error("invalid mechanical channel");
  return freeze(value);
}

/** A tee around the existing executor, not an observer-authentication service.
 * Never records environment/credentials. Cleanup must still execute if evidence
 * storage fails; the missing receipt then prevents a positive assessment. */
export function observePredictionExec(directory: string, input: MechanicalEvidenceBinding, run: typeof exec = exec, forwarderToken?: string): typeof exec {
  const binding = mechanicalEvidenceBinding(input);
  const redaction = forwarderToken === undefined ? null : predictionEvidenceRedactor(forwarderToken);
  const forwarderCapability = redaction?.capability ?? null;
  const validate = (value: unknown) => {
    if (redaction) redaction.validate(value);
    else if (/(?:MCP_FORWARDER_TOKEN=|http:\/\/(?:mcp-forwarder:8082|host\.docker\.internal:[0-9]+)\/mcp\/)/.test(JSON.stringify(value))) throw new Error("forwarding capability redaction context required");
  };
  mkdirSync(directory, { mode: 0o700 }); let ordinal = 0;
  const write = (path: string, value: unknown) => writeFileSync(join(directory, path), JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600 });
  return async (command, args, options = {}) => {
    const startedClock = performance.now(), sequence = ++ordinal, id = String(sequence).padStart(6, "0"), cleanup = command === "docker" && !options.deadlineSignal && (["stop", "logs", "rm", "ps"].includes(args[0]!) || args[0] === "network" && ["rm", "ls", "inspect"].includes(args[1]!));
    let evidenceError: unknown;
    try { validate(args); const clock = samplePredictionClock(); write(id + "-start.json", { kind: "prediction-mechanical-start-v3", clock, binding, forwarderCapability, sequence, command, args: redaction?.value(args) ?? args, stdinSha256: options.stdin === undefined ? null : sha(options.stdin),
      deadlineAttached: Boolean(options.deadlineSignal), aborted: options.deadlineSignal?.aborted ?? false, timeoutMs: options.timeoutMs ?? null, cleanup, startedAt: clock.unixMs }); }
    catch (error) { if (!cleanup) throw error; evidenceError = error; }
    try {
      const remaining = options.timeoutMs === undefined ? undefined : options.timeoutMs - (performance.now() - startedClock);
      if (options.deadlineSignal?.aborted || remaining !== undefined && remaining <= 0) throw new Error("deadline elapsed before observed execution");
      const result = await run(command, args, { ...options, timeoutMs: remaining, captureProcessId: true });
      validate(result);
      const safe = redaction?.value(result) ?? result;
      const bounded = (bytes: string) => ({ bytes: bytes.slice(0, 16_777_216), complete: Buffer.byteLength(bytes) <= 16_777_216, sha256: sha(bytes) });
      try { const clock = samplePredictionClock(); write(id + "-terminal.json", { kind: "prediction-mechanical-terminal-v3", clock, binding, forwarderCapability, sequence, result: { ...safe, stdout: bounded(safe.stdout), stderr: bounded(safe.stderr) }, closedAt: clock.unixMs, evidenceError: evidenceError ? predictionFailureEvidence(redaction?.error(evidenceError) ?? evidenceError) : null }); }
      catch (error) { evidenceError ??= error; }
      if (evidenceError) throw new AggregateError([evidenceError], "mechanical evidence persistence failed; cleanup observation unproven");
      return result;
    } catch (error) {
      error = redaction?.error(error) ?? error;
      try { const clock = samplePredictionClock(); write(id + "-failure.json", { kind: "prediction-mechanical-failure-v3", clock, binding, forwarderCapability, sequence, failure: predictionFailureEvidence(error), closedAt: clock.unixMs }); }
      catch (persistence) { throw new AggregateError([error, persistence], "execution and mechanical evidence persistence failed"); }
      throw error;
    }
  };
}
