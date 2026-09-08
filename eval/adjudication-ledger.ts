import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { assertNoSecrets } from "../src/security/secrets.js";
import { packageRoot } from "../src/core/paths.js";
import type { GradedRun, UnmatchedFindingClassification } from "../src/types.js";
import { assertGradedMatchesRun, parseGradedRun, parseMatrixRunManifest } from "./artifacts.js";
import { canonicalJson, canonicalJsonSha256, readExperimentJson, writeExclusiveJson } from "./experiment.js";
import { MATRIX_MANIFEST_FILENAME } from "./experiment-evidence.js";
import { requireValidExperimentGradingSeal } from "./experiment-seals.js";

export const EXPERIMENT_ADJUDICATION_FILENAME = "experiment-adjudication.json";
const SHA256 = /^[a-f0-9]{64}$/;
const ATTEMPT_ID = /^attempt-[0-9]{6}$/;
const GIT_OID = /^[a-f0-9]{40}$/;
const SAFE_REPOSITORY_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*[\\:])[^\0\r\n]+$/;

export type FinalAdjudicationClassification = Exclude<UnmatchedFindingClassification, "unresolved">;

export interface ExperimentAdjudicationRecord {
  attemptId: string;
  findingIndex: number;
  findingEvidenceSha256: string;
  classification: FinalAdjudicationClassification;
  rationale: string;
  evidence: string;
}

export interface ExperimentAdjudicationSource {
  schemaVersion: 1;
  kind: "unmatched-finding-adjudication-source";
  experimentId: string;
  curatorIdentitySha256: string;
  reviewProtocol: "blind-to-engine-route-variant-v1";
  records: ExperimentAdjudicationRecord[];
}

export interface ExperimentAdjudicationLedger {
  schemaVersion: 1;
  kind: "experiment-adjudication";
  experimentId: string;
  experimentManifestSha256: string;
  terminalSealSha256: string;
  gradingSealSha256: string;
  source: {
    repositoryCommit: string;
    path: string;
    sha256: string;
    curatorIdentitySha256: string;
    reviewProtocol: "blind-to-engine-route-variant-v1";
  };
  records: ExperimentAdjudicationRecord[];
  recordedAt: string;
  ledgerSha256: string;
}

export function writeExperimentAdjudication(
  runDirectory: string,
  sourcePath: string,
  recordedAt = new Date().toISOString(),
): ExperimentAdjudicationLedger {
  const root = resolve(runDirectory);
  const repository = realpathSync(packageRoot());
  requireCleanRepository(repository);
  const commit = git(repository, ["rev-parse", "HEAD"]).trim();
  if (!GIT_OID.test(commit)) throw new Error("could not resolve a full adjudication source commit");
  const relativePath = trackedSourcePath(repository, sourcePath, commit);
  const sourceBytes = gitBuffer(repository, ["show", `${commit}:${relativePath}`]);
  const source = parseExperimentAdjudicationSource(JSON.parse(sourceBytes.toString("utf8")), relativePath);

  const matrixPath = resolve(root, MATRIX_MANIFEST_FILENAME);
  const matrix = parseMatrixRunManifest(readExperimentJson(matrixPath), matrixPath);
  const { seal: gradingSeal, evidence } = requireValidExperimentGradingSeal(root, matrix);
  if (source.experimentId !== evidence.experiment.experimentId) {
    throw new Error("adjudication source does not match the experiment");
  }
  requireDescendant(repository, evidence.experiment.repositoryCommit, commit);
  validateRecordsAgainstSealedGrades(
    root,
    source.records,
    evidence.records,
    evidence.experiment.schedule,
    new Set(evidence.experiment.benchmarkCategory?.definition.roles.diagnosticOnlyCases ?? []),
  );
  const timestamp = canonicalTimestamp(recordedAt, "adjudication recordedAt");
  if (Date.parse(timestamp) < Date.parse(gradingSeal.sealedAt)) {
    throw new Error("adjudication predates the sealed grading evidence");
  }
  const body = {
    schemaVersion: 1 as const,
    kind: "experiment-adjudication" as const,
    experimentId: evidence.experiment.experimentId,
    experimentManifestSha256: gradingSeal.experimentManifestSha256,
    terminalSealSha256: gradingSeal.terminalSealSha256,
    gradingSealSha256: gradingSeal.sealSha256,
    source: {
      repositoryCommit: commit,
      path: relativePath,
      sha256: sha256(sourceBytes),
      curatorIdentitySha256: source.curatorIdentitySha256,
      reviewProtocol: source.reviewProtocol,
    },
    records: source.records,
    recordedAt: timestamp,
  };
  const ledger = { ...body, ledgerSha256: canonicalJsonSha256(body) };
  assertNoSecrets(ledger, "experiment adjudication ledger");
  writeExclusiveJson(root, resolve(root, EXPERIMENT_ADJUDICATION_FILENAME), ledger);
  return ledger;
}

