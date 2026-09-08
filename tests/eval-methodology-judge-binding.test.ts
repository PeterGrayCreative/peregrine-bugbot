import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalJsonSha256 } from "../eval/experiment.js";
import {
  methodologyJudgeImplementationSha256,
  readMethodologyJudgeBinding,
  verifyMethodologyJudgeSource,
  writeMethodologyJudgeBinding,
  METHODOLOGY_JUDGE_SOURCE_PATHS,
  type MethodologyJudgeBindingReadInputs,
} from "../eval/methodology-judge-binding.js";
import {
  runMethodologyJudgeLedger,
  type MethodologyJudgeInputs,
} from "../eval/methodology-judge-ledger.js";
import { methodologyGradingProjectionSha256, methodologyReviewOutputSha256 } from "../eval/methodology-grading-contract.js";
import { historicalPermittedMetrics, type HistoricalGroundTruth } from "../eval/historical-truth.js";
import { historicalTruthScopeSha256 } from "../eval/historical-curation.js";
import type { AuthenticatedMethodologyGradingProjectionSet } from "../eval/methodology-grading-projection.js";

const sha = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const limits = { maxProviderCostUsd: null, maxProviderAttempts: 10, maxWallTimeMs: 60_000, maxFailureRate: 1, minAttemptsForFailureRate: 1, maxConsecutiveFailures: 2 } as const;
const usage = { inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null, turns: null, toolCalls: null };

function projections(): AuthenticatedMethodologyGradingProjectionSet {
  const truth: HistoricalGroundTruth = {
    schemaVersion: 2,
    scope: {
      protocol: "historical-efficacy-v1", truthVersion: "fixture", status: "known-roots", completeness: "partial",
      reviewedScope: "binding fixture", permittedMetrics: historicalPermittedMetrics("known-roots"),
    },
    bugs: [{
      id: "bug-11111111", lane: "logic-correctness", mechanismFamily: "async-lifecycle", proofLevel: "complete-static-trace",
      expectedDisposition: "fix-in-pr", expectedSeverity: "high", file: "src/a.ts", startLine: 2, endLine: 3,
      description: "Deferred write follows completion.", reachablePreconditions: "Deferred branch.", observableImpact: "Persistence can be lost.", provenance: "fixture",
    }],
  };
  const review = { status: "completed" as const, limitations: [], findings: [{ file: "src/a.ts", startLine: 2, endLine: 3, severity: "high" as const, explanation: "Completion precedes write.", impact: "Persistence can be lost." }] };
  const executionEvidenceSha256 = sha("execution");
  const inputPlanSha256 = sha("input-plan");
  const projection = {
    schemaVersion: 2 as const, kind: "methodology-grading-projection" as const, executionEvidenceSha256, inputPlanSha256,
    caseRegistrationSha256: sha("case"), truthSha256: canonicalJsonSha256(truth), truthScopeSha256: historicalTruthScopeSha256(truth),
    attemptId: "attempt-000001", caseName: "development/case-11111111", status: "completed" as const,
    statusReason: "authenticated-complete" as const, lifecycleTerminalSha256: sha("lifecycle"), reviewTerminalSha256: sha("review-terminal"),
    reviewRawOutputSha256: sha("{}"), reviewOutputSha256: methodologyReviewOutputSha256(review),
  };
  return {
    runId: "binding-fixture-run",
    executionEvidenceSha256, invocationRegistrationSha256: sha("registration"), inputPlanSha256,
    projections: [{ projection, projectionSha256: methodologyGradingProjectionSha256(projection), truth, reviewOutput: review, reviewRawOutput: "{}", resource: {
      attemptId: projection.attemptId, caseName: projection.caseName, armId: "A", expectedStages: 1, observedStages: 1,
      outcome: "completed", wallDurationMs: 1, reviewDurationMs: 1, usage: {
        provider: "mock", inputTokens: 0, baseInputTokens: 0, uncachedInputTokens: 0, cachedInputTokens: 0,
        cacheWriteInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, turns: 0, toolCalls: 0,
        toolCallsByType: {}, toolOutputBytes: 0, promptBytes: 0, costUsd: 0, costSource: "estimated", aggregation: "single-envelope",
      }, lifecycleTerminalSha256: projection.lifecycleTerminalSha256, reviewTerminalSha256: projection.reviewTerminalSha256,
    } }],
  };
}

function baseInput(repositoryRoot: string, runDirectory: string): MethodologyJudgeInputs & { runDirectory: string; repositoryRoot: string } {
  return {
    runId: "binding-fixture-run", projections: projections(), providerAccess: "cli-session", limits,
    judgeImplementationSha256: methodologyJudgeImplementationSha256(repositoryRoot), runDirectory, repositoryRoot,
  };
}

