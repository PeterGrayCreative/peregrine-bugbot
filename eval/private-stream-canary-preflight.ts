import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { digest, exact, freeze, hash, integer, same, sha, text } from "./prediction-contract.js";
import { PRIVATE_STREAM_CANARY_AUTHORIZATION, PRIVATE_STREAM_CANARY_BASES, PRIVATE_STREAM_CANARY_HISTORY,
  PRIVATE_STREAM_CANARY_IMAGE, PRIVATE_STREAM_CANARY_POLICY, type PrivateStreamCanaryContract } from "./private-stream-canary-contract.js";

export interface CanaryBinding {
  publicCommit: string; sourceSha256: string; privateCommit: string; privateFreezeSha256: string;
  contractSha256: string; image: string; stateDirectorySha256: string;
}
export interface CanaryPreflightTrust {
  binding: CanaryBinding;
  /** Set only from the fresh independent review, never from the supplied receipt. */
  gateSha256: string | null; sessionSha256: string | null;
}
export interface CanaryRequest {
  canaryId: string; model: string; effort: string; image: string; wallMs: number;
  attempts: number; retry: boolean; reviewBatch: boolean; production: boolean;
}
export function privateStreamCanaryRequest(contract: PrivateStreamCanaryContract): CanaryRequest {
  return { canaryId: PRIVATE_STREAM_CANARY_POLICY.canaryId, model: "gpt-5.6-sol", effort: "low", image: contract.image.image,
    wallMs: 1_200_000, attempts: 1, retry: false, reviewBatch: false, production: false };
}
function boundJson(bytes: Buffer | null, expected: string | null, label: string) {
  if (!bytes || !expected) throw new Error(`${label} unavailable; default deny`);
  same(sha(bytes), hash(expected), `${label} bytes mismatch`); return JSON.parse(bytes.toString());
}

/** Hashes authenticate independently pinned bytes, not the truth of an observer or a signature.
 * No provider launcher consumes the preparation capability in this version. */
