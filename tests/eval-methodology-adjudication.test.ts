import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildMethodologyAdjudicationLedger,
  methodologyAdjudicationMap,
  adjudicationKey,
  type MethodologyAdjudicationRecord,
} from "../eval/methodology-adjudication.js";
import {
  gradeMethodologyAttempt,
  methodologyReviewOutputSha256,
  type MethodologyGradingProjection,
} from "../eval/methodology-grading-contract.js";
import { canonicalJsonSha256 } from "../eval/experiment.js";
import { historicalTruthScopeSha256 } from "../eval/historical-curation.js";
import { historicalPermittedMetrics, parseHistoricalGroundTruth } from "../eval/historical-truth.js";
import { buildMethodologyReport } from "../eval/methodology-report.js";
import {
  buildMethodologySchedule,
  methodologyArmConfigIdentitySha256,
  type MethodologyDesign,
} from "../eval/methodology-schedule.js";
import {
  METHODOLOGY_REPORT_FILE,
  readMethodologyAdjudicationArtifact,
  readMethodologyGradeSet,
  readMethodologyReportArtifact,
  writeMethodologyAdjudicationArtifact,
  writeMethodologyGradeSet,
  writeMethodologyReportArtifact,
} from "../eval/methodology-analysis-artifacts.js";

const digest = (character: string): string => character.repeat(64);

function fixture() {
  const truth = parseHistoricalGroundTruth({
    schemaVersion: 2,
    scope: {
      protocol: "historical-efficacy-v1",
      truthVersion: "truth-v1",
      status: "reviewed-comparison",
      completeness: "partial",
      reviewedScope: "Only the changed retry behavior; this is not a global clean assertion.",
      permittedMetrics: historicalPermittedMetrics("reviewed-comparison"),
    },
    bugs: [],
  });
  const review = {
    status: "completed" as const,
    limitations: [],
    findings: [{
      file: "src/retry.ts",
      startLine: 5,
      endLine: 6,
      explanation: "The changed retry branch can invoke the callback twice.",
      impact: "One request can complete twice.",
      severity: "high" as const,
    }],
  };
  const projection: MethodologyGradingProjection = {
    schemaVersion: 2,
    kind: "methodology-grading-projection",
    executionEvidenceSha256: digest("a"),
    inputPlanSha256: digest("b"),
    caseRegistrationSha256: digest("c"),
    truthSha256: canonicalJsonSha256(truth),
    truthScopeSha256: historicalTruthScopeSha256(truth),
    attemptId: "attempt-000001",
    caseName: "development/case-aaaaaaaa",
    status: "completed",
    statusReason: "authenticated-complete",
    lifecycleTerminalSha256: digest("d"),
    reviewTerminalSha256: digest("e"),
    reviewRawOutputSha256: digest("f"),
    reviewOutputSha256: methodologyReviewOutputSha256(review),
  };
  const grade = gradeMethodologyAttempt({
    projection,
    expectedProjectionSha256: canonicalJsonSha256(projection),
    truth,
    reviewOutput: review,
    judgeConfigSha256: digest("1"),
    pairVerdicts: [],
  });
  const unmatched = grade.unmatchedFindings[0]!;
  const record: MethodologyAdjudicationRecord = {
    attemptId: projection.attemptId,
    findingIndex: unmatched.findingIndex,
    findingEvidenceSha256: unmatched.findingEvidenceSha256,
    classification: "unresolved",
    rationale: "The narrow comparison scope does not settle this additional causal claim.",
    evidence: "No independent reproduction or complete static trace is available yet.",
  };
  const input = {
    runId: "methodology-development-v1",
    executionEvidenceSha256: projection.executionEvidenceSha256,
    inputPlanSha256: projection.inputPlanSha256,
    expectedAttemptIds: [projection.attemptId],
    grades: [grade],
    curatorIdentitySha256: digest("2"),
    reviewProtocol: "blind-to-arm-route-timing-v1" as const,
    records: [record],
    recordedAt: "2026-09-08T02:00:00.000Z",
  };
  return { truth, review, projection, grade, record, input };
}

test("adjudication binds the run and decides every unmatched finding while retaining unresolved", () => {
  const { record, input } = fixture();
  const ledger = buildMethodologyAdjudicationLedger(input);
  assert.deepEqual(ledger.counts, { "confirmed-new": 0, unsupported: 0, unresolved: 1 });
  assert.equal(methodologyAdjudicationMap(ledger).get(adjudicationKey(record)), "unresolved");
  assert.match(ledger.ledgerSha256, /^[a-f0-9]{64}$/);
  assert.match(ledger.gradeSetSha256, /^[a-f0-9]{64}$/);
});

test("adjudication rejects missing, extra, duplicate, stale, and cross-run decisions", () => {
  const { grade, record, input } = fixture();
  assert.throws(() => buildMethodologyAdjudicationLedger({ ...input, records: [] }), /every and only/);
  assert.throws(() => buildMethodologyAdjudicationLedger({
    ...input,
    expectedAttemptIds: ["attempt-000001", "attempt-000002"],
  }), /every scheduled grade/);
  assert.throws(() => buildMethodologyAdjudicationLedger({
    ...input,
    records: [record, { ...record }],
  }), /duplicate/);
  assert.throws(() => buildMethodologyAdjudicationLedger({
    ...input,
    records: [{ ...record, findingIndex: 7 }],
  }), /every and only/);
  assert.throws(() => buildMethodologyAdjudicationLedger({
    ...input,
    grades: [{ ...grade, gradeSha256: digest("9") }],
  }), /grade digest/);
  assert.throws(() => buildMethodologyAdjudicationLedger({
    ...input,
    executionEvidenceSha256: digest("8"),
  }), /do not belong/);
});

