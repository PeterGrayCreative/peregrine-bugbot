import assert from "node:assert/strict";
import test from "node:test";
import { historicalTruthScopeSha256 } from "../eval/historical-curation.js";
import { historicalPermittedMetrics, type HistoricalGroundTruth } from "../eval/historical-truth.js";
import {
  gradeMethodologyAttempt,
  methodologyComparisonId,
  methodologyFindingEvidenceSha256,
  methodologyGradingProjectionSha256,
  methodologyReviewOutputSha256,
  METHODOLOGY_GRADING_PROJECTION_BOUNDARY,
  type MethodologyAttemptStatus,
  type MethodologyGradingProjection,
  type MethodologyPairVerdictInput,
} from "../eval/methodology-grading-contract.js";
import type { MethodologyFinding } from "../eval/methodology-output.js";
import { canonicalJsonSha256 } from "../eval/experiment.js";

const digest = (character: string) => character.repeat(64);
const judgeConfigSha256 = digest("a");
const finding: MethodologyFinding = {
  file: "src/service.ts",
  startLine: 20,
  endLine: 21,
  explanation: "The operation resolves before the deferred write has completed.",
  impact: "A caller can observe success and then lose the write.",
  severity: "high",
};
const completedReview = { status: "completed" as const, limitations: [], findings: [finding] };

function bug(id: string, rootCauseGroup?: string) {
  return {
    id,
    ...(rootCauseGroup === undefined ? {} : { rootCauseGroup }),
    lane: "other-unclassified" as const,
    mechanismFamily: "async-lifecycle",
    proofLevel: "complete-static-trace" as const,
    expectedDisposition: "fix-in-pr" as const,
    expectedSeverity: "high" as const,
    file: "src/service.ts",
    startLine: 12,
    endLine: 24,
    description: "The completion signal precedes the deferred write.",
    reachablePreconditions: "The public operation takes the deferred branch.",
    observableImpact: "The caller can observe success before persistence.",
    provenance: "Reconstructed historical source and repair evidence.",
  };
}

function truth(bugs = [bug("bug-11111111", "root-aaaaaaaa")]): HistoricalGroundTruth {
  return {
    schemaVersion: 2,
    scope: {
      protocol: "historical-efficacy-v1",
      truthVersion: "truth-v1",
      status: "known-roots",
      completeness: "partial",
      reviewedScope: "The changed completion boundary only.",
      permittedMetrics: historicalPermittedMetrics("known-roots"),
    },
    bugs,
  };
}

function projection(
  historicalTruth: HistoricalGroundTruth,
  status: MethodologyAttemptStatus = "completed",
  review: unknown | null = completedReview,
): MethodologyGradingProjection {
  return {
    schemaVersion: 1,
    kind: "methodology-grading-projection",
    executionEvidenceSha256: digest("1"),
    inputPlanSha256: digest("2"),
    caseRegistrationSha256: digest("3"),
    truthSha256: canonicalJsonSha256(historicalTruth),
    truthScopeSha256: historicalTruthScopeSha256(historicalTruth),
    attemptId: "attempt-000001",
    caseName: "development/case-1234abcd",
    status,
    reviewOutputSha256: review === null ? null : methodologyReviewOutputSha256(review),
  };
}

function verdicts(
  historicalTruth: HistoricalGroundTruth,
  findings: MethodologyFinding[],
  verdict: MethodologyPairVerdictInput["verdict"] = "same-root-cause",
): MethodologyPairVerdictInput[] {
  return historicalTruth.bugs.flatMap((registeredBug) => findings.map((emittedFinding, findingIndex) => ({
    comparisonId: methodologyComparisonId({ bug: registeredBug, finding: emittedFinding, judgeConfigSha256 }),
    bugId: registeredBug.id,
    findingIndex,
    findingEvidenceSha256: methodologyFindingEvidenceSha256(emittedFinding),
    verdict,
  })));
}

function grade(historicalTruth: HistoricalGroundTruth, status: MethodologyAttemptStatus,
  review: unknown | null, pairs: MethodologyPairVerdictInput[]) {
  const gradingProjection = projection(historicalTruth, status, review);
  return gradeMethodologyAttempt({
    projection: gradingProjection,
    expectedProjectionSha256: methodologyGradingProjectionSha256(gradingProjection),
    truth: historicalTruth,
    reviewOutput: review,
    judgeConfigSha256,
    pairVerdicts: pairs,
  });
}

