import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { digest, sha } from "../eval/prediction-contract.js";
import { PRIVATE_STREAM_CANARY_AUTHORIZATION, PRIVATE_STREAM_CANARY_BASES, PRIVATE_STREAM_CANARY_HISTORY,
  PRIVATE_STREAM_CANARY_IMAGE, PRIVATE_STREAM_CANARY_POLICY, privateStreamCanarySource,
  preparePrivateStreamCanaryContract, requirePrivateStreamCanaryDispatch, type PrivateStreamCanaryContract } from "../eval/private-stream-canary-contract.js";
import { createPrivateStreamCanaryPreflight, privateStreamCanaryRequest, reducePrivateStreamCanaryOutcome,
  type CanaryBinding } from "../eval/private-stream-canary-preflight.js";

/** Deliberately synthetic. Actual acceptance bytes are exercised by private replay;
 * these receipts do not assert an independently reviewed gate or authenticated session. */
function fixture(t: { after: (fn: () => void) => void }) {
  const directory = mkdtempSync(join(tmpdir(), "private-canary-contract-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const body = { kind: "private-stream-canary-execution-contract-v1", policy: PRIVATE_STREAM_CANARY_POLICY,
    source: { files: [], sha256: digest([]) }, image: PRIVATE_STREAM_CANARY_IMAGE,
    bases: PRIVATE_STREAM_CANARY_BASES, history: PRIVATE_STREAM_CANARY_HISTORY,
    authorization: { text: PRIVATE_STREAM_CANARY_AUTHORIZATION, sha256: sha(PRIVATE_STREAM_CANARY_AUTHORIZATION),
      earlierAuthorizationConsumed: true, broaderProviderExperimentsAuthorized: false } };
  const contract = { ...body, sha256: digest(body) } as unknown as PrivateStreamCanaryContract;
  const stateDirectory = join(directory, "single-use");
  const binding: CanaryBinding = { publicCommit: "a".repeat(40), privateCommit: "b".repeat(40), privateFreezeSha256: "c".repeat(64),
    sourceSha256: contract.source.sha256, contractSha256: contract.sha256, image: contract.image.image, stateDirectorySha256: sha(stateDirectory) };
  const gate = { kind: "private-stream-canary-execution-gate-v1", verdict: "PASS", binding,
    reviewer: { model: "gpt-6-astra", effort: "medium", independent: true, identifier: "/root/synthetic_test_reviewer" }, blockingFindings: [], scope: "one-canary-contract-only" };
  const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
  const gateBytes = bytes(gate);
  const session = { kind: "private-stream-canary-session-preflight-v1", binding, gateSha256: sha(gateBytes), runId: "synthetic-run-1", sessionIdentitySha256: "e".repeat(64),
    session: structuredClone(PRIVATE_STREAM_CANARY_POLICY.session), catalog: structuredClone(PRIVATE_STREAM_CANARY_POLICY.catalog),
    containment: structuredClone(PRIVATE_STREAM_CANARY_POLICY.containment), route: { model: "gpt-5.6-sol", effort: "low", access: "cli-session" },
    deadline: { startMs: 100, wallMs: 1_200_000, startsBeforePreparation: true, abortReadsAndExec: true, cleanupUncancelled: true },
    servedIdentityCapture: PRIVATE_STREAM_CANARY_POLICY.servedIdentityCapture,
    cleanupProofRequired: ["reads-closed", "client-absent", "sidecars-absent", "network-absent", "isolated-session-removed"] };
  const sessionBytes = bytes(session), request = privateStreamCanaryRequest(contract);
  let current = structuredClone(binding), now = 101;
  const trust = { binding, gateSha256: sha(gateBytes) as string | null, sessionSha256: sha(sessionBytes) as string | null };
  const options = { contract, trust, stateDirectory, observeBinding: () => current, monotonicNow: () => now };
  return { contract, binding, gate, gateBytes, session, sessionBytes, request, trust, options, stateDirectory, bytes,
    create: () => createPrivateStreamCanaryPreflight(options), setCurrent: (value: CanaryBinding) => { current = value; }, setNow: (value: number) => { now = value; } };
}
const outcome = () => ({ clientLaunches: 1, providerCalls: 2, providerCountAuthenticated: true, completed: true, failure: null,
  deadlineExceeded: false, cleanup: { readsClosed: true, clientAbsent: true, sidecarsAbsent: true, networkAbsent: true, sessionRemoved: true, independentlyObserved: true },
  usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 80, reasoningOutputTokens: 10, complete: true },
  servedIdentity: { model: "gpt-5.6-sol", effort: "low", version: "synthetic-version", provenance: "independently-authenticated-provider-metadata", evidenceSha256: "d".repeat(64) } });

