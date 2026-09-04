import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateFunnelDecision,
  parseFunnelAssessment,
  type FunnelAssessment,
  type FunnelCompletion,
} from "../eval/funnel-decision.js";

const assessment: FunnelAssessment = {
  schemaVersion: 1,
  experimentId: "a".repeat(64),
  benchmarkCategory: "fast-screen",
  reliableHighSeverityRegressions: 0,
  reliableOtherRegressions: 0,
  blockingUnsupportedFindings: { control: 0, treatment: 0 },
  unresolvedRequiredAdjudications: 0,
  efficiency: {
    metric: "paired-median-wall-time",
    targetImprovementPercent: 20,
    observedImprovementPercent: 12,
    confidenceIntervalPercent: { lower: -2, upper: 28 },
  },
  notes: ["Diagnostic-only cases were excluded from unsupported-finding counts."],
};

const complete: FunnelCompletion = {
  control: { scheduled: 24, completed: 24, failed: 0 },
  treatment: { scheduled: 24, completed: 24, failed: 0 },
};

test("funnel assessment parsing is strict and bounded", () => {
  assert.deepEqual(parseFunnelAssessment(assessment), assessment);
  assert.throws(() => parseFunnelAssessment({ ...assessment, extra: true }), /unsupported field/);
  assert.throws(() => parseFunnelAssessment({
    ...assessment,
    reliableHighSeverityRegressions: -1,
  }), /non-negative integer/);
});

test("diagnostic and stopped runs can never advance", () => {
  assert.equal(evaluateFunnelDecision({
    category: "fast-screen",
    evidenceUse: "treatment-only-diagnostic",
    terminal: "completed",
    completion: { ...complete, control: { scheduled: 0, completed: 0, failed: 0 } },
    assessment,
  }).status, "diagnostic-only");
  assert.equal(evaluateFunnelDecision({
    category: "fast-screen",
    evidenceUse: "treatment-only-diagnostic",
    terminal: "stopped",
    completion: { ...complete, control: { scheduled: 0, completed: 0, failed: 0 } },
    assessment,
  }).status, "reject");
  assert.equal(evaluateFunnelDecision({
    category: "fast-screen",
    evidenceUse: "paired-acceptance",
    terminal: "stopped",
    completion: complete,
    assessment,
  }).status, "reject");
});

test("safety and completion regressions reject before efficiency", () => {
  for (const changed of [
    { assessment: { ...assessment, reliableHighSeverityRegressions: 1 }, completion: complete },
    {
      assessment: { ...assessment, blockingUnsupportedFindings: { control: 0, treatment: 1 } },
      completion: complete,
    },
    {
      assessment,
      completion: { ...complete, treatment: { scheduled: 24, completed: 23, failed: 1 } },
    },
  ]) {
    assert.equal(evaluateFunnelDecision({
      category: "fast-screen",
      evidenceUse: "paired-acceptance",
      terminal: "completed",
      ...changed,
    }).status, "reject");
  }
});

test("stage gates distinguish promising, unattainable, and confirmed efficiency", () => {
  assert.deepEqual(evaluateFunnelDecision({
    category: "fast-screen",
    evidenceUse: "paired-acceptance",
    terminal: "completed",
    completion: complete,
    assessment,
  }).status, "advance");
  assert.equal(evaluateFunnelDecision({
    category: "fast-screen",
    evidenceUse: "paired-acceptance",
    terminal: "completed",
    completion: complete,
    assessment: {
      ...assessment,
      efficiency: { ...assessment.efficiency, confidenceIntervalPercent: { lower: 1, upper: 19 } },
    },
  }).status, "reject");
  const confirmed = {
    ...assessment,
    benchmarkCategory: "confirmation" as const,
    efficiency: {
      ...assessment.efficiency,
      observedImprovementPercent: 24,
      confidenceIntervalPercent: { lower: 3, upper: 40 },
    },
  };
  assert.equal(evaluateFunnelDecision({
    category: "confirmation",
    evidenceUse: "paired-acceptance",
    terminal: "completed",
    completion: complete,
    assessment: confirmed,
  }).status, "advance");
  assert.equal(evaluateFunnelDecision({
    category: "full-checkpoint",
    evidenceUse: "paired-acceptance",
    terminal: "completed",
    completion: complete,
    assessment: { ...confirmed, benchmarkCategory: "full-checkpoint" },
  }).status, "complete");
});

test("unresolved adjudications and weak confirmation remain inconclusive", () => {
  assert.equal(evaluateFunnelDecision({
    category: "fast-screen",
    evidenceUse: "paired-acceptance",
    terminal: "completed",
    completion: complete,
    assessment: { ...assessment, unresolvedRequiredAdjudications: 1 },
  }).status, "inconclusive");
  assert.equal(evaluateFunnelDecision({
    category: "confirmation",
    evidenceUse: "paired-acceptance",
    terminal: "completed",
    completion: complete,
    assessment: { ...assessment, benchmarkCategory: "confirmation" },
  }).status, "inconclusive");
});
