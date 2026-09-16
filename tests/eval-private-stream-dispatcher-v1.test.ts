import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson } from "../eval/experiment.js";
import { digest, sha } from "../eval/prediction-contract.js";
import { PRIVATE_STREAM_CANARY_IMAGE, PRIVATE_STREAM_CANARY_POLICY, type PrivateStreamCanaryContract } from "../eval/private-stream-canary-contract.js";
import { ACCEPTED_CANARY_CONTRACT, ACCEPTED_IMAGE_CONFIGS, dispatcherSource, verifyDispatcherGate, type DispatcherBinding } from "../eval/private-stream-dispatcher-contract-v1.js";
import { createPrivateStreamDispatcher, type DispatcherOptions, type DispatcherRuntime } from "../eval/private-stream-dispatcher-v1.js";
import { verifyObserverEnvelope } from "../eval/private-stream-dispatcher-observer-v1.js";
import { createPrivateStreamRuntime, observeSessionMetadata, verifyClientInspect } from "../eval/private-stream-dispatcher-runtime-v1.js";
import { ACCEPTED_EVAL_RUNTIME_IMAGE } from "../eval/runtime-containment.js";
import { privateStreamDispatcherMain } from "../scripts/evidence/private-stream-dispatcher-v1.js";
import { predictionMountFixture } from "./eval-prediction-mount-fixture.js";
import { predictionDockerFixture, predictionHttpCall } from "./eval-prediction-cli-bridge-fixture.js";
import { REVIEW_READ_MCP_PROTOCOL } from "../eval/methodology-read-mcp.js";
import { sidecarHostFixture } from "./eval-methodology-inspect-fixture.js";
import { METHODOLOGY_EGRESS_BASE_ENV } from "../eval/methodology-egress.js";

const secret = "synthetic-secret-for-nonpersistence-check-1f982fab";
function stream() {
  const rows: unknown[] = [{ type: "thread.started", thread_id: secret }, { type: "turn.started" }];
  for (const tool of ["list_tree", "read_file", "search_text", "read_link"]) {
    const item = { id: tool, type: "mcp_tool_call", server: "source_read", tool, arguments: { path: secret } };
    rows.push({ type: "item.started", item }, { type: "item.completed", item: { ...item, result: { content: [{ type: "text", text: Buffer.from(secret).toString("base64") }] } } });
  }
  rows.push({ type: "item.completed", item: { id: "final", type: "agent_message", text: JSON.stringify({ status: "completed", tools:
    { list_tree: "succeeded", read_file: "succeeded", search_text: "succeeded", read_link: "refused-no-link" } }) } },
  { type: "turn.completed", usage: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 80, reasoning_output_tokens: 10 } });
  return rows.map(v => JSON.stringify(v)).join("\n") + "\n";
}
function allBytes(directory: string): string {
  if (!existsSync(directory)) return "";
  return readdirSync(directory).map(name => { const path = join(directory, name); return statSync(path).isDirectory() ? allBytes(path) : readFileSync(path, "utf8"); }).join("\n");
}
const cleanup = () => ({ readsClosed: true, clientAbsent: true, sidecarsAbsent: true, networkAbsent: true, sessionRemoved: true, independentlyObserved: true });
const ready = () => ({ catalog: PRIVATE_STREAM_CANARY_POLICY.catalog, containment: PRIVATE_STREAM_CANARY_POLICY.containment,
  servedIdentityCapture: true, providerAccounting: true, session: PRIVATE_STREAM_CANARY_POLICY.session });
const complete = () => ({ catalog: PRIVATE_STREAM_CANARY_POLICY.catalog, providerCalls: 2 as number | null,
  servedIdentity: { model: "gpt-5.6-sol", effort: "low", version: "synthetic-version", provenance: "independently-authenticated-provider-metadata", evidenceSha256: sha("synthetic-independent-evidence") },
  usage: { inputTokens: 100, outputTokens: 20, reasoningOutputTokens: 10 } });
