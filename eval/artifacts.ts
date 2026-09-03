import { isDeepStrictEqual } from "node:util";
import { MAX_MANIFEST_CHARS } from "../src/core/manifest.js";
import { parseEngineResult } from "../src/core/review-result.js";
import { RUN_FAILURE_KINDS } from "../src/core/run-failure.js";
import { combineUsage, parseUsage, sha256 } from "../src/core/telemetry.js";
import {
  CASE_CORPORA,
  type CaseCorpus,
  type EvaluationAttemptProvenance,
  type EvaluationHistoryProvenance,
  type EvaluationManifestProvenance,
  type GradedRun,
  type MatrixRunManifest,
  type NetworkIsolationCapability,
  type RunAttempt,
  type RunFailureTelemetry,
  type RunRecord,
  type StageTelemetry,
} from "../src/types.js";

const RECORD_KEYS = new Set([
  "schemaVersion", "attemptId", "caseName", "caseKind", "configName", "repeat",
  "caseCorpus", "startedAt", "finishedAt", "outcome",
  "runner", "evaluationProvenance",
]);
const GRADED_KEYS = new Set([...RECORD_KEYS, "matches", "falsePositiveIndexes"]);
const LEGACY_SCHEMA_V1_RECORD_KEYS = new Set([...RECORD_KEYS].filter((key) => key !== "caseCorpus" && key !== "runner"));
const LEGACY_SCHEMA_V1_GRADED_KEYS = new Set([...LEGACY_SCHEMA_V1_RECORD_KEYS, "matches", "falsePositiveIndexes"]);

export type LegacyRunAttempt = Omit<RunAttempt, "corpus" | "expectedBugCount" | "runner">;
export interface LegacyMatrixRunManifest {
  schemaVersion: 1;
  createdAt: string;
  expectedAttempts: LegacyRunAttempt[];
}
export type LegacySchemaV1RunRecord = Omit<RunRecord, "caseCorpus" | "runner">;
export type LegacySchemaV1GradedRun = Omit<GradedRun, "caseCorpus" | "runner">;

