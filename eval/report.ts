import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type {
  EngineResult,
  CaseCorpus,
  GradedRun,
  MatrixRunManifest,
  RunRecord,
  RunnerName,
  StageTelemetry,
} from "../src/types.js";
import type { RunFailureKind } from "../src/core/run-failure.js";
import { readCaseGroundTruth } from "./case-truth.js";
import { assertGradingEvidenceConsistent, assertMatchReuseMatchesRootCause } from "./grading-contract.js";
import { formatUsd } from "../src/core/telemetry.js";
import {
  assertGradedMatchesRun,
  isLegacyMatrixRunManifest,
  isPreTelemetryMatrixRunManifest,
  parseGradedRun,
  parseLegacyCompletedRun,
  parseLegacyMatrixRunManifest,
  parseLegacySchemaV1GradedRun,
  parseLegacySchemaV1RunRecord,
  parseMatrixRunManifest,
  parsePreTelemetryGradedRun,
  parsePreTelemetryMatrixRunManifest,
  parsePreTelemetryRunRecord,
  parseRunRecord,
  type LegacyMatrixRunManifest,
  type PreTelemetryMatrixRunManifest,
} from "./artifacts.js";
import {
  EXPERIMENT_METADATA_FILENAMES,
  readExperimentRunEvidence,
} from "./experiment-evidence.js";
import { acquireExperimentLock, canonicalJsonSha256, hashExperimentCorpus, readExperimentJson } from "./experiment.js";
import { CODEX_SEMANTIC_JUDGE } from "./judge-runtime.js";
import { readJudgeAccounting, type JudgeAccounting } from "./judge-ledger.js";
import {
  EXPERIMENT_GRADING_SEAL_FILENAME,
  EXPERIMENT_TERMINAL_SEAL_FILENAME,
  requireValidExperimentGradingSeal,
} from "./experiment-seals.js";
import {
  EXPERIMENT_ADJUDICATION_FILENAME,
  adjudicationKey,
  adjudicationMap,
  readExperimentAdjudication,
  type FinalAdjudicationClassification,
} from "./adjudication-ledger.js";
import { FUNNEL_ADJUDICATED_DECISION_FILENAME, FUNNEL_DECISION_FILENAME } from "./funnel-decision.js";

type LegacyGradedRun = Omit<GradedRun, "schemaVersion" | "attemptId" | "finishedAt" | "attemptDurationMs" | "outcome" | "caseCorpus" | "runner"> & {
  result: EngineResult;
};
type CompatibilityGradedRun = Omit<GradedRun, "attemptDurationMs"> & { attemptDurationMs?: number };
type ReportCostSource = "provider" | "estimated" | "mixed" | "mock" | "unknown" | null;
type ScoredRun = Pick<GradedRun, "outcome" | "matches" | "falsePositiveIndexes"> & {
  attemptId?: string;
  attemptDurationMs?: number;
  caseName?: string;
  grading?: GradedRun["grading"];
};
type FailedRun = {
  outcome: Extract<RunRecord["outcome"], { status: "failed" }>;
  attemptDurationMs?: number;
};

export interface ConfigStats {
  config: string;
  runner: RunnerName | null;
  corpus: CaseCorpus | "unknown" | null;
  benchmarkKind: "behavioral" | "structural-only" | "legacy-unknown";
  completeness: "tracked" | "legacy-incomplete";
  expectedRuns: number | null;
  runs: number;
  completedRuns: number;
  failedRuns: number | null;
  missingRuns: number | null;
  completionRate: number | null;
  failuresByKind: Partial<Record<RunFailureKind, number>>;
  failureRatesByKind: Partial<Record<RunFailureKind, number>>;
  recallMean: number | null;
  recallStd: number | null;
  rootCauseRecallMean: number | null;
  adjudicatedPrecision: number | null;
  falseDiscoveryRate: number | null;
  confirmedNewFindings: number | null;
  unsupportedFindings: number | null;
  unresolvedFindings: number | null;
  blockingFalsePositivesOnCleanCases: number | null;
  diagnosticExcludedRuns: number | null;
  diagnosticExcludedFindings: number | null;
  missesByStage: Record<string, number>;
  costPerReliablyFoundRootCause: number | null;
  failureInclusiveRecallMean: number | null;
  fpPerCaseMean: number | null;
  costPerCaseMean: number | null;
  costPerCaseStd: number | null;
  costSource: ReportCostSource;
  durationSecMean: number | null;
  durationSecMedian: number | null;
  durationSecP95: number | null;
  engineDurationSecMean: number | null;
  breadthDurationSecMean: number | null;
  investigationDurationSecMean: number | null;
  breadthInputTokensMean: number | null;
  investigationInputTokensMean: number | null;
  breadthBaseInputTokensMean: number | null;
  investigationBaseInputTokensMean: number | null;
  breadthUncachedInputTokensMean: number | null;
  investigationUncachedInputTokensMean: number | null;
  breadthCachedInputTokensMean: number | null;
  investigationCachedInputTokensMean: number | null;
  breadthCacheWriteInputTokensMean: number | null;
  investigationCacheWriteInputTokensMean: number | null;
  breadthCacheReadInputTokensMean: number | null;
  investigationCacheReadInputTokensMean: number | null;
  breadthTurnsMean: number | null;
  investigationTurnsMean: number | null;
  breadthToolCallsMean: number | null;
  investigationToolCallsMean: number | null;
  breadthToolCallsByTypeMean: Record<string, number> | null;
  investigationToolCallsByTypeMean: Record<string, number> | null;
  breadthToolOutputBytesMean: number | null;
  investigationToolOutputBytesMean: number | null;
  breadthPromptBytesMean: number | null;
  investigationPromptBytesMean: number | null;
  inputTokensMean: number | null;
  baseInputTokensMean: number | null;
  uncachedInputTokensMean: number | null;
  cachedInputTokensMean: number | null;
  cacheWriteInputTokensMean: number | null;
  cacheReadInputTokensMean: number | null;
  outputTokensMean: number | null;
  reasoningOutputTokensMean: number | null;
  turnsMean: number | null;
  toolCallsMean: number | null;
  toolCallsByTypeMean: Record<string, number> | null;
  toolOutputBytesMean: number | null;
  promptBytesMean: number | null;
  telemetryExpectedRuns: number | null;
  telemetryObserved: Record<string, number>;
  /** Known spend actually incurred; a lower bound when some attempts lack cost. */
  incurredCostUsdTotal: number | null;
  incurredCostObservedAttempts: number;
  incurredCostSource: ReportCostSource;
  structuralExpectedMarkers: number | null;
  structuralMatchedMarkers: number | null;
  structuralUnexpectedFindings: number | null;
}

export async function buildReport(
  runsDir?: string,
  options: { casesDir?: string } = {},
): Promise<ConfigStats[]> {
  const dir = resolve(runsDir ?? latestRunsDir());
  const casesDir = resolve(options.casesDir ?? "eval/cases");
  const releaseLock = experimentMetadataPresent(dir) ? acquireExperimentLock(dir) : undefined;
  try {
    return buildReportLocked(dir, casesDir);
  } finally {
    releaseLock?.();
  }
}