async function completedFixture() {
  const repositoryRoot = process.cwd();
  const runDirectory = mkdtempSync(join(tmpdir(), "methodology-judge-binding-"));
  const input = baseInput(repositoryRoot, runDirectory);
  const result = await runMethodologyJudgeLedger({ ...input, execute: async () => ({ verdict: true, durationMs: 1, providerCostUsd: null, usage }) });
  const expected = {
    ...input,
    expectedOccurrenceArtifactSha256: result.artifact.artifactSha256,
    expectedJudgeManifestSha256: result.manifest.manifestSha256,
    expectedJudgeTerminalSealSha256: sha(readFileSync(join(runDirectory, "judge/terminal-seal.json"))),
    expectedProjectionSetSha256: result.artifact.projectionSetSha256,
  };
  return { repositoryRoot, runDirectory, input, result, expected };
}

test("derives an explicit source-bound implementation and round-trips a completed ledger binding", async () => {
  const fixture = await completedFixture();
  try {
    const binding = writeMethodologyJudgeBinding(fixture.runDirectory, { ...fixture.expected, boundAt: "2026-09-08T00:00:00.000Z" });
    assert.deepEqual(readMethodologyJudgeBinding(fixture.runDirectory, { ...fixture.expected, expectedBindingSha256: binding.bindingSha256 }), binding);
    assert.equal(binding.protocol, "historical-methodology-judge-binding-v1");
    assert.deepEqual(binding.claims, { sourceClosure: "fixed-explicit-source-list", providerIdentity: "not-established", semanticCorrectness: "not-established", humanCalibration: "required" });
    assert.deepEqual(binding.judgeSource.map((entry) => entry.path), METHODOLOGY_JUDGE_SOURCE_PATHS);
    assert.equal(binding.judgeSourceTreeSha256, canonicalJsonSha256(binding.judgeSource));
    verifyMethodologyJudgeSource(binding, fixture.repositoryRoot);
    assert.match(methodologyJudgeImplementationSha256(fixture.repositoryRoot), /^[a-f0-9]{64}$/);
    assert.throws(() => writeMethodologyJudgeBinding(fixture.runDirectory, { ...fixture.expected, boundAt: "2026-09-08T00:00:00.000Z" }), /already exists|exclusive|EEXIST/);
  } finally { rmSync(fixture.runDirectory, { recursive: true, force: true }); }
});

test("rejects every wrong caller digest, invented implementation, cross-run input, stale projection, and stored tamper", async () => {
  const fixture = await completedFixture();
  try {
    const binding = writeMethodologyJudgeBinding(fixture.runDirectory, { ...fixture.expected, boundAt: "2026-09-08T00:00:00.000Z" });
    const wrong = sha("wrong");
    const names: Array<keyof MethodologyJudgeBindingReadInputs> = ["expectedOccurrenceArtifactSha256", "expectedJudgeManifestSha256", "expectedJudgeTerminalSealSha256", "expectedProjectionSetSha256", "judgeImplementationSha256"];
    for (const name of names) assert.throws(() => readMethodologyJudgeBinding(fixture.runDirectory, { ...fixture.expected, expectedBindingSha256: binding.bindingSha256, [name]: wrong }), /digest|implementation|caller-held|match/i);
    assert.throws(() => writeMethodologyJudgeBinding(fixture.runDirectory, { ...fixture.expected, judgeImplementationSha256: wrong, boundAt: "2026-09-08T00:00:00.000Z" }), /invented|stale implementation/);
    assert.throws(() => readMethodologyJudgeBinding(fixture.runDirectory, { ...fixture.expected, runId: "different-run", expectedBindingSha256: binding.bindingSha256 }), /caller-held|match|rederived/);
    const stale = structuredClone(fixture.input.projections); stale.projections[0]!.projection.caseName = "development/case-22222222";
    assert.throws(() => readMethodologyJudgeBinding(fixture.runDirectory, { ...fixture.expected, projections: stale, expectedBindingSha256: binding.bindingSha256 }), /stale|digest|projection/);
    const path = join(fixture.runDirectory, "methodology-judge-binding.json");
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    raw.extra = true;
    writeFileSync(path, `${JSON.stringify(raw)}\n`, "utf8");
    assert.throws(() => readMethodologyJudgeBinding(fixture.runDirectory, { ...fixture.expected, expectedBindingSha256: binding.bindingSha256 }), /structure|digest|unsupported/);
  } finally { rmSync(fixture.runDirectory, { recursive: true, force: true }); }
});

test("detects source drift during current verification", async () => {
  const fixture = await completedFixture();
  try {
    const binding = writeMethodologyJudgeBinding(fixture.runDirectory, { ...fixture.expected, boundAt: "2026-09-08T00:00:00.000Z" });
    const tampered = structuredClone(binding);
    tampered.judgeSource[0]!.bytes += 1;
    assert.throws(() => verifyMethodologyJudgeSource(tampered, fixture.repositoryRoot), /source differs/);
  } finally {
    rmSync(fixture.runDirectory, { recursive: true, force: true });
  }
});