function fixture(t: { after(fn: () => void): void }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dispatcher-synthetic-"))); t.after(() => rmSync(root, { recursive: true, force: true }));
  const stateDirectory = join(root, "attempt"), evidenceDirectory = join(root, "preflight");
  const binding: DispatcherBinding = { publicCommit: "a".repeat(40), privateCommit: "b".repeat(40), sourceSha256: sha("source"), privateFreezeSha256: sha("freeze"),
    contractSha256: ACCEPTED_CANARY_CONTRACT.sha256, image: PRIVATE_STREAM_CANARY_IMAGE.image, stateDirectorySha256: sha(stateDirectory), observerKeySha256: sha("key"), runtimeInputsSha256: sha("inputs") };
  const gate = { kind: "private-stream-dispatcher-gate-v1", binding, verdict: "PASS",
    reviewer: { model: "gpt-6-astra", effort: "medium", independent: true, identifier: "/root/synthetic_reviewer" }, blockingFindings: [], scope: "one-private-stream-canary-only" };
  const calls: string[] = []; let now = 0, alarm: (() => void) | undefined, drift = false;
  const runtime: DispatcherRuntime = {
    async session(signal) { assert.equal(signal.aborted, false); calls.push("session"); return { sessionIdentitySha256: sha("session"), cliVersion: "0.152.0", authenticated: true }; },
    async prepare(signal, read) { calls.push("prepare"); read(() => assert.equal(signal.aborted, false)); },
    async launch(signal) { calls.push("launch"); assert.equal(signal.aborted, false); assert.ok(existsSync(join(stateDirectory, "start.json"))); return stream(); },
    closeReads() { calls.push("close-reads"); }, async kill() { calls.push("kill"); }, async cleanup() { calls.push("cleanup"); return cleanup(); },
  };
  const gateBytes = Buffer.from(JSON.stringify(gate));
  const options: DispatcherOptions = { binding, stateDirectory, evidenceDirectory, gate: gateBytes, gateSha256: sha(gateBytes), executionClass: "synthetic",
    observeBinding() { if (drift) throw new Error("source changed"); }, runtime: () => runtime,
    observer: async phase => phase === "ready" ? ready() : complete(),
    clock: { now: () => now, arm(callback, ms) { assert.equal(ms, 1_200_000); calls.push("deadline-start"); alarm = callback; return () => { alarm = undefined; }; } } };
  return { root, stateDirectory, evidenceDirectory, binding, gate, gateBytes, calls, runtime, options,
    create: () => createPrivateStreamDispatcher(options), expire() { now = 1_200_000; alarm?.(); }, drift() { drift = true; } };
}

