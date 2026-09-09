import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalJsonSha256 } from "../eval/experiment.js";
import { buildMethodologyUnmatchedRootLedger, parseMethodologyUnmatchedRootLedger, readMethodologyUnmatchedRootLedger, writeMethodologyUnmatchedRootLedger, type MethodologyUnmatchedRootAssignment } from "../eval/methodology-unmatched-root-ledger.js";
import { gradeMethodologyAttempt, methodologyFindingEvidenceSha256, methodologyReviewOutputSha256, type MethodologyGradingProjection } from "../eval/methodology-grading-contract.js";
import { buildMethodologySchedule, methodologyArmConfigIdentitySha256, type MethodologyDesign } from "../eval/methodology-schedule.js";
import { historicalPermittedMetrics, parseHistoricalGroundTruth } from "../eval/historical-truth.js";
import { historicalTruthScopeSha256 } from "../eval/historical-curation.js";

const sha = (character: string): string => character.repeat(64);
const review = {
  status: "completed" as const,
  limitations: [],
  findings: [
    { file: "src/retry.ts", startLine: 5, endLine: 6, explanation: "The callback can be invoked twice.", impact: "One request completes twice.", severity: "high" as const },
    { file: "src/retry.ts", startLine: 5, endLine: 6, explanation: "The callback can be invoked twice.", impact: "One request completes twice.", severity: "high" as const },
  ],
};
const truth = parseHistoricalGroundTruth({
  schemaVersion: 2,
  scope: { protocol: "historical-efficacy-v1", truthVersion: "truth-v1", status: "reviewed-comparison", completeness: "partial", reviewedScope: "Synthetic unmatched fixture.", permittedMetrics: historicalPermittedMetrics("reviewed-comparison") },
  bugs: [],
});

function fixture() {
  const runId = "unmatched-root-fixture";
  const executionEvidenceSha256 = sha("a");
  const inputPlanSha256 = sha("b");
  const designWithoutArms: Omit<MethodologyDesign, "arms"> = { schemaVersion: 1, protocol: "historical-methodology-v1", seed: 37, repeats: 2, callerConfig: { runner: "codex", model: "gpt-5.6-sol", effort: "high", identitySha256: sha("c") }, totalDeadlineMs: 60_000, twoWorkerStageSplit: { discoveryDeadlineMs: 20_000, reviewerDeadlineMs: 40_000 } };
  const design: MethodologyDesign = { ...designWithoutArms, arms: (["A", "B", "C", "D"] as const).map((armId) => { const configName = `arm-${armId.toLowerCase()}`; return { armId, configName, configIdentitySha256: methodologyArmConfigIdentitySha256({ design: designWithoutArms, armId, configName }) }; }) };
  const schedule = buildMethodologySchedule({ design, cases: [{ caseName: "development/case-aaaaaaaa", corpus: "development", expectedBugCount: 0 }] });
  const reviewOutputSha256 = methodologyReviewOutputSha256(review);
  const findingEvidence = review.findings.map((finding) => methodologyFindingEvidenceSha256(finding));
  const grades = schedule.attempts.map((attempt) => {
    const projection: MethodologyGradingProjection = { schemaVersion: 2, kind: "methodology-grading-projection", executionEvidenceSha256, inputPlanSha256, caseRegistrationSha256: sha("d"), truthSha256: canonicalJsonSha256(truth), truthScopeSha256: historicalTruthScopeSha256(truth), attemptId: attempt.id, caseName: attempt.caseName, status: "completed", statusReason: "authenticated-complete", lifecycleTerminalSha256: sha("e"), reviewTerminalSha256: sha("f"), reviewRawOutputSha256: sha("0"), reviewOutputSha256: reviewOutputSha256 };
    return gradeMethodologyAttempt({ projection, expectedProjectionSha256: canonicalJsonSha256(projection), truth, reviewOutput: review, judgeConfigSha256: sha("1"), pairVerdicts: [] });
  });
  const gradeSetSha256 = canonicalJsonSha256(grades.map((grade) => ({ attemptId: grade.projection.attemptId, gradeSha256: grade.gradeSha256 })));
  const records = grades.flatMap((grade) => grade.unmatchedFindings.map((finding) => ({ ...finding, attemptId: grade.projection.attemptId, classification: (finding.findingIndex === 0 ? "confirmed-new" : "unsupported") as "confirmed-new" | "unsupported" | "unresolved", rationale: "Curator rationale.", evidence: "Curator evidence." }))).sort((left, right) => left.attemptId.localeCompare(right.attemptId) || left.findingIndex - right.findingIndex);
  const effectiveBody = { schemaVersion: 1 as const, protocol: "historical-methodology-adjudication-effective-v1" as const, runId, baseLedgerSha256: sha("9"), gradeSetSha256, records, resolutions: [], headResolutionSha256: null, unresolvedCount: records.filter((record) => record.classification === "unresolved").length };
  const effective = { ...effectiveBody, effectiveSha256: canonicalJsonSha256(effectiveBody) };
  const assignments: MethodologyUnmatchedRootAssignment[] = records.map((record) => ({ attemptId: record.attemptId, findingIndex: record.findingIndex, findingEvidenceSha256: record.findingEvidenceSha256, rootIdentitySha256: record.findingIndex === 0 ? sha("7") : sha("8") }));
  const root = (rootIdentitySha256: string) => ({ rootIdentitySha256, reviewerIdentitySha256s: [sha("2"), sha("1")], reviewerIndependence: "not-attested" as const, source: "curator packet", evidence: "The same causal behavior was observed.", rationale: "Collapse duplicate reports." });
  return {
    runId,
    schedule,
    gradeSet: grades,
    grades,
    gradeSetSha256,
    effective,
    effectiveAdjudication: effective,
    assignments,
    roots: [root(sha("7")), root(sha("8"))],
    recordedAt: "2026-09-09T00:00:00.000Z",
    baseLedgerSha256: effective.baseLedgerSha256,
    effectiveAdjudicationSha256: effective.effectiveSha256,
    headResolutionSha256: effective.headResolutionSha256,
    scheduleSha256: canonicalJsonSha256(schedule),
  };
}

