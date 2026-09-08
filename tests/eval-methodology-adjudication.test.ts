import assert from "node:assert/strict";
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
  return { grade, record, input };
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
