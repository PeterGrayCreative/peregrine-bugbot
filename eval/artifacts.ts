import { isDeepStrictEqual } from "node:util";
import {
  parseBreadthArtifactOutput,
  parseBreadthLedgerEvidence,
  parseBreadthLedgerTelemetry,
  parseBreadthResult,
  serializeBreadthLedger,
} from "../src/core/breadth-result.js";
import { MAX_MANIFEST_CHARS } from "../src/core/manifest.js";
import { parseEngineResult, parseReviewPayload } from "../src/core/review-result.js";
import { RUN_FAILURE_KINDS } from "../src/core/run-failure.js";
import { combineUsage, mockUsage, parseUsage, sha256 } from "../src/core/telemetry.js";
import { assertNoSecrets } from "../src/security/secrets.js";
import {
  CASE_CORPORA,
  USAGE_METRICS,
  type CaseCorpus,
  type EvaluationAttemptProvenance,
  type EvaluationHistoryProvenance,
  type EvaluationManifestProvenance,
  type FailureTelemetryUnavailableReason,
  type GradedRun,
  type GradingEvidence,
  type MatrixRunManifest,
  type NetworkIsolationCapability,
  type RunAttempt,
  type RunFailureTelemetry,
  type RunRecord,
  type StageTelemetry,
} from "../src/types.js";
import { parseTypedReviewManifest } from "../src/core/manifest.js";
import { assertOpaqueCaseId } from "./case-isolation.js";
import { ACCEPTED_EVAL_RUNTIME_IMAGE } from "./runtime-containment.js";

const RECORD_KEYS = new Set([
  "schemaVersion", "attemptId", "caseName", "caseKind", "configName", "repeat",
  "caseCorpus", "startedAt", "finishedAt", "attemptDurationMs", "outcome",
  "runner", "evaluationProvenance", "experimentId", "experimentManifestSha256",
]);
const GRADED_KEYS = new Set([...RECORD_KEYS, "matches", "falsePositiveIndexes", "grading"]);
const LEGACY_SCHEMA_V1_RECORD_KEYS = new Set([
  "schemaVersion", "attemptId", "caseName", "caseKind", "configName", "repeat",
  "startedAt", "finishedAt", "outcome",
]);
const LEGACY_SCHEMA_V1_GRADED_KEYS = new Set([...LEGACY_SCHEMA_V1_RECORD_KEYS, "matches", "falsePositiveIndexes"]);
const PRE_TELEMETRY_RECORD_KEYS = new Set([...RECORD_KEYS].filter((key) =>
  key !== "runner" && key !== "attemptDurationMs" &&
  key !== "experimentId" && key !== "experimentManifestSha256"));
const PRE_TELEMETRY_GRADED_KEYS = new Set([...PRE_TELEMETRY_RECORD_KEYS, "matches", "falsePositiveIndexes"]);
const PRE_TELEMETRY_USAGE_KEYS = new Set([
  "inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens", "costUsd",
]);

// Schema-v1 artifacts record one of these immutable capability statements.
// Runtime containment changes must introduce a new manifest schema instead of
// rewriting the meaning of historical experiment evidence.
const SCHEMA_V1_NETWORK_ISOLATION = {
  mock: {
    status: "not-applicable",
    mechanism: "No provider process is started for structural smoke runs.",
  },
  claude: {
    status: "unavailable",
    mechanism:
      "CLI customization surfaces are disabled, but external filesystem and network containment are not attested; live matrix attempts fail closed.",
  },
  codex: {
    status: "unavailable",
    mechanism:
      "The runner requests an untrusted read-only project with local guidance disabled, but external read/network containment is not attested; live matrix attempts fail closed.",
  },
} as const satisfies Readonly<Record<RunRecord["runner"], NetworkIsolationCapability>>;

export type LegacyRunAttempt = Omit<RunAttempt, "corpus" | "expectedBugCount" | "runner">;
export interface LegacyMatrixRunManifest {
  schemaVersion: 1;
  createdAt: string;
  expectedAttempts: LegacyRunAttempt[];
}
export type LegacySchemaV1RunRecord = Omit<RunRecord, "caseCorpus" | "runner" | "attemptDurationMs">;
export type LegacySchemaV1GradedRun = Omit<GradedRun, "caseCorpus" | "runner" | "attemptDurationMs">;
export type PreTelemetryRunAttempt = Omit<RunAttempt, "runner">;
export interface PreTelemetryMatrixRunManifest {
  schemaVersion: 1;
  createdAt: string;
  expectedAttempts: PreTelemetryRunAttempt[];
  providerNetworkIsolation: Partial<Record<RunRecord["runner"], NetworkIsolationCapability>>;
}
export type PreTelemetryRunRecord = Omit<RunRecord, "runner" | "attemptDurationMs">;
export type PreTelemetryGradedRun = Omit<GradedRun, "runner" | "attemptDurationMs">;
type ComparableRunRecord = Pick<RunRecord,
  "experimentId" | "experimentManifestSha256" | "caseKind" | "startedAt" | "finishedAt" |
  "evaluationProvenance" | "outcome"
>;
type ComparableGradedRun = Pick<GradedRun,
  "experimentId" | "experimentManifestSha256" | "caseKind" | "startedAt" | "finishedAt" | "evaluationProvenance" |
  "outcome" | "matches" | "falsePositiveIndexes"
  | "grading"
>;

export function parseMatrixRunManifest(value: unknown, source = "matrix manifest"): MatrixRunManifest {
  const root = object(value, source);
  const schemaVersion = root.schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== 2) throw new Error(`${source}.schemaVersion must be 1 or 2`);
  onlyKeys(root, new Set([
    "schemaVersion", "createdAt", "expectedAttempts", "providerNetworkIsolation",
    ...(schemaVersion === 2 ? ["providerFilesystemIsolation", "runtimeImage"] : []),
  ]), source);
  const createdAt = isoDate(root.createdAt, `${source}.createdAt`);
  if (!Array.isArray(root.expectedAttempts)) throw new Error(`${source}.expectedAttempts must be an array`);
  const expectedAttempts = root.expectedAttempts.map((attempt, index) =>
    parseAttempt(attempt, `${source}.expectedAttempts[${index}]`));
  assertUniqueAttempts(expectedAttempts, source);
  assertUniqueLogicalAttempts(expectedAttempts, source);
  assertConsistentExpectedBugCounts(expectedAttempts, source);
  const providerNetworkIsolation = parseNetworkIsolation(
    root.providerNetworkIsolation,
    `${source}.providerNetworkIsolation`,
  );
  if (schemaVersion === 1) {
    validateCurrentNetworkIsolation(expectedAttempts, providerNetworkIsolation, source);
  } else {
    validateContainedNetworkIsolation(expectedAttempts, providerNetworkIsolation, source);
  }
  const providerFilesystemIsolation = schemaVersion === 2
    ? parseNetworkIsolation(root.providerFilesystemIsolation, `${source}.providerFilesystemIsolation`)
    : undefined;
  if (providerFilesystemIsolation) validateFilesystemIsolation(expectedAttempts, providerFilesystemIsolation, source);
  const runtimeImage = schemaVersion === 2 ? parseRuntimeImage(root.runtimeImage, expectedAttempts, source) : undefined;
  const parsed: MatrixRunManifest = {
    schemaVersion, createdAt, expectedAttempts, providerNetworkIsolation,
    ...(providerFilesystemIsolation ? { providerFilesystemIsolation } : {}),
    ...(schemaVersion === 2 ? { runtimeImage: runtimeImage ?? null } : {}),
  };
  assertNoSecrets(parsed, `${source} artifact`);
  return parsed;
}

function parseRuntimeImage(value: unknown, attempts: RunAttempt[], source: string): MatrixRunManifest["runtimeImage"] {
  const live = attempts.some((attempt) => attempt.runner !== "mock");
  if (!live) {
    if (value !== null) throw new Error(`${source}.runtimeImage must be null for mock-only runs`);
    return null;
  }
  const image = object(value, `${source}.runtimeImage`);
  onlyKeys(image, new Set(["reference", "pullPolicy"]), `${source}.runtimeImage`);
  const reference = strictString(image.reference, `${source}.runtimeImage.reference`, 300);
  if (reference !== ACCEPTED_EVAL_RUNTIME_IMAGE) {
    throw new Error(`${source}.runtimeImage.reference must equal the accepted runtime image digest`);
  }
  if (image.pullPolicy !== "never") throw new Error(`${source}.runtimeImage.pullPolicy must be never`);
  return { reference, pullPolicy: "never" };
}

/**
 * P1 emitted schema-v1 manifests before corpus and runner were added. The
 * version could not distinguish those artifacts, so recognize only the exact
 * old attempt shape and keep its reports explicitly legacy/incomplete.
 */
export function isLegacyMatrixRunManifest(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const root = value as Record<string, unknown>;
  if (!sameKeys(root, new Set(["schemaVersion", "createdAt", "expectedAttempts"]))) return false;
  const attempts = root.expectedAttempts;
  return Array.isArray(attempts) && attempts.every((attempt) =>
    !!attempt && typeof attempt === "object" && !Array.isArray(attempt) &&
    sameKeys(
      attempt as Record<string, unknown>,
      new Set(["id", "caseName", "configName", "repeat", "file"]),
    ));
}

export function parseLegacyMatrixRunManifest(
  value: unknown,
  source = "legacy matrix manifest",
): LegacyMatrixRunManifest {
  const root = object(value, source);
  onlyKeys(root, new Set(["schemaVersion", "createdAt", "expectedAttempts"]), source);
  if (root.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  const createdAt = isoDate(root.createdAt, `${source}.createdAt`);
  if (!Array.isArray(root.expectedAttempts)) throw new Error(`${source}.expectedAttempts must be an array`);
  const expectedAttempts = root.expectedAttempts.map((attempt, index) =>
    parseLegacyAttempt(attempt, `${source}.expectedAttempts[${index}]`));
  assertUniqueAttempts(expectedAttempts, source);
  return { schemaVersion: 1, createdAt, expectedAttempts };
}

/**
 * PR3 emitted schema-v1 artifacts after corpus isolation was introduced but
 * before the manifest and records captured runner identity or telemetry
 * provenance. Keep this exact writer-era shape separate from both P1 and the
 * current strict format so it can be inspected without becoming comparable.
 */
export function isPreTelemetryMatrixRunManifest(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const root = value as Record<string, unknown>;
  if (!sameKeys(root, new Set(["schemaVersion", "createdAt", "expectedAttempts", "providerNetworkIsolation"]))) {
    return false;
  }
  if (!Array.isArray(root.expectedAttempts)) return false;
  return root.expectedAttempts.every((attempt) => {
    if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) return false;
    return sameKeys(
      attempt as Record<string, unknown>,
      new Set(["id", "caseName", "configName", "repeat", "file", "corpus", "expectedBugCount"]),
    );
  });
}

