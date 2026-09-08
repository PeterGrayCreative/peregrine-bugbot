import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalJsonSha256 } from "../eval/experiment.js";
import {
  buildMethodologyAdjudicationLedger,
  type MethodologyAdjudicationRecord,
} from "../eval/methodology-adjudication.js";
import {
  writeMethodologyGradeSet,
  type MethodologyGradeSetArtifact,
} from "../eval/methodology-analysis-artifacts.js";
import {
  gradeMethodologyAttempt,
  methodologyComparisonId,
  methodologyFindingEvidenceSha256,
  methodologyAttemptGradeSha256,
  methodologyReviewOutputSha256,
  type MethodologyGradingProjection,
} from "../eval/methodology-grading-contract.js";
import { buildMethodologyContrasts } from "../eval/methodology-contrasts.js";
import { buildMethodologyResourceSet, type MethodologyResourceSetArtifact } from "../eval/methodology-resource-artifact.js";
import {
  buildMethodologySchedule,
  methodologyArmConfigIdentitySha256,
  type MethodologyDesign,
} from "../eval/methodology-schedule.js";
import { historicalPermittedMetrics, parseHistoricalGroundTruth } from "../eval/historical-truth.js";
import { validateMethodologyGradeSet } from "../eval/methodology-adjudication.js";
import { historicalTruthScopeSha256 } from "../eval/historical-curation.js";

const digest = (character: string): string => character.repeat(64);
const truth = parseHistoricalGroundTruth({
  schemaVersion: 2,
  scope: {
    protocol: "historical-efficacy-v1", truthVersion: "truth-v1", status: "known-roots",
    completeness: "partial", reviewedScope: "The registered callback root.",
    permittedMetrics: historicalPermittedMetrics("known-roots"),
  },
  bugs: [{
    id: "bug-aaaaaaaa", rootCauseGroup: "root-bbbbbbbb", lane: "other-unclassified",
    mechanismFamily: "callback-loss", proofLevel: "complete-static-trace", expectedDisposition: "fix-in-pr",
    expectedSeverity: "high", file: "src/worker.ts", startLine: 1, endLine: 2,
    description: "The callback is dropped.", reachablePreconditions: "The retry branch is taken.",
    observableImpact: "The request remains pending.", provenance: "The frozen history establishes this root.",
  }],
});
const review = {
  status: "completed" as const, limitations: [], findings: [{
    file: "src/worker.ts", startLine: 1, endLine: 2,
    explanation: "The callback is dropped.", impact: "The request remains pending.", severity: "high" as const,
  }],
};
const unable = { status: "unable-to-complete" as const, limitations: ["Synthetic incomplete attempt."], findings: [] };

