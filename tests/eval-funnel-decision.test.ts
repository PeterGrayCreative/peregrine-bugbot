import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJsonSha256 } from "../eval/experiment.js";
import { loadBenchmarkPanelRegistry } from "../eval/benchmark-panels.js";
import {
  evaluateFunnelDecision,
  deriveFunnelMetrics,
  parseFunnelDecisionArtifact,
  type FunnelCompletion,
  type FunnelMetrics,
} from "../eval/funnel-decision.js";
import type { BenchmarkCategory, ExperimentBenchmarkCategory } from "../src/types.js";
import type { GradedRun, GroundTruth, RunRecord } from "../src/types.js";
import type { ExperimentScheduledAttempt } from "../eval/experiment.js";

const registry = loadBenchmarkPanelRegistry();
const complete: FunnelCompletion = {
  control: { scheduled: 24, completed: 24, failed: 0 },
  treatment: { scheduled: 24, completed: 24, failed: 0 },
};
const metrics: FunnelMetrics = {
  reliableHighSeverityRegressions: [],
  reliableOtherRegressions: [],
  blockingUnsupportedFindings: { control: 0, treatment: 0 },
  confirmedNewFindingsOnCleanControls: 0,
  unresolvedRequiredAdjudications: 0,
  diagnosticExcludedFindingCount: 0,
  efficiency: {
    metric: "paired-median-wall-time",
    targetImprovementPercent: 20,
    observedImprovementPercent: 24,
    confidenceIntervalPercent: { lower: 3, upper: 40 },
    pairedAttempts: 24,
    resamplingUnit: "case",
  },
};

test("diagnostic and stopped runs can never advance", () => {
  assert.equal(evaluateFunnelDecision({
    binding: binding("fast-screen", "treatment-only-diagnostic"), terminal: "completed",
    completion: { ...complete, control: { scheduled: 0, completed: 0, failed: 0 } }, metrics: null,
  }).status, "diagnostic-only");
  assert.equal(evaluateFunnelDecision({
    binding: binding("fast-screen"), terminal: "stopped", completion: complete, metrics: null,
  }).status, "reject");
});

test("safety and completion regressions reject before efficiency", () => {
  for (const changed of [
    { metrics: { ...metrics, reliableHighSeverityRegressions: ["case/root"] }, completion: complete },
    { metrics: { ...metrics, blockingUnsupportedFindings: { control: 0, treatment: 1 } }, completion: complete },
    { metrics, completion: { ...complete, treatment: { scheduled: 24, completed: 23, failed: 1 } } },
  ]) {
    assert.equal(evaluateFunnelDecision({ binding: binding("fast-screen"), terminal: "completed", ...changed }).status, "reject");
  }
  assert.equal(evaluateFunnelDecision({
    binding: binding("smoke"), terminal: "completed",
    completion: {
      control: { scheduled: 6, completed: 0, failed: 6 },
      treatment: { scheduled: 6, completed: 0, failed: 6 },
    },
    metrics: { ...metrics, efficiency: { ...metrics.efficiency, targetImprovementPercent: null, observedImprovementPercent: null, pairedAttempts: 0 } },
  }).status, "reject");
});

test("frozen stage gates distinguish promising, unattainable, and confirmed efficiency", () => {
  assert.equal(evaluateFunnelDecision({ binding: binding("fast-screen"), terminal: "completed", completion: complete, metrics }).status, "advance");
  assert.equal(evaluateFunnelDecision({
    binding: binding("fast-screen"), terminal: "completed", completion: complete,
    metrics: { ...metrics, efficiency: { ...metrics.efficiency, confidenceIntervalPercent: { lower: 1, upper: 19 } } },
  }).status, "reject");
  assert.equal(evaluateFunnelDecision({ binding: binding("confirmation"), terminal: "completed", completion: complete, metrics }).status, "advance");
  assert.equal(evaluateFunnelDecision({ binding: binding("full-checkpoint"), terminal: "completed", completion: complete, metrics }).status, "visible-funnel-complete");
});