test("source contract is bounded, additive, and unconditionally unavailable for provider dispatch", () => {
  assert.equal(PRIVATE_STREAM_CANARY_AUTHORIZATION, "Move forward with anything you need to. You have my permission.");
  assert.equal(PRIVATE_STREAM_CANARY_POLICY.wallMs, 1_200_000);
  assert.equal(PRIVATE_STREAM_CANARY_POLICY.endpoint, "http://mcp-forwarder:8082/mcp");
  assert.ok(!PRIVATE_STREAM_CANARY_POLICY.command.includes("--output-last-message"));
  assert.equal(PRIVATE_STREAM_CANARY_POLICY.catalog.tools.length, 4);
  const source = privateStreamCanarySource();
  assert.equal(source.sha256, digest(source.files));
  for (const path of ["eval/private-stream-canary-contract.ts", "eval/private-stream-canary-preflight.ts", "eval/private-stream-image-gate-v1.json"]) assert.ok(source.files.some(f => f.path === path));
  assert.throws(() => requirePrivateStreamCanaryDispatch({ imageAccepted: true, providerAuthorized: true }), /execution unavailable/);
  let reads = 0;
  assert.throws(() => preparePrivateStreamCanaryContract({ imageGate: Buffer.alloc(0), finalImageGate: Buffer.alloc(0),
    safeCanaryFreeze: Buffer.alloc(0), consumedTombstone: Buffer.alloc(0), earlierAuthorization: Buffer.alloc(0),
    currentAuthorization: PRIVATE_STREAM_CANARY_AUTHORIZATION, readPublication: () => { reads++; return Buffer.alloc(0); } }), /gate bytes mismatch/);
  assert.equal(reads, 0);
});

test("missing independent gate/session deny, matching structural receipts do not authorize execution", t => {
  const f = fixture(t);
  for (const key of ["gateSha256", "sessionSha256"] as const) {
    const original = f.trust[key]; f.trust[key] = null;
    assert.throws(() => f.create().inspect(f.gateBytes, f.sessionBytes, f.request), /default deny/); f.trust[key] = original;
  }
  assert.deepEqual(f.create().inspect(f.gateBytes, f.sessionBytes, f.request),
    { dispatcherAvailable: false, executionReady: false, providerAuthorized: false, requirementsMatch: true });
});

test("wrong image, source, private freeze, commits and state binding reject", t => {
  const f = fixture(t), preflight = f.create();
  for (const key of Object.keys(f.binding) as Array<keyof CanaryBinding>) {
    f.setCurrent({ ...f.binding, [key]: "stale" });
    assert.throws(() => preflight.inspect(f.gateBytes, f.sessionBytes, f.request), /stale source/);
  }
  f.setCurrent(f.binding);
  const changed = structuredClone(f.contract); changed.source.sha256 = "e".repeat(64);
  assert.throws(() => createPrivateStreamCanaryPreflight({ ...f.options, contract: changed }), /contract seal mismatch/);
});

test("wrong route, deadline, multi-attempt, replay intent, retry, batch and production reject", t => {
  const f = fixture(t), preflight = f.create();
  for (const change of [{ model: "gpt-6-astra" }, { effort: "high" }, { wallMs: 1_200_001 }, { image: "wrong" },
    { attempts: 2 }, { retry: true }, { reviewBatch: true }, { production: true }, { canaryId: "consumed-prior-canary" }]) {
    assert.throws(() => preflight.inspect(f.gateBytes, f.sessionBytes, { ...f.request, ...change }), /only exact single/);
  }
  for (const now of [99, 1_200_100, Number.NaN]) {
    f.setNow(now); assert.throws(() => preflight.inspect(f.gateBytes, f.sessionBytes, f.request), /deadline expired/);
  }
});

test("resealed wrong gates and session credentials/catalog/containment/route/deadline reject", t => {
  const f = fixture(t);
  for (const change of [{ verdict: "FAIL" }, { binding: { ...f.binding, privateFreezeSha256: "e".repeat(64) } },
    { reviewer: { ...f.gate.reviewer, effort: "low" } }, { scope: "batch" }]) {
    const bytes = f.bytes({ ...f.gate, ...change }); f.trust.gateSha256 = sha(bytes);
    assert.throws(() => f.create().inspect(bytes, f.sessionBytes, f.request), /execution gate scope/);
  }
  f.trust.gateSha256 = sha(f.gateBytes);
  const mutations = [
    { session: { ...f.session.session, authenticated: false } }, { session: { ...f.session.session, credentialBytesInspected: true } },
    { session: { ...f.session.session, credentialBytesPersisted: true } }, { session: { ...f.session.session, isolated: false } },
    { session: { ...f.session.session, apiKeyFallback: true } }, { catalog: { ...f.session.catalog, complete: false } },
    { session: { ...f.session.session, cliVersion: "0.153.0" } }, { sessionIdentitySha256: null },
    { catalog: { ...f.session.catalog, tools: f.session.catalog.tools.slice(1) } }, { catalog: { ...f.session.catalog, resources: [{}] } },
    { containment: { ...f.session.containment, hostOutputMount: true } }, { containment: { ...f.session.containment, fixedTokenlessClientEndpoint: false } },
    { route: { model: "gpt-5.6-sol", effort: "high", access: "cli-session" } }, { gateSha256: "e".repeat(64) },
    { deadline: { ...f.session.deadline, wallMs: 1_199_999 } }, { deadline: { ...f.session.deadline, startsBeforePreparation: false } },
    { deadline: { ...f.session.deadline, cleanupUncancelled: false } }, { cleanupProofRequired: [] }, { rawCredential: "must-reject" },
  ];
  for (const change of mutations) {
    const bytes = f.bytes({ ...f.session, ...change }); f.trust.sessionSha256 = sha(bytes);
    assert.throws(() => f.create().inspect(f.gateBytes, bytes, f.request));
  }
  f.trust.sessionSha256 = sha(f.sessionBytes);
  assert.throws(() => f.create().inspect(f.gateBytes, Buffer.concat([f.sessionBytes, Buffer.from(" ")]), f.request), /bytes mismatch/);
});