export function readExperimentAdjudication(runDirectory: string): ExperimentAdjudicationLedger | undefined {
  const root = resolve(runDirectory);
  const path = resolve(root, EXPERIMENT_ADJUDICATION_FILENAME);
  if (!existsSync(path)) return undefined;
  const matrixPath = resolve(root, MATRIX_MANIFEST_FILENAME);
  const matrix = parseMatrixRunManifest(readExperimentJson(matrixPath), matrixPath);
  const { seal: gradingSeal, evidence } = requireValidExperimentGradingSeal(root, matrix);
  const ledger = parseExperimentAdjudicationLedger(readExperimentJson(path), path);
  if (ledger.experimentId !== evidence.experiment.experimentId ||
    ledger.experimentManifestSha256 !== gradingSeal.experimentManifestSha256 ||
    ledger.terminalSealSha256 !== gradingSeal.terminalSealSha256 ||
    ledger.gradingSealSha256 !== gradingSeal.sealSha256) {
    throw new Error("experiment adjudication ledger does not match its sealed run");
  }
  if (Date.parse(ledger.recordedAt) < Date.parse(gradingSeal.sealedAt)) {
    throw new Error("experiment adjudication ledger predates sealed grading evidence");
  }
  const repository = realpathSync(packageRoot());
  requireDescendant(repository, evidence.experiment.repositoryCommit, ledger.source.repositoryCommit);
  const sourceBytes = gitBuffer(repository, ["show", `${ledger.source.repositoryCommit}:${ledger.source.path}`]);
  if (sha256(sourceBytes) !== ledger.source.sha256) throw new Error("adjudication source hash does not match committed Git evidence");
  const source = parseExperimentAdjudicationSource(JSON.parse(sourceBytes.toString("utf8")), ledger.source.path);
  if (source.experimentId !== ledger.experimentId ||
    source.curatorIdentitySha256 !== ledger.source.curatorIdentitySha256 ||
    source.reviewProtocol !== ledger.source.reviewProtocol ||
    canonicalJson(source.records) !== canonicalJson(ledger.records)) {
    throw new Error("experiment adjudication ledger records do not match committed Git evidence");
  }
  validateRecordsAgainstSealedGrades(
    root,
    ledger.records,
    evidence.records,
    evidence.experiment.schedule,
    new Set(evidence.experiment.benchmarkCategory?.definition.roles.diagnosticOnlyCases ?? []),
  );
  return ledger;
}

export function parseExperimentAdjudicationSource(
  value: unknown,
  source = "adjudication source",
): ExperimentAdjudicationSource {
  const root = strictObject(value, source, [
    "schemaVersion", "kind", "experimentId", "curatorIdentitySha256", "reviewProtocol", "records",
  ]);
  if (root.schemaVersion !== 1 || root.kind !== "unmatched-finding-adjudication-source") {
    throw new Error(`${source} has an unsupported schema or kind`);
  }
  const experimentId = hash(root.experimentId, `${source}.experimentId`);
  if (!Array.isArray(root.records) || root.records.length === 0) throw new Error(`${source}.records must be non-empty`);
  if (root.reviewProtocol !== "blind-to-engine-route-variant-v1") {
    throw new Error(`${source}.reviewProtocol is invalid`);
  }
  return {
    schemaVersion: 1,
    kind: "unmatched-finding-adjudication-source",
    experimentId,
    curatorIdentitySha256: hash(root.curatorIdentitySha256, `${source}.curatorIdentitySha256`),
    reviewProtocol: root.reviewProtocol,
    records: parseRecords(root.records, `${source}.records`),
  };
}

