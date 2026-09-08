import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalJsonSha256 } from "../eval/experiment.js";
import {
  gradeMethodologySealedJudge,
  type MethodologySealedJudgeGradeInputs,
} from "../eval/methodology-judge-grading.js";
import {
  runMethodologyJudgeLedger,
  type MethodologyJudgeInputs,
} from "../eval/methodology-judge-ledger.js";
import type { JudgeLimits } from "../eval/judge-ledger.js";
import { methodologyReviewOutputSha256 } from "../eval/methodology-grading-contract.js";
import { historicalTruthScopeSha256 } from "../eval/historical-curation.js";
import { historicalPermittedMetrics, type HistoricalGroundTruth } from "../eval/historical-truth.js";
import type { MethodologyReviewOutput } from "../eval/methodology-output.js";
import type { AuthenticatedMethodologyGradingProjection, AuthenticatedMethodologyGradingProjectionSet } from "../eval/methodology-grading-projection.js";
import type { Usage } from "../src/types.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const limits = {
  maxProviderCostUsd: null,
  maxProviderAttempts: 10,
  maxWallTimeMs: 60_000,
  maxFailureRate: 1,
  minAttemptsForFailureRate: 2,
  maxConsecutiveFailures: 3,
} as const;
const usage: Usage = {
  inputTokens: 0, baseInputTokens: 0, uncachedInputTokens: 0, cachedInputTokens: 0,
  cacheWriteInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 0,
  reasoningOutputTokens: 0, turns: 0, toolCalls: 0, toolCallsByType: {},
  toolOutputBytes: 0, promptBytes: 0, costUsd: 0, provider: "mock",
  costSource: "estimated", aggregation: "single-envelope",
};

function projectionSet(options: {
  status?: "completed" | "incomplete" | "failed" | "missing";
  zeroBugs?: boolean;
  reviewedComparison?: boolean;
} = {}): AuthenticatedMethodologyGradingProjectionSet {
  const status = options.status ?? "completed";
  const truth: HistoricalGroundTruth = {
    schemaVersion: 2,
    scope: {
      protocol: "historical-efficacy-v1", truthVersion: "fixture",
      status: options.reviewedComparison ? "reviewed-comparison" : "known-roots",
      completeness: "partial", reviewedScope: "fixture",
      permittedMetrics: historicalPermittedMetrics(options.reviewedComparison ? "reviewed-comparison" : "known-roots"),
    },
    bugs: options.zeroBugs ? [] : [{
      id: "bug-11111111", lane: "logic-correctness", mechanismFamily: "async-lifecycle",
      proofLevel: "complete-static-trace", expectedDisposition: "fix-in-pr", expectedSeverity: "high",
      file: "src/a.ts", startLine: 2, endLine: 3,
      description: "The deferred write is observed after completion.",
      reachablePreconditions: "The request takes the deferred branch.",
      observableImpact: "Success can be observed before persistence.", provenance: "fixture",
    }],
  };
  const review: MethodologyReviewOutput | null = status === "completed"
    ? { status: "completed", limitations: [], findings: [{
      file: "src/a.ts", startLine: 2, endLine: 3, severity: "high",
      explanation: "Completion precedes the deferred write.", impact: "The write can be lost after success.",
    }] }
    : status === "incomplete"
      ? { status: "unable-to-complete", limitations: ["fixture limitation"], findings: [] }
      : null;
  const projections = ["attempt-000002", "attempt-000001"].map((attemptId): AuthenticatedMethodologyGradingProjection => {
    const lifecycleTerminalSha256 = status === "missing" ? null : digest(`${attemptId}-lifecycle`);
    const reviewTerminalSha256 = status === "completed" || status === "incomplete" ? digest(`${attemptId}-review`) : null;
    const projection = {
      schemaVersion: 2 as const, kind: "methodology-grading-projection" as const,
      executionEvidenceSha256: digest("execution"), inputPlanSha256: digest("input-plan"),
      caseRegistrationSha256: digest(`${attemptId}-case`), truthSha256: canonicalJsonSha256(truth),
      truthScopeSha256: historicalTruthScopeSha256(truth), attemptId,
      caseName: "development/case-11111111", status,
      statusReason: status === "completed" ? "authenticated-complete" as const
        : status === "incomplete" ? "model-unable-to-complete" as const
          : status === "failed" ? "preflight-failed" as const : "outer-run-missing" as const,
      lifecycleTerminalSha256, reviewTerminalSha256,
      reviewRawOutputSha256: review === null ? null : digest(`${attemptId}-raw`),
      reviewOutputSha256: review === null ? null : methodologyReviewOutputSha256(review),
    };
    return {
      projection,
      projectionSha256: canonicalJsonSha256(projection),
      truth,
      reviewOutput: review,
      reviewRawOutput: review === null ? null : `${attemptId}-raw`,
      resource: {
        attemptId, caseName: projection.caseName, armId: "A", expectedStages: 1,
        observedStages: review === null ? 0 : 1,
        outcome: status === "missing" ? "missing" : status === "failed" ? "preflight-failed" : "completed",
        wallDurationMs: 1, reviewDurationMs: review === null ? null : 1,
        usage: review === null ? null : usage,
        lifecycleTerminalSha256, reviewTerminalSha256,
      },
    };
  });
  return {
    runId: "run-methodology-grading-001",
    executionEvidenceSha256: digest("execution"),
    invocationRegistrationSha256: digest("registration"),
    inputPlanSha256: digest("input-plan"),
    projections,
  };
}

