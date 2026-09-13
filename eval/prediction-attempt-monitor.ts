import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { canonicalJson } from "./experiment.js";
import { digest, exact, freeze, hash, integer, same, sha, text } from "./prediction-contract.js";
import { PREDICTION_LIMITS } from "./prediction-plan.js";
import { checkPredictionObservedRoute, type PredictionObservedRoute } from "./prediction-execution-contract.js";

export interface PredictionTokenSnapshot {
  inputTokens: number; outputTokens: number; reasoningTokens: number; preprocessingTokens: number;
  semantics: "cumulative-input-includes-cache-output-includes-reasoning-v1"; sourceEventSha256: string;
}
interface MonitorOptions { directory: string; freezeSha256: string; attemptId: string; requestedVersion: string | null }
interface EvidenceEvent { index: number; previousSha256: string | null; elapsedMs: number; kind: string; data: unknown; sha256: string }

/** Observes one attempt and issues an AbortSignal at the whole-attempt deadline.
 * No subprocess/provider is started. The eventual runtime must wire that signal
 * to authenticated container cleanup; this observer never asserts termination. */
export function createPredictionAttemptMonitor(options: MonitorOptions) {
  return monitor(options, () => performance.now(), "monotonic-host-clock");
}
/** Explicit deterministic test seam; records are permanently structural evidence. */
export function createStructuralPredictionAttemptMonitor(options: MonitorOptions, now: () => number) {
  return monitor(options, now, "structural-test-clock");
}
function monitor(options: MonitorOptions, now: () => number, clock: string) {
  hash(options.freezeSha256); text(options.attemptId);
  mkdirSync(options.directory, { mode: 0o700 });
  const began = now();
  if (!Number.isFinite(began)) throw new Error("invalid monotonic start");
  const controller = new AbortController(), events: EvidenceEvent[] = [], chunks: string[] = [];
  let previousTime = began, ended = false, stopReason: string | null = null;
  let usage: PredictionTokenSnapshot | null = null, route: PredictionObservedRoute | null = null;
  const seenUsage = new Set<string>();
  function record(kind: string, data: unknown) {
    if (ended) throw new Error("attempt already sealed");
    const current = now();
    if (!Number.isFinite(current) || current < previousTime) throw new Error("monotonic clock regression");
    previousTime = current;
    const body = { index: events.length, previousSha256: events.at(-1)?.sha256 ?? null, elapsedMs: current - began, kind, data };
    const event = freeze({ ...body, sha256: digest(body) });
    writeFileSync(join(options.directory, `${String(event.index).padStart(6, "0")}.json`), `${canonicalJson(event)}\n`, { flag: "wx", mode: 0o600 });
    events.push(event);
  }
  const { directory: _directory, ...binding } = options;
  record("start", { ...binding, clock, deadlineMs: PREDICTION_LIMITS.wallMs, caps: PREDICTION_LIMITS, providerDispatches: 0 });
  function stop(reason: string) {
    if (ended) throw new Error("attempt already sealed");
    if (stopReason !== null) return;
    stopReason = text(reason); record("stop", { reason: stopReason, terminationProven: false });
    controller.abort(stopReason);
  }
  const timer = setTimeout(() => { if (!ended) stop("whole-attempt-deadline"); }, PREDICTION_LIMITS.wallMs);
  timer.unref();
  function checkDeadline() { if (now() - began >= PREDICTION_LIMITS.wallMs) stop("whole-attempt-deadline"); }
  return {
    signal: controller.signal,
    checkDeadline,
    stop,
    recordRawOutput(chunk: string) {
      checkDeadline();
      if (typeof chunk !== "string") throw new Error("raw output must be text");
      // Output arriving during cancellation is retained, never discarded.
      record("raw-output", { chunk, sha256: sha(chunk), arrivedAfterStop: stopReason !== null }); chunks.push(chunk);
    },
    recordRoute(observed: PredictionObservedRoute) {
      checkDeadline(); record("route-observation", observed);
      try {
        const result = checkPredictionObservedRoute(options.requestedVersion, observed);
        if (route && canonicalJson(route) !== canonicalJson(observed)) stop("served-identity-changed");
        route = freeze(observed);
        if (!result.matches) stop("served-identity-mismatch-or-unavailable");
      } catch { stop("served-identity-mismatch-or-unavailable"); }
    },
    recordTokens(snapshot: PredictionTokenSnapshot) {
      checkDeadline(); record("token-observation", snapshot);
      try {
        exact(snapshot, ["inputTokens", "outputTokens", "reasoningTokens", "preprocessingTokens", "semantics", "sourceEventSha256"], "cumulative token snapshot");
        same(snapshot.semantics, "cumulative-input-includes-cache-output-includes-reasoning-v1", "unknown token inclusion semantics");
        hash(snapshot.sourceEventSha256);
        if (seenUsage.has(snapshot.sourceEventSha256)) throw new Error("replayed token event");
        for (const key of ["inputTokens", "outputTokens", "reasoningTokens", "preprocessingTokens"] as const) {
          integer(snapshot[key]); if (usage && snapshot[key] < usage[key]) throw new Error("cumulative counter regression");
        }
        if (snapshot.reasoningTokens > snapshot.outputTokens) throw new Error("reasoning must be included in output");
        const aggregate = snapshot.inputTokens + snapshot.outputTokens + snapshot.preprocessingTokens;
        integer(aggregate); seenUsage.add(snapshot.sourceEventSha256); usage = freeze(snapshot);
        if (aggregate > PREDICTION_LIMITS.aggregateTokens) stop("aggregate-token-cap-exceeded");
        if (snapshot.outputTokens > PREDICTION_LIMITS.outputTokens) stop("output-token-cap-exceeded");
      } catch { stop("token-accounting-incomplete-or-invalid"); }
    },
    finish(status: "completed" | "partial" | "missing") {
      checkDeadline();
      if (!["completed", "partial", "missing"].includes(status)) throw new Error("invalid terminal outcome");
      if (status === "missing" && (chunks.length || route !== null || usage !== null)) throw new Error("missing outcome cannot hide observed work");
      if (status === "completed" && (chunks.length === 0 || usage === null || !checkPredictionObservedRoute(options.requestedVersion, route).matches)) stop("completed-result-missing-output-route-or-accounting");
      const body = { kind: "prediction-attempt-monitor-terminal-v1", freezeSha256: options.freezeSha256, attemptId: options.attemptId,
        status: stopReason !== null ? "stopped" : status, stopReason, requestedStatus: status, eventSha256s: events.map(e => e.sha256),
        elapsedMs: now() - began, rawResponseSha256: chunks.length ? sha(chunks.join("")) : null, rawChunks: chunks.length,
        usage, observedRoute: route, providerDispatches: 0, executionClass: clock === "structural-test-clock" ? "structural" : "unbound-observer",
        signalAborted: controller.signal.aborted, terminationProven: false, compliantProviderResult: false };
      const terminal = freeze({ ...body, sha256: digest(body) });
      writeFileSync(join(options.directory, "terminal.json"), `${canonicalJson(terminal)}\n`, { flag: "wx", mode: 0o600 });
      ended = true; clearTimeout(timer); return terminal;
    },
  };
}
export type PredictionMonitorTerminal = ReturnType<ReturnType<typeof createPredictionAttemptMonitor>["finish"]>;