test("report applies partial-truth eligibility and unresolved bounds per arm", () => {
  const base = fixture();
  const designWithoutArms: Omit<MethodologyDesign, "arms"> = {
    schemaVersion: 1,
    protocol: "historical-methodology-v1",
    seed: 17,
    repeats: 1,
    callerConfig: { runner: "codex", model: "gpt-5.6-sol", effort: "high", identitySha256: digest("3") },
    totalDeadlineMs: 60_000,
    twoWorkerStageSplit: { discoveryDeadlineMs: 20_000, reviewerDeadlineMs: 40_000 },
  };
  const design: MethodologyDesign = {
    ...designWithoutArms,
    arms: (["A", "B", "C", "D"] as const).map((armId) => ({
      armId,
      configName: `arm-${armId.toLowerCase()}`,
      configIdentitySha256: methodologyArmConfigIdentitySha256({
        design: designWithoutArms,
        armId,
        configName: `arm-${armId.toLowerCase()}`,
      }),
    })),
  };
  const schedule = buildMethodologySchedule({
    design,
    cases: [{
      caseName: base.projection.caseName,
      corpus: "development",
      expectedBugCount: 0,
    }],
  });
  const grades = schedule.attempts.map((attempt) => {
    const projection = { ...base.projection, attemptId: attempt.id };
    return gradeMethodologyAttempt({
      projection,
      expectedProjectionSha256: canonicalJsonSha256(projection),
      truth: base.truth,
      reviewOutput: base.review,
      judgeConfigSha256: digest("1"),
      pairVerdicts: [],
    });
  });
  const records = grades.map((grade): MethodologyAdjudicationRecord => ({
    attemptId: grade.projection.attemptId,
    findingIndex: grade.unmatchedFindings[0]!.findingIndex,
    findingEvidenceSha256: grade.unmatchedFindings[0]!.findingEvidenceSha256,
    classification: "unresolved",
    rationale: "The narrow comparison scope does not settle this claim.",
    evidence: "No independent evidence is available yet.",
  }));
  const ledger = buildMethodologyAdjudicationLedger({
    ...base.input,
    expectedAttemptIds: schedule.attempts.map((attempt) => attempt.id),
    grades,
    records,
  });
  const report = buildMethodologyReport({
    runId: base.input.runId,
    schedule,
    executionEvidenceSha256: base.input.executionEvidenceSha256,
    inputPlanSha256: base.input.inputPlanSha256,
    grades,
    adjudication: ledger,
  });
  assert.deepEqual(report.arms.map((arm) => arm.completion.scheduled), [1, 1, 1, 1]);
  assert.ok(report.arms.every((arm) => arm.registeredKnownRootRecall.micro === null));
  assert.ok(report.arms.every((arm) => arm.findings.precisionLower === 0 && arm.findings.precisionUpper === 1));
  assert.ok(report.arms.every((arm) => !arm.promotionalEligibility.eligible));
  assert.throws(() => buildMethodologyReport({
    runId: base.input.runId,
    schedule,
    executionEvidenceSha256: base.input.executionEvidenceSha256,
    inputPlanSha256: base.input.inputPlanSha256,
    grades,
    adjudication: { ...ledger, ledgerSha256: digest("9") },
  }), /ledger is invalid/);

  const root = mkdtempSync(join(tmpdir(), "peregrine-methodology-analysis-"));
  try {
    const gradeSet = writeMethodologyGradeSet(root, {
      runId: base.input.runId,
      schedule,
      executionEvidenceSha256: base.input.executionEvidenceSha256,
      inputPlanSha256: base.input.inputPlanSha256,
      grades,
      recordedAt: "2026-09-08T01:55:00.000Z",
    });
    assert.deepEqual(readMethodologyGradeSet(root, gradeSet.artifactSha256), gradeSet);
    const storedLedger = writeMethodologyAdjudicationArtifact(root, {
      gradeSet,
      curatorIdentitySha256: base.input.curatorIdentitySha256,
      records,
      recordedAt: base.input.recordedAt,
    });
    assert.deepEqual(readMethodologyAdjudicationArtifact(root, {
      expectedLedgerSha256: storedLedger.ledgerSha256,
      gradeSet,
    }), storedLedger);
    const storedReport = writeMethodologyReportArtifact(root, {
      schedule,
      gradeSet,
      adjudication: storedLedger,
    });
    assert.deepEqual(readMethodologyReportArtifact(root, {
      expectedReportSha256: storedReport.reportSha256,
      gradeSet,
      adjudication: storedLedger,
    }), storedReport);
    assert.throws(() => writeMethodologyReportArtifact(root, {
      schedule,
      gradeSet,
      adjudication: storedLedger,
    }), /EEXIST|exists/i);
    const reportPath = join(root, METHODOLOGY_REPORT_FILE);
    const changed = JSON.parse(readFileSync(reportPath, "utf8"));
    changed.claims.resourceUse = "complete";
    writeFileSync(reportPath, JSON.stringify(changed));
    assert.throws(() => readMethodologyReportArtifact(root, {
      expectedReportSha256: storedReport.reportSha256,
      gradeSet,
      adjudication: storedLedger,
    }), /digest mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
