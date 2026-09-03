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
import { buildReport, calculateStats } from "../eval/report.js";
import { failureOutcomeForArtifact, runMatrix } from "../eval/run-matrix.js";
import { materializeCase, networkIsolationCapability } from "../eval/case-isolation.js";
import { readCaseGroundTruth } from "../eval/case-truth.js";
import {
  assertGradedMatchesRun,
  isPreTelemetryMatrixRunManifest,
  parseGradedRun,
  parseLegacyMatrixRunManifest,
  parseLegacySchemaV1GradedRun,
  parseLegacySchemaV1RunRecord,
  parseMatrixRunManifest,
  parsePreTelemetryGradedRun,
  parsePreTelemetryMatrixRunManifest,
  parsePreTelemetryRunRecord,
  parseRunRecord,
} from "../eval/artifacts.js";
import { RunFailureError } from "../src/core/run-failure.js";
import { combineUsage, mockUsage, sha256, withUnavailable } from "../src/core/telemetry.js";
import type { Engine } from "../src/engines/engine.js";
import type { EvaluationAttemptProvenance, GradedRun, MatrixModelConfig, MatrixRunManifest, RunAttempt, RunRecord } from "../src/types.js";

function validAttempt(): RunAttempt {
  return {
    id: "attempt-000001",
    caseName: "development/case-00000001",
    configName: "route",
    repeat: 1,
    file: "attempt-000001.json",
    corpus: "development",
    expectedBugCount: 1,
    runner: "claude",
  };
}

function emptyBreadthOutput(model = "fast") {
  return {
    model,
    candidates: [],
    clear: [],
    escalations: [],
    coverage: { coveredFiles: ["src/value.ts"], unavailable: [] },
  };
}

function validRecord(): RunRecord {
  const provenance = validEvaluationProvenance();
  const breadthUsage = withUnavailable({
    provider: "anthropic",
    aggregation: "single-envelope",
    inputTokens: 4,
    baseInputTokens: 4,
    uncachedInputTokens: 4,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    cacheReadInputTokens: 0,
    toolCalls: 0,
    toolCallsByType: {},
    promptBytes: 40,
  });
  const investigationUsage = withUnavailable({
    provider: "anthropic",
    aggregation: "single-envelope",
    inputTokens: 6,
    baseInputTokens: 6,
    uncachedInputTokens: 6,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    cacheReadInputTokens: 0,
    toolCalls: 0,
    toolCallsByType: {},
    promptBytes: 60,
  });
  return {
    schemaVersion: 1,
    attemptId: "attempt-000001",
    caseName: "development/case-00000001",
    caseKind: "seeded",
    configName: "route",
    repeat: 1,
    caseCorpus: "development",
    runner: "claude",
    startedAt: "2026-09-02T00:00:00.000Z",
    finishedAt: "2026-09-02T00:00:01.000Z",
    attemptDurationMs: 1000,
    evaluationProvenance: provenance,
    outcome: {
      status: "completed",
      result: {
        engine: "claude",
        status: "completed",
        modelConfig: "fast/low->strong/high",
        reviewedBaseRef: provenance.history.baseRef,
        reviewedHeadRef: provenance.history.headRef,
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
        usage: combineUsage(breadthUsage, investigationUsage),
        durationMs: 1000,
        raw: {
          manifest: provenance.manifest!.output,
          breadth: {
            output: emptyBreadthOutput(),
            model: "fast",
            promptSha256: "a".repeat(64),
            usage: breadthUsage,
            durationMs: 400,
          },
          investigation: {
            model: "strong",
            promptSha256: "b".repeat(64),
            usage: investigationUsage,
            durationMs: 600,
          },
        },
      },
    },
  };
}

function validCodexRecord(): RunRecord {
  const record = structuredClone(validRecord());
  if (record.outcome.status !== "completed") throw new Error("expected completed fixture");
  const stageUsage = (inputTokens: number, promptBytes: number) => withUnavailable({
    provider: "openai" as const,
    aggregation: "single-snapshot" as const,
    inputTokens,
    uncachedInputTokens: inputTokens,
    cachedInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 1,
    turns: 1,
    toolCalls: 0,
    toolCallsByType: {},
    toolOutputBytes: 0,
    promptBytes,
  });
  const breadthUsage = stageUsage(4, 40);
  const investigationUsage = stageUsage(6, 60);
  record.runner = "codex";
  record.outcome.result.engine = "codex";
  record.outcome.result.usage = combineUsage(breadthUsage, investigationUsage);
  record.outcome.result.raw = {
    manifest: record.evaluationProvenance!.manifest!.output,
    breadth: {
      output: emptyBreadthOutput(),
      model: "fast",
      promptSha256: "a".repeat(64),
      usage: breadthUsage,
      durationMs: 400,
      malformedEventLines: 0,
    },
    investigation: {
      output: { findings: structuredClone(record.outcome.result.findings) },
      model: "strong",
      promptSha256: "b".repeat(64),
      usage: investigationUsage,
      durationMs: 600,
      malformedEventLines: 0,
    },
  };
  return record;
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
  return validRecord();
}