test("copied, serialized, cross-scope, reused and restarted preparation capabilities deny", t => {
  const f = fixture(t), p = f.create(), token = p.prepareCapability(f.gateBytes, f.sessionBytes, f.request);
  assert.throws(() => JSON.stringify(token), /cannot be serialized/);
  assert.throws(() => p.consumeForPreparation({ ...token }), /exact unused/);
  assert.throws(() => f.create().consumeForPreparation(token), /exact unused/);
  assert.throws(() => p.prepareCapability(f.gateBytes, f.sessionBytes, f.request), /already issued/);
  const start = p.consumeForPreparation(token); assert.equal(start.providerCalls, 0);
  assert.throws(() => p.consumeForPreparation(token), /exact unused/);
  const restarted = f.create(), replay = restarted.prepareCapability(f.gateBytes, f.sessionBytes, f.request);
  assert.throws(() => restarted.consumeForPreparation(replay), /EEXIST/);
  const failure = p.retainOutcome({ rawStream: "private bytes must never persist" });
  assert.equal(failure.status, "failed"); assert.equal(failure.providerCalls, null);
  const bytes = readFileSync(join(f.stateDirectory, "terminal.json"), "utf8");
  assert.ok(!bytes.includes("private bytes")); assert.equal(JSON.parse(bytes).failure, "invalid-evidence");
  assert.throws(() => p.retainOutcome(outcome()), /one immutable terminal/);
});

test("source drift and deadline after issuance deny before consumption", t => {
  const f = fixture(t), p = f.create(), token = p.prepareCapability(f.gateBytes, f.sessionBytes, f.request);
  f.setCurrent({ ...f.binding, image: "stale" }); assert.throws(() => p.consumeForPreparation(token), /stale source/);
  f.setCurrent(f.binding); f.setNow(1_200_100); assert.throws(() => p.consumeForPreparation(token), /deadline expired/);
});

test("deadline remains binding through terminal retention", t => {
  const f = fixture(t), p = f.create(), token = p.prepareCapability(f.gateBytes, f.sessionBytes, f.request);
  p.consumeForPreparation(token); f.setNow(1_200_100);
  const terminal = p.retainOutcome(outcome()); assert.equal(terminal.deadlineExceeded, true); assert.equal(terminal.status, "failed");
});

test("accounting retains unknown counts, cached/reasoning subsets and failure without granting eligibility", () => {
  const result = reducePrivateStreamCanaryOutcome(outcome());
  assert.equal(result.status, "infrastructure-evidence-complete"); assert.equal(result.usage?.reportedAggregateTokens, 120);
  assert.equal(result.providerCalls, 2); assert.equal(result.clientLaunches, 1); assert.equal(result.eligibility, "not-eligible");
  assert.equal(result.batchAuthorized, false); assert.equal(result.reviewAttemptsStarted, 0); assert.equal(result.unstartedReviewAttempts, 64);
  const missing = reducePrivateStreamCanaryOutcome({ ...outcome(), providerCalls: null, providerCountAuthenticated: false, usage: null, servedIdentity: null });
  assert.equal(missing.status, "failed"); assert.equal(missing.providerCalls, null); assert.equal(missing.usage, null);
  for (const change of [{ deadlineExceeded: true }, { cleanup: null }, { cleanup: { ...outcome().cleanup, sessionRemoved: false } },
    { completed: false, failure: "provider-failed" }]) assert.equal(reducePrivateStreamCanaryOutcome({ ...outcome(), ...change }).status, "failed");
  for (const change of [{ providerCountAuthenticated: false }, { clientLaunches: 2 }, { clientLaunches: 0 },
    { usage: { ...outcome().usage, cachedInputTokens: 101 } }, { servedIdentity: { ...outcome().servedIdentity, effort: "high" } },
    { servedIdentity: { ...outcome().servedIdentity, provenance: "model-self-report" } }]) assert.throws(() => reducePrivateStreamCanaryOutcome({ ...outcome(), ...change }));
});