test("new source closure is additive and production image remains unchanged", () => {
  const source = dispatcherSource(process.cwd()); assert.equal(source.sha256, digest(source.files));
  assert.ok(source.files.some(file => file.path === "scripts/evidence/private-stream-dispatcher-v1.ts"));
  assert.notEqual(ACCEPTED_EVAL_RUNTIME_IMAGE, PRIVATE_STREAM_CANARY_IMAGE.image);
  assert.equal(ACCEPTED_CANARY_CONTRACT.commit, "c5a8981f0e500b4ad45798b19729026486e3d49e");
});
test("safe preflight checks and closes runtime without capability, launch or execution directory", async t => {
  const f = fixture(t), dispatcher = f.create();
  const result = await dispatcher.preflight(); assert.equal(result.providerCalls, 0); assert.equal(result.executionReady, false);
  assert.equal(result.capabilityIssued, false); assert.equal(existsSync(f.stateDirectory), false);
  await dispatcher.closePreflight(); assert.equal(existsSync(f.stateDirectory), false);
  assert.equal(f.calls[0], "deadline-start"); assert.ok(!f.calls.includes("launch")); assert.ok(f.calls.includes("cleanup"));
  assert.throws(() => dispatcher.issueCapability());
});
test("exact synthetic successful attempt consumes once and preserves all typed evidence", async t => {
  const f = fixture(t), d = f.create(); await d.preflight(); const token = d.issueCapability();
  assert.throws(() => JSON.stringify(token)); await assert.rejects(d.run({ ...token }));
  const result = await d.run(token); assert.equal(result.status, "infrastructure-evidence-complete");
  assert.equal(result.executionClass, "synthetic"); assert.equal(result.providerCalls, 2); assert.equal(result.clientLaunches, 1);
  assert.equal(result.usage?.reportedAggregateTokens, 120); assert.equal(result.eligibility, "not-eligible");
  assert.equal(result.usage?.cachedInputTokens, 80);
  assert.equal(result.executionReady, false); assert.equal(result.providerAuthorized, false); assert.equal(result.unstartedReviewAttempts, 64);
  assert.equal(result.reviewAttemptsStarted, 0); assert.equal(result.batchAuthorized, false); assert.equal(result.productionAuthorized, false);
  assert.equal(f.calls.filter(v => v === "launch").length, 1); await assert.rejects(d.run(token)); assert.throws(() => d.issueCapability());
  const bytes = allBytes(f.root); assert.ok(!bytes.includes(secret)); assert.ok(!bytes.includes(Buffer.from(secret).toString("base64")));
});
test("restart and crash tombstones deny before session calls", async t => {
  const f = fixture(t); mkdirSync(f.stateDirectory, { mode: 0o700 });
  await assert.rejects(f.create().preflight()); assert.equal(f.calls.includes("session"), false);
  assert.deepEqual(readdirSync(f.stateDirectory), []);
});
test("race between two preflights can reserve only one durable attempt", async t => {
  const f = fixture(t), d1 = f.create(); await d1.preflight(); const t1 = d1.issueCapability();
  f.options.evidenceDirectory = join(f.root, "second"); const d2 = f.create(); await d2.preflight(); const t2 = d2.issueCapability();
  await d1.run(t1); await assert.rejects(d2.run(t2)); await d2.closePreflight();
  assert.equal(f.calls.filter(v => v === "launch").length, 1);
});
test("missing gate and tampered bindings never invoke runtime", async t => {
  for (const field of ["gateSha256", "image", "contractSha256", "sourceSha256", "publicCommit", "privateFreezeSha256", "observerKeySha256", "runtimeInputsSha256"]) {
    const f = fixture(t); if (field === "gateSha256") f.options.gateSha256 = null;
    else (f.binding as unknown as Record<string, unknown>)[field] = "tampered";
    await assert.rejects(f.create().preflight()); assert.equal(f.calls.includes("session"), false);
  }
});
test("old source-contract gate, fake reviewer and widened scope reject even with matching digest", t => {
  const f = fixture(t);
  for (const change of [{ kind: "private-stream-canary-execution-gate-v1" }, { scope: "batch" }, { verdict: "FAIL" },
    { reviewer: { ...f.gate.reviewer, model: "gpt-5.6-sol" } }, { blockingFindings: ["blocking"] }]) {
    const bytes = Buffer.from(JSON.stringify({ ...f.gate, ...change })); assert.throws(() => verifyDispatcherGate(bytes, sha(bytes), f.binding));
  }
});
test("source changes after preflight fail before issuance or launch", async t => {
  const f = fixture(t), d = f.create(); await d.preflight(); f.drift(); assert.throws(() => d.issueCapability());
  assert.equal(existsSync(f.stateDirectory), false); await d.closePreflight();
});
test("wrong session version or authentication, missing catalog and unsigned readiness fail closed", async t => {
  for (const mutation of ["version", "auth", "catalog", "containment", "observer"]) {
    const f = fixture(t);
    if (mutation === "version" || mutation === "auth") f.runtime.session = async () => ({ sessionIdentitySha256: sha("session"), cliVersion: mutation === "version" ? "0.153.0" : "0.152.0", authenticated: mutation !== "auth" });
    else f.options.observer = async () => mutation === "catalog" ? { ...ready(), catalog: { ...ready().catalog, complete: false } }
      : mutation === "containment" ? { ...ready(), containment: {} } : null;
    await assert.rejects(f.create().preflight()); assert.equal(existsSync(f.stateDirectory), false); assert.ok(f.calls.includes("cleanup"));
  }
});
test("deadline includes session preparation and prevents launch", async t => {
  const f = fixture(t); f.runtime.prepare = async signal => { f.expire(); assert.equal(signal.aborted, true); };
  await assert.rejects(f.create().preflight()); assert.ok(f.calls.includes("kill")); assert.ok(f.calls.includes("cleanup")); assert.ok(!f.calls.includes("launch"));
});
test("deadline aborts active launch, kills before awaiting it and waits for uncancelled cleanup", async t => {
  const f = fixture(t); let release: (() => void) | undefined, cleaned = false;
  f.runtime.launch = async signal => { f.calls.push("launch"); await new Promise<void>(resolve => { release = resolve; queueMicrotask(() => f.expire()); }); assert.equal(signal.aborted, true); throw new Error(secret); };
  f.runtime.kill = async () => { f.calls.push("kill"); release?.(); };
  f.runtime.cleanup = async () => { await Promise.resolve(); cleaned = true; f.calls.push("cleanup"); return cleanup(); };
  const d = f.create(); await d.preflight(); const result = await d.run(d.issueCapability());
  assert.equal(result.deadlineExceeded, true); assert.equal(result.status, "failed"); assert.equal(result.providerCalls, null); assert.equal(cleaned, true);
  assert.ok(f.calls.indexOf("kill") > f.calls.indexOf("launch")); assert.ok(!allBytes(f.root).includes(secret));
});
test("cleanup failure retains unknown count, consumed state and no retry", async t => {
  const f = fixture(t); f.runtime.cleanup = async () => { throw new Error(secret); };
  f.runtime.launch = async () => { throw new Error(secret); };
  const d = f.create(); await d.preflight(); const result = await d.run(d.issueCapability());
  assert.equal(result.failure, "cleanup-unproven"); assert.equal(result.providerCalls, null); assert.equal(result.cleanupProven, false);
  assert.equal(result.consumed, true); assert.equal(result.retryAuthorized, false); assert.ok(!allBytes(f.root).includes(secret));
});
test("malformed, extra, missing terminal streams and observer mismatch remain failed", async t => {
  for (const mutation of ["stream", "tokens", "identity", "count", "catalog", "missing-observer"]) {
    const f = fixture(t);
    if (mutation === "stream") f.runtime.launch = async () => stream() + secret;
    else f.options.observer = async phase => {
      if (phase === "ready") return ready();
      if (mutation === "missing-observer") throw new Error(secret);
      const value = complete();
      if (mutation === "tokens") value.usage.outputTokens++;
      if (mutation === "identity") value.servedIdentity.model = "wrong";
      if (mutation === "count") value.providerCalls = -1;
      if (mutation === "catalog") return { ...value, catalog: { ...value.catalog, tools: [] } };
      return value;
    };
    const d = f.create(); await d.preflight(); const result = await d.run(d.issueCapability());
    assert.equal(result.status, "failed"); assert.equal(result.providerCalls, null); assert.equal(result.consumed, true); assert.ok(!allBytes(f.root).includes(secret));
  }
});
test("unknown provider count is null despite one complete client launch", async t => {
  const f = fixture(t); f.options.observer = async phase => phase === "ready" ? ready() : { ...complete(), providerCalls: null };
  const d = f.create(); await d.preflight(); const result = await d.run(d.issueCapability());
  assert.equal(result.clientLaunches, 1); assert.equal(result.providerCalls, null); assert.equal(result.status, "failed");
  assert.equal(result.usage?.reportedAggregateTokens, 120);
});
test("receipt collision preserves previous bytes and fails the consumed attempt", async t => {
  const f = fixture(t), d = f.create(); await d.preflight();
  const path = join(f.evidenceDirectory, "0003-stream.json"); writeFileSync(path, "immutable predecessor", { flag: "wx" });
  const result = await d.run(d.issueCapability());
  assert.equal(result.status, "failed"); assert.equal(result.providerCalls, null); assert.equal(result.consumed, true);
  assert.equal(readFileSync(path, "utf8"), "immutable predecessor"); assert.ok(existsSync(join(f.stateDirectory, "terminal.json")));
});
test("expiry after successful preflight closes resources and never issues a capability", async t => {
  const f = fixture(t), d = f.create(); await d.preflight(); f.expire();
  assert.throws(() => d.issueCapability()); await assert.rejects(d.closePreflight());
  assert.equal(existsSync(f.stateDirectory), false); assert.ok(f.calls.includes("kill")); assert.ok(f.calls.includes("cleanup"));
});
test("configuration/preparation time consumes the same deadline and real mode rejects an injected clock", async t => {
  const f = fixture(t); f.options.startedAt = 0; let armed = 0;
  f.options.clock = { now: () => 250, arm(_callback, ms) { armed = ms; return () => {}; } };
  const d = f.create(); await d.preflight(); assert.equal(armed, 1_199_750); await d.closePreflight();
  assert.throws(() => createPrivateStreamDispatcher({ ...f.options, executionClass: "real" }), /cannot inject a clock/);
});
test("signed observer validates key, nonce, run/source/session binding and signature", t => {
  const f = fixture(t), keys = generateKeyPairSync("ed25519"), publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const challenge = { phase: "complete" as const, nonce: "c".repeat(64), context: { binding: f.binding, runId: "synthetic-run", sessionIdentitySha256: sha("session") } };
  const payload = { kind: "private-stream-observer-v1", ...challenge, observation: complete() };
  const envelope = { payload, signature: sign(null, Buffer.from(canonicalJson(payload)), keys.privateKey).toString("base64") };
  const bytes = Buffer.from(JSON.stringify(envelope));
  assert.deepEqual(verifyObserverEnvelope(bytes, publicKey, sha(publicKey), challenge), complete());
  assert.throws(() => verifyObserverEnvelope(bytes, publicKey, sha("wrong"), challenge));
  assert.throws(() => verifyObserverEnvelope(bytes, publicKey, sha(publicKey), { ...challenge, nonce: "d".repeat(64) }));
  assert.throws(() => verifyObserverEnvelope(bytes, publicKey, sha(publicKey), { ...challenge, context: { ...challenge.context, sessionIdentitySha256: sha("other") } }));
  envelope.payload.observation.providerCalls = 99;
  assert.throws(() => verifyObserverEnvelope(Buffer.from(JSON.stringify(envelope)), publicKey, sha(publicKey), challenge));
});
test("metadata/session adapter uses accepted image, no provider command, isolated env and no credential reads in receipts", async t => {
  const f = fixture(t), directory = join(f.root, "auth"); mkdirSync(directory, { mode: 0o700 });
  writeFileSync(join(directory, "auth.json"), secret, { mode: 0o600 });
  const metadata = observeSessionMetadata(directory); assert.equal(metadata.authenticated, false);
  const calls: string[][] = [], receipts: unknown[] = [];
  const contract = { image: PRIVATE_STREAM_CANARY_IMAGE, scope: { schemaSha256: sha(readFileSync("schemas/canary-status.schema.json")) } } as PrivateStreamCanaryContract;
  const runtime = createPrivateStreamRuntime({ root: process.cwd(), sessionDirectory: directory, mountsRoot: f.root,
    authority: { registrationBytes: "", registrationSha256: "", manifestBytes: "", manifestSha256: "" }, contract }, "00000000-0000-0000-0000-000000000001", f.binding, value => receipts.push(value), () => 1234, async (command, args, options) => {
    assert.equal(command, "docker"); calls.push(args); assert.deepEqual(Object.keys(options!.env!), ["PATH"]); assert.equal(options!.inheritEnv, false);
    assert.equal(options?.timeoutMs, options?.deadlineSignal ? 1234 : 15_000);
    let stdout = "";
    if (args[0] === "image") stdout = JSON.stringify([{ RepoDigests: [PRIVATE_STREAM_CANARY_IMAGE.image], Os: "linux", Architecture: "arm64", Id: ACCEPTED_IMAGE_CONFIGS.arm64, Config: { Env: ["PATH=/usr/bin"], Labels: { "org.opencontainers.image.revision": PRIVATE_STREAM_CANARY_IMAGE.sourceCommit } } }]);
    else if (args.includes("--version")) stdout = "codex-cli 0.152.0\n";
    else if (args.includes("status")) stdout = "Logged in using ChatGPT\n";
    return { stdout, stderr: "", code: 0, timedOut: false };
  });
  assert.equal((await runtime.session(new AbortController().signal)).authenticated, true);
  await assert.rejects(runtime.launch(new AbortController().signal, {}), /permission required/);
  await runtime.cleanup();
  assert.equal(calls.filter(args => args[0] === "run").length, 2);
  for (const args of calls.filter(args => args[0] === "run")) {
    assert.equal(args[args.indexOf("--network") + 1], "none"); assert.equal(args[args.indexOf("--log-driver") + 1], "none");
    assert.ok(args.includes(PRIVATE_STREAM_CANARY_IMAGE.image)); assert.ok(!args.includes("exec")); assert.ok(!args.some(v => v.includes("target=/output")));
  }
  assert.ok(!JSON.stringify(receipts).includes(secret));
});
test("session metadata rejects companions and client observer rejects unsafe inspect", t => {
  const f = fixture(t), dir = join(f.root, "auth"); mkdirSync(dir, { mode: 0o700 }); writeFileSync(join(dir, "auth.json"), secret, { mode: 0o600 });
  writeFileSync(join(dir, "config.toml"), "companion"); assert.throws(() => observeSessionMetadata(dir));
  assert.throws(() => verifyClientInspect("[]", {} as never));
  assert.throws(() => verifyClientInspect(JSON.stringify([{ Config: {}, HostConfig: {} }]), {} as never));
});
test("entrypoint has no implicit action, default capability or route", async () => {
  for (const args of [[], ["--canary"], ["--preflight"], ["--batch"], ["--production"]]) await assert.rejects(privateStreamDispatcherMain(args));
});

