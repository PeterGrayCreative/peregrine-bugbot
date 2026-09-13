import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { digest, sha } from "../eval/prediction-contract.js";
import { preparePredictionPreauthorization } from "../eval/prediction-preauthorization.js";
import { registerPredictionCliSession, assessPredictionCliBatch } from "../eval/prediction-cli-session.js";
import { METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE } from "../eval/methodology-runtime-image.js";
import { createPredictionCliBridge, createStructuralPredictionCliBridge } from "../eval/prediction-cli-bridge.js";
import { predictionCliCommand, validatePredictionCliCommand } from "../eval/prediction-cli-command.js";
import { predictionMountFixture } from "./eval-prediction-mount-fixture.js";
import { predictionDockerFixture, predictionHttpCall } from "./eval-prediction-cli-bridge-fixture.js";

async function fixture(t: TestContext) {
  const f = predictionMountFixture(t), cli = registerPredictionCliSession(f.authority.registrationBytes, f.authority.registrationSha256, sha("synthetic predecessor"));
  const trusted = (v: unknown) => { const bytes = JSON.stringify(v); return { bytes, expectedSha256: sha(bytes) }; };
  const authority = { preparation: f.authority, cliSessionFreeze: trusted({ kind: "prospective-cli-session-registration-freeze-v4", registration: cli, initialLedger: assessPredictionCliBatch(cli, []) }),
    runtimeAcceptanceFreeze: trusted({ kind: "prediction-runtime-acceptance-freeze-v1", acceptance: METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE, scientificRegistration: cli, providerCalls: 0, providerAuthorized: false, executionReady: false, cliAgentCanaryProven: false }) };
  const pack = await preparePredictionPreauthorization(authority, f.root), freezeBytes = JSON.stringify({ kind: "prediction-r4-preauthorization-freeze-v1", package: pack, providerCalls: 0, providerAuthorized: false, executionReady: false });
  const session = join(f.root, "synthetic-session"); mkdirSync(session, { mode: 0o700 }); writeFileSync(join(session, "auth.json"), "synthetic-not-a-credential", { mode: 0o600 });
  const old = process.env.PEREGRINE_CODEX_SESSION_DIR; process.env.PEREGRINE_CODEX_SESSION_DIR = session;
  t.after(() => { if (old === undefined) delete process.env.PEREGRINE_CODEX_SESSION_DIR; else process.env.PEREGRINE_CODEX_SESSION_DIR = old; });
  return { ...f, pack, options: { authority, mountsRoot: f.root, freezeBytes, freezeSha256: sha(freezeBytes), runId: "synthetic-run", directory: join(f.root, "bridge") } };
}
const approval = (scope: ReturnType<Awaited<ReturnType<typeof createStructuralPredictionCliBridge>>["scope"]>) => ({ scope, permission: "synthetic-only" as const, approvalEvidenceSha256: sha("synthetic approval"), independentGateSha256: sha("synthetic gate"), reviewedCanaryEvidenceSha256: sha("synthetic reviewed canary") });
const result = (stdout = JSON.stringify({ type: "turn.completed", usage: { input_tokens: 20, output_tokens: 5 } })) => ({ stdout, stderr: "", code: 0, timedOut: false });
function output(args: string[], text = "infrastructure complete") {
  const mount = args.find(v => v.includes("target=/output"))!; const root = mount.split("source=")[1]!.split(",target=")[0]!;
  writeFileSync(join(root, "result.json"), text, { mode: 0o600 });
}

test("prediction-only CLI profile is exact and rejects route/tool/delegation/history mutations", () => {
  const url = "http://mcp-forwarder:8082/mcp/" + "a".repeat(64), args = predictionCliCommand(url, false);
  validatePredictionCliCommand(args, url);
  for (const mutate of [(a: string[]) => a.push("resume"), (a: string[]) => { a[a.indexOf("gpt-5.6-sol")] = "gpt-6-astra"; }, (a: string[]) => { a[a.indexOf("multi_agent")] = "skills"; }, (a: string[]) => { a[a.findIndex(v => v.includes("enabled_tools="))] = 'mcp_servers.source_read.enabled_tools=["shell"]'; }]) {
    const copy = [...args]; mutate(copy); assert.throws(() => validatePredictionCliCommand(copy, url), /exact/);
  }
  assert.throws(() => predictionCliCommand("http://localhost:8082/mcp/" + "a".repeat(64), false), /forwarder/);
});

