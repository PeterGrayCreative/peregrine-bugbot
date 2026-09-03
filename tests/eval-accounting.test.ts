import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import test from "node:test";
import { gradeRuns } from "../eval/grade.js";
import { buildReport } from "../eval/report.js";
import { runMatrix } from "../eval/run-matrix.js";
import { materializeCase } from "../eval/case-isolation.js";
import { readCaseGroundTruth } from "../eval/case-truth.js";
import {
  assertGradedMatchesRun,
  isPreTelemetryMatrixRunManifest,
  parseGradedRun,
  parseLegacySchemaV1GradedRun,
  parseMatrixRunManifest,
  parsePreTelemetryGradedRun,
  parsePreTelemetryMatrixRunManifest,
  parsePreTelemetryRunRecord,
  parseRunRecord,
} from "../eval/artifacts.js";
import { RunFailureError } from "../src/core/run-failure.js";
import { combineUsage, sha256, withUnavailable } from "../src/core/telemetry.js";
import type { Engine } from "../src/engines/engine.js";
import type { EvaluationAttemptProvenance, GradedRun, MatrixModelConfig, MatrixRunManifest, RunAttempt, RunRecord } from "../src/types.js";

function validAttempt(): RunAttempt {
  return {
    id: "attempt-000001",
    caseName: "case",
    configName: "route",
    repeat: 1,
    file: "attempt-000001.json",
    corpus: "development",
    expectedBugCount: 1,
    runner: "claude",
  };
}

function validRecord(): RunRecord {
  return {
    schemaVersion: 1,
    attemptId: "attempt-000001",
    caseName: "case",
    caseKind: "seeded",
    configName: "route",
    repeat: 1,
    caseCorpus: "development",
    runner: "claude",
    startedAt: "2026-09-02T00:00:00.000Z",
    finishedAt: "2026-09-02T00:00:01.000Z",
    outcome: {
      status: "completed",
      result: {
        engine: "claude",
        status: "completed",
        modelConfig: "fast->strong",
        findings: [{
          file: "src/value.ts",
          startLine: 1,
          endLine: 1,
          severity: "high",
          disposition: "fix-in-pr",
          category: "logic",
          invariant: "value-remains-valid",
          title: "Invalid value",
          explanation: "The changed value violates the invariant.",
          failurePath: "A caller observes the invalid value.",
          confidence: 0.99,
        }],
        usage: { provider: "anthropic", inputTokens: 10, unavailable: [] },
        durationMs: 1000,
      },
    },
  };
}

function validEvaluationProvenance(): EvaluationAttemptProvenance {
  const baseRef = "1".repeat(40);
  const headRef = "2".repeat(40);
  const output = [
    `base: ${baseRef} (argument)`,
    `head: ${headRef}`,
    `merge-base: ${baseRef}`,
    "Changed files",
    "(none)",
    "",
  ].join("\n");
  return {
    history: {
      schemaVersion: 1,
      materialization: "fixture-patch",
      objectFormat: "sha1",
      baseRef,
      headRef,
      mergeBase: baseRef,
      baseTree: "3".repeat(40),
      headTree: "4".repeat(40),
      commitCount: 2,
      baseIsMergeBase: true,
      checkedOutTreeMatchesHead: true,
      treeReproductionVerified: true,
      diffNormalization: "identity-v1",
      diffSha256: "5".repeat(64),
    },
    manifest: {
      entryPoint: "prepareReviewManifest",
      skillName: "invariant-first-pr-review",
      baseRef,
      headRef,
      mergeBase: baseRef,
      outputSha256: sha256(output),
      output,
      profileSource: "none",
      headProfileChanged: false,
    },
  };
}

function validProvenanceRecord(): RunRecord {
  const record = validRecord();
  record.evaluationProvenance = validEvaluationProvenance();
  if (record.outcome.status !== "completed") throw new Error("expected completed fixture");
  record.outcome.result.reviewedBaseRef = record.evaluationProvenance.history.baseRef;
  record.outcome.result.reviewedHeadRef = record.evaluationProvenance.history.headRef;
  return record;
}