test("one neutral finding can credit multiple observations only within one registered root", () => {
  const historicalTruth = truth([
    bug("bug-11111111", "root-aaaaaaaa"),
    { ...bug("bug-22222222", "root-aaaaaaaa"), startLine: 28, endLine: 31 },
  ]);
  const result = grade(historicalTruth, "completed", completedReview, verdicts(historicalTruth, [finding]));

  assert.deepEqual(result.observationMatches, { "bug-11111111": 0, "bug-22222222": 0 });
  assert.deepEqual(Object.values(result.rootCauseMatches), [true]);
  assert.deepEqual(Object.values(result.rootMissAttribution), ["none"]);
  assert.deepEqual(result.unmatchedFindings, []);
  assert.equal(result.completion.completed, 1);
  assert.equal(result.metricEligibility.selections.find((row) =>
    row.metric === "registered-known-root-recall")?.denominator?.count, 1);
  assert.equal(result.claims.globalCleanliness, "not-established");
});

test("a positive external verdict cannot reuse one finding across registered causal roots", () => {
  const historicalTruth = truth([
    bug("bug-11111111", "root-aaaaaaaa"),
    bug("bug-22222222", "root-bbbbbbbb"),
  ]);
  assert.throws(
    () => grade(historicalTruth, "completed", completedReview, verdicts(historicalTruth, [finding])),
    /positive verdicts across root-cause groups/,
  );
});

test("complete attempts require the exact canonical Cartesian verdict set and authenticated projection", () => {
  const historicalTruth = truth();
  const pairs = verdicts(historicalTruth, [finding], "different-root-cause");
  const gradingProjection = projection(historicalTruth);
  const expectedProjectionSha256 = methodologyGradingProjectionSha256(gradingProjection);

  assert.throws(() => gradeMethodologyAttempt({ projection: gradingProjection, expectedProjectionSha256,
    truth: historicalTruth, reviewOutput: completedReview, judgeConfigSha256, pairVerdicts: [] }), /every truth\/finding pair/);
  assert.throws(() => gradeMethodologyAttempt({ projection: gradingProjection, expectedProjectionSha256,
    truth: historicalTruth, reviewOutput: completedReview, judgeConfigSha256,
    pairVerdicts: [{ ...pairs[0]!, findingEvidenceSha256: digest("b") }] }), /canonical truth\/finding pair/);
  assert.throws(() => gradeMethodologyAttempt({ projection: { ...gradingProjection, attemptId: "attempt-000002" },
    expectedProjectionSha256, truth: historicalTruth, reviewOutput: completedReview, judgeConfigSha256,
    pairVerdicts: pairs }), /caller-held digest/);
  assert.throws(() => gradeMethodologyAttempt({ projection: { ...gradingProjection, truthScopeSha256: digest("c") },
    expectedProjectionSha256: methodologyGradingProjectionSha256({ ...gradingProjection, truthScopeSha256: digest("c") }),
    truth: historicalTruth, reviewOutput: completedReview, judgeConfigSha256, pairVerdicts: pairs }), /truth scope digest/);
  assert.throws(() => gradeMethodologyAttempt({ projection: { ...gradingProjection, truthSha256: digest("d") },
    expectedProjectionSha256: methodologyGradingProjectionSha256({ ...gradingProjection, truthSha256: digest("d") }),
    truth: historicalTruth, reviewOutput: completedReview, judgeConfigSha256, pairVerdicts: pairs }), /truth artifact digest/);
  assert.match(METHODOLOGY_GRADING_PROJECTION_BOUNDARY, /caller must authenticate/i);
  assert.match(METHODOLOGY_GRADING_PROJECTION_BOUNDARY, /does not prove provider contact/);
});

test("negative or failed external comparisons leave completed roots unattributed and findings unresolved", () => {
  const historicalTruth = truth();
  for (const decision of ["different-root-cause", "failed"] as const) {
    const result = grade(historicalTruth, "completed", completedReview,
      verdicts(historicalTruth, [finding], decision));
    assert.deepEqual(result.observationMatches, { "bug-11111111": null });
    assert.deepEqual(Object.values(result.rootCauseMatches), [false]);
    assert.deepEqual(Object.values(result.rootMissAttribution), ["unattributed"]);
    assert.deepEqual(result.unmatchedFindings, [{ findingIndex: 0,
      findingEvidenceSha256: methodologyFindingEvidenceSha256(finding), classification: "unresolved" }]);
  }
});