export function createPrivateStreamCanaryPreflight(options: {
  contract: PrivateStreamCanaryContract; trust: CanaryPreflightTrust; stateDirectory: string;
  observeBinding: () => CanaryBinding; monotonicNow: () => number;
}) {
  const contract = freeze(options.contract), trust = freeze(options.trust), stateDirectory = resolve(options.stateDirectory);
  const { sha256, ...body } = contract;
  same(digest(body), hash(sha256), "contract seal mismatch");
  same([contract.kind, contract.bases, contract.image, contract.history],
    ["private-stream-canary-execution-contract-v1", PRIVATE_STREAM_CANARY_BASES, PRIVATE_STREAM_CANARY_IMAGE, PRIVATE_STREAM_CANARY_HISTORY], "contract historical image/source binding mismatch");
  same([contract.authorization.text, contract.authorization.sha256, contract.authorization.earlierAuthorizationConsumed,
    contract.authorization.broaderProviderExperimentsAuthorized],
    [PRIVATE_STREAM_CANARY_AUTHORIZATION, sha(PRIVATE_STREAM_CANARY_AUTHORIZATION), true, false], "contract authorization scope mismatch");
  same(contract.policy, PRIVATE_STREAM_CANARY_POLICY, "contract policy mismatch");
  same(contract.source.sha256, digest(contract.source.files), "source manifest seal mismatch");
  same([trust.binding.contractSha256, trust.binding.sourceSha256, trust.binding.image, trust.binding.stateDirectorySha256],
    [contract.sha256, contract.source.sha256, contract.image.image, sha(stateDirectory)], "contract/source/image/state binding mismatch");
  for (const key of ["publicCommit", "privateCommit"] as const) {
    if (!/^[a-f0-9]{40}$/.test(trust.binding[key])) throw new Error("exact public/private commits required");
  }
  hash(trust.binding.privateFreezeSha256);
  let issued = false, consumed = false, finished = false, consumedStartMs: number | null = null;
  const tokens = new WeakMap<object, { sessionSha256: string; runId: string; startMs: number }>();
  const recheck = () => same(options.observeBinding(), trust.binding, "stale source/private freeze/image/state binding");
  function check(gateBytes: Buffer | null, sessionBytes: Buffer | null, request: CanaryRequest) {
    recheck(); same(request, privateStreamCanaryRequest(contract), "only exact single Sol-low canary; retry/batch/production denied");
    const gate = boundJson(gateBytes, trust.gateSha256, "independent execution gate");
    exact(gate, ["kind", "verdict", "binding", "reviewer", "blockingFindings", "scope"], "execution gate");
    const reviewer = exact(gate.reviewer, ["model", "effort", "independent", "identifier"], "independent reviewer");
    if (!/^\/root\/[a-z0-9_]+$/.test(text(reviewer.identifier))) throw new Error("independent reviewer identity required");
    same([gate.kind, gate.verdict, gate.binding, [reviewer.model, reviewer.effort, reviewer.independent], gate.blockingFindings, gate.scope],
      ["private-stream-canary-execution-gate-v1", "PASS", trust.binding,
        ["gpt-6-astra", "medium", true], [], "one-canary-contract-only"], "execution gate scope mismatch");
    const session = boundJson(sessionBytes, trust.sessionSha256, "authenticated session preflight");
    exact(session, ["kind", "binding", "gateSha256", "runId", "sessionIdentitySha256", "session", "catalog", "containment", "route", "deadline", "servedIdentityCapture", "cleanupProofRequired"], "session preflight");
    hash(session.sessionIdentitySha256);
    same([session.kind, session.binding, session.gateSha256, session.session, session.catalog, session.containment, session.route,
      session.servedIdentityCapture, session.cleanupProofRequired],
      ["private-stream-canary-session-preflight-v1", trust.binding, trust.gateSha256, contract.policy.session,
        contract.policy.catalog, contract.policy.containment, { model: "gpt-5.6-sol", effort: "low", access: "cli-session" },
        contract.policy.servedIdentityCapture, ["reads-closed", "client-absent", "sidecars-absent", "network-absent", "isolated-session-removed"]], "session/catalog/containment/route mismatch");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(session.runId)) throw new Error("bounded run identity required");
    const deadline = exact(session.deadline, ["startMs", "wallMs", "startsBeforePreparation", "abortReadsAndExec", "cleanupUncancelled"], "deadline");
    same([deadline.wallMs, deadline.startsBeforePreparation, deadline.abortReadsAndExec, deadline.cleanupUncancelled],
      [1_200_000, true, true, true], "hard deadline policy mismatch");
    const startMs = deadline.startMs;
    if (typeof startMs !== "number" || !Number.isFinite(startMs) || startMs < 0) throw new Error("invalid monotonic start");
    checkTime(startMs);
    return { sessionSha256: trust.sessionSha256!, runId: session.runId as string, startMs };
  }
  function checkTime(startMs: number) {
    const now = options.monotonicNow();
    if (!Number.isFinite(now) || now < startMs || now - startMs >= 1_200_000) throw new Error("hard whole-attempt deadline expired or clock invalid");
  }
  const write = (name: string, value: unknown) => writeFileSync(join(stateDirectory, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return {
    inspect(gate: Buffer | null, session: Buffer | null, request: CanaryRequest) {
      check(gate, session, request);
      return freeze({ requirementsMatch: true, executionReady: false, providerAuthorized: false, dispatcherAvailable: false });
    },
    prepareCapability(gate: Buffer | null, session: Buffer | null, request: CanaryRequest) {
      if (issued || consumed) throw new Error("single-use capability already issued or consumed");
      const scope = check(gate, session, request);
      const token = Object.freeze({ kind: "private-stream-canary-preparation-capability-v1",
        toJSON(): never { throw new Error("capability cannot be serialized"); } });
      tokens.set(token, scope); issued = true; return token;
    },
    consumeForPreparation(token: object) {
      const scope = tokens.get(token);
      if (!scope || consumed) throw new Error("exact unused single-use capability required");
      recheck(); checkTime(scope.startMs);
      // Exclusive directory creation is the durable no-retry tombstone, including
      // a process crash or failed start write. An existing directory always denies.
      mkdirSync(stateDirectory, { mode: 0o700 }); consumed = true; consumedStartMs = scope.startMs; tokens.delete(token);
      const start = freeze({ kind: "private-stream-canary-preparation-start-v1", binding: trust.binding,
        sessionSha256: scope.sessionSha256, runId: scope.runId, consumed: true, retryAuthorized: false,
        dispatcherAvailable: false, providerAuthorized: false, providerCalls: 0 });
      write("start.json", start); return start;
    },
    retainOutcome(input: unknown) {
      if (!consumed || finished) throw new Error("one consumed attempt and one immutable terminal required");
      // Even malformed external output gets an immutable failed terminal. Never
      // persist free-text exceptions, raw provider streams or credential bytes.
      let outcome;
      try {
        const value = input as Record<string, unknown>;
        let expired = false;
        try { checkTime(consumedStartMs!); } catch { expired = true; }
        outcome = reducePrivateStreamCanaryOutcome(expired && value && typeof value === "object" ? { ...value, deadlineExceeded: true } : value);
      }
      catch { outcome = reducePrivateStreamCanaryOutcome(unknownFailureOutcome()); }
      write("terminal.json", { kind: "private-stream-canary-preparation-terminal-v1", binding: trust.binding, ...outcome });
      finished = true; return outcome;
    },
  };
}

function unknownFailureOutcome() {
  return { clientLaunches: null, providerCalls: null, providerCountAuthenticated: false, completed: false,
    failure: "invalid-evidence", deadlineExceeded: false, cleanup: null, usage: null, servedIdentity: null };
}
export function reducePrivateStreamCanaryOutcome(input: unknown) {
  const value = exact(input, ["clientLaunches", "providerCalls", "providerCountAuthenticated", "completed", "failure", "deadlineExceeded", "cleanup", "usage", "servedIdentity"], "canary outcome");
  for (const key of ["providerCountAuthenticated", "completed", "deadlineExceeded"]) if (typeof value[key] !== "boolean") throw new Error("invalid outcome boolean");
  if (value.clientLaunches !== null && integer(value.clientLaunches) > 1) throw new Error("multiple launches forbidden");
  if (value.providerCalls !== null) integer(value.providerCalls);
  if (value.clientLaunches === 0 && value.providerCalls !== 0) throw new Error("no launch requires explicit zero provider calls");
  if (value.providerCalls !== null && value.providerCalls !== 0 && !value.providerCountAuthenticated) throw new Error("unauthenticated provider count");
  if (value.clientLaunches !== 0 && !value.providerCountAuthenticated && value.providerCalls !== null) throw new Error("unknown provider count must remain null");
  if (![null, "preflight-failed", "provider-failed", "deadline", "cleanup-unproven", "invalid-evidence"].includes(value.failure as null | string)) throw new Error("unbounded failure category");
  let cleanupProven = false;
  if (value.cleanup !== null) {
    const cleanup = exact(value.cleanup, ["readsClosed", "clientAbsent", "sidecarsAbsent", "networkAbsent", "sessionRemoved", "independentlyObserved"], "cleanup proof");
    for (const v of Object.values(cleanup)) if (typeof v !== "boolean") throw new Error("invalid cleanup boolean");
    cleanupProven = Object.values(cleanup).every(v => v === true);
  }
  let usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number | null; reasoningOutputTokens: number | null; reportedAggregateTokens: number } | null = null;
  if (value.usage !== null) {
    const u = exact(value.usage, ["inputTokens", "outputTokens", "cachedInputTokens", "reasoningOutputTokens", "complete"], "terminal usage");
    same(u.complete, true, "incomplete counters must remain unknown");
    const inputTokens = integer(u.inputTokens), outputTokens = integer(u.outputTokens);
    const cachedInputTokens = u.cachedInputTokens === null ? null : integer(u.cachedInputTokens);
    const reasoningOutputTokens = u.reasoningOutputTokens === null ? null : integer(u.reasoningOutputTokens);
    if ((cachedInputTokens ?? 0) > inputTokens || (reasoningOutputTokens ?? 0) > outputTokens) throw new Error("inconsistent token subsets");
    usage = { inputTokens, outputTokens, cachedInputTokens, reasoningOutputTokens, reportedAggregateTokens: integer(inputTokens + outputTokens) };
  }
  let servedIdentityKnown = false, servedIdentitySha256: string | null = null;
  if (value.servedIdentity !== null) {
    const identity = exact(value.servedIdentity, ["model", "effort", "version", "provenance", "evidenceSha256"], "served identity");
    same([identity.model, identity.effort, identity.provenance], ["gpt-5.6-sol", "low", "independently-authenticated-provider-metadata"], "served model/effort or provenance mismatch");
    text(identity.version); hash(identity.evidenceSha256); servedIdentityKnown = true; servedIdentitySha256 = digest(identity);
  }
  const passed = value.completed === true && value.failure === null && value.deadlineExceeded === false &&
    value.clientLaunches === 1 && value.providerCountAuthenticated === true && value.providerCalls !== null &&
    cleanupProven && usage !== null && servedIdentityKnown;
  return freeze({ status: passed ? "infrastructure-evidence-complete" : "failed", failure: value.failure,
    clientLaunches: value.clientLaunches, providerCalls: value.providerCalls, usage,
    deadlineExceeded: value.deadlineExceeded, cleanupProven, servedIdentityKnown, servedIdentitySha256,
    consumed: true, retryAuthorized: false, batchAuthorized: false, productionAuthorized: false,
    providerAuthorized: false, executionReady: false, eligibility: "not-eligible", unstartedReviewAttempts: 64, reviewAttemptsStarted: 0 });
}