test("evaluation artifact parsers reject schema, identity, enum, and numeric tampering", () => {
  const attempt = validAttempt();
  const manifest = {
    schemaVersion: 1,
    createdAt: "2026-09-02T00:00:00.000Z",
    expectedAttempts: [attempt],
    providerNetworkIsolation: {
      claude: { status: "limited", mechanism: "provider-specific sandbox" },
    },
  };
  assert.doesNotThrow(() => parseMatrixRunManifest(manifest));
  assert.doesNotThrow(() => parseRunRecord(validRecord(), "record", attempt));

  for (const [field, value] of [
    ["attemptId", "attempt-999999"],
    ["caseName", "other"],
    ["configName", "other"],
    ["repeat", 2],
    ["caseCorpus", "validation"],
    ["runner", "codex"],
  ] as const) {
    const tampered = structuredClone(validRecord()) as unknown as Record<string, unknown>;
    tampered[field] = value;
    assert.throws(() => parseRunRecord(tampered, "record", attempt), /does not match matrix manifest|does not match runner/);
  }

  const fractionalUsage = structuredClone(validRecord());
  if (fractionalUsage.outcome.status !== "completed") throw new Error("expected completed fixture");
  fractionalUsage.outcome.result.usage.inputTokens = 1.5;
  assert.throws(() => parseRunRecord(fractionalUsage, "record", attempt), /safe integer/);

  const wrongProvider = structuredClone(validRecord());
  if (wrongProvider.outcome.status !== "completed") throw new Error("expected completed fixture");
  wrongProvider.outcome.result.usage.provider = "openai";
  assert.throws(() => parseRunRecord(wrongProvider, "record", attempt), /does not match claude runner/);

  const unsafeDuration = structuredClone(validRecord());
  if (unsafeDuration.outcome.status !== "completed") throw new Error("expected completed fixture");
  unsafeDuration.outcome.result.durationMs = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => parseRunRecord(unsafeDuration, "record", attempt), /safe integer/);

  const nonfiniteConfidence = structuredClone(validRecord());
  if (nonfiniteConfidence.outcome.status !== "completed") throw new Error("expected completed fixture");
  nonfiniteConfidence.outcome.result.findings[0]!.confidence = Number.NaN;
  assert.throws(() => parseRunRecord(nonfiniteConfidence, "record", attempt), /finite number/);

  const badFailure = { ...structuredClone(validRecord()), outcome: {
    status: "failed", failureKind: "cancelled", message: "stopped", durationMs: 1,
  } };
  assert.throws(() => parseRunRecord(badFailure, "record", attempt), /failureKind is invalid/);

  const badTimestamp = { ...structuredClone(validRecord()), startedAt: "2026-09-02" };
  assert.throws(() => parseRunRecord(badTimestamp, "record", attempt), /canonical ISO/);
  const badOrder = { ...structuredClone(validRecord()), finishedAt: "2026-09-01T23:59:59.000Z" };
  assert.throws(() => parseRunRecord(badOrder, "record", attempt), /must not precede/);
  const badSchema = { ...structuredClone(validRecord()), schemaVersion: 2 };
  assert.throws(() => parseRunRecord(badSchema, "record", attempt), /schemaVersion must be 1/);
  assert.throws(() => parseMatrixRunManifest({ ...manifest, surprise: true }), /unexpected field/);

  const provenanceRecord = validProvenanceRecord();
  assert.deepEqual(
    parseRunRecord(provenanceRecord, "provenance record", attempt).evaluationProvenance,
    provenanceRecord.evaluationProvenance,
  );
  const forgedProvenance = structuredClone(provenanceRecord);
  forgedProvenance.evaluationProvenance!.manifest!.outputSha256 = "0".repeat(64);
  assert.throws(
    () => parseRunRecord(forgedProvenance, "forged provenance", attempt),
    /outputSha256 does not match output/,
  );
  const mismatchedManifest = structuredClone(provenanceRecord);
  mismatchedManifest.evaluationProvenance!.manifest!.output =
    mismatchedManifest.evaluationProvenance!.manifest!.output.replace(`base: ${"1".repeat(40)}`, `base: ${"0".repeat(40)}`);
  mismatchedManifest.evaluationProvenance!.manifest!.outputSha256 = sha256(
    mismatchedManifest.evaluationProvenance!.manifest!.output,
  );
  assert.throws(
    () => parseRunRecord(mismatchedManifest, "mismatched manifest", attempt),
    /output base provenance does not match history/,
  );
  const missingReviewedRef = structuredClone(provenanceRecord);
  if (missingReviewedRef.outcome.status !== "completed") throw new Error("expected completed fixture");
  delete missingReviewedRef.outcome.result.reviewedBaseRef;
  assert.throws(
    () => parseRunRecord(missingReviewedRef, "missing reviewed ref", attempt),
    /reviewedBaseRef does not match history provenance/,
  );
  const mismatchedReviewedHead = structuredClone(provenanceRecord);
  if (mismatchedReviewedHead.outcome.status !== "completed") throw new Error("expected completed fixture");
  mismatchedReviewedHead.outcome.result.reviewedHeadRef = "9".repeat(40);
  assert.throws(
    () => parseRunRecord(mismatchedReviewedHead, "mismatched reviewed head", attempt),
    /reviewedHeadRef does not match history provenance/,
  );

  const completedWithoutManifest = structuredClone(provenanceRecord);
  delete completedWithoutManifest.evaluationProvenance!.manifest;
  assert.throws(
    () => parseRunRecord(completedWithoutManifest, "completed without manifest", attempt),
    /manifest is required for a completed attempt/,
  );
  const failedWithoutManifest = structuredClone(completedWithoutManifest);
  failedWithoutManifest.outcome = {
    status: "failed",
    failureKind: "provider",
    message: "provider failed after preflight",
    durationMs: 1,
  };
  assert.throws(
    () => parseRunRecord(failedWithoutManifest, "failure without manifest", attempt),
    /manifest is required for a post-preflight failure/,
  );
  failedWithoutManifest.outcome.failureKind = "configuration";
  assert.doesNotThrow(
    () => parseRunRecord(failedWithoutManifest, "preflight configuration failure", attempt),
  );

  const historicalMismatch = structuredClone(provenanceRecord);
  const history = historicalMismatch.evaluationProvenance!.history;
  history.materialization = "historical-sanitized-export";
  history.historicalSource = {
    sourceIdentitySha256: "6".repeat(64),
    sourceBaseRef: history.baseRef,
    sourceHeadRef: history.headRef,
    sourceMergeBase: history.baseRef,
    sourceBaseTree: "7".repeat(40),
    sourceHeadTree: history.headTree,
    baseCommitIsMergeBase: true,
    baseTreeMatches: true,
    headTreeMatches: true,
  };
  assert.throws(
    () => parseRunRecord(historicalMismatch, "historical mismatch", attempt),
    /historicalSource trees must match reproduced history trees/,
  );

  const secretManifest = structuredClone(provenanceRecord);
  const secret = "sk-proj-1234567890abcdefghijklmnop";
  secretManifest.evaluationProvenance!.manifest!.output += `secret-token=${secret}\n`;
  secretManifest.evaluationProvenance!.manifest!.outputSha256 = sha256(
    secretManifest.evaluationProvenance!.manifest!.output,
  );
  assert.throws(
    () => parseRunRecord(secretManifest, "secret manifest", attempt),
    /secret pattern/,
  );

  const graded = {
    ...validRecord(),
    matches: { bug: 0 },
    falsePositiveIndexes: [],
  } as GradedRun;
  assert.doesNotThrow(() => parseGradedRun(graded, "graded", attempt));
  const fractionalMatch = { ...structuredClone(graded), matches: { bug: 0.5 } };
  assert.throws(() => parseGradedRun(fractionalMatch, "graded", attempt), /safe integer/);
  const reusedFinding = { ...structuredClone(graded), matches: { bug: 0, "bug-2": 0 } };
  assert.throws(() => parseGradedRun(reusedFinding, "graded", attempt), /must not reuse a finding index/);
  const tamperedGraded = structuredClone(graded);
  if (tamperedGraded.outcome.status !== "completed") throw new Error("expected completed fixture");
  tamperedGraded.outcome.result.usage.inputTokens = 11;
  assert.throws(() => assertGradedMatchesRun(tamperedGraded, validRecord(), "graded"), /does not match the run artifact/);
  assert.throws(
    () => assertGradedMatchesRun({ ...graded, falsePositiveIndexes: [0] }, validRecord(), "graded"),
    /does not match the graded findings/,
  );
  assert.throws(
    () => assertGradedMatchesRun(
      { ...graded, evaluationProvenance: validEvaluationProvenance() },
      validRecord(),
      "graded",
    ),
    /evaluationProvenance does not match the run artifact/,
  );
});