test("one canary reaches four real HTTP tools through injected containment, without consuming a review slot", async t => {
  const f = await fixture(t); let invocations = 0;
  const docker = predictionDockerFixture(async (args, opts, endpoint) => {
    invocations++; assert.ok(opts?.deadlineSignal); assert.ok(opts?.timeoutMs! <= 1_200_000); assert.equal(opts?.inheritEnv, false);
    assert.equal(opts?.stdin, f.pack.canary.prompt);
    const mount = (target: string) => args.find(v => v.includes(`target=${target}`))!.split("source=")[1]!.split(",target=")[0]!;
    assert.deepEqual(readdirSync(mount("/workspace")), []); assert.deepEqual(readdirSync(mount("/opt/peregrine")), []);
    const init = await predictionHttpCall(endpoint, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "synthetic", version: "1" } } });
    const headers = { "Mcp-Session-Id": String(init.headers["mcp-session-id"]), "MCP-Protocol-Version": "2025-06-18" };
    await predictionHttpCall(endpoint, { jsonrpc: "2.0", method: "notifications/initialized" }, headers);
    const listed = await predictionHttpCall(endpoint, { jsonrpc: "2.0", id: 2, method: "tools/list" }, headers);
    assert.deepEqual(listed.body.result.tools.map((v: any) => v.name), ["list_tree", "read_file", "search_text", "read_link"]);
    for (const [name, arguments_] of [["list_tree", {}], ["read_file", { path: "review.diff" }], ["search_text", { query: "value" }], ["read_link", { path: "head/link" }]] as const) {
      const response = await predictionHttpCall(endpoint, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: arguments_ } }, headers);
      const value = JSON.parse(response.body.result.content[0].text);
      if (name === "list_tree" || name === "search_text") {
        assert.equal(value.status, "incomplete"); assert.deepEqual(value.limitations, ["unsupported-file-type"]);
        assert.deepEqual(value.unavailable, [{ path: "head/link", reason: "unsupported-file-type" }]);
      } else assert.notEqual(response.body.result.isError, true, JSON.stringify(response.body));
      if (name === "read_link") assert.deepEqual(value, { kind: "literal-symlink-source", target: "index.ts", followed: false });
    }
    const forbidden = await predictionHttpCall(endpoint, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "read_file", arguments: { path: "skills/invariant-first-pr-review/SKILL.md" } } }, headers);
    assert.equal(forbidden.body.result.isError, true); output(args); return result();
  });
  const bridge = await createStructuralPredictionCliBridge({ ...f.options, run: docker.run });
  await assert.rejects(bridge.run({} as never), /nonserializable/);
  assert.throws(() => bridge.scope("canary", f.pack.preauthorization.attempts[0]!.id), /cannot consume/);
  const token = bridge.authorize(approval(bridge.scope("canary", f.pack.canary.canaryId)));
  assert.throws(() => JSON.stringify(token), /nonserializable/);
  const record = await bridge.run(token); assert.equal(record.terminal.status, "completed", JSON.stringify(record.failure)); assert.equal(record.tokens.reportedAggregateTokens, 25);
  assert.equal(record.providerCalls, 0); assert.equal(record.builtInCatalogVerified, false); assert.equal(record.deadline.teardownCompleted, true);
  assert.equal(bridge.snapshot().batch.observed.length, 0); assert.equal(bridge.snapshot().batch.unstartedAttemptIds.length, 64);
  await assert.rejects(bridge.run(token), /nonserializable/); assert.equal(invocations, 1);
  assert.ok(docker.calls.filter(c => ["rm", "ps", "stop"].includes(c.args[0]!) || c.args[0] === "network" && ["rm", "ls"].includes(c.args[1]!)).every(c => c.signal === undefined));
});