export function parsePreTelemetryMatrixRunManifest(
  value: unknown,
  source = "pre-telemetry matrix manifest",
): PreTelemetryMatrixRunManifest {
  const root = object(value, source);
  onlyKeys(root, new Set(["schemaVersion", "createdAt", "expectedAttempts", "providerNetworkIsolation"]), source);
  if (root.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  const createdAt = isoDate(root.createdAt, `${source}.createdAt`);
  if (!Array.isArray(root.expectedAttempts)) throw new Error(`${source}.expectedAttempts must be an array`);
  const expectedAttempts = root.expectedAttempts.map((attempt, index) =>
    parsePreTelemetryAttempt(attempt, `${source}.expectedAttempts[${index}]`));
  assertUniqueAttempts(expectedAttempts, source);
  const providerNetworkIsolation = parseNetworkIsolation(
    root.providerNetworkIsolation,
    `${source}.providerNetworkIsolation`,
  );
  return { schemaVersion: 1, createdAt, expectedAttempts, providerNetworkIsolation };
}

export function parseRunRecord(value: unknown, source: string, expected?: RunAttempt): RunRecord {
  const root = object(value, source);
  onlyKeys(root, RECORD_KEYS, source);
  const record = parseRecordFields(root, source);
  if (expected) assertAttemptIdentity(record, expected, source);
  return record;
}

export function parseGradedRun(value: unknown, source: string, expected?: RunAttempt): GradedRun {
  const root = object(value, source);
  onlyKeys(root, GRADED_KEYS, source);
  const record = parseRecordFields(root, source);
  if (record.outcome.status !== "completed") throw new Error(`${source}.outcome must be completed`);
  const completed = record.outcome;
  if (expected) assertAttemptIdentity(record, expected, source);
  const { matches, falsePositiveIndexes } = parseGradeFields(root, completed.result.findings.length, source, root.grading !== undefined);
  const grading = root.grading === undefined
    ? undefined
    : parseGradingEvidence(root.grading, completed.result.findings.length, matches, source);
  return { ...record, outcome: record.outcome, matches, falsePositiveIndexes, ...(grading ? { grading } : {}) };
}

export function parseLegacySchemaV1RunRecord(
  value: unknown,
  source: string,
  expected?: LegacyRunAttempt,
): LegacySchemaV1RunRecord {
  const root = object(value, source);
  onlyKeys(root, LEGACY_SCHEMA_V1_RECORD_KEYS, source);
  const record = parseLegacySchemaV1RecordFields(root, source);
  if (expected) assertLegacyAttemptIdentity(record, expected, source);
  return record;
}

export function parseLegacySchemaV1GradedRun(
  value: unknown,
  source: string,
  expected?: LegacyRunAttempt,
): LegacySchemaV1GradedRun {
  const root = object(value, source);
  onlyKeys(root, LEGACY_SCHEMA_V1_GRADED_KEYS, source);
  const record = parseLegacySchemaV1RecordFields(root, source);
  if (record.outcome.status !== "completed") throw new Error(`${source}.outcome must be completed`);
  if (expected) assertLegacyAttemptIdentity(record, expected, source);
  const { matches, falsePositiveIndexes } = parseGradeFields(
    root,
    record.outcome.result.findings.length,
    source,
  );
  return { ...record, outcome: record.outcome, matches, falsePositiveIndexes };
}

export function parsePreTelemetryRunRecord(
  value: unknown,
  source: string,
  expected?: PreTelemetryRunAttempt,
): PreTelemetryRunRecord {
  const root = object(value, source);
  onlyKeys(root, PRE_TELEMETRY_RECORD_KEYS, source);
  const record = parsePreTelemetryRecordFields(root, source);
  if (expected) assertPreTelemetryAttemptIdentity(record, expected, source);
  return record;
}

export function parsePreTelemetryGradedRun(
  value: unknown,
  source: string,
  expected?: PreTelemetryRunAttempt,
): PreTelemetryGradedRun {
  const root = object(value, source);
  onlyKeys(root, PRE_TELEMETRY_GRADED_KEYS, source);
  const record = parsePreTelemetryRecordFields(root, source);
  if (record.outcome.status !== "completed") throw new Error(`${source}.outcome must be completed`);
  if (expected) assertPreTelemetryAttemptIdentity(record, expected, source);
  const { matches, falsePositiveIndexes } = parseGradeFields(
    root,
    record.outcome.result.findings.length,
    source,
  );
  return { ...record, outcome: record.outcome, matches, falsePositiveIndexes };
}

export function assertGradedMatchesRun(
  graded: ComparableGradedRun,
  run: ComparableRunRecord,
  source: string,
): void {
  if (run.outcome.status !== "completed") throw new Error(`${source}: graded artifact cannot match a failed run`);
  for (const [field, actual, expected] of [
    ["experimentId", graded.experimentId, run.experimentId],
    ["experimentManifestSha256", graded.experimentManifestSha256, run.experimentManifestSha256],
    ["caseKind", graded.caseKind, run.caseKind],
    ["startedAt", graded.startedAt, run.startedAt],
    ["finishedAt", graded.finishedAt, run.finishedAt],
  ] as const) {
    if (actual !== expected) throw new Error(`${source}.${field} does not match the run artifact`);
  }
  if (!isDeepStrictEqual(graded.outcome.result, run.outcome.result)) {
    throw new Error(`${source}.outcome.result does not match the run artifact`);
  }
  if (!isDeepStrictEqual(graded.evaluationProvenance, run.evaluationProvenance)) {
    throw new Error(`${source}.evaluationProvenance does not match the run artifact`);
  }
  const matchedFindingIndexes = new Set(Object.values(graded.matches).filter((index): index is number => index !== null));
  const expectedFalsePositives = graded.grading
    ? graded.grading.unmatchedFindings.filter((item) => item.classification === "unsupported").map((item) => item.findingIndex)
    : graded.outcome.result.findings
      .map((finding, index) => ({ finding, index }))
      .filter(({ finding, index }) => finding.disposition === "fix-in-pr" && !matchedFindingIndexes.has(index))
      .map(({ index }) => index);
  if (!isDeepStrictEqual([...graded.falsePositiveIndexes].sort((a, b) => a - b), expectedFalsePositives)) {
    throw new Error(`${source}.falsePositiveIndexes does not match the graded findings`);
  }
}

export function parseLegacyCompletedRun(value: unknown, source: string): {
  caseName: string;
  caseKind: RunRecord["caseKind"];
  configName: string;
  repeat: number;
  startedAt: string;
  result: ReturnType<typeof parseEngineResult>;
  matches?: Record<string, number | null>;
  falsePositiveIndexes?: number[];
} {
  const root = object(value, source);
  onlyKeys(root, new Set([
    "caseName", "caseKind", "configName", "repeat", "startedAt", "result",
    "matches", "falsePositiveIndexes", "grading",
  ]), source);
  const result = parseEngineResult(root.result, `${source}.result`);
  const base = {
    caseName: safeRelativeCaseName(root.caseName, `${source}.caseName`),
    caseKind: caseKind(root.caseKind, `${source}.caseKind`),
    configName: strictString(root.configName, `${source}.configName`, 500),
    repeat: positiveSafeInteger(root.repeat, `${source}.repeat`),
    startedAt: isoDate(root.startedAt, `${source}.startedAt`),
    result,
  };
  if (root.matches === undefined && root.falsePositiveIndexes === undefined) return base;
  if (root.matches === undefined || root.falsePositiveIndexes === undefined) {
    throw new Error(`${source}: legacy graded fields must appear together`);
  }
  const parsed = parseGradeFields(root, result.findings.length, source);
  return { ...base, matches: parsed.matches, falsePositiveIndexes: parsed.falsePositiveIndexes };
}

function parseAttempt(value: unknown, source: string): RunAttempt {
  const root = object(value, source);
  onlyKeys(root, new Set(["id", "caseName", "configName", "repeat", "file", "corpus", "expectedBugCount", "runner"]), source);
  const id = strictString(root.id, `${source}.id`, 200);
  if (!/^attempt-[a-z0-9-]+$/i.test(id)) throw new Error(`${source}.id is not a safe attempt id`);
  const file = strictString(root.file, `${source}.file`, 240);
  if (file !== `${id}.json`) throw new Error(`${source}.file must equal ${id}.json`);
  const parsedCorpus = corpus(root.corpus, `${source}.corpus`);
  if (parsedCorpus === "unknown") throw new Error(`${source}.corpus must identify a current corpus`);
  const parsedCaseName = strictString(root.caseName, `${source}.caseName`, 500);
  const casePrefix = `${parsedCorpus}/`;
  if (!parsedCaseName.startsWith(casePrefix) || parsedCaseName.slice(casePrefix.length).includes("/")) {
    throw new Error(`${source}.caseName must be nested directly under its corpus`);
  }
  assertOpaqueCaseId(parsedCaseName.slice(casePrefix.length), `${source}.caseName basename`);
  return {
    id,
    caseName: parsedCaseName,
    configName: strictString(root.configName, `${source}.configName`, 500),
    repeat: positiveSafeInteger(root.repeat, `${source}.repeat`),
    file,
    corpus: parsedCorpus,
    expectedBugCount: root.expectedBugCount === null
      ? null
      : nonNegativeSafeInteger(root.expectedBugCount, `${source}.expectedBugCount`),
    runner: runner(root.runner, `${source}.runner`),
  };
}

function parsePreTelemetryAttempt(value: unknown, source: string): PreTelemetryRunAttempt {
  const root = object(value, source);
  onlyKeys(
    root,
    new Set(["id", "caseName", "configName", "repeat", "file", "corpus", "expectedBugCount"]),
    source,
  );
  const id = strictString(root.id, `${source}.id`, 200);
  if (!/^attempt-\d{6}$/.test(id)) throw new Error(`${source}.id must match the PR3 writer format`);
  const file = strictString(root.file, `${source}.file`, 240);
  if (file !== `${id}.json`) throw new Error(`${source}.file must equal ${id}.json`);
  const parsedCorpus = corpus(root.corpus, `${source}.corpus`);
  if (parsedCorpus === "unknown") throw new Error(`${source}.corpus must identify a pre-telemetry corpus`);
  const parsedCaseName = safeRelativeCaseName(root.caseName, `${source}.caseName`);
  return {
    id,
    caseName: parsedCaseName,
    configName: strictString(root.configName, `${source}.configName`, 500),
    repeat: positiveSafeInteger(root.repeat, `${source}.repeat`),
    file,
    corpus: parsedCorpus,
    expectedBugCount: root.expectedBugCount === null
      ? null
      : nonNegativeSafeInteger(root.expectedBugCount, `${source}.expectedBugCount`),
  };
}

function parseLegacyAttempt(value: unknown, source: string): LegacyRunAttempt {
  const root = object(value, source);
  onlyKeys(root, new Set(["id", "caseName", "configName", "repeat", "file"]), source);
  const id = strictString(root.id, `${source}.id`, 200);
  if (!/^attempt-\d{6}$/.test(id)) throw new Error(`${source}.id must match the P1 writer format`);
  const file = strictString(root.file, `${source}.file`, 240);
  if (file !== `${id}.json`) throw new Error(`${source}.file must equal ${id}.json`);
  return {
    id,
    caseName: safeRelativeCaseName(root.caseName, `${source}.caseName`),
    configName: strictString(root.configName, `${source}.configName`, 500),
    repeat: positiveSafeInteger(root.repeat, `${source}.repeat`),
    file,
  };
}

function assertUniqueAttempts(attempts: Array<Pick<RunAttempt, "id" | "file">>, source: string): void {
  const ids = new Set<string>();
  const files = new Set<string>();
  for (const attempt of attempts) {
    if (ids.has(attempt.id)) throw new Error(`${source}: duplicate attempt id ${attempt.id}`);
    if (files.has(attempt.file)) throw new Error(`${source}: duplicate attempt file ${attempt.file}`);
    ids.add(attempt.id);
    files.add(attempt.file);
  }
}

function assertConsistentExpectedBugCounts(attempts: RunAttempt[], source: string): void {
  const byCase = new Map<string, number | null>();
  for (const attempt of attempts) {
    if (byCase.has(attempt.caseName) && byCase.get(attempt.caseName) !== attempt.expectedBugCount) {
      throw new Error(`${source}: expectedBugCount must be identical across attempts for ${attempt.caseName}`);
    }
    byCase.set(attempt.caseName, attempt.expectedBugCount);
  }
}

function assertUniqueLogicalAttempts(attempts: RunAttempt[], source: string): void {
  const identities = new Set<string>();
  for (const attempt of attempts) {
    const identity = [attempt.caseName, attempt.configName, attempt.repeat, attempt.runner].join("\0");
    if (identities.has(identity)) {
      throw new Error(`${source}: duplicate logical attempt for ${attempt.caseName}`);
    }
    identities.add(identity);
  }
}

function parseRecordFields(root: Record<string, unknown>, source: string): RunRecord {
  if (root.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  const outcome = parseOutcome(root.outcome, `${source}.outcome`, true);
  if (outcome.status === "completed") {
    if (outcome.result.status === "skipped") {
      throw new Error(`${source}.outcome.result.status cannot be skipped for a completed attempt`);
    }
    validateCurrentUsage(outcome.result.engine, outcome.result.usage, `${source}.outcome.result.usage`);
    if (outcome.result.engine === "mock" &&
      (outcome.result.modelConfig !== "mock" ||
        !isDeepStrictEqual(outcome.result.usage, mockUsage()))) {
      throw new Error(`${source}.outcome.result does not match the current mock writer`);
    }
    const stages = validateEngineStageTelemetry(
      outcome.result.raw,
      `${source}.outcome.result.raw`,
      outcome.result.engine,
      outcome.result.findings,
    );
    if (outcome.result.engine !== "mock" && !stages) {
      throw new Error(`${source}.outcome.result.raw must include both provider stage records`);
    }
    if (stages && !isDeepStrictEqual(
      withoutUndefined(combineUsage(...stages.map((stage) => stage.usage))),
      withoutUndefined(outcome.result.usage),
    )) {
      throw new Error(`${source}.outcome.result.usage does not match aggregate stage telemetry`);
    }
    if (stages) {
      validateAggregateUsageShape(
        outcome.result.usage,
        stages,
        `${source}.outcome.result.usage`,
      );
      validateStageModelConfig(
        outcome.result.modelConfig,
        stages,
        `${source}.outcome.result`,
        outcome.result.engine,
      );
      if (outcome.result.durationMs < stageDurationSum(stages, `${source}.outcome.result.raw`)) {
        throw new Error(`${source}.outcome.result.durationMs must cover both stage durations`);
      }
    }
  }
  const parsedRunner = runner(root.runner, `${source}.runner`);
  if (outcome.status === "completed" && outcome.result.engine !== parsedRunner) {
    throw new Error(`${source}.outcome.result.engine does not match runner`);
  }
  if (outcome.status === "failed" && outcome.telemetry && outcome.telemetry.engine !== parsedRunner) {
    throw new Error(`${source}.outcome.telemetry.engine does not match runner`);
  }
  if (outcome.status === "failed") {
    const requiresWorkAccounting = outcome.failureKind === "provider" ||
      outcome.failureKind === "timeout" || outcome.failureKind === "parse";
    if (parsedRunner === "mock" && outcome.telemetryUnavailableReason !== undefined) {
      throw new Error(`${source}.outcome.telemetryUnavailableReason must be absent for the current mock writer`);
    }
    if (parsedRunner !== "mock" && requiresWorkAccounting && outcome.telemetry === undefined &&
      outcome.telemetryUnavailableReason === undefined) {
      throw new Error(
        `${source}.outcome must record telemetry or telemetryUnavailableReason for ${outcome.failureKind} failures`,
      );
    }
    if (outcome.telemetryUnavailableReason === "not-observed" && !requiresWorkAccounting) {
      throw new Error(
        `${source}.outcome.telemetryUnavailableReason not-observed is invalid for ${outcome.failureKind} failures`,
      );
    }
  }
  const startedAt = isoDate(root.startedAt, `${source}.startedAt`);
  const finishedAt = isoDate(root.finishedAt, `${source}.finishedAt`);
  if (Date.parse(finishedAt) < Date.parse(startedAt)) {
    throw new Error(`${source}.finishedAt must not precede startedAt`);
  }
  const attemptDurationMs = Date.parse(finishedAt) - Date.parse(startedAt);
  const recordedAttemptDurationMs = nonNegativeSafeInteger(
    root.attemptDurationMs,
    `${source}.attemptDurationMs`,
  );
  if (attemptDurationMs !== recordedAttemptDurationMs) {
    throw new Error(`${source} timestamp duration must equal attemptDurationMs`);
  }
  if (outcome.status === "completed" && recordedAttemptDurationMs < outcome.result.durationMs) {
    throw new Error(`${source} attempt duration must cover result durationMs`);
  }
  if (outcome.status === "failed") {
    if (recordedAttemptDurationMs < outcome.durationMs) {
      throw new Error(`${source} attempt duration must cover failure durationMs`);
    }
    if (outcome.telemetry && outcome.durationMs < outcome.telemetry.durationMs) {
      throw new Error(`${source}.outcome.durationMs must cover telemetry durationMs`);
    }
  }
  const evaluationProvenance = root.evaluationProvenance === undefined
    ? undefined
    : parseEvaluationProvenance(root.evaluationProvenance, `${source}.evaluationProvenance`);
  const parsedCaseKind = caseKind(root.caseKind, `${source}.caseKind`);
  const parsedCaseCorpus = corpus(root.caseCorpus, `${source}.caseCorpus`);
  if (parsedCaseCorpus === "unknown") {
    throw new Error(`${source}.caseCorpus must identify a current corpus`);
  }
  const parsedCaseName = safeRelativeCaseName(root.caseName, `${source}.caseName`);
  assertCorpusCaseName(parsedCaseName, parsedCaseCorpus, `${source}.caseName`);
  validateOutcomeProvenance(outcome, evaluationProvenance, parsedCaseKind, source, true);
  if (outcome.status === "completed" && outcome.result.engine !== "mock") {
    const raw = object(outcome.result.raw, `${source}.outcome.result.raw`);
    if (raw.manifest !== evaluationProvenance?.manifest?.output) {
      throw new Error(`${source}.outcome.result.raw.manifest does not match manifest provenance output`);
    }
  }
  const experimentId = root.experimentId === undefined
    ? undefined
    : sha256Hex(root.experimentId, `${source}.experimentId`);
  const experimentManifestSha256 = root.experimentManifestSha256 === undefined
    ? undefined
    : sha256Hex(root.experimentManifestSha256, `${source}.experimentManifestSha256`);
  if ((experimentId === undefined) !== (experimentManifestSha256 === undefined)) {
    throw new Error(`${source}: experimentId and experimentManifestSha256 must appear together`);
  }
  const record: RunRecord = {
    schemaVersion: 1,
    ...(experimentId === undefined ? {} : { experimentId, experimentManifestSha256 }),
    attemptId: strictString(root.attemptId, `${source}.attemptId`, 200),
    caseName: parsedCaseName,
    caseKind: parsedCaseKind,
    configName: strictString(root.configName, `${source}.configName`, 500),
    repeat: positiveSafeInteger(root.repeat, `${source}.repeat`),
    caseCorpus: parsedCaseCorpus,
    runner: parsedRunner,
    startedAt,
    finishedAt,
    attemptDurationMs: recordedAttemptDurationMs,
    ...(evaluationProvenance ? { evaluationProvenance } : {}),
    outcome,
  };
  assertNoSecrets(record, `${source} artifact`);
  return record;
}

function parseLegacySchemaV1RecordFields(
  root: Record<string, unknown>,
  source: string,
): LegacySchemaV1RunRecord {
  if (root.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  const outcome = parseOutcome(root.outcome, `${source}.outcome`, false);
  if (outcome.status === "completed") {
    validateP1EngineResult(
      object(root.outcome, `${source}.outcome`).result,
      outcome.result,
      `${source}.outcome.result`,
    );
  } else {
    const outcomeRoot = object(root.outcome, `${source}.outcome`);
    onlyKeys(outcomeRoot, new Set(["status", "failureKind", "message", "durationMs"]), `${source}.outcome`);
  }
  const startedAt = isoDate(root.startedAt, `${source}.startedAt`);
  const finishedAt = isoDate(root.finishedAt, `${source}.finishedAt`);
  if (Date.parse(finishedAt) < Date.parse(startedAt)) {
    throw new Error(`${source}.finishedAt must not precede startedAt`);
  }
  const parsedCaseKind = caseKind(root.caseKind, `${source}.caseKind`);
  return {
    schemaVersion: 1,
    attemptId: strictString(root.attemptId, `${source}.attemptId`, 200),
    caseName: safeRelativeCaseName(root.caseName, `${source}.caseName`),
    caseKind: parsedCaseKind,
    configName: strictString(root.configName, `${source}.configName`, 500),
    repeat: positiveSafeInteger(root.repeat, `${source}.repeat`),
    startedAt,
    finishedAt,
    outcome,
  };
}

function validateP1EngineResult(
  value: unknown,
  result: ReturnType<typeof parseEngineResult>,
  source: string,
): void {
  const root = object(value, source);
  onlyKeys(root, new Set([
    "engine", "status", "modelConfig", "findings", "usage", "durationMs", "raw",
  ]), source);
  if (result.status === "skipped") throw new Error(`${source}.status was not emitted by P1 matrix engines`);
  nonNegativeSafeInteger(root.durationMs, `${source}.durationMs`);
  if (!Array.isArray(root.findings)) throw new Error(`${source}.findings must be an array`);
  const p1FindingKeys = new Set([
    "file", "startLine", "endLine", "severity", "disposition", "category", "invariant",
    "title", "explanation", "failurePath", "confidence",
  ]);
  root.findings.forEach((finding, index) =>
    onlyKeys(object(finding, `${source}.findings[${index}]`), p1FindingKeys, `${source}.findings[${index}]`));
  const usageRoot = object(root.usage, `${source}.usage`);
  const usage = parseP1Usage(usageRoot, result.engine, `${source}.usage`);
  if (result.engine === "mock") {
    if (result.modelConfig !== "mock" || root.raw !== undefined ||
      !isDeepStrictEqual(usage, { inputTokens: 0, outputTokens: 0, costUsd: 0 })) {
      throw new Error(`${source} does not match the P1 mock writer`);
    }
    return;
  }
  const configured = result.modelConfig.split("->");
  if (configured.length !== 2 || configured.some((stage) => !/^.+\/.+$/.test(stage))) {
    throw new Error(`${source}.modelConfig does not match the P1 provider writer`);
  }
  const raw = object(root.raw, `${source}.raw`);
  onlyKeys(raw, new Set(["manifest", "breadth", "investigation"]), `${source}.raw`);
  if (raw.manifest !== "base/head refs were not supplied") {
    throw new Error(`${source}.raw.manifest does not match the P1 matrix writer`);
  }
  const breadth = parseP1Stage(raw.breadth, result.engine, "breadth", `${source}.raw.breadth`);
  const investigation = parseP1Stage(
    raw.investigation,
    result.engine,
    "investigation",
    `${source}.raw.investigation`,
  );
  const expectedUsage = combinePreTelemetryUsage(breadth, investigation, result.engine);
  if (!isDeepStrictEqual(expectedUsage, result.usage)) {
    throw new Error(`${source}.usage does not match P1 stage usage`);
  }
  if (result.engine === "codex") {
    const payload = parseReviewPayload(
      object(object(raw.investigation, `${source}.raw.investigation`).output, `${source}.raw.investigation.output`),
      `${source}.raw.investigation.output`,
    );
    if (!isDeepStrictEqual(payload.findings, result.findings)) {
      throw new Error(`${source}.raw.investigation.output findings do not match the result findings`);
    }
  }
  const stageDuration = stageDurationFromRaw(raw, `${source}.raw`);
  if (result.durationMs < stageDuration) {
    throw new Error(`${source}.durationMs must cover both stage durations`);
  }
}

function parseP1Stage(
  value: unknown,
  engine: "claude" | "codex",
  stage: "breadth" | "investigation",
  source: string,
): ReturnType<typeof parseUsage> {
  const root = object(value, source);
  const outputRequired = stage === "breadth" || engine === "codex";
  onlyKeys(
    root,
    outputRequired ? new Set(["output", "usage", "durationMs"]) : new Set(["usage", "durationMs"]),
    source,
  );
  if (outputRequired) {
    const output = object(root.output, `${source}.output`);
    if (stage === "breadth") parseBreadthResult(output, `${source}.output`);
    else onlyKeys(output, new Set(["findings"]), `${source}.output`);
  }
  nonNegativeSafeInteger(root.durationMs, `${source}.durationMs`);
  return parseP1Usage(object(root.usage, `${source}.usage`), engine, `${source}.usage`);
}

function parseP1Usage(
  root: Record<string, unknown>,
  engine: RunRecord["runner"],
  source: string,
): ReturnType<typeof parseUsage> {
  const allowed = engine === "claude"
    ? new Set(["inputTokens", "outputTokens", "costUsd"])
    : engine === "codex"
      ? new Set(["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens"])
      : new Set(["inputTokens", "outputTokens", "costUsd"]);
  onlyKeys(root, allowed, source);
  return parseUsage(root, source);
}

function parsePreTelemetryRecordFields(
  root: Record<string, unknown>,
  source: string,
): PreTelemetryRunRecord {
  if (root.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  const outcome = parsePreTelemetryOutcome(root.outcome, `${source}.outcome`);
  const startedAt = isoDate(root.startedAt, `${source}.startedAt`);
  const finishedAt = isoDate(root.finishedAt, `${source}.finishedAt`);
  if (Date.parse(finishedAt) < Date.parse(startedAt)) {
    throw new Error(`${source}.finishedAt must not precede startedAt`);
  }
  const evaluationProvenance = root.evaluationProvenance === undefined
    ? undefined
    : parseEvaluationProvenance(root.evaluationProvenance, `${source}.evaluationProvenance`);
  const parsedCaseKind = caseKind(root.caseKind, `${source}.caseKind`);
  const parsedCaseCorpus = corpus(root.caseCorpus, `${source}.caseCorpus`);
  if (parsedCaseCorpus === "unknown") {
    throw new Error(`${source}.caseCorpus must identify a pre-telemetry corpus`);
  }
  const parsedCaseName = safeRelativeCaseName(root.caseName, `${source}.caseName`);
  validateOutcomeProvenance(outcome, evaluationProvenance, parsedCaseKind, source, true);
  return {
    schemaVersion: 1,
    attemptId: strictString(root.attemptId, `${source}.attemptId`, 200),
    caseName: parsedCaseName,
    caseKind: parsedCaseKind,
    configName: strictString(root.configName, `${source}.configName`, 500),
    repeat: positiveSafeInteger(root.repeat, `${source}.repeat`),
    caseCorpus: parsedCaseCorpus,
    startedAt,
    finishedAt,
    ...(evaluationProvenance ? { evaluationProvenance } : {}),
    outcome,
  };
}

function parsePreTelemetryOutcome(value: unknown, source: string): RunRecord["outcome"] {
  const root = object(value, source);
  if (root.status === "completed") {
    onlyKeys(root, new Set(["status", "result"]), source);
    const result = parseEngineResult(root.result, `${source}.result`);
    validatePreTelemetryEngineResult(root.result, result, `${source}.result`);
    return { status: "completed", result };
  }
  if (root.status !== "failed") throw new Error(`${source}.status must be completed or failed`);
  onlyKeys(root, new Set(["status", "failureKind", "message", "durationMs"]), source);
  if (!RUN_FAILURE_KINDS.includes(root.failureKind as (typeof RUN_FAILURE_KINDS)[number])) {
    throw new Error(`${source}.failureKind is invalid`);
  }
  return {
    status: "failed",
    failureKind: root.failureKind as (typeof RUN_FAILURE_KINDS)[number],
    message: boundedNonEmptyString(root.message, `${source}.message`, 4000),
    durationMs: nonNegativeSafeInteger(root.durationMs, `${source}.durationMs`),
  };
}

function validatePreTelemetryEngineResult(
  value: unknown,
  result: ReturnType<typeof parseEngineResult>,
  source: string,
): void {
  const root = object(value, source);
  const usageRoot = object(root.usage, `${source}.usage`);
  const usage = parsePreTelemetryUsage(usageRoot, `${source}.usage`);
  if (result.status === "skipped") {
    throw new Error(`${source}.status was not emitted by pre-telemetry matrix engines`);
  }
  if (result.engine === "mock") {
    if (!sameKeys(usageRoot, new Set(["inputTokens", "outputTokens", "costUsd"])) ||
      usage.inputTokens !== 0 || usage.outputTokens !== 0 || usage.costUsd !== 0) {
      throw new Error(`${source}.usage does not match the pre-telemetry mock writer`);
    }
    if (result.modelConfig !== "mock") {
      throw new Error(`${source}.modelConfig does not match the pre-telemetry mock writer`);
    }
    if (root.raw !== undefined) {
      throw new Error(`${source}.raw must be absent for a pre-telemetry mock result`);
    }
    return;
  }
  validateLegacyProviderModelConfig(result.modelConfig, result.engine, `${source}.modelConfig`);
  const raw = object(root.raw, `${source}.raw`);
  onlyKeys(raw, new Set(["manifest", "breadth", "investigation"]), `${source}.raw`);
  if (raw.manifest !== "runner-generated") {
    throw new Error(`${source}.raw.manifest does not match the pre-telemetry writer`);
  }
  const breadth = parsePreTelemetryStage(
    raw.breadth,
    result.engine,
    "breadth",
    `${source}.raw.breadth`,
  );
  const investigation = parsePreTelemetryStage(
    raw.investigation,
    result.engine,
    "investigation",
    `${source}.raw.investigation`,
  );
  const expectedUsage = combinePreTelemetryUsage(breadth, investigation, result.engine);
  if (!isDeepStrictEqual(expectedUsage, result.usage)) {
    throw new Error(`${source}.usage does not match pre-telemetry stage usage`);
  }
  if (result.engine === "codex") {
    const payload = parseReviewPayload(
      object(object(raw.investigation, `${source}.raw.investigation`).output, `${source}.raw.investigation.output`),
      `${source}.raw.investigation.output`,
    );
    if (!isDeepStrictEqual(payload.findings, result.findings)) {
      throw new Error(`${source}.raw.investigation.output findings do not match the result findings`);
    }
  }
  const stageDuration = stageDurationFromRaw(raw, `${source}.raw`);
  if (result.durationMs < stageDuration) {
    throw new Error(`${source}.durationMs must cover both stage durations`);
  }
}

function validateLegacyProviderModelConfig(
  modelConfig: string,
  engine: "claude" | "codex",
  source: string,
): void {
  const efforts = engine === "codex"
    ? new Set(["low", "medium", "high", "xhigh", "max", "ultra"])
    : new Set(["low", "medium", "high", "xhigh", "max"]);
  const stages = modelConfig.split("->");
  if (stages.length !== 2 || stages.some((stage) => {
    const separator = stage.lastIndexOf("/");
    return separator <= 0 || separator === stage.length - 1 ||
      !efforts.has(stage.slice(separator + 1));
  })) {
    throw new Error(`${source} does not match the ${engine} pre-telemetry writer`);
  }
}

function stageDurationFromRaw(raw: Record<string, unknown>, source: string): number {
  const breadth = object(raw.breadth, `${source}.breadth`);
  const investigation = object(raw.investigation, `${source}.investigation`);
  const breadthDuration = nonNegativeSafeInteger(
    breadth.durationMs,
    `${source}.breadth.durationMs`,
  );
  const investigationDuration = nonNegativeSafeInteger(
    investigation.durationMs,
    `${source}.investigation.durationMs`,
  );
  const total = breadthDuration + investigationDuration;
  if (!Number.isSafeInteger(total)) throw new Error(`${source} stage duration sum is not safely representable`);
  return total;
}

function parsePreTelemetryStage(
  value: unknown,
  engine: "claude" | "codex",
  stage: "breadth" | "investigation",
  source: string,
): ReturnType<typeof parseUsage> {
  const root = object(value, source);
  const outputRequired = stage === "breadth" || engine === "codex";
  onlyKeys(
    root,
    outputRequired ? new Set(["output", "usage", "durationMs"]) : new Set(["usage", "durationMs"]),
    source,
  );
  if (outputRequired) {
    const output = object(root.output, `${source}.output`);
    if (stage === "breadth") parseBreadthResult(output, `${source}.output`);
    else onlyKeys(output, new Set(["findings"]), `${source}.output`);
  }
  nonNegativeSafeInteger(root.durationMs, `${source}.durationMs`);
  return parsePreTelemetryUsage(root.usage, `${source}.usage`);
}

function parsePreTelemetryUsage(value: unknown, source: string): ReturnType<typeof parseUsage> {
  const root = object(value, source);
  onlyKeys(root, PRE_TELEMETRY_USAGE_KEYS, source);
  return parseUsage(root, source);
}

function combinePreTelemetryUsage(
  left: ReturnType<typeof parseUsage>,
  right: ReturnType<typeof parseUsage>,
  engine: RunRecord["runner"],
): ReturnType<typeof parseUsage> {
  const combined: Record<string, number> = {};
  for (const key of PRE_TELEMETRY_USAGE_KEYS) {
    const field = key as "inputTokens" | "cachedInputTokens" | "outputTokens" |
      "reasoningOutputTokens" | "costUsd";
    const values = [left[field], right[field]].filter((item): item is number => item !== undefined);
    if (values.length === 0) continue;
    const total = values.reduce((sum, item) => sum + item, 0);
    if (!Number.isFinite(total) || (field !== "costUsd" && !Number.isSafeInteger(total))) {
      throw new Error(`pre-telemetry ${field} aggregate is not safely representable`);
    }
    // Codex's writer omitted zero aggregate token values and did not aggregate
    // cost. Claude preserved observed zeroes and provider-reported cost.
    if (engine === "codex" && (field === "costUsd" || total === 0)) continue;
    combined[field] = total;
  }
  return parseUsage(combined, "combined pre-telemetry usage");
}

function validateOutcomeProvenance(
  outcome: RunRecord["outcome"],
  provenance: EvaluationAttemptProvenance | undefined,
  parsedCaseKind: RunRecord["caseKind"],
  source: string,
  requireCompletedProvenance: boolean,
): void {
  if (!provenance) {
    if (outcome.status === "completed" && requireCompletedProvenance) {
      throw new Error(`${source}.evaluationProvenance is required for a completed attempt`);
    }
    if (outcome.status === "failed" &&
      (outcome.failureKind !== "configuration" || outcome.telemetry !== undefined ||
        outcome.telemetryUnavailableReason !== undefined) &&
      requireCompletedProvenance) {
      throw new Error(`${source}.evaluationProvenance is required for a post-materialization failure`);
    }
    return;
  }
  const expectedMaterialization = parsedCaseKind === "historical"
    ? "historical-sanitized-export"
    : parsedCaseKind === "seeded" || parsedCaseKind === "clean"
      ? "fixture-patch"
      : undefined;
  if (!expectedMaterialization || provenance.history.materialization !== expectedMaterialization) {
    throw new Error(`${source}.caseKind does not match history materialization`);
  }
  if (outcome.status === "completed") {
    if (!provenance.manifest) {
      throw new Error(`${source}.evaluationProvenance.manifest is required for a completed attempt`);
    }
    if (outcome.result.reviewedBaseRef !== provenance.history.baseRef) {
      throw new Error(`${source}.outcome.result.reviewedBaseRef does not match history provenance`);
    }
    if (outcome.result.reviewedHeadRef !== provenance.history.headRef) {
      throw new Error(`${source}.outcome.result.reviewedHeadRef does not match history provenance`);
    }
  } else if ((outcome.failureKind !== "configuration" || outcome.telemetry !== undefined ||
    outcome.telemetryUnavailableReason !== undefined) &&
    !provenance.manifest) {
    throw new Error(`${source}.evaluationProvenance.manifest is required for a post-preflight failure`);
  }
}

function parseEvaluationProvenance(value: unknown, source: string): EvaluationAttemptProvenance {
  const root = object(value, source);
  onlyKeys(root, new Set(["history", "manifest"]), source);
  const history = parseHistoryProvenance(root.history, `${source}.history`);
  const manifest = root.manifest === undefined
    ? undefined
    : parseManifestProvenance(root.manifest, history, `${source}.manifest`);
  return { history, ...(manifest ? { manifest } : {}) };
}

function parseHistoryProvenance(value: unknown, source: string): EvaluationHistoryProvenance {
  const root = object(value, source);
  onlyKeys(root, new Set([
    "schemaVersion", "materialization", "objectFormat", "baseRef", "headRef",
    "mergeBase", "baseTree", "headTree", "commitCount", "baseIsMergeBase",
    "checkedOutTreeMatchesHead", "treeReproductionVerified", "historicalSource",
    "diffNormalization", "diffSha256",
  ]), source);
  if (root.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  if (!(root.materialization === "fixture-patch" || root.materialization === "historical-sanitized-export")) {
    throw new Error(`${source}.materialization is invalid`);
  }
  if (!(root.objectFormat === "sha1" || root.objectFormat === "sha256")) {
    throw new Error(`${source}.objectFormat is invalid`);
  }
  const objectFormat = root.objectFormat;
  const baseRef = gitObjectId(root.baseRef, objectFormat, `${source}.baseRef`);
  const headRef = gitObjectId(root.headRef, objectFormat, `${source}.headRef`);
  const mergeBase = gitObjectId(root.mergeBase, objectFormat, `${source}.mergeBase`);
  const baseTree = gitObjectId(root.baseTree, objectFormat, `${source}.baseTree`);
  const headTree = gitObjectId(root.headTree, objectFormat, `${source}.headTree`);
  if (baseRef === headRef) throw new Error(`${source}.baseRef and headRef must be distinct commits`);
  if (baseTree === headTree) throw new Error(`${source}.baseTree and headTree must be distinct trees`);
  if (mergeBase !== baseRef) throw new Error(`${source}.mergeBase must equal baseRef`);
  if (root.commitCount !== 2) throw new Error(`${source}.commitCount must be 2`);
  requireTrue(root.baseIsMergeBase, `${source}.baseIsMergeBase`);
  requireTrue(root.checkedOutTreeMatchesHead, `${source}.checkedOutTreeMatchesHead`);
  requireTrue(root.treeReproductionVerified, `${source}.treeReproductionVerified`);
  if (root.diffNormalization !== "identity-v1") {
    throw new Error(`${source}.diffNormalization must be identity-v1`);
  }
  const historicalSource = root.historicalSource === undefined
    ? undefined
    : parseHistoricalSource(root.historicalSource, objectFormat, `${source}.historicalSource`);
  if ((root.materialization === "historical-sanitized-export") !== (historicalSource !== undefined)) {
    throw new Error(`${source}.historicalSource must appear only for historical materialization`);
  }
  if (historicalSource && (
    historicalSource.sourceBaseTree !== baseTree || historicalSource.sourceHeadTree !== headTree
  )) {
    throw new Error(`${source}.historicalSource trees must match reproduced history trees`);
  }
  return {
    schemaVersion: 1,
    materialization: root.materialization,
    objectFormat,
    baseRef,
    headRef,
    mergeBase,
    baseTree,
    headTree,
    commitCount: 2,
    baseIsMergeBase: true,
    checkedOutTreeMatchesHead: true,
    treeReproductionVerified: true,
    ...(historicalSource ? { historicalSource } : {}),
    diffNormalization: "identity-v1",
    diffSha256: sha256Hex(root.diffSha256, `${source}.diffSha256`),
  };
}

function parseHistoricalSource(
  value: unknown,
  objectFormat: EvaluationHistoryProvenance["objectFormat"],
  source: string,
): NonNullable<EvaluationHistoryProvenance["historicalSource"]> {
  const root = object(value, source);
  onlyKeys(root, new Set([
    "sourceIdentitySha256", "sourceBaseRef", "sourceHeadRef", "sourceMergeBase",
    "sourceBaseTree", "sourceHeadTree", "baseCommitIsMergeBase", "baseTreeMatches",
    "headTreeMatches",
  ]), source);
  const sourceBaseRef = gitObjectId(root.sourceBaseRef, objectFormat, `${source}.sourceBaseRef`);
  const sourceHeadRef = gitObjectId(root.sourceHeadRef, objectFormat, `${source}.sourceHeadRef`);
  const sourceMergeBase = gitObjectId(root.sourceMergeBase, objectFormat, `${source}.sourceMergeBase`);
  if (sourceBaseRef === sourceHeadRef) {
    throw new Error(`${source}.sourceBaseRef and sourceHeadRef must be distinct commits`);
  }
  if (sourceMergeBase !== sourceBaseRef) {
    throw new Error(`${source}.sourceMergeBase must equal sourceBaseRef`);
  }
  requireTrue(root.baseCommitIsMergeBase, `${source}.baseCommitIsMergeBase`);
  requireTrue(root.baseTreeMatches, `${source}.baseTreeMatches`);
  requireTrue(root.headTreeMatches, `${source}.headTreeMatches`);
  return {
    sourceIdentitySha256: sha256Hex(root.sourceIdentitySha256, `${source}.sourceIdentitySha256`),
    sourceBaseRef,
    sourceHeadRef,
    sourceMergeBase,
    sourceBaseTree: gitObjectId(root.sourceBaseTree, objectFormat, `${source}.sourceBaseTree`),
    sourceHeadTree: gitObjectId(root.sourceHeadTree, objectFormat, `${source}.sourceHeadTree`),
    baseCommitIsMergeBase: true,
    baseTreeMatches: true,
    headTreeMatches: true,
  };
}

function parseManifestProvenance(
  value: unknown,
  history: EvaluationHistoryProvenance,
  source: string,
): EvaluationManifestProvenance {
  const root = object(value, source);
  onlyKeys(root, new Set([
    "entryPoint", "skillName", "baseRef", "headRef", "mergeBase", "outputSha256",
    "output", "typed", "typedSha256", "profileSource", "headProfileChanged",
  ]), source);
  if (root.entryPoint !== "prepareReviewManifest") {
    throw new Error(`${source}.entryPoint must be prepareReviewManifest`);
  }
  const output = boundedText(root.output, `${source}.output`, MAX_MANIFEST_CHARS);
  assertNoSecrets(output, `${source}.output`);
  const outputSha256 = sha256Hex(root.outputSha256, `${source}.outputSha256`);
  if (outputSha256 !== sha256(output)) throw new Error(`${source}.outputSha256 does not match output`);
  let typed: EvaluationManifestProvenance["typed"];
  let typedSha256: string | undefined;
  if (root.typed !== undefined || root.typedSha256 !== undefined) {
    if (root.typed === undefined || root.typedSha256 === undefined) throw new Error(`${source}.typed and typedSha256 must appear together`);
    assertNoSecrets(root.typed, `${source}.typed`);
    typed = parseTypedReviewManifest(JSON.stringify(root.typed));
    typedSha256 = sha256Hex(root.typedSha256, `${source}.typedSha256`);
    if (typedSha256 !== sha256(JSON.stringify(typed))) throw new Error(`${source}.typedSha256 does not match typed`);
    if (typed.base.ref !== history.baseRef || typed.base.commit !== history.baseRef ||
      typed.head.ref !== history.headRef || typed.head.commit !== history.headRef ||
      typed.mergeBase !== history.mergeBase) {
      throw new Error(`${source}.typed history provenance does not match attempt history`);
    }
  }
  if (!(root.profileSource === "none" || root.profileSource === "merge-base snapshot" ||
    root.profileSource === "ignored; absent at merge base")) {
    throw new Error(`${source}.profileSource is invalid`);
  }
  if (typeof root.headProfileChanged !== "boolean") {
    throw new Error(`${source}.headProfileChanged must be boolean`);
  }
  if (root.profileSource === "none" && root.headProfileChanged) {
    throw new Error(`${source}.headProfileChanged requires a selected profile source`);
  }
  if (root.profileSource === "ignored; absent at merge base" && !root.headProfileChanged) {
    throw new Error(`${source}.ignored profile provenance requires headProfileChanged`);
  }
  if (typed) {
    const expectedSource = root.profileSource === "merge-base snapshot" ? "merge-base" : "none";
    if (typed.profile.source !== expectedSource || typed.profile.changedAtHead !== root.headProfileChanged) {
      throw new Error(`${source}.typed profile provenance does not match outer provenance`);
    }
  }
  for (const [field, actual, expected] of [
    ["baseRef", root.baseRef, history.baseRef],
    ["headRef", root.headRef, history.headRef],
    ["mergeBase", root.mergeBase, history.mergeBase],
  ] as const) {
    if (actual !== expected) throw new Error(`${source}.${field} does not match history provenance`);
  }
  validateManifestOutputProvenance(
    output,
    history,
    root.profileSource,
    root.headProfileChanged,
    source,
  );
  return {
    entryPoint: "prepareReviewManifest",
    skillName: strictString(root.skillName, `${source}.skillName`, 500),
    baseRef: history.baseRef,
    headRef: history.headRef,
    mergeBase: history.mergeBase,
    outputSha256,
    output,
    ...(typed ? { typed, typedSha256 } : {}),
    profileSource: root.profileSource,
    headProfileChanged: root.headProfileChanged,
  };
}

function validateManifestOutputProvenance(
  output: string,
  history: EvaluationHistoryProvenance,
  profileSource: EvaluationManifestProvenance["profileSource"],
  headProfileChanged: boolean,
  source: string,
): void {
  const lines = output.split("\n");
  for (const [label, expected] of [
    ["base", `base: ${history.baseRef} (argument)`],
    ["head", `head: ${history.headRef}`],
    ["merge-base", `merge-base: ${history.mergeBase}`],
  ] as const) {
    const provenanceLines = lines.filter((line) => line.startsWith(`${label}:`));
    if (provenanceLines.length !== 1 || provenanceLines[0] !== expected) {
      throw new Error(`${source}.output ${label} provenance does not match history`);
    }
  }
  const profileLines = lines.filter((line) => line.startsWith("profile: "));
  if (profileSource === "none") {
    if (profileLines.length !== 0) throw new Error(`${source}.output reports an unselected profile`);
  } else if (profileLines.length !== 1 || !profileLines[0]!.endsWith(` (${profileSource})`)) {
    throw new Error(`${source}.output profile provenance does not match profileSource`);
  }
  const warning = "warning: head changes to the repository profile or custom lanes are ignored; review them as untrusted code or rerun with --trust-working-tree-profile after explicit approval";
  const warningCount = lines.filter((line) => line === warning).length;
  if (warningCount !== (headProfileChanged ? 1 : 0)) {
    throw new Error(`${source}.output profile-change warning does not match headProfileChanged`);
  }
}

function validateEngineStageTelemetry(
  value: unknown,
  source: string,
  engine: RunRecord["runner"],
  resultFindings: ReturnType<typeof parseEngineResult>["findings"],
): StageTelemetry[] | undefined {
  if (value === undefined) {
    if (engine !== "mock") return undefined;
    return undefined;
  }
  if (engine === "mock") {
    throw new Error(`${source} must be absent for the current mock writer`);
  }
  const raw = object(value, source);
  onlyKeys(raw, new Set(["manifest", "breadth", "investigation"]), source);
  const stages: Partial<Record<"breadth" | "investigation", StageTelemetry>> = {};
  for (const stageName of ["breadth", "investigation"] as const) {
    if (raw[stageName] === undefined) continue;
    const stage = object(raw[stageName], `${source}.${stageName}`);
    const methodHashes = stageName === "investigation"
      ? ["methodCoreSha256", "methodSourceSha256"]
      : [];
    const breadthEvidence = stageName === "breadth"
      ? ["transmittedLedger", "breadthLedger"]
      : [];
    const keys = engine === "codex"
      ? new Set(["output", "model", "promptSha256", "usage", "durationMs", "malformedEventLines", ...breadthEvidence, ...methodHashes])
      : stageName === "breadth"
        ? new Set(["output", "model", "promptSha256", "usage", "durationMs", ...breadthEvidence])
        : new Set(["model", "promptSha256", "usage", "durationMs", ...methodHashes]);
    onlyKeys(stage, keys, `${source}.${stageName}`);
    if (stage.durationMs === undefined || stage.usage === undefined ||
      stage.model === undefined || stage.promptSha256 === undefined) {
      throw new Error(`${source}.${stageName} must include model, promptSha256, durationMs, and usage`);
    }
    nonNegativeSafeInteger(stage.durationMs, `${source}.${stageName}.durationMs`);
    const model = strictString(stage.model, `${source}.${stageName}.model`, 500);
    const usage = parseUsage(stage.usage, `${source}.${stageName}.usage`);
    validateCurrentUsage(engine, usage, `${source}.${stageName}.usage`);
    validateStageUsageShape(engine, usage, `${source}.${stageName}.usage`, false);
    validateCurrentStagePricingModel(usage, model, `${source}.${stageName}.usage`);
    const promptSha256 = strictString(stage.promptSha256, `${source}.${stageName}.promptSha256`, 64);
    if (!/^[a-f0-9]{64}$/.test(promptSha256)) {
      throw new Error(`${source}.${stageName}.promptSha256 must be lowercase SHA-256 hex`);
    }
    if (stageName === "investigation") {
      const hasCoreHash = stage.methodCoreSha256 !== undefined;
      const hasSourceHash = stage.methodSourceSha256 !== undefined;
      if (hasCoreHash !== hasSourceHash) {
        throw new Error(`${source}.${stageName} method hashes must be present together`);
      }
      for (const field of ["methodCoreSha256", "methodSourceSha256"] as const) {
        if (stage[field] === undefined) continue;
        const hash = strictString(stage[field], `${source}.${stageName}.${field}`, 64);
        if (!/^[a-f0-9]{64}$/.test(hash)) {
          throw new Error(`${source}.${stageName}.${field} must be lowercase SHA-256 hex`);
        }
      }
    }
    let breadthLedgerTelemetry: StageTelemetry["breadthLedger"];
    if (stageName === "breadth" || engine === "codex") {
      const output = object(stage.output, `${source}.${stageName}.output`);
      if (stageName === "breadth") {
        const hasTransmittedLedger = stage.transmittedLedger !== undefined;
        const hasBreadthLedger = stage.breadthLedger !== undefined;
        if (hasTransmittedLedger !== hasBreadthLedger) {
          throw new Error(
            `${source}.${stageName} transmittedLedger and breadthLedger must be present together`,
          );
        }
        if (hasTransmittedLedger) {
          breadthLedgerTelemetry = parseBreadthLedgerTelemetry(
            stage.breadthLedger,
            `${source}.${stageName}.breadthLedger`,
          );
          const providerOutput = parseBreadthResult(
            output,
            `${source}.${stageName}.output`,
            breadthLedgerTelemetry.mode,
          );
          const expected = serializeBreadthLedger(providerOutput, breadthLedgerTelemetry.mode);
          const transmitted = parseBreadthArtifactOutput(
            stage.transmittedLedger,
            `${source}.${stageName}.transmittedLedger`,
          );
          if (!isDeepStrictEqual(transmitted, expected.output)) {
            throw new Error(`${source}.${stageName}.transmittedLedger does not match provider output`);
          }
          if (!isDeepStrictEqual(breadthLedgerTelemetry, expected.telemetry)) {
            throw new Error(`${source}.${stageName}.breadthLedger does not match provider output`);
          }
        } else {
          parseBreadthResult(output, `${source}.${stageName}.output`);
        }
      } else {
        const payload = parseReviewPayload(output, `${source}.${stageName}.output`);
        if (!isDeepStrictEqual(payload.findings, resultFindings)) {
          throw new Error(`${source}.${stageName}.output findings do not match the result findings`);
        }
      }
    }
    if (engine === "codex") {
      const malformedEventLines = nonNegativeSafeInteger(
        stage.malformedEventLines,
        `${source}.${stageName}.malformedEventLines`,
      );
      if (usage.aggregation === "single-snapshot" && malformedEventLines !== 0) {
        throw new Error(
          `${source}.${stageName}.malformedEventLines must be zero for single-snapshot usage`,
        );
      }
      if (malformedEventLines > 0) {
        const observedBeyondPrompt = USAGE_METRICS.some((metric) =>
          metric !== "promptBytes" && usage[metric] !== undefined);
        if (usage.aggregation !== "ambiguous" || observedBeyondPrompt ||
          usage.serviceTier !== undefined || usage.costSource !== undefined ||
          usage.pricing !== undefined) {
          throw new Error(
            `${source}.${stageName}.usage must remain ambiguous and unavailable after malformed events`,
          );
        }
      }
    }
    stages[stageName] = {
      stage: stageName,
      model,
      promptSha256,
      usage,
      durationMs: nonNegativeSafeInteger(stage.durationMs, `${source}.${stageName}.durationMs`),
      completed: true,
      ...(breadthLedgerTelemetry ? { breadthLedger: breadthLedgerTelemetry } : {}),
    };
  }
  if (stages.breadth === undefined && stages.investigation === undefined) return undefined;
  if (stages.breadth === undefined || stages.investigation === undefined) {
    throw new Error(`${source} must include both breadth and investigation stage telemetry`);
  }
  boundedNonEmptyString(raw.manifest, `${source}.manifest`, MAX_MANIFEST_CHARS);
  return [stages.breadth, stages.investigation];
}

function parseGradeFields(
  root: Record<string, unknown>,
  findingCount: number,
  source: string,
  allowRootCauseReuse = false,
): Pick<GradedRun, "matches" | "falsePositiveIndexes"> {
  const matchesRaw = object(root.matches, `${source}.matches`);
  const matches: Record<string, number | null> = {};
  const matchedIndexes = new Set<number>();
  for (const [bugId, findingIndex] of Object.entries(matchesRaw)) {
    strictString(bugId, `${source}.matches key`, 500);
    if (findingIndex !== null && !safeInteger(findingIndex, 0)) {
      throw new Error(`${source}.matches.${bugId} must be null or a non-negative safe integer`);
    }
    if (typeof findingIndex === "number" && findingIndex >= findingCount) {
      throw new Error(`${source}.matches.${bugId} references a missing finding`);
    }
    if (!allowRootCauseReuse && typeof findingIndex === "number" && matchedIndexes.has(findingIndex)) {
      throw new Error(`${source}.matches must not reuse a finding index across bug IDs`);
    }
    if (typeof findingIndex === "number") matchedIndexes.add(findingIndex);
    matches[bugId] = findingIndex as number | null;
  }
  if (!Array.isArray(root.falsePositiveIndexes)) {
    throw new Error(`${source}.falsePositiveIndexes must be an array`);
  }
  const falsePositiveIndexes = root.falsePositiveIndexes.map((index, position) => {
    if (!safeInteger(index, 0) || index >= findingCount) {
      throw new Error(`${source}.falsePositiveIndexes[${position}] must reference an existing finding`);
    }
    return index;
  });
  if (new Set(falsePositiveIndexes).size !== falsePositiveIndexes.length) {
    throw new Error(`${source}.falsePositiveIndexes must not contain duplicates`);
  }
  return { matches, falsePositiveIndexes };
}

function parseGradingEvidence(
  value: unknown,
  findingCount: number,
  matches: Readonly<Record<string, number | null>>,
  source: string,
): GradingEvidence {
  const root = object(value, `${source}.grading`);
  onlyKeys(root, new Set(["version", "judge", "decisions", "rootCauseMatches", "missStages", "unmatchedFindings"]), `${source}.grading`);
  if (root.version !== "root-cause-v1") throw new Error(`${source}.grading.version is invalid`);
  const judge = object(root.judge, `${source}.grading.judge`);
  onlyKeys(judge, new Set(["kind", "version", "configSha256"]), `${source}.grading.judge`);
  if (judge.kind !== "exact" && judge.kind !== "claude" && judge.kind !== "codex") throw new Error(`${source}.grading.judge.kind is invalid`);
  const version = strictString(judge.version, `${source}.grading.judge.version`, 100);
  const expectedVersion = judge.kind === "exact" ? "exact-v1" : "semantic-v1";
  if (version !== expectedVersion) throw new Error(`${source}.grading.judge kind/version pairing is invalid`);
  const configSha256 = judge.configSha256 === undefined
    ? undefined
    : strictString(judge.configSha256, `${source}.grading.judge.configSha256`, 64);
  if (configSha256 !== undefined && !/^[a-f0-9]{64}$/.test(configSha256)) {
    throw new Error(`${source}.grading.judge.configSha256 is invalid`);
  }
  if (judge.kind === "exact" ? configSha256 !== undefined : configSha256 === undefined) {
    throw new Error(`${source}.grading.judge.configSha256 must be present only for semantic judges`);
  }
  if (!Array.isArray(root.decisions)) throw new Error(`${source}.grading.decisions must be an array`);
  const decisions = root.decisions.map((value, index) => {
    const item = object(value, `${source}.grading.decisions[${index}]`);
    onlyKeys(item, new Set(["decisionId", "judgeVersion", "judgeConfigSha256", "bugId", "findingIndex", "findingEvidenceSha256", "verdict", "failureKind"]), `${source}.grading.decisions[${index}]`);
    const decisionId = strictString(item.decisionId, `${source}.grading.decisions[${index}].decisionId`, 64);
    const judgeConfigSha256 = strictString(item.judgeConfigSha256, `${source}.grading.decisions[${index}].judgeConfigSha256`, 64);
    const findingEvidenceSha256 = strictString(item.findingEvidenceSha256, `${source}.grading.decisions[${index}].findingEvidenceSha256`, 64);
    if (!/^[a-f0-9]{64}$/.test(decisionId) || !/^[a-f0-9]{64}$/.test(judgeConfigSha256) || !/^[a-f0-9]{64}$/.test(findingEvidenceSha256)) throw new Error(`${source}.grading.decisions[${index}] has an invalid digest`);
    const findingIndex = nonNegativeSafeInteger(item.findingIndex, `${source}.grading.decisions[${index}].findingIndex`);
    if (findingIndex >= findingCount) throw new Error(`${source}.grading.decisions[${index}].findingIndex references a missing finding`);
    if (item.judgeVersion !== "semantic-v1") throw new Error(`${source}.grading.decisions[${index}].judgeVersion is invalid`);
    if (item.verdict !== "same-root-cause" && item.verdict !== "different-root-cause" && item.verdict !== "failed") throw new Error(`${source}.grading.decisions[${index}].verdict is invalid`);
    const failureKind = item.failureKind;
    if (item.verdict === "failed") {
      if (failureKind !== "timeout" && failureKind !== "provider" && failureKind !== "parse" && failureKind !== "configuration" && failureKind !== "unknown") throw new Error(`${source}.grading.decisions[${index}].failureKind is required`);
    } else if (failureKind !== undefined) throw new Error(`${source}.grading.decisions[${index}].failureKind is only valid for failed decisions`);
    return { decisionId, judgeVersion: "semantic-v1" as const, judgeConfigSha256, bugId: strictString(item.bugId, `${source}.grading.decisions[${index}].bugId`, 500), findingIndex, findingEvidenceSha256, verdict: item.verdict, ...(failureKind ? { failureKind } : {}) } as GradingEvidence["decisions"][number];
  });
  const rootCauseRaw = object(root.rootCauseMatches, `${source}.grading.rootCauseMatches`);
  const rootCauseMatches = Object.fromEntries(Object.entries(rootCauseRaw).map(([key, matched]) => {
    strictString(key, `${source}.grading.rootCauseMatches key`, 500);
    if (typeof matched !== "boolean") throw new Error(`${source}.grading.rootCauseMatches.${key} must be boolean`);
    return [key, matched];
  }));
  const missRaw = object(root.missStages, `${source}.grading.missStages`);
  const stages = new Set(["none", "routing", "breadth", "investigation", "budget", "presentation", "infrastructure"]);
  const missStages = Object.fromEntries(Object.entries(missRaw).map(([bugId, stage]) => {
    if (!(bugId in matches) || !stages.has(String(stage))) throw new Error(`${source}.grading.missStages.${bugId} is invalid`);
    return [bugId, stage];
  })) as GradingEvidence["missStages"];
  if (Object.keys(matches).some((bugId) => !(bugId in missStages))) throw new Error(`${source}.grading.missStages must cover every bug`);
  if (!Array.isArray(root.unmatchedFindings)) throw new Error(`${source}.grading.unmatchedFindings must be an array`);
  const seen = new Set<number>();
  const unmatchedFindings = root.unmatchedFindings.map((value, index) => {
    const item = object(value, `${source}.grading.unmatchedFindings[${index}]`);
    onlyKeys(item, new Set(["findingIndex", "findingEvidenceSha256", "classification"]), `${source}.grading.unmatchedFindings[${index}]`);
    const findingIndex = nonNegativeSafeInteger(item.findingIndex, `${source}.grading.unmatchedFindings[${index}].findingIndex`);
    if (findingIndex >= findingCount || seen.has(findingIndex)) throw new Error(`${source}.grading.unmatchedFindings[${index}] references a missing or duplicate finding`);
    seen.add(findingIndex);
    const findingEvidenceSha256 = strictString(item.findingEvidenceSha256, `${source}.grading.unmatchedFindings[${index}].findingEvidenceSha256`, 64);
    if (!/^[a-f0-9]{64}$/.test(findingEvidenceSha256)) throw new Error(`${source}.grading.unmatchedFindings[${index}] has an invalid digest`);
    if (item.classification !== "confirmed-new" && item.classification !== "unsupported" && item.classification !== "unresolved") throw new Error(`${source}.grading.unmatchedFindings[${index}].classification is invalid`);
    return { findingIndex, findingEvidenceSha256, classification: item.classification as GradingEvidence["unmatchedFindings"][number]["classification"] };
  });
  return { version: "root-cause-v1", judge: { kind: judge.kind, version, ...(configSha256 ? { configSha256 } : {}) }, decisions, rootCauseMatches, missStages, unmatchedFindings };
}

function parseOutcome(value: unknown, source: string, strictCurrentUsage: boolean): RunRecord["outcome"] {
  const root = object(value, source);
  if (root.status === "completed") {
    onlyKeys(root, new Set(["status", "result"]), source);
    return { status: "completed", result: parseEngineResult(root.result, `${source}.result`) };
  }
  if (root.status !== "failed") throw new Error(`${source}.status must be completed or failed`);
  onlyKeys(root, new Set([
    "status", "failureKind", "message", "durationMs", "telemetry", "telemetryUnavailableReason",
  ]), source);
  if (!RUN_FAILURE_KINDS.includes(root.failureKind as (typeof RUN_FAILURE_KINDS)[number])) {
    throw new Error(`${source}.failureKind is invalid`);
  }
  const telemetry = root.telemetry === undefined
    ? undefined
    : parseFailureTelemetry(
        root.telemetry,
        `${source}.telemetry`,
        strictCurrentUsage,
        root.failureKind as (typeof RUN_FAILURE_KINDS)[number],
      );
  const telemetryUnavailableReason = root.telemetryUnavailableReason === undefined
    ? undefined
    : failureTelemetryUnavailableReason(
        root.telemetryUnavailableReason,
        `${source}.telemetryUnavailableReason`,
      );
  if (telemetry !== undefined && telemetryUnavailableReason !== undefined) {
    throw new Error(`${source} cannot contain both telemetry and telemetryUnavailableReason`);
  }
  if (!strictCurrentUsage && telemetryUnavailableReason !== undefined) {
    throw new Error(`${source}.telemetryUnavailableReason is not part of the legacy writer`);
  }
  return {
    status: "failed",
    failureKind: root.failureKind as (typeof RUN_FAILURE_KINDS)[number],
    message: boundedNonEmptyString(root.message, `${source}.message`, 4000),
    durationMs: nonNegativeSafeInteger(root.durationMs, `${source}.durationMs`),
    ...(telemetry ? { telemetry } : {}),
    ...(telemetryUnavailableReason ? { telemetryUnavailableReason } : {}),
  };
}

function failureTelemetryUnavailableReason(
  value: unknown,
  source: string,
): FailureTelemetryUnavailableReason {
  if (value !== "not-observed" && value !== "secret-redacted") {
    throw new Error(`${source} is invalid`);
  }
  return value;
}

function parseFailureTelemetry(
  value: unknown,
  source: string,
  strictCurrentUsage: boolean,
  failureKind: (typeof RUN_FAILURE_KINDS)[number],
): RunFailureTelemetry {
  const root = object(value, source);
  onlyKeys(root, new Set([
    "engine",
    "modelConfig",
    "usage",
    "durationMs",
    "stages",
    "containmentCleanupFailed",
  ]), source);
  if (!(root.engine === "claude" || root.engine === "codex" || root.engine === "mock")) {
    throw new Error(`${source}.engine is invalid`);
  }
  if (strictCurrentUsage && root.engine === "mock") {
    throw new Error(`${source} must be absent for the current mock writer`);
  }
  if (!Array.isArray(root.stages) || root.stages.length === 0 || root.stages.length > 2) {
    throw new Error(`${source}.stages must contain one or two stages`);
  }
  const stages = root.stages.map((stage, index) => parseStage(stage, `${source}.stages[${index}]`));
  if (new Set(stages.map((stage) => stage.stage)).size !== stages.length) {
    throw new Error(`${source}.stages must not contain duplicate stage names`);
  }
  const engine = root.engine;
  const modelConfig = strictString(root.modelConfig, `${source}.modelConfig`, 1000);
  const usage = parseUsage(root.usage, `${source}.usage`);
  const validateUsage = strictCurrentUsage ? validateCurrentUsage : validateUsageProvider;
  validateUsage(engine, usage, `${source}.usage`);
  for (const [index, stage] of stages.entries()) {
    validateUsage(engine, stage.usage, `${source}.stages[${index}].usage`);
    if (strictCurrentUsage) {
      validateStageUsageShape(
        engine,
        stage.usage,
        `${source}.stages[${index}].usage`,
        !stage.completed,
      );
      validateCurrentStagePricingModel(
        stage.usage,
        stage.model,
        `${source}.stages[${index}].usage`,
      );
    }
  }
  if (strictCurrentUsage) {
    if (stages[0]?.stage !== "breadth" || (stages.length === 2 && stages[1]?.stage !== "investigation")) {
      throw new Error(`${source}.stages must be breadth followed by optional investigation`);
    }
    if (stages.length === 2 && !stages[0]!.completed) {
      throw new Error(`${source}.stages require completed breadth before investigation`);
    }
    validateFailureStageState(failureKind, stages, root.containmentCleanupFailed, source);
    validateStageModelConfig(modelConfig, stages, source, engine);
    validateAggregateUsageShape(usage, stages, `${source}.usage`);
  }
  const expectedUsage = stages.length === 1
    ? stages[0]!.usage
    : combineUsage(...stages.map((stage) => stage.usage));
  if (!isDeepStrictEqual(withoutUndefined(expectedUsage), withoutUndefined(usage))) {
    throw new Error(`${source}.usage does not match aggregate stage telemetry`);
  }
  const durationMs = nonNegativeSafeInteger(root.durationMs, `${source}.durationMs`);
  if (strictCurrentUsage && durationMs < stageDurationSum(stages, source)) {
    throw new Error(`${source}.durationMs must cover all stage durations`);
  }
  const parsed: RunFailureTelemetry = {
    engine,
    modelConfig,
    usage,
    durationMs,
    stages,
  };
  if (root.containmentCleanupFailed !== undefined) {
    if (root.containmentCleanupFailed !== true) {
      throw new Error(`${source}.containmentCleanupFailed must be true when present`);
    }
    parsed.containmentCleanupFailed = true;
  }
  if (strictCurrentUsage) assertNoSecrets(parsed, `${source} artifact`);
  return parsed;
}

function validateFailureStageState(
  failureKind: (typeof RUN_FAILURE_KINDS)[number],
  stages: StageTelemetry[],
  containmentCleanupFailed: unknown,
  source: string,
): void {
  const final = stages[stages.length - 1]!;
  if (containmentCleanupFailed !== undefined &&
    (containmentCleanupFailed !== true || failureKind !== "configuration" || final.completed)) {
    throw new Error(`${source}.containmentCleanupFailed requires configuration failure with an incomplete final stage`);
  }
  if ((failureKind === "unknown" ||
      (failureKind === "configuration" && containmentCleanupFailed !== true)) &&
    stages.some((stage) => !stage.completed)) {
    throw new Error(`${source} ${failureKind} telemetry may contain only completed stages`);
  }
  if (failureKind === "provider" && final.completed) {
    throw new Error(`${source} provider failure requires an incomplete final stage`);
  }
  if (failureKind === "timeout" && stages.length === 2 && final.completed) {
    throw new Error(`${source} two-stage timeout requires an incomplete investigation stage`);
  }
  if (failureKind === "parse" && stages.length === 1 && final.completed) {
    throw new Error(`${source} one-stage parse failure requires an incomplete breadth stage`);
  }
}

function validateUsageProvider(
  engine: RunRecord["runner"],
  usage: ReturnType<typeof parseUsage>,
  source: string,
): void {
  const expected = engine === "claude" ? "anthropic" : engine === "codex" ? "openai" : "mock";
  if (usage.provider !== undefined && usage.provider !== expected) {
    throw new Error(`${source}.provider does not match ${engine} runner`);
  }
}

function validateCurrentUsage(
  engine: RunRecord["runner"],
  usage: ReturnType<typeof parseUsage>,
  source: string,
): void {
  const expected = engine === "claude" ? "anthropic" : engine === "codex" ? "openai" : "mock";
  if (usage.provider !== expected) {
    throw new Error(`${source}.provider does not match ${engine} runner`);
  }
  if (usage.costUsd !== undefined && usage.costSource === undefined) {
    throw new Error(`${source}.costSource is required when costUsd is present in current telemetry`);
  }
  if (usage.aggregation === undefined) {
    throw new Error(`${source}.aggregation is required in current telemetry`);
  }
  if (usage.promptBytes === undefined) {
    throw new Error(`${source}.promptBytes is required in current telemetry`);
  }
  if (engine === "codex" && usage.costSource === "provider") {
    throw new Error(`${source}.costSource provider was not emitted by the current Codex writer`);
  }
  if (usage.aggregation === "ambiguous") {
    if (usage.serviceTier !== undefined || usage.costUsd !== undefined ||
      usage.costSource !== undefined || usage.pricing !== undefined || usage.malformed !== undefined) {
      throw new Error(`${source} ambiguous provider usage contains fields the current writer cannot emit`);
    }
    if (engine === "claude" && USAGE_METRICS.some((metric) =>
      metric !== "promptBytes" && usage[metric] !== undefined)) {
      throw new Error(`${source} ambiguous Claude usage must contain only prompt byte telemetry`);
    }
  }
  const expectedUnavailable = USAGE_METRICS.filter((metric) => usage[metric] === undefined);
  if (!isDeepStrictEqual(usage.unavailable, expectedUnavailable)) {
    throw new Error(`${source}.unavailable must be the exact complement of observed metrics`);
  }
  const hasToolCalls = usage.toolCalls !== undefined;
  const hasToolCallsByType = usage.toolCallsByType !== undefined;
  if (hasToolCalls !== hasToolCallsByType) {
    throw new Error(`${source}.toolCalls and toolCallsByType must be observed together`);
  }
  if (usage.toolCalls !== undefined && usage.toolCallsByType !== undefined) {
    const typedTotal = Object.values(usage.toolCallsByType).reduce((sum, count) => sum + count, 0);
    if (!Number.isSafeInteger(typedTotal) || typedTotal !== usage.toolCalls) {
      throw new Error(`${source}.toolCalls must equal the sum of toolCallsByType`);
    }
  }
  if (usage.outputTokens !== undefined && usage.reasoningOutputTokens !== undefined &&
    usage.reasoningOutputTokens > usage.outputTokens) {
    throw new Error(`${source}.reasoningOutputTokens cannot exceed outputTokens`);
  }
  validateCurrentTokenDecomposition(usage, source);
}

function validateStageModelConfig(
  modelConfig: string,
  stages: StageTelemetry[],
  source: string,
  engine: RunRecord["runner"],
): void {
  const configured = modelConfig.split("->");
  if (configured.length !== 2) {
    throw new Error(`${source}.modelConfig must identify breadth and investigation models`);
  }
  const configuredModel = (segment: string): { model: string; effort: string } | undefined => {
    const separator = segment.lastIndexOf("/");
    return separator > 0 && separator < segment.length - 1
      ? { model: segment.slice(0, separator), effort: segment.slice(separator + 1) }
      : undefined;
  };
  const breadth = configuredModel(configured[0]!);
  const investigation = configuredModel(configured[1]!);
  if (!breadth || !investigation) {
    throw new Error(`${source}.modelConfig must identify breadth and investigation models`);
  }
  const efforts = engine === "codex"
    ? new Set(["low", "medium", "high", "xhigh", "max", "ultra"])
    : new Set(["low", "medium", "high", "xhigh", "max"]);
  if (!efforts.has(breadth.effort) || !efforts.has(investigation.effort)) {
    throw new Error(`${source}.modelConfig contains an invalid ${engine} reasoning effort`);
  }
  for (const stage of stages) {
    const expected = stage.stage === "breadth" ? breadth.model : investigation.model;
    if (stage.model !== expected) {
      throw new Error(`${source}.modelConfig does not match the ${stage.stage} stage model`);
    }
  }
}

function stageDurationSum(stages: StageTelemetry[], source: string): number {
  const total = stages.reduce((sum, stage) => sum + stage.durationMs, 0);
  if (!Number.isSafeInteger(total)) throw new Error(`${source} stage duration sum is not safely representable`);
  return total;
}

function validateCurrentTokenDecomposition(
  usage: ReturnType<typeof parseUsage>,
  source: string,
): void {
  if (usage.provider === "anthropic") {
    requireMatchingPresence(
      usage.uncachedInputTokens,
      usage.baseInputTokens,
      `${source}.uncachedInputTokens and baseInputTokens must be observed together`,
    );
    const hasCacheParts = usage.cacheWriteInputTokens !== undefined && usage.cacheReadInputTokens !== undefined;
    if ((usage.cachedInputTokens !== undefined) !== hasCacheParts) {
      throw new Error(`${source}.cachedInputTokens requires both cache input components and vice versa`);
    }
    const hasAllInputParts = usage.baseInputTokens !== undefined && hasCacheParts;
    if ((usage.inputTokens !== undefined) !== hasAllInputParts) {
      throw new Error(`${source}.inputTokens requires all Anthropic input components and vice versa`);
    }
    requireUsageSum(
      usage.inputTokens,
      [usage.baseInputTokens, usage.cacheWriteInputTokens, usage.cacheReadInputTokens],
      `${source}.inputTokens must equal baseInputTokens + cacheWriteInputTokens + cacheReadInputTokens`,
    );
    requireUsageSum(
      usage.cachedInputTokens,
      [usage.cacheWriteInputTokens, usage.cacheReadInputTokens],
      `${source}.cachedInputTokens must equal cacheWriteInputTokens + cacheReadInputTokens`,
    );
    requireUsageEquality(
      usage.uncachedInputTokens,
      usage.baseInputTokens,
      `${source}.uncachedInputTokens must equal baseInputTokens`,
    );
  } else if (usage.provider === "openai") {
    if (usage.baseInputTokens !== undefined || usage.cacheWriteInputTokens !== undefined) {
      throw new Error(`${source} cannot report Anthropic-only token classes for OpenAI`);
    }
    if (usage.aggregation === "ambiguous") {
      if ([
        usage.inputTokens,
        usage.uncachedInputTokens,
        usage.cachedInputTokens,
        usage.cacheReadInputTokens,
        usage.outputTokens,
        usage.reasoningOutputTokens,
      ].some((value) => value !== undefined)) {
        throw new Error(`${source} ambiguous OpenAI usage cannot expose token totals`);
      }
    } else {
      requireMatchingPresence(
        usage.cachedInputTokens,
        usage.cacheReadInputTokens,
        `${source}.cachedInputTokens and cacheReadInputTokens must be observed together`,
      );
      const canDeriveUncached = usage.inputTokens !== undefined &&
        usage.cacheReadInputTokens !== undefined;
      if ((usage.uncachedInputTokens !== undefined) !== canDeriveUncached) {
        throw new Error(
          `${source}.uncachedInputTokens must be present exactly when input and cache-read tokens are known`,
        );
      }
    }
    requireUsageSum(
      usage.inputTokens,
      [usage.uncachedInputTokens, usage.cacheReadInputTokens],
      `${source}.inputTokens must equal uncachedInputTokens + cacheReadInputTokens`,
    );
    requireUsageEquality(
      usage.cachedInputTokens,
      usage.cacheReadInputTokens,
      `${source}.cachedInputTokens must equal cacheReadInputTokens`,
    );
  }
}

function requireMatchingPresence(
  left: number | undefined,
  right: number | undefined,
  message: string,
): void {
  if ((left !== undefined) !== (right !== undefined)) throw new Error(message);
}

function requireUsageSum(
  actual: number | undefined,
  components: Array<number | undefined>,
  message: string,
): void {
  if (actual === undefined || components.some((value) => value === undefined)) return;
  if (components.reduce<number>((sum, value) => sum + value!, 0) !== actual) throw new Error(message);
}

function requireUsageEquality(
  left: number | undefined,
  right: number | undefined,
  message: string,
): void {
  if (left !== undefined && right !== undefined && left !== right) throw new Error(message);
}

function validateCurrentStagePricingModel(
  usage: ReturnType<typeof parseUsage>,
  model: string,
  source: string,
): void {
  if (usage.costSource === "estimated") {
    if (usage.pricing?.contractModel !== model) {
      throw new Error(`${source}.pricing.contractModel must match the stage model`);
    }
    if ((usage.serviceTier === undefined) !== (usage.pricing.serviceTier === undefined) ||
      usage.serviceTier !== usage.pricing.serviceTier) {
      throw new Error(`${source}.serviceTier must match stage pricing provenance`);
    }
  }
}

function validateStageUsageShape(
  engine: RunRecord["runner"],
  usage: ReturnType<typeof parseUsage>,
  source: string,
  failureStage: boolean,
): void {
  const valid = engine === "claude"
    ? usage.aggregation === "single-envelope" ||
      (failureStage && usage.aggregation === "ambiguous")
    : engine === "codex"
      ? usage.aggregation === "single-snapshot" || usage.aggregation === "ambiguous"
      : usage.aggregation === "single-envelope";
  if (!valid) throw new Error(`${source}.aggregation does not match a provider stage`);
}

function validateAggregateUsageShape(
  usage: ReturnType<typeof parseUsage>,
  stages: StageTelemetry[],
  source: string,
): void {
  const expected = stages.length === 1 ? stages[0]!.usage.aggregation : "stage-sum";
  if (usage.aggregation !== expected) {
    throw new Error(`${source}.aggregation does not match the stage aggregate`);
  }
}

function parseStage(value: unknown, source: string): StageTelemetry {
  const root = object(value, source);
  onlyKeys(root, new Set([
    "stage",
    "model",
    "promptSha256",
    "usage",
    "durationMs",
    "completed",
    "breadthLedgerEvidence",
  ]), source);
  if (!(root.stage === "breadth" || root.stage === "investigation")) throw new Error(`${source}.stage is invalid`);
  if (root.stage === "investigation" && root.breadthLedgerEvidence !== undefined) {
    throw new Error(`${source}.breadthLedgerEvidence is valid only for the breadth stage`);
  }
  const promptSha256 = strictString(root.promptSha256, `${source}.promptSha256`, 64);
  if (!/^[a-f0-9]{64}$/.test(promptSha256)) throw new Error(`${source}.promptSha256 must be lowercase SHA-256 hex`);
  if (typeof root.completed !== "boolean") throw new Error(`${source}.completed must be boolean`);
  const breadthLedgerEvidence = root.breadthLedgerEvidence === undefined
    ? undefined
    : parseBreadthLedgerEvidence(root.breadthLedgerEvidence, `${source}.breadthLedgerEvidence`);
  return {
    stage: root.stage,
    model: strictString(root.model, `${source}.model`, 500),
    promptSha256,
    usage: parseUsage(root.usage, `${source}.usage`),
    durationMs: nonNegativeSafeInteger(root.durationMs, `${source}.durationMs`),
    completed: root.completed,
    ...(breadthLedgerEvidence === undefined
      ? {}
      : {
          breadthLedger: breadthLedgerEvidence.telemetry,
          breadthLedgerEvidence,
        }),
  };
}

function assertAttemptIdentity(record: RunRecord, expected: RunAttempt, source: string): void {
  const pairs: Array<[string, unknown, unknown]> = [
    ["attemptId", record.attemptId, expected.id],
    ["caseName", record.caseName, expected.caseName],
    ["configName", record.configName, expected.configName],
    ["repeat", record.repeat, expected.repeat],
    ["caseCorpus", record.caseCorpus, expected.corpus],
    ["runner", record.runner, expected.runner],
  ];
  for (const [field, actual, wanted] of pairs) {
    if (actual !== wanted) throw new Error(`${source}.${field} does not match matrix manifest`);
  }
}

function assertLegacyAttemptIdentity(
  record: LegacySchemaV1RunRecord,
  expected: LegacyRunAttempt,
  source: string,
): void {
  for (const [field, actual, wanted] of [
    ["attemptId", record.attemptId, expected.id],
    ["caseName", record.caseName, expected.caseName],
    ["configName", record.configName, expected.configName],
    ["repeat", record.repeat, expected.repeat],
  ] as const) {
    if (actual !== wanted) throw new Error(`${source}.${field} does not match legacy matrix manifest`);
  }
}

function assertPreTelemetryAttemptIdentity(
  record: PreTelemetryRunRecord,
  expected: PreTelemetryRunAttempt,
  source: string,
): void {
  for (const [field, actual, wanted] of [
    ["attemptId", record.attemptId, expected.id],
    ["caseName", record.caseName, expected.caseName],
    ["configName", record.configName, expected.configName],
    ["repeat", record.repeat, expected.repeat],
    ["caseCorpus", record.caseCorpus, expected.corpus],
  ] as const) {
    if (actual !== wanted) throw new Error(`${source}.${field} does not match pre-telemetry matrix manifest`);
  }
}

function runner(value: unknown, source: string): RunRecord["runner"] {
  if (!(value === "claude" || value === "codex" || value === "mock")) throw new Error(`${source} is invalid`);
  return value;
}

function object(value: unknown, source: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be an object`);
  return value as Record<string, unknown>;
}

function withoutUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, withoutUndefined(child)]),
  );
}

function onlyKeys(value: Record<string, unknown>, allowed: Set<string>, source: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) throw new Error(`${source}: unexpected field(s): ${unexpected.join(", ")}`);
}

function sameKeys(value: Record<string, unknown>, expected: Set<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function strictString(value: unknown, source: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > max) {
    throw new Error(`${source} must be a trimmed non-empty string of at most ${max} characters`);
  }
  return value;
}

function safeRelativeCaseName(value: unknown, source: string): string {
  const name = strictString(value, source, 500);
  const segments = name.split("/");
  if (name.startsWith("/") || name.includes("\\") || name.includes("\0") || /^[a-z]:/i.test(name) ||
    segments.some((segment) =>
      segment.length === 0 || segment === "." || segment === ".." || segment.toLowerCase() === ".git")) {
    throw new Error(`${source} must be a safe cases-relative path`);
  }
  return name;
}

function assertCorpusCaseName(name: string, expectedCorpus: CaseCorpus, source: string): void {
  const prefix = `${expectedCorpus}/`;
  if (!name.startsWith(prefix) || name.slice(prefix.length).includes("/")) {
    throw new Error(`${source} must be nested directly under its corpus`);
  }
  assertOpaqueCaseId(name.slice(prefix.length), `${source} basename`);
}

function boundedNonEmptyString(value: unknown, source: string, max: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max || value.includes("\0")) {
    throw new Error(`${source} must be non-empty text of at most ${max} characters without NUL bytes`);
  }
  return value;
}

function boundedText(value: unknown, source: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || value.includes("\0")) {
    throw new Error(`${source} must be non-empty text of at most ${max} characters without NUL bytes`);
  }
  return value;
}

function sha256Hex(value: unknown, source: string): string {
  const text = strictString(value, source, 64);
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${source} must be lowercase SHA-256 hex`);
  return text;
}

function gitObjectId(
  value: unknown,
  objectFormat: EvaluationHistoryProvenance["objectFormat"],
  source: string,
): string {
  const length = objectFormat === "sha1" ? 40 : 64;
  const text = strictString(value, source, length);
  if (!new RegExp(`^[a-f0-9]{${length}}$`).test(text)) {
    throw new Error(`${source} must be a full lowercase ${objectFormat} object ID`);
  }
  return text;
}

function requireTrue(value: unknown, source: string): void {
  if (value !== true) throw new Error(`${source} must be true`);
}

function isoDate(value: unknown, source: string): string {
  const text = strictString(value, source, 40);
  const time = Date.parse(text);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== text) throw new Error(`${source} must be canonical ISO-8601 UTC`);
  return text;
}

function safeInteger(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function positiveSafeInteger(value: unknown, source: string): number {
  if (!safeInteger(value, 1)) throw new Error(`${source} must be a positive safe integer`);
  return value;
}

function nonNegativeSafeInteger(value: unknown, source: string): number {
  if (!safeInteger(value, 0)) throw new Error(`${source} must be a non-negative safe integer`);
  return value;
}

function corpus(value: unknown, source: string): CaseCorpus | "unknown" {
  if (value === "unknown") return value;
  if (!CASE_CORPORA.includes(value as CaseCorpus)) throw new Error(`${source} is invalid`);
  return value as CaseCorpus;
}

function parseNetworkIsolation(
  value: unknown,
  source: string,
): Partial<Record<RunRecord["runner"], NetworkIsolationCapability>> {
  const root = object(value, source);
  onlyKeys(root, new Set(["claude", "codex", "mock"]), source);
  const parsed: Partial<Record<RunRecord["runner"], NetworkIsolationCapability>> = {};
  for (const [name, capability] of Object.entries(root)) {
    const runnerName = runner(name, `${source} key`);
    const entry = object(capability, `${source}.${name}`);
    onlyKeys(entry, new Set(["status", "mechanism"]), `${source}.${name}`);
    if (!(entry.status === "enforced" || entry.status === "limited" ||
      entry.status === "unavailable" || entry.status === "not-applicable")) {
      throw new Error(`${source}.${name}.status is invalid`);
    }
    parsed[runnerName] = {
      status: entry.status,
      mechanism: strictString(entry.mechanism, `${source}.${name}.mechanism`, 1000),
    };
  }
  return parsed;
}

function validateCurrentNetworkIsolation(
  attempts: RunAttempt[],
  capabilities: Partial<Record<RunRecord["runner"], NetworkIsolationCapability>>,
  source: string,
): void {
  const expectedRunners = new Set(attempts.map((attempt) => attempt.runner));
  for (const runnerName of expectedRunners) {
    if (capabilities[runnerName] === undefined) {
      throw new Error(`${source}.providerNetworkIsolation is missing ${runnerName}`);
    }
  }
  if (attempts.length > 0) {
    for (const runnerName of Object.keys(capabilities) as RunRecord["runner"][]) {
      if (!expectedRunners.has(runnerName)) {
        throw new Error(`${source}.providerNetworkIsolation has undeclared ${runnerName}`);
      }
    }
  }
  for (const [runnerName, capability] of Object.entries(capabilities) as Array<
    [RunRecord["runner"], NetworkIsolationCapability]
  >) {
    if (!isDeepStrictEqual(capability, SCHEMA_V1_NETWORK_ISOLATION[runnerName])) {
      throw new Error(
        `${source}.providerNetworkIsolation.${runnerName} does not match the runner capability`,
      );
    }
  }
}

function validateContainedNetworkIsolation(
  attempts: RunAttempt[],
  capabilities: Partial<Record<RunRecord["runner"], NetworkIsolationCapability>>,
  source: string,
): void {
  validateCapabilityCoverage(attempts, capabilities, `${source}.providerNetworkIsolation`);
  for (const [runner, capability] of Object.entries(capabilities) as Array<[RunRecord["runner"], NetworkIsolationCapability]>) {
    const expected = runner === "mock" ? "not-applicable" : "limited";
    if (capability.status !== expected) throw new Error(`${source}.providerNetworkIsolation.${runner} must be ${expected}`);
  }
}

function validateFilesystemIsolation(
  attempts: RunAttempt[],
  capabilities: Partial<Record<RunRecord["runner"], NetworkIsolationCapability>>,
  source: string,
): void {
  validateCapabilityCoverage(attempts, capabilities, `${source}.providerFilesystemIsolation`);
  for (const [runner, capability] of Object.entries(capabilities) as Array<[RunRecord["runner"], NetworkIsolationCapability]>) {
    const expected = runner === "mock" ? "not-applicable" : "enforced";
    if (capability.status !== expected) throw new Error(`${source}.providerFilesystemIsolation.${runner} must be ${expected}`);
  }
}

function validateCapabilityCoverage(
  attempts: RunAttempt[],
  capabilities: Partial<Record<RunRecord["runner"], NetworkIsolationCapability>>,
  field: string,
): void {
  const expected = new Set(attempts.map((attempt) => attempt.runner));
  for (const runner of expected) if (!capabilities[runner]) throw new Error(`${field} is missing ${runner}`);
  if (attempts.length > 0) {
    for (const runner of Object.keys(capabilities) as RunRecord["runner"][]) {
      if (!expected.has(runner)) throw new Error(`${field} has undeclared ${runner}`);
    }
  }
}

function caseKind(value: unknown, source: string): RunRecord["caseKind"] {
  if (!(value === "seeded" || value === "historical" || value === "clean" || value === "unknown")) {
    throw new Error(`${source} is invalid`);
  }
  return value;
}
