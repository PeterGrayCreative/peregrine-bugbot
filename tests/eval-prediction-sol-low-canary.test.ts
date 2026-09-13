import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { digest, sha } from "../eval/prediction-contract.js";
import { createPredictionCliBridge, createPredictionSolLowCanaryBridge, createStructuralPredictionSolLowCanaryBridge } from "../eval/prediction-cli-bridge.js";
import { predictionCliCommand, validatePredictionCliCommand } from "../eval/prediction-cli-command.js";
import { predictionSolLowCanaryCommand, validatePredictionSolLowCanaryCommand } from "../eval/prediction-sol-low-command.js";
import { preparePredictionSolLowCanary, observePredictionSolLowIdentity } from "../eval/prediction-sol-low-canary.js";
import { predictionSolLowFixture, trustedLowFixture } from "./eval-prediction-sol-low-canary-fixture.js";
import { predictionDockerFixture, predictionHttpCall } from "./eval-prediction-cli-bridge-fixture.js";

const result = (stdout = JSON.stringify({ type: "turn.completed", usage: { input_tokens: 20, output_tokens: 5 } })) => ({ stdout, stderr: "", code: 0, timedOut: false });
const approval = (scope: any, userSha: string) => ({ scope, permission: "synthetic-only" as const, approvalEvidenceSha256: userSha, independentGateSha256: sha("synthetic independent gate") });
function output(args: string[], bytes = "synthetic infrastructure result") { const path = args.find(v => v.includes("target=/output"))!.split("source=")[1]!.split(",target=")[0]!; writeFileSync(join(path, "result.json"), bytes, { mode: 0o600 }); }

test("prospective low canary preserves all high inputs and rejects authority, route and review scope drift", async t => {
  const f = await predictionSolLowFixture(t), before = JSON.stringify(f.pack), a = f.amendment;
  assert.equal(a.route.effort, "low"); assert.equal(a.prompt, f.pack.canary.prompt); assert.deepEqual(a.caps, f.pack.canary.caps); assert.deepEqual(a.toolBinding, f.pack.canary.toolBinding);
  assert.equal(a.maximumAttempts, 1); assert.equal(a.reviewAttemptsAllowed, 0); assert.equal(a.providerAuthorized, false); assert.equal(a.executionReady, false); assert.equal(a.userAuthorization.independentlyAuthenticated, false);
  assert.equal(a.separateLedger.unstartedReviewAttempts, 64); assert.equal(JSON.stringify(f.pack), before); assert.equal(f.pack.canary.route.effort, "high");
  for (const mutate of [(v: any) => { v.userAuthorization.bytes += " "; }, (v: any) => { const p = JSON.parse(v.r4Freeze.bytes); p.package.canary.route.effort = "low"; v.r4Freeze = trustedLowFixture(p); },
    (v: any) => { const p = JSON.parse(v.bridgeFreeze.bytes); p.bridgePolicy.requestedEffort = "low"; v.bridgeFreeze = trustedLowFixture(p); },
    (v: any) => { const p = JSON.parse(v.assessmentFreeze.bytes); p.unstartedReviewAttempts = 63; v.assessmentFreeze = trustedLowFixture(p); },
    (v: any) => { const p = JSON.parse(v.assessmentFreeze.bytes); p.privateBindings = []; v.assessmentFreeze = trustedLowFixture(p); }]) {
    const v = structuredClone(f.amendmentAuthority); mutate(v); assert.throws(() => preparePredictionSolLowCanary(v));
  }
});

