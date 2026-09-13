import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { exec } from "../src/util/exec.js";
import { mechanicalEvidenceBinding, type MechanicalEvidenceBinding } from "./prediction-mechanical-evidence.js";
import { samplePredictionClock } from "./prediction-cli-deadline.js";
import { hash } from "./prediction-contract.js";
import { privateCommandBinding, privateExecutionError, privateFailureBinding, privateResultBinding } from "./prediction-typed-evidence.js";

/** A metadata-only tee over the existing executor. It has no raw serializer,
 * including on failure. Semantic validation is supplied by the exact caller
 * before reduction; receipt authentication remains an external responsibility. */
export function observePrivatePredictionExec(directory: string, input: MechanicalEvidenceBinding, options: {
  run: typeof exec; policySha256: string; validate: (args: readonly string[], result: Awaited<ReturnType<typeof exec>>) => void;
  phase?: () => "preparation" | "execution" | "teardown";
}): typeof exec {
  const binding = mechanicalEvidenceBinding(input), policySha256 = hash(options.policySha256);
  if (typeof options.validate !== "function") throw new Error("live mechanical validation required");
  mkdirSync(directory, { mode: 0o700 }); let ordinal = 0;
  const write = (name: string, value: unknown) => writeFileSync(join(directory, name), JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600 });
  return async (command, args, settings = {}) => {
    const sequence = ++ordinal, id = String(sequence).padStart(6, "0"), began = performance.now();
    const cleanup = command === "docker" && !settings.deadlineSignal && (["stop", "logs", "rm", "ps"].includes(args[0]!) || args[0] === "network" && ["rm", "ls", "inspect"].includes(args[1]!));
    let persistenceFailed = false;
    try {
      const clock = samplePredictionClock();
      write(id + "-start.json", { kind: "prediction-private-mechanical-start-v1", clock, binding, policySha256, sequence,
        phase: options.phase?.() ?? "unassigned",
        invocation: privateCommandBinding(command, args, settings.env), deadlineAttached: Boolean(settings.deadlineSignal),
        aborted: settings.deadlineSignal?.aborted ?? false, timeoutMs: settings.timeoutMs ?? null, cleanup });
    } catch (error) { if (!cleanup) throw privateExecutionError(error); persistenceFailed = true; }
    try {
      const remaining = settings.timeoutMs === undefined ? undefined : settings.timeoutMs - (performance.now() - began);
      if (settings.deadlineSignal?.aborted || remaining !== undefined && remaining <= 0) throw new Error("private mechanical deadline closed");
      const result = await options.run(command, args, { ...settings, timeoutMs: remaining, captureProcessId: true, maximumOutputBytes: settings.maximumOutputBytes ?? 4_194_304 });
      options.validate(args, result);
      const reduced = privateResultBinding(result), clock = samplePredictionClock();
      write(id + "-terminal.json", { kind: "prediction-private-mechanical-terminal-v1", clock, binding, policySha256, sequence,
        result: reduced, validation: "live-result-shape-validated", persistenceFailed });
      if (persistenceFailed) throw new AggregateError([], "private mechanical persistence failed; cleanup unproven");
      if (reduced.outputLimitExceeded) throw new Error("private mechanical capture bound exceeded");
      return result;
    } catch (error) {
      try { write(id + "-failure.json", { kind: "prediction-private-mechanical-failure-v1", clock: samplePredictionClock(), binding,
        policySha256, sequence, failure: privateFailureBinding(error), persistenceFailed }); }
      catch { throw new AggregateError([], "private mechanical persistence failed; cleanup unproven"); }
      throw privateExecutionError(error);
    }
  };
}