test("A/B keep identical raw scope and schema-only resources; terminal usage stops unknown review prefixes", async t => {
  const f = await fixture(t); const prompts: string[] = []; let count = 0;
  const docker = predictionDockerFixture(async (args, opts) => { prompts.push(opts!.stdin!); count++;
    const mount = args.find(v => v.includes("target=/opt/peregrine"))!.split("source=")[1]!.split(",target=")[0]!;
    assert.deepEqual(readdirSync(mount), ["methodology-review.schema.json"]); output(args, '{"findings":[]}'); return result(count === 1 ? undefined : ""); });
  const bridge = await createStructuralPredictionCliBridge({ ...f.options, run: docker.run });
  const [a, b] = f.pack.preauthorization.attempts;
  assert.equal(bridge.scope("review", a!.id).rawScopeSha256, bridge.scope("review", b!.id).rawScopeSha256);
  for (const slot of [a!, b!]) { const record = await bridge.run(bridge.authorize(approval(bridge.scope("review", slot.id)))); assert.equal(record.terminal.cleanupProven, true); }
  assert.equal(prompts[0], f.pack.preauthorization.dryRun.preparation.plan.cases[0]!.prompts.A.prompt);
  assert.equal(prompts[1], f.pack.preauthorization.dryRun.preparation.plan.cases[0]!.prompts.B.prompt);
  assert.equal(bridge.snapshot().batch.stopReason, "terminal-token-usage-unknown");
  assert.throws(() => bridge.authorize(approval(bridge.scope("review", f.pack.preauthorization.attempts[2]!.id))), /stopped|next/);
});

test("cross-run, wrong route, serialized approval, resealed prompt and mounted drift fail closed", async t => {
  const f = await fixture(t), docker = predictionDockerFixture(async () => { throw new Error("must not invoke"); });
  const bridge = await createStructuralPredictionCliBridge({ ...f.options, run: docker.run });
  const other = await createStructuralPredictionCliBridge({ ...f.options, directory: join(f.root, "other"), runId: "other", run: docker.run });
  const scope = bridge.scope("canary", f.pack.canary.canaryId), token = bridge.authorize(approval(scope));
  await assert.rejects(other.run(token), /nonserializable/);
  for (const altered of [{ ...scope, model: "other" }, { ...scope, freezeSha256: sha("other") }, { ...scope, sourceSha256: sha("stale") }]) assert.throws(() => bridge.authorize(approval(altered)), /mismatch/);
  const changed = JSON.parse(f.options.freezeBytes); changed.package.canary.prompt += " leak"; changed.package.sha256 = digest({ preauthorization: changed.package.preauthorization, canary: changed.package.canary });
  const bytes = JSON.stringify(changed);
  await assert.rejects(createStructuralPredictionCliBridge({ ...f.options, freezeBytes: bytes, freezeSha256: sha(bytes), directory: join(f.root, "bad"), run: docker.run }), /canary registration drift/);
  writeFileSync(join(f.firstRoot, "curator.json"), "forbidden");
  await assert.rejects(bridge.run(token), /unexpected source file/); assert.equal(docker.calls.length, 0);
  assert.equal(bridge.snapshot().blocked, true);
  assert.throws(() => createPredictionCliBridge({ ...f.options, run: docker.run } as never), /cannot inject/);
});