test("low command is canary-only; high commands and production defaults do not admit it", () => {
  const url = "http://mcp-forwarder:8082/mcp/" + "a".repeat(64), low = predictionSolLowCanaryCommand(url), high = predictionCliCommand(url, false);
  validatePredictionSolLowCanaryCommand(low, url); validatePredictionCliCommand(high, url);
  assert.equal(low.filter((arg, i) => arg !== high[i]).length, 1); assert.ok(low.includes('model_reasoning_effort="low"'));
  assert.throws(() => validatePredictionCliCommand(low, url), /Sol\/high/); assert.throws(() => validatePredictionSolLowCanaryCommand(high, url), /Sol\/low/);
  for (const mutate of [(a: string[]) => a.push("resume"), (a: string[]) => a.push("--output-schema", "/opt/peregrine/methodology-review.schema.json"),
    (a: string[]) => { a[a.indexOf("gpt-5.6-sol")] = "gpt-6-astra"; }, (a: string[]) => { a[a.indexOf("multi_agent")] = "skills"; },
    (a: string[]) => { a[a.findIndex(v => v.includes("enabled_tools="))] = 'mcp_servers.source_read.enabled_tools=["shell"]'; }]) {
    const altered = [...low]; mutate(altered); assert.throws(() => validatePredictionSolLowCanaryCommand(altered, url));
  }
});

test("one authorized synthetic low canary reaches four readers and retains an independent ledger", async t => {
  const f = await predictionSolLowFixture(t); let count = 0;
  const docker = predictionDockerFixture(async (args, opts, endpoint) => {
    count++; assert.ok(args.includes('model_reasoning_effort="low"')); assert.ok(!args.includes('model_reasoning_effort="high"')); assert.ok(!args.includes("--output-schema"));
    assert.equal(opts?.stdin, f.amendment.prompt); assert.ok(opts?.deadlineSignal); assert.ok(opts?.timeoutMs! <= 1200000);
    for (const target of ["/workspace", "/opt/peregrine"]) assert.deepEqual(readdirSync(args.find(v => v.includes(`target=${target}`))!.split("source=")[1]!.split(",target=")[0]!), []);
    const init = await predictionHttpCall(endpoint, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "synthetic-low", version: "1" } } });
    const headers = { "Mcp-Session-Id": String(init.headers["mcp-session-id"]), "MCP-Protocol-Version": "2025-06-18" };
    await predictionHttpCall(endpoint, { jsonrpc: "2.0", method: "notifications/initialized" }, headers);
    const listed = await predictionHttpCall(endpoint, { jsonrpc: "2.0", id: 2, method: "tools/list" }, headers);
    assert.deepEqual(listed.body.result.tools.map((v: any) => v.name), ["list_tree", "read_file", "search_text", "read_link"]);
    for (const [name, arguments_] of [["list_tree", {}], ["read_file", { path: "review.diff" }], ["search_text", { query: "value" }], ["read_link", { path: "head/link" }]] as const) {
      const reply = await predictionHttpCall(endpoint, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: arguments_ } }, headers); assert.ok(reply.body.result.content[0].text);
    }
    const denied = await predictionHttpCall(endpoint, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "read_file", arguments: { path: "skills/invariant-first-pr-review/SKILL.md" } } }, headers);
    assert.equal(denied.body.result.isError, true); output(args); return result();
  });
  const bridge = await createStructuralPredictionSolLowCanaryBridge({ ...f.options, run: docker.run });
  await assert.rejects(bridge.run({} as never), /nonserializable/);
  assert.throws(() => bridge.scope("review", f.pack.preauthorization.attempts[0]!.id), /no review/);
  assert.throws(() => bridge.scope("canary", f.pack.canary.canaryId), /cannot consume/);
  const scope = bridge.scope("canary", f.amendment.canaryId), token = bridge.authorize(approval(scope, f.amendment.userAuthorization.sha256));
  assert.throws(() => JSON.stringify(token), /nonserializable/); const record = await bridge.run(token);
  assert.equal(record.scope.effort, "low"); assert.equal(record.providerCalls, 0); assert.equal(record.tokens.reportedAggregateTokens, 25); assert.equal(record.deadline.teardownCompleted, true);
  assert.equal(bridge.snapshot().batch.observed.length, 0); assert.equal(bridge.snapshot().batch.unstartedAttemptIds.length, 64); assert.equal((bridge.snapshot().canaryLedger as any).status, "completed");
  assert.equal(JSON.parse(readFileSync(join(f.options.directory, "canary-ledger-terminal.json"), "utf8")).ledger.terminalSha256, digest(record));
  await assert.rejects(bridge.run(token), /nonserializable/); assert.throws(() => bridge.authorize(approval(scope, f.amendment.userAuthorization.sha256)), /used|stopped/); assert.equal(count, 1);
  await assert.rejects(createStructuralPredictionSolLowCanaryBridge({ ...f.options, run: docker.run }), /EEXIST/);
  assert.ok(docker.calls.filter(c => ["rm", "stop", "ps"].includes(c.args[0]!) || c.args[0] === "network" && ["rm", "ls"].includes(c.args[1]!)).every(c => c.signal === undefined));
});