export function parseExperimentAdjudicationLedger(
  value: unknown,
  source = "experiment adjudication ledger",
): ExperimentAdjudicationLedger {
  const root = strictObject(value, source, [
    "schemaVersion", "kind", "experimentId", "experimentManifestSha256", "terminalSealSha256",
    "gradingSealSha256", "source", "records", "recordedAt", "ledgerSha256",
  ]);
  if (root.schemaVersion !== 1 || root.kind !== "experiment-adjudication") throw new Error(`${source} has an unsupported schema or kind`);
  const gitSource = strictObject(root.source, `${source}.source`, [
    "repositoryCommit", "path", "sha256", "curatorIdentitySha256", "reviewProtocol",
  ]);
  if (typeof gitSource.repositoryCommit !== "string" || !GIT_OID.test(gitSource.repositoryCommit)) throw new Error(`${source}.source.repositoryCommit must be a full Git object ID`);
  if (typeof gitSource.path !== "string" || !SAFE_REPOSITORY_PATH.test(gitSource.path)) throw new Error(`${source}.source.path is unsafe`);
  if (gitSource.reviewProtocol !== "blind-to-engine-route-variant-v1") throw new Error(`${source}.source.reviewProtocol is invalid`);
  if (!Array.isArray(root.records) || root.records.length === 0) throw new Error(`${source}.records must be non-empty`);
  const body = {
    schemaVersion: 1 as const,
    kind: "experiment-adjudication" as const,
    experimentId: hash(root.experimentId, `${source}.experimentId`),
    experimentManifestSha256: hash(root.experimentManifestSha256, `${source}.experimentManifestSha256`),
    terminalSealSha256: hash(root.terminalSealSha256, `${source}.terminalSealSha256`),
    gradingSealSha256: hash(root.gradingSealSha256, `${source}.gradingSealSha256`),
    source: {
      repositoryCommit: gitSource.repositoryCommit,
      path: gitSource.path,
      sha256: hash(gitSource.sha256, `${source}.source.sha256`),
      curatorIdentitySha256: hash(gitSource.curatorIdentitySha256, `${source}.source.curatorIdentitySha256`),
      reviewProtocol: "blind-to-engine-route-variant-v1" as const,
    },
    records: parseRecords(root.records, `${source}.records`),
    recordedAt: canonicalTimestamp(root.recordedAt, `${source}.recordedAt`),
  };
  const ledgerSha256 = hash(root.ledgerSha256, `${source}.ledgerSha256`);
  if (ledgerSha256 !== canonicalJsonSha256(body)) throw new Error(`${source}.ledgerSha256 does not authenticate its contents`);
  const parsed = { ...body, ledgerSha256 };
  assertNoSecrets(parsed, `${source} artifact`);
  return parsed;
}

export function adjudicationMap(ledger: ExperimentAdjudicationLedger | undefined): ReadonlyMap<string, FinalAdjudicationClassification> {
  return new Map((ledger?.records ?? []).map((record) => [
    adjudicationKey(record.attemptId, record.findingIndex, record.findingEvidenceSha256),
    record.classification,
  ]));
}

export function adjudicationKey(attemptId: string, findingIndex: number, findingEvidenceSha256: string): string {
  return `${attemptId}\0${findingIndex}\0${findingEvidenceSha256}`;
}

function parseRecords(value: unknown[], source: string): ExperimentAdjudicationRecord[] {
  const seen = new Set<string>();
  return value.map((item, index) => {
    const label = `${source}[${index}]`;
    const record = strictObject(item, label, ["attemptId", "findingIndex", "findingEvidenceSha256", "classification", "rationale", "evidence"]);
    if (typeof record.attemptId !== "string" || !ATTEMPT_ID.test(record.attemptId)) throw new Error(`${label}.attemptId is invalid`);
    if (!Number.isSafeInteger(record.findingIndex) || (record.findingIndex as number) < 0) throw new Error(`${label}.findingIndex is invalid`);
    const findingEvidenceSha256 = hash(record.findingEvidenceSha256, `${label}.findingEvidenceSha256`);
    if (record.classification !== "confirmed-new" && record.classification !== "unsupported") throw new Error(`${label}.classification must be final`);
    const key = adjudicationKey(record.attemptId, record.findingIndex as number, findingEvidenceSha256);
    if (seen.has(key)) throw new Error(`${source} contains a duplicate finding decision`);
    seen.add(key);
    return {
      attemptId: record.attemptId,
      findingIndex: record.findingIndex as number,
      findingEvidenceSha256,
      classification: record.classification,
      rationale: boundedText(record.rationale, `${label}.rationale`),
      evidence: boundedText(record.evidence, `${label}.evidence`),
    };
  });
}