function buildReportLocked(dir: string, casesDir: string): ConfigStats[] {
  const manifestPath = join(dir, "matrix-manifest.json");
  const hasExperimentMetadata = experimentMetadataPresent(dir);
  let stats: ConfigStats[] | undefined;
  let judgeAccounting: JudgeAccounting | undefined;
  if (existsSync(manifestPath)) {
    const manifestValue: unknown = readExperimentJson(manifestPath);
    let currentManifest: MatrixRunManifest | undefined;
    try {
      currentManifest = parseMatrixRunManifest(manifestValue, manifestPath);
    } catch (error) {
      if (hasExperimentMetadata) {
        throw new Error("experiment metadata requires a current matrix manifest", { cause: error });
      }
      if (isPreTelemetryMatrixRunManifest(manifestValue)) {
        stats = preTelemetryStats(
          dir,
          casesDir,
          parsePreTelemetryMatrixRunManifest(manifestValue, manifestPath),
        );
      } else if (isLegacyMatrixRunManifest(manifestValue)) {
        const legacyManifest = parseLegacyMatrixRunManifest(manifestValue, manifestPath);
        stats = legacyStats(dir, legacyManifest);
      } else {
        throw error;
      }
    }
    if (currentManifest) {
      const gradingEvidence = hasExperimentMetadata
        ? requireValidExperimentGradingSeal(dir, currentManifest).evidence
        : undefined;
      let expectedJudge: NonNullable<GradedRun["grading"]>["judge"] | undefined;
      if (gradingEvidence) {
        const declaredJudge = gradingEvidence.experiment.protocol.judge;
        expectedJudge = declaredJudge.kind === "exact"
          ? { kind: "exact", version: "exact-v1" }
          : {
              kind: declaredJudge.kind,
              version: "semantic-v1",
              configSha256: canonicalJsonSha256({ judge: CODEX_SEMANTIC_JUDGE, limits: declaredJudge.limits }),
            };
        if (declaredJudge.kind !== "exact") judgeAccounting = readJudgeAccounting(dir);
      }
      const diagnosticOnlyCaseIds = new Set(
        gradingEvidence?.experiment.benchmarkCategory?.definition.roles.diagnosticOnlyCases ?? [],
      );
      const adjudications = gradingEvidence
        ? adjudicationMap(readExperimentAdjudication(dir))
        : undefined;
      stats = trackedStats(
        dir,
        casesDir,
        currentManifest,
        expectedJudge,
        diagnosticOnlyCaseIds,
        adjudications,
      );
    }
  } else {
    if (hasExperimentMetadata) {
      throw new Error("experiment metadata requires matrix-manifest.json");
    }
    stats = legacyStats(dir);
  }

  if (!stats) throw new Error("internal error: benchmark manifest did not select a report format");
  if (stats.length === 0) {
    throw new Error(`No benchmark run artifacts in ${dir} — run eval:grade first.`);
  }

  stats.sort((a, b) => (b.recallMean ?? -1) - (a.recallMean ?? -1));
  writeFileSync(join(dir, "benchmark.json"), JSON.stringify(stats, null, 2));
  writeFileSync(join(dir, "benchmark.html"), renderBenchmarkHtml(stats, judgeAccounting));
  printStats(stats, dir);
  return stats;
}

function preTelemetryStats(
  dir: string,
  casesDir: string,
  manifest: PreTelemetryMatrixRunManifest,
): ConfigStats[] {
  const declaredFiles = new Set(manifest.expectedAttempts.flatMap((attempt) => [
    attempt.file,
    attempt.file.replace(/\.json$/, ".graded.json"),
  ]));
  const undeclared = readdirSync(dir).filter((file) =>
    file.endsWith(".json") && file !== "matrix-manifest.json" && file !== "benchmark.json" &&
    !declaredFiles.has(file));
  if (undeclared.length > 0) {
    throw new Error(`run artifacts not declared by pre-telemetry matrix manifest: ${undeclared.join(", ")}`);
  }
  const byConfig = groupBy(
    manifest.expectedAttempts,
    (attempt) => `${attempt.configName}\0${attempt.corpus}`,
  );
  return [...byConfig.values()].map((attempts) => {
    const completed: ScoredRun[] = [];
    const failed: FailedRun[] = [];
    for (const attempt of attempts) {
      const rawPath = join(dir, attempt.file);
      const gradedPath = rawPath.replace(/\.json$/, ".graded.json");
      if (!existsSync(rawPath)) {
        if (existsSync(gradedPath)) {
          throw new Error(`${attempt.file} is missing but its pre-telemetry graded artifact exists`);
        }
        continue;
      }
      const raw = parsePreTelemetryRunRecord(
        JSON.parse(readFileSync(rawPath, "utf8")),
        rawPath,
        attempt,
      );
      if (raw.outcome.status === "failed") {
        if (existsSync(gradedPath)) {
          throw new Error(`${attempt.file} failed but its pre-telemetry graded artifact exists`);
        }
        failed.push({ outcome: raw.outcome });
        continue;
      }
      if (!existsSync(gradedPath)) {
        throw new Error(`${attempt.file} completed but has no graded artifact — run eval:grade first.`);
      }
      const graded = parsePreTelemetryGradedRun(
        JSON.parse(readFileSync(gradedPath, "utf8")),
        gradedPath,
        attempt,
      );
      assertGradedMatchesRun(graded, raw, gradedPath);
      const groundTruthIds = loadGroundTruthIds(casesDir, attempt.caseName);
      const gradedIds = Object.keys(graded.matches);
      if (groundTruthIds.length !== gradedIds.length ||
        groundTruthIds.some((id) => !Object.prototype.hasOwnProperty.call(graded.matches, id))) {
        throw new Error(`${gradedPath}.matches does not match ground truth bug IDs`);
      }
      assertMatchReuseMatchesRootCause(readCaseGroundTruth(casesDir, attempt.caseName), graded.matches, gradedPath);
      if (graded.grading) assertGradingEvidenceConsistent(
        readCaseGroundTruth(casesDir, attempt.caseName),
        graded.outcome.result.findings,
        graded.matches,
        graded.grading,
        gradedPath,
      );
      completed.push(graded);
    }
    return calculateStats({
      config: attempts[0]!.configName,
      runner: null,
      corpus: attempts[0]!.corpus,
      benchmarkKind: "legacy-unknown",
      completeness: "legacy-incomplete",
      expectedRuns: null,
      completed,
      failed,
      missing: null,
      failureInclusiveRecalls: null,
      expectedRootCauseRuns: null,
      structuralExpectedMarkers: null,
    });
  });
}

function trackedStats(
  dir: string,
  casesDir: string,
  manifest: MatrixRunManifest,
  expectedJudge?: NonNullable<GradedRun["grading"]>["judge"],
  diagnosticOnlyCaseIds: ReadonlySet<string> = new Set(),
  adjudications?: ReadonlyMap<string, FinalAdjudicationClassification>,
): ConfigStats[] {
  preflightTrackedRunSet(dir, casesDir, manifest);
  const byConfig = groupBy(manifest.expectedAttempts, (attempt) =>
    `${attempt.configName}\0${attempt.corpus}\0${attempt.runner}`);
  const countBugs = (attempt: MatrixRunManifest["expectedAttempts"][number]): number | null => {
    const snapshot = (attempt as { expectedBugCount?: number | null }).expectedBugCount;
    if (snapshot !== undefined) return snapshot;
    try {
      return readCaseGroundTruth(casesDir, attempt.caseName).bugs.length;
    } catch {
      return null;
    }
  };

  return [...byConfig.values()].map((attempts) => {
    const config = attempts[0]!.configName;
    const corpus = attempts[0]!.corpus;
    const runner = attempts[0]!.runner;
    const completed: GradedRun[] = [];
    const failed: FailedRun[] = [];
    let missing = 0;
    let denominatorUnavailable = false;
    const failureInclusiveRecalls: number[] = [];

    for (const attempt of attempts) {
      const bugCount = countBugs(attempt);
      if (bugCount === null) denominatorUnavailable = true;
      const rawPath = join(dir, attempt.file);
      const gradedPath = rawPath.replace(/\.json$/, ".graded.json");
      if (!existsSync(rawPath)) {
        missing++;
        if ((bugCount ?? 0) > 0) failureInclusiveRecalls.push(0);
        continue;
      }
      const raw = parseRunRecord(readExperimentJson(rawPath), rawPath, attempt);
      if (raw.outcome.status === "failed") {
        failed.push({ outcome: raw.outcome, attemptDurationMs: raw.attemptDurationMs });
        if ((bugCount ?? 0) > 0) failureInclusiveRecalls.push(0);
        continue;
      }
      if (!existsSync(gradedPath)) {
        throw new Error(`${attempt.file} completed but has no graded artifact — run eval:grade first.`);
      }
      const graded = parseGradedRun(readExperimentJson(gradedPath), gradedPath, attempt);
      assertGradedMatchesRun(graded, raw, gradedPath);
      const groundTruthIds = loadGroundTruthIds(casesDir, attempt.caseName);
      const gradedIds = Object.keys(graded.matches);
      if (groundTruthIds.length !== gradedIds.length ||
        groundTruthIds.some((id) => !Object.prototype.hasOwnProperty.call(graded.matches, id))) {
        throw new Error(`${gradedPath}.matches does not match ground truth bug IDs`);
      }
      assertMatchReuseMatchesRootCause(readCaseGroundTruth(casesDir, attempt.caseName), graded.matches, gradedPath);
      if (graded.grading) assertGradingEvidenceConsistent(
        readCaseGroundTruth(casesDir, attempt.caseName),
        graded.outcome.result.findings,
        graded.matches,
        graded.grading,
        gradedPath,
        expectedJudge,
      );
      completed.push(graded);
      const recall = runRecall(graded);
      if (recall !== null) failureInclusiveRecalls.push(recall);
    }

    return calculateStats({
      config,
      runner,
      corpus,
      benchmarkKind: corpus === "structural-smoke" || runner === "mock" ? "structural-only" : "behavioral",
      completeness: "tracked",
      expectedRuns: attempts.length,
      completed,
      failed,
      missing,
      failureInclusiveRecalls: denominatorUnavailable ? null : failureInclusiveRecalls,
      expectedRootCauseRuns: denominatorUnavailable
        ? null
        : attempts.filter((attempt) => countBugs(attempt)! > 0).length,
      structuralExpectedMarkers: attempts.every((attempt) => attempt.expectedBugCount !== null)
        ? attempts.reduce((sum, attempt) => sum + attempt.expectedBugCount!, 0)
        : null,
      diagnosticOnlyCaseIds,
      adjudications,
    });
  });
}