test("unresolved adjudications and weak confirmation remain inconclusive", () => {
  assert.equal(evaluateFunnelDecision({
    binding: binding("fast-screen"), terminal: "completed", completion: complete,
    metrics: { ...metrics, unresolvedRequiredAdjudications: 1 },
  }).status, "inconclusive");
  assert.equal(evaluateFunnelDecision({
    binding: binding("confirmation"), terminal: "completed", completion: complete,
    metrics: { ...metrics, efficiency: { ...metrics.efficiency, observedImprovementPercent: 12, confidenceIntervalPercent: { lower: -2, upper: 28 } } },
  }).status, "inconclusive");
});

test("decision artifacts reject mutation after their content address is written", () => {
  const body = {
    schemaVersion: 1 as const, experimentId: "a".repeat(64), benchmarkCategory: binding("fast-screen"),
    terminalSealSha256: "b".repeat(64), terminal: "completed" as const,
    gradingSealSha256: "c".repeat(64), completion: complete, metrics,
    result: evaluateFunnelDecision({ binding: binding("fast-screen"), terminal: "completed", completion: complete, metrics }),
  };
  const artifact = { ...body, decisionSha256: canonicalJsonSha256(body) };
  assert.deepEqual(parseFunnelDecisionArtifact(artifact), artifact);
  const { gradingSealSha256: _gradingSealSha256, ...ungradedBody } = body;
  assert.throws(() => parseFunnelDecisionArtifact({
    ...ungradedBody, decisionSha256: canonicalJsonSha256(ungradedBody),
  }), /gradingSealSha256/);
  assert.throws(() => parseFunnelDecisionArtifact({ ...artifact, completion: { ...complete, control: { ...complete.control, completed: 0 } } }), /authenticate/);
});

test("adjudicated decision artifacts link to the original decision and ledger", () => {
  const body = {
    schemaVersion: 2 as const, experimentId: "a".repeat(64), benchmarkCategory: binding("fast-screen"),
    terminalSealSha256: "b".repeat(64), terminal: "completed" as const,
    gradingSealSha256: "c".repeat(64), completion: complete, metrics,
    result: evaluateFunnelDecision({ binding: binding("fast-screen"), terminal: "completed", completion: complete, metrics }),
    previousDecisionSha256: "d".repeat(64), adjudicationLedgerSha256: "e".repeat(64),
  };
  const artifact = { ...body, decisionSha256: canonicalJsonSha256(body) };
  assert.deepEqual(parseFunnelDecisionArtifact(artifact), artifact);
  const { adjudicationLedgerSha256: _ledger, ...invalidBody } = body;
  assert.throws(() => parseFunnelDecisionArtifact({
    ...invalidBody, decisionSha256: canonicalJsonSha256(invalidBody),
  }), /linkage/);
});

