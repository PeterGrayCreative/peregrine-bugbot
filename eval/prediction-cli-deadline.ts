import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { ProviderExec } from "../src/types.js";
import { canonicalJson } from "./experiment.js";
import { digest, freeze, integer, text } from "./prediction-contract.js";
import { PREDICTION_LIMITS } from "./prediction-plan.js";

interface Options { directory: string; attemptId: string; closeReads: () => void; teardown: () => Promise<void> }
/** Create before any preparation. Wrap the existing contained runProvider; its
 * cleanup is not cancelled by the deadline. This does not authorize dispatch. */
export function createPredictionCliDeadline(options: Options) { return deadline(options, PREDICTION_LIMITS.wallMs, "whole-attempt"); }
/** Accelerated real-process tests, explicitly never provider-containment proof. */
export function createStructuralPredictionCliDeadline(options: Options, wallMs: number) {
  integer(wallMs); if (wallMs < 1 || wallMs > PREDICTION_LIMITS.wallMs) throw new Error("invalid structural deadline");
  return deadline(options, wallMs, "accelerated-structural");
}
function deadline(options: Options, wallMs: number, executionClass: string) {
  const start = performance.now(); text(options.attemptId);
  mkdirSync(options.directory, { mode: 0o700 });
  const events: { kind: string; elapsedMs: number; detail: unknown }[] = [];
  let evidenceError: string | null = null;
  const write = (name: string, value: unknown) => writeFileSync(join(options.directory, name), canonicalJson(value) + "\n", { flag: "wx", mode: 0o600 });
  const event = (kind: string, detail: unknown) => {
    const value = { kind, elapsedMs: performance.now() - start, detail };
    try { write(`${String(events.length).padStart(6, "0")}.json`, value); } catch (error) { evidenceError = String(error); }
    events.push(value);
  };
  const controller = new AbortController();
  let used = false, sealed = false, cleanup: Promise<void> | undefined, active: Promise<Awaited<ReturnType<ProviderExec>>> | undefined;
  let cleanupError: string | null = null, readCloseError: string | null = null;
  const closeReads = () => { try { options.closeReads(); } catch (error) { readCloseError = String(error); } };
  const teardown = () => cleanup ??= (async () => {
    if (active) await active.catch(() => undefined);
    try { await options.teardown(); event("teardown-complete", null); }
    catch (error) { cleanupError = String(error); event("teardown-failed", cleanupError); }
  })();
  const expire = () => {
    if (sealed || controller.signal.aborted) return;
    controller.abort("whole-attempt-deadline"); closeReads(); event("deadline-cancellation", { wallMs });
    void teardown();
  };
  const timer = setTimeout(expire, Math.max(0, wallMs - (performance.now() - start)));
  timer.unref();
  event("start", { attemptId: options.attemptId, wallMs, executionClass, providerAuthorization: "not-issued-by-this-primitive" });
  const check = () => { if (performance.now() - start >= wallMs) expire(); if (sealed || controller.signal.aborted || evidenceError) throw new Error("attempt closed at whole-attempt deadline or evidence failure"); };
  return {
    signal: controller.signal,
    read<T>(operation: () => T): T { check(); const result = operation(); check(); return result; },
    run(run: ProviderExec, command: string, args: string[], opts: NonNullable<Parameters<ProviderExec>[2]> = {}) {
      check(); if (used) throw new Error("single-session attempt cannot retry or delegate"); used = true;
      const remaining = Math.max(1, Math.floor(wallMs - (performance.now() - start)));
      event("exec-start", { command, remainingMs: remaining });
      active = Promise.resolve().then(() => run(command, args, { ...opts, timeoutMs: Math.min(opts.timeoutMs ?? remaining, remaining), deadlineSignal: controller.signal }))
        .then(result => { event("exec-closed", { code: result.code, timedOut: result.timedOut, cleanupErrors: result.cleanupErrors ?? [] }); if (result.cleanupErrors?.length) cleanupError = result.cleanupErrors.join("; "); return result; });
      return active;
    },
    async finish() {
      if (sealed) throw new Error("attempt evidence already sealed");
      if (active) await active.catch(() => undefined);
      closeReads(); await teardown();
      if (performance.now() - start >= wallMs && !controller.signal.aborted) expire();
      clearTimeout(timer); sealed = true;
      const body = { kind: "prediction-cli-deadline-terminal-v1", attemptId: options.attemptId, executionClass, wallMs,
        deadlineExceeded: controller.signal.aborted, elapsedMs: performance.now() - start, cleanupError, readCloseError, evidenceError,
        teardownCompleted: cleanupError === null && readCloseError === null, events, providerContainmentProven: false, providerAuthorized: false };
      const result = freeze({ ...body, sha256: digest(body) }); write("terminal.json", result); return result;
    },
  };
}