/**
 * Validates a complete current run set before reporting or invoking a semantic
 * judge. This keeps invalid isolation, provenance, and denominator metadata
 * from reaching a paid evaluator.
 */
export function preflightTrackedRunSet(
  dir: string,
  casesDir: string,
  manifest: MatrixRunManifest,
): void {
  const hasExperimentMetadata = experimentMetadataPresent(dir);
  const experiment = hasExperimentMetadata
    ? readExperimentRunEvidence(dir, manifest)
    : undefined;
  if (experiment) {
    const currentCorpusSha256 = hashExperimentCorpus(
      casesDir,
      [...new Set(experiment.experiment.schedule.map((attempt) => attempt.caseName))],
    );
    if (currentCorpusSha256 !== experiment.experiment.hashes.corpusSha256) {
      throw new Error("experiment corpus no longer matches the immutable manifest");
    }
  }
  const declaredFiles = new Set(manifest.expectedAttempts.flatMap((attempt) => [
    attempt.file,
    attempt.file.replace(/\.json$/, ".graded.json"),
  ]));
  const metadataFiles = experimentMetadataFiles(experiment !== undefined);
  const undeclared = readdirSync(dir).filter((file) =>
    file.endsWith(".json") && !metadataFiles.has(file) &&
    file !== "benchmark.json" &&
    !declaredFiles.has(file));
  if (undeclared.length > 0) {
    throw new Error(`run artifacts not declared by matrix manifest: ${undeclared.join(", ")}`);
  }
  assertExpectedBugCountsMatchTruth(manifest, casesDir);
  assertCrossAttemptProvenance(dir, manifest);
  for (const attempt of manifest.expectedAttempts) {
    const rawPath = join(dir, attempt.file);
    const gradedPath = rawPath.replace(/\.json$/, ".graded.json");
    if (!existsSync(rawPath)) {
      if (existsSync(gradedPath)) {
        throw new Error(`${attempt.file} is missing but its graded artifact exists`);
      }
      continue;
    }
    const raw = parseRunRecord(readExperimentJson(rawPath), rawPath, attempt);
    assertOutcomeCapability(raw, manifest);
    if (raw.outcome.status === "failed" && existsSync(gradedPath)) {
      throw new Error(`${attempt.file} failed but its graded artifact exists`);
    }
  }
}

function experimentMetadataPresent(dir: string): boolean {
  return [
    EXPERIMENT_METADATA_FILENAMES.experimentManifest,
    EXPERIMENT_METADATA_FILENAMES.experimentStop,
    EXPERIMENT_METADATA_FILENAMES.stateDirectory,
    EXPERIMENT_TERMINAL_SEAL_FILENAME,
    EXPERIMENT_GRADING_SEAL_FILENAME,
  ].some((name) => existsSync(join(dir, name)));
}

function experimentMetadataFiles(includeExperiment: boolean): ReadonlySet<string> {
  return new Set([
    EXPERIMENT_METADATA_FILENAMES.matrixManifest,
    ...(includeExperiment
      ? [
          EXPERIMENT_METADATA_FILENAMES.experimentManifest,
          EXPERIMENT_METADATA_FILENAMES.experimentStop,
          EXPERIMENT_TERMINAL_SEAL_FILENAME,
          EXPERIMENT_GRADING_SEAL_FILENAME,
          EXPERIMENT_ADJUDICATION_FILENAME,
          FUNNEL_DECISION_FILENAME,
          FUNNEL_ADJUDICATED_DECISION_FILENAME,
        ]
      : []),
  ]);
}

function assertCrossAttemptProvenance(dir: string, manifest: MatrixRunManifest): void {
  const canonical = new Map<string, {
    caseKind?: RunRecord["caseKind"];
    history?: NonNullable<RunRecord["evaluationProvenance"]>["history"];
    manifest?: NonNullable<RunRecord["evaluationProvenance"]>["manifest"];
  }>();
  const modelConfigs = new Map<string, string>();
  for (const attempt of manifest.expectedAttempts) {
    const path = join(dir, attempt.file);
    if (!existsSync(path)) continue;
    const record = parseRunRecord(readExperimentJson(path), path, attempt);
    const modelConfig = record.outcome.status === "completed"
      ? record.outcome.result.modelConfig
      : record.outcome.telemetry?.modelConfig;
    if (modelConfig !== undefined) {
      const configIdentity = `${record.configName}\0${record.runner}`;
      const prior = modelConfigs.get(configIdentity);
      if (prior !== undefined && prior !== modelConfig) {
        throw new Error(`${record.configName} has inconsistent effective modelConfig across attempts`);
      }
      modelConfigs.set(configIdentity, modelConfig);
    }
    const identity = canonical.get(attempt.caseName) ?? {};
    if (record.caseKind !== "unknown") {
      if (identity.caseKind !== undefined && identity.caseKind !== record.caseKind) {
        throw new Error(`${attempt.caseName} has inconsistent caseKind across attempts`);
      }
      identity.caseKind = record.caseKind;
    }
    const provenance = record.evaluationProvenance;
    if (provenance) {
      if (identity.history !== undefined && !isDeepStrictEqual(identity.history, provenance.history)) {
        throw new Error(`${attempt.caseName} has inconsistent history provenance across attempts`);
      }
      identity.history = provenance.history;
      if (provenance.manifest) {
        if (identity.manifest !== undefined && !isDeepStrictEqual(identity.manifest, provenance.manifest)) {
          throw new Error(`${attempt.caseName} has inconsistent manifest provenance across attempts`);
        }
        identity.manifest = provenance.manifest;
      }
    }
    canonical.set(attempt.caseName, identity);
  }
}

function assertOutcomeCapability(record: RunRecord, manifest: MatrixRunManifest): void {
  if (record.runner === "mock") return;
  const preProviderFailure = record.outcome.status === "failed" &&
    record.outcome.failureKind === "configuration" && record.outcome.telemetry === undefined &&
    record.outcome.telemetryUnavailableReason === undefined;
  if (record.caseCorpus === "structural-smoke" && !preProviderFailure) {
    throw new Error(`${record.attemptId} cannot record live provider work for structural-smoke`);
  }
  if (!preProviderFailure && manifest.providerNetworkIsolation[record.runner]?.status !== "limited") {
    throw new Error(
      `${record.attemptId} records live provider work without the exact limited bridge-egress capability`,
    );
  }
  if (!preProviderFailure && manifest.providerFilesystemIsolation?.[record.runner]?.status !== "enforced") {
    throw new Error(`${record.attemptId} records live provider work without enforced providerFilesystemIsolation`);
  }
}

function assertExpectedBugCountsMatchTruth(manifest: MatrixRunManifest, casesDir: string): void {
  const checked = new Set<string>();
  for (const attempt of manifest.expectedAttempts) {
    if (checked.has(attempt.caseName)) continue;
    checked.add(attempt.caseName);
    let bugCount: number;
    try {
      bugCount = readCaseGroundTruth(casesDir, attempt.caseName).bugs.length;
    } catch {
      if (manifest.expectedAttempts.some((item) =>
        item.caseName === attempt.caseName && item.expectedBugCount !== null)) {
        throw new Error(
          `matrix manifest has a numeric expectedBugCount for unreadable ground truth ${attempt.caseName}`,
        );
      }
      continue;
    }
    for (const sameCase of manifest.expectedAttempts.filter((item) => item.caseName === attempt.caseName)) {
      if (sameCase.expectedBugCount !== bugCount) {
        throw new Error(
          `matrix manifest expectedBugCount for ${attempt.caseName} does not match readable ground truth`,
        );
      }
    }
  }
}

