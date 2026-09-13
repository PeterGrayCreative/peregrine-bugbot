import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { ProviderExec } from "../src/types.js";
import { safeDiagnostic } from "../src/security/secrets.js";
import { canonicalJson } from "./experiment.js";
import { digest, freeze, integer, text } from "./prediction-contract.js";
import { PREDICTION_LIMITS } from "./prediction-plan.js";

interface Options { directory: string; attemptId: string; closeReads: () => void; teardown: () => Promise<void> }
const diagnostic = (error: unknown) => safeDiagnostic(error instanceof Error ? error.message : typeof error === "string" ? error : "non-Error rejection", 500).replace(/[\x00-\x1f\x7f]/g, " ");
function rejectionEvidence(error: unknown) {
  type Role = "execution" | "cleanup" | "unknown";
  const diagnostics: { role: Role; message: string }[] = [], seen = new Set<unknown>();
  let primaryError: string | null = null, truncated = false, cleanupUnproven = false;
  const visit = (value: unknown, role: Role, depth: number) => {
    if (diagnostics.length >= 16 || depth > 4 || seen.has(value)) { truncated = true; cleanupUnproven = true; return; }
    if (value && typeof value === "object") seen.add(value);
    const message = diagnostic(value), aggregate = value instanceof AggregateError;
    diagnostics.push({ role, message });
    if (role === "cleanup") cleanupUnproven = true;
    if (!aggregate && role === "execution" && primaryError === null) primaryError = message;
    if (aggregate) {
      // runtime-containment's throwWithCleanup puts the primary error first.
      // Unknown aggregate shapes never imply that cleanup was successful.
      cleanupUnproven = true;
      const combined = value.message === "evaluation operation and cleanup both failed";
      if (!Array.isArray(value.errors)) { truncated = true; return; }
      if (value.errors.length > 16) truncated = true;
      for (const [index, child] of value.errors.slice(0, 16).entries()) {
        visit(child, role === "cleanup" ? "cleanup" : combined ? index === 0 ? "execution" : "cleanup" : "unknown", depth + 1);
      }
    }
    if (value instanceof Error && value.cause !== undefined) visit(value.cause, role, depth + 1);
  };
  try { visit(error, "execution", 0); } catch { truncated = true; cleanupUnproven = true; }
  return { primaryError: primaryError ?? diagnostics[0]?.message ?? "execution rejection diagnostic unavailable", diagnostics, truncated, cleanupUnproven };
}
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
    try { write(`${String(events.length).padStart(6, "0")}.json`, value); } catch (error) { evidenceError = diagnostic(error); }
    events.push(value);
  };
  const controller = new AbortController();
  let used = false, closing = false, sealed = false, readsClosed = false, cleanup: Promise<void> | undefined, active: Promise<Awaited<ReturnType<ProviderExec>>> | undefined;
  let cleanupError: string | null = null, readCloseError: string | null = null;
  let executionError: ReturnType<typeof rejectionEvidence> | null = null;
  const recordCleanupError = (error: unknown) => { const message = diagnostic(error); cleanupError = diagnostic(cleanupError ? `${cleanupError}; ${message}` : message); };
  const closeReads = () => { if (readsClosed) return; readsClosed = true; try { options.closeReads(); } catch (error) { readCloseError = diagnostic(error); } };
  const teardown = () => cleanup ??= (async () => {
    if (active) await active.catch(() => undefined);
    try { await options.teardown(); event("teardown-complete", null); }
    catch (error) { recordCleanupError(error); event("teardown-failed", diagnostic(error)); }
  })();
  const expire = () => {
    if (sealed || controller.signal.aborted) return;
    controller.abort("whole-attempt-deadline"); closeReads(); event("deadline-cancellation", { wallMs });
    void teardown();
  };
  const timer = setTimeout(expire, Math.max(0, wallMs - (performance.now() - start)));
  timer.unref();
  event("start", { attemptId: options.attemptId, wallMs, executionClass, providerAuthorization: "not-issued-by-this-primitive" });
  const check = () => { if (performance.now() - start >= wallMs) expire(); if (closing || sealed || controller.signal.aborted || evidenceError) throw new Error("attempt closed at whole-attempt deadline or evidence failure"); };
  async function finalize() {
    if (active) await active.catch(() => undefined);
    await teardown();
    if (performance.now() - start >= wallMs && !controller.signal.aborted) expire();
    clearTimeout(timer); sealed = true;
    const body = { kind: "prediction-cli-deadline-terminal-v1", attemptId: options.attemptId, executionClass, wallMs,
      deadlineExceeded: controller.signal.reason === "whole-attempt-deadline", cancellationReason: controller.signal.aborted ? String(controller.signal.reason) : null,
      elapsedMs: performance.now() - start, executionError, cleanupError, readCloseError, evidenceError,
      teardownCompleted: cleanupError === null && readCloseError === null, events, providerContainmentProven: false, providerAuthorized: false };
    const result = freeze({ ...body, sha256: digest(body) }); write("terminal.json", result); return result;
  }
  let finishing: ReturnType<typeof finalize> | undefined;
  return {
    signal: controller.signal,
    read<T>(operation: () => T): T { check(); const result = operation(); check(); return result; },
    run(run: ProviderExec, command: string, args: string[], opts: NonNullable<Parameters<ProviderExec>[2]> = {}) {
      check(); if (used) throw new Error("single-session attempt cannot retry or delegate"); used = true;
      const remaining = Math.max(1, Math.floor(wallMs - (performance.now() - start)));
      event("exec-start", { command, remainingMs: remaining });
      if (evidenceError) {
        closing = true; controller.abort("evidence-persistence-failed"); closeReads();
        event("evidence-cancellation", { error: evidenceError }); void teardown();
        throw new Error("execution blocked: exec-start evidence persistence failed");
      }
      active = Promise.resolve().then(() => {
        // Timer callbacks cannot run while this turn is blocked. Recheck at
        // invocation, while still allowing finish to await an admitted run.
        const elapsed = performance.now() - start;
        if (elapsed >= wallMs) expire();
        if (controller.signal.aborted || evidenceError) throw new Error("execution cancelled at whole-attempt deadline or evidence failure");
        const remainingAtInvocation = Math.max(1, Math.floor(wallMs - elapsed));
        return run(command, args, { ...opts, timeoutMs: Math.min(opts.timeoutMs ?? remainingAtInvocation, remainingAtInvocation), deadlineSignal: controller.signal });
      })
        .then(result => {
          const cleanupErrors = result.cleanupErrors?.slice(0, 16).map(diagnostic) ?? [];
          event("exec-closed", { code: result.code, timedOut: result.timedOut, cleanupErrors, cleanupErrorsTruncated: (result.cleanupErrors?.length ?? 0) > 16 });
          if (cleanupErrors.length) recordCleanupError(cleanupErrors.join("; "));
          return result;
        }, error => {
          executionError = rejectionEvidence(error);
          if (executionError.cleanupUnproven) recordCleanupError(executionError.diagnostics.filter(item => item.role === "cleanup").map(item => item.message).join("; ") || "cleanup unproven after execution rejection");
          event("exec-rejected", executionError);
          throw error;
        });
      return active;
    },
    finish() {
      if (!finishing) {
        // Seal admission before any callback/await; install the shared promise
        // before closeReads so even reentrant finish calls observe it.
        closing = true; finishing = Promise.resolve().then(finalize); closeReads();
      }
      return finishing;
    },
  };
}