function judgeInputs(projections = projectionSet()): MethodologyJudgeInputs {
  return {
    runId: "run-methodology-grading-001", projections, providerAccess: "cli-session",
    limits, judgeImplementationSha256: digest("judge-implementation"),
  };
}

async function sealedInputs(
  base: MethodologyJudgeInputs,
  execute: (prompt: string) => Promise<Awaited<ReturnType<NonNullable<Parameters<typeof runMethodologyJudgeLedger>[0]["execute"]>>>>,
  limitOverrides: Partial<JudgeLimits> = {},
): Promise<MethodologySealedJudgeGradeInputs & { providerCalls: () => number }> {
  const root = mkdtempSync(join(tmpdir(), "methodology-judge-grading-"));
  let calls = 0;
  const result = await runMethodologyJudgeLedger({
    ...base,
    limits: { ...base.limits, ...limitOverrides },
    runDirectory: root,
    execute: async (prompt) => { calls += 1; return execute(prompt); },
  });
  const terminalBytes = readFileSync(join(root, "judge/terminal-seal.json"));
  return {
    ...base,
    limits: { ...base.limits, ...limitOverrides },
    runDirectory: root,
    expectedOccurrenceArtifactSha256: result.artifact.artifactSha256,
    expectedJudgeManifestSha256: result.manifest.manifestSha256,
    expectedJudgeTerminalSealSha256: digest(terminalBytes.toString()),
    expectedProjectionSetSha256: result.artifact.projectionSetSha256,
    providerCalls: () => calls,
  };
}

const successfulResult = (verdict: boolean) => ({
  verdict, durationMs: 1, providerCostUsd: null,
  usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null, turns: null, toolCalls: null },
});

test("grades sorted projections from true and false sealed verdicts", async () => {
  const input = await sealedInputs(judgeInputs(), async () => successfulResult(true));
  try {
    const gradeSet = gradeMethodologySealedJudge(input);
    assert.deepEqual(gradeSet.grades.map(({ projection }) => projection.attemptId), ["attempt-000001", "attempt-000002"]);
    assert.equal(gradeSet.grades[0]!.observationMatches["bug-11111111"], 0);
    assert.equal(gradeSet.grades[0]!.rootCauseMatches[JSON.stringify(["bug", "bug-11111111"])], true);
    assert.match(gradeSet.artifactSha256, /^[a-f0-9]{64}$/);
  } finally { rmSync(input.runDirectory, { recursive: true, force: true }); }

  const falseInput = await sealedInputs(judgeInputs(), async () => successfulResult(false));
  try {
    const gradeSet = gradeMethodologySealedJudge(falseInput);
    assert.equal(gradeSet.grades[0]!.observationMatches["bug-11111111"], null);
    assert.equal(gradeSet.grades[0]!.rootCauseMatches[JSON.stringify(["bug", "bug-11111111"])], false);
  } finally { rmSync(falseInput.runDirectory, { recursive: true, force: true }); }
});