function loadGroundTruthIds(casesDir: string, caseName: string): string[] {
  return readCaseGroundTruth(casesDir, caseName).bugs.map((bug) => bug.id);
}

function legacyStats(dir: string, manifest?: LegacyMatrixRunManifest): ConfigStats[] {
  if (manifest) validateLegacyManifestArtifacts(dir, manifest);
  const graded = readdirSync(dir)
    .filter((file) => file.endsWith(".graded.json"))
    .map((file): LegacyGradedRun | CompatibilityGradedRun => {
      const path = join(dir, file);
      const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (raw && typeof raw === "object" && !Array.isArray(raw) && "outcome" in raw) {
        if (!("caseCorpus" in raw) && !("runner" in raw)) {
          const parsed = parseLegacySchemaV1GradedRun(raw, path);
          return {
            ...parsed,
            caseCorpus: "unknown",
            runner: parsed.outcome.result.engine,
          };
        }
        return parseGradedRun(raw, path);
      }
      const parsed = parseLegacyCompletedRun(raw, path);
      if (!parsed.matches || !parsed.falsePositiveIndexes) throw new Error(`${path}: expected a graded legacy artifact`);
      return { ...parsed, matches: parsed.matches, falsePositiveIndexes: parsed.falsePositiveIndexes };
    });
  const failedRecords = (manifest?.expectedAttempts ?? []).flatMap((attempt) => {
    const path = join(dir, attempt.file);
    if (!existsSync(path)) return [];
    const parsed = parseLegacySchemaV1RunRecord(
      JSON.parse(readFileSync(path, "utf8")),
      path,
      attempt,
    );
    return parsed.outcome.status === "failed"
      ? [{ configName: parsed.configName, outcome: parsed.outcome }]
      : [];
  });
  const byConfig = groupBy(graded, (run) => run.configName);
  const failuresByConfig = groupBy(failedRecords, (run) => run.configName);
  const configNames = new Set([
    ...byConfig.keys(),
    ...failuresByConfig.keys(),
    ...(manifest?.expectedAttempts.map((attempt) => attempt.configName) ?? []),
  ]);
  return [...configNames].map((config) => {
    const legacyRuns = byConfig.get(config) ?? [];
    const failed = (failuresByConfig.get(config) ?? []).map((record) => ({ outcome: record.outcome }));
    const completed = legacyRuns.map((run) =>
      "outcome" in run
        ? run
        : {
            ...run,
            schemaVersion: 1 as const,
            attemptId: `${run.configName}--${run.caseName}--${run.repeat}`,
            caseCorpus: "unknown" as const,
            runner: run.result.engine,
            finishedAt: run.startedAt,
            outcome: { status: "completed" as const, result: run.result },
          },
    );
    return calculateStats({
      config,
      runner: completed.length > 0 && completed.every((run) =>
        run.outcome.result.engine === completed[0]!.outcome.result.engine)
        ? completed[0]!.outcome.result.engine
        : null,
      corpus: "unknown",
      benchmarkKind: completed.length > 0 && completed.every((run) => run.outcome.result.engine === "mock")
        ? "structural-only"
        : "legacy-unknown",
      completeness: "legacy-incomplete",
      expectedRuns: null,
      completed,
      failed,
      missing: null,
      failureInclusiveRecalls: null,
      expectedRootCauseRuns: null,
      structuralExpectedMarkers: null,
    });
  });
}

function validateLegacyManifestArtifacts(dir: string, manifest: LegacyMatrixRunManifest): void {
  const declared = new Set(manifest.expectedAttempts.flatMap((attempt) => [
    attempt.file,
    attempt.file.replace(/\.json$/, ".graded.json"),
  ]));
  const undeclared = readdirSync(dir).filter((file) =>
    file.endsWith(".json") && file !== "matrix-manifest.json" && file !== "benchmark.json" &&
    !declared.has(file));
  if (undeclared.length > 0) {
    throw new Error(`run artifacts not declared by legacy matrix manifest: ${undeclared.join(", ")}`);
  }
  for (const attempt of manifest.expectedAttempts) {
    const rawPath = join(dir, attempt.file);
    const gradedPath = rawPath.replace(/\.json$/, ".graded.json");
    if (!existsSync(rawPath)) {
      if (existsSync(gradedPath)) throw new Error(`${attempt.file} is missing but its graded artifact exists`);
      continue;
    }
    const raw = parseLegacySchemaV1RunRecord(
      JSON.parse(readFileSync(rawPath, "utf8")),
      rawPath,
      attempt,
    );
    if (raw.outcome.status === "failed") {
      if (existsSync(gradedPath)) throw new Error(`${attempt.file} failed but its graded artifact exists`);
      continue;
    }
    if (!existsSync(gradedPath)) {
      throw new Error(`${attempt.file} completed but has no graded artifact — run eval:grade first.`);
    }
    const graded = parseLegacySchemaV1GradedRun(
      JSON.parse(readFileSync(gradedPath, "utf8")),
      gradedPath,
      attempt,
    );
    assertGradedMatchesRun(graded, raw, gradedPath);
  }
}

