import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import {
  compileHistoricalOracleCorpus, historicalOracleEvidenceSha256, parseHistoricalOracleCase,
  readHistoricalOracleAdmission, writeHistoricalOracleCorpus,
  type HistoricalOracleCase, type OracleArtifact, type OracleObservationResult,
} from "../eval/historical-oracle.js";

const digest = (bytes: string): string => createHash("sha256").update(bytes).digest("hex");
function fixture(root: string, caseId = "case-a", comparison = false) {
  const put = (name: string, value: unknown): OracleArtifact => {
    const bytes = typeof value === "string" ? value : JSON.stringify(value);
    const path = `${caseId}-${name}`;
    writeFileSync(join(root, path), bytes);
    return { path, sha256: digest(bytes) };
  };
  const record: HistoricalOracleCase = {
    schemaVersion: 1, protocol: "historical-oracle-v1", caseId,
    partition: "visible-development", duplicateFamily: `family-${caseId}`, language: "typescript",
    source: {
      repository: "https://github.com/example/source", reviewUrl: "https://github.com/example/source/pull/1",
      base: { commit: "a".repeat(40), tree: "d".repeat(40) },
      head: { commit: "b".repeat(40), tree: "e".repeat(40) },
      repair: comparison ? null : { commit: "c".repeat(40), tree: "f".repeat(40) },
      provenance: put("provenance", "Structural fixture, not historical evidence"),
      diff: put("diff.patch", "diff --git a/index.ts b/index.ts\n+return false;"),
      archive: put("source.bundle", "Fixture archive bytes"),
    },
    truth: {
      version: "v1", status: comparison ? "reviewed-comparison" : "known-roots", completeness: "partial",
      scope: "Only the callback completion behavior exercised by the oracle.",
      roots: comparison ? [] : [{ id: "root-a", mechanism: "callback-loss", trigger: "Retry occurs", consequence: "Promise never completes", severity: "high", file: "index.ts", line: 2 }],
    },
    oracle: {
      kind: "executable", contract: put("contract.md", "Completion must happen exactly once."),
      program: put("oracle.mjs", "throw new Error('Compiler must never execute this');"),
      environment: put("environment.json", { node: "22", dependencyLock: "fixture" }),
      certificate: null,
      negativeControl: comparison ? { description: "Remove the single-completion guard", patch: put("negative.patch", "-completionGuard();") } : null,
      observations: [],
    },
    reviews: [],
  };
  for (const role of comparison ? ["head", "negative-control"] as const : ["base", "head", "repair"] as const) {
    const revision = (role === "negative-control" ? record.source.head : record.source[role])!;
    const failure = comparison ? role === "negative-control" : role === "head";
    const result: OracleObservationResult = {
      schemaVersion: 1, caseId, role, revision, programSha256: record.oracle.program.sha256, exitCode: failure ? 1 : 0,
      checks: [{ targetId: comparison ? "comparison-scope" : "root-a", outcome: failure ? "behavioral-failure" : "passed" }],
    };
    record.oracle.observations.push({ role, revision, command: ["node", "oracle.mjs"], result: put(`${role}.json`, result), log: put(`${role}.log`, `${role}: assertion ${failure ? "failed" : "passed"}`) });
  }
  const review = () => {
    record.reviews = [1, 2].map((i) => ({
      kind: "ai", model: "gpt-6-astra", effort: "medium", sessionId: `fixture-reviewer-${i}`,
      rubricVersion: "oracle-review-v1", reviewedAt: "2026-09-16T12:00:00Z",
      evidenceSha256: historicalOracleEvidenceSha256(record), decision: "supports-admission",
      rationale: put(`review-${i}.md`, `Structural test fixture review ${i}; not a real curator.`),
    }));
  };
  review();
  return { record, put, review, save: () => put("record.json", record) };
}

