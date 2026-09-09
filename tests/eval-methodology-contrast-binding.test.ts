import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sha256 } from "../src/core/telemetry.js";
import { canonicalJsonSha256, writeExclusiveJson } from "../eval/experiment.js";
import { buildMethodologyAdjudicationLedger } from "../eval/methodology-adjudication.js";
import { writeMethodologyGradeSet } from "../eval/methodology-analysis-artifacts.js";
import { buildMethodologyResourceSet } from "../eval/methodology-resource-artifact.js";
import { writeMethodologyContrastArtifact } from "../eval/methodology-contrast-artifacts.js";
import { CONTRAST_SOURCE_PATHS, readMethodologyContrastBinding, writeMethodologyContrastBinding } from "../eval/methodology-contrast-binding.js";
import { gradeMethodologyAttempt, methodologyComparisonId, methodologyFindingEvidenceSha256, methodologyReviewOutputSha256, type MethodologyGradingProjection } from "../eval/methodology-grading-contract.js";
import { buildMethodologySchedule, methodologyArmConfigIdentitySha256, type MethodologyDesign } from "../eval/methodology-schedule.js";
import { historicalPermittedMetrics, parseHistoricalGroundTruth } from "../eval/historical-truth.js";
import { historicalTruthScopeSha256 } from "../eval/historical-curation.js";

const digest = (value: string): string => value.repeat(64);
const BASE_SOURCE_PATHS = [
  "eval/experiment.ts", "eval/historical-curation.ts", "eval/historical-methodology-case.ts", "eval/historical-truth.ts",
  "eval/methodology-adjudication.ts", "eval/methodology-analysis-artifacts.ts", "eval/methodology-analysis-binding.ts",
  "eval/methodology-attempt-lifecycle.ts", "eval/methodology-execution-evidence.ts", "eval/methodology-grading-contract.ts",
  "eval/methodology-grading-projection.ts", "eval/methodology-input-plan.ts", "eval/methodology-invocations.ts",
  "eval/methodology-report.ts", "eval/methodology-resource-artifact.ts", "eval/methodology-resource-report.ts",
  "eval/methodology-schedule.ts", "eval/methodology-terminal.ts", "src/core/telemetry.ts", "src/types.ts",
] as const;
const truth = parseHistoricalGroundTruth({ schemaVersion: 2, scope: { protocol: "historical-efficacy-v1", truthVersion: "truth-v1", status: "known-roots", completeness: "partial", reviewedScope: "Synthetic root.", permittedMetrics: historicalPermittedMetrics("known-roots") }, bugs: [{ id: "bug-aaaaaaaa", rootCauseGroup: "root-bbbbbbbb", lane: "other-unclassified", mechanismFamily: "callback-loss", proofLevel: "complete-static-trace", expectedDisposition: "fix-in-pr", expectedSeverity: "high", file: "src/worker.ts", startLine: 1, endLine: 2, description: "Callback dropped.", reachablePreconditions: "Retry branch.", observableImpact: "Request remains pending.", provenance: "Synthetic fixture." }] });
const review = { status: "completed" as const, limitations: [], findings: [{ file: "src/worker.ts", startLine: 1, endLine: 2, explanation: "Callback dropped.", impact: "Request remains pending.", severity: "high" as const }] };

