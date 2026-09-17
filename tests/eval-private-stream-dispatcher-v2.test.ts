import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { digest, sha } from "../eval/prediction-contract.js";
import { ACCEPTED_CANARY_CONTRACT } from "../eval/private-stream-dispatcher-contract-v1.js";
import type { CleanupObservation, DispatcherRuntime } from "../eval/private-stream-dispatcher-v1.js";
import { createPrivateStreamRuntime } from "../eval/private-stream-dispatcher-runtime-v1.js";
import { PRIVATE_STREAM_CANARY_IMAGE, type PrivateStreamCanaryContract } from "../eval/private-stream-canary-contract.js";
import { consumeDispatcherLaunchPermissionV2, createPrivateStreamDispatcherV2, PRIVATE_STREAM_DISPATCHER_V2_FILES,
  PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2, PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2_SHA256, privateStreamDispatcherV2Source,
  reduceObservableCanaryStreamV2, verifyDispatcherGateV2, type DispatcherBindingV2, type DispatcherOptionsV2 } from "../eval/private-stream-dispatcher-v2.js";
import { privateStreamDispatcherMainV2 } from "../scripts/evidence/private-stream-dispatcher-v2.js";

const secret = "v2-provider-text-must-not-persist-6bf9e0";
function stream(cacheWrite = true) {
  const rows: unknown[] = [{ type: "thread.started", thread_id: secret }, { type: "turn.started" }];
  for (const tool of ["list_tree", "read_file", "search_text", "read_link"]) {
    const item = { id: tool, type: "mcp_tool_call", server: "source_read", tool, arguments: { path: secret } };
    rows.push({ type: "item.started", item }, { type: "item.completed", item: { ...item, result: { content: [{ type: "text", text: secret }] } } });
  }
  rows.push({ type: "item.completed", item: { id: "final", type: "agent_message", text: JSON.stringify({ status: "completed", tools:
    { list_tree: "succeeded", read_file: "succeeded", search_text: "succeeded", read_link: "refused-no-link" } }) } },
  { type: "turn.completed", usage: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 70,
    ...(cacheWrite ? { cache_write_input_tokens: 5 } : {}), reasoning_output_tokens: 10 } });
  return rows.map(value => JSON.stringify(value)).join("\n") + "\n";
}
function allBytes(path: string): string {
  if (!existsSync(path)) return "";
  return readdirSync(path).map(name => { const child = join(path, name); return statSync(child).isDirectory() ? allBytes(child) : readFileSync(child, "utf8"); }).join("\n");
}
const cleanup = (): CleanupObservation => ({ readsClosed: true, clientAbsent: true, sidecarsAbsent: true,
  networkAbsent: true, sessionRemoved: true, independentlyObserved: true });
function fixture(t: { after(callback: () => void): void }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "private-stream-v2-"))); t.after(() => rmSync(root, { recursive: true, force: true }));
  const stateDirectory = join(root, "state"), evidenceDirectory = join(root, "evidence");
  const binding: DispatcherBindingV2 = { publicCommit: "a".repeat(40), privateCommit: "b".repeat(40), sourceSha256: sha("source"),
    privateFreezeSha256: sha("freeze"), runtimeContractSha256: ACCEPTED_CANARY_CONTRACT.sha256,
    evidenceContractSha256: PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2_SHA256, image: PRIVATE_STREAM_CANARY_IMAGE.image,
    stateDirectorySha256: sha(stateDirectory), runtimeInputsSha256: sha("runtime-inputs") };
  const gate = { kind: "private-stream-dispatcher-gate-v2", binding, verdict: "PASS",
    reviewer: { model: "gpt-6-astra", effort: "medium", independent: true, identifier: "/root/synthetic_v2_gate" },
    blockingFindings: [], scope: "one-observable-infrastructure-canary-only" };
  const gateBytes = Buffer.from(JSON.stringify(gate)); const calls: string[] = [];
  let now = 0, alarm: (() => void) | undefined, drift = false;
  const runtime: DispatcherRuntime = {
    async session(signal) { assert.equal(signal.aborted, false); calls.push("session"); return { sessionIdentitySha256: sha("session"), cliVersion: "0.152.0", authenticated: true }; },
    async prepare(signal, read) { calls.push("prepare"); read(() => assert.equal(signal.aborted, false)); },
    async launch(signal, permission) { calls.push("launch"); assert.equal(signal.aborted, false);
      consumeDispatcherLaunchPermissionV2(permission, "00000000-0000-0000-0000-000000000001", binding, "synthetic"); return stream(); },
    closeReads() { calls.push("close"); }, async kill() { calls.push("kill"); }, async cleanup() { calls.push("cleanup"); return cleanup(); },
  };
  // Keep the run identity deterministic at the runtime boundary while allowing
  // the dispatcher itself to generate its opaque UUID.
  let actualRunId = "";
  const options: DispatcherOptionsV2 = { binding, stateDirectory, evidenceDirectory, gate: gateBytes, gateSha256: sha(gateBytes),
    observeBinding() { if (drift) throw new Error("source drift"); }, runtime(runId) { actualRunId = runId; return { ...runtime,
      async launch(signal, permission) { calls.push("launch"); assert.equal(signal.aborted, false);
        consumeDispatcherLaunchPermissionV2(permission, actualRunId, binding, "synthetic"); return stream(); } }; }, executionClass: "synthetic",
    clock: { now: () => now, arm(callback, ms) { assert.equal(ms, 1_200_000); alarm = callback; return () => { alarm = undefined; }; } } };
  return { root, stateDirectory, evidenceDirectory, binding, gate, gateBytes, calls, runtime, options,
    create: () => createPrivateStreamDispatcherV2(options), drift() { drift = true; }, expire() { now = 1_200_000; alarm?.(); } };
}