export function parseMatrixRunManifest(value: unknown, source = "matrix manifest"): MatrixRunManifest {
  const root = object(value, source);
  onlyKeys(root, new Set(["schemaVersion", "createdAt", "expectedAttempts", "providerNetworkIsolation"]), source);
  if (root.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  const createdAt = isoDate(root.createdAt, `${source}.createdAt`);
  if (!Array.isArray(root.expectedAttempts)) throw new Error(`${source}.expectedAttempts must be an array`);
  const expectedAttempts = root.expectedAttempts.map((attempt, index) =>
    parseAttempt(attempt, `${source}.expectedAttempts[${index}]`));
  assertUniqueAttempts(expectedAttempts, source);
  const providerNetworkIsolation = parseNetworkIsolation(
    root.providerNetworkIsolation,
    `${source}.providerNetworkIsolation`,
  );
  return { schemaVersion: 1, createdAt, expectedAttempts, providerNetworkIsolation };
}

/**
 * P1 emitted schema-v1 manifests before corpus and runner were added. The
 * version could not distinguish those artifacts, so recognize only the exact
 * old attempt shape and keep its reports explicitly legacy/incomplete.
 */
export function isLegacyMatrixRunManifest(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const attempts = (value as Record<string, unknown>).expectedAttempts;
  return Array.isArray(attempts) && attempts.every((attempt) =>
    !!attempt && typeof attempt === "object" && !Array.isArray(attempt) &&
    !("corpus" in attempt) && !("runner" in attempt));
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
  const { matches, falsePositiveIndexes } = parseGradeFields(root, completed.result.findings.length, source);
  return { ...record, outcome: record.outcome, matches, falsePositiveIndexes };
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

export function assertGradedMatchesRun(graded: GradedRun, run: RunRecord, source: string): void {
  if (run.outcome.status !== "completed") throw new Error(`${source}: graded artifact cannot match a failed run`);
  for (const [field, actual, expected] of [
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
  const expectedFalsePositives = graded.outcome.result.findings
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
    "matches", "falsePositiveIndexes",
  ]), source);
  const result = parseEngineResult(root.result, `${source}.result`);
  const base = {
    caseName: strictString(root.caseName, `${source}.caseName`, 500),
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
  const synthetic = {
    schemaVersion: 1,
    attemptId: `legacy--${base.configName}--${base.caseName}--${base.repeat}`,
    caseName: base.caseName,
    caseKind: base.caseKind,
    configName: base.configName,
    repeat: base.repeat,
    caseCorpus: "unknown" as const,
    runner: result.engine,
    startedAt: base.startedAt,
    finishedAt: base.startedAt,
    outcome: { status: "completed" as const, result },
    matches: root.matches,
    falsePositiveIndexes: root.falsePositiveIndexes,
  };
  const parsed = parseGradedRun(synthetic, source);
  return { ...base, matches: parsed.matches, falsePositiveIndexes: parsed.falsePositiveIndexes };
}

function parseAttempt(value: unknown, source: string): RunAttempt {
  const root = object(value, source);
  onlyKeys(root, new Set(["id", "caseName", "configName", "repeat", "file", "corpus", "expectedBugCount", "runner"]), source);
  const id = strictString(root.id, `${source}.id`, 200);
  if (!/^attempt-[a-z0-9-]+$/i.test(id)) throw new Error(`${source}.id is not a safe attempt id`);
  const file = strictString(root.file, `${source}.file`, 240);
  if (file !== `${id}.json`) throw new Error(`${source}.file must equal ${id}.json`);
  return {
    id,
    caseName: strictString(root.caseName, `${source}.caseName`, 500),
    configName: strictString(root.configName, `${source}.configName`, 500),
    repeat: positiveSafeInteger(root.repeat, `${source}.repeat`),
    file,
    corpus: corpus(root.corpus, `${source}.corpus`),
    expectedBugCount: root.expectedBugCount === null
      ? null
      : nonNegativeSafeInteger(root.expectedBugCount, `${source}.expectedBugCount`),
    runner: runner(root.runner, `${source}.runner`),
  };
}

function parseLegacyAttempt(value: unknown, source: string): LegacyRunAttempt {
  const root = object(value, source);
  onlyKeys(root, new Set(["id", "caseName", "configName", "repeat", "file"]), source);
  const id = strictString(root.id, `${source}.id`, 200);
  if (!/^attempt-[a-z0-9-]+$/i.test(id)) throw new Error(`${source}.id is not a safe attempt id`);
  const file = strictString(root.file, `${source}.file`, 240);
  if (file !== `${id}.json`) throw new Error(`${source}.file must equal ${id}.json`);
  return {
    id,
    caseName: strictString(root.caseName, `${source}.caseName`, 500),
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

function parseRecordFields(root: Record<string, unknown>, source: string): RunRecord {
  if (root.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  const outcome = parseOutcome(root.outcome, `${source}.outcome`);
  if (outcome.status === "completed") {
    validateUsageProvider(outcome.result.engine, outcome.result.usage, `${source}.outcome.result.usage`);
    const stageUsage = validateEngineStageTelemetry(
      outcome.result.raw,
      `${source}.outcome.result.raw`,
      outcome.result.engine,
    );
    if (stageUsage && !isDeepStrictEqual(
      withoutUndefined(combineUsage(...stageUsage)),
      withoutUndefined(outcome.result.usage),
    )) {
      throw new Error(`${source}.outcome.result.usage does not match aggregate stage telemetry`);
    }
  }
  const parsedRunner = runner(root.runner, `${source}.runner`);
  if (outcome.status === "completed" && outcome.result.engine !== parsedRunner) {
    throw new Error(`${source}.outcome.result.engine does not match runner`);
  }
  if (outcome.status === "failed" && outcome.telemetry && outcome.telemetry.engine !== parsedRunner) {
    throw new Error(`${source}.outcome.telemetry.engine does not match runner`);
  }
  const startedAt = isoDate(root.startedAt, `${source}.startedAt`);
  const finishedAt = isoDate(root.finishedAt, `${source}.finishedAt`);
  if (Date.parse(finishedAt) < Date.parse(startedAt)) {
    throw new Error(`${source}.finishedAt must not precede startedAt`);
  }
  const evaluationProvenance = root.evaluationProvenance === undefined
    ? undefined
    : parseEvaluationProvenance(root.evaluationProvenance, `${source}.evaluationProvenance`);
  return {
    schemaVersion: 1,
    attemptId: strictString(root.attemptId, `${source}.attemptId`, 200),
    caseName: strictString(root.caseName, `${source}.caseName`, 500),
    caseKind: caseKind(root.caseKind, `${source}.caseKind`),
    configName: strictString(root.configName, `${source}.configName`, 500),
    repeat: positiveSafeInteger(root.repeat, `${source}.repeat`),
    caseCorpus: corpus(root.caseCorpus, `${source}.caseCorpus`),
    runner: parsedRunner,
    startedAt,
    finishedAt,
    ...(evaluationProvenance ? { evaluationProvenance } : {}),
    outcome,
  };
}

function parseLegacySchemaV1RecordFields(
  root: Record<string, unknown>,
  source: string,
): LegacySchemaV1RunRecord {
  if (root.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  const outcome = parseOutcome(root.outcome, `${source}.outcome`);
  if (outcome.status === "completed") {
    validateUsageProvider(outcome.result.engine, outcome.result.usage, `${source}.outcome.result.usage`);
  }
  const startedAt = isoDate(root.startedAt, `${source}.startedAt`);
  const finishedAt = isoDate(root.finishedAt, `${source}.finishedAt`);
  if (Date.parse(finishedAt) < Date.parse(startedAt)) {
    throw new Error(`${source}.finishedAt must not precede startedAt`);
  }
  const evaluationProvenance = root.evaluationProvenance === undefined
    ? undefined
    : parseEvaluationProvenance(root.evaluationProvenance, `${source}.evaluationProvenance`);
  return {
    schemaVersion: 1,
    attemptId: strictString(root.attemptId, `${source}.attemptId`, 200),
    caseName: strictString(root.caseName, `${source}.caseName`, 500),
    caseKind: caseKind(root.caseKind, `${source}.caseKind`),
    configName: strictString(root.configName, `${source}.configName`, 500),
    repeat: positiveSafeInteger(root.repeat, `${source}.repeat`),
    startedAt,
    finishedAt,
    ...(evaluationProvenance ? { evaluationProvenance } : {}),
    outcome,
  };
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
  return {
    schemaVersion: 1,
    materialization: root.materialization,
    objectFormat,
    baseRef,
    headRef,
    mergeBase,
    baseTree: gitObjectId(root.baseTree, objectFormat, `${source}.baseTree`),
    headTree: gitObjectId(root.headTree, objectFormat, `${source}.headTree`),
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
  const sourceMergeBase = gitObjectId(root.sourceMergeBase, objectFormat, `${source}.sourceMergeBase`);
  if (sourceMergeBase !== sourceBaseRef) {
    throw new Error(`${source}.sourceMergeBase must equal sourceBaseRef`);
  }
  requireTrue(root.baseCommitIsMergeBase, `${source}.baseCommitIsMergeBase`);
  requireTrue(root.baseTreeMatches, `${source}.baseTreeMatches`);
  requireTrue(root.headTreeMatches, `${source}.headTreeMatches`);
  return {
    sourceIdentitySha256: sha256Hex(root.sourceIdentitySha256, `${source}.sourceIdentitySha256`),
    sourceBaseRef,
    sourceHeadRef: gitObjectId(root.sourceHeadRef, objectFormat, `${source}.sourceHeadRef`),
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
    "output", "profileSource", "headProfileChanged",
  ]), source);
  if (root.entryPoint !== "prepareReviewManifest") {
    throw new Error(`${source}.entryPoint must be prepareReviewManifest`);
  }
  const output = boundedText(root.output, `${source}.output`, MAX_MANIFEST_CHARS);
  const outputSha256 = sha256Hex(root.outputSha256, `${source}.outputSha256`);
  if (outputSha256 !== sha256(output)) throw new Error(`${source}.outputSha256 does not match output`);
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
    if (lines.filter((line) => line === expected).length !== 1) {
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
): ReturnType<typeof parseUsage>[] | undefined {
  if (value === undefined) return undefined;
  const raw = object(value, source);
  const usages: Partial<Record<"breadth" | "investigation", ReturnType<typeof parseUsage>>> = {};
  for (const stageName of ["breadth", "investigation"] as const) {
    if (raw[stageName] === undefined) continue;
    const stage = object(raw[stageName], `${source}.${stageName}`);
    if (stage.durationMs === undefined || stage.usage === undefined ||
      stage.model === undefined || stage.promptSha256 === undefined) {
      throw new Error(`${source}.${stageName} must include model, promptSha256, durationMs, and usage`);
    }
    nonNegativeSafeInteger(stage.durationMs, `${source}.${stageName}.durationMs`);
    const usage = parseUsage(stage.usage, `${source}.${stageName}.usage`);
    validateUsageProvider(engine, usage, `${source}.${stageName}.usage`);
    usages[stageName] = usage;
    strictString(stage.model, `${source}.${stageName}.model`, 500);
    const promptSha256 = strictString(stage.promptSha256, `${source}.${stageName}.promptSha256`, 64);
    if (!/^[a-f0-9]{64}$/.test(promptSha256)) {
      throw new Error(`${source}.${stageName}.promptSha256 must be lowercase SHA-256 hex`);
    }
  }
  if (usages.breadth === undefined && usages.investigation === undefined) return undefined;
  if (usages.breadth === undefined || usages.investigation === undefined) {
    throw new Error(`${source} must include both breadth and investigation stage telemetry`);
  }
  return [usages.breadth, usages.investigation];
}

function parseGradeFields(
  root: Record<string, unknown>,
  findingCount: number,
  source: string,
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
    if (typeof findingIndex === "number" && matchedIndexes.has(findingIndex)) {
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

function parseOutcome(value: unknown, source: string): RunRecord["outcome"] {
  const root = object(value, source);
  if (root.status === "completed") {
    onlyKeys(root, new Set(["status", "result"]), source);
    return { status: "completed", result: parseEngineResult(root.result, `${source}.result`) };
  }
  if (root.status !== "failed") throw new Error(`${source}.status must be completed or failed`);
  onlyKeys(root, new Set(["status", "failureKind", "message", "durationMs", "telemetry"]), source);
  if (!RUN_FAILURE_KINDS.includes(root.failureKind as (typeof RUN_FAILURE_KINDS)[number])) {
    throw new Error(`${source}.failureKind is invalid`);
  }
  return {
    status: "failed",
    failureKind: root.failureKind as (typeof RUN_FAILURE_KINDS)[number],
    message: strictString(root.message, `${source}.message`, 4000),
    durationMs: nonNegativeSafeInteger(root.durationMs, `${source}.durationMs`),
    telemetry: root.telemetry === undefined ? undefined : parseFailureTelemetry(root.telemetry, `${source}.telemetry`),
  };
}

function parseFailureTelemetry(value: unknown, source: string): RunFailureTelemetry {
  const root = object(value, source);
  onlyKeys(root, new Set(["engine", "modelConfig", "usage", "durationMs", "stages"]), source);
  if (!(root.engine === "claude" || root.engine === "codex" || root.engine === "mock")) {
    throw new Error(`${source}.engine is invalid`);
  }
  if (!Array.isArray(root.stages) || root.stages.length === 0 || root.stages.length > 2) {
    throw new Error(`${source}.stages must contain one or two stages`);
  }
  const stages = root.stages.map((stage, index) => parseStage(stage, `${source}.stages[${index}]`));
  if (new Set(stages.map((stage) => stage.stage)).size !== stages.length) {
    throw new Error(`${source}.stages must not contain duplicate stage names`);
  }
  const engine = root.engine;
  const usage = parseUsage(root.usage, `${source}.usage`);
  validateUsageProvider(engine, usage, `${source}.usage`);
  for (const [index, stage] of stages.entries()) {
    validateUsageProvider(engine, stage.usage, `${source}.stages[${index}].usage`);
  }
  const expectedUsage = stages.length === 1
    ? stages[0]!.usage
    : combineUsage(...stages.map((stage) => stage.usage));
  if (!isDeepStrictEqual(withoutUndefined(expectedUsage), withoutUndefined(usage))) {
    throw new Error(`${source}.usage does not match aggregate stage telemetry`);
  }
  return {
    engine,
    modelConfig: strictString(root.modelConfig, `${source}.modelConfig`, 1000),
    usage,
    durationMs: nonNegativeSafeInteger(root.durationMs, `${source}.durationMs`),
    stages,
  };
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

function parseStage(value: unknown, source: string): StageTelemetry {
  const root = object(value, source);
  onlyKeys(root, new Set(["stage", "model", "promptSha256", "usage", "durationMs", "completed"]), source);
  if (!(root.stage === "breadth" || root.stage === "investigation")) throw new Error(`${source}.stage is invalid`);
  const promptSha256 = strictString(root.promptSha256, `${source}.promptSha256`, 64);
  if (!/^[a-f0-9]{64}$/.test(promptSha256)) throw new Error(`${source}.promptSha256 must be lowercase SHA-256 hex`);
  if (typeof root.completed !== "boolean") throw new Error(`${source}.completed must be boolean`);
  return {
    stage: root.stage,
    model: strictString(root.model, `${source}.model`, 500),
    promptSha256,
    usage: parseUsage(root.usage, `${source}.usage`),
    durationMs: nonNegativeSafeInteger(root.durationMs, `${source}.durationMs`),
    completed: root.completed,
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

function strictString(value: unknown, source: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > max) {
    throw new Error(`${source} must be a trimmed non-empty string of at most ${max} characters`);
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

function caseKind(value: unknown, source: string): RunRecord["caseKind"] {
  if (!(value === "seeded" || value === "historical" || value === "clean" || value === "unknown")) {
    throw new Error(`${source} is invalid`);
  }
  return value;
}