test("real adapter lifecycle is fully injected: accepted image, tokenless launch, strict inspect and absence proof", async t => {
  const f = fixture(t), mounts = predictionMountFixture(t), sessionDirectory = join(f.root, "auth");
  mkdirSync(sessionDirectory, { mode: 0o700 }); writeFileSync(join(sessionDirectory, "auth.json"), secret, { mode: 0o600 });
  const scheduled = mounts.manifest.attemptBindings[0]!;
  const contract = { sha256: ACCEPTED_CANARY_CONTRACT.sha256, image: PRIVATE_STREAM_CANARY_IMAGE,
    scope: { schemaSha256: sha(readFileSync("schemas/canary-status.schema.json")), sourceAttemptId: scheduled.id, mountSha256: scheduled.inputDigest } } as PrivateStreamCanaryContract;
  const fake = predictionDockerFixture(async () => { throw new Error("fixture provider path prohibited"); });
  let client: string[] = [], starts = 0, endpoint = "", adapterFailure: unknown; const receipts: unknown[] = [];
  f.options.runtime = (runId, remainingMs) => {
    const adapter = createPrivateStreamRuntime({ root: process.cwd(), sessionDirectory, mountsRoot: mounts.root, authority: mounts.authority, contract }, runId, f.binding, value => receipts.push(value), remainingMs, async (command, args, options) => {
    const ok = (stdout = "") => ({ stdout, stderr: "", code: 0, timedOut: false });
    if (args[0] === "image") return ok(JSON.stringify([{ RepoDigests: [PRIVATE_STREAM_CANARY_IMAGE.image], Os: "linux", Architecture: "arm64", Id: ACCEPTED_IMAGE_CONFIGS.arm64,
      Config: { Env: METHODOLOGY_EGRESS_BASE_ENV, Labels: { "org.opencontainers.image.revision": PRIVATE_STREAM_CANARY_IMAGE.sourceCommit } } }]));
    if (args[0] === "run" && args.includes("codex")) return ok(args.includes("--version") ? "codex-cli 0.152.0\n" : "Logged in using ChatGPT\n");
    if (args[0] === "create") { client = args; return ok("c".repeat(64)); }
    if (args[0] === "start") {
      starts++; assert.ok(options?.deadlineSignal); assert.equal(sha(options?.stdin ?? ""), PRIVATE_STREAM_CANARY_POLICY.promptSha256);
      const init = await predictionHttpCall(endpoint, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: REVIEW_READ_MCP_PROTOCOL,
        capabilities: {}, clientInfo: { name: "synthetic-adapter-client", version: "1" } } });
      const headers = { "Mcp-Session-Id": init.headers["mcp-session-id"] as string, "MCP-Protocol-Version": REVIEW_READ_MCP_PROTOCOL };
      await predictionHttpCall(endpoint, { jsonrpc: "2.0", method: "notifications/initialized" }, headers);
      const rows: unknown[] = [{ type: "thread.started", thread_id: "synthetic" }, { type: "turn.started" }];
      for (const [tool, input] of [["list_tree", {}], ["read_file", { path: "review.diff" }], ["search_text", { query: "value" }], ["read_link", { path: "head/link" }]] as const) {
        const result = await predictionHttpCall(endpoint, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: input } }, headers);
        const item = { id: tool, type: "mcp_tool_call", server: "source_read", tool, arguments: input };
        rows.push({ type: "item.started", item }, { type: "item.completed", item: { ...item, result: result.body.result } });
      }
      rows.push({ type: "item.completed", item: { id: "final", type: "agent_message", text: JSON.stringify({ status: "completed", tools:
        { list_tree: "succeeded", read_file: "succeeded", search_text: "succeeded", read_link: "literal-link-read" } }) } },
        { type: "turn.completed", usage: { input_tokens: 100, output_tokens: 20, reasoning_output_tokens: 10 } });
      return ok(rows.map(row => JSON.stringify(row)).join("\n") + "\n");
    }
    if (args[0] === "inspect" && args[1]!.startsWith("peregrine-eval-")) {
      const flags = (flag: string) => client.flatMap((v, i) => v === flag ? [client[i + 1]!] : []);
      const network = flags("--network")[0]!, [uid, gid] = flags("--user")[0]!.split(":").map(Number);
      const bindings = flags("--mount").map(value => Object.fromEntries(value.split(",").map(field => field.split("="))));
      const h = sidecarHostFixture(network); h.PidsLimit = 256; h.LogConfig = { Type: "none", Config: {} };
      h.Tmpfs = Object.fromEntries(flags("--tmpfs").map(value => { const at = value.indexOf(":"); return [value.slice(0, at), value.slice(at + 1)]; }));
      h.Mounts = bindings.map(v => ({ Type: "bind", Source: v.source, Target: v.target, ReadOnly: true }));
      return ok(JSON.stringify([{ Name: "/" + args[1], Image: ACCEPTED_IMAGE_CONFIGS.arm64,
        Config: { Image: PRIVATE_STREAM_CANARY_IMAGE.image, Cmd: client.slice(client.indexOf(PRIVATE_STREAM_CANARY_IMAGE.image) + 1), User: `${uid}:${gid}`,
          WorkingDir: "/workspace", Entrypoint: ["codex"], Env: [...METHODOLOGY_EGRESS_BASE_ENV, ...flags("--env")] },
        State: { Status: "created", Running: false }, HostConfig: h, NetworkSettings: { Networks: { [network]: {} } },
        Mounts: bindings.map(v => ({ Type: "bind", Source: v.source, Destination: v.target, RW: false, Propagation: "rprivate" })) }]));
    }
    if (args[0] === "run" && args.some(v => v.startsWith("MCP_FORWARDER_UPSTREAM_PORT="))) {
      const value = (key: string) => args.find(v => v.startsWith(key + "="))!.slice(key.length + 1);
      endpoint = `http://host.docker.internal:${value("MCP_FORWARDER_UPSTREAM_PORT")}/mcp/${value("MCP_FORWARDER_TOKEN")}`;
    }
    const result = await fake.run(command, args, options);
    if (args[0] === "inspect") {
      const values = JSON.parse(result.stdout).filter((v: any) => v.Name === "/" + args[1]);
      for (const value of values) { value.Image = ACCEPTED_IMAGE_CONFIGS.arm64; value.Config.Image = PRIVATE_STREAM_CANARY_IMAGE.image; value.Config.Labels["org.opencontainers.image.revision"] = PRIVATE_STREAM_CANARY_IMAGE.sourceCommit; }
      return ok(JSON.stringify(values));
    }
    return result;
    });
    return { ...adapter, async launch(...args) { try { return await adapter.launch(...args); } catch (error) { adapterFailure = error; throw error; } } };
  };
  const d = f.create(); await d.preflight(); assert.equal(existsSync(f.stateDirectory), false);
  const outcome = await d.run(d.issueCapability()); assert.equal(outcome.status, "infrastructure-evidence-complete", String(adapterFailure)); assert.equal(starts, 1);
  assert.ok(client.includes(PRIVATE_STREAM_CANARY_IMAGE.image)); assert.ok(client.includes('mcp_servers.source_read.url="http://mcp-forwarder:8082/mcp"'));
  assert.ok(!client.some(value => value.includes("target=/output") || value.includes("MCP_FORWARDER_TOKEN")));
  assert.ok(fake.calls.filter(c => ["rm", "ps"].includes(c.args[0]!)).every(c => !c.signal));
  assert.ok(!JSON.stringify(receipts).includes(secret)); assert.ok(!JSON.stringify(receipts).includes(Buffer.from(secret).toString("base64")));
});