function makeFixture() {
  const runId = "contrast-binding-fixture";
  const executionEvidenceSha256 = digest("a");
  const inputPlanSha256 = digest("b");
  const designWithoutArms: Omit<MethodologyDesign, "arms"> = { schemaVersion: 1, protocol: "historical-methodology-v1", seed: 12, repeats: 1, callerConfig: { runner: "codex", model: "gpt-5.6-sol", effort: "high", identitySha256: digest("c") }, totalDeadlineMs: 60_000, twoWorkerStageSplit: { discoveryDeadlineMs: 20_000, reviewerDeadlineMs: 40_000 } };
  const design: MethodologyDesign = { ...designWithoutArms, arms: (["A", "B", "C", "D"] as const).map((armId) => { const configName = `arm-${armId.toLowerCase()}`; return { armId, configName, configIdentitySha256: methodologyArmConfigIdentitySha256({ design: designWithoutArms, armId, configName }) }; }) };
  const schedule = buildMethodologySchedule({ design, cases: [{ caseName: "development/case-aaaaaaaa", corpus: "development", expectedBugCount: 1 }] });
  const grades = schedule.attempts.map((attempt) => { const projection: MethodologyGradingProjection = { schemaVersion: 2, kind: "methodology-grading-projection", executionEvidenceSha256, inputPlanSha256, caseRegistrationSha256: digest("d"), caseName: attempt.caseName, attemptId: attempt.id, truthSha256: canonicalJsonSha256(truth), truthScopeSha256: historicalTruthScopeSha256(truth), status: "completed", statusReason: "authenticated-complete", lifecycleTerminalSha256: digest("e"), reviewTerminalSha256: digest("f"), reviewRawOutputSha256: digest("0"), reviewOutputSha256: methodologyReviewOutputSha256(review) }; const pairVerdicts = [{ comparisonId: methodologyComparisonId({ bug: truth.bugs[0]!, finding: review.findings[0]!, judgeConfigSha256: digest("1") }), bugId: truth.bugs[0]!.id, findingIndex: 0, findingEvidenceSha256: methodologyFindingEvidenceSha256(review.findings[0]!), verdict: "same-root-cause" as const }]; return gradeMethodologyAttempt({ projection, expectedProjectionSha256: canonicalJsonSha256(projection), truth, reviewOutput: review, judgeConfigSha256: digest("1"), pairVerdicts }); });
  const root = mkdtempSync(join(tmpdir(), "methodology-contrast-binding-test-"));
  const gradeSet = writeMethodologyGradeSet(root, { runId, schedule, executionEvidenceSha256, inputPlanSha256, grades, recordedAt: "2026-09-08T00:00:00.000Z" });
  const adjudication = buildMethodologyAdjudicationLedger({ runId, executionEvidenceSha256, inputPlanSha256, expectedAttemptIds: schedule.attempts.map((attempt) => attempt.id), grades, curatorIdentitySha256: digest("2"), reviewProtocol: "blind-to-arm-route-timing-v1", records: [], recordedAt: "2026-09-08T00:00:00.000Z" });
  writeExclusiveJson(root, join(root, "methodology-adjudication.json"), adjudication);
  const resourceSet = buildMethodologyResourceSet({ runId, schedule, executionEvidenceSha256, invocationRegistrationSha256: digest("3"), inputPlanSha256, resources: schedule.attempts.map((attempt) => ({ attemptId: attempt.id, caseName: attempt.caseName, armId: attempt.armId, expectedStages: attempt.expectedStages, observedStages: attempt.expectedStages, outcome: "completed" as const, wallDurationMs: 10, reviewDurationMs: 1, usage: { provider: "mock" as const }, lifecycleTerminalSha256: digest("e"), reviewTerminalSha256: digest("f") })), recordedAt: "2026-09-08T00:00:00.000Z" });
  writeExclusiveJson(root, join(root, "methodology-resource-set.json"), resourceSet);
  return { root, runId, schedule, gradeSet, adjudication, resourceSet };
}

function installBaseBinding(root: string, data: ReturnType<typeof makeFixture>, repositoryRoot: string) {
  const source = BASE_SOURCE_PATHS.map((path) => { const bytes = readFileSync(join(repositoryRoot, path)); return { path, bytes: bytes.length, sha256: sha256(bytes) }; });
  const body = { schemaVersion: 1 as const, protocol: "historical-methodology-analysis-binding-v1" as const, runId: data.runId, scheduleSha256: canonicalJsonSha256(data.schedule), invocationRegistrationSha256: digest("4"), inputPlanSha256: data.gradeSet.inputPlanSha256, executionEvidenceSha256: data.gradeSet.executionEvidenceSha256, gradeSetArtifactSha256: data.gradeSet.artifactSha256, adjudicationLedgerSha256: data.adjudication.ledgerSha256, reportSha256: digest("5"), resourceSetArtifactSha256: data.resourceSet.artifactSha256, resourceReportSha256: digest("6"), analysisSource: source, analysisSourceTreeSha256: canonicalJsonSha256(source), boundAt: "2026-09-08T00:00:00.000Z", claims: { scheduleCoverage: "every-scheduled-attempt" as const, analysisSource: "binding-module-and-dependencies-hashed-from-runtime-repository" as const, providerIdentity: "not-established" as const, efficacy: "not-decided" as const } };
  const binding = { ...body, bindingSha256: canonicalJsonSha256(body) };
  writeExclusiveJson(root, join(root, "methodology-analysis-binding.json"), binding);
  return binding;
}

