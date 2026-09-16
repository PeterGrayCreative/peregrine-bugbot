import { randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { digest, exact, freeze, hash, same, sha } from "./prediction-contract.js";
import { PRIVATE_STREAM_CANARY_POLICY } from "./private-stream-canary-contract.js";
import { reducePrivateStreamCanaryOutcome } from "./private-stream-canary-preflight.js";
import { reduceSafeCanaryStream } from "./prediction-safe-canary-stream.js";
import { verifyDispatcherGate, type DispatcherBinding } from "./private-stream-dispatcher-contract-v1.js";
import type { Observer, ObserverContext } from "./private-stream-dispatcher-observer-v1.js";

export interface SessionObservation { sessionIdentitySha256: string; cliVersion: string; authenticated: boolean; }
export interface CleanupObservation {
  readsClosed: boolean; clientAbsent: boolean; sidecarsAbsent: boolean; networkAbsent: boolean; sessionRemoved: boolean; independentlyObserved: boolean;
}
export interface DispatcherRuntime {
  session(signal: AbortSignal): Promise<SessionObservation>;
  prepare(signal: AbortSignal, read: <T>(operation: () => T) => T): Promise<void>;
  launch(signal: AbortSignal, permission: object): Promise<string>;
  closeReads(): void;
  kill(): Promise<void>;
  cleanup(): Promise<CleanupObservation>;
}
const launchPermissions = new WeakMap<object, { runId: string; binding: DispatcherBinding; executionClass: "real" | "synthetic" }>();
/** Runtime adapter check; no public minting API exists. Permission is issued
 * only after fresh preflight, exact gate and durable attempt consumption. */
export function consumeDispatcherLaunchPermission(permission: object, runId: string, binding: DispatcherBinding, executionClass: "real" | "synthetic") {
  const scope = launchPermissions.get(permission);
  if (!scope) throw new Error("dispatcher launch permission required");
  launchPermissions.delete(permission); same(scope, { runId, binding, executionClass }, "dispatcher launch permission mismatch");
}
export interface DispatcherOptions {
  binding: DispatcherBinding; stateDirectory: string; evidenceDirectory: string;
  gate: Buffer; gateSha256: string | null; observeBinding: () => void;
  runtime: (runId: string, remainingMs: () => number) => DispatcherRuntime; observer: Observer;
  executionClass: "real" | "synthetic";
  /** Entrypoint samples this before config/source/session preparation. */
  startedAt?: number;
  clock?: { now(): number; arm(callback: () => void, ms: number): () => void };
}
const nativeClock = { now: () => performance.now(), arm(callback: () => void, ms: number) {
  const timer = setTimeout(callback, ms); return () => clearTimeout(timer);
} };
function syncDirectory(directory: string) {
  const fd = openSync(directory, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); }
}
function writeExclusive(directory: string, name: string, value: unknown) {
  const fd = openSync(join(directory, name), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  syncDirectory(directory);
}
function privateParent(path: string) {
  const stat = lstatSync(dirname(path));
  if (realpathSync(dirname(path)) !== dirname(path) || !stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw new Error("private owned canonical parent required");
}
function readyObservation(value: unknown) {
  const ready = exact(value, ["catalog", "containment", "servedIdentityCapture", "providerAccounting", "session"], "observer readiness");
  same(ready, { catalog: PRIVATE_STREAM_CANARY_POLICY.catalog, containment: PRIVATE_STREAM_CANARY_POLICY.containment,
    servedIdentityCapture: true, providerAccounting: true, session: PRIVATE_STREAM_CANARY_POLICY.session }, "observer session/catalog/containment unavailable");
}

/** Constructing this object grants nothing. The timer begins on preflight entry,
 * before runtime preparation. A capability is process-local, nonserializable,
 * expires with that timer and is consumed durably before any launch. */
export function createPrivateStreamDispatcher(options: DispatcherOptions) {
  if (options.executionClass === "real" && options.clock) throw new Error("real dispatcher cannot inject a clock");
  const binding = freeze(options.binding), gate = Buffer.from(options.gate), clock = options.clock ?? nativeClock;
  const state = resolve(options.stateDirectory), evidence = resolve(options.evidenceDirectory);
  const runId = randomUUID();
  let runtime: DispatcherRuntime | undefined, began: number | undefined, controller: AbortController | undefined;
  let cancelTimer: (() => void) | undefined, prepared = false, issued = false, consumed = false, sealed = false;
  let token: object | undefined, session: SessionObservation | undefined, cleanupPromise: Promise<CleanupObservation> | undefined;
  let active: Promise<unknown> | undefined, deadlineExceeded = false, persistenceFailed = false, ordinal = 0;
  const record = (event: string, body: unknown) => {
    writeExclusive(evidence, `${String(++ordinal).padStart(4, "0")}-${event}.json`, { kind: "private-stream-dispatcher-evidence-v1", binding, runId, event,
      elapsedMs: began === undefined ? null : clock.now() - began, body });
  };
  const check = () => {
    const now = clock.now();
    if (began === undefined || !Number.isFinite(began) || began < 0 || !Number.isFinite(now) || now < began || now - began >= PRIVATE_STREAM_CANARY_POLICY.wallMs) expire();
    if (sealed || controller?.signal.aborted || persistenceFailed) throw new Error("dispatcher closed or deadline expired");
  };
  const cleanup = () => cleanupPromise ??= Promise.resolve().then(async () => {
    // Kill first: waiting for an active launch before stopping its container
    // would deadlock a hung provider. Cleanup never receives the aborted signal.
    let killFailed = false;
    try { runtime?.closeReads(); } catch { killFailed = true; }
    try { await runtime?.kill(); } catch { killFailed = true; }
    await active?.catch(() => undefined);
    const result = await runtime?.cleanup();
    if (!result || killFailed) throw new Error("cleanup unproven");
    exact(result, ["readsClosed", "clientAbsent", "sidecarsAbsent", "networkAbsent", "sessionRemoved", "independentlyObserved"], "cleanup");
    if (!Object.values(result).every(value => value === true)) throw new Error("cleanup unproven");
    return result;
  });
  function expire() {
    if (sealed || deadlineExceeded) return;
    deadlineExceeded = true; controller?.abort();
    try { runtime?.closeReads(); } catch { persistenceFailed = true; }
    void cleanup().then(proof => {
      if (existsSync(evidence)) record("deadline-cleanup", { cleanup: proof, deadlineExceeded: true });
    }, () => {
      if (existsSync(evidence)) record("deadline-cleanup-failed", { cleanupProven: false, deadlineExceeded: true });
    }).catch(() => { persistenceFailed = true; });
  }
  function recheck() {
    options.observeBinding(); verifyDispatcherGate(gate, options.gateSha256, binding);
    same(sha(state), binding.stateDirectorySha256, "state location mismatch");
    if (existsSync(state)) throw new Error("canary permanently consumed; restart/retry forbidden");
  }
  const context = (): ObserverContext => ({ binding, runId, sessionIdentitySha256: session!.sessionIdentitySha256 });
  async function preflight() {
    if (began !== undefined) throw new Error("preflight cannot retry");
    began = options.startedAt ?? clock.now(); controller = new AbortController();
    cancelTimer = clock.arm(expire, Math.max(0, PRIVATE_STREAM_CANARY_POLICY.wallMs - (clock.now() - began)));
    try {
      check();
      recheck(); privateParent(state); privateParent(evidence);
      if (state === evidence || evidence.startsWith(state + "/") || state.startsWith(evidence + "/")) throw new Error("execution and preflight evidence directories must be separate");
      mkdirSync(evidence, { mode: 0o700 }); syncDirectory(dirname(evidence));
      record("start", { executionClass: options.executionClass, startMs: began, deadlineMs: PRIVATE_STREAM_CANARY_POLICY.wallMs, providerCalls: 0, executionReady: false });
      runtime = options.runtime(runId, () => { check(); return Math.max(1, Math.floor(PRIVATE_STREAM_CANARY_POLICY.wallMs - (clock.now() - began!))); }); check();
      active = runtime.session(controller.signal); session = await active as SessionObservation; check();
      exact(session, ["sessionIdentitySha256", "cliVersion", "authenticated"], "session"); hash(session.sessionIdentitySha256);
      same([session.cliVersion, session.authenticated], ["0.152.0", true], "authenticated pinned session required");
      active = options.observer("ready", context(), controller.signal); readyObservation(await active); check();
      active = runtime.prepare(controller.signal, operation => { check(); const value = operation(); check(); return value; }); await active; check();
      recheck(); prepared = true;
      const result = freeze({ preflightPassed: true, executionReady: false, providerAuthorized: false, capabilityIssued: false,
        executionClass: options.executionClass, runId, sessionIdentitySha256: session.sessionIdentitySha256, providerCalls: 0 });
      record("preflight", result); return result;
    } catch {
      let cleaned = false; try { await cleanup(); cleaned = true; } catch { /* retained as unknown */ }
      if (existsSync(evidence)) { try { record("preflight-failed", { cleanupProven: cleaned, deadlineExceeded, providerCalls: 0, executionReady: false }); } catch { persistenceFailed = true; } }
      cancelTimer?.(); sealed = true;
      throw new Error("private-stream preflight failed; no capability issued");
    }
  }
  async function closePreflight() {
    if (!prepared || consumed) throw new Error("unused successful preflight required");
    token = undefined;
    try { const observed = await cleanup(); record("preflight-closed", { cleanup: observed, deadlineExceeded, providerCalls: 0, executionReady: false }); }
    finally { sealed = true; cancelTimer?.(); }
    if (deadlineExceeded) throw new Error("preflight deadline expired");
  }
  function issueCapability() {
    check(); recheck();
    if (!prepared || issued || consumed) throw new Error("one fresh successful preflight required");
    issued = true;
    token = Object.freeze({ kind: "private-stream-dispatcher-capability-v1", toJSON(): never { throw new Error("capability cannot be serialized"); } });
    return token;
  }
  async function run(capability: object) {
    check(); recheck();
    if (!token || token !== capability || consumed) throw new Error("exact unconsumed capability required");
    // mkdir+parent fsync precede all external launch work. Even a crash before
    // start.json leaves a permanent tombstone. Neither restart nor preflight
    // has an API for clearing it.
    mkdirSync(state, { mode: 0o700 }); consumed = true; token = undefined;
    let stream: ReturnType<typeof reduceSafeCanaryStream> | undefined, providerCalls: number | null = null, cachedInputTokens: number | null = null;
    let providerCountAuthenticated = false, servedIdentity: unknown = null, cleanupProof: CleanupObservation | null = null;
    let launched = false, failure: null | "provider-failed" | "deadline" | "cleanup-unproven" | "invalid-evidence" = null;
    try {
      syncDirectory(dirname(state));
      writeExclusive(state, "start.json", { kind: "private-stream-dispatcher-start-v1", binding, runId, consumed: true,
        retryAuthorized: false, executionClass: options.executionClass, providerCalls: null });
      check(); options.observeBinding();
      // A launch invocation is never a provider-call observation, including
      // child-start failures and truncated streams.
      const permission = Object.freeze({}); launchPermissions.set(permission, { runId, binding, executionClass: options.executionClass });
      launched = true; active = runtime!.launch(controller!.signal, permission);
      const stdout = await active as string;
      stream = reduceSafeCanaryStream(stdout); check();
      // The strict reducer already proves exactly one complete terminal usage
      // event and validates subset counters. Retain the optional cached subset.
      const terminal = JSON.parse(stdout.trim().split("\n").at(-1)!);
      cachedInputTokens = terminal.usage.cached_input_tokens ?? null;
      record("stream", stream);
      active = options.observer("complete", context(), controller!.signal);
      const observation = exact(await active, ["catalog", "providerCalls", "servedIdentity", "usage"], "provider observer"); check();
      same(observation.catalog, PRIVATE_STREAM_CANARY_POLICY.catalog, "actual complete client catalog mismatch");
      const usage = exact(observation.usage, ["inputTokens", "outputTokens", "reasoningOutputTokens"], "observer tokens");
      same(usage, { inputTokens: stream.tokens.inputTokens, outputTokens: stream.tokens.outputTokens,
        reasoningOutputTokens: stream.tokens.reasoningOutputTokens }, "independent token evidence mismatch");
      // Validate the entire bounded projection before persisting any observer
      // fields. Unknown counts/identity remain null and cannot pass.
      const validated = reducePrivateStreamCanaryOutcome({ clientLaunches: 1, providerCalls: observation.providerCalls,
        providerCountAuthenticated: observation.providerCalls !== null, completed: false, failure: null, deadlineExceeded: false,
        cleanup: null, usage: null, servedIdentity: observation.servedIdentity });
      providerCalls = validated.providerCalls as number | null; providerCountAuthenticated = providerCalls !== null;
      if (providerCalls === 0) throw new Error("completed fresh provider stream contradicts zero accounting");
      servedIdentity = observation.servedIdentity;
      record("provider-observation", { providerCalls, servedIdentitySha256: validated.servedIdentitySha256, usageSha256: digest(usage) });
    } catch { failure = deadlineExceeded ? "deadline" : "invalid-evidence"; }
    finally {
      try { cleanupProof = await cleanup(); } catch { failure = "cleanup-unproven"; }
      if (clock.now() - began! >= PRIVATE_STREAM_CANARY_POLICY.wallMs) deadlineExceeded = true;
      sealed = true; cancelTimer?.();
    }
    const outcome = reducePrivateStreamCanaryOutcome({ clientLaunches: launched && stream ? 1 : null, providerCalls, providerCountAuthenticated,
      completed: stream?.output.status === "completed", failure, deadlineExceeded, cleanup: cleanupProof,
      usage: stream ? { inputTokens: stream.tokens.inputTokens, outputTokens: stream.tokens.outputTokens,
        cachedInputTokens, reasoningOutputTokens: stream.tokens.reasoningOutputTokens, complete: true } : null, servedIdentity });
    const result = freeze({ kind: "private-stream-dispatcher-terminal-v1", binding, runId, executionClass: options.executionClass,
      ...outcome, deadline: { startMs: began, elapsedMs: clock.now() - began!, wallMs: PRIVATE_STREAM_CANARY_POLICY.wallMs, cleanupUncancelled: true },
      scientificEligibility: "not-eligible", sourceExecutionAuthorityRetained: false });
    writeExclusive(state, "terminal.json", result); record("terminal", result); return result;
  }
  return { preflight, closePreflight, issueCapability, run };
}
