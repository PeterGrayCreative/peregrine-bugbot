import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syntheticRegistration } from "./eval-prediction-fixture.js";
import { digest, sha } from "../eval/prediction-contract.js";
import { bindPredictionRegistration } from "../eval/prediction-plan.js";
import { bindPredictionMounts, createPredictionCaseReader, type PredictionMountEntry } from "../eval/prediction-mounts.js";
import { preparePredictionDryRun, persistPredictionDryRun, verifyPredictionDryRun } from "../eval/prediction-preparation.js";

function fixture(t: TestContext, large = false) {
  const root = mkdtempSync(join(tmpdir(), "prediction-preparation-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registration = syntheticRegistration(), registrationBytes = JSON.stringify(registration);
  const file = (path: string, content: string, mode: PredictionMountEntry["mode"] = "100644"): PredictionMountEntry => ({ path, mode, oid: "a".repeat(40), bytes: Buffer.byteLength(content), sha256: sha(content) });
  const diff = "diff --git a/index.ts b/index.ts\n--- a/index.ts\n+++ b/index.ts\n@@ -1 +1 @@\n-export const value = 0;\n+export const value = 1;\n";
  const cases = registration.cases.filter(c => c.included).map((c, index) => {
    const reviewerId = `item-${index.toString(16).padStart(16, "0")}`;
    const directory = join(root, reviewerId); mkdirSync(join(directory, "head"), { recursive: true });
    const content = "export const value = 1;\n", license = "MIT synthetic fixture\n", big = "x".repeat(1_100_000);
    writeFileSync(join(directory, "head/index.ts"), content, { mode: 0o644 });
    writeFileSync(join(directory, "head/LICENSE"), license, { mode: 0o644 });
    symlinkSync("index.ts", join(directory, "head/link"));
    if (large) writeFileSync(join(directory, "head/large.txt"), big, { mode: 0o644 });
    writeFileSync(join(directory, "review.diff"), diff, { mode: 0o644 });
    const head = [file("LICENSE", license), file("index.ts", content), file("link", "index.ts", "120000"), ...(large ? [file("large.txt", big)] : [])];
    const base = head.map(e => e.path === "index.ts" ? file("index.ts", "export const value = 0;\n") : e);
    const allowedFiles: PredictionMountEntry[] = [...head.map(e => ({ ...e, path: `head/${e.path}` })), { path: "review.diff", mode: "100644" as const, bytes: Buffer.byteLength(diff), sha256: sha(diff) }].sort((a,b) => a.path.localeCompare(b.path, "en"));
    return { caseId: c.caseId, reviewerId, base: "a".repeat(40), head: "b".repeat(40), baseTree: "c".repeat(40), headTree: "d".repeat(40), context: [], inventories: { base, head }, allowedFiles,
      diff: { bytes: Buffer.byteLength(diff), sha256: sha(diff) }, inputDigest: sha(`${JSON.stringify(allowedFiles, null, 2)}\n`) };
  });
  const manifest = { registrationSha256: sha(registrationBytes), mountVersion: 2, contextPolicy: "none-for-every-case", cases,
    attemptBindings: registration.schedule.map(a => { const c = cases.find(c => c.caseId === a.caseId)!; return { id: a.id, reviewerId: c.reviewerId, inputDigest: c.inputDigest }; }) };
  const manifestBytes = JSON.stringify(manifest);
  const conditionsBytes = JSON.stringify(registration.cases.filter(c => c.included).map(c => ({ caseId: c.caseId, contract: c.contract, conditions: [{ id: "bounded-condition", text: c.contract }] })));
  const authority = { registrationBytes, registrationSha256: sha(registrationBytes), manifestBytes, manifestSha256: sha(manifestBytes), conditionsBytes, conditionsSha256: sha(conditionsBytes) };
  const mounts = bindPredictionMounts(manifestBytes, authority.manifestSha256, bindPredictionRegistration(registrationBytes, authority.registrationSha256));
  return { root, authority, mounts, manifest, firstRoot: join(root, cases[0]!.reviewerId), first: mounts[0]! };
}

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
