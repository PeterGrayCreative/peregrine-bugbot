import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertLeakageFreeText, leakagePolicyForCase, readSanitizedMetadata } from "../eval/case-isolation.js";
import { historicalPermittedMetrics } from "../eval/historical-truth.js";
import type { HistoricalCaseSpec } from "../src/types.js";

const spec: HistoricalCaseSpec = {
  id: "case-01234567", corpus: "development", kind: "historical",
  evaluationProtocol: "historical-efficacy-v1", repoSource: "/unopened-source",
  baseCommit: "a".repeat(40), headCommit: "b".repeat(40), diffFile: "diff.patch",
  metadataFile: "metadata.json",
};

function truth(status: "known-roots" | "reviewed-comparison") {
  return {
    schemaVersion: 2,
    scope: { protocol: "historical-efficacy-v1", truthVersion: "truth-v1", status,
      completeness: "partial", reviewedScope: "retry seam",
      permittedMetrics: historicalPermittedMetrics(status) },
    bugs: status === "known-roots" ? [{
      id: "bug-12345678", lane: "other-unclassified", mechanismFamily: "retry-contract",
      proofLevel: "complete-static-trace", expectedDisposition: "fix-in-pr", expectedSeverity: "high",
      file: "src/task.ts", startLine: 1, endLine: 2,
      description: "The historical task loses the final retry result on failure.",
      reachablePreconditions: "The registered task exhausts its retry allowance.",
      observableImpact: "The caller receives false success for a rejected task.",
      provenance: "Private curator evidence identifies the historical repair.",
    }] : [],
  };
}

test("opted-in historical truth retains answer bans for roots and partial scope", () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-historical-leakage-"));
  try {
    const value = truth("known-roots");
    writeFileSync(join(root, "ground_truth.json"), JSON.stringify(value));
    const policy = leakagePolicyForCase(root, spec);
    for (const answer of [value.scope.reviewedScope, value.bugs[0]!.id,
      value.bugs[0]!.description, value.bugs[0]!.mechanismFamily, value.bugs[0]!.reachablePreconditions,
      value.bugs[0]!.observableImpact, value.bugs[0]!.provenance]) {
      assert.throws(() => assertLeakageFreeText("repository file", answer, policy), /forbidden answer-bearing term/);
    }
    assert.doesNotThrow(() => assertLeakageFreeText("repository file", "An ordinary high priority task.", policy));
    writeFileSync(join(root, "metadata.json"), JSON.stringify({ body: value.bugs[0]!.description }));
    assert.throws(() => readSanitizedMetadata(root, spec, policy), /forbidden answer-bearing term/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("partial comparisons still protect curator scope despite an empty root catalog", () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-comparison-leakage-"));
  try {
    const value = truth("reviewed-comparison");
    writeFileSync(join(root, "ground_truth.json"), JSON.stringify(value));
    const policy = leakagePolicyForCase(root, spec);
    assert.throws(() => assertLeakageFreeText("repository file", value.scope.reviewedScope, policy), /forbidden answer-bearing term/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("historical leakage parsing rejects protocol mismatches and malformed truth", () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-leakage-protocol-"));
  try {
    writeFileSync(join(root, "ground_truth.json"), JSON.stringify(truth("reviewed-comparison")));
    const { evaluationProtocol: _protocol, ...legacy } = spec;
    assert.throws(() => leakagePolicyForCase(root, legacy), /versioned|scope|schemaVersion/);
    writeFileSync(join(root, "ground_truth.json"), JSON.stringify({ bugs: [] }));
    assert.throws(() => leakagePolicyForCase(root, spec), /missing schemaVersion/);
    const malformed = truth("reviewed-comparison");
    malformed.scope.permittedMetrics = historicalPermittedMetrics("known-roots");
    writeFileSync(join(root, "ground_truth.json"), JSON.stringify(malformed));
    assert.throws(() => leakagePolicyForCase(root, spec), /permittedMetrics/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