function fixture() {
  const runId = "contrast-fixture";
  const executionEvidenceSha256 = digest("a");
  const inputPlanSha256 = digest("b");
  const designWithoutArms: Omit<MethodologyDesign, "arms"> = {
    schemaVersion: 1, protocol: "historical-methodology-v1", seed: 11, repeats: 2,
    callerConfig: { runner: "codex", model: "gpt-5.6-sol", effort: "high", identitySha256: digest("c") },
    totalDeadlineMs: 60_000, twoWorkerStageSplit: { discoveryDeadlineMs: 20_000, reviewerDeadlineMs: 40_000 },
  };
  const design: MethodologyDesign = { ...designWithoutArms, arms: (["A", "B", "C", "D"] as const).map((armId) => {
    const configName = `arm-${armId.toLowerCase()}`;
    return { armId, configName, configIdentitySha256: methodologyArmConfigIdentitySha256({ design: designWithoutArms, armId, configName }) };
  }) };
  const schedule = buildMethodologySchedule({ design, cases: [{ caseName: "development/case-aaaaaaaa", corpus: "development", expectedBugCount: 1 }] });
  const grades = schedule.attempts.map((attempt) => {
    const completed = attempt.armId !== "D" || attempt.repeat === 1;
    const matched = attempt.armId !== "C";
    const projection: MethodologyGradingProjection = {
      schemaVersion: 2, kind: "methodology-grading-projection", executionEvidenceSha256, inputPlanSha256,
      caseRegistrationSha256: digest("d"), caseName: attempt.caseName, attemptId: attempt.id,
      truthSha256: canonicalJsonSha256(truth), truthScopeSha256: historicalTruthScopeSha256(truth),
      status: completed ? "completed" : "incomplete",
      statusReason: completed ? "authenticated-complete" : "model-unable-to-complete",
      lifecycleTerminalSha256: digest("e"), reviewTerminalSha256: digest("f"),
      reviewRawOutputSha256: digest("0"), reviewOutputSha256: methodologyReviewOutputSha256(completed ? review : unable),
    };
    const pairVerdicts = completed ? [{
      comparisonId: methodologyComparisonId({ bug: truth.bugs[0]!, finding: review.findings[0]!, judgeConfigSha256: digest("1") }),
      bugId: truth.bugs[0]!.id, findingIndex: 0,
      findingEvidenceSha256: methodologyFindingEvidenceSha256(review.findings[0]!),
      verdict: matched ? "same-root-cause" as const : "different-root-cause" as const,
    }] : [];
    return gradeMethodologyAttempt({ projection, expectedProjectionSha256: canonicalJsonSha256(projection), truth,
      reviewOutput: completed ? review : unable, judgeConfigSha256: digest("1"), pairVerdicts });
  });
  const root = mkdtempSync(join(tmpdir(), "methodology-contrast-test-"));
  const gradeSet = writeMethodologyGradeSet(root, { runId, schedule, executionEvidenceSha256, inputPlanSha256, grades, recordedAt: "2026-09-08T00:00:00.000Z" });
  let recordIndex = 0;
  const records: MethodologyAdjudicationRecord[] = grades.flatMap((grade) => grade.unmatchedFindings.map((finding) => ({
    attemptId: grade.projection.attemptId, findingIndex: finding.findingIndex,
    findingEvidenceSha256: finding.findingEvidenceSha256,
    classification: recordIndex++ === 0 ? "confirmed-new" as const : "unsupported" as const,
    rationale: "Synthetic adjudicated finding.", evidence: "Synthetic evidence.",
  })));
  const adjudication = buildMethodologyAdjudicationLedger({ runId, executionEvidenceSha256, inputPlanSha256,
    expectedAttemptIds: schedule.attempts.map((attempt) => attempt.id), grades,
    curatorIdentitySha256: digest("2"), reviewProtocol: "blind-to-arm-route-timing-v1", records,
    recordedAt: "2026-09-08T00:00:00.000Z" });
  const resources = schedule.attempts.map((attempt) => {
    const completed = true;
    return { attemptId: attempt.id, caseName: attempt.caseName, armId: attempt.armId, expectedStages: attempt.expectedStages,
      observedStages: completed ? attempt.expectedStages : 0, outcome: completed ? "completed" as const : "interrupted" as const,
      wallDurationMs: completed ? (attempt.armId === "D" ? 20 : 10) : null,
      reviewDurationMs: completed ? 1 : null, usage: completed ? { provider: "mock" as const } : null,
      lifecycleTerminalSha256: digest("e"), reviewTerminalSha256: completed ? digest("f") : null };
  });
  const resourceSet = buildMethodologyResourceSet({ runId, schedule, executionEvidenceSha256,
    invocationRegistrationSha256: digest("3"), inputPlanSha256, resources, recordedAt: "2026-09-08T00:00:00.000Z" });
  return { root, schedule, gradeSet, adjudication, resourceSet };
}

test("calculates exact failure-inclusive arm metrics, contrasts, and interaction", () => {
  const fixtureData = fixture();
  try {
    const result = buildMethodologyContrasts(fixtureData);
    assert.equal(result.arms.C.registeredKnownRootRecall.caseMacro, 0);
    assert.equal(result.arms.D.registeredKnownRootRecall.caseMacro, 0.5);
    assert.equal(result.arms.D.completion.rate, 0.5);
    assert.equal(result.arms.C.unsupportedFindings.perScheduledReview, 0.5);
    assert.equal(result.arms.C.confirmedNewFindingOccurrences.perScheduledReview, 0.5);
    assert.equal(result.contrasts["D-vs-C"].confirmedNewFindingOccurrencesPerScheduledReview.delta, -0.5);
    assert.equal(result.contrasts["D-vs-C"].registeredKnownRootRecall.delta, 0.5);
    assert.equal(result.contrasts["D-vs-C"].completionRate.delta, -0.5);
    assert.equal(result.interaction.registeredKnownRootRecall, 0.5);
    assert.equal(result.claims.discovery, "finding-occurrences-only-root-deduplication-required");
    assert.equal(result.gradeSetArtifactSha256, fixtureData.gradeSet.artifactSha256);
    assert.equal(result.resourceSetArtifactSha256, fixtureData.resourceSet.artifactSha256);
    assert.equal("gradeSetSha256" in result, false);
    assert.equal("resourceSetSha256" in result, false);
    assert.match(result.contrastSha256, /^[a-f0-9]{64}$/);
    const { contrastSha256, ...body } = result;
    assert.equal(contrastSha256, canonicalJsonSha256(body));
  } finally { rmSync(fixtureData.root, { recursive: true, force: true }); }
});