export function calculateStats(args: {
  config: string;
  runner: RunnerName | null;
  corpus: ConfigStats["corpus"];
  benchmarkKind: ConfigStats["benchmarkKind"];
  completeness: ConfigStats["completeness"];
  expectedRuns: number | null;
  completed: ScoredRun[];
  failed: FailedRun[];
  missing: number | null;
  failureInclusiveRecalls: number[] | null;
  expectedRootCauseRuns: number | null;
  structuralExpectedMarkers: number | null;
  diagnosticOnlyCaseIds?: ReadonlySet<string>;
  adjudications?: ReadonlyMap<string, FinalAdjudicationClassification>;
}): ConfigStats {
  const behavioral = args.benchmarkKind === "behavioral";
  const diagnosticOnlyCaseIds = args.diagnosticOnlyCaseIds ?? new Set<string>();
  const findingMetricRuns = args.completed.filter((run) =>
    !diagnosticOnlyCaseIds.has(caseIdOf(run.caseName)),
  );
  const diagnosticExcludedRuns = args.completed.length - findingMetricRuns.length;
  const diagnosticExcludedFindings = args.completed
    .filter((run) => diagnosticOnlyCaseIds.has(caseIdOf(run.caseName)))
    .reduce((sum, run) => sum + run.outcome.result.findings.length, 0);
  const recalls = args.completed.map(runRecall).filter((value): value is number => value !== null);
  const fps = findingMetricRuns.map((run) => run.falsePositiveIndexes.length);
  const rootCauseRecalls = args.completed.flatMap((run) => {
    const groups = run.grading ? Object.values(run.grading.rootCauseMatches) : [];
    return groups.length === 0 ? [] : [groups.filter(Boolean).length / groups.length];
  });
  const unmatched = findingMetricRuns.flatMap((run) => (run.grading?.unmatchedFindings ?? []).map((item) => ({
    ...item,
    classification: run.attemptId === undefined
      ? item.classification
      : args.adjudications?.get(adjudicationKey(run.attemptId, item.findingIndex, item.findingEvidenceSha256))
        ?? item.classification,
  })));
  const confirmedNewFindings = unmatched.filter((item) => item.classification === "confirmed-new").length;
  const unsupportedFindings = unmatched.filter((item) => item.classification === "unsupported").length;
  const unresolvedFindings = unmatched.filter((item) => item.classification === "unresolved").length;
  const blockingFalsePositivesOnCleanCases = findingMetricRuns.reduce((sum, run) =>
    Object.keys(run.matches).length === 0
      ? sum + (run.grading?.unmatchedFindings.filter((item) => {
          const classification = run.attemptId === undefined
            ? item.classification
            : args.adjudications?.get(adjudicationKey(run.attemptId, item.findingIndex, item.findingEvidenceSha256))
              ?? item.classification;
          return classification === "unsupported";
        }).length ?? 0)
      : sum,
  0);
  const matchedFindings = findingMetricRuns.reduce((sum, run) => sum + new Set(
    Object.values(run.matches).filter((value): value is number => value !== null),
  ).size, 0);
  const precisionDenominator = matchedFindings + confirmedNewFindings + unsupportedFindings;
  const missesByStage = countBy(
    args.completed.flatMap((run) => run.grading
      ? Object.values(run.grading.missStages)
          .filter((stage) => stage !== "none")
          .map((stage) => run.grading?.version === "root-cause-v1" && stage === "infrastructure"
            ? "unattributed"
            : stage)
      : []),
    (stage) => stage,
  );
  const costs = args.completed
    .map((run) => run.outcome.result.usage.costUsd)
    .filter((cost): cost is number => typeof cost === "number" && Number.isFinite(cost) && cost >= 0);
  const durations = [
    ...args.completed.map((run) => run.attemptDurationMs),
    ...args.failed.map((failure) => failure.attemptDurationMs),
  ].filter((duration): duration is number =>
    typeof duration === "number" && Number.isFinite(duration) && duration >= 0).map((duration) => duration / 1000);
  const engineDurations = [
    ...args.completed.map((run) => run.outcome.result.durationMs),
    ...args.failed.map((failure) => failure.outcome.telemetry?.durationMs),
  ].filter((duration): duration is number =>
    typeof duration === "number" && Number.isFinite(duration) && duration >= 0).map((duration) => duration / 1000);
  const failedTelemetry = args.failed.flatMap((failure) => failure.outcome.telemetry ? [failure.outcome.telemetry] : []);
  const allUsages = [
    ...args.completed.map((run) => run.outcome.result.usage),
    ...failedTelemetry.map((telemetry) => telemetry.usage),
  ];
  const usage = (field: keyof EngineResult["usage"]): number[] => allUsages
    .map((item) => item[field])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  const failedStages = failedTelemetry.flatMap((telemetry) => telemetry.stages);
  const completedStages = args.completed.flatMap((run) => completedStageRecords(run));
  const stages = [...completedStages, ...failedStages];
  const stageValues = (
    stage: StageTelemetry["stage"],
    field: keyof EngineResult["usage"] | "durationMs",
  ): number[] => stages.filter((item) => item.stage === stage).map((item) =>
    field === "durationMs" ? item.durationMs : item.usage[field],
  ).filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0);
  const stageToolTypes = (stage: StageTelemetry["stage"]): Array<Record<string, number> | undefined> => stages
    .filter((item) => item.stage === stage)
    .map((item) => item.usage.toolCallsByType);
  const breadthDurations = stageValues("breadth", "durationMs").map((value) => value / 1000);
  const investigationDurations = stageValues("investigation", "durationMs").map((value) => value / 1000);
  const breadthInputs = stageValues("breadth", "inputTokens");
  const investigationInputs = stageValues("investigation", "inputTokens");
  const usageValues = {
    inputTokens: usage("inputTokens"),
    baseInputTokens: usage("baseInputTokens"),
    uncachedInputTokens: usage("uncachedInputTokens"),
    cachedInputTokens: usage("cachedInputTokens"),
    cacheWriteInputTokens: usage("cacheWriteInputTokens"),
    cacheReadInputTokens: usage("cacheReadInputTokens"),
    outputTokens: usage("outputTokens"),
    reasoningOutputTokens: usage("reasoningOutputTokens"),
    turns: usage("turns"),
    toolCalls: usage("toolCalls"),
    toolOutputBytes: usage("toolOutputBytes"),
    promptBytes: usage("promptBytes"),
  };
  const totalValid = args.completed.reduce(
    (sum, run) => sum + Object.values(run.matches).filter((match) => match !== null).length,
    0,
  );
  const totalCost = finiteSum(costs);
  const isTrackedComplete =
    args.completeness === "tracked" &&
    args.expectedRuns === args.completed.length &&
    args.failed.length === 0 &&
    args.missing === 0;
  const comparisonExpected = args.completeness === "tracked" && args.expectedRuns !== null
    ? args.expectedRuns
    : 0;
  const hasCompleteDuration = comparisonExpected > 0 && durations.length === comparisonExpected;
  const hasCompleteCost =
    isTrackedComplete &&
    costs.length === args.completed.length;
  const costSources = args.completed.map((run) => usageCostSource(run.outcome.result.usage));
  const costSource = hasCompleteCost ? summarizeCostSource(costSources) : null;
  const estimatedPricing = args.completed.map((run) => run.outcome.result.usage.pricing);
  const hasComparableCost = hasCompleteCost && totalCost !== null && costSource !== "mixed" && costSource !== "unknown" &&
    (costSource !== "estimated" || comparableEstimatedPricing(estimatedPricing));
  const reliableRootCauses = reliablyFoundRootCauses(args.completed);
  const incurred = incurredCosts(args.completed, args.failed);

  const failuresByKind = countBy(args.failed, (failure) => failure.outcome.failureKind);
  const failureRatesByKind = args.expectedRuns === null
    ? {}
    : Object.fromEntries(
        Object.entries(failuresByKind).map(([kind, count]) => [kind, count / args.expectedRuns!]),
      );

  return {
    config: args.config,
    runner: args.runner,
    corpus: args.corpus,
    benchmarkKind: args.benchmarkKind,
    completeness: args.completeness,
    expectedRuns: args.expectedRuns,
    runs: args.completed.length,
    completedRuns: args.completed.length,
    failedRuns: args.completeness === "tracked" ? args.failed.length : null,
    missingRuns: args.missing,
    completionRate: args.expectedRuns === null ? null : args.completed.length / args.expectedRuns,
    failuresByKind,
    failureRatesByKind,
    recallMean: behavioral && recalls.length > 0 ? mean(recalls) : null,
    recallStd: behavioral && recalls.length > 0 ? std(recalls) : null,
    rootCauseRecallMean: behavioral && rootCauseRecalls.length === args.expectedRootCauseRuns && rootCauseRecalls.length > 0
      ? mean(rootCauseRecalls)
      : null,
    adjudicatedPrecision: behavioral && isTrackedComplete && unresolvedFindings === 0 && precisionDenominator > 0
      ? (matchedFindings + confirmedNewFindings) / precisionDenominator
      : null,
    falseDiscoveryRate: behavioral && isTrackedComplete && unresolvedFindings === 0 && precisionDenominator > 0
      ? unsupportedFindings / precisionDenominator
      : null,
    confirmedNewFindings: behavioral ? confirmedNewFindings : null,
    unsupportedFindings: behavioral ? unsupportedFindings : null,
    unresolvedFindings: behavioral ? unresolvedFindings : null,
    blockingFalsePositivesOnCleanCases: behavioral ? blockingFalsePositivesOnCleanCases : null,
    diagnosticExcludedRuns: behavioral ? diagnosticExcludedRuns : null,
    diagnosticExcludedFindings: behavioral ? diagnosticExcludedFindings : null,
    missesByStage: behavioral ? missesByStage : {},
    costPerReliablyFoundRootCause: behavioral && hasComparableCost && totalCost !== null &&
      reliableRootCauses !== null && reliableRootCauses > 0
      ? totalCost / reliableRootCauses
      : null,
    failureInclusiveRecallMean:
      !behavioral || args.failureInclusiveRecalls === null || args.failureInclusiveRecalls.length === 0
        ? null
        : mean(args.failureInclusiveRecalls),
    fpPerCaseMean: behavioral && isTrackedComplete && fps.length > 0 ? mean(fps) : null,
    costPerCaseMean: behavioral && hasComparableCost ? mean(costs) : null,
    costPerCaseStd: behavioral && hasComparableCost ? std(costs) : null,
    costSource: behavioral ? costSource : null,
    durationSecMean: completeMean(durations, hasCompleteDuration ? args.expectedRuns! : 0),
    durationSecMedian: hasCompleteDuration ? median(durations) : null,
    durationSecP95: hasCompleteDuration ? durationP95(durations) : null,
    engineDurationSecMean: completeMean(engineDurations, comparisonExpected),
    breadthDurationSecMean: completeMean(breadthDurations, comparisonExpected),
    investigationDurationSecMean: completeMean(investigationDurations, comparisonExpected),
    breadthInputTokensMean: completeMean(breadthInputs, comparisonExpected),
    investigationInputTokensMean: completeMean(investigationInputs, comparisonExpected),
    breadthBaseInputTokensMean: completeMean(stageValues("breadth", "baseInputTokens"), comparisonExpected),
    investigationBaseInputTokensMean: completeMean(stageValues("investigation", "baseInputTokens"), comparisonExpected),
    breadthUncachedInputTokensMean: completeMean(stageValues("breadth", "uncachedInputTokens"), comparisonExpected),
    investigationUncachedInputTokensMean: completeMean(stageValues("investigation", "uncachedInputTokens"), comparisonExpected),
    breadthCachedInputTokensMean: completeMean(stageValues("breadth", "cachedInputTokens"), comparisonExpected),
    investigationCachedInputTokensMean: completeMean(stageValues("investigation", "cachedInputTokens"), comparisonExpected),
    breadthCacheWriteInputTokensMean: completeMean(stageValues("breadth", "cacheWriteInputTokens"), comparisonExpected),
    investigationCacheWriteInputTokensMean: completeMean(stageValues("investigation", "cacheWriteInputTokens"), comparisonExpected),
    breadthCacheReadInputTokensMean: completeMean(stageValues("breadth", "cacheReadInputTokens"), comparisonExpected),
    investigationCacheReadInputTokensMean: completeMean(stageValues("investigation", "cacheReadInputTokens"), comparisonExpected),
    breadthTurnsMean: completeMean(stageValues("breadth", "turns"), comparisonExpected),
    investigationTurnsMean: completeMean(stageValues("investigation", "turns"), comparisonExpected),
    breadthToolCallsMean: completeMean(stageValues("breadth", "toolCalls"), comparisonExpected),
    investigationToolCallsMean: completeMean(stageValues("investigation", "toolCalls"), comparisonExpected),
    breadthToolCallsByTypeMean: stageToolTypes("breadth").length === comparisonExpected
      ? meanToolCallsByType(stageToolTypes("breadth"))
      : null,
    investigationToolCallsByTypeMean: stageToolTypes("investigation").length === comparisonExpected
      ? meanToolCallsByType(stageToolTypes("investigation"))
      : null,
    breadthToolOutputBytesMean: completeMean(stageValues("breadth", "toolOutputBytes"), comparisonExpected),
    investigationToolOutputBytesMean: completeMean(stageValues("investigation", "toolOutputBytes"), comparisonExpected),
    breadthPromptBytesMean: completeMean(stageValues("breadth", "promptBytes"), comparisonExpected),
    investigationPromptBytesMean: completeMean(stageValues("investigation", "promptBytes"), comparisonExpected),
    inputTokensMean: completeMean(usageValues.inputTokens, comparisonExpected),
    baseInputTokensMean: completeMean(usageValues.baseInputTokens, comparisonExpected),
    uncachedInputTokensMean: completeMean(usageValues.uncachedInputTokens, comparisonExpected),
    cachedInputTokensMean: completeMean(usageValues.cachedInputTokens, comparisonExpected),
    cacheWriteInputTokensMean: completeMean(usageValues.cacheWriteInputTokens, comparisonExpected),
    cacheReadInputTokensMean: completeMean(usageValues.cacheReadInputTokens, comparisonExpected),
    outputTokensMean: completeMean(usageValues.outputTokens, comparisonExpected),
    reasoningOutputTokensMean: completeMean(usageValues.reasoningOutputTokens, comparisonExpected),
    turnsMean: completeMean(usageValues.turns, comparisonExpected),
    toolCallsMean: completeMean(usageValues.toolCalls, comparisonExpected),
    toolCallsByTypeMean: allUsages.length === comparisonExpected
      ? meanToolCallsByType(allUsages.map((item) => item.toolCallsByType))
      : null,
    toolOutputBytesMean: completeMean(usageValues.toolOutputBytes, comparisonExpected),
    promptBytesMean: completeMean(usageValues.promptBytes, comparisonExpected),
    telemetryExpectedRuns: args.expectedRuns,
    telemetryObserved: {
      costUsd: allUsages.filter((usage) => usage.costUsd !== undefined).length,
      durationMs: args.completeness === "tracked" ? durations.length : 0,
      engineDurationMs: args.completeness === "tracked" ? engineDurations.length : 0,
      breadthDurationMs: breadthDurations.length,
      investigationDurationMs: investigationDurations.length,
      breadthInputTokens: breadthInputs.length,
      investigationInputTokens: investigationInputs.length,
      toolCallsByType: allUsages.filter((usage) => usage.toolCallsByType !== undefined).length,
      ...stageTelemetryObserved(stages),
      ...Object.fromEntries(Object.entries(usageValues).map(([key, values]) => [
        key,
        values.length,
      ])),
    },
    incurredCostUsdTotal: behavioral && args.completeness === "tracked" ? finiteSum(incurred.costs) : null,
    incurredCostObservedAttempts: behavioral && args.completeness === "tracked" ? incurred.observedAttempts : 0,
    incurredCostSource: behavioral && args.completeness === "tracked" && incurred.costs.length > 0
      ? summarizeCostSource(incurred.sources)
      : null,
    structuralExpectedMarkers: args.benchmarkKind === "structural-only"
      ? args.structuralExpectedMarkers
      : null,
    structuralMatchedMarkers: args.benchmarkKind === "structural-only" ? totalValid : null,
    structuralUnexpectedFindings: args.benchmarkKind === "structural-only"
      ? args.completed.reduce((sum, run) => sum + run.falsePositiveIndexes.length, 0)
      : null,
  };
}