test("one deduplicated decision credits every authenticated occurrence", async () => {
  const input = await sealedInputs(judgeInputs(), async () => successfulResult(true));
  try {
    const gradeSet = gradeMethodologySealedJudge(input);
    assert.equal(gradeSet.grades.length, 2);
    assert.deepEqual(gradeSet.grades.map((grade) => grade.observationMatches["bug-11111111"]), [0, 0]);
  } finally { rmSync(input.runDirectory, { recursive: true, force: true }); }
});

test("noncompleted and reviewed-comparison projections require no judge pairs", async () => {
  const incomplete = await sealedInputs(judgeInputs(projectionSet({ status: "incomplete" })), async () => {
    throw new Error("provider must not be called for an empty judge schedule");
  });
  try {
    const gradeSet = gradeMethodologySealedJudge(incomplete);
    assert.equal(gradeSet.grades[0]!.pairVerdicts.length, 0);
    assert.equal(gradeSet.grades[0]!.completion.incomplete, 1);
  } finally { rmSync(incomplete.runDirectory, { recursive: true, force: true }); }

  const comparison = await sealedInputs(judgeInputs(projectionSet({ zeroBugs: true, reviewedComparison: true })), async () => {
    throw new Error("provider must not be called for a reviewed-comparison without bugs");
  });
  try {
    const gradeSet = gradeMethodologySealedJudge(comparison);
    assert.equal(gradeSet.grades[0]!.pairVerdicts.length, 0);
    assert.equal(gradeSet.grades[0]!.observationMatches["missing-bug"], undefined);
    assert.equal(gradeSet.grades[0]!.unmatchedFindings[0]!.classification, "unresolved");
  } finally { rmSync(comparison.runDirectory, { recursive: true, force: true }); }
});

test("caller verdict and root metrics are ignored and no provider is called while grading", async () => {
  const input = await sealedInputs(judgeInputs(), async () => successfulResult(true));
  try {
    const forged = { ...input, pairVerdicts: [{ verdict: "different-root-cause" }], rootCauseMatches: { forged: false }, execute: async () => successfulResult(false) } as typeof input & Record<string, unknown>;
    const gradeSet = gradeMethodologySealedJudge(forged);
    assert.equal(gradeSet.grades[0]!.rootCauseMatches[JSON.stringify(["bug", "bug-11111111"])], true);
    assert.equal(input.providerCalls(), 1);
  } finally { rmSync(input.runDirectory, { recursive: true, force: true }); }
});

test("wrong anchors and stopped/failed ledgers are rejected", async () => {
  const input = await sealedInputs(judgeInputs(), async () => successfulResult(true));
  try {
    assert.throws(() => gradeMethodologySealedJudge({ ...input, expectedProjectionSetSha256: digest("wrong") }), /projection-set|trust anchor/i);
  } finally { rmSync(input.runDirectory, { recursive: true, force: true }); }

  const stopped = await sealedInputs(judgeInputs(), async () => successfulResult(true), { maxProviderAttempts: 0 });
  try {
    assert.throws(() => gradeMethodologySealedJudge(stopped), /completed successful|completed ledger/i);
  } finally { rmSync(stopped.runDirectory, { recursive: true, force: true }); }
});

test("grade set hashing is deterministic", async () => {
  const first = await sealedInputs(judgeInputs(), async () => successfulResult(true));
  try {
    const a = gradeMethodologySealedJudge(first);
    const b = gradeMethodologySealedJudge(first);
    assert.equal(a.gradeSetSha256, b.gradeSetSha256);
    assert.equal(a.artifactSha256, b.artifactSha256);
    assert.equal(first.providerCalls(), 1);
  } finally {
    rmSync(first.runDirectory, { recursive: true, force: true });
  }
});