test("deadline reaches contained CLI, retains partial output and leaves all teardown calls uncancelled", async t => {
  const f = await fixture(t); let signal: AbortSignal | undefined;
  const docker = predictionDockerFixture(async (args, opts) => {
    signal = opts!.deadlineSignal; output(args, "partial before deadline");
    await new Promise<void>(resolve => { if (signal!.aborted) resolve(); else signal!.addEventListener("abort", () => resolve(), { once: true }); });
    return { stdout: "partial JSONL", stderr: "", code: -1, timedOut: true };
  });
  const bridge = await createStructuralPredictionCliBridge({ ...f.options, run: docker.run, wallMs: 1500 });
  const token = bridge.authorize(approval(bridge.scope("canary", f.pack.canary.canaryId))), running = bridge.run(token);
  await assert.rejects(bridge.run(token), /nonserializable|active/);
  const record = await running; assert.equal(signal?.aborted, true); assert.equal(record.terminal.status, "partial"); assert.equal(record.terminal.rawOutput, "partial before deadline");
  assert.equal(record.deadline.deadlineExceeded, true); assert.equal(record.deadline.teardownCompleted, true); assert.equal(record.tokens.status, "unknown");
  assert.equal(readFileSync(join(f.options.directory, "canary/output/result.json"), "utf8"), "partial before deadline");
  assert.ok(docker.calls.filter(c => ["rm", "ps", "stop"].includes(c.args[0]!) || c.args[0] === "network" && ["rm", "ls"].includes(c.args[1]!)).every(c => c.signal === undefined));
});

test("contained execution and cleanup rejection remains durable and stops the bridge", async t => {
  const f = await fixture(t), underlying = predictionDockerFixture(async (args) => { output(args, "retained partial"); throw new Error("synthetic execution rejection"); });
  const run: typeof underlying.run = async (command, args, opts) => {
    if (args[0] === "rm" && args[2]?.startsWith("peregrine-eval-")) return { stdout: "", stderr: "synthetic removal failed", code: 1, timedOut: false };
    return underlying.run(command, args, opts);
  };
  const bridge = await createStructuralPredictionCliBridge({ ...f.options, run });
  const record = await bridge.run(bridge.authorize(approval(bridge.scope("canary", f.pack.canary.canaryId))));
  assert.equal(record.terminal.cleanupProven, false); assert.equal(record.deadline.executionError!.cleanupUnproven, true);
  assert.equal(record.terminal.rawOutput, "retained partial"); assert.equal(bridge.snapshot().blocked, true);
  assert.ok(JSON.parse(readFileSync(join(f.options.directory, "canary/execution-failure.json"), "utf8")).cleanupUnproven);
});

test("disallowed observed capability stops progression and cannot certify the unknown built-in catalog", async t => {
  const f = await fixture(t), docker = predictionDockerFixture(async args => {
    output(args); return result(JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "synthetic event only" } }) + "\n" + result().stdout);
  });
  const bridge = await createStructuralPredictionCliBridge({ ...f.options, run: docker.run });
  const record = await bridge.run(bridge.authorize(approval(bridge.scope("canary", f.pack.canary.canaryId))));
  assert.equal(record.disallowed.length, 1); assert.equal(record.terminal.status, "partial"); assert.equal(record.builtInCatalog, null);
  assert.equal(bridge.snapshot().blocked, true); assert.equal(record.executionReady, false);
});

test("invocation persistence failure invokes no CLI and records the claimed review slot as failed", async t => {
  const f = await fixture(t), base = predictionDockerFixture(async () => { throw new Error("must not invoke CLI"); });
  let collided = false;
  const run: typeof base.run = async (command, args, opts) => {
    if (!collided && args[0] === "network" && args[1] === "create") {
      collided = true; writeFileSync(join(f.options.directory, "review-000001/invocation.json"), "preserved collision", { flag: "wx" });
    }
    return base.run(command, args, opts);
  };
  const bridge = await createStructuralPredictionCliBridge({ ...f.options, run });
  const id = f.pack.preauthorization.attempts[0]!.id;
  await assert.rejects(bridge.run(bridge.authorize(approval(bridge.scope("review", id)))), /EEXIST/);
  assert.equal(base.calls.some(c => c.args.includes("codex")), false); assert.equal(bridge.snapshot().blocked, true);
  assert.equal(bridge.snapshot().batch.observed[0]!.status, "failed"); assert.equal(bridge.snapshot().batch.unstartedAttemptIds.length, 63);
  assert.equal(readFileSync(join(f.options.directory, "review-000001/invocation.json"), "utf8"), "preserved collision");
  assert.ok(JSON.parse(readFileSync(join(f.options.directory, "review-000001/failure.json"), "utf8")).failure);
});