const CANONICAL_VALUE_PATCH = [
  "diff --git a/src/value.ts b/src/value.ts",
  "index 62ab7ee3c77e9b3c27cca16715e3ffe459799136..db3515920daa6bb3ec433cff58bef3856f63fe39 100644",
  "--- a/src/value.ts",
  "+++ b/src/value.ts",
  "@@ -1 +1 @@",
  "-export const value = true;",
  "+export const value = false;",
  "",
].join("\n");

test("strict ingestion rejects aggregate usage forged below its two stages", () => {
  const stageUsage = withUnavailable({
    provider: "anthropic",
    aggregation: "single-envelope",
    costUsd: 1,
    costSource: "provider",
  });
  const forged = structuredClone(validRecord());
  if (forged.outcome.status !== "completed") throw new Error("expected completed fixture");
  forged.outcome.result.usage = { ...combineUsage(stageUsage, stageUsage), costUsd: 0.01 };
  forged.outcome.result.raw = {
    breadth: {
      model: "fast",
      promptSha256: "a".repeat(64),
      durationMs: 10,
      usage: stageUsage,
    },
    investigation: {
      model: "strong",
      promptSha256: "b".repeat(64),
      durationMs: 20,
      usage: stageUsage,
    },
  };
  assert.throws(
    () => parseRunRecord(forged, "forged", validAttempt()),
    /does not match aggregate stage telemetry/,
  );

  forged.outcome.result.usage = combineUsage(stageUsage, stageUsage);
  assert.doesNotThrow(() => parseRunRecord(forged, "reconciled", validAttempt()));
});

test("strict ingestion reconciles failure usage and cost with all observed stages", () => {
  const stageUsage = withUnavailable({
    provider: "anthropic",
    aggregation: "single-envelope",
    costUsd: 1,
    costSource: "provider",
  });
  const aggregate = combineUsage(stageUsage, stageUsage);
  const failed: RunRecord = {
    ...structuredClone(validRecord()),
    outcome: {
      status: "failed",
      failureKind: "parse",
      message: "investigation output was invalid",
      durationMs: 30,
      telemetry: {
        engine: "claude",
        modelConfig: "fast->strong",
        usage: { ...aggregate, costUsd: 0.01 },
        durationMs: 30,
        stages: [
          {
            stage: "breadth",
            model: "fast",
            promptSha256: "a".repeat(64),
            usage: stageUsage,
            durationMs: 10,
            completed: true,
          },
          {
            stage: "investigation",
            model: "strong",
            promptSha256: "b".repeat(64),
            usage: stageUsage,
            durationMs: 20,
            completed: false,
          },
        ],
      },
    },
  };
  assert.throws(
    () => parseRunRecord(failed, "forged failure", validAttempt()),
    /usage does not match aggregate stage telemetry/,
  );

  if (failed.outcome.status !== "failed" || !failed.outcome.telemetry) {
    throw new Error("expected failure telemetry fixture");
  }
  failed.outcome.telemetry.usage = aggregate;
  assert.doesNotThrow(() => parseRunRecord(failed, "reconciled failure", validAttempt()));

  failed.outcome.telemetry.stages = [];
  assert.throws(
    () => parseRunRecord(failed, "stage-less failure", validAttempt()),
    /stages must contain one or two stages/,
  );
});