test("keeps the public source-path read access immutable", () => {
  assert.equal(Object.isFrozen(CONTRAST_SOURCE_PATHS), true);
  const original = [...CONTRAST_SOURCE_PATHS];
  assert.throws(() => {
    (CONTRAST_SOURCE_PATHS as unknown as string[]).pop();
  }, TypeError);
  assert.deepEqual(CONTRAST_SOURCE_PATHS, original);
});

test("binds and rereads contrast to v1 base binding and exact source tree", () => {
  const data = makeFixture();
  try {
    const base = installBaseBinding(data.root, data, process.cwd());
    const contrast = writeMethodologyContrastArtifact(data.root, data);
    const binding = writeMethodologyContrastBinding(data.root, { repositoryRoot: process.cwd(), expectedBaseAnalysisBindingSha256: base.bindingSha256, expectedContrastSha256: contrast.contrastSha256, boundAt: "2026-09-08T00:00:00.000Z" });
    assert.deepEqual(readMethodologyContrastBinding(data.root, { repositoryRoot: process.cwd(), expectedBaseAnalysisBindingSha256: base.bindingSha256, expectedContrastSha256: contrast.contrastSha256, expectedBindingSha256: binding.bindingSha256 }), binding);
    assert.equal(binding.baseAnalysisBindingSha256, base.bindingSha256);
  } finally { rmSync(data.root, { recursive: true, force: true }); }
});

test("rejects wrong caller-held digests, stored drift, and duplicate derived binding", () => {
  const data = makeFixture();
  try {
    const base = installBaseBinding(data.root, data, process.cwd());
    const contrast = writeMethodologyContrastArtifact(data.root, data);
    assert.throws(() => writeMethodologyContrastBinding(data.root, { repositoryRoot: process.cwd(), expectedBaseAnalysisBindingSha256: digest("9"), expectedContrastSha256: contrast.contrastSha256, boundAt: "2026-09-08T00:00:00.000Z" }), /digest mismatch/);
    const binding = writeMethodologyContrastBinding(data.root, { repositoryRoot: process.cwd(), expectedBaseAnalysisBindingSha256: base.bindingSha256, expectedContrastSha256: contrast.contrastSha256, boundAt: "2026-09-08T00:00:00.000Z" });
    assert.throws(() => readMethodologyContrastBinding(data.root, { repositoryRoot: process.cwd(), expectedBaseAnalysisBindingSha256: digest("9"), expectedContrastSha256: contrast.contrastSha256, expectedBindingSha256: binding.bindingSha256 }), /caller-held|digest mismatch/);
    assert.throws(() => readMethodologyContrastBinding(data.root, { repositoryRoot: process.cwd(), expectedBaseAnalysisBindingSha256: base.bindingSha256, expectedContrastSha256: digest("8"), expectedBindingSha256: binding.bindingSha256 }), /caller-held|digest mismatch/);
    assert.throws(() => readMethodologyContrastBinding(data.root, { repositoryRoot: process.cwd(), expectedBaseAnalysisBindingSha256: base.bindingSha256, expectedContrastSha256: contrast.contrastSha256, expectedBindingSha256: digest("7") }), /digest mismatch/);
    assert.throws(() => writeMethodologyContrastBinding(data.root, { repositoryRoot: process.cwd(), expectedBaseAnalysisBindingSha256: base.bindingSha256, expectedContrastSha256: contrast.contrastSha256, boundAt: "2026-09-08T00:00:00.000Z" }), /already exists|exclusive|EEXIST/);
    const raw = JSON.parse(readFileSync(join(data.root, "methodology-contrast-binding.json"), "utf8")) as Record<string, unknown>;
    raw.boundAt = "2026-09-08T00:00:01.000Z";
    writeFileSync(join(data.root, "methodology-contrast-binding.json"), `${JSON.stringify(raw)}\n`, "utf8");
    assert.throws(() => readMethodologyContrastBinding(data.root, { repositoryRoot: process.cwd(), expectedBaseAnalysisBindingSha256: base.bindingSha256, expectedContrastSha256: contrast.contrastSha256, expectedBindingSha256: binding.bindingSha256 }), /digest mismatch/);
  } finally { rmSync(data.root, { recursive: true, force: true }); }
});