test("metrics are derived from per-repeat roots, paired durations, and structured diagnostic exclusions", () => {
  const scheduled = [
    scheduledAttempt("attempt-000001", "block-000001", "control", 1),
    scheduledAttempt("attempt-000002", "block-000001", "treatment", 1),
    scheduledAttempt("attempt-000003", "block-000002", "control", 2),
    scheduledAttempt("attempt-000004", "block-000002", "treatment", 2),
  ];
  const records = scheduled.map((attempt) => record(attempt, attempt.variant === "control" ? 100 : 75));
  const grades = new Map(scheduled.map((attempt) => [attempt.id, grade(attempt, attempt.variant === "control")]));
  const truth: GroundTruth = { bugs: [{
    id: "bug-11111111", lane: "authorization", expectedDisposition: "fix-in-pr", expectedSeverity: "high",
    file: "src/a.ts", startLine: 1, endLine: 1, description: "root", reachablePreconditions: "reachable",
    observableImpact: "impact", provenance: "fixture",
  }] };
  const result = deriveFunnelMetrics({
    binding: binding("fast-screen"), schedule: scheduled, records, gradedRuns: grades,
    truths: new Map([["development/case-13f0a2c1", truth]]),
  });
  assert.equal(result.reliableHighSeverityRegressions.length, 1);
  assert.equal(result.efficiency.observedImprovementPercent, 25);
  assert.equal(result.efficiency.pairedAttempts, 2);

  const diagnosticAttempt = scheduledAttempt("attempt-000005", "block-000003", "control", 1, "validation/case-d3f8026e");
  const diagnosticGrade = grade(diagnosticAttempt, false, "unsupported");
  const diagnostic = deriveFunnelMetrics({
    binding: binding("confirmation"), schedule: [diagnosticAttempt], records: [record(diagnosticAttempt, 100)],
    gradedRuns: new Map([[diagnosticAttempt.id, diagnosticGrade]]), truths: new Map([[diagnosticAttempt.caseName, truth]]),
  });
  assert.equal(diagnostic.diagnosticExcludedFindingCount, 1);
  assert.deepEqual(diagnostic.blockingUnsupportedFindings, { control: 0, treatment: 0 });

  const cleanAttempt = scheduledAttempt(
    scheduled[0]!.id,
    scheduled[0]!.blockId,
    scheduled[0]!.variant as "control",
    scheduled[0]!.repeat,
    "development/case-5ea42d18",
  );
  const unresolvedGrade = grade(cleanAttempt, false) as GradedRun;
  unresolvedGrade.outcome.result.findings = [{ disposition: "fix-in-pr" }] as GradedRun["outcome"]["result"]["findings"];
  unresolvedGrade.grading!.unmatchedFindings = [{
    findingIndex: 0, findingEvidenceSha256: "a".repeat(64), classification: "unresolved",
  }];
  const adjudicated = deriveFunnelMetrics({
    binding: binding("fast-screen"), schedule: [cleanAttempt], records: [record(cleanAttempt, 100)],
    gradedRuns: new Map([[cleanAttempt.id, unresolvedGrade]]),
    truths: new Map([[cleanAttempt.caseName, truth]]),
    adjudications: new Map([[`${cleanAttempt.id}\0${0}\0${"a".repeat(64)}`, "unsupported"]]),
  });
  assert.equal(adjudicated.unresolvedRequiredAdjudications, 0);
  assert.equal(adjudicated.blockingUnsupportedFindings.control, 1);
});

function binding(
  name: BenchmarkCategory,
  evidenceUse: ExperimentBenchmarkCategory["evidenceUse"] = "paired-acceptance",
): ExperimentBenchmarkCategory {
  const definition = registry.panels[name];
  const restrictedCasePolicies = registry.excludedCases.filter((item) => definition.caseIds.includes(item.caseId));
  return { name, evidenceUse, definition, restrictedCasePolicies, definitionSha256: canonicalJsonSha256({ definition, restrictedCasePolicies }) };
}

function scheduledAttempt(
  id: string, blockId: string, variant: "control" | "treatment", repeat: number,
  caseName = "development/case-13f0a2c1",
): ExperimentScheduledAttempt {
  return { id, blockId, sequence: Number(id.slice(-1)), caseName, corpus: caseName.startsWith("validation/") ? "validation" : "development",
    expectedBugCount: 1, configName: variant, repeat, runner: "codex", variant, position: variant === "control" ? 1 : 2, file: `${id}.json` };
}
function record(attempt: ExperimentScheduledAttempt, attemptDurationMs: number): RunRecord {
  return { attemptId: attempt.id, caseName: attempt.caseName, attemptDurationMs, outcome: { status: "completed", result: { findings: [] } } } as unknown as RunRecord;
}
function grade(
  attempt: ExperimentScheduledAttempt, matched: boolean, classification?: "unsupported",
): GradedRun {
  const findings = classification ? [{ disposition: "fix-in-pr" }] : matched ? [{}] : [];
  return { attemptId: attempt.id, matches: { "bug-11111111": matched ? 0 : null }, outcome: { status: "completed", result: { findings } },
    grading: { unmatchedFindings: classification ? [{ findingIndex: 0, findingEvidenceSha256: "a".repeat(64), classification }] : [] } } as unknown as GradedRun;
}