function alteredGradeSet(fixtureData: ReturnType<typeof fixture>, rootCauseMatches: Record<string, boolean> | ((index: number) => Record<string, boolean>)) {
  const grades = fixtureData.gradeSet.grades.map((grade, index) => {
    const { gradeSha256: _oldGradeSha256, ...withoutDigest } = grade;
    const body = { ...withoutDigest, rootCauseMatches: typeof rootCauseMatches === "function" ? rootCauseMatches(index) : rootCauseMatches };
    return { ...body, gradeSha256: methodologyAttemptGradeSha256(body) };
  });
  return rebuiltGradeSet(fixtureData, grades);
}

function rebuiltGradeSet(fixtureData: ReturnType<typeof fixture>, grades: typeof fixtureData.gradeSet.grades) {
  const validation = validateMethodologyGradeSet({
    executionEvidenceSha256: fixtureData.gradeSet.executionEvidenceSha256,
    inputPlanSha256: fixtureData.gradeSet.inputPlanSha256,
    expectedAttemptIds: fixtureData.schedule.attempts.map((attempt) => attempt.id), grades,
  });
  const { artifactSha256: _oldArtifactSha256, ...withoutArtifactDigest } = fixtureData.gradeSet;
  const gradeSetBody = { ...withoutArtifactDigest, grades: validation.grades, gradeSetSha256: validation.gradeSetSha256 };
  return { ...gradeSetBody, artifactSha256: canonicalJsonSha256(gradeSetBody) };
}

function ledgerFor(fixtureData: ReturnType<typeof fixture>, gradeSet: MethodologyGradeSetArtifact) {
  return buildMethodologyAdjudicationLedger({
    runId: gradeSet.runId, executionEvidenceSha256: gradeSet.executionEvidenceSha256,
    inputPlanSha256: gradeSet.inputPlanSha256, expectedAttemptIds: fixtureData.schedule.attempts.map((attempt) => attempt.id),
    grades: gradeSet.grades, curatorIdentitySha256: digest("2"), reviewProtocol: "blind-to-arm-route-timing-v1",
    records: gradeSet.grades.flatMap((grade) => grade.unmatchedFindings.map((finding) => ({
      attemptId: grade.projection.attemptId, findingIndex: finding.findingIndex,
      findingEvidenceSha256: finding.findingEvidenceSha256, classification: "unsupported" as const,
      rationale: "Synthetic unsupported finding.", evidence: "Synthetic evidence.",
    }))), recordedAt: gradeSet.recordedAt,
  });
}

test("rejects a uniform but short registered-root roster", () => {
  const fixtureData = fixture();
  try {
    const gradeSet = alteredGradeSet(fixtureData, {});
    assert.throws(() => buildMethodologyContrasts({ ...fixtureData, gradeSet, adjudication: ledgerFor(fixtureData, gradeSet) }), /root count/);
  } finally { rmSync(fixtureData.root, { recursive: true, force: true }); }
});

test("rejects a registered-root roster mismatch across arms or repeats", () => {
  const fixtureData = fixture();
  try {
    const gradeSet = alteredGradeSet(fixtureData, (index): Record<string, boolean> => index === 0
      ? { "root-cccccccc": false } : { "root-bbbbbbbb": false });
    assert.throws(() => buildMethodologyContrasts({ ...fixtureData, gradeSet, adjudication: ledgerFor(fixtureData, gradeSet) }), /roster differs/);
  } finally { rmSync(fixtureData.root, { recursive: true, force: true }); }
});

test("keeps unresolved findings visible and reports unknown wall time explicitly", () => {
  const fixtureData = fixture();
  try {
    const unresolved = { ...fixtureData.adjudication, records: fixtureData.adjudication.records.map((record) => ({ ...record, classification: "unresolved" as const })) };
    const noWallResourceSet = buildMethodologyResourceSet({ ...fixtureData.resourceSet,
      schedule: fixtureData.schedule,
      resources: fixtureData.resourceSet.resources.map((resource) => ({ ...resource, wallDurationMs: null })),
    });
    const result = buildMethodologyContrasts({ ...fixtureData, resourceSet: noWallResourceSet, adjudication: buildMethodologyAdjudicationLedger({
      runId: unresolved.runId, executionEvidenceSha256: unresolved.executionEvidenceSha256, inputPlanSha256: unresolved.inputPlanSha256,
      expectedAttemptIds: fixtureData.schedule.attempts.map((attempt) => attempt.id), grades: fixtureData.gradeSet.grades,
      curatorIdentitySha256: unresolved.curatorIdentitySha256, reviewProtocol: unresolved.reviewProtocol,
      records: unresolved.records, recordedAt: unresolved.recordedAt,
    }) });
    assert.ok(result.integrity.unresolvedFindings > 0);
    assert.ok(result.integrity.blockers.some((blocker) => blocker.includes("unresolved")));
    assert.equal(result.contrasts["D-vs-C"].pairedWallTime.ratio, null);
    assert.equal(result.contrasts["D-vs-C"].pairedWallTime.status, "unknown");
  } finally { rmSync(fixtureData.root, { recursive: true, force: true }); }
});