test("collapses duplicate findings into one root while preserving exact occurrences and arm/case provenance", () => {
  const data = fixture();
  const ledger = buildMethodologyUnmatchedRootLedger(data);
  const first = ledger.roots.find((root) => root.rootIdentitySha256 === sha("7"))!;
  assert.equal(first.occurrences.length, data.schedule.attempts.length);
  assert.equal(new Set(first.occurrences.map((occurrence) => occurrence.attemptId)).size, data.schedule.attempts.length);
  assert.equal(new Set(first.occurrences.map((occurrence) => occurrence.armId)).size, 4);
  assert.equal(first.caseName, "development/case-aaaaaaaa");
  assert.deepEqual(first.reviewerIdentitySha256s, [sha("1"), sha("2")]);
  assert.deepEqual(ledger.rootCounts, { "confirmed-new": 1, unsupported: 1, unresolved: 0 });
  assert.deepEqual(ledger.occurrenceCounts, { "confirmed-new": 8, unsupported: 8, unresolved: 0 });
  assert.equal(parseMethodologyUnmatchedRootLedger(ledger).artifactSha256, ledger.artifactSha256);
});

test("same root across repeats remains identifiable and can be counted once per attempt", () => {
  const data = fixture();
  const ledger = buildMethodologyUnmatchedRootLedger(data);
  const root = ledger.roots.find((item) => item.rootIdentitySha256 === sha("7"))!;
  assert.equal(root.occurrences.length, new Set(root.occurrences.map((item) => item.attemptId)).size);
  assert.equal(new Set(root.occurrences.map((item) => item.repeat)).size, 2);
});

