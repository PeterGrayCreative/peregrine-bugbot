import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { digest, sha } from "../eval/prediction-contract.js";
import { createPredictionCaseReader } from "../eval/prediction-mounts.js";
import { preparePredictionDryRun, persistPredictionDryRun, verifyPredictionDryRun } from "../eval/prediction-preparation.js";
import { predictionMountFixture as fixture } from "./eval-prediction-mount-fixture.js";

test("zero-provider preparation reconstructs all prompts, one-case read probes and missing execution outcomes", async t => {
  const f = fixture(t), result = await preparePredictionDryRun(f.authority, f.root);
  assert.equal(result.lifecycle.length, 64);
  assert.equal(result.providerCalls, 0); assert.equal(result.executionReady, false); assert.equal(result.providerAuthorized, false);
  assert.equal(result.preparation.plan.requestedRoute.version, null);
  assert.ok(result.adapterProbe.run.attempts.every(a => a.status === "missing"));
  assert.ok(result.lifecycle.every(a => a.terminal.readProbe.calls === 1 && a.terminal.readProbe.closed));
  for (const c of result.preparation.plan.cases) {
    assert.equal(c.prompts.A.rawScopeSha256, c.prompts.B.rawScopeSha256);
    assert.equal(c.prompts.A.methodSourceSha256, null); assert.ok(c.prompts.B.methodSourceSha256);
    assert.ok(!c.prompts.A.prompt.includes("Synthetic bounded contract"));
    assert.ok(!c.prompts.A.prompt.includes("PEREGRINE_ROLE"));
  }
  await verifyPredictionDryRun(result, f.authority, f.root);
  const changed = structuredClone(result); changed.preparation.plan.cases[0]!.prompts.A.prompt += "Injected method";
  changed.sha256 = digest(changed);
  await assert.rejects(verifyPredictionDryRun(changed, f.authority, f.root), /authenticated reconstruction/);
});

test("one-case reader refuses traversal, other cases, process tools and symlink following, while preserving literal link text", t => {
  const f = fixture(t), reader = createPredictionCaseReader(f.firstRoot, f.first);
  for (const [tool, args] of [["read_file", { path: "../other-case/head/index.ts" }], ["read_file", { path: "/etc/passwd" }], ["shell", { command: "pwd" }], ["read_file", { path: "head/link" }]] as const) {
    assert.equal(JSON.parse(reader.call(tool, args)).status, "incomplete");
  }
  assert.deepEqual(JSON.parse(reader.call("read_link", { path: "head/link" })), { kind: "literal-symlink-source", target: "index.ts", followed: false });
  assert.equal(reader.snapshot().calls, 5);
  reader.close(); assert.throws(() => reader.call("read_file", { path: "head/index.ts" }), /closed/);
  writeFileSync(join(f.firstRoot, "curator-prediction.json"), "leaked answer");
  assert.throws(() => createPredictionCaseReader(f.firstRoot, f.first), /unexpected source file/);
});

test("100-call and cumulative returned-byte caps include failed calls and close before excess bytes are delivered", t => {
  const f = fixture(t, true), calls = createPredictionCaseReader(f.firstRoot, f.first);
  for (let i = 0; i < 100; i++) calls.call("forbidden", {});
  assert.equal(calls.snapshot().calls, 100); assert.ok(calls.snapshot().events.every(e => e.status === "failed"));
  assert.throws(() => calls.call("list_tree", {}), /call budget exhausted/);
  const bytes = createPredictionCaseReader(f.firstRoot, f.first);
  assert.equal(JSON.parse(bytes.call("read_file", { path: "head/large.txt" })).text.length, 1_100_000);
  assert.throws(() => bytes.call("read_file", { path: "head/large.txt" }), /response withheld/);
  assert.equal(bytes.snapshot().closed, true); assert.equal(bytes.snapshot().events[1]!.status, "over-budget");
});

test("manifest/source tampering cannot be repaired by resealing its own digest", async t => {
  const f = fixture(t), tampered = structuredClone(f.manifest);
  tampered.cases[0]!.context = [{ path: "context/answer" }] as never[];
  const changed = JSON.stringify(tampered);
  await assert.rejects(preparePredictionDryRun({ ...f.authority, manifestBytes: changed }, f.root), /trusted mount manifest digest/);
  await assert.rejects(preparePredictionDryRun({ ...f.authority, manifestBytes: changed, manifestSha256: sha(changed) }, f.root), /context prohibited/);
  unlinkSync(join(f.firstRoot, "head/index.ts")); symlinkSync("../../outside", join(f.firstRoot, "head/index.ts"));
  assert.throws(() => createPredictionCaseReader(f.firstRoot, f.first), /type\/mode\/link drift/);
});

test("create-only preparation preserves completed records and later failed attempts", async t => {
  const f = fixture(t), destination = join(f.root, "evidence-attempt-1");
  const result = await persistPredictionDryRun(destination, f.authority, f.root);
  assert.equal(JSON.parse(readFileSync(join(destination, "terminal.json"), "utf8")).artifactSha256, result.sha256);
  const before = readFileSync(join(destination, `${result.sha256}.json`));
  await assert.rejects(persistPredictionDryRun(destination, f.authority, f.root), /EEXIST/);
  assert.deepEqual(readFileSync(join(destination, `${result.sha256}.json`)), before);
  writeFileSync(join(f.firstRoot, "review.diff"), "source drift");
  const failed = join(f.root, "evidence-attempt-2");
  await assert.rejects(persistPredictionDryRun(failed, f.authority, f.root), /source changed|bytes drift/);
  assert.equal(JSON.parse(readFileSync(join(failed, "failure.json"), "utf8")).status, "preparation-failed");
  assert.equal(JSON.parse(readFileSync(join(failed, "start.json"), "utf8")).providerCalls, 0);
});