test("low route rejects missing amendment, stale/resealed freezes, changed execution ledger and wrong approvals before dispatch", async t => {
  const f = await predictionSolLowFixture(t), docker = predictionDockerFixture(async () => { throw new Error("must not invoke"); });
  assert.throws(() => createPredictionSolLowCanaryBridge({ ...f.options, run: docker.run } as never), /cannot inject/);
  assert.throws(() => createPredictionSolLowCanaryBridge({ ...f.options, solLowAmendment: undefined } as never), /amendment required/);
  assert.throws(() => createPredictionCliBridge(f.options), /separate Sol\/low/);
  for (const changed of [{ ...f.options, runId: "other" }, { ...f.options, directory: join(f.root, "other") },
    { ...f.options, solLowAmendment: { ...f.options.solLowAmendment, freezeBytes: f.options.solLowAmendment.freezeBytes + " " } }]) await assert.rejects(createStructuralPredictionSolLowCanaryBridge({ ...changed, run: docker.run }), /mismatch|drift/);
  const altered: any = structuredClone(f.frozen); altered.amendment.route.effort = "high"; const { sha256: _, ...body } = altered.amendment; altered.amendment.sha256 = digest(body);
  const resealed = trustedLowFixture(altered);
  await assert.rejects(createStructuralPredictionSolLowCanaryBridge({ ...f.options, solLowAmendment: { ...f.options.solLowAmendment, freezeBytes: resealed.bytes, freezeSha256: resealed.expectedSha256 }, run: docker.run }), /mismatch/);
  const bridge = await createStructuralPredictionSolLowCanaryBridge({ ...f.options, run: docker.run }), scope = bridge.scope("canary", f.amendment.canaryId);
  for (const s of [{ ...scope, effort: "high" }, { ...scope, runId: "other" }, { ...scope, sourceSha256: sha("stale") }]) assert.throws(() => bridge.authorize(approval(s, f.amendment.userAuthorization.sha256)), /mismatch/);
  assert.throws(() => bridge.authorize(approval(scope, sha("other user text"))), /authorization mismatch/);
  assert.throws(() => bridge.authorize({ ...approval(scope, f.amendment.userAuthorization.sha256), independentGateSha256: "" }), /digest/);
  assert.equal(docker.calls.length, 0);
});

test("low deadline propagates, preserves partial terminal/unknown usage, and cleanup is uncancelled", async t => {
  const f = await predictionSolLowFixture(t); let signal: AbortSignal | undefined;
  const docker = predictionDockerFixture(async (args, opts) => { signal = opts!.deadlineSignal; output(args, "partial low canary"); await new Promise<void>(done => { if (signal!.aborted) done(); else signal!.addEventListener("abort", () => done(), { once: true }); }); return { stdout: "partial", stderr: "", code: -1, timedOut: true }; });
  const bridge = await createStructuralPredictionSolLowCanaryBridge({ ...f.options, run: docker.run, wallMs: 1500 });
  const token = bridge.authorize(approval(bridge.scope("canary", f.amendment.canaryId), f.amendment.userAuthorization.sha256)), running = bridge.run(token);
  await assert.rejects(bridge.run(token), /active|nonserializable/); const record = await running;
  assert.equal(signal?.aborted, true); assert.equal(record.terminal.status, "partial"); assert.equal(record.terminal.rawOutput, "partial low canary"); assert.equal(record.tokens.status, "unknown");
  assert.equal(record.deadline.deadlineExceeded, true); assert.equal(record.deadline.teardownCompleted, true); assert.equal(bridge.snapshot().blocked, true); assert.equal(bridge.snapshot().batch.unstartedAttemptIds.length, 64);
  assert.ok(docker.calls.filter(c => ["rm", "stop", "ps"].includes(c.args[0]!) || c.args[0] === "network" && ["rm", "ls"].includes(c.args[1]!)).every(c => c.signal === undefined));
});