test("V2 contract limits claims and drops the separate observer transport", () => {
  assert.deepEqual(PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2.unavailable,
    { providerServedIdentity: null, providerRequestCount: null, dollarCost: null, completeClientCatalog: null });
  assert.equal(PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2.purpose, "infrastructure-canary-only-no-bug-finding-or-cost-claim");
  assert.equal(PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2_SHA256, digest(PRIVATE_STREAM_OBSERVABLE_CONTRACT_V2));
  assert.ok(PRIVATE_STREAM_DISPATCHER_V2_FILES.every(path => !path.includes("observer") && !path.endsWith(".c")));
  const source = privateStreamDispatcherV2Source(process.cwd()); assert.equal(source.sha256, digest(source.files));
});

test("runtime successor hook owns V2 permission consumption without changing the V1 default", async () => {
  let consumed = false;
  const runtime = createPrivateStreamRuntime({ root: process.cwd(), sessionDirectory: "/not-read", mountsRoot: "/not-read",
    authority: { registrationBytes: "", registrationSha256: "", manifestBytes: "", manifestSha256: "" },
    contract: { image: PRIVATE_STREAM_CANARY_IMAGE, scope: {} } as PrivateStreamCanaryContract },
  "00000000-0000-0000-0000-000000000001", { v2: true }, () => {}, () => 1_000, undefined, {
    executionClass: "synthetic", consumePermission() { consumed = true; throw new Error("V2 hook reached"); }, reduceStream: reduceObservableCanaryStreamV2 });
  await assert.rejects(runtime.launch(new AbortController().signal, {}), /V2 hook reached/); assert.equal(consumed, true);
});

test("V2 reducer accepts the pinned cache-write field and retains only bounded observable usage", () => {
  const value = reduceObservableCanaryStreamV2(stream());
  assert.deepEqual(value.observedUsage, { inputTokens: 100, outputTokens: 20, cachedInputTokens: 70,
    cacheWriteInputTokens: 5, reasoningOutputTokens: 10, aggregateTokens: 120 });
  assert.deepEqual(value.registeredReadEvidence.tools, ["list_tree", "read_file", "search_text", "read_link"]);
  assert.equal(value.registeredReadEvidence.completedCalls, 4);
  assert.ok(!JSON.stringify(value).includes(secret));
  assert.equal(reduceObservableCanaryStreamV2(stream(false)).observedUsage.cacheWriteInputTokens, null);
});

test("V2 reducer rejects partial, expanded and inconsistent terminal evidence", () => {
  assert.throws(() => reduceObservableCanaryStreamV2(stream().trimEnd()));
  const extra = stream().trimEnd().split("\n"); const terminal = JSON.parse(extra.at(-1)!); terminal.usage.served_model = "gpt-5.6-sol";
  extra[extra.length - 1] = JSON.stringify(terminal); assert.throws(() => reduceObservableCanaryStreamV2(extra.join("\n") + "\n"));
  const bad = stream().trimEnd().split("\n"); const invalid = JSON.parse(bad.at(-1)!); invalid.usage.cache_write_input_tokens = 101;
  bad[bad.length - 1] = JSON.stringify(invalid); assert.throws(() => reduceObservableCanaryStreamV2(bad.join("\n") + "\n"));
});

test("metadata preflight closes without state, launch or capability", async t => {
  const f = fixture(t), dispatcher = f.create(); const result = await dispatcher.preflight();
  assert.equal(result.providerCalls, null); assert.equal(existsSync(f.stateDirectory), false); await dispatcher.closePreflight();
  assert.equal(existsSync(f.stateDirectory), false); assert.ok(!f.calls.includes("launch")); assert.ok(f.calls.includes("cleanup"));
  assert.throws(() => dispatcher.issueCapability());
});