test("missing and failed attempts remain scheduled misses and cannot carry output or receive credit", () => {
  for (const status of ["missing", "failed"] as const) {
    const result = grade(truth(), status, null, []);
    assert.deepEqual(result.observationMatches, { "bug-11111111": null });
    assert.deepEqual(Object.values(result.rootCauseMatches), [false]);
    assert.deepEqual(Object.values(result.rootMissAttribution), ["unattributed"]);
    assert.equal(result.completion.scheduled, 1);
    assert.equal(result.completion[status], 1);
    assert.equal(result.metricEligibility.selections.find((row) => row.metric === "completion")?.denominator?.count, 1);
    assert.equal(result.claims.globalCleanliness, "not-established");
  }
  const historicalTruth = truth();
  const badProjection = projection(historicalTruth, "failed", completedReview);
  assert.throws(() => gradeMethodologyAttempt({ projection: badProjection,
    expectedProjectionSha256: methodologyGradingProjectionSha256(badProjection), truth: historicalTruth,
    reviewOutput: completedReview, judgeConfigSha256, pairVerdicts: [] }), /cannot supply review output/);
});

test("incomplete attempts retain every emitted finding unresolved but never receive root credit", () => {
  const incompleteReview = {
    status: "unable-to-complete" as const,
    limitations: ["A required caller was unavailable within the contained source."],
    findings: [finding],
  };
  const result = grade(truth(), "incomplete", incompleteReview, []);
  assert.deepEqual(result.observationMatches, { "bug-11111111": null });
  assert.deepEqual(Object.values(result.rootMissAttribution), ["unattributed"]);
  assert.deepEqual(result.unmatchedFindings, [{ findingIndex: 0,
    findingEvidenceSha256: methodologyFindingEvidenceSha256(finding), classification: "unresolved" }]);
  assert.equal(result.completion.incomplete, 1);
  assert.throws(() => grade(truth(), "incomplete", incompleteReview, verdicts(truth(), [finding])), /cannot receive pair verdicts/);
});

test("partial reviewed comparisons keep every finding unresolved and never establish clean specificity", () => {
  const historicalTruth: HistoricalGroundTruth = {
    schemaVersion: 2,
    scope: { protocol: "historical-efficacy-v1", truthVersion: "comparison-v1",
      status: "reviewed-comparison", completeness: "partial", reviewedScope: "Only the changed error branch.",
      permittedMetrics: historicalPermittedMetrics("reviewed-comparison") },
    bugs: [],
  };
  const result = grade(historicalTruth, "completed", completedReview, []);
  assert.deepEqual(result.rootCauseMatches, {});
  assert.equal(result.unmatchedFindings.length, 1);
  assert.equal(result.unmatchedFindings[0]?.classification, "unresolved");
  assert.equal(result.metricEligibility.selections.find((row) =>
    row.metric === "global-clean-specificity")?.disposition, "excluded");
  assert.equal(result.claims.globalCleanliness, "not-established");
});

test("comparison hashes expose only neutral causal text and bind judge and finding bytes", () => {
  const registeredBug = bug("bug-11111111", "root-aaaaaaaa");
  const changedHiddenLabels = { ...registeredBug, lane: "test-quality" as const, mechanismFamily: "test-oracle",
    expectedDisposition: "follow-up" as const, expectedSeverity: "low" as const,
    provenance: "A different curator-only provenance note.", proofLevel: "reproduced" as const };
  assert.equal(
    methodologyComparisonId({ bug: registeredBug, finding, judgeConfigSha256 }),
    methodologyComparisonId({ bug: changedHiddenLabels, finding, judgeConfigSha256 }),
  );
  assert.notEqual(
    methodologyComparisonId({ bug: registeredBug, finding, judgeConfigSha256 }),
    methodologyComparisonId({ bug: registeredBug, finding: { ...finding, impact: "A different impact." }, judgeConfigSha256 }),
  );
  assert.notEqual(
    methodologyComparisonId({ bug: registeredBug, finding, judgeConfigSha256 }),
    methodologyComparisonId({ bug: registeredBug, finding, judgeConfigSha256: digest("b") }),
  );
});