test("low identity observation retains unknown backend version and rejects known mismatch or fabrication", async t => {
  const f = await predictionSolLowFixture(t), body = { kind: "prediction-sol-low-canary-identity-observation-v1", runId: f.options.runId, amendmentSha256: f.amendment.sha256, requested: f.amendment.route,
    observedRequest: { model: "gpt-5.6-sol", effort: "low" }, servedModel: null, servedVersion: null, provenance: "unavailable", providerEvidenceReference: null };
  assert.equal(observePredictionSolLowIdentity(f.amendment, trustedLowFixture(body), f.options.runId).batchAuthorized, false);
  for (const update of [{ servedModel: "gpt-6-astra" }, { servedVersion: "fabricated", provenance: "model-self-report" }, { observedRequest: { model: "gpt-5.6-sol", effort: "high" } }, { runId: "other" }, { amendmentSha256: sha("stale") }]) {
    assert.throws(() => observePredictionSolLowIdentity(f.amendment, trustedLowFixture({ ...body, ...update }), f.options.runId));
  }
});

test("low invocation persistence collision retains failure without invoking the client or consuming review slots", async t => {
  const f = await predictionSolLowFixture(t), base = predictionDockerFixture(async () => { throw new Error("must not invoke client"); }); let collided = false;
  const run: typeof base.run = async (command, args, opts) => {
    if (!collided && args[0] === "network" && args[1] === "create") { collided = true; writeFileSync(join(f.options.directory, "canary/invocation.json"), "preserved collision", { flag: "wx" }); }
    return base.run(command, args, opts);
  };
  const bridge = await createStructuralPredictionSolLowCanaryBridge({ ...f.options, run });
  await assert.rejects(bridge.run(bridge.authorize(approval(bridge.scope("canary", f.amendment.canaryId), f.amendment.userAuthorization.sha256))), /EEXIST/);
  assert.equal(base.calls.some(c => c.args.includes("codex")), false); assert.equal(bridge.snapshot().blocked, true); assert.equal(bridge.snapshot().batch.unstartedAttemptIds.length, 64);
  assert.equal((bridge.snapshot().canaryLedger as any).status, "failed");
  assert.equal(JSON.parse(readFileSync(join(f.options.directory, "canary-ledger-failure.json"), "utf8")).ledger.status, "failed");
  assert.equal(readFileSync(join(f.options.directory, "canary/invocation.json"), "utf8"), "preserved collision");
});

test("low cleanup rejection preserves partial evidence and permanently stops the canary ledger", async t => {
  const f = await predictionSolLowFixture(t), base = predictionDockerFixture(async args => { output(args, "retained low partial"); throw new Error("synthetic client rejection"); });
  const run: typeof base.run = async (command, args, opts) => args[0] === "rm" && args[2]?.startsWith("peregrine-eval-") ? { stdout: "", stderr: "synthetic removal failure", code: 1, timedOut: false } : base.run(command, args, opts);
  const bridge = await createStructuralPredictionSolLowCanaryBridge({ ...f.options, run }), scope = bridge.scope("canary", f.amendment.canaryId);
  const record = await bridge.run(bridge.authorize(approval(scope, f.amendment.userAuthorization.sha256)));
  assert.equal(record.terminal.cleanupProven, false); assert.equal(record.deadline.executionError!.cleanupUnproven, true); assert.equal(record.terminal.rawOutput, "retained low partial");
  assert.equal(bridge.snapshot().blocked, true); assert.equal(bridge.snapshot().batch.observed.length, 0); assert.equal(bridge.snapshot().batch.unstartedAttemptIds.length, 64);
  assert.throws(() => bridge.authorize(approval(scope, f.amendment.userAuthorization.sha256)), /stopped|used/);
});