test("rejects terminal/status/outcome and cross-repeat truth binding mutations", () => {
  const fixtureData = fixture();
  try {
    const terminalResources = buildMethodologyResourceSet({ ...fixtureData.resourceSet,
      schedule: fixtureData.schedule,
      resources: fixtureData.resourceSet.resources.map((resource, index) => index === 0
        ? { ...resource, lifecycleTerminalSha256: digest("9") } : resource),
    });
    assert.throws(() => buildMethodologyContrasts({ ...fixtureData, resourceSet: terminalResources }), /terminal digest/);

    const outcomeResources = buildMethodologyResourceSet({ ...fixtureData.resourceSet,
      schedule: fixtureData.schedule,
      resources: fixtureData.resourceSet.resources.map((resource, index) => index === 0
        ? { ...resource, outcome: "review-failed" as const } : resource),
    });
    assert.throws(() => buildMethodologyContrasts({ ...fixtureData, resourceSet: outcomeResources }), /status\/outcome/);

    const changedGrades = fixtureData.gradeSet.grades.map((grade, index) => {
      if (index !== 0) return grade;
      const { gradeSha256: _oldGradeSha256, ...withoutDigest } = grade;
      const body = { ...withoutDigest, projection: { ...grade.projection, truthSha256: digest("8") } };
      return { ...body, gradeSha256: methodologyAttemptGradeSha256(body) };
    });
    const changedGradeSet = rebuiltGradeSet(fixtureData, changedGrades);
    assert.throws(() => buildMethodologyContrasts({ ...fixtureData, gradeSet: changedGradeSet,
      adjudication: ledgerFor(fixtureData, changedGradeSet) }), /case artifact bindings/);
  } finally { rmSync(fixtureData.root, { recursive: true, force: true }); }
});

test("requires strictly positive paired wall durations", () => {
  const fixtureData = fixture();
  try {
    const zeroWallResourceSet = buildMethodologyResourceSet({ ...fixtureData.resourceSet,
      schedule: fixtureData.schedule,
      resources: fixtureData.resourceSet.resources.map((resource) => ({ ...resource, wallDurationMs: 0 })),
    });
    const result = buildMethodologyContrasts({ ...fixtureData, resourceSet: zeroWallResourceSet });
    assert.equal(result.contrasts["D-vs-C"].pairedWallTime.ratio, null);
    assert.equal(result.contrasts["D-vs-C"].pairedWallTime.status, "unknown");
    assert.equal(result.contrasts["D-vs-C"].pairedWallTime.reason, "non-positive-denominator");
  } finally { rmSync(fixtureData.root, { recursive: true, force: true }); }
});

test("excludes a resource-completed block when grading is incomplete", () => {
  const fixtureData = fixture();
  try {
    const incompleteGrades = fixtureData.gradeSet.grades.map((grade) => {
      const attempt = fixtureData.schedule.attempts.find((candidate) => candidate.id === grade.projection.attemptId)!;
      if (attempt.armId !== "D") return grade;
      const { gradeSha256: _oldGradeSha256, ...withoutDigest } = grade;
      const body = { ...withoutDigest, completion: { scheduled: 1 as const, completed: 0 as const, incomplete: 1 as const, failed: 0 as const, missing: 0 as const } };
      return { ...body, gradeSha256: methodologyAttemptGradeSha256(body) };
    });
    const gradeSet = rebuiltGradeSet(fixtureData, incompleteGrades);
    const result = buildMethodologyContrasts({ ...fixtureData, gradeSet, adjudication: ledgerFor(fixtureData, gradeSet) });
    assert.equal(result.contrasts["D-vs-C"].pairedWallTime.eligibleBlocks, 0);
    assert.equal(result.contrasts["D-vs-C"].pairedWallTime.ratio, null);
    assert.equal(result.contrasts["D-vs-C"].pairedWallTime.status, "unknown");
  } finally { rmSync(fixtureData.root, { recursive: true, force: true }); }
});

test("rejects tampering, cross-run inputs, and reordered resources", () => {
  const fixtureData = fixture();
  try {
    assert.throws(() => buildMethodologyContrasts({ ...fixtureData, gradeSet: { ...fixtureData.gradeSet, runId: "other-run" } }), /grade-set artifact digest mismatch|binding/);
    assert.throws(() => buildMethodologyContrasts({ ...fixtureData, adjudication: { ...fixtureData.adjudication, runId: "other-run" } }), /ledger|binding|digest/);
    const reordered = [...fixtureData.resourceSet.resources].reverse();
    assert.throws(() => buildMethodologyContrasts({ ...fixtureData, resourceSet: { ...fixtureData.resourceSet, resources: reordered } }), /resource-set|order|digest/);
  } finally { rmSync(fixtureData.root, { recursive: true, force: true }); }
});