test("evaluation artifact parsers reject schema, identity, enum, and numeric tampering", () => {
  const attempt = validAttempt();
  const manifest = {
    schemaVersion: 1,
    createdAt: "2026-09-02T00:00:00.000Z",
    expectedAttempts: [attempt],
    providerNetworkIsolation: {
      claude: networkIsolationCapability("claude"),
    },
  };
  assert.doesNotThrow(() => parseMatrixRunManifest(manifest));
  assert.doesNotThrow(() => parseMatrixRunManifest({
    ...manifest,
    providerNetworkIsolation: {
      claude: {
        status: "unavailable",
        mechanism:
          "CLI customization surfaces are disabled, but external filesystem and network containment are not attested; live matrix attempts fail closed.",
      },
    },
  }), "schema-v1 capability evidence remains readable independently of runtime evolution");
  assert.throws(
    () => parseMatrixRunManifest({ ...manifest, providerNetworkIsolation: {} }),
    /providerNetworkIsolation is missing claude/,
  );
  assert.throws(
    () => parseMatrixRunManifest({
      ...manifest,
      providerNetworkIsolation: {
        claude: { status: "limited", mechanism: "provider-specific sandbox" },
      },
    }),
    /does not match the runner capability/,
  );
  assert.throws(
    () => parseMatrixRunManifest({
      ...manifest,
      providerNetworkIsolation: {
        claude: { status: "enforced", mechanism: "self-asserted sandbox" },
      },
    }),
    /does not match the runner capability/,
  );
  assert.throws(
    () => parseMatrixRunManifest({
      ...manifest,
      providerNetworkIsolation: {
        claude: { status: "not-applicable", mechanism: "no provider process" },
      },
    }),
    /providerNetworkIsolation\.claude does not match the runner capability/,
  );
  assert.throws(
    () => parseMatrixRunManifest({
      ...manifest,
      providerNetworkIsolation: {
        claude: networkIsolationCapability("claude"),
        codex: networkIsolationCapability("codex"),
      },
    }),
    /providerNetworkIsolation has undeclared codex/,
  );
  const secretConfigManifest = structuredClone(manifest);
  secretConfigManifest.expectedAttempts[0]!.configName = "token=abc123456789SECRET";
  assert.throws(
    () => parseMatrixRunManifest(secretConfigManifest),
    /secret pattern|credential-like assignment/,
  );
  const relabeledCorpus = structuredClone(manifest);
  relabeledCorpus.expectedAttempts[0]!.corpus = "validation";
  assert.throws(
    () => parseMatrixRunManifest(relabeledCorpus),
    /caseName must be nested directly under its corpus/,
  );
  const descriptiveCase = structuredClone(manifest);
  descriptiveCase.expectedAttempts[0]!.caseName = "development/descriptive-case";
  assert.throws(
    () => parseMatrixRunManifest(descriptiveCase),
    /caseName basename must match/,
  );
  const duplicateLogicalAttempt = structuredClone(manifest);
  duplicateLogicalAttempt.expectedAttempts.push({
    ...duplicateLogicalAttempt.expectedAttempts[0]!,
    id: "attempt-000002",
    file: "attempt-000002.json",
  });
  assert.throws(
    () => parseMatrixRunManifest(duplicateLogicalAttempt),
    /duplicate logical attempt/,
  );
  assert.doesNotThrow(() => parseRunRecord(validRecord(), "record", attempt));
  const currentWithoutProvenance = structuredClone(validRecord());
  delete currentWithoutProvenance.evaluationProvenance;
  assert.throws(
    () => parseRunRecord(currentWithoutProvenance, "completed without provenance", attempt),
    /evaluationProvenance is required for a completed attempt/,
  );
  currentWithoutProvenance.outcome = {
    status: "failed",
    failureKind: "configuration",
    message: "case materialization failed",
    durationMs: 1,
  };
  assert.doesNotThrow(
    () => parseRunRecord(currentWithoutProvenance, "pre-materialization failure", attempt),
  );
  const failedStageUsage = withUnavailable({
    provider: "anthropic",
    aggregation: "single-envelope",
    promptBytes: 1,
  });
  currentWithoutProvenance.outcome.failureKind = "provider";
  currentWithoutProvenance.outcome.telemetry = {
    engine: "claude",
    modelConfig: "fast/low->strong/high",
    usage: failedStageUsage,
    durationMs: 1,
    stages: [{
      stage: "breadth",
      model: "fast",
      promptSha256: "a".repeat(64),
      usage: failedStageUsage,
      durationMs: 1,
      completed: false,
    }],
  };
  assert.throws(
    () => parseRunRecord(currentWithoutProvenance, "provider failure without provenance", attempt),
    /evaluationProvenance is required for a post-materialization failure/,
  );

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
    assert.throws(
      () => parseRunRecord(tampered, "record", attempt),
      /does not match matrix manifest|does not match runner|nested directly under its corpus/,
    );
  }

  const fractionalUsage = structuredClone(validRecord());
  if (fractionalUsage.outcome.status !== "completed") throw new Error("expected completed fixture");
  fractionalUsage.outcome.result.usage.inputTokens = 1.5;
  assert.throws(() => parseRunRecord(fractionalUsage, "record", attempt), /safe integer/);

  const wrongProvider = structuredClone(validRecord());
  if (wrongProvider.outcome.status !== "completed") throw new Error("expected completed fixture");
  wrongProvider.outcome.result.usage.provider = "openai";
  assert.throws(() => parseRunRecord(wrongProvider, "record", attempt), /does not match claude runner/);

  const missingAggregateProvider = structuredClone(validRecord());
  if (missingAggregateProvider.outcome.status !== "completed") throw new Error("expected completed fixture");
  delete missingAggregateProvider.outcome.result.usage.provider;
  assert.throws(
    () => parseRunRecord(missingAggregateProvider, "current aggregate without provider", attempt),
    /usage\.provider does not match claude runner/,
  );

  const missingStageProvider = structuredClone(validRecord());
  if (missingStageProvider.outcome.status !== "completed") throw new Error("expected completed fixture");
  const raw = missingStageProvider.outcome.result.raw as {
    breadth: { usage: { provider?: string } };
  };
  delete raw.breadth.usage.provider;
  assert.throws(
    () => parseRunRecord(missingStageProvider, "current stage without provider", attempt),
    /raw\.breadth\.usage\.provider does not match claude runner/,
  );

  const unattributedCost = structuredClone(validRecord());
  if (unattributedCost.outcome.status !== "completed") throw new Error("expected completed fixture");
  const unattributedBreadth = withUnavailable({
    provider: "anthropic",
    aggregation: "single-envelope",
    promptBytes: 0,
    costUsd: 0.4,
  });
  const unattributedInvestigation = withUnavailable({
    provider: "anthropic",
    aggregation: "single-envelope",
    promptBytes: 0,
    costUsd: 0.6,
  });
  unattributedCost.outcome.result.usage = combineUsage(
    unattributedBreadth,
    unattributedInvestigation,
  );
  unattributedCost.outcome.result.raw = {
    breadth: {
      model: "fast",
      promptSha256: "a".repeat(64),
      usage: unattributedBreadth,
      durationMs: 400,
    },
    investigation: {
      model: "strong",
      promptSha256: "b".repeat(64),
      usage: unattributedInvestigation,
      durationMs: 600,
    },
  };
  assert.throws(
    () => parseRunRecord(unattributedCost, "current cost without source", attempt),
    /costSource is required when costUsd is present in current telemetry/,
  );

  const mismatchedPricingModel = structuredClone(validRecord());
  if (mismatchedPricingModel.outcome.status !== "completed") throw new Error("expected completed fixture");
  const estimatedBreadth = withUnavailable({
    provider: "anthropic",
    aggregation: "single-envelope",
    promptBytes: 0,
    costUsd: 0.4,
    costSource: "estimated",
    pricing: {
      catalogVersion: "v1",
      pricingAsOf: "2026-09-03",
      contractModel: "different-fast-model",
      tier: "default",
      assumptions: [],
    },
  });
  const estimatedInvestigation = withUnavailable({
    provider: "anthropic",
    aggregation: "single-envelope",
    promptBytes: 0,
    costUsd: 0.6,
    costSource: "estimated",
    pricing: {
      catalogVersion: "v1",
      pricingAsOf: "2026-09-03",
      contractModel: "strong",
      tier: "default",
      assumptions: [],
    },
  });
  mismatchedPricingModel.outcome.result.usage = combineUsage(
    estimatedBreadth,
    estimatedInvestigation,
  );
  mismatchedPricingModel.outcome.result.raw = {
    breadth: {
      model: "fast",
      promptSha256: "a".repeat(64),
      usage: estimatedBreadth,
      durationMs: 400,
    },
    investigation: {
      model: "strong",
      promptSha256: "b".repeat(64),
      usage: estimatedInvestigation,
      durationMs: 600,
    },
  };
  assert.throws(
    () => parseRunRecord(mismatchedPricingModel, "current stage with mismatched pricing", attempt),
    /pricing\.contractModel must match the stage model/,
  );

  const mismatchedPricingTier = structuredClone(validRecord());
  if (mismatchedPricingTier.outcome.status !== "completed") throw new Error("expected completed fixture");
  const tierRaw = mismatchedPricingTier.outcome.result.raw as {
    breadth: { usage: ReturnType<typeof withUnavailable> };
    investigation: { usage: ReturnType<typeof withUnavailable> };
  };
  tierRaw.breadth.usage = withUnavailable({
    provider: "anthropic",
    serviceTier: "priority",
    aggregation: "single-envelope",
    promptBytes: 40,
    costUsd: 0.4,
    costSource: "estimated",
    pricing: {
      catalogVersion: "v1",
      pricingAsOf: "2026-09-03",
      contractModel: "fast",
      tier: "default",
      assumptions: [],
    },
  });
  mismatchedPricingTier.outcome.result.usage = combineUsage(
    tierRaw.breadth.usage,
    tierRaw.investigation.usage,
  );
  assert.throws(
    () => parseRunRecord(mismatchedPricingTier, "current stage with mismatched pricing tier", attempt),
    /serviceTier must match stage pricing provenance/,
  );

  const ambiguousCompletedClaude = structuredClone(validRecord());
  if (ambiguousCompletedClaude.outcome.status !== "completed") throw new Error("expected completed fixture");
  const ambiguousRaw = ambiguousCompletedClaude.outcome.result.raw as {
    breadth: { usage: ReturnType<typeof withUnavailable> };
    investigation: { usage: ReturnType<typeof withUnavailable> };
  };
  ambiguousRaw.breadth.usage = withUnavailable({
    provider: "anthropic",
    aggregation: "ambiguous",
    promptBytes: 40,
  });
  ambiguousCompletedClaude.outcome.result.usage = combineUsage(
    ambiguousRaw.breadth.usage,
    ambiguousRaw.investigation.usage,
  );
  assert.throws(
    () => parseRunRecord(ambiguousCompletedClaude, "ambiguous completed Claude stage", attempt),
    /aggregation does not match a provider stage/,
  );

  const malformedSnapshot = validCodexRecord();
  if (malformedSnapshot.outcome.status !== "completed") throw new Error("expected completed fixture");
  (malformedSnapshot.outcome.result.raw as {
    breadth: { malformedEventLines: number };
  }).breadth.malformedEventLines = 1;
  assert.throws(
    () => parseRunRecord(
      malformedSnapshot,
      "Codex malformed lines with snapshot usage",
      { ...attempt, runner: "codex" },
    ),
    /malformedEventLines must be zero for single-snapshot usage/,
  );

  const providerCostCodex = validCodexRecord();
  if (providerCostCodex.outcome.status !== "completed") throw new Error("expected completed fixture");
  const providerCostRaw = providerCostCodex.outcome.result.raw as {
    breadth: { usage: ReturnType<typeof withUnavailable> };
    investigation: { usage: ReturnType<typeof withUnavailable> };
  };
  providerCostRaw.breadth.usage.costUsd = 0.01;
  providerCostRaw.breadth.usage.costSource = "provider";
  providerCostRaw.breadth.usage.unavailable = providerCostRaw.breadth.usage.unavailable?.filter(
    (metric) => metric !== "costUsd",
  );
  providerCostCodex.outcome.result.usage = combineUsage(
    providerCostRaw.breadth.usage,
    providerCostRaw.investigation.usage,
  );
  assert.throws(
    () => parseRunRecord(
      providerCostCodex,
      "Codex provider-reported cost",
      { ...attempt, runner: "codex" },
    ),
    /provider was not emitted by the current Codex writer/,
  );

  const malformedBreadth = structuredClone(validRecord());
  if (malformedBreadth.outcome.status !== "completed") throw new Error("expected completed fixture");
  (malformedBreadth.outcome.result.raw as { breadth: { output: unknown } }).breadth.output = {};
  assert.throws(
    () => parseRunRecord(malformedBreadth, "current malformed breadth", attempt),
    /candidates.*array/,
  );

  const splitBrainCodex = validCodexRecord();
  const codexRaw = splitBrainCodex.outcome.status === "completed"
    ? splitBrainCodex.outcome.result.raw as { investigation: { output: { findings: unknown[] } } }
    : undefined;
  codexRaw!.investigation.output.findings = [];
  assert.throws(
    () => parseRunRecord(splitBrainCodex, "current split-brain Codex", { ...attempt, runner: "codex" }),
    /output findings do not match the result findings/,
  );

  const mismatchedRawManifest = structuredClone(validRecord());
  if (mismatchedRawManifest.outcome.status !== "completed") throw new Error("expected completed fixture");
  (mismatchedRawManifest.outcome.result.raw as { manifest: string }).manifest = "different manifest";
  assert.throws(
    () => parseRunRecord(mismatchedRawManifest, "current mismatched raw manifest", attempt),
    /raw\.manifest does not match manifest provenance output/,
  );

  const nonsenseEffort = structuredClone(validRecord());
  if (nonsenseEffort.outcome.status !== "completed") throw new Error("expected completed fixture");
  nonsenseEffort.outcome.result.modelConfig = "fast/warp->strong/high";
  assert.throws(
    () => parseRunRecord(nonsenseEffort, "current nonsense effort", attempt),
    /invalid claude reasoning effort/,
  );

  const forgedMock = structuredClone(validRecord());
  if (forgedMock.outcome.status !== "completed") throw new Error("expected completed fixture");
  forgedMock.runner = "mock";
  forgedMock.outcome.result.engine = "mock";
  forgedMock.outcome.result.modelConfig = "mock";
  forgedMock.outcome.result.usage = { ...mockUsage(), outputTokens: 1 };
  delete forgedMock.outcome.result.raw;
  assert.throws(
    () => parseRunRecord(forgedMock, "forged current mock", { ...attempt, runner: "mock" }),
    /does not match the current mock writer/,
  );

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

  const secretFailure = structuredClone(validRecord());
  secretFailure.outcome = {
    status: "failed",
    failureKind: "configuration",
    message: "token=abc123456789SECRET",
    durationMs: 1,
  };
  delete secretFailure.evaluationProvenance;
  secretFailure.finishedAt = "2026-09-02T00:00:00.001Z";
  secretFailure.attemptDurationMs = 1;
  assert.throws(
    () => parseRunRecord(secretFailure, "secret failure record", attempt),
    /secret pattern|credential-like assignment/,
  );

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
  const conflictingManifest = structuredClone(provenanceRecord);
  conflictingManifest.evaluationProvenance!.manifest!.output +=
    `base: ${"0".repeat(40)} (argument)\n`;
  conflictingManifest.evaluationProvenance!.manifest!.outputSha256 = sha256(
    conflictingManifest.evaluationProvenance!.manifest!.output,
  );
  assert.throws(
    () => parseRunRecord(conflictingManifest, "conflicting manifest", attempt),
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
    telemetry: {
      engine: "claude",
      modelConfig: "fast/low->strong/high",
      usage: failedStageUsage,
      durationMs: 1,
      stages: [{
        stage: "breadth",
        model: "fast",
        promptSha256: "a".repeat(64),
        usage: failedStageUsage,
        durationMs: 1,
        completed: false,
      }],
    },
  };
  assert.throws(
    () => parseRunRecord(failedWithoutManifest, "failure without manifest", attempt),
    /manifest is required for a post-preflight failure/,
  );
  failedWithoutManifest.outcome.failureKind = "configuration";
  delete failedWithoutManifest.outcome.telemetry;
  assert.doesNotThrow(
    () => parseRunRecord(failedWithoutManifest, "preflight configuration failure", attempt),
  );

  const mismatchedCaseKind = structuredClone(provenanceRecord);
  mismatchedCaseKind.caseKind = "historical";
  assert.throws(
    () => parseRunRecord(mismatchedCaseKind, "mismatched case kind", attempt),
    /caseKind does not match history materialization/,
  );
  const historicalRecord = structuredClone(provenanceRecord);
  historicalRecord.caseKind = "historical";
  const historicalRecordHistory = historicalRecord.evaluationProvenance!.history;
  historicalRecordHistory.materialization = "historical-sanitized-export";
  historicalRecordHistory.historicalSource = {
    sourceIdentitySha256: "6".repeat(64),
    sourceBaseRef: historicalRecordHistory.baseRef,
    sourceHeadRef: historicalRecordHistory.headRef,
    sourceMergeBase: historicalRecordHistory.baseRef,
    sourceBaseTree: historicalRecordHistory.baseTree,
    sourceHeadTree: historicalRecordHistory.headTree,
    baseCommitIsMergeBase: true,
    baseTreeMatches: true,
    headTreeMatches: true,
  };
  assert.doesNotThrow(() => parseRunRecord(historicalRecord, "historical record", attempt));
  const collapsedHistoricalSource = structuredClone(historicalRecord);
  const historicalSource = collapsedHistoricalSource.evaluationProvenance!.history.historicalSource!;
  historicalSource.sourceHeadRef = historicalSource.sourceBaseRef;
  assert.throws(
    () => parseRunRecord(collapsedHistoricalSource, "collapsed historical source", attempt),
    /sourceBaseRef and sourceHeadRef must be distinct commits/,
  );
  historicalRecord.caseKind = "clean";
  assert.throws(
    () => parseRunRecord(historicalRecord, "historical history with fixture kind", attempt),
    /caseKind does not match history materialization/,
  );

  const collapsedCommits = structuredClone(provenanceRecord);
  const collapsedBase = collapsedCommits.evaluationProvenance!.history.baseRef;
  collapsedCommits.evaluationProvenance!.history.headRef = collapsedBase;
  collapsedCommits.evaluationProvenance!.manifest!.headRef = collapsedBase;
  collapsedCommits.evaluationProvenance!.manifest!.output =
    collapsedCommits.evaluationProvenance!.manifest!.output.replace(
      `head: ${"2".repeat(40)}`,
      `head: ${collapsedBase}`,
    );
  collapsedCommits.evaluationProvenance!.manifest!.outputSha256 = sha256(
    collapsedCommits.evaluationProvenance!.manifest!.output,
  );
  if (collapsedCommits.outcome.status !== "completed") throw new Error("expected completed fixture");
  collapsedCommits.outcome.result.reviewedHeadRef = collapsedBase;
  assert.throws(
    () => parseRunRecord(collapsedCommits, "collapsed commits", attempt),
    /baseRef and headRef must be distinct commits/,
  );
  const collapsedTrees = structuredClone(provenanceRecord);
  collapsedTrees.evaluationProvenance!.history.headTree =
    collapsedTrees.evaluationProvenance!.history.baseTree;
  assert.throws(
    () => parseRunRecord(collapsedTrees, "collapsed trees", attempt),
    /baseTree and headTree must be distinct trees/,
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
  const mismatchedGradedProvenance = validEvaluationProvenance();
  mismatchedGradedProvenance.history.diffSha256 = "6".repeat(64);
  assert.throws(
    () => assertGradedMatchesRun(
      { ...graded, evaluationProvenance: mismatchedGradedProvenance },
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
    promptBytes: 0,
    costUsd: 1,
    costSource: "provider",
  });
  const forged = structuredClone(validRecord());
  if (forged.outcome.status !== "completed") throw new Error("expected completed fixture");
  forged.outcome.result.usage = { ...combineUsage(stageUsage, stageUsage), costUsd: 0.01 };
  forged.outcome.result.raw = {
    manifest: validEvaluationProvenance().manifest!.output,
    breadth: {
      output: emptyBreadthOutput(),
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
    promptBytes: 0,
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
        modelConfig: "fast/low->strong/high",
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

test("strict current failure telemetry requires provider identity and cost provenance", () => {
  const stageUsage = withUnavailable({
    provider: "anthropic",
    aggregation: "single-envelope",
    inputTokens: 5,
    baseInputTokens: 5,
    uncachedInputTokens: 5,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    cacheReadInputTokens: 0,
    promptBytes: 0,
  });
  const failed: RunRecord = {
    ...structuredClone(validRecord()),
    outcome: {
      status: "failed",
      failureKind: "provider",
      message: "provider failed after breadth",
      durationMs: 10,
      telemetry: {
        engine: "claude",
        modelConfig: "fast/low->strong/high",
        usage: stageUsage,
        durationMs: 10,
        stages: [{
          stage: "breadth",
          model: "fast",
          promptSha256: "a".repeat(64),
          usage: stageUsage,
          durationMs: 10,
          completed: false,
        }],
      },
    },
  };

  const missingProvider = structuredClone(failed);
  if (missingProvider.outcome.status !== "failed" || !missingProvider.outcome.telemetry) {
    throw new Error("expected failure telemetry fixture");
  }
  delete missingProvider.outcome.telemetry.usage.provider;
  delete missingProvider.outcome.telemetry.stages[0]!.usage.provider;
  assert.throws(
    () => parseRunRecord(missingProvider, "current failure without provider", validAttempt()),
    /telemetry\.usage\.provider does not match claude runner/,
  );

  const stageMissingProvider = structuredClone(failed);
  if (stageMissingProvider.outcome.status !== "failed" || !stageMissingProvider.outcome.telemetry) {
    throw new Error("expected failure telemetry fixture");
  }
  stageMissingProvider.outcome.telemetry.stages[0]!.usage = {
    ...stageMissingProvider.outcome.telemetry.stages[0]!.usage,
  };
  delete stageMissingProvider.outcome.telemetry.stages[0]!.usage.provider;
  assert.throws(
    () => parseRunRecord(stageMissingProvider, "current failure stage without provider", validAttempt()),
    /stages\[0\]\.usage\.provider does not match claude runner/,
  );

  for (const failureKind of ["provider", "timeout", "parse"] as const) {
    const missingTelemetry = structuredClone(failed);
    if (missingTelemetry.outcome.status !== "failed") throw new Error("expected failure fixture");
    missingTelemetry.outcome.failureKind = failureKind;
    delete missingTelemetry.outcome.telemetry;
    assert.throws(
      () => parseRunRecord(missingTelemetry, `${failureKind} failure without telemetry`, validAttempt()),
      new RegExp(`must record telemetry or telemetryUnavailableReason for ${failureKind} failures`),
    );
    missingTelemetry.outcome.telemetryUnavailableReason = "not-observed";
    assert.doesNotThrow(
      () => parseRunRecord(
        missingTelemetry,
        `${failureKind} failure with explicitly unavailable telemetry`,
        validAttempt(),
      ),
    );
  }

  const unattributedCost = structuredClone(failed);
  if (unattributedCost.outcome.status !== "failed" || !unattributedCost.outcome.telemetry) {
    throw new Error("expected failure telemetry fixture");
  }
  const unattributedFailureUsage = withUnavailable({
    provider: "anthropic",
    aggregation: "single-envelope",
    inputTokens: 5,
    baseInputTokens: 5,
    uncachedInputTokens: 5,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    cacheReadInputTokens: 0,
    promptBytes: 0,
    costUsd: 0.5,
  });
  unattributedCost.outcome.telemetry.usage = unattributedFailureUsage;
  unattributedCost.outcome.telemetry.stages[0]!.usage = structuredClone(unattributedFailureUsage);
  assert.throws(
    () => parseRunRecord(unattributedCost, "current failure cost without source", validAttempt()),
    /costSource is required when costUsd is present in current telemetry/,
  );

  const mockFailure = structuredClone(failed);
  mockFailure.runner = "mock";
  if (mockFailure.outcome.status !== "failed" || !mockFailure.outcome.telemetry) {
    throw new Error("expected failure telemetry fixture");
  }
  mockFailure.outcome.telemetry.engine = "mock";
  mockFailure.outcome.telemetry.usage = mockUsage();
  mockFailure.outcome.telemetry.stages[0]!.usage = mockUsage();
  assert.throws(
    () => parseRunRecord(
      mockFailure,
      "current mock failure telemetry",
      { ...validAttempt(), runner: "mock" },
    ),
    /telemetry must be absent for the current mock writer/,
  );
  delete mockFailure.outcome.telemetry;
  mockFailure.outcome.telemetryUnavailableReason = "secret-redacted";
  assert.throws(
    () => parseRunRecord(
      mockFailure,
      "current mock unavailable telemetry reason",
      { ...validAttempt(), runner: "mock" },
    ),
    /telemetryUnavailableReason must be absent for the current mock writer/,
  );

  const conflictingAvailability = structuredClone(failed);
  if (conflictingAvailability.outcome.status !== "failed") throw new Error("expected failure fixture");
  conflictingAvailability.outcome.telemetryUnavailableReason = "secret-redacted";
  assert.throws(
    () => parseRunRecord(conflictingAvailability, "conflicting telemetry availability", validAttempt()),
    /cannot contain both telemetry and telemetryUnavailableReason/,
  );

  const ambiguousClaudeFailure = structuredClone(failed);
  if (ambiguousClaudeFailure.outcome.status !== "failed" || !ambiguousClaudeFailure.outcome.telemetry) {
    throw new Error("expected failure telemetry fixture");
  }
  const ambiguousUsage = withUnavailable({
    provider: "anthropic",
    aggregation: "ambiguous",
    promptBytes: 0,
  });
  ambiguousClaudeFailure.outcome.telemetry.usage = ambiguousUsage;
  ambiguousClaudeFailure.outcome.telemetry.stages[0]!.usage = ambiguousUsage;
  assert.doesNotThrow(
    () => parseRunRecord(ambiguousClaudeFailure, "ambiguous Claude failure", validAttempt()),
  );
  ambiguousClaudeFailure.outcome.telemetry.stages[0]!.completed = true;
  assert.throws(
    () => parseRunRecord(ambiguousClaudeFailure, "ambiguous completed Claude failure stage", validAttempt()),
    /aggregation does not match a provider stage/,
  );

  const allCompletedProvider = structuredClone(failed);
  if (allCompletedProvider.outcome.status !== "failed" || !allCompletedProvider.outcome.telemetry) {
    throw new Error("expected failure telemetry fixture");
  }
  allCompletedProvider.outcome.telemetry.stages[0]!.completed = true;
  assert.throws(
    () => parseRunRecord(allCompletedProvider, "provider failure with completed stage", validAttempt()),
    /provider failure requires an incomplete final stage/,
  );

  const incompleteConfiguration = structuredClone(failed);
  if (incompleteConfiguration.outcome.status !== "failed") throw new Error("expected failure fixture");
  incompleteConfiguration.outcome.failureKind = "configuration";
  assert.throws(
    () => parseRunRecord(incompleteConfiguration, "configuration failure with incomplete stage", validAttempt()),
    /configuration telemetry may contain only completed stages/,
  );
});

test("failure artifact writing records why provider telemetry is unavailable", () => {
  const stageUsage = withUnavailable({
    provider: "anthropic",
    aggregation: "single-envelope",
    promptBytes: 1,
  });
  const secretTelemetry = {
    engine: "claude" as const,
    modelConfig: "token=abc123456789SECRET/low->strong/high",
    usage: stageUsage,
    durationMs: 10,
    stages: [{
      stage: "breadth" as const,
      model: "token=abc123456789SECRET",
      promptSha256: "a".repeat(64),
      usage: stageUsage,
      durationMs: 10,
      completed: false,
    }],
  };
  const secretRedacted = failureOutcomeForArtifact(
    "claude",
    new RunFailureError("provider", "provider failed", { telemetry: secretTelemetry }),
    10,
  );
  assert.equal(secretRedacted.telemetry, undefined);
  assert.equal(secretRedacted.telemetryUnavailableReason, "secret-redacted");
  assert.doesNotMatch(JSON.stringify(secretRedacted), /abc123456789SECRET/);

  const redactedRecord = structuredClone(validRecord());
  redactedRecord.outcome = secretRedacted;
  assert.doesNotThrow(
    () => parseRunRecord(redactedRecord, "secret-redacted provider failure", validAttempt()),
  );

  const notObserved = failureOutcomeForArtifact(
    "claude",
    new RunFailureError("timeout", "provider timed out"),
    10,
  );
  assert.equal(notObserved.telemetry, undefined);
  assert.equal(notObserved.telemetryUnavailableReason, "not-observed");
  const unavailableRecord = structuredClone(validRecord());
  unavailableRecord.outcome = notObserved;
  assert.doesNotThrow(
    () => parseRunRecord(unavailableRecord, "unobserved provider telemetry", validAttempt()),
  );
});

test("strict current telemetry rejects impossible provider token decompositions", () => {
  const anthropicUsage = (inputTokens: number) => withUnavailable({
    provider: "anthropic" as const,
    aggregation: "single-envelope" as const,
    inputTokens,
    baseInputTokens: 6,
    uncachedInputTokens: 6,
    cachedInputTokens: 4,
    cacheWriteInputTokens: 1,
    cacheReadInputTokens: 3,
    promptBytes: 0,
  });
  const aggregateMismatch = structuredClone(validRecord());
  if (aggregateMismatch.outcome.status !== "completed") throw new Error("expected completed fixture");
  const invalidAnthropic = anthropicUsage(11);
  const validAnthropic = anthropicUsage(10);
  aggregateMismatch.outcome.result.usage = combineUsage(invalidAnthropic, validAnthropic);
  aggregateMismatch.outcome.result.raw = {
    breadth: {
      model: "fast",
      promptSha256: "a".repeat(64),
      usage: invalidAnthropic,
      durationMs: 400,
    },
    investigation: {
      model: "strong",
      promptSha256: "b".repeat(64),
      usage: validAnthropic,
      durationMs: 600,
    },
  };
  assert.throws(
    () => parseRunRecord(aggregateMismatch, "anthropic aggregate mismatch", validAttempt()),
    /result\.usage\.inputTokens must equal baseInputTokens \+ cacheWriteInputTokens \+ cacheReadInputTokens/,
  );

  const stageMismatch = structuredClone(validRecord());
  if (stageMismatch.outcome.status !== "completed") throw new Error("expected completed fixture");
  const highAnthropic = anthropicUsage(11);
  const lowAnthropic = anthropicUsage(9);
  stageMismatch.outcome.result.usage = combineUsage(highAnthropic, lowAnthropic);
  stageMismatch.outcome.result.raw = {
    breadth: {
      model: "fast",
      promptSha256: "a".repeat(64),
      usage: highAnthropic,
      durationMs: 400,
    },
    investigation: {
      model: "strong",
      promptSha256: "b".repeat(64),
      usage: lowAnthropic,
      durationMs: 600,
    },
  };
  assert.throws(
    () => parseRunRecord(stageMismatch, "anthropic stage mismatch", validAttempt()),
    /raw\.breadth\.usage\.inputTokens must equal baseInputTokens \+ cacheWriteInputTokens \+ cacheReadInputTokens/,
  );

  const anthropicCachedMismatch = structuredClone(validRecord());
  if (anthropicCachedMismatch.outcome.status !== "completed") throw new Error("expected completed fixture");
  const invalidAnthropicCached = withUnavailable({
    ...validAnthropic,
    cachedInputTokens: 5,
    unavailable: undefined,
  });
  anthropicCachedMismatch.outcome.result.usage = combineUsage(invalidAnthropicCached, validAnthropic);
  anthropicCachedMismatch.outcome.result.raw = {
    breadth: {
      model: "fast",
      promptSha256: "a".repeat(64),
      usage: invalidAnthropicCached,
      durationMs: 400,
    },
    investigation: {
      model: "strong",
      promptSha256: "b".repeat(64),
      usage: validAnthropic,
      durationMs: 600,
    },
  };
  assert.throws(
    () => parseRunRecord(anthropicCachedMismatch, "anthropic cached mismatch", validAttempt()),
    /cachedInputTokens must equal cacheWriteInputTokens \+ cacheReadInputTokens/,
  );

  const anthropicUncachedMismatch = structuredClone(validRecord());
  if (anthropicUncachedMismatch.outcome.status !== "completed") throw new Error("expected completed fixture");
  const invalidAnthropicUncached = withUnavailable({
    ...validAnthropic,
    uncachedInputTokens: 7,
    unavailable: undefined,
  });
  anthropicUncachedMismatch.outcome.result.usage = combineUsage(invalidAnthropicUncached, validAnthropic);
  anthropicUncachedMismatch.outcome.result.raw = {
    breadth: {
      model: "fast",
      promptSha256: "a".repeat(64),
      usage: invalidAnthropicUncached,
      durationMs: 400,
    },
    investigation: {
      model: "strong",
      promptSha256: "b".repeat(64),
      usage: validAnthropic,
      durationMs: 600,
    },
  };
  assert.throws(
    () => parseRunRecord(anthropicUncachedMismatch, "anthropic uncached mismatch", validAttempt()),
    /uncachedInputTokens must equal baseInputTokens/,
  );

  const codexMismatch = structuredClone(validRecord());
  if (codexMismatch.outcome.status !== "completed") throw new Error("expected completed fixture");
  codexMismatch.runner = "codex";
  codexMismatch.outcome.result.engine = "codex";
  const invalidOpenAi = withUnavailable({
    provider: "openai",
    aggregation: "single-snapshot",
    inputTokens: 11,
    uncachedInputTokens: 6,
    cachedInputTokens: 4,
    cacheReadInputTokens: 4,
    outputTokens: 0,
    promptBytes: 0,
  });
  const validOpenAi = withUnavailable({
    provider: "openai",
    aggregation: "single-snapshot",
    inputTokens: 10,
    uncachedInputTokens: 6,
    cachedInputTokens: 4,
    cacheReadInputTokens: 4,
    outputTokens: 0,
    promptBytes: 0,
  });
  codexMismatch.outcome.result.usage = combineUsage(invalidOpenAi, validOpenAi);
  codexMismatch.outcome.result.raw = {
    breadth: {
      model: "fast",
      promptSha256: "a".repeat(64),
      usage: invalidOpenAi,
      durationMs: 400,
    },
    investigation: {
      model: "strong",
      promptSha256: "b".repeat(64),
      usage: validOpenAi,
      durationMs: 600,
    },
  };
  assert.throws(
    () => parseRunRecord(
      codexMismatch,
      "openai aggregate mismatch",
      { ...validAttempt(), runner: "codex" },
    ),
    /result\.usage\.inputTokens must equal uncachedInputTokens \+ cacheReadInputTokens/,
  );

  const codexCachedMismatch = structuredClone(codexMismatch);
  if (codexCachedMismatch.outcome.status !== "completed") throw new Error("expected completed fixture");
  const invalidOpenAiCached = withUnavailable({
    ...validOpenAi,
    cachedInputTokens: 5,
    unavailable: undefined,
  });
  codexCachedMismatch.outcome.result.usage = combineUsage(invalidOpenAiCached, validOpenAi);
  codexCachedMismatch.outcome.result.raw = {
    breadth: {
      model: "fast",
      promptSha256: "a".repeat(64),
      usage: invalidOpenAiCached,
      durationMs: 400,
    },
    investigation: {
      model: "strong",
      promptSha256: "b".repeat(64),
      usage: validOpenAi,
      durationMs: 600,
    },
  };
  assert.throws(
    () => parseRunRecord(
      codexCachedMismatch,
      "openai cached mismatch",
      { ...validAttempt(), runner: "codex" },
    ),
    /cachedInputTokens must equal cacheReadInputTokens/,
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
  const runManifest: MatrixRunManifest = {
    schemaVersion: 1,
    createdAt: "2026-09-02T00:00:00.000Z",
    expectedAttempts: attempts,
    providerNetworkIsolation: {
      claude: networkIsolationCapability("claude"),
    },
  };
  writeFileSync(join(runsDir, "matrix-manifest.json"), JSON.stringify(runManifest));
  const completed = structuredClone(validRecord());
  completed.attemptId = attempts[0]!.id;
  completed.caseName = caseName;
  if (completed.outcome.status !== "completed") throw new Error("expected completed fixture");
  const completedBreadthUsage = withUnavailable({
    provider: "anthropic",
    aggregation: "single-envelope",
    promptBytes: 0,
    costUsd: 0.004,
    costSource: "provider",
  });
  const completedInvestigationUsage = withUnavailable({
    provider: "anthropic",
    aggregation: "single-envelope",
    promptBytes: 0,
    costUsd: 0.006,
    costSource: "provider",
  });
  completed.outcome.result.usage = combineUsage(completedBreadthUsage, completedInvestigationUsage);
  completed.outcome.result.raw = {
    manifest: completed.evaluationProvenance!.manifest!.output,
    breadth: {
      output: emptyBreadthOutput(),
      model: "fast",
      promptSha256: "a".repeat(64),
      durationMs: 400,
      usage: completedBreadthUsage,
    },
    investigation: {
      model: "strong",
      promptSha256: "b".repeat(64),
      durationMs: 600,
      usage: completedInvestigationUsage,
    },
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
    promptBytes: 0,
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
    attemptDurationMs: 2000,
    evaluationProvenance: validEvaluationProvenance(),
    outcome: {
      status: "failed",
      failureKind: "timeout",
      message: "timed out",
      durationMs: 2000,
      telemetry: {
        engine: "claude",
        modelConfig: "fast/low->strong/high",
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
    const inconsistentRepeats = structuredClone(runManifest);
    inconsistentRepeats.expectedAttempts[1]!.expectedBugCount = 0;
    writeFileSync(join(runsDir, "matrix-manifest.json"), JSON.stringify(inconsistentRepeats));
    await assert.rejects(
      () => buildReport(runsDir, { casesDir }),
      /expectedBugCount must be identical across attempts/,
    );

    const truthMismatch = structuredClone(runManifest);
    for (const manifestAttempt of truthMismatch.expectedAttempts) {
      manifestAttempt.expectedBugCount = 0;
    }
    writeFileSync(join(runsDir, "matrix-manifest.json"), JSON.stringify(truthMismatch));
    await assert.rejects(
      () => buildReport(runsDir, { casesDir }),
      /expectedBugCount.*does not match readable ground truth/,
    );

    const stats = calculateStats({
      config: "route",
      runner: "claude",
      corpus: "development",
      benchmarkKind: "behavioral",
      completeness: "tracked",
      expectedRuns: 3,
      completed: [{
        attemptDurationMs: completed.attemptDurationMs,
        outcome: completed.outcome,
        matches: { "bug-1": 0 },
        falsePositiveIndexes: [],
      }],
      failed: [{
        outcome: failed.outcome as Extract<RunRecord["outcome"], { status: "failed" }>,
        attemptDurationMs: failed.attemptDurationMs,
      }],
      missing: 1,
      failureInclusiveRecalls: [1, 0, 0],
      structuralExpectedMarkers: null,
    });
    assert.equal(stats.benchmarkKind, "behavioral");
    assert.equal(stats.completionRate, 1 / 3);
    assert.equal(stats.failureInclusiveRecallMean, 1 / 3);
    assert.equal(stats.failedRuns, 1);
    assert.equal(stats.missingRuns, 1);
    assert.equal(stats.durationSecMean, null);
    assert.equal(stats.incurredCostUsdTotal, 0.03);
    assert.equal(stats.incurredCostObservedAttempts, 2);
    assert.equal(stats.incurredCostSource, "provider");
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
    const p1ManifestValue = JSON.parse(
      readFileSync(join(fixtureDir, "matrix-manifest.json"), "utf8"),
    ) as { expectedAttempts: Array<{ caseName: string }> };
    p1ManifestValue.expectedAttempts[0]!.caseName = "../../outside";
    assert.throws(
      () => parseLegacyMatrixRunManifest(p1ManifestValue, "P1 traversal manifest"),
      /safe cases-relative path/,
    );
    const p1Record = JSON.parse(
      readFileSync(join(fixtureDir, "attempt-000001.json"), "utf8"),
    ) as Record<string, unknown>;
    for (const variant of ["p1-schema-v1-codex", "p1-schema-v1-mock"]) {
      const variantDir = resolve("tests/fixtures/eval", variant);
      const variantManifest = parseLegacyMatrixRunManifest(
        JSON.parse(readFileSync(join(variantDir, "matrix-manifest.json"), "utf8")),
        `${variant} manifest`,
      );
      const variantRecord = JSON.parse(
        readFileSync(join(variantDir, "attempt-000001.json"), "utf8"),
      );
      assert.doesNotThrow(() => parseLegacySchemaV1RunRecord(
        variantRecord,
        `${variant} record`,
        variantManifest.expectedAttempts[0],
      ));
      if (variant === "p1-schema-v1-codex") {
        const splitBrain = structuredClone(variantRecord) as {
          outcome: { result: { raw: { investigation: { output: { findings: unknown[] } } } } };
        };
        const current = validRecord();
        if (current.outcome.status !== "completed") throw new Error("expected completed fixture");
        splitBrain.outcome.result.raw.investigation.output.findings = structuredClone(
          current.outcome.result.findings,
        );
        assert.throws(
          () => parseLegacySchemaV1RunRecord(splitBrain, "P1 Codex split-brain"),
          /output findings do not match the result findings/,
        );
      }
    }
    const currentUsageInP1 = structuredClone(p1Record) as {
      outcome: { result: { usage: Record<string, unknown> } };
    };
    currentUsageInP1.outcome.result.usage.provider = "anthropic";
    assert.throws(
      () => parseLegacySchemaV1RunRecord(currentUsageInP1, "P1 current usage"),
      /unexpected field.*provider/,
    );
    const providerWithoutRaw = structuredClone(p1Record) as {
      outcome: { result: { raw?: unknown } };
    };
    delete providerWithoutRaw.outcome.result.raw;
    assert.throws(
      () => parseLegacySchemaV1RunRecord(providerWithoutRaw, "P1 provider without raw"),
      /raw must be an object/,
    );
    const paddedFinding = structuredClone(p1Record) as {
      outcome: { result: { findings: Array<{ title: string }> } };
    };
    paddedFinding.outcome.result.findings[0]!.title = " Invalid value ";
    assert.doesNotThrow(() => parseLegacySchemaV1RunRecord(paddedFinding, "P1 padded finding"));
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
    const traversalManifest = structuredClone(manifestValue) as {
      expectedAttempts: Array<{ caseName: string; corpus: string }>;
    };
    traversalManifest.expectedAttempts[0]!.caseName = "../../outside";
    assert.throws(
      () => parsePreTelemetryMatrixRunManifest(traversalManifest, "PR3 traversal manifest"),
      /safe cases-relative path|nested directly under its corpus/,
    );
    traversalManifest.expectedAttempts[0]!.caseName = "development/case-00000001";
    traversalManifest.expectedAttempts[0]!.corpus = "unknown";
    assert.throws(
      () => parsePreTelemetryMatrixRunManifest(traversalManifest, "PR3 unknown corpus"),
      /must identify a pre-telemetry corpus/,
    );
    assert.throws(
      () => parseMatrixRunManifest(manifestValue, "strict telemetry manifest"),
      /caseName must be nested directly under its corpus/,
    );

    const recordValue: unknown = JSON.parse(
      readFileSync(join(fixtureDir, "attempt-000001.json"), "utf8"),
    );
    assert.doesNotThrow(() => parsePreTelemetryRunRecord(
      recordValue,
      "PR3 record fixture",
      manifest.expectedAttempts[0],
    ));
    const shortDuration = structuredClone(recordValue) as {
      outcome: { result: { durationMs: number } };
    };
    shortDuration.outcome.result.durationMs = 1;
    assert.throws(
      () => parsePreTelemetryRunRecord(shortDuration, "PR3 short result duration"),
      /durationMs must cover both stage durations/,
    );
    const invalidRoute = structuredClone(recordValue) as {
      outcome: { result: { modelConfig: string } };
    };
    invalidRoute.outcome.result.modelConfig = "claude-haiku/warp->claude-sonnet/high";
    assert.throws(
      () => parsePreTelemetryRunRecord(invalidRoute, "PR3 invalid route"),
      /does not match the claude pre-telemetry writer/,
    );
    const invalidManifestSentinel = structuredClone(recordValue) as {
      outcome: { result: { raw: { manifest: string } } };
    };
    invalidManifestSentinel.outcome.result.raw.manifest = "not-the-writer-sentinel";
    assert.throws(
      () => parsePreTelemetryRunRecord(invalidManifestSentinel, "PR3 invalid manifest sentinel"),
      /raw\.manifest does not match the pre-telemetry writer/,
    );
    const missingBreadthOutput = structuredClone(recordValue) as {
      outcome: { result: { raw: { breadth: { output?: unknown } } } };
    };
    delete missingBreadthOutput.outcome.result.raw.breadth.output;
    assert.throws(
      () => parsePreTelemetryRunRecord(missingBreadthOutput, "PR3 missing breadth output"),
      /output must be an object/,
    );
    const claudeInvestigationOutput = structuredClone(recordValue) as {
      outcome: { result: { raw: { investigation: Record<string, unknown> } } };
    };
    claudeInvestigationOutput.outcome.result.raw.investigation.output = { findings: [] };
    assert.throws(
      () => parsePreTelemetryRunRecord(claudeInvestigationOutput, "PR3 Claude investigation output"),
      /unexpected field.*output/,
    );
    const recordWithoutProvenance = structuredClone(recordValue) as Record<string, unknown>;
    delete recordWithoutProvenance.evaluationProvenance;
    assert.throws(
      () => parsePreTelemetryRunRecord(recordWithoutProvenance, "PR3 completed without provenance"),
      /evaluationProvenance is required for a completed attempt/,
    );
    const preMaterializationFailure = structuredClone(recordWithoutProvenance) as Record<string, unknown>;
    preMaterializationFailure.outcome = {
      status: "failed",
      failureKind: "configuration",
      message: "case materialization failed",
      durationMs: 1,
    };
    assert.doesNotThrow(() => parsePreTelemetryRunRecord(
      preMaterializationFailure,
      "PR3 pre-materialization failure",
      manifest.expectedAttempts[0],
    ));
    const manifestPreflightFailure = structuredClone(recordValue) as {
      evaluationProvenance: EvaluationAttemptProvenance;
      outcome: unknown;
    };
    delete manifestPreflightFailure.evaluationProvenance.manifest;
    manifestPreflightFailure.outcome = {
      status: "failed",
      failureKind: "configuration",
      message: "manifest preflight failed",
      durationMs: 1,
    };
    assert.doesNotThrow(() => parsePreTelemetryRunRecord(
      manifestPreflightFailure,
      "PR3 manifest-preflight failure",
      manifest.expectedAttempts[0],
    ));
    manifestPreflightFailure.outcome = {
      status: "failed",
      failureKind: "timeout",
      message: "provider timed out",
      durationMs: 1,
    };
    assert.throws(
      () => parsePreTelemetryRunRecord(manifestPreflightFailure, "PR3 post-preflight failure"),
      /manifest is required for a post-preflight failure/,
    );
    assert.throws(
      () => parseRunRecord(recordValue, "strict telemetry record"),
      /usage\.provider does not match claude runner/,
    );
    const mixedCurrent = structuredClone(recordValue) as {
      runner?: "claude";
      outcome: {
        result: {
          usage: ReturnType<typeof withUnavailable>;
          raw: {
            breadth: {
              model?: string;
              promptSha256?: string;
              usage: ReturnType<typeof withUnavailable>;
            };
            investigation: {
              model?: string;
              promptSha256?: string;
              usage: ReturnType<typeof withUnavailable>;
            };
          };
        };
      };
    };
    mixedCurrent.runner = "claude";
    mixedCurrent.outcome.result.raw.breadth.model = "claude-haiku";
    mixedCurrent.outcome.result.raw.breadth.promptSha256 = "a".repeat(64);
    mixedCurrent.outcome.result.raw.investigation.model = "claude-sonnet";
    mixedCurrent.outcome.result.raw.investigation.promptSha256 = "b".repeat(64);
    mixedCurrent.outcome.result.usage = combineUsage(
      mixedCurrent.outcome.result.raw.breadth.usage,
      mixedCurrent.outcome.result.raw.investigation.usage,
    );
    assert.throws(
      () => parseRunRecord(
        mixedCurrent,
        "PR3 usage relabeled as current",
        { ...manifest.expectedAttempts[0]!, runner: "claude" },
      ),
      /usage\.provider does not match claude runner/,
    );
    const mixedCurrentWithProvider = structuredClone(mixedCurrent);
    mixedCurrentWithProvider.outcome.result.usage.provider = "anthropic";
    mixedCurrentWithProvider.outcome.result.raw.breadth.usage.provider = "anthropic";
    mixedCurrentWithProvider.outcome.result.raw.investigation.usage.provider = "anthropic";
    assert.throws(
      () => parseRunRecord(
        mixedCurrentWithProvider,
        "PR3 unattributed cost relabeled as current",
        { ...manifest.expectedAttempts[0]!, runner: "claude" },
      ),
      /costSource is required when costUsd is present in current telemetry/,
    );
    const currentWithoutRaw = validRecord() as RunRecord & {
      outcome: { status: "completed"; result: { raw?: unknown } };
    };
    delete currentWithoutRaw.outcome.result.raw;
    assert.throws(
      () => parseRunRecord(
        currentWithoutRaw,
        "current provider record without stages",
        validAttempt(),
      ),
      /raw must include both provider stage records/,
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

test("PR3 pre-telemetry mock artifacts retain their exact raw-less writer shape", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-pr3-mock-artifact-test-"));
  const runsDir = join(root, "runs");
  const casesDir = join(root, "cases");
  const fixtureDir = resolve("tests/fixtures/eval/pr3-pre-telemetry-mock");
  mkdirSync(runsDir);
  mkdirSync(join(casesDir, "legacy-pr3-mock-case"), { recursive: true });
  for (const file of ["matrix-manifest.json", "attempt-000001.json"]) {
    writeFileSync(join(runsDir, file), readFileSync(join(fixtureDir, file)));
  }
  writeFileSync(
    join(casesDir, "legacy-pr3-mock-case", "ground_truth.json"),
    JSON.stringify({
      bugs: [{
        id: "bug-1",
        file: "src/value.ts",
        startLine: 1,
        endLine: 1,
        description: "deterministic marker",
      }],
    }),
  );

  try {
    const manifest = parsePreTelemetryMatrixRunManifest(
      JSON.parse(readFileSync(join(fixtureDir, "matrix-manifest.json"), "utf8")),
      "PR3 mock manifest fixture",
    );
    const recordValue = JSON.parse(
      readFileSync(join(fixtureDir, "attempt-000001.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.doesNotThrow(() => parsePreTelemetryRunRecord(
      recordValue,
      "PR3 mock record fixture",
      manifest.expectedAttempts[0],
    ));
    const mockWithRaw = structuredClone(recordValue) as {
      outcome: { result: { raw?: unknown } };
    };
    mockWithRaw.outcome.result.raw = {};
    assert.throws(
      () => parsePreTelemetryRunRecord(mockWithRaw, "PR3 mock with raw telemetry"),
      /raw must be absent for a pre-telemetry mock result/,
    );
    const mockWithExtraUsage = structuredClone(recordValue) as {
      outcome: { result: { usage: Record<string, unknown> } };
    };
    mockWithExtraUsage.outcome.result.usage.cachedInputTokens = 0;
    assert.throws(
      () => parsePreTelemetryRunRecord(mockWithExtraUsage, "PR3 mock with invented usage"),
      /usage does not match the pre-telemetry mock writer/,
    );

    await gradeRuns(runsDir, casesDir);
    const gradedValue = JSON.parse(
      readFileSync(join(runsDir, "attempt-000001.graded.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.equal("runner" in gradedValue, false);
    const gradedResult = (gradedValue.outcome as { result: Record<string, unknown> }).result;
    assert.equal("raw" in gradedResult, false);
    assert.doesNotThrow(() => parsePreTelemetryGradedRun(
      gradedValue,
      "PR3 mock graded fixture",
      manifest.expectedAttempts[0],
    ));

    const [stats] = await buildReport(runsDir, { casesDir });
    assert.equal(stats?.config, "mock-pr3-route");
    assert.equal(stats?.runner, null);
    assert.equal(stats?.completeness, "legacy-incomplete");
    assert.equal(stats?.benchmarkKind, "legacy-unknown");
    assert.equal(stats?.recallMean, null);
    assert.equal(stats?.costPerCaseMean, null);
    assert.equal(stats?.structuralMatchedMarkers, null);
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
  configs.push({ name: "completed-alt", runner: "mock", overrides: { scenario: "completed" } });
  configs.push({ name: "configuration", runner: "codex", overrides: { timeoutMs: 0 } });
  const matrixPath = join(root, "matrix.json");
  writeFileSync(matrixPath, JSON.stringify({ repeats: 2, configs }));

  let mixedCalls = 0;
  const engine: Engine = {
    name: "mock",
    async review(ctx) {
      const scenario = (ctx.config.runners.mock as Record<string, unknown>).scenario;
      if (scenario === "mixed" && ++mixedCalls === 2) {
        throw new RunFailureError("timeout", "timed out");
      }
      if (scenario === "timeout") throw new RunFailureError("timeout", "timed out");
      if (scenario === "provider") throw new RunFailureError("provider", "provider unavailable");
      if (scenario === "parse") throw new RunFailureError("parse", "invalid output");
      if (scenario === "unknown") throw new Error("token=abc123456789SECRET");
      return {
        engine: "mock",
        status: "completed",
        modelConfig: "mock",
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
        usage: mockUsage(),
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
    assert.equal(completed?.expectedRuns, 2);
    assert.equal(completed?.completedRuns, 2);
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
    assert.equal(mixed?.telemetryObserved.costUsd, 1);
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
      attemptDurationMs: _attemptDuration,
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

    const cleanCaseName = "structural-smoke/case-00000009";
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
        providerNetworkIsolation: { mock: networkIsolationCapability("mock") },
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
          usage: mockUsage(),
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
    const manifestPath = join(runsDir, "matrix-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as MatrixRunManifest;
    const forgedUnreadableCount = structuredClone(manifest);
    const unreadableAttempt = forgedUnreadableCount.expectedAttempts.find((attempt) =>
      attempt.caseName === "development/case-600d0002");
    assert.ok(unreadableAttempt);
    unreadableAttempt.expectedBugCount = 1;
    writeFileSync(manifestPath, JSON.stringify(forgedUnreadableCount));
    await assert.rejects(
      () => buildReport(runsDir, { casesDir }),
      /numeric expectedBugCount for unreadable ground truth/,
    );
    writeFileSync(manifestPath, JSON.stringify(manifest));
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

test("cleanup failures use terminal wall time and omit impossible mock telemetry", async () => {
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

  const engine: Engine = {
    name: "mock",
    async review(ctx) {
      const scenario = (ctx.config.runners.mock as Record<string, unknown>).scenario;
      if (scenario === "partial") {
        throw new RunFailureError("timeout", "investigation timed out");
      }
      return completedClean();
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
    assert.equal(partial.outcome.telemetry, undefined);

    const completed = records.find((record) => record.configName === "completed");
    assert.ok(completed && completed.outcome.status === "failed");
    assert.equal(completed.outcome.failureKind, "configuration");
    assert.match(completed.outcome.message, /cleanup failed after provider completion/);
    assert.equal(completed.outcome.telemetry, undefined);
    assert.equal(completed.finishedAt,
      new Date(Date.parse(completed.startedAt) + completed.attemptDurationMs).toISOString());

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
      providerNetworkIsolation: { mock: networkIsolationCapability("mock") },
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
      startedAt: "2026-09-02T00:00:00.000Z",
      finishedAt: "2026-09-02T00:00:00.001Z",
      attemptDurationMs: 1,
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
    usage: mockUsage(),
    durationMs: 1,
  };
}