function withRoot(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "peregrine-oracle-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("oracle corpus compiles deterministic bytes without running stored commands and discloses AI provenance", (t) => {
  const root = withRoot(t);
  const a = fixture(root); const b = fixture(root, "case-b", true);
  b.record.source.head.commit = "9".repeat(40);
  for (const obs of b.record.oracle.observations) {
    obs.revision = b.record.source.head;
    const result = JSON.parse(readFileSync(join(root, obs.result.path), "utf8"));
    result.revision = obs.revision;
    obs.result = b.put(`${obs.role}.json`, result);
  }
  b.review();
  const refs = [a.save(), b.save()];
  const first = compileHistoricalOracleCorpus(root, refs);
  assert.deepEqual(first, compileHistoricalOracleCorpus(root, [...refs].reverse()));
  assert.deepEqual(first.counts, { cases: 2, knownRootCases: 1, comparisonCases: 1, roots: 1, repositories: 1, duplicateFamilies: 2 });
  assert.equal(first.humanVerified, false);
  assert.equal(first.independentConfirmation, false);
  assert.equal(first.partition, "visible-development");
  const output = join(root, "corpus.json");
  writeHistoricalOracleCorpus(output, root, refs);
  assert.throws(() => writeHistoricalOracleCorpus(output, root, refs), /EEXIST/);
  const refsPath = join(root, "refs.json");
  const cliOutput = join(root, "cli-corpus.json");
  writeFileSync(refsPath, JSON.stringify(refs));
  execFileSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../scripts/evidence/compile-historical-oracle-corpus.ts", import.meta.url)), root, refsPath, cliOutput]);
  assert.deepEqual(JSON.parse(readFileSync(cliOutput, "utf8")), first);
});

test("case integrity covers exact bytes of every retained artifact", (t) => {
  const root = withRoot(t); const f = fixture(root); const ref = f.save();
  writeFileSync(join(root, f.record.oracle.observations[0]!.log.path), "different log");
  assert.throws(() => readHistoricalOracleAdmission(root, ref), /hash mismatch/);
});

test("AI reviews cannot become human decisions and stale reviews cannot approve changed truth", (t) => {
  const root = withRoot(t); const f = fixture(root);
  f.record.truth.scope = "A different scope";
  assert.throws(() => readHistoricalOracleAdmission(root, f.save()), /review is stale/);
  f.review();
  const bad = { ...f.record, humanDecision: { decision: "approve" } };
  assert.throws(() => parseHistoricalOracleCase(bad), /unknown fields/);
  (f.record.reviews[0] as unknown as { kind: string }).kind = "human";
  assert.throws(() => parseHistoricalOracleCase(f.record), /disclose AI/);
});

test("admission requires complete base/head/repair assertion evidence and two distinct AI sessions", async (t) => {
  for (const [name, mutate, expected] of [
    ["missing base", (f: ReturnType<typeof fixture>) => { f.record.oracle.observations.shift(); }, /missing or unexpected/],
    ["wrong commit", (f: ReturnType<typeof fixture>) => { f.record.oracle.observations[0]!.revision = { commit: "0".repeat(40), tree: "d".repeat(40) }; }, /wrong revision/],
    ["repair equals head", (f: ReturnType<typeof fixture>) => { f.record.source.repair = f.record.source.head; }, /repair must differ/],
    ["missing review", (f: ReturnType<typeof fixture>) => { f.record.reviews.pop(); }, /exactly two/],
    ["same session", (f: ReturnType<typeof fixture>) => { f.record.reviews[1]!.sessionId = f.record.reviews[0]!.sessionId; }, /duplicates/],
    ["unproven root", (f: ReturnType<typeof fixture>) => { f.record.truth.roots.push({ ...f.record.truth.roots[0]!, id: "root-unproved" }); }, /every and only/],
  ] as const) await t.test(name, (sub) => {
    const root = withRoot(sub); const f = fixture(root); mutate(f);
    assert.throws(() => readHistoricalOracleAdmission(root, f.save()), expected);
  });
});