test("behavioral reports count failed and missing attempts and retain incurred failure cost", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-behavioral-accounting-"));
  const runsDir = join(root, "runs");
  const casesDir = join(root, "cases");
  const caseName = "development/case-b00c0001";
  mkdirSync(runsDir, { recursive: true });
  mkdirSync(join(casesDir, caseName), { recursive: true });
  writeFileSync(join(casesDir, caseName, "ground_truth.json"), JSON.stringify({
    bugs: [{
      id: "bug-1",
      file: "src/value.ts",
      startLine: 1,
      endLine: 1,
      description: "invalid value",
    }],
  }));
  const attempts: RunAttempt[] = [1, 2, 3].map((repeat) => ({
    id: `attempt-00000${repeat}`,
    caseName,
    corpus: "development",
    expectedBugCount: 1,
    configName: "route",
    repeat,
    file: `attempt-00000${repeat}.json`,
    runner: "claude",
  }));
  writeFileSync(join(runsDir, "matrix-manifest.json"), JSON.stringify({
    schemaVersion: 1,
    createdAt: "2026-09-02T00:00:00.000Z",
    expectedAttempts: attempts,
    providerNetworkIsolation: {
      claude: { status: "unavailable", mechanism: "artifact-only test" },
    },
  }));
  const completed = structuredClone(validRecord());
  completed.attemptId = attempts[0]!.id;
  completed.caseName = caseName;
  if (completed.outcome.status !== "completed") throw new Error("expected completed fixture");
  completed.outcome.result.usage = {
    provider: "anthropic",
    costUsd: 0.01,
    costSource: "provider",
  };
  writeFileSync(join(runsDir, attempts[0]!.file), JSON.stringify(completed));
  writeFileSync(join(runsDir, attempts[0]!.file.replace(/\.json$/, ".graded.json")), JSON.stringify({
    ...completed,
    matches: { "bug-1": 0 },
    falsePositiveIndexes: [],
  }));
  const stageUsage = withUnavailable({
    provider: "anthropic" as const,
    aggregation: "single-envelope" as const,
    costUsd: 0.02,
    costSource: "provider" as const,
  });
  const failed: RunRecord = {
    schemaVersion: 1,
    attemptId: attempts[1]!.id,
    caseName,
    caseCorpus: "development",
    caseKind: "seeded",
    configName: "route",
    repeat: 2,
    runner: "claude",
    startedAt: "2026-09-02T00:00:00.000Z",
    finishedAt: "2026-09-02T00:00:02.000Z",
    outcome: {
      status: "failed",
      failureKind: "timeout",
      message: "timed out",
      durationMs: 2000,
      telemetry: {
        engine: "claude",
        modelConfig: "fast->strong",
        usage: stageUsage,
        durationMs: 2000,
        stages: [{
          stage: "breadth",
          model: "fast",
          promptSha256: "a".repeat(64),
          usage: stageUsage,
          durationMs: 2000,
          completed: true,
        }],
      },
    },
  };
  writeFileSync(join(runsDir, attempts[1]!.file), JSON.stringify(failed));

  try {
    const [stats] = await buildReport(runsDir, { casesDir });
    assert.equal(stats?.benchmarkKind, "behavioral");
    assert.equal(stats?.completionRate, 1 / 3);
    assert.equal(stats?.failureInclusiveRecallMean, 1 / 3);
    assert.equal(stats?.failedRuns, 1);
    assert.equal(stats?.missingRuns, 1);
    assert.equal(stats?.durationSecMean, null);
    assert.equal(stats?.incurredCostUsdTotal, 0.03);
    assert.equal(stats?.incurredCostObservedAttempts, 2);
    assert.equal(stats?.incurredCostSource, "provider");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pre-corpus P1 schema-v1 artifacts remain readable only as legacy incomplete", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-p1-artifact-test-"));
  const runsDir = join(root, "runs");
  const casesDir = join(root, "cases");
  const fixtureDir = resolve("tests/fixtures/eval/p1-schema-v1");
  mkdirSync(runsDir);
  mkdirSync(join(casesDir, "legacy-p1-case"), { recursive: true });
  for (const file of ["matrix-manifest.json", "attempt-000001.json", "attempt-000001.graded.json"]) {
    writeFileSync(join(runsDir, file), readFileSync(join(fixtureDir, file)));
  }
  writeFileSync(
    join(casesDir, "legacy-p1-case", "ground_truth.json"),
    JSON.stringify({ bugs: [{ id: "bug-1", file: "src/value.ts", startLine: 1, endLine: 1, description: "invalid value" }] }),
  );

  try {
    const fixtureGraded: unknown = JSON.parse(
      readFileSync(join(fixtureDir, "attempt-000001.graded.json"), "utf8"),
    );
    assert.doesNotThrow(() => parseLegacySchemaV1GradedRun(fixtureGraded, "P1 fixture"));
    rmSync(join(runsDir, "attempt-000001.graded.json"));
    await gradeRuns(runsDir, casesDir);
    const [stats] = await buildReport(runsDir, { casesDir });
    assert.equal(stats?.config, "claude-p1-route");
    assert.equal(stats?.completeness, "legacy-incomplete");
    assert.equal(stats?.benchmarkKind, "legacy-unknown");
    assert.equal(stats?.expectedRuns, null);
    assert.equal(stats?.completionRate, null);
    assert.equal(stats?.telemetryExpectedRuns, null);
    assert.equal(stats?.costPerCaseMean, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("PR3 pre-telemetry schema-v1 artifacts grade and report only as legacy incomplete", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-pr3-artifact-test-"));
  const runsDir = join(root, "runs");
  const casesDir = join(root, "cases");
  const fixtureDir = resolve("tests/fixtures/eval/pr3-pre-telemetry");
  mkdirSync(runsDir);
  mkdirSync(join(casesDir, "legacy-pr3-case"), { recursive: true });
  for (const file of ["matrix-manifest.json", "attempt-000001.json"]) {
    writeFileSync(join(runsDir, file), readFileSync(join(fixtureDir, file)));
  }
  writeFileSync(
    join(casesDir, "legacy-pr3-case", "ground_truth.json"),
    JSON.stringify({
      bugs: [{
        id: "bug-1",
        file: "src/value.ts",
        startLine: 1,
        endLine: 1,
        description: "invalid value",
      }],
    }),
  );

  try {
    const manifestValue: unknown = JSON.parse(
      readFileSync(join(fixtureDir, "matrix-manifest.json"), "utf8"),
    );
    assert.equal(isPreTelemetryMatrixRunManifest(manifestValue), true);
    const manifest = parsePreTelemetryMatrixRunManifest(manifestValue, "PR3 manifest fixture");
    assert.throws(
      () => parseMatrixRunManifest(manifestValue, "strict telemetry manifest"),
      /runner is invalid/,
    );

    const recordValue: unknown = JSON.parse(
      readFileSync(join(fixtureDir, "attempt-000001.json"), "utf8"),
    );
    assert.doesNotThrow(() => parsePreTelemetryRunRecord(
      recordValue,
      "PR3 record fixture",
      manifest.expectedAttempts[0],
    ));
    assert.throws(
      () => parseRunRecord(recordValue, "strict telemetry record"),
      /must include model, promptSha256, durationMs, and usage/,
    );
    const telemetryEraStage = structuredClone(recordValue) as {
      outcome: { result: { raw: { breadth: Record<string, unknown> } } };
    };
    telemetryEraStage.outcome.result.raw.breadth.model = "claude-haiku";
    assert.throws(
      () => parsePreTelemetryRunRecord(telemetryEraStage, "mixed-era record"),
      /unexpected field.*model/,
    );

    await gradeRuns(runsDir, casesDir);
    const gradedPath = join(runsDir, "attempt-000001.graded.json");
    const gradedValue = JSON.parse(readFileSync(gradedPath, "utf8")) as Record<string, unknown>;
    assert.equal("runner" in gradedValue, false);
    assert.doesNotThrow(() => parsePreTelemetryGradedRun(
      gradedValue,
      gradedPath,
      manifest.expectedAttempts[0],
    ));

    const [stats] = await buildReport(runsDir, { casesDir });
    assert.equal(stats?.config, "claude-pr3-route");
    assert.equal(stats?.runner, null);
    assert.equal(stats?.corpus, "development");
    assert.equal(stats?.completeness, "legacy-incomplete");
    assert.equal(stats?.benchmarkKind, "legacy-unknown");
    assert.equal(stats?.completedRuns, 1);
    assert.equal(stats?.expectedRuns, null);
    assert.equal(stats?.completionRate, null);
    assert.equal(stats?.recallMean, null);
    assert.equal(stats?.costPerCaseMean, null);
    assert.equal(stats?.incurredCostUsdTotal, null);
    assert.equal(stats?.durationSecMean, null);
    assert.equal(stats?.telemetryExpectedRuns, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed-only P1 schema-v1 folders report legacy incomplete instead of disappearing", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-p1-failed-artifact-test-"));
  const runsDir = join(root, "runs");
  const fixtureDir = resolve("tests/fixtures/eval/p1-schema-v1-failed");
  mkdirSync(runsDir);
  for (const file of ["matrix-manifest.json", "attempt-000001.json"]) {
    writeFileSync(join(runsDir, file), readFileSync(join(fixtureDir, file)));
  }

  try {
    const [stats] = await buildReport(runsDir);
    assert.equal(stats?.config, "claude-p1-failed-route");
    assert.equal(stats?.completeness, "legacy-incomplete");
    assert.equal(stats?.benchmarkKind, "legacy-unknown");
    assert.equal(stats?.completedRuns, 0);
    assert.equal(stats?.failedRuns, null);
    assert.equal(stats?.failuresByKind.timeout, 1);
    assert.deepEqual(stats?.failureRatesByKind, {});
    assert.equal(stats?.recallMean, null);
    assert.equal(stats?.failureInclusiveRecallMean, null);
    assert.equal(stats?.costPerCaseMean, null);
    assert.equal(stats?.incurredCostUsdTotal, null);
    assert.equal(stats?.durationSecMean, null);
    assert.equal(stats?.telemetryExpectedRuns, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("matrix accounting preserves failures, missing attempts, recall, and unknown cost", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-accounting-test-"));
  const casesDir = join(root, "cases");
  const caseName = "case-a11ce001";
  const caseDir = join(casesDir, "development", caseName);
  const fixtureDir = join(caseDir, "fixture", "src");
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(join(fixtureDir, "value.ts"), "export const value = false;\n");
  writeFileSync(
    join(caseDir, "diff.patch"),
    CANONICAL_VALUE_PATCH,
  );
  writeFileSync(
    join(caseDir, "case.json"),
    JSON.stringify({ id: caseName, corpus: "development", kind: "seeded", fixtureDir: "fixture", diffFile: "diff.patch" }),
  );
  writeFileSync(
    join(caseDir, "ground_truth.json"),
    JSON.stringify({ bugs: [{ id: "bug-1", file: "src/value.ts", startLine: 1, endLine: 1, description: "wrong value" }] }),
  );

  const configs: MatrixModelConfig[] = ["completed", "mixed", "timeout", "provider", "parse", "unknown", "missing"].map(
    (name) => ({ name, runner: "mock", overrides: { scenario: name } }),
  );
  configs.push({ name: "completed", runner: "mock", overrides: { scenario: "completed" } });
  configs.push({ name: "configuration", runner: "codex", overrides: { timeoutMs: 0 } });
  const matrixPath = join(root, "matrix.json");
  writeFileSync(matrixPath, JSON.stringify({ repeats: 2, configs }));

  let mixedCalls = 0;
  const engine: Engine = {
    name: "mock",
    async review(ctx) {
      const scenario = (ctx.config.runners.mock as Record<string, unknown>).scenario;
      if (scenario === "mixed" && ++mixedCalls === 2) {
        throw new RunFailureError("timeout", "timed out", {
          telemetry: {
            engine: "mock",
            modelConfig: "mock-test",
            usage: { provider: "mock" },
            durationMs: 20,
            stages: [{
              stage: "breadth",
              model: "mock-test",
              promptSha256: "a".repeat(64),
              usage: { provider: "mock" },
              durationMs: 20,
              completed: true,
            }],
          },
        });
      }
      if (scenario === "timeout") throw new RunFailureError("timeout", "timed out");
      if (scenario === "provider") throw new RunFailureError("provider", "provider unavailable");
      if (scenario === "parse") throw new RunFailureError("parse", "invalid output");
      if (scenario === "unknown") throw new Error("token=abc123456789SECRET");
      return {
        engine: "mock",
        status: "completed",
        modelConfig: "mock-test",
        findings: [{
          file: "src/value.ts",
          startLine: 1,
          endLine: 1,
          severity: "high",
          disposition: "fix-in-pr",
          category: "logic",
          invariant: "value-remains-true",
          title: "Value changed",
          explanation: "The value no longer satisfies the invariant.",
          failurePath: "A caller observes false.",
          confidence: 0.99,
        }],
        usage: {},
        durationMs: 10,
        reviewedBaseRef: ctx.baseRef,
        reviewedHeadRef: ctx.headRef,
      };
    },
  };

  try {
    const runsDir = await runMatrix(matrixPath, join(root, "runs"), {
      casesDir,
      engineFor: () => engine,
    });
    const manifest = JSON.parse(
      readFileSync(join(runsDir, "matrix-manifest.json"), "utf8"),
    ) as MatrixRunManifest;
    assert.equal(manifest.expectedAttempts.length, 18);
    assert.equal(new Set(manifest.expectedAttempts.map((attempt) => attempt.id)).size, 18);
    assert.equal(new Set(manifest.expectedAttempts.map((attempt) => attempt.file)).size, 18);
    assert.equal(manifest.providerNetworkIsolation.mock?.status, "not-applicable");
    assert.equal(manifest.providerNetworkIsolation.codex?.status, "unavailable");
    assert.ok(manifest.expectedAttempts.every((attempt) => attempt.corpus === "development"));
    assert.ok(manifest.expectedAttempts.every((attempt) => attempt.expectedBugCount === 1));

    const records = readdirSync(runsDir)
      .filter((file) => file.endsWith(".json") && file !== "matrix-manifest.json")
      .map((file) => JSON.parse(readFileSync(join(runsDir, file), "utf8")) as RunRecord);
    assert.equal(records.length, 18);
    const failures = records.filter(
      (record): record is RunRecord & { outcome: Extract<RunRecord["outcome"], { status: "failed" }> } =>
        record.outcome.status === "failed",
    );
    assert.deepEqual(
      [...new Set(failures.map((record) => record.outcome.failureKind))].sort(),
      ["configuration", "parse", "provider", "timeout", "unknown"],
    );
    for (const unknown of failures.filter((record) => record.outcome.failureKind === "unknown")) {
      assert.doesNotMatch(unknown.outcome.message, /abc123456789SECRET/);
    }

    const missingAttempt = manifest.expectedAttempts.find(
      (attempt) => attempt.configName === "missing" && attempt.repeat === 2,
    );
    assert.ok(missingAttempt);
    rmSync(join(runsDir, missingAttempt.file));

    await gradeRuns(runsDir, casesDir);
    const stats = await buildReport(runsDir, { casesDir });
    const completed = stats.find((item) => item.config === "completed");
    assert.equal(completed?.completionRate, 1);
    assert.equal(completed?.corpus, "development");
    assert.equal(completed?.expectedRuns, 4);
    assert.equal(completed?.completedRuns, 4);
    assert.equal(completed?.benchmarkKind, "structural-only");
    assert.equal(completed?.recallMean, null);
    assert.equal(completed?.failureInclusiveRecallMean, null);
    assert.equal(completed?.costPerCaseMean, null);
    const mixed = stats.find((item) => item.config === "mixed");
    assert.equal(mixed?.expectedRuns, 2);
    assert.equal(mixed?.completedRuns, 1);
    assert.equal(mixed?.failedRuns, 1);
    assert.equal(mixed?.completionRate, 0.5);
    assert.equal(mixed?.recallMean, null);
    assert.equal(mixed?.failureInclusiveRecallMean, null);
    assert.notEqual(mixed?.durationSecMean, null);
    assert.equal(mixed?.inputTokensMean, null);
    assert.equal(mixed?.incurredCostUsdTotal, null);
    assert.equal(mixed?.incurredCostObservedAttempts, 0);
    assert.equal(mixed?.telemetryObserved.costUsd, 0);
    const timeout = stats.find((item) => item.config === "timeout");
    assert.equal(timeout?.completionRate, 0);
    assert.equal(timeout?.recallMean, null);
    assert.equal(timeout?.failureInclusiveRecallMean, null);
    assert.notEqual(timeout?.durationSecMean, null);
    const missing = stats.find((item) => item.config === "missing");
    assert.equal(missing?.missingRuns, 1);
    assert.equal(missing?.durationSecMean, null);
    assert.equal(stats.find((item) => item.config === "configuration")?.failuresByKind.configuration, 2);
    assert.equal(stats.find((item) => item.config === "configuration")?.failureRatesByKind.configuration, 1);

    const legacyDir = join(root, "legacy");
    mkdirSync(legacyDir);
    const gradedFile = readdirSync(runsDir).find((file) => {
      if (!file.endsWith(".graded.json")) return false;
      return (JSON.parse(readFileSync(join(runsDir, file), "utf8")) as RunRecord).configName === "completed";
    });
    assert.ok(gradedFile);
    const graded = JSON.parse(readFileSync(join(runsDir, gradedFile), "utf8")) as Record<string, unknown>;
    writeFileSync(join(legacyDir, "new-shape.graded.json"), JSON.stringify(graded));
    const outcome = graded.outcome as { result: unknown };
    const {
      schemaVersion: _schema,
      attemptId: _attempt,
      finishedAt: _finished,
      outcome: _outcome,
      caseCorpus: _corpus,
      runner: _runner,
      evaluationProvenance: _provenance,
      ...legacy
    } = graded;
    writeFileSync(join(legacyDir, "legacy.graded.json"), JSON.stringify({ ...legacy, result: outcome.result }));
    const legacyStats = await buildReport(legacyDir, { casesDir });
    assert.equal(legacyStats[0]?.completeness, "legacy-incomplete");
    assert.equal(legacyStats[0]?.expectedRuns, null);
    assert.equal(legacyStats[0]?.completionRate, null);
    assert.equal(legacyStats[0]?.failureInclusiveRecallMean, null);
    assert.equal(legacyStats[0]?.costPerCaseMean, null);
    assert.equal(legacyStats[0]?.durationSecMean, null);
    assert.equal(legacyStats[0]?.inputTokensMean, null);
    assert.equal(legacyStats[0]?.telemetryExpectedRuns, null);
    assert.equal(legacyStats[0]?.completedRuns, 2);

    const cleanCaseName = "structural-smoke/clean-case";
    const cleanCaseDir = join(casesDir, cleanCaseName);
    mkdirSync(cleanCaseDir, { recursive: true });
    writeFileSync(join(cleanCaseDir, "ground_truth.json"), JSON.stringify({ bugs: [] }));
    const cleanRunsDir = join(root, "clean-runs");
    mkdirSync(cleanRunsDir);
    const cleanAttempt = {
      id: "attempt-000001",
      caseName: cleanCaseName,
      configName: "clean-only",
      repeat: 1,
      file: "attempt-000001.json",
      corpus: "structural-smoke" as const,
      expectedBugCount: 0,
      runner: "mock" as const,
    };
    writeFileSync(
      join(cleanRunsDir, "matrix-manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        expectedAttempts: [cleanAttempt],
        providerNetworkIsolation: { mock: { status: "not-applicable", mechanism: "no provider process" } },
      }),
    );
    const completedRun = records.find((record) => record.outcome.status === "completed");
    assert.ok(completedRun && completedRun.outcome.status === "completed");
    const cleanRun: RunRecord = {
      ...completedRun,
      attemptId: cleanAttempt.id,
      caseName: cleanAttempt.caseName,
      configName: cleanAttempt.configName,
      caseCorpus: cleanAttempt.corpus,
      runner: cleanAttempt.runner,
      outcome: {
        ...completedRun.outcome,
        result: {
          ...completedRun.outcome.result,
          engine: cleanAttempt.runner,
          status: "clean",
          findings: [],
          usage: { provider: "mock" },
        },
      },
    };
    writeFileSync(join(cleanRunsDir, cleanAttempt.file), JSON.stringify(cleanRun));
    writeFileSync(
      join(cleanRunsDir, "attempt-000001.graded.json"),
      JSON.stringify({ ...cleanRun, matches: {}, falsePositiveIndexes: [] }),
    );
    const cleanStats = await buildReport(cleanRunsDir, { casesDir });
    assert.equal(cleanStats[0]?.recallMean, null);
    assert.equal(cleanStats[0]?.failureInclusiveRecallMean, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("malformed or missing truth remains failed and makes mixed denominators unavailable", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-unknown-denominator-"));
  const casesDir = join(root, "cases");
  for (const [id, truth] of [
    ["case-600d0001", JSON.stringify({ bugs: [{ id: "known-1", file: "src/value.ts", startLine: 1, endLine: 1, description: "Known incorrect value." }] })],
    ["case-600d0002", JSON.stringify({ bugs: [{ id: "missing-required-fields" }] })],
    ["case-600d0003", undefined],
  ] as const) {
    const caseDir = join(casesDir, "development", id);
    mkdirSync(join(caseDir, "fixture", "src"), { recursive: true });
    writeFileSync(join(caseDir, "fixture", "src", "value.ts"), "export const value = false;\n");
    writeFileSync(
      join(caseDir, "diff.patch"),
      CANONICAL_VALUE_PATCH,
    );
    writeFileSync(
      join(caseDir, "case.json"),
      JSON.stringify({ id, corpus: "development", kind: "seeded", fixtureDir: "fixture", diffFile: "diff.patch" }),
    );
    if (truth !== undefined) writeFileSync(join(caseDir, "ground_truth.json"), truth);
  }
  const matrixPath = join(root, "matrix.json");
  writeFileSync(
    matrixPath,
    JSON.stringify({ repeats: 1, configs: [{ name: "mock", runner: "mock" }] }),
  );
  const engine: Engine = {
    name: "mock",
    async review(ctx) {
      return { ...completedClean(), reviewedBaseRef: ctx.baseRef, reviewedHeadRef: ctx.headRef };
    },
  };
  try {
    const runsDir = await runMatrix(matrixPath, join(root, "runs"), {
      casesDir,
      engineFor: () => engine,
    });
    await gradeRuns(runsDir, casesDir);
    const stats = await buildReport(runsDir, { casesDir });
    assert.equal(stats.length, 1);
    assert.equal(stats[0]?.corpus, "development");
    assert.equal(stats[0]?.expectedRuns, 3);
    assert.equal(stats[0]?.completedRuns, 1);
    assert.equal(stats[0]?.failedRuns, 2);
    assert.equal(stats[0]?.failureInclusiveRecallMean, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup failures preserve partial and completed provider telemetry", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-cleanup-accounting-"));
  const casesDir = join(root, "cases");
  const caseName = "case-c1ea0001";
  const caseDir = join(casesDir, "development", caseName);
  mkdirSync(join(caseDir, "fixture", "src"), { recursive: true });
  writeFileSync(join(caseDir, "fixture", "src", "value.ts"), "export const value = false;\n");
  writeFileSync(
    join(caseDir, "diff.patch"),
    CANONICAL_VALUE_PATCH,
  );
  writeFileSync(
    join(caseDir, "case.json"),
    JSON.stringify({ id: caseName, corpus: "development", kind: "seeded", fixtureDir: "fixture", diffFile: "diff.patch" }),
  );
  writeFileSync(join(caseDir, "ground_truth.json"), JSON.stringify({ bugs: [] }));
  const matrixPath = join(root, "matrix.json");
  writeFileSync(matrixPath, JSON.stringify({
    repeats: 1,
    configs: [
      { name: "partial", runner: "mock", overrides: { scenario: "partial" } },
      { name: "completed", runner: "mock", overrides: { scenario: "completed" } },
      { name: "no-stages", runner: "mock", overrides: { scenario: "no-stages" } },
    ],
  }));

  const partialUsage = withUnavailable({
    provider: "mock" as const,
    aggregation: "single-envelope" as const,
    costUsd: 0.75,
    costSource: "provider" as const,
  });
  const breadthUsage = withUnavailable({
    provider: "mock" as const,
    aggregation: "single-envelope" as const,
    costUsd: 1,
    costSource: "provider" as const,
  });
  const investigationUsage = withUnavailable({
    provider: "mock" as const,
    aggregation: "single-envelope" as const,
    costUsd: 2,
    costSource: "provider" as const,
  });
  const engine: Engine = {
    name: "mock",
    async review(ctx) {
      const scenario = (ctx.config.runners.mock as Record<string, unknown>).scenario;
      if (scenario === "partial") {
        throw new RunFailureError("timeout", "investigation timed out", {
          telemetry: {
            engine: "mock",
            modelConfig: "mock-partial",
            usage: partialUsage,
            durationMs: 12,
            stages: [{
              stage: "breadth",
              model: "mock-breadth",
              promptSha256: "a".repeat(64),
              usage: partialUsage,
              durationMs: 12,
              completed: true,
            }],
          },
        });
      }
      if (scenario === "no-stages") {
        return {
          ...completedClean(),
          usage: withUnavailable({
            provider: "mock",
            aggregation: "single-envelope",
            costUsd: 5,
            costSource: "provider",
          }),
        };
      }
      return {
        ...completedClean(),
        modelConfig: "mock-completed",
        usage: combineUsage(breadthUsage, investigationUsage),
        durationMs: 30,
        raw: {
          breadth: {
            model: "mock-breadth",
            promptSha256: "b".repeat(64),
            usage: breadthUsage,
            durationMs: 10,
          },
          investigation: {
            model: "mock-investigation",
            promptSha256: "c".repeat(64),
            usage: investigationUsage,
            durationMs: 20,
          },
        },
      };
    },
  };

  try {
    const runsDir = await runMatrix(matrixPath, join(root, "runs"), {
      casesDir,
      engineFor: () => engine,
      materializeCaseFor: async (...args) => {
        const materialized = await materializeCase(...args);
        return {
          ...materialized,
          cleanup() {
            materialized.cleanup();
            throw new Error("forced cleanup failure");
          },
        };
      },
    });
    const manifest = parseMatrixRunManifest(
      JSON.parse(readFileSync(join(runsDir, "matrix-manifest.json"), "utf8")),
    );
    const records = manifest.expectedAttempts.map((attempt) => parseRunRecord(
      JSON.parse(readFileSync(join(runsDir, attempt.file), "utf8")),
      attempt.file,
      attempt,
    ));
    const partial = records.find((record) => record.configName === "partial");
    assert.ok(partial && partial.outcome.status === "failed");
    assert.equal(partial.outcome.failureKind, "timeout");
    assert.match(partial.outcome.message, /cleanup also failed/);
    assert.equal(partial.outcome.telemetry?.usage.costUsd, 0.75);
    assert.equal(partial.outcome.telemetry?.stages.length, 1);

    const completed = records.find((record) => record.configName === "completed");
    assert.ok(completed && completed.outcome.status === "failed");
    assert.equal(completed.outcome.failureKind, "configuration");
    assert.match(completed.outcome.message, /cleanup failed after provider completion/);
    assert.equal(completed.outcome.telemetry?.usage.costUsd, 3);
    assert.equal(completed.outcome.telemetry?.stages.length, 2);
    assert.deepEqual(
      completed.outcome.telemetry?.stages.map((stage) => stage.stage),
      ["breadth", "investigation"],
    );

    const noStages = records.find((record) => record.configName === "no-stages");
    assert.ok(noStages && noStages.outcome.status === "failed");
    assert.equal(noStages.outcome.telemetry, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tracked reports keep development and validation rows separate", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-corpus-groups-"));
  const runsDir = join(root, "runs");
  mkdirSync(runsDir, { recursive: true });
  const expectedAttempts = (["development", "validation"] as const).map((corpus, index) => ({
    id: `attempt-00000${index + 1}`,
    caseName: `${corpus}/case-700d000${index + 1}`,
    corpus,
    expectedBugCount: null,
    configName: "same-config",
    repeat: 1,
    file: `attempt-00000${index + 1}.json`,
    runner: "mock" as const,
  }));
  writeFileSync(
    join(runsDir, "matrix-manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      expectedAttempts,
      providerNetworkIsolation: { mock: { status: "not-applicable", mechanism: "no provider process" } },
    }),
  );
  for (const attempt of expectedAttempts) {
    const record: RunRecord = {
      schemaVersion: 1,
      attemptId: attempt.id,
      caseName: attempt.caseName,
      caseCorpus: attempt.corpus,
      caseKind: "clean",
      configName: attempt.configName,
      repeat: 1,
      runner: attempt.runner,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      outcome: { status: "failed", failureKind: "configuration", message: "fixture unavailable", durationMs: 1 },
    };
    writeFileSync(join(runsDir, attempt.file), JSON.stringify(record));
  }
  try {
    const stats = await buildReport(runsDir, { casesDir: join(root, "missing-cases") });
    assert.deepEqual(stats.map((item) => item.corpus).sort(), ["development", "validation"]);
    assert.ok(stats.every((item) => item.expectedRuns === 1));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("legacy descriptive case names remain reportable through the explicit curator alias map", async () => {
  const truth = readCaseGroundTruth(resolve("eval/cases"), "seeded-null-deref");
  assert.equal(truth.bugs[0]?.id, "null-deref-1");
  const root = mkdtempSync(join(tmpdir(), "peregrine-legacy-alias-"));
  const attempt = {
    id: "attempt-000001",
    caseName: "seeded-null-deref",
    configName: "old-config",
    repeat: 1,
    file: "attempt-000001.json",
  };
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "matrix-manifest.json"),
    JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(), expectedAttempts: [attempt] }),
  );
  writeFileSync(
    join(root, attempt.file),
    JSON.stringify({
      schemaVersion: 1,
      attemptId: attempt.id,
      caseName: attempt.caseName,
      caseKind: "seeded",
      configName: attempt.configName,
      repeat: 1,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      outcome: { status: "failed", failureKind: "provider", message: "legacy failure", durationMs: 1 },
    }),
  );
  try {
    const stats = await buildReport(root, { casesDir: resolve("eval/cases") });
    assert.equal(stats[0]?.corpus, "unknown");
    assert.equal(stats[0]?.failureInclusiveRecallMean, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid case definitions are persisted as configuration failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-invalid-case-test-"));
  const caseDir = join(root, "cases", "development", "case-badbad00");
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(
    join(caseDir, "case.json"),
    JSON.stringify({ id: "case-badbad00", corpus: "development", kind: "seeded", diffFile: "diff.patch" }),
  );
  const matrixPath = join(root, "matrix.json");
  writeFileSync(
    matrixPath,
    JSON.stringify({ repeats: 1, configs: [{ name: "mock", runner: "mock" }] }),
  );
  try {
    const runsDir = await runMatrix(matrixPath, join(root, "runs"), {
      casesDir: join(root, "cases"),
      engineFor: () => {
        throw new Error("engine should not be selected for an invalid case");
      },
    });
    const recordFile = readdirSync(runsDir).find((file) => file.startsWith("attempt-") && file.endsWith(".json"));
    assert.ok(recordFile);
    const record = JSON.parse(readFileSync(join(runsDir, recordFile), "utf8")) as RunRecord;
    assert.equal(record.outcome.status, "failed");
    if (record.outcome.status === "failed") {
      assert.equal(record.outcome.failureKind, "configuration");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function completedClean(): Awaited<ReturnType<Engine["review"]>> {
  return {
    engine: "mock",
    status: "clean",
    modelConfig: "mock",
    findings: [],
    usage: {},
    durationMs: 1,
  };
}
