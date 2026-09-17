import { randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { canonicalJson } from "./experiment.js";
import { digest, exact, freeze, hash, integer, same, sha } from "./prediction-contract.js";
import { ACCEPTED_CANARY_CONTRACT, dispatcherSource } from "./private-stream-dispatcher-contract-v1.js";
import type { CleanupObservation, DispatcherRuntime, SessionObservation } from "./private-stream-dispatcher-v1.js";
import { PRIVATE_STREAM_CANARY_IMAGE, PRIVATE_STREAM_CANARY_POLICY } from "./private-stream-canary-contract.js";
import { reduceSafeCanaryStream } from "./prediction-safe-canary-stream.js";

export const PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2 = freeze({
  kind: "private-stream-observable-canary-contract-v2",
  purpose: "infrastructure-canary-only-no-bug-finding-or-cost-claim",
  requestedRoute: { model: "gpt-5.6-sol", effort: "low", providerAccess: "cli-session" },
  pinned: { cliVersion: "0.152.0", image: PRIVATE_STREAM_CANARY_IMAGE.image,
    imageSourceCommit: PRIVATE_STREAM_CANARY_IMAGE.sourceCommit, runtimeContractSha256: ACCEPTED_CANARY_CONTRACT.sha256 },
  limits: { attempts: 1, retries: 0, wallMs: 1_200_000, streamBytes: PRIVATE_STREAM_CANARY_POLICY.streamBytes,
    readCalls: 100, readBytes: 2_000_000, reviewAttempts: 0 },
  observable: ["requested-model-and-effort", "pinned-cli-image-and-source", "cli-terminal-input-and-output-usage",
    "optional-cli-token-counters", "wall-time-and-deadline", "event-lifecycle", "registered-read-tool-evidence",
    "durable-one-use-state", "cleanup"],
  unavailable: { providerServedIdentity: null, providerRequestCount: null, dollarCost: null, completeClientCatalog: null },
  retryAuthorized: false, batchAuthorized: false, productionAuthorized: false,
});
export const PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2_SHA256 = digest(PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2);
export const PRIVATE_STREAM_DISPATCHER_V2_FILES = ["eval/private-stream-dispatcher-v2.ts", "scripts/evidence/private-stream-dispatcher-v2.ts",
  "tests/eval-private-stream-dispatcher-v2.test.ts", "docs/validation/2026-09-16-private-stream-dispatcher-v2.md"] as const;

export function privateStreamDispatcherV2Source(root: string) {
  const paths = [...new Set([...dispatcherSource(root).files.map(file => file.path), ...PRIVATE_STREAM_DISPATCHER_V2_FILES])].sort();
  const files = paths.map(path => { const bytes = readFileSync(join(root, path)); return { path, bytes: bytes.length, sha256: sha(bytes) }; });
  return freeze({ files, sha256: digest(files) });
}

export interface DispatcherBindingV2 {
  publicCommit: string; privateCommit: string; sourceSha256: string; privateFreezeSha256: string;
  runtimeContractSha256: string; evidenceContractSha256: string; image: string;
  stateDirectorySha256: string; runtimeInputsSha256: string;
}
const bindingKeys = ["publicCommit", "privateCommit", "sourceSha256", "privateFreezeSha256", "runtimeContractSha256",
  "evidenceContractSha256", "image", "stateDirectorySha256", "runtimeInputsSha256"];
function verifyBinding(binding: DispatcherBindingV2) {
  exact(binding, bindingKeys, "V2 binding");
  for (const key of ["publicCommit", "privateCommit"] as const) if (!/^[a-f0-9]{40}$/.test(binding[key])) throw new Error("exact commit required");
  for (const key of ["sourceSha256", "privateFreezeSha256", "runtimeContractSha256", "evidenceContractSha256", "stateDirectorySha256", "runtimeInputsSha256"] as const) hash(binding[key]);
  same([binding.runtimeContractSha256, binding.evidenceContractSha256, binding.image],
    [ACCEPTED_CANARY_CONTRACT.sha256, PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2_SHA256, PRIVATE_STREAM_CANARY_IMAGE.image], "wrong runtime/evidence contract or image");
}
export function verifyDispatcherGateV2(bytes: Buffer, expectedSha256: string | null, binding: DispatcherBindingV2) {
  if (!expectedSha256) throw new Error("fresh independent V2 gate unavailable");
  same(sha(bytes), hash(expectedSha256), "V2 gate bytes mismatch"); verifyBinding(binding);
  const gate = exact(JSON.parse(bytes.toString()), ["kind", "binding", "verdict", "reviewer", "blockingFindings", "scope"], "V2 gate");
  const reviewer = exact(gate.reviewer, ["model", "effort", "independent", "identifier"], "V2 reviewer");
  if (typeof reviewer.identifier !== "string" || !/^\/root\/[a-z0-9_]+$/.test(reviewer.identifier)) throw new Error("independent reviewer required");
  same([gate.kind, gate.binding, gate.verdict, reviewer.model, reviewer.effort, reviewer.independent, gate.blockingFindings, gate.scope],
    ["private-stream-dispatcher-gate-v2", binding, "PASS", "gpt-6-astra", "medium", true, [], "one-observable-infrastructure-canary-only"], "V2 gate mismatch");
}

/** Accept the source-reviewed 0.152.0 cache-write counter without changing the
 * V1 reducer. The normalized stream still passes the complete V1 lifecycle,
 * schema, tool and enum-only checks. */
export function reduceObservableCanaryStreamV2(stdout: string) {
  if (typeof stdout !== "string" || Buffer.byteLength(stdout) > PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2.limits.streamBytes || !stdout.endsWith("\n")) throw new Error("bounded complete CLI JSONL required");
  const lines = stdout.trimEnd().split("\n");
  const terminal = exact(JSON.parse(lines.at(-1)!), ["type", "usage"], "CLI terminal");
  same(terminal.type, "turn.completed", "complete CLI terminal required");
  const raw = terminal.usage as Record<string, unknown>;
  const optional = ["cached_input_tokens", "cache_write_input_tokens", "reasoning_output_tokens"].filter(key => Object.hasOwn(raw, key));
  const usage = exact(raw, ["input_tokens", "output_tokens", ...optional], "CLI usage");
  const inputTokens = integer(usage.input_tokens), outputTokens = integer(usage.output_tokens);
  const cachedInputTokens = Object.hasOwn(usage, "cached_input_tokens") ? integer(usage.cached_input_tokens) : null;
  const cacheWriteInputTokens = Object.hasOwn(usage, "cache_write_input_tokens") ? integer(usage.cache_write_input_tokens) : null;
  const reasoningOutputTokens = Object.hasOwn(usage, "reasoning_output_tokens") ? integer(usage.reasoning_output_tokens) : null;
  if ((cachedInputTokens ?? 0) > inputTokens || (cacheWriteInputTokens ?? 0) > inputTokens || (reasoningOutputTokens ?? 0) > outputTokens) throw new Error("inconsistent CLI token counters");
  const normalized = { ...usage }; delete normalized.cache_write_input_tokens;
  lines[lines.length - 1] = JSON.stringify({ type: "turn.completed", usage: normalized });
  const reduced = reduceSafeCanaryStream(lines.join("\n") + "\n");
  const completedReads = reduced.projection.filter(event => event.type === "item.completed" && "itemType" in event && event.itemType === "mcp_tool_call");
  return freeze({ ...reduced, observedUsage: { inputTokens, outputTokens, cachedInputTokens, cacheWriteInputTokens, reasoningOutputTokens,
    aggregateTokens: inputTokens + outputTokens }, registeredReadEvidence: { completedCalls: completedReads.length,
    tools: completedReads.map(event => "tool" in event ? event.tool : null), sha256: digest(completedReads) } });
}

const permissions = new WeakMap<object, { runId: string; binding: DispatcherBindingV2; executionClass: "real" | "synthetic" }>();
export function consumeDispatcherLaunchPermissionV2(permission: object, runId: string, binding: DispatcherBindingV2, executionClass: "real" | "synthetic") {
  const scope = permissions.get(permission); if (!scope) throw new Error("V2 dispatcher launch permission required");
  permissions.delete(permission); same(scope, { runId, binding, executionClass }, "V2 launch permission mismatch");
}
const nativeClock = { now: () => performance.now(), arm(callback: () => void, ms: number) { const timer = setTimeout(callback, ms); return () => clearTimeout(timer); } };
function syncDirectory(path: string) { const fd = openSync(path, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } }
function writeExclusive(directory: string, name: string, value: unknown) {
  const bytes = canonicalJson(value) + "\n";
  if (Buffer.byteLength(bytes) > 65_536) throw new Error("bounded typed V2 evidence required");
  const fd = openSync(join(directory, name), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); } syncDirectory(directory);
}
function privateParent(path: string) {
  const parent = dirname(resolve(path)), st = lstatSync(parent);
  if (realpathSync(parent) !== parent || !st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid?.() || st.mode & 0o077) throw new Error("private owned canonical parent required");
}
export interface DispatcherOptionsV2 {
  binding: DispatcherBindingV2; stateDirectory: string; evidenceDirectory: string; gate: Buffer; gateSha256: string | null;
  observeBinding(): void; runtime(runId: string, remainingMs: () => number): DispatcherRuntime; executionClass: "real" | "synthetic";
  startedAt?: number; clock?: typeof nativeClock;
}
export function createPrivateStreamDispatcherV2(options: DispatcherOptionsV2) {
  if (options.executionClass === "real" && options.clock) throw new Error("real V2 dispatcher cannot inject a clock");
  const binding = freeze(options.binding), gate = Buffer.from(options.gate), state = resolve(options.stateDirectory), evidence = resolve(options.evidenceDirectory);
  const clock = options.clock ?? nativeClock, runId = randomUUID(); let began: number | undefined, runtime: DispatcherRuntime | undefined;
  let controller: AbortController | undefined, cancel: (() => void) | undefined, prepared = false, issued = false, consumed = false, sealed = false;
  let active: Promise<unknown> | undefined, cleanupPromise: Promise<CleanupObservation> | undefined, session: SessionObservation | null = null;
  let deadlineExceeded = false, ordinal = 0;
  const record = (event: string, body: unknown) => writeExclusive(evidence, `${String(++ordinal).padStart(4, "0")}-${event}.json`,
    { kind: "private-stream-dispatcher-evidence-v2", binding, runId, event, elapsedMs: began === undefined ? null : clock.now() - began, body });
  const cleanup = () => cleanupPromise ??= Promise.resolve().then(async () => {
    let failed = false; try { runtime?.closeReads(); } catch { failed = true; }
    try { await runtime?.kill(); } catch { failed = true; }
    await active?.catch(() => undefined);
    let result: CleanupObservation | undefined; try { result = await runtime?.cleanup(); } catch { failed = true; }
    if (!result) failed = true;
    else {
      exact(result, ["readsClosed", "clientAbsent", "sidecarsAbsent", "networkAbsent", "sessionRemoved", "independentlyObserved"], "cleanup proof");
      if (!Object.values(result).every(value => value === true)) failed = true;
    }
    if (failed) throw new Error("cleanup unproven"); return result!;
  });
  const expire = () => { if (sealed || deadlineExceeded) return; deadlineExceeded = true; controller?.abort(); void cleanup().catch(() => undefined); };
  const check = () => {
    const now = clock.now(); if (began === undefined || !Number.isFinite(began) || began < 0 || !Number.isFinite(now) || now < began || now - began >= PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2.limits.wallMs) expire();
    if (sealed || controller?.signal.aborted) throw new Error("V2 dispatcher closed or deadline expired"); options.observeBinding(); verifyDispatcherGateV2(gate, options.gateSha256, binding);
    if (!consumed && existsSync(state)) throw new Error("V2 canary permanently consumed; retry forbidden");
  };
  async function preflight() {
    if (began !== undefined) throw new Error("V2 preflight cannot retry"); began = options.startedAt ?? clock.now(); controller = new AbortController();
    cancel = clock.arm(expire, Math.max(0, PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2.limits.wallMs - (clock.now() - began)));
    try {
      check(); privateParent(state); privateParent(evidence);
      if (state === evidence || state.startsWith(evidence + "/") || evidence.startsWith(state + "/")) throw new Error("state/evidence overlap");
      mkdirSync(evidence, { mode: 0o700 }); syncDirectory(dirname(evidence));
      record("start", { contract: PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2, capabilityIssued: false, clientLaunchInvoked: false });
      runtime = options.runtime(runId, () => { check(); return Math.max(1, Math.floor(PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2.limits.wallMs - (clock.now() - began!))); });
      active = runtime.session(controller.signal); session = await active as SessionObservation; check();
      exact(session, ["sessionIdentitySha256", "cliVersion", "authenticated"], "session"); hash(session.sessionIdentitySha256);
      same([session.cliVersion, session.authenticated], ["0.152.0", true], "pinned authenticated CLI session required");
      active = runtime.prepare(controller.signal, operation => { check(); const result = operation(); check(); return result; }); await active; check();
      prepared = true; const result = freeze({ preflightPassed: true, requestedRoute: PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2.requestedRoute,
        pinned: PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2.pinned, providerCalls: null, executionReady: false, capabilityIssued: false });
      record("preflight", result); return result;
    } catch {
      let cleanupProven = false; try { await cleanup(); cleanupProven = true; } catch { /* retained below */ }
      if (existsSync(evidence)) try { record("preflight-failed", { cleanupProven, deadlineExceeded, capabilityIssued: false }); } catch { /* immutable prior records remain */ }
      cancel?.(); sealed = true; throw new Error("V2 preflight failed; no capability issued");
    }
  }
  async function closePreflight() {
    if (!prepared || consumed || issued) throw new Error("unused successful V2 preflight required");
    try { const proof = await cleanup(); record("preflight-closed", { cleanup: proof, providerCalls: null, capabilityIssued: false }); }
    finally { sealed = true; cancel?.(); }
    if (deadlineExceeded) throw new Error("V2 preflight deadline expired");
  }
  function issueCapability() {
    check(); if (!prepared || issued || consumed) throw new Error("fresh V2 preflight required"); issued = true;
    const token = Object.freeze({ kind: "private-stream-dispatcher-capability-v2", toJSON(): never { throw new Error("capability cannot be serialized"); } });
    permissions.set(token, { runId, binding, executionClass: options.executionClass }); return token;
  }
  async function run(token: object) {
    try {
      check(); const scope = permissions.get(token); if (!scope || consumed) throw new Error("exact unconsumed V2 capability required");
      same(scope, { runId, binding, executionClass: options.executionClass }, "V2 capability mismatch");
      mkdirSync(state, { mode: 0o700 }); syncDirectory(dirname(state)); consumed = true;
      writeExclusive(state, "start.json", { kind: "private-stream-canary-start-v2", binding, runId, consumed: true, retryAuthorized: false,
        requestedRoute: PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2.requestedRoute, providerCalls: null });
    } catch {
      permissions.delete(token); try { await cleanup(); } catch { /* source remains denied */ }
      sealed = true; cancel?.(); throw new Error("V2 durable reservation failed; no launch occurred");
    }
    let stream: ReturnType<typeof reduceObservableCanaryStreamV2> | null = null, launched = false, cleanupProof: CleanupObservation | null = null;
    let failure: "invalid-or-incomplete-cli-evidence" | "cli-reported-unable-to-complete" | "deadline" | "cleanup-unproven" | null = null;
    try {
      check(); launched = true; active = runtime!.launch(controller!.signal, token); const stdout = await active as string;
      stream = reduceObservableCanaryStreamV2(stdout); check();
      record("stream", { stream: stream.stream, output: stream.output, observedUsage: stream.observedUsage,
        cliThreadSha256: stream.modelSessionSha256, registeredReadEvidence: stream.registeredReadEvidence });
    } catch { failure = deadlineExceeded ? "deadline" : "invalid-or-incomplete-cli-evidence"; }
    finally {
      try { cleanupProof = await cleanup(); } catch { failure = "cleanup-unproven"; }
      if (clock.now() - began! >= PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2.limits.wallMs) { deadlineExceeded = true; failure = failure ?? "deadline"; }
      sealed = true; cancel?.();
    }
    if (stream && stream.output.status !== "completed" && failure === null) failure = "cli-reported-unable-to-complete";
    const completed = stream?.output.status === "completed" && failure === null && !deadlineExceeded && cleanupProof !== null;
    const result = freeze({ kind: "private-stream-canary-terminal-v2", binding, runId, status: completed ? "infrastructure-canary-complete" : "failed",
      failure, executionClass: options.executionClass, requestedRoute: PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2.requestedRoute,
      pinned: PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2.pinned, clientLaunchInvoked: launched, cliLifecycleComplete: stream !== null,
      cliOutcome: stream?.output ?? null, cliUsage: stream?.observedUsage ?? null, registeredReadEvidence: stream?.registeredReadEvidence ?? null,
      cliThreadSha256: stream?.modelSessionSha256 ?? null, sessionIdentitySha256: session?.sessionIdentitySha256 ?? null,
      providerServedIdentity: null, providerRequestCount: null, dollarCost: null, completeClientCatalog: null,
      cleanup: cleanupProof, cleanupProven: cleanupProof !== null, deadlineExceeded,
      deadline: { wallMs: PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2.limits.wallMs, elapsedMs: Math.max(0, clock.now() - began!), teardownUncancelled: true },
      consumed: true, retryAuthorized: false, batchAuthorized: false, productionAuthorized: false,
      reviewAttemptsStarted: 0, unstartedReviewAttempts: 64, scientificEligibility: "infrastructure-only" });
    writeExclusive(state, "terminal.json", result); record("terminal", result); return result;
  }
  return { preflight, closePreflight, issueCapability, run };
}