/** The caller-held digest authenticates the terminal and its complete append-only
 * chain. A directory alone is not authority and can never prove process exit. */
export function readPredictionMonitorEvidence(directory: string, expectedTerminalSha256: string) {
  const terminal = JSON.parse(readFileSync(join(directory, "terminal.json"), "utf8")) as PredictionMonitorTerminal;
  const { sha256, ...body } = terminal;
  same(sha256, hash(expectedTerminalSha256), "trusted terminal digest mismatch"); same(sha256, digest(body), "terminal seal mismatch");
  const expectedFiles = [...terminal.eventSha256s.map((_, i) => `${String(i).padStart(6, "0")}.json`), "terminal.json"].sort();
  same(readdirSync(directory).sort(), expectedFiles, "missing or extra immutable monitor evidence");
  let previousSha256: string | null = null, elapsed = 0;
  const events = terminal.eventSha256s.map((expected, i) => {
    const event = JSON.parse(readFileSync(join(directory, `${String(i).padStart(6, "0")}.json`), "utf8")) as EvidenceEvent;
    const { sha256, ...body } = event;
    same(sha256, expected, "event binding drift"); same(sha256, digest(body), "event seal drift");
    same(event.index, i, "event order drift"); same(event.previousSha256, previousSha256, "event predecessor drift");
    if (event.elapsedMs < elapsed) throw new Error("event clock regression");
    elapsed = event.elapsedMs; previousSha256 = event.sha256; return event;
  });
  const chunks = events.filter(e => e.kind === "raw-output").map(e => (e.data as { chunk: string }).chunk);
  same(terminal.rawResponseSha256, chunks.length ? sha(chunks.join("")) : null, "raw partial output drift");
  return freeze({ terminal, events });
}