test("cross-arm same-case grouping and every rejection path are strict", () => {
  const data = fixture();
  const valid = buildMethodologyUnmatchedRootLedger(data);
  assert.throws(() => buildMethodologyUnmatchedRootLedger({ ...data, assignments: [...data.assignments, data.assignments[0]!] }), /duplicate/);
  assert.throws(() => buildMethodologyUnmatchedRootLedger({ ...data, assignments: data.assignments.slice(1) }), /every and only/);
  assert.throws(() => buildMethodologyUnmatchedRootLedger({ ...data, runId: "other-run" }), /runId/);
  assert.throws(() => buildMethodologyUnmatchedRootLedger({ ...data, assignments: data.assignments.map((item, index) => index === 0 ? { ...item, findingEvidenceSha256: sha("9") } : item) }), /stale|bound|every and only/);
  assert.throws(() => buildMethodologyUnmatchedRootLedger({ ...data, assignments: data.assignments.map((item, index) => index === 0 ? { ...item, extra: true } : item) }), /shape/);
  assert.throws(() => buildMethodologyUnmatchedRootLedger({ ...data, roots: [{ ...data.roots[0]!, source: "\u0001" }, data.roots[1]!] }), /unsafe/);
  assert.throws(() => buildMethodologyUnmatchedRootLedger({ ...data, roots: [{ ...data.roots[0]!, reviewerIdentitySha256s: [] }, data.roots[1]!] }), /non-empty/);
  assert.throws(() => buildMethodologyUnmatchedRootLedger({ ...data, roots: [{ ...data.roots[0]!, reviewerIdentitySha256s: [sha("1"), sha("1")] }, data.roots[1]!] }), /duplicates/);
  assert.throws(() => buildMethodologyUnmatchedRootLedger({ ...data, roots: [{ ...data.roots[0]!, reviewerIndependence: "unknown" }, data.roots[1]!] }), /invalid/);
  assert.throws(() => buildMethodologyUnmatchedRootLedger({ ...data, roots: [{ ...data.roots[0]!, rationale: "token=ghp_123456789012345678901234567890" }, data.roots[1]!] }), /secret|unsafe|credential/i);
  assert.throws(() => buildMethodologyUnmatchedRootLedger({ ...data, roots: [data.roots[0]!] }), /every|root/);
  const mixed = data.assignments.map((item) => item.rootIdentitySha256 === sha("7") ? { ...item, rootIdentitySha256: sha("8") } : item);
  assert.throws(() => buildMethodologyUnmatchedRootLedger({ ...data, assignments: mixed }), /classification|case/);
  const tampered = { ...valid, rootCounts: { ...valid.rootCounts, unresolved: valid.rootCounts.unresolved + 1 } };
  assert.throws(() => parseMethodologyUnmatchedRootLedger(tampered), /digest|counts/i);
  assert.equal(valid.roots.length, 2);
});

test("stored ledger is exclusive, caller-bound, rederived, and rejects tampering or symlinks", () => {
  const data = fixture();
  const root = mkdtempSync(join(tmpdir(), "methodology-unmatched-roots-"));
  try {
    const ledger = writeMethodologyUnmatchedRootLedger(root, data);
    assert.deepEqual(readMethodologyUnmatchedRootLedger(root, ledger.artifactSha256, data), ledger);
    assert.throws(() => writeMethodologyUnmatchedRootLedger(root, data), /exist|exclusive|EEXIST/i);
    assert.throws(() => readMethodologyUnmatchedRootLedger(root, sha("0"), data), /digest/i);

    const path = join(root, "methodology-unmatched-root-ledgers", `${ledger.artifactSha256}.json`);
    const original = readFileSync(path);
    const tampered = JSON.parse(original.toString("utf8")) as Record<string, any>;
    tampered.recordedAt = "2026-09-09T00:00:01.000Z";
    writeFileSync(path, `${JSON.stringify(tampered)}\n`);
    assert.throws(() => readMethodologyUnmatchedRootLedger(root, ledger.artifactSha256, data), /digest|tamper/i);
    writeFileSync(path, original);

    const target = `${path}.real`;
    renameSync(path, target);
    symlinkSync(target, path);
    assert.throws(() => readMethodologyUnmatchedRootLedger(root, ledger.artifactSha256, data), /regular non-symlink/i);
    unlinkSync(path);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