test("one synthetic canary records only observable evidence and permanently consumes state", async t => {
  const f = fixture(t), dispatcher = f.create(); await dispatcher.preflight(); const capability = dispatcher.issueCapability();
  assert.throws(() => JSON.stringify(capability)); const result = await dispatcher.run(capability);
  assert.equal(result.status, "infrastructure-canary-complete"); assert.equal(result.clientLaunchInvoked, true);
  assert.equal(result.cliUsage?.aggregateTokens, 120); assert.equal(result.cleanupProven, true);
  assert.deepEqual([result.providerServedIdentity, result.providerRequestCount, result.dollarCost, result.completeClientCatalog], [null, null, null, null]);
  assert.deepEqual([result.reviewAttemptsStarted, result.unstartedReviewAttempts, result.retryAuthorized, result.batchAuthorized], [0, 64, false, false]);
  assert.equal(f.calls.filter(call => call === "launch").length, 1); await assert.rejects(dispatcher.run(capability));
  assert.ok(existsSync(join(f.stateDirectory, "start.json"))); assert.ok(existsSync(join(f.stateDirectory, "terminal.json")));
  assert.ok(!allBytes(f.root).includes(secret));
  const restarted = f.create(); f.options.evidenceDirectory = join(f.root, "restart-evidence"); await assert.rejects(restarted.preflight());
});

test("malformed stream remains consumed, failed, unretryable and secret-free", async t => {
  const f = fixture(t); f.options.runtime = runId => ({ ...f.runtime, async launch(_signal, permission) {
    consumeDispatcherLaunchPermissionV2(permission, runId, f.binding, "synthetic"); return stream() + secret; } });
  const dispatcher = f.create(); await dispatcher.preflight(); const result = await dispatcher.run(dispatcher.issueCapability());
  assert.equal(result.status, "failed"); assert.equal(result.failure, "invalid-or-incomplete-cli-evidence");
  assert.equal(result.providerRequestCount, null); assert.equal(result.consumed, true); assert.equal(result.retryAuthorized, false);
  assert.ok(!allBytes(f.root).includes(secret));
});

test("a reservation race closes the losing preflight and never launches it", async t => {
  const f = fixture(t), first = f.create(); await first.preflight();
  f.options.evidenceDirectory = join(f.root, "second-evidence"); const second = f.create(); await second.preflight();
  const firstToken = first.issueCapability(), secondToken = second.issueCapability(); await first.run(firstToken);
  await assert.rejects(second.run(secondToken), /durable reservation failed/);
  assert.equal(f.calls.filter(call => call === "launch").length, 1);
  assert.ok(f.calls.filter(call => call === "cleanup").length >= 2);
});

test("deadline aborts active work, kills before release and awaits uncancelled cleanup", async t => {
  const f = fixture(t); let release: (() => void) | undefined, cleaned = false;
  f.options.runtime = runId => ({ ...f.runtime, async launch(signal, permission) {
    consumeDispatcherLaunchPermissionV2(permission, runId, f.binding, "synthetic"); f.calls.push("launch");
    await new Promise<void>(resolve => { release = resolve; queueMicrotask(() => f.expire()); }); assert.equal(signal.aborted, true); throw new Error(secret); },
    async kill() { f.calls.push("kill"); release?.(); }, async cleanup() { cleaned = true; f.calls.push("cleanup"); return cleanup(); } });
  const dispatcher = f.create(); await dispatcher.preflight(); const result = await dispatcher.run(dispatcher.issueCapability());
  assert.equal(result.status, "failed"); assert.equal(result.deadlineExceeded, true); assert.equal(result.providerRequestCount, null); assert.equal(cleaned, true);
  assert.ok(f.calls.indexOf("kill") > f.calls.indexOf("launch")); assert.ok(!allBytes(f.root).includes(secret));
});

test("cleanup failure cannot produce a successful infrastructure canary", async t => {
  const f = fixture(t); f.options.runtime = runId => ({ ...f.runtime, async launch(signal, permission) {
    consumeDispatcherLaunchPermissionV2(permission, runId, f.binding, "synthetic"); assert.equal(signal.aborted, false); return stream(); },
    async cleanup() { throw new Error(secret); } });
  const dispatcher = f.create(); await dispatcher.preflight(); const result = await dispatcher.run(dispatcher.issueCapability());
  assert.equal(result.status, "failed"); assert.equal(result.failure, "cleanup-unproven"); assert.equal(result.cleanupProven, false);
  assert.ok(!allBytes(f.root).includes(secret));
});

test("gate, source and runtime identity drift deny before launch", async t => {
  const f = fixture(t);
  for (const change of [{ verdict: "FAIL" }, { scope: "batch" }, { reviewer: { ...f.gate.reviewer, model: "gpt-5.6-sol" } }, { blockingFindings: ["x"] }]) {
    const bytes = Buffer.from(JSON.stringify({ ...f.gate, ...change })); assert.throws(() => verifyDispatcherGateV2(bytes, sha(bytes), f.binding));
  }
  const dispatcher = f.create(); await dispatcher.preflight(); f.drift(); assert.throws(() => dispatcher.issueCapability());
  assert.equal(existsSync(f.stateDirectory), false); await dispatcher.closePreflight(); assert.equal(f.calls.includes("launch"), false);
});

test("entrypoint exposes only explicit preflight and canary modes", async () => {
  for (const args of [[], ["--batch"], ["--production"], ["--canary"], ["--preflight"]]) await assert.rejects(privateStreamDispatcherMainV2(args));
});