function runRecall(run: ScoredRun): number | null {
  const total = Object.keys(run.matches).length;
  if (total === 0) return null;
  return Object.values(run.matches).filter((match) => match !== null).length / total;
}

function caseIdOf(caseName: string | undefined): string {
  return caseName?.split("/").at(-1) ?? "";
}

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const median = (values: number[]) => {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
};
const std = (values: number[]) => {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1),
  );
};
export const P95_MIN_SAMPLES = 20;
export const durationP95 = (values: number[]): number | null => {
  if (values.length < P95_MIN_SAMPLES) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(0.95 * ordered.length) - 1]!;
};
const pct = (value: number) => `${(value * 100).toFixed(0)}%`;

export function renderBenchmarkHtml(stats: ConfigStats[], judge?: JudgeAccounting): string {
  const knownCosts = stats.map((item) => item.costPerCaseMean).filter((cost): cost is number => cost !== null);
  const maxCost = Math.max(...knownCosts, 0.01);
  const points = stats
    .filter((item) => item.costPerCaseMean !== null && item.recallMean !== null)
    .map((item, index) => {
      const x = 60 + (item.costPerCaseMean! / maxCost) * 480;
      const y = 320 - item.recallMean! * 280;
      return `<circle cx="${x}" cy="${y}" r="6" fill="hsl(${(index * 67) % 360},70%,45%)"><title>${item.config} · ${item.corpus}</title></circle>
<text x="${x + 10}" y="${y + 4}" font-size="11">${item.config} · ${item.corpus}</text>`;
    })
    .join("\n");
  const rows = stats.map((item) => `<tr><td>${item.config}</td><td>${item.benchmarkKind}${item.corpus ? ` (${item.corpus})` : ""}</td><td>${formatCompletion(item)}</td>
<td>${formatPercent(item.recallMean)} ± ${formatPercent(item.recallStd)}</td><td>${formatPercent(item.failureInclusiveRecallMean)}</td>
<td>${formatPercent(item.rootCauseRecallMean)}</td><td>${formatPercent(item.adjudicatedPrecision)}</td><td>${formatPercent(item.falseDiscoveryRate)}</td><td>${formatAdjudication(item)}</td><td>${item.blockingFalsePositivesOnCleanCases ?? "n/a"}</td><td>${formatMisses(item)}</td>
<td>${formatNumber(item.fpPerCaseMean, 1)}</td><td>${formatCost(item.costPerCaseMean, item.costPerCaseStd, item.costSource)}</td>
<td>${item.costPerReliablyFoundRootCause === null ? "n/a" : formatUsd(item.costPerReliablyFoundRootCause)}</td>
<td>${formatDuration(item)}</td><td>${formatUsage(item)}</td><td>${formatAvailability(item)}</td><td>${formatIncurredCost(item)}</td><td>${formatStructural(item)}</td><td>${formatStages(item)}</td></tr>`).join("\n");

  return `<!doctype html><html><head><meta charset="utf-8"><title>peregrine-bugbot benchmark</title>
<style>body{font-family:system-ui;margin:2rem;max-width:1050px}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #ddd;padding:6px 10px;text-align:left;font-size:14px}th{background:#f5f5f5}</style></head>
<body><h1>peregrine-bugbot · evaluation report</h1>
<table><tr><th>config</th><th>class</th><th>completion</th><th>bug-instance recall</th><th>failure-inclusive recall</th><th>root-cause recall</th><th>precision</th><th>FDR</th><th>adjudication</th><th>blocking clean FP</th><th>miss stages</th><th>FP/case</th><th>cost/case</th><th>cost/reliably found root cause</th><th>time mean / median / p95</th><th>usage / work</th><th>telemetry observed</th><th>incurred cost lower bound</th><th>structural markers</th><th>breadth / investigation</th></tr>
${rows}</table>
${judge ? `<h2>Semantic judge accounting</h2>
<table><tr><th>provider attempts</th><th>failures</th><th>wall time</th><th>known cost</th><th>cost unavailable</th><th>input / cached / output / reasoning tokens</th><th>turns / tool calls</th></tr>
<tr><td>${judge.providerAttempts}</td><td>${judge.failures}</td><td>${(judge.durationMs / 1000).toFixed(1)}s</td><td>${formatUsd(judge.providerCostUsd)}</td><td>${judge.costUnavailableAttempts}</td><td>${judge.inputTokens ?? "n/a"} / ${judge.cachedInputTokens ?? "n/a"} / ${judge.outputTokens ?? "n/a"} / ${judge.reasoningTokens ?? "n/a"}</td><td>${judge.turns ?? "n/a"} / ${judge.toolCalls ?? "n/a"}</td></tr></table>` : ""}
<h2>Behavioral cost vs recall — pick the knee</h2>
<svg viewBox="0 0 600 360" width="600" style="border:1px solid #eee">
<line x1="60" y1="320" x2="560" y2="320" stroke="#999"/><line x1="60" y1="320" x2="60" y2="20" stroke="#999"/>
<text x="300" y="350" font-size="12" text-anchor="middle">cost per case ($, max $${maxCost.toFixed(2)})</text>
<text x="20" y="170" font-size="12" transform="rotate(-90 20 170)">conditional recall</text>
${points}</svg>
<p style="color:#666;font-size:13px">Behavioral conditional recall includes completed bug-bearing attempts. Failure-inclusive recall counts failed or missing bug-bearing attempts as misses. Structural mock rows validate transport, accounting, and expected markers only; they are excluded from recall, cost, efficiency, and this plot. Comparison time and usage are n/a unless every expected attempt has the required telemetry; wall time includes failed attempts. P95 requires at least 20 attempts. Incurred cost is a lower bound that retains known spend from failed attempts. Legacy folders are explicitly incomplete.</p>
</body></html>`;
}

