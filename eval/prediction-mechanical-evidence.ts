import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { exec } from "../src/util/exec.js";
import { predictionFailureEvidence } from "./prediction-cli-deadline.js";
import { exact, freeze, hash, sha, text } from "./prediction-contract.js";

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
export function observePredictionExec(directory: string, input: MechanicalEvidenceBinding, run: typeof exec = exec): typeof exec {
  const binding = mechanicalEvidenceBinding(input);
  mkdirSync(directory, { mode: 0o700 }); let ordinal = 0;
  const write = (path: string, value: unknown) => writeFileSync(join(directory, path), JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600 });
  return async (command, args, options = {}) => {
    const startedClock = performance.now(), sequence = ++ordinal, id = String(sequence).padStart(6, "0"), cleanup = command === "docker" && !options.deadlineSignal && (["stop", "logs", "rm", "ps"].includes(args[0]!) || args[0] === "network" && ["rm", "ls", "inspect"].includes(args[1]!));
    let evidenceError: unknown;
    try { write(id + "-start.json", { kind: "prediction-mechanical-start-v1", binding, sequence, command, args, stdinSha256: options.stdin === undefined ? null : sha(options.stdin),
      deadlineAttached: Boolean(options.deadlineSignal), aborted: options.deadlineSignal?.aborted ?? false, timeoutMs: options.timeoutMs ?? null, cleanup, startedAt: Date.now() }); }
    catch (error) { if (!cleanup) throw error; evidenceError = error; }
    try {
      const remaining = options.timeoutMs === undefined ? undefined : options.timeoutMs - (performance.now() - startedClock);
      if (options.deadlineSignal?.aborted || remaining !== undefined && remaining <= 0) throw new Error("deadline elapsed before observed execution");
      const result = await run(command, args, { ...options, timeoutMs: remaining, captureProcessId: true });
      const bounded = (bytes: string) => ({ bytes: bytes.slice(0, 16_777_216), complete: Buffer.byteLength(bytes) <= 16_777_216, sha256: sha(bytes) });
      try { write(id + "-terminal.json", { kind: "prediction-mechanical-terminal-v1", binding, sequence, result: { ...result, stdout: bounded(result.stdout), stderr: bounded(result.stderr) }, closedAt: Date.now(), evidenceError: evidenceError ? predictionFailureEvidence(evidenceError) : null }); }
      catch (error) { evidenceError ??= error; }
      if (evidenceError) throw new AggregateError([evidenceError], "mechanical evidence persistence failed; cleanup observation unproven");
      return result;
    } catch (error) {
      try { write(id + "-failure.json", { kind: "prediction-mechanical-failure-v1", binding, sequence, failure: predictionFailureEvidence(error), closedAt: Date.now() }); }
      catch (persistence) { throw new AggregateError([error, persistence], "execution and mechanical evidence persistence failed"); }
      throw error;
    }
  };
}