test("environment failures, irrelevant assertions, and stale program/case results cannot count as behavioral evidence", async (t) => {
  for (const [name, mutate, expected] of [
    ["environment failure", (r: OracleObservationResult) => { r.checks[0]!.outcome = "environment-failure"; }, /environment failures/],
    ["wrong assertion", (r: OracleObservationResult) => { r.checks[0]!.targetId = "unrelated-test"; }, /every and only/],
    ["wrong program", (r: OracleObservationResult) => { r.programSha256 = "0".repeat(64); }, /cross-case bindings/],
    ["wrong case", (r: OracleObservationResult) => { r.caseId = "another-case"; }, /cross-case bindings/],
    ["unexpected exit", (r: OracleObservationResult) => { r.exitCode = 137; }, /process exit/],
    ["false positive head", (r: OracleObservationResult) => { r.checks[0]!.outcome = "passed"; }, /expected behavior/],
  ] as const) await t.test(name, (sub) => {
    const root = withRoot(sub); const f = fixture(root);
    const obs = f.record.oracle.observations[1]!;
    const result: OracleObservationResult = JSON.parse(readFileSync(join(root, obs.result.path), "utf8"));
    mutate(result); obs.result = f.put("changed-result.json", result); f.review();
    assert.throws(() => readHistoricalOracleAdmission(root, f.save()), expected);
  });
});

test("comparison admission needs a scoped negative control and never permits full-truth or reserved claims", (t) => {
  const root = withRoot(t); const f = fixture(root, "comparison", true);
  assert.equal(readHistoricalOracleAdmission(root, f.save()).truth.status, "reviewed-comparison");
  f.record.oracle.negativeControl = null;
  assert.throws(() => readHistoricalOracleAdmission(root, f.save()), /negative control/);
  assert.throws(() => parseHistoricalOracleCase({ ...f.record, partition: "selection" }), /visible-development only/);
  assert.throws(() => parseHistoricalOracleCase({ ...f.record, truth: { ...f.record.truth, completeness: "complete" } }), /must be partial/);
  assert.throws(() => parseHistoricalOracleCase({ ...f.record, oracle: { ...f.record.oracle, kind: "ai-static-trace" } }), /executable or formal/);
});

test("duplicate cases, duplicate source opportunities and escaping or symlink artifacts reject", (t) => {
  const root = withRoot(t); const f = fixture(root); const ref = f.save();
  assert.throws(() => compileHistoricalOracleCorpus(root, [ref, ref]), /case IDs contains duplicates/);
  const b = fixture(root, "case-b");
  assert.throws(() => compileHistoricalOracleCorpus(root, [ref, b.save()]), /review opportunities contains duplicates/);
  assert.throws(() => readHistoricalOracleAdmission(root, { ...ref, path: "../record.json" }), /unsafe/);
  const link = join(root, "linked-record.json"); symlinkSync(join(root, ref.path), link);
  assert.throws(() => readHistoricalOracleAdmission(root, { ...ref, path: "linked-record.json" }), /direct regular file/);
  assert.throws(() => compileHistoricalOracleCorpus(root, []), /empty oracle corpus/);
});

test("a formal label without retained checker certificate cannot substitute for actual evidence", (t) => {
  const root = withRoot(t); const f = fixture(root);
  f.record.oracle.kind = "formal";
  assert.throws(() => readHistoricalOracleAdmission(root, f.save()), /checker certificate/);
  f.record.oracle.certificate = f.put("certificate", "Structural fixture certificate, not a real formal proof");
  f.review();
  assert.equal(readHistoricalOracleAdmission(root, f.save()).oracle.kind, "formal");
  writeFileSync(join(root, f.record.oracle.certificate.path), "changed certificate");
  assert.throws(() => readHistoricalOracleAdmission(root, f.save()), /hash mismatch/);
});
