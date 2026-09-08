import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalJsonSha256 } from "../eval/experiment.js";
import {
  readMethodologyContrastArtifact,
  writeMethodologyContrastArtifact,
} from "../eval/methodology-contrast-artifacts.js";
import { buildMethodologyAdjudicationLedger } from "../eval/methodology-adjudication.js";
import { writeMethodologyGradeSet } from "../eval/methodology-analysis-artifacts.js";
import {
  gradeMethodologyAttempt,
  methodologyComparisonId,
  methodologyFindingEvidenceSha256,
  methodologyReviewOutputSha256,
  type MethodologyGradingProjection,
} from "../eval/methodology-grading-contract.js";
import { buildMethodologyResourceSet } from "../eval/methodology-resource-artifact.js";
import { buildMethodologySchedule, methodologyArmConfigIdentitySha256, type MethodologyDesign } from "../eval/methodology-schedule.js";
import { historicalPermittedMetrics, parseHistoricalGroundTruth } from "../eval/historical-truth.js";
import { historicalTruthScopeSha256 } from "../eval/historical-curation.js";
import { writeExclusiveJson } from "../eval/experiment.js";

const digest = (value: string): string => value.repeat(64);
const truth = parseHistoricalGroundTruth({
  schemaVersion: 2,
  scope: { protocol: "historical-efficacy-v1", truthVersion: "truth-v1", status: "known-roots", completeness: "partial", reviewedScope: "Synthetic root.", permittedMetrics: historicalPermittedMetrics("known-roots") },
  bugs: [{ id: "bug-aaaaaaaa", rootCauseGroup: "root-bbbbbbbb", lane: "other-unclassified", mechanismFamily: "callback-loss", proofLevel: "complete-static-trace", expectedDisposition: "fix-in-pr", expectedSeverity: "high", file: "src/worker.ts", startLine: 1, endLine: 2, description: "Callback is dropped.", reachablePreconditions: "Retry branch is taken.", observableImpact: "Request remains pending.", provenance: "Synthetic fixture." }],
});
const review = { status: "completed" as const, limitations: [], findings: [{ file: "src/worker.ts", startLine: 1, endLine: 2, explanation: "Callback is dropped.", impact: "Request remains pending.", severity: "high" as const }] };

function fixture() {
  const runId = "contrast-artifact-fixture";
  const executionEvidenceSha256 = digest("a");
  const inputPlanSha256 = digest("b");
  const designWithoutArms: Omit<MethodologyDesign, "arms"> = { schemaVersion: 1, protocol: "historical-methodology-v1", seed: 11, repeats: 1, callerConfig: { runner: "codex", model: "gpt-5.6-sol", effort: "high", identitySha256: digest("c") }, totalDeadlineMs: 60_000, twoWorkerStageSplit: { discoveryDeadlineMs: 20_000, reviewerDeadlineMs: 40_000 } };
  const design: MethodologyDesign = { ...designWithoutArms, arms: (["A", "B", "C", "D"] as const).map((armId) => { const configName = `arm-${armId.toLowerCase()}`; return { armId, configName, configIdentitySha256: methodologyArmConfigIdentitySha256({ design: designWithoutArms, armId, configName }) }; }) };
  const schedule = buildMethodologySchedule({ design, cases: [{ caseName: "development/case-aaaaaaaa", corpus: "development", expectedBugCount: 1 }] });
  const grades = schedule.attempts.map((attempt) => {
    const projection: MethodologyGradingProjection = { schemaVersion: 2, kind: "methodology-grading-projection", executionEvidenceSha256, inputPlanSha256, caseRegistrationSha256: digest("d"), caseName: attempt.caseName, attemptId: attempt.id, truthSha256: canonicalJsonSha256(truth), truthScopeSha256: historicalTruthScopeSha256(truth), status: "completed", statusReason: "authenticated-complete", lifecycleTerminalSha256: digest("e"), reviewTerminalSha256: digest("f"), reviewRawOutputSha256: digest("0"), reviewOutputSha256: methodologyReviewOutputSha256(review) };
    const pairVerdicts = [{ comparisonId: methodologyComparisonId({ bug: truth.bugs[0]!, finding: review.findings[0]!, judgeConfigSha256: digest("1") }), bugId: truth.bugs[0]!.id, findingIndex: 0, findingEvidenceSha256: methodologyFindingEvidenceSha256(review.findings[0]!), verdict: "same-root-cause" as const }];
    return gradeMethodologyAttempt({ projection, expectedProjectionSha256: canonicalJsonSha256(projection), truth, reviewOutput: review, judgeConfigSha256: digest("1"), pairVerdicts });
  });
  const root = mkdtempSync(join(tmpdir(), "methodology-contrast-artifact-test-"));
  const gradeSet = writeMethodologyGradeSet(root, { runId, schedule, executionEvidenceSha256, inputPlanSha256, grades, recordedAt: "2026-09-08T00:00:00.000Z" });
  const adjudication = buildMethodologyAdjudicationLedger({ runId, executionEvidenceSha256, inputPlanSha256, expectedAttemptIds: schedule.attempts.map((attempt) => attempt.id), grades, curatorIdentitySha256: digest("2"), reviewProtocol: "blind-to-arm-route-timing-v1", records: [], recordedAt: "2026-09-08T00:00:00.000Z" });
  writeExclusiveJson(root, join(root, "methodology-adjudication.json"), adjudication);
  const resourceSet = buildMethodologyResourceSet({ runId, schedule, executionEvidenceSha256, invocationRegistrationSha256: digest("3"), inputPlanSha256, resources: schedule.attempts.map((attempt) => ({ attemptId: attempt.id, caseName: attempt.caseName, armId: attempt.armId, expectedStages: attempt.expectedStages, observedStages: attempt.expectedStages, outcome: "completed" as const, wallDurationMs: 10, reviewDurationMs: 1, usage: { provider: "mock" as const }, lifecycleTerminalSha256: digest("e"), reviewTerminalSha256: digest("f") })), recordedAt: "2026-09-08T00:00:00.000Z" });
  writeExclusiveJson(root, join(root, "methodology-resource-set.json"), resourceSet);
  return { root, schedule, gradeSet, adjudication, resourceSet };
}

test("writes, rebuilds, and reads a contrast artifact exclusively", () => {
  const data = fixture();
  try {
    const contrast = writeMethodologyContrastArtifact(data.root, data);
    assert.deepEqual(readMethodologyContrastArtifact(data.root, { ...data, expectedContrastSha256: contrast.contrastSha256 }), contrast);
    assert.throws(() => writeMethodologyContrastArtifact(data.root, data), /already exists|exclusive|EEXIST/);
  } finally { rmSync(data.root, { recursive: true, force: true }); }
});

test("rejects tampering and an expected digest from another run", () => {
  const data = fixture();
  try {
    const contrast = writeMethodologyContrastArtifact(data.root, data);
    const path = join(data.root, "methodology-contrast.json");
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    raw.integrity = { unresolvedFindings: 99, blockers: ["tampered"] };
    // Keep the original digest: the reader must reject the changed body.
    writeFileSync(path, `${JSON.stringify(raw)}\n`, "utf8");
    assert.throws(() => readMethodologyContrastArtifact(data.root, { ...data, expectedContrastSha256: contrast.contrastSha256 }), /digest mismatch/);
    assert.throws(() => readMethodologyContrastArtifact(data.root, { ...data, expectedContrastSha256: digest("9") }), /digest mismatch/);
    assert.match(contrast.contrastSha256, /^[a-f0-9]{64}$/);
  } finally { rmSync(data.root, { recursive: true, force: true }); }
});