function printStats(stats: ConfigStats[], dir: string): void {
  console.log(`\n${"config".padEnd(28)} ${"class".padEnd(18)} ${"completion".padEnd(35)} conditional  incl. failures  FP/case  $/case`);
  for (const item of stats) {
    console.log(
      `${item.config.padEnd(28)} ${item.benchmarkKind.padEnd(18)} ${formatCompletion(item).padEnd(35)} ${formatPercent(item.recallMean).padEnd(12)} ${formatPercent(item.failureInclusiveRecallMean).padEnd(14)} ${formatNumber(item.fpPerCaseMean, 1).padEnd(8)} ${formatCost(item.costPerCaseMean, item.costPerCaseStd, item.costSource)}${item.benchmarkKind === "structural-only" ? ` · ${formatStructural(item)}` : ""}`,
    );
  }
  console.log(`\nReport: ${join(dir, "benchmark.html")}`);
}

function formatCompletion(stats: ConfigStats): string {
  if (stats.completeness === "legacy-incomplete") return "legacy/incomplete";
  return `${stats.completedRuns}/${stats.expectedRuns} (${pct(stats.completionRate ?? 0)}); ${stats.failedRuns} failed; ${stats.missingRuns} missing`;
}

function formatPercent(value: number | null): string {
  return value === null ? "n/a" : pct(value);
}

function formatNumber(value: number | null, digits: number): string {
  return value === null ? "n/a" : value.toFixed(digits);
}

function formatAdjudication(stats: ConfigStats): string {
  if (stats.confirmedNewFindings === null) return "n/a";
  const excluded = stats.diagnosticExcludedRuns
    ? `; ${stats.diagnosticExcludedFindings} findings from ${stats.diagnosticExcludedRuns} diagnostic runs excluded`
    : "";
  return `${stats.confirmedNewFindings} confirmed new; ${stats.unsupportedFindings} unsupported; ${stats.unresolvedFindings} unresolved${excluded}`;
}

function formatMisses(stats: ConfigStats): string {
  const entries = Object.entries(stats.missesByStage);
  return entries.length === 0 ? "none" : entries.map(([stage, count]) => `${stage}: ${count}`).join("; ");
}

function reliablyFoundRootCauses(runs: readonly ScoredRun[]): number | null {
  if (runs.length === 0 || runs.some((run) => !run.caseName || !run.grading)) return null;
  const groups = new Map<string, boolean[]>();
  for (const run of runs) {
    for (const [group, found] of Object.entries(run.grading!.rootCauseMatches)) {
      const key = `${run.caseName}\u0000${group}`;
      groups.set(key, [...(groups.get(key) ?? []), found]);
    }
  }
  const observations = [...groups.values()];
  // "Reliably found" is a preregistered 2-of-3 measure, not a generic
  // majority label. With any other repeat shape the denominator is unknown.
  if (observations.some((items) => items.length !== 3)) return null;
  return observations.filter((items) => items.filter(Boolean).length >= 2).length;
}

function formatCost(
  meanCost: number | null,
  stdCost: number | null,
  source: ConfigStats["costSource"],
): string {
  return meanCost === null || stdCost === null
    ? "n/a"
    : `${formatUsd(meanCost)}±${formatUsd(stdCost)} (${costSourceLabel(source)})`;
}

function completeMean(values: number[], expected: number): number | null {
  if (expected <= 0 || values.length !== expected) return null;
  const total = finiteSum(values);
  return total === null ? null : total / values.length;
}

