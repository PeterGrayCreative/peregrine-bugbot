import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exec } from "../src/util/exec.js";
import { digest, sha } from "../eval/prediction-contract.js";
import { createStructuralSafeCanary, preparePredictionSafeCanary, requireSafeCanaryProviderDispatch, SAFE_CANARY_ID } from "../eval/prediction-safe-canary.js";
import { reduceSafeCanaryStream, SAFE_CANARY_STREAM_BYTES, SAFE_CANARY_TOOLS } from "../eval/prediction-safe-canary-stream.js";
import { predictionSafeCanaryCommand, validatePredictionSafeCanaryCommand, SAFE_CANARY_MCP_URL } from "../eval/prediction-safe-canary-command.js";
import { observePrivatePredictionExec } from "../eval/prediction-private-mechanical-evidence.js";
import { privateResultBinding } from "../eval/prediction-typed-evidence.js";
import { assessPrivatePredictionReceipts } from "../eval/prediction-private-receipts.js";
import { predictionSolLowFixture } from "./eval-prediction-sol-low-canary-fixture.js";
import { predictionDockerFixture } from "./eval-prediction-cli-bridge-fixture.js";

const token = "93a9b4dc0f2e65817aa305de92bff01873a9b4dc0f2e65817aa305de92bff019";
const encodings = (value: string) => [value, Buffer.from(value).toString("base64"), Buffer.from(value).toString("hex"),
  [...value].map(c => "%" + c.charCodeAt(0).toString(16)).join(""), [...value].map(c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")).join(""), value.split("").reverse().join("")];
const output = { status: "completed", tools: { list_tree: "succeeded", read_file: "succeeded", search_text: "succeeded", read_link: "refused-no-link" } };
function events(secret = "synthetic") {
  const rows: any[] = [{ type: "thread.started", thread_id: secret }, { type: "turn.started" }];
  for (const type of ["item.started", "item.completed"]) rows.push({ type, item: { id: "reasoning", type: "reasoning", text: secret } });
  for (const tool of SAFE_CANARY_TOOLS) {
    const item = { id: tool, type: "mcp_tool_call", server: "source_read", tool, arguments: { path: secret } };
    rows.push({ type: "item.started", item }, { type: "item.completed", item: { ...item, result: { content: [{ type: "text", text: secret }] } } });
  }
  rows.push({ type: "item.completed", item: { id: "final", type: "agent_message", text: JSON.stringify(output) } });
  rows.push({ type: "turn.completed", usage: { input_tokens: 20, cached_input_tokens: 1, output_tokens: 5 } });
  return rows;
}
const jsonl = (rows: any[]) => rows.map(r => JSON.stringify(r)).join("\n") + "\n";
function disk(directory: string): string {
  if (!existsSync(directory)) return "";
  return readdirSync(directory).map(name => { const path = join(directory, name); return statSync(path).isDirectory() ? disk(path) : readFileSync(path, "utf8"); }).join("\n");
}
function noSecrets(directory: string, secrets: string[]) { for (const secret of secrets) assert.equal(disk(directory).includes(secret), false, "producer string reached disk"); }

test("file-free exact command fixes the public endpoint and rejects output/companion/route flags", () => {
  const args = predictionSafeCanaryCommand(); validatePredictionSafeCanaryCommand(args);
  assert.equal(args.includes("--output-last-message"), false); assert.ok(args.includes("--output-schema"));
  assert.ok(args.includes(`mcp_servers.source_read.url=${JSON.stringify(SAFE_CANARY_MCP_URL)}`));
  for (const extra of [["--output-last-message", "/host/result"], ["--output-schema", "/auth.json"], ["--mount", "source=/,target=/host"], ["--model", "other"], ["--resume", "previous"]]) {
    assert.throws(() => validatePredictionSafeCanaryCommand([...args, ...extra]), /exact/);
  }
  assert.throws(() => requireSafeCanaryProviderDispatch({ authorization: true }), /unavailable/);
});

test("strict enum stream drops every free-text representation and preserves only typed usage", () => {
  for (const encoded of encodings(token)) {
    const reduced = reduceSafeCanaryStream(jsonl(events(encoded)));
    assert.deepEqual(reduced.output, output); assert.equal(reduced.tokens.status, "known");
    for (const secret of encodings(token)) assert.equal(JSON.stringify(reduced).includes(secret), false);
  }
});

test("stream rejects malformed/extra/duplicate/unfinished/identity/terminal/accounting profiles", () => {
  const attacks: ((rows: any[]) => void)[] = [
    r => { r.at(-2).item.text = JSON.stringify({ ...output, note: token }); },
    r => { r.at(-2).item.text = token; }, r => { r.at(-2).item.text = JSON.stringify({ ...output, status: "other" }); },
    r => { r.at(-2).item.text = JSON.stringify({ status: "completed", tools: { ...output.tools, read_file: "unavailable" } }); },
    r => { r.splice(1, 1); }, r => { r.splice(1, 0, { type: "turn.started" }); },
    r => { r.splice(-1, 0, structuredClone(r.at(-2))); }, r => { r.splice(3, 1); },
    r => { r[4].item.id = "reasoning"; }, r => { r[5].item.tool = "read_link"; },
    r => { r[5].item.server = "shell"; }, r => { r[2].item.type = "command_execution"; },
    r => { r.at(-1).usage.cached_input_tokens = 21; }, r => { r.at(-1).usage.reasoning_output_tokens = 6; },
    r => { delete r.at(-1).usage; }, r => { r.at(-1).usage.output_tokens = -1; },
    r => { r.at(-1).extra = token; }, r => { r[0].extra = token; }, r => { r.splice(4, 2); },
  ];
  for (const attack of attacks) { const rows = events(); attack(rows); assert.throws(() => reduceSafeCanaryStream(jsonl(rows))); }
  assert.throws(() => reduceSafeCanaryStream("x".repeat(SAFE_CANARY_STREAM_BYTES + 1)), /bound/);
  assert.throws(() => reduceSafeCanaryStream(jsonl(events()) + token), /malformed/);
});

test("private mechanical receipts never persist raw args, streams, arbitrary results or nested failures on disk", async t => {
  const root = mkdtempSync(join(tmpdir(), "typed-receipts-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  let ordinal = 0;
  for (const encoded of encodings(token)) for (const fail of [false, true]) {
    const directory = join(root, String(++ordinal)), binding = { runId: "synthetic", attemptId: SAFE_CANARY_ID, scopeSha256: sha("scope"), sourceSha256: sha("source"), channel: "client" as const };
    const run = observePrivatePredictionExec(directory, binding, { policySha256: sha("policy"), validate: (_args, result) => { privateResultBinding(result); },
      run: async () => { noSecrets(root, encodings(token)); if (fail) throw new AggregateError([new Error(encoded, { cause: new Error(encoded) })], encoded);
        return { stdout: encoded, stderr: encoded, code: 0, timedOut: false, arbitrary: { secret: encoded } }; } });
    if (fail) await assert.rejects(run("docker", ["run", "--env", "MCP_FORWARDER_TOKEN=" + token], { env: { MCP_FORWARDER_TOKEN: token } }), /private execution failed/);
    else await run("docker", ["run", "--env", "MCP_FORWARDER_TOKEN=" + token], { env: { MCP_FORWARDER_TOKEN: token } });
    noSecrets(root, encodings(token));
  }
});

test("start persistence failure prevents non-cleanup dispatch but still attempts mandatory cleanup", async t => {
  const root = mkdtempSync(join(tmpdir(), "private-collision-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const cleanup of [false, true]) {
    let calls = 0; const directory = join(root, String(cleanup));
    const run = observePrivatePredictionExec(directory, { runId: "collision", attemptId: SAFE_CANARY_ID, scopeSha256: sha("s"), sourceSha256: sha("p"), channel: "client" },
      { policySha256: sha("p"), validate: () => {}, run: async () => { calls++; return { stdout: token, stderr: token, code: 0, timedOut: false }; } });
    writeFileSync(join(directory, "000001-start.json"), "preexisting");
    await assert.rejects(run("docker", cleanup ? ["rm", "--force", "synthetic"] : ["run", "synthetic"]));
    assert.equal(calls, cleanup ? 1 : 0); noSecrets(root, encodings(token));
  }
});

test("opt-in process capture bounds combined bytes and rejects broken UTF8; default capture stays unchanged", async () => {
  const huge = await exec(process.execPath, ["-e", "process.stdout.write('x'.repeat(100000));process.stderr.write('y'.repeat(100000))"], { maximumOutputBytes: 4096, timeoutMs: 2000 });
  assert.equal(huge.outputLimitExceeded, true); assert.ok(Buffer.byteLength(huge.stdout) + Buffer.byteLength(huge.stderr) <= 4096);
  const utf8 = await exec(process.execPath, ["-e", "process.stdout.write(Buffer.from([0xff]))"], { maximumOutputBytes: 4096, timeoutMs: 2000 });
  assert.equal(utf8.outputLimitExceeded, true); assert.equal(utf8.stdout, "");
  const ordinary = await exec(process.execPath, ["-e", "process.stdout.write('ok')"], { timeoutMs: 2000 }); assert.equal(ordinary.stdout, "ok"); assert.equal(Object.hasOwn(ordinary, "outputLimitExceeded"), false);
});

test("structural safe canary uses existing containment, one-use authority and no host provider output", async t => {
  const f = await predictionSolLowFixture(t), directory = join(f.root, "safe"), registration = await preparePredictionSafeCanary(f.options.authority, f.root);
  let client = 0, liveToken = "";
  const fake = predictionDockerFixture(async (args, options, endpoint) => {
    client++; liveToken = new URL(endpoint).pathname.slice(5); noSecrets(directory, encodings(liveToken));
    assert.equal(args.some(v => v.includes(liveToken)), false); assert.equal(args.includes("--output-last-message"), false);
    assert.equal(args.some(v => v.includes("target=/output")), false);
    assert.ok(args.filter((v, i) => args[i - 1] === "--mount").every(v => v.endsWith(",readonly")));
    assert.ok(options?.deadlineSignal); assert.equal((options as any).maximumOutputBytes, SAFE_CANARY_STREAM_BYTES);
    return { stdout: jsonl(events(encodings(liveToken).join("|"))), stderr: encodings(liveToken).join("|"), code: 0, timedOut: false, extra: liveToken };
  });
  const harness = await createStructuralSafeCanary({ ...f.options, registration, directory, run: fake.run });
  assert.equal(existsSync(directory), false); assert.throws(() => harness.authorizeSynthetic(f.pack.preauthorization.attempts[0]!.id));
  await assert.rejects(harness.run({})); const capability = harness.authorizeSynthetic(SAFE_CANARY_ID); assert.throws(() => JSON.stringify(capability));
  await assert.rejects(harness.run({ ...capability }));
  const result = await harness.run(capability);
  assert.equal(result.status, "synthetic-completed", JSON.stringify(result.failure)); assert.equal(client, 1);
  assert.equal(result.eligibility, "not-eligible"); assert.equal(result.unstartedReviewAttempts, 64); assert.equal(result.providerAuthorized, false);
  assert.equal(existsSync(join(directory, "never-mounted-output")), false); noSecrets(directory, encodings(liveToken));
  assert.ok(fake.calls.filter(c => ["stop", "rm", "ps"].includes(c.args[0]!)).every(c => !c.signal));
  const artifacts = readdirSync(join(directory, "mechanical")).map(name => ({ path: "mechanical/" + name, bytes: readFileSync(join(directory, "mechanical", name), "utf8") }));
  const inventory = artifacts.map(a => ({ path: a.path, bytes: Buffer.byteLength(a.bytes), sha256: sha(a.bytes) }));
  const receiptInput = { artifacts, inventory, inventorySha256: digest(inventory), binding: { ...result.binding, channel: "client" as const }, policySha256: registration.sha256, deadline: result.deadline };
  const assessment = assessPrivatePredictionReceipts(receiptInput);
  assert.equal(assessment.metadataIntegrity, "PASS", JSON.stringify(assessment.failure)); assert.equal(assessment.eligibility, "not-eligible");
  const attacks: ((v: typeof receiptInput) => void)[] = [
    v => { v.artifacts.pop(); }, v => { v.artifacts.push(v.artifacts[0]!); }, v => { v.artifacts[0]!.bytes += " "; },
    v => { v.inventorySha256 = sha("other"); }, v => { v.binding.runId = "other"; }, v => { v.policySha256 = sha("other"); },
  ];
  for (const attack of attacks) { const changed = structuredClone(receiptInput); attack(changed); assert.equal(assessPrivatePredictionReceipts(changed).metadataIntegrity, "FAIL"); }
  for (const mutate of [
    (v: any) => { v.args = [token]; }, (v: any) => { v.binding.runId = "other"; },
    (v: any) => { v.clock.timeOriginMs += 1; }, (v: any) => { v.phase = "teardown"; },
    (v: any) => { v.sequence++; }, (v: any) => { v.invocation.argv.raw = token; },
  ]) {
    const changed = structuredClone(receiptInput), first = changed.artifacts[0]!, parsed = JSON.parse(first.bytes); mutate(parsed); first.bytes = JSON.stringify(parsed);
    changed.inventory = changed.artifacts.map(a => ({ path: a.path, bytes: Buffer.byteLength(a.bytes), sha256: sha(a.bytes) })); changed.inventorySha256 = digest(changed.inventory);
    assert.equal(assessPrivatePredictionReceipts(changed).metadataIntegrity, "FAIL");
  }
  await assert.rejects(harness.run(capability)); assert.equal(client, 1);
});

test("deadline cancellation reaches file-free client; nested failure streams never reach disk and cleanup is uncancelled", async t => {
  const f = await predictionSolLowFixture(t), registration = await preparePredictionSafeCanary(f.options.authority, f.root), directory = join(f.root, "deadline-safe");
  let invoked = 0, aborted = false;
  const fake = predictionDockerFixture(async (_args, options) => {
    invoked++;
    await new Promise<void>(resolve => { if (options!.deadlineSignal!.aborted) resolve(); else options!.deadlineSignal!.addEventListener("abort", () => resolve(), { once: true }); });
    aborted = true;
    throw new AggregateError([new Error(encodings(token)[1], { cause: new Error(encodings(token)[2]) })], encodings(token)[4]);
  });
  const harness = await createStructuralSafeCanary({ ...f.options, registration, directory, run: fake.run, wallMs: 1000 });
  const keepAlive = setTimeout(() => {}, 3000);
  try {
    const result = await harness.run(harness.authorizeSynthetic(SAFE_CANARY_ID));
    assert.equal(invoked, 1); assert.equal(aborted, true); assert.equal(result.status, "failed"); assert.equal(result.deadline.deadlineExceeded, true);
    assert.equal(result.deadline.teardownCompleted, false); assert.ok(result.deadline.cleanupError);
    assert.ok(fake.calls.filter(c => ["stop", "rm", "ps"].includes(c.args[0]!)).every(c => !c.signal));
    assert.ok(fake.calls.some(c => c.args[0] === "network" && c.args[1] === "rm")); noSecrets(directory, encodings(token));
    assert.equal(existsSync(join(directory, "output.json")), false);
  } finally { clearTimeout(keepAlive); }
});

test("cross-run/copied authority and resealed route/scope/authorization changes reject without execution state", async t => {
  const f = await predictionSolLowFixture(t), registration = await preparePredictionSafeCanary(f.options.authority, f.root);
  let calls = 0; const run = async () => { calls++; throw new Error("must not execute"); };
  const first = await createStructuralSafeCanary({ ...f.options, registration, directory: join(f.root, "one"), run });
  const second = await createStructuralSafeCanary({ ...f.options, registration, directory: join(f.root, "two"), run });
  await assert.rejects(second.run(first.authorizeSynthetic(SAFE_CANARY_ID))); assert.equal(calls, 0);
  for (const mutate of [(v: any) => { v.route.reasoningEffort = "high"; }, (v: any) => { v.mountSha256 = sha("other"); }, (v: any) => { v.authorization = true; }]) {
    const changed = structuredClone(registration); mutate(changed); const { sha256: _, ...body } = changed; changed.sha256 = digest(body);
    await assert.rejects(createStructuralSafeCanary({ ...f.options, registration: changed, directory: join(f.root, "changed"), run }), /tamper/);
  }
  assert.equal(calls, 0); for (const path of ["one", "two", "changed"]) assert.equal(existsSync(join(f.root, path)), false);
});

test("invalid provider status retains hashes only, including encoded diagnostics and companion schema fields", async t => {
  const f = await predictionSolLowFixture(t), registration = await preparePredictionSafeCanary(f.options.authority, f.root);
  for (const [index, encoded] of encodings(token).entries()) {
    const directory = join(f.root, `failure-${index}`), fake = predictionDockerFixture(async () => {
      const rows = events(encoded); rows.at(-2).item.text = JSON.stringify({ ...output, companionFile: encoded });
      noSecrets(directory, encodings(token)); return { stdout: jsonl(rows), stderr: encoded, code: 0, timedOut: false, extra: encoded };
    });
    const harness = await createStructuralSafeCanary({ ...f.options, registration, directory, run: fake.run });
    const result = await harness.run(harness.authorizeSynthetic(SAFE_CANARY_ID));
    assert.equal(result.status, "failed"); assert.equal(result.deadline.teardownCompleted, true);
    assert.equal(existsSync(join(directory, "output.json")), false); assert.equal(existsSync(join(directory, "never-mounted-output")), false);
    noSecrets(directory, encodings(token));
  }
});