function validateRecordsAgainstSealedGrades(
  root: string,
  records: readonly ExperimentAdjudicationRecord[],
  runRecords: readonly import("../src/types.js").RunRecord[],
  schedule: readonly import("./experiment.js").ExperimentScheduledAttempt[],
  diagnosticOnlyCaseIds: ReadonlySet<string>,
): void {
  const runs = new Map(runRecords.map((record) => [record.attemptId, record]));
  const attempts = new Map(schedule.map((attempt) => [attempt.id, attempt]));
  const grades = new Map<string, GradedRun>();
  const required: AdjudicationIdentity[] = [];
  for (const attempt of schedule) {
    const run = runs.get(attempt.id);
    if (!run || run.outcome.status !== "completed") continue;
    const gradePath = resolve(root, attempt.file.replace(/\.json$/, ".graded.json"));
    const grade = parseGradedRun(readExperimentJson(gradePath), gradePath, attempt) as GradedRun;
    assertGradedMatchesRun(grade, run, gradePath);
    grades.set(attempt.id, grade);
    if (diagnosticOnlyCaseIds.has(caseIdOf(attempt.caseName))) continue;
    for (const item of grade.grading?.unmatchedFindings ?? []) {
      if (item.classification !== "unresolved") continue;
      required.push({
        attemptId: attempt.id,
        findingIndex: item.findingIndex,
        findingEvidenceSha256: item.findingEvidenceSha256,
      });
    }
  }
  for (const record of records) {
    const attempt = attempts.get(record.attemptId);
    const run = runs.get(record.attemptId);
    if (!attempt || !run || run.outcome.status !== "completed") throw new Error(`${record.attemptId} is not a completed sealed attempt`);
    const grade = grades.get(record.attemptId);
    if (!grade) throw new Error(`${record.attemptId} has no authenticated sealed grade`);
    const unresolved = grade.grading?.unmatchedFindings.find((item) => item.findingIndex === record.findingIndex && item.findingEvidenceSha256 === record.findingEvidenceSha256);
    if (!unresolved || unresolved.classification !== "unresolved") throw new Error(`${record.attemptId} adjudication does not identify an unresolved sealed finding`);
  }
  assertRequiredAdjudicationsComplete(records, required);
}

type AdjudicationIdentity = Pick<ExperimentAdjudicationRecord, "attemptId" | "findingIndex" | "findingEvidenceSha256">;

export function assertRequiredAdjudicationsComplete(
  records: readonly AdjudicationIdentity[],
  required: readonly AdjudicationIdentity[],
): void {
  const supplied = new Set(records.map((record) =>
    adjudicationKey(record.attemptId, record.findingIndex, record.findingEvidenceSha256)));
  const missing = required.filter((record) =>
    !supplied.has(adjudicationKey(record.attemptId, record.findingIndex, record.findingEvidenceSha256)));
  if (missing.length > 0) {
    throw new Error(`adjudication source omits ${missing.length} required non-diagnostic unresolved finding(s)`);
  }
}

function caseIdOf(caseName: string): string { return caseName.split("/").at(-1)!; }

function trackedSourcePath(repository: string, sourcePath: string, commit: string): string {
  const absolute = realpathSync(resolve(sourcePath));
  const path = relative(repository, absolute).split(sep).join("/");
  if (!SAFE_REPOSITORY_PATH.test(path)) throw new Error("adjudication source must be a safe repository-relative file");
  const bytes = readRegularFile(absolute);
  const committed = gitBuffer(repository, ["show", `${commit}:${path}`]);
  if (!bytes.equals(committed)) throw new Error("adjudication source must match the committed Git blob");
  return path;
}

function requireCleanRepository(repository: string): void {
  if (git(repository, ["status", "--porcelain"]).trim()) throw new Error("adjudication source repository must be clean");
}

function requireDescendant(repository: string, ancestor: string, descendant: string): void {
  if (!GIT_OID.test(ancestor) || !GIT_OID.test(descendant)) throw new Error("adjudication Git lineage uses an invalid commit");
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: repository, encoding: "utf8" });
  if (result.status !== 0) throw new Error("adjudication source commit is not descended from the experiment commit");
}

function git(repository: string, args: string[]): string { return gitBuffer(repository, args).toString("utf8"); }
function gitBuffer(repository: string, args: string[]): Buffer {
  const result = spawnSync("git", args, { cwd: repository, encoding: null, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) throw new Error(`git ${args[0]} failed while verifying adjudication evidence`);
  return result.stdout;
}
function readRegularFile(path: string): Buffer {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("adjudication source must be a regular non-symlink file");
  return readFileSync(path);
}
function strictObject(value: unknown, source: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be an object`);
  const root = value as Record<string, unknown>;
  const unexpected = Object.keys(root).filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !(key in root));
  if (unexpected.length || missing.length) throw new Error(`${source} has an invalid shape`);
  return root;
}
function hash(value: unknown, source: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${source} must be a lowercase SHA-256 digest`);
  return value;
}
function sha256(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function boundedText(value: unknown, source: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4_000) throw new Error(`${source} must be 1-4000 characters`);
  return value;
}
function canonicalTimestamp(value: unknown, source: string): string {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) throw new Error(`${source} must be a canonical timestamp`);
  return value;
}