function rawStage(run: ScoredRun, stage: "breadth" | "investigation"): Record<string, unknown> | undefined {
  const raw = run.outcome.result.raw;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = (raw as Record<string, unknown>)[stage];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stageNumbers(runs: ScoredRun[], stage: "breadth" | "investigation", field: string): number[] {
  return runs
    .map((run) => rawStage(run, stage)?.[field])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function stageUsageNumbers(runs: ScoredRun[], stage: "breadth" | "investigation", field: string): number[] {
  return runs
    .map((run) => {
      const usage = rawStage(run, stage)?.usage;
      return usage && typeof usage === "object" && !Array.isArray(usage)
        ? (usage as Record<string, unknown>)[field]
        : undefined;
    })
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function completedStageRecords(run: ScoredRun): StageTelemetry[] {
  return (["breadth", "investigation"] as const).flatMap((stageName) => {
    const stage = rawStage(run, stageName);
    if (!stage || typeof stage.model !== "string" || typeof stage.promptSha256 !== "string" ||
      typeof stage.durationMs !== "number" || !stage.usage || typeof stage.usage !== "object" ||
      Array.isArray(stage.usage)) return [];
    return [{
      stage: stageName,
      model: stage.model,
      promptSha256: stage.promptSha256,
      usage: stage.usage as StageTelemetry["usage"],
      durationMs: stage.durationMs,
      completed: true,
    }];
  });
}

function stageTelemetryObserved(stages: StageTelemetry[]): Record<string, number> {
  const observed: Record<string, number> = {};
  for (const stageName of ["breadth", "investigation"] as const) {
    const matching = stages.filter((stage) => stage.stage === stageName);
    for (const metric of [
      "baseInputTokens", "uncachedInputTokens", "cachedInputTokens", "cacheWriteInputTokens",
      "cacheReadInputTokens", "turns", "toolCalls", "toolOutputBytes", "promptBytes",
    ] as const) {
      observed[`${stageName}${metric[0]!.toUpperCase()}${metric.slice(1)}`] = matching.filter(
        (stage) => stage.usage[metric] !== undefined,
      ).length;
    }
    observed[`${stageName}ToolCallsByType`] = matching.filter(
      (stage) => stage.usage.toolCallsByType !== undefined,
    ).length;
  }
  return observed;
}

function formatStages(stats: ConfigStats): string {
  const stage = (name: "breadth" | "investigation"): string => {
    const label = name === "breadth" ? "B" : "I";
    const value = (suffix: string): unknown => stats[`${name}${suffix}` as keyof ConfigStats];
    const number = (suffix: string) => {
      const item = value(suffix);
      return typeof item === "number" ? item.toFixed(0) : "n/a";
    };
    const toolTypes = value("ToolCallsByTypeMean");
    return `${label}: ${number("DurationSecMean")}s; input ${number("InputTokensMean")}` +
      ` (base ${number("BaseInputTokensMean")}, uncached ${number("UncachedInputTokensMean")},` +
      ` cached ${number("CachedInputTokensMean")}, write ${number("CacheWriteInputTokensMean")},` +
      ` read ${number("CacheReadInputTokensMean")}); turns ${number("TurnsMean")};` +
      ` tools ${number("ToolCallsMean")} ${toolTypes && typeof toolTypes === "object" ? JSON.stringify(toolTypes) : "n/a"};` +
      ` tool B ${number("ToolOutputBytesMean")}; prompt B ${number("PromptBytesMean")}`;
  };
  return `${stage("breadth")}<br>${stage("investigation")}`;
}

function formatDuration(stats: ConfigStats): string {
  return stats.durationSecMean === null || stats.durationSecMedian === null
    ? "n/a"
    : `wall ${stats.durationSecMean.toFixed(0)}s / ${stats.durationSecMedian.toFixed(0)}s / ${stats.durationSecP95 === null ? "n/a" : `${stats.durationSecP95.toFixed(0)}s`}` +
      ` · engine ${stats.engineDurationSecMean === null ? "n/a" : `${stats.engineDurationSecMean.toFixed(0)}s`}`;
}

function formatIncurredCost(stats: ConfigStats): string {
  if (stats.incurredCostUsdTotal === null) return "n/a";
  return `${formatUsd(stats.incurredCostUsdTotal)} (${costSourceLabel(stats.incurredCostSource)}; ${stats.incurredCostObservedAttempts} attempt(s))`;
}

function formatStructural(stats: ConfigStats): string {
  if (stats.structuralExpectedMarkers === null || stats.structuralMatchedMarkers === null ||
    stats.structuralUnexpectedFindings === null) return "n/a";
  return `${stats.structuralMatchedMarkers}/${stats.structuralExpectedMarkers} expected markers; ${stats.structuralUnexpectedFindings} unexpected`;
}

function costSourceLabel(source: ConfigStats["costSource"]): string {
  return source === "provider" ? "provider-reported" : source === "mixed" ? "mixed-source" : source ?? "unknown";
}

function formatUsage(stats: ConfigStats): string {
  const tokenFields: Array<[string, number | null]> = [
    ["base", stats.baseInputTokensMean],
    ["uncached", stats.uncachedInputTokensMean],
    ["cached", stats.cachedInputTokensMean],
    ["write", stats.cacheWriteInputTokensMean],
    ["read", stats.cacheReadInputTokensMean],
    ["out", stats.outputTokensMean],
    ["reasoning", stats.reasoningOutputTokensMean],
  ];
  const work = stats.turnsMean === null || stats.toolCallsMean === null ||
    stats.toolOutputBytesMean === null || stats.promptBytesMean === null
    ? "work n/a"
    : `${stats.turnsMean.toFixed(1)} turns · ${stats.toolCallsMean.toFixed(1)} tools · ${stats.toolOutputBytesMean.toFixed(0)} tool B · ${stats.promptBytesMean.toFixed(0)} prompt B`;
  return `${tokenFields.map(([label, value]) => `${label} ${value?.toFixed(0) ?? "n/a"}`).join(" · ")} · ${work}`;
}

function meanToolCallsByType(
  values: Array<Record<string, number> | undefined>,
): Record<string, number> | null {
  if (values.length === 0 || values.some((value) => value === undefined)) return null;
  const observed = values as Array<Record<string, number>>;
  const types = new Set(observed.flatMap((value) => Object.keys(value)));
  const result: Record<string, number> = {};
  for (const type of [...types].sort()) {
    const total = finiteSum(observed.map((value) => value[type] ?? 0));
    if (total === null) return null;
    result[type] = total / observed.length;
  }
  return result;
}

function summarizeCostSource(
  sources: Array<Exclude<ReportCostSource, null> | undefined>,
): ConfigStats["costSource"] {
  if (sources.some((source) => source === undefined)) return "unknown";
  const unique = new Set(sources);
  if (unique.size > 1) return "mixed";
  return sources[0] ?? "unknown";
}

function usageCostSource(usage: EngineResult["usage"]): Exclude<ReportCostSource, null> | undefined {
  return usage.provider === "mock" ? "mock" : usage.costSource;
}

function comparableEstimatedPricing(
  references: Array<EngineResult["usage"]["pricing"]>,
): boolean {
  if (references.some((reference) => reference === undefined)) return false;
  const [first] = references;
  return references.every((reference) =>
    reference!.catalogVersion === first!.catalogVersion &&
    reference!.pricingAsOf === first!.pricingAsOf);
}

function formatAvailability(stats: ConfigStats): string {
  const expected = stats.telemetryExpectedRuns;
  return Object.entries(stats.telemetryObserved)
    .map(([metric, observed]) => `${metric} ${observed}/${expected ?? "n/a"}`)
    .join(" · ");
}

function incurredCosts(
  completed: ScoredRun[],
  failed: FailedRun[],
): { costs: number[]; sources: Array<Exclude<ReportCostSource, null> | undefined>; observedAttempts: number } {
  const costs: number[] = [];
  const sources: Array<Exclude<ReportCostSource, null> | undefined> = [];
  let observedAttempts = 0;
  for (const run of completed) {
    const usage = run.outcome.result.usage;
    if (usage.costUsd !== undefined) {
      costs.push(usage.costUsd);
      sources.push(usageCostSource(usage));
      observedAttempts++;
      continue;
    }
    const stageCosts = completedStageRecords(run)
      .map((stage) => ({ cost: stage.usage.costUsd, source: usageCostSource(stage.usage) }))
      .filter((item): item is { cost: number; source: Exclude<ReportCostSource, null> | undefined } =>
        typeof item.cost === "number" && Number.isFinite(item.cost) && item.cost >= 0);
    if (stageCosts.length === 0) continue;
    const attemptCost = finiteSum(stageCosts.map((item) => item.cost));
    if (attemptCost === null) continue;
    costs.push(attemptCost);
    sources.push(...stageCosts.map((item) => item.source));
    observedAttempts++;
  }
  for (const failure of failed) {
    const stageCosts = failure.outcome.telemetry?.stages
      .map((stage) => ({ cost: stage.usage.costUsd, source: usageCostSource(stage.usage) }))
      .filter((item): item is { cost: number; source: Exclude<ReportCostSource, null> | undefined } =>
        typeof item.cost === "number" && Number.isFinite(item.cost) && item.cost >= 0) ?? [];
    if (stageCosts.length === 0) continue;
    const attemptCost = stageCosts.reduce((sum, item) => sum + item.cost, 0);
    if (!Number.isFinite(attemptCost)) continue;
    costs.push(attemptCost);
    sources.push(...stageCosts.map((item) => item.source));
    observedAttempts++;
  }
  return { costs, sources, observedAttempts };
}

function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const group = key(value);
    grouped.set(group, [...(grouped.get(group) ?? []), value]);
  }
  return grouped;
}

function finiteSum(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number.isFinite(total) ? total : null;
}

function countBy<T>(values: T[], key: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const group = key(value);
    counts[group] = (counts[group] ?? 0) + 1;
  }
  return counts;
}

function latestRunsDir(): string {
  const runs = resolve("eval/runs");
  const dirs = readdirSync(runs).sort();
  const last = dirs[dirs.length - 1];
  if (!last) throw new Error("No run directories under eval/runs.");
  return join(runs, last);
}
