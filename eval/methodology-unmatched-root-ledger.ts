import { lstatSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertNoSecrets } from "../src/security/secrets.js";
import {
  canonicalJson,
  canonicalJsonSha256,
  readExperimentJson,
  writeExclusiveJson,
} from "./experiment.js";
import {
  validateMethodologyGradeSet,
  type MethodologyAdjudicationRecord,
} from "./methodology-adjudication.js";
import {
  parseMethodologyAdjudicationResolution,
  type MethodologyEffectiveAdjudication,
} from "./methodology-adjudication-resolution.js";
import type { MethodologyAttemptGrade } from "./methodology-grading-contract.js";
import { parseMethodologySchedule, type MethodologySchedule } from "./methodology-schedule.js";

/** R3's post-adjudication, curator-supplied root grouping protocol. */
export const METHODOLOGY_UNMATCHED_ROOT_LEDGER_PROTOCOL =
  "historical-methodology-unmatched-root-ledger-v1" as const;
export const METHODOLOGY_UNMATCHED_ROOT_REVIEW_PROTOCOL =
  "blind-to-arm-route-timing-v1" as const;
export const METHODOLOGY_UNMATCHED_ROOT_LEDGER_DIRECTORY =
  "methodology-unmatched-root-ledgers";

const SHA256 = /^[a-f0-9]{64}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ATTEMPT_ID = /^attempt-[0-9]{6}$/;
const CASE_NAME = /^(?:development|validation)\/case-[a-f0-9]{8,32}$/;
const MAX_TEXT_LENGTH = 4_000;
const CLASSIFICATIONS = ["confirmed-new", "unsupported", "unresolved"] as const;

export type UnmatchedRootClassification = (typeof CLASSIFICATIONS)[number];
export type ReviewerIndependence = "not-attested" | "operator-attested-independent";

/** The only curator assertion about an occurrence: which opaque root it belongs to. */
export interface MethodologyUnmatchedRootAssignment {
  attemptId: string;
  findingIndex: number;
  findingEvidenceSha256: string;
  rootIdentitySha256: string;
}

/** Curator evidence and reviewer attestations for one root. */
export interface MethodologyUnmatchedRootInput {
  rootIdentitySha256: string;
  reviewerIdentitySha256s: string[];
  reviewerIndependence: ReviewerIndependence;
  source: string;
  evidence: string;
  rationale: string;
}

export interface MethodologyUnmatchedRootOccurrence {
  attemptId: string;
  findingIndex: number;
  findingEvidenceSha256: string;
  occurrenceSha256: string;
  caseName: string;
  armId: "A" | "B" | "C" | "D";
  repeat: number;
  classification: UnmatchedRootClassification;
}

export interface MethodologyUnmatchedRootGroup extends MethodologyUnmatchedRootInput {
  classification: UnmatchedRootClassification;
  caseName: string;
  occurrences: MethodologyUnmatchedRootOccurrence[];
}

export interface MethodologyUnmatchedRootLedger {
  schemaVersion: 1;
  protocol: typeof METHODOLOGY_UNMATCHED_ROOT_LEDGER_PROTOCOL;
  runId: string;
  baseLedgerSha256: string;
  effectiveAdjudicationSha256: string;
  headResolutionSha256: string | null;
  gradeSetSha256: string;
  scheduleSha256: string;
  reviewProtocol: typeof METHODOLOGY_UNMATCHED_ROOT_REVIEW_PROTOCOL;
  recordedAt: string;
  roots: MethodologyUnmatchedRootGroup[];
  rootCounts: Record<UnmatchedRootClassification, number>;
  occurrenceCounts: Record<UnmatchedRootClassification, number>;
  artifactSha256: string;
}

export interface MethodologyUnmatchedRootLedgerInputs {
  runId: string;
  schedule: unknown;
  gradeSet: unknown;
  effectiveAdjudication: unknown;
  assignments: readonly (MethodologyUnmatchedRootAssignment | unknown)[];
  roots: readonly (MethodologyUnmatchedRootInput | unknown)[];
  recordedAt: string;
  /** Caller-held bindings keep reconstructed inputs fail closed. */
  baseLedgerSha256: string;
  effectiveAdjudicationSha256: string;
  headResolutionSha256: string | null;
  gradeSetSha256: string;
  scheduleSha256: string;
}

type Source = {
  schedule: MethodologySchedule;
  grades: MethodologyAttemptGrade[];
  gradeSetRunId: string | null;
  gradeSetSha256: string;
  effective: MethodologyEffectiveAdjudication;
  scheduleSha256: string;
};

/** Build the deterministic ledger. Every derived occurrence field comes from schedule/grades. */
export function buildMethodologyUnmatchedRootLedger(
  input: MethodologyUnmatchedRootLedgerInputs,
): MethodologyUnmatchedRootLedger {
  const source = authenticateSource(input);
  const assignments = input.assignments.map((value, index) => parseAssignment(value, index));
  const rootsInput = input.roots.map((value, index) => parseRootInput(value, index));
  const expectedRecords = source.effective.records;
  const expectedKeys = expectedRecords.map(occurrenceKey).sort();
  const assignmentKeys = assignments.map(occurrenceKey).sort();
  if (new Set(assignmentKeys).size !== assignments.length) {
    throw new Error("methodology unmatched-root assignments contain duplicate occurrences");
  }
  if (canonicalJson(expectedKeys) !== canonicalJson(assignmentKeys)) {
    throw new Error("methodology unmatched-root assignments must cover every and only effective occurrence");
  }
  const rootsById = new Map(rootsInput.map((root) => [root.rootIdentitySha256, root]));
  if (rootsById.size !== rootsInput.length) {
    throw new Error("methodology unmatched-root identities must be unique");
  }
  const assignmentByKey = new Map(assignments.map((assignment) => [occurrenceKey(assignment), assignment]));
  const sourceByKey = new Map(expectedRecords.map((record) => [occurrenceKey(record), record]));
  const attemptById = new Map(source.schedule.attempts.map((attempt) => [attempt.id, attempt]));
  const gradeById = new Map(source.grades.map((grade) => [grade.projection.attemptId, grade]));
  const groups = new Map<string, MethodologyUnmatchedRootGroup>();

  for (const assignment of assignments) {
    const key = occurrenceKey(assignment);
    const record = sourceByKey.get(key);
    const rootInput = rootsById.get(assignment.rootIdentitySha256);
    const attempt = attemptById.get(assignment.attemptId);
    const grade = gradeById.get(assignment.attemptId);
    const finding = grade?.findings.find((item) => item.findingIndex === assignment.findingIndex);
    if (!record || !rootInput || !attempt || !grade || !finding ||
        finding.evidenceSha256 !== assignment.findingEvidenceSha256 ||
        grade.projection.caseName !== attempt.caseName) {
      throw new Error("methodology unmatched-root assignment is stale or not bound to schedule/grade/effective adjudication");
    }
    const occurrence: MethodologyUnmatchedRootOccurrence = {
      attemptId: attempt.id,
      findingIndex: record.findingIndex,
      findingEvidenceSha256: record.findingEvidenceSha256,
      occurrenceSha256: canonicalJsonSha256({
        attemptId: record.attemptId,
        findingIndex: record.findingIndex,
        findingEvidenceSha256: record.findingEvidenceSha256,
      }),
      caseName: attempt.caseName,
      armId: attempt.armId,
      repeat: attempt.repeat,
      classification: record.classification,
    };
    const current = groups.get(rootInput.rootIdentitySha256);
    if (!current) {
      groups.set(rootInput.rootIdentitySha256, {
        ...rootInput,
        classification: record.classification,
        caseName: attempt.caseName,
        occurrences: [occurrence],
      });
      continue;
    }
    if (current.caseName !== attempt.caseName) {
      throw new Error("methodology unmatched-root group mixes case names");
    }
    current.occurrences.push(occurrence);
    current.classification = deriveRootClassification(current.occurrences);
  }
  if (groups.size !== rootsInput.length || [...rootsById.keys()].some((id) => !groups.has(id))) {
    throw new Error("methodology unmatched-root groups must each contain an occurrence");
  }
  const roots = [...groups.values()].map((root) => ({
    ...root,
    occurrences: [...root.occurrences].sort(compareOccurrence),
  })).sort((left, right) => left.rootIdentitySha256.localeCompare(right.rootIdentitySha256));
  const rootCounts = {
    "confirmed-new": roots.filter((root) => root.classification === "confirmed-new").length,
    unsupported: roots.filter((root) => root.classification === "unsupported").length,
    unresolved: roots.filter((root) => root.classification === "unresolved").length,
  };
  const occurrenceCounts = {
    "confirmed-new": roots.reduce((total, root) => total + root.occurrences.filter((item) => item.classification === "confirmed-new").length, 0),
    unsupported: roots.reduce((total, root) => total + root.occurrences.filter((item) => item.classification === "unsupported").length, 0),
    unresolved: roots.reduce((total, root) => total + root.occurrences.filter((item) => item.classification === "unresolved").length, 0),
  };
  const body = {
    schemaVersion: 1 as const,
    protocol: METHODOLOGY_UNMATCHED_ROOT_LEDGER_PROTOCOL,
    runId: input.runId,
    baseLedgerSha256: source.effective.baseLedgerSha256,
    effectiveAdjudicationSha256: source.effective.effectiveSha256,
    headResolutionSha256: source.effective.headResolutionSha256,
    gradeSetSha256: source.gradeSetSha256,
    scheduleSha256: source.scheduleSha256,
    reviewProtocol: METHODOLOGY_UNMATCHED_ROOT_REVIEW_PROTOCOL,
    recordedAt: timestamp(input.recordedAt, "recordedAt"),
    roots,
    rootCounts,
    occurrenceCounts,
  };
  assertNoSecrets(body, "methodology unmatched-root ledger");
  return { ...body, artifactSha256: canonicalJsonSha256(body) };
}

/** Persist one immutable, content-addressed curator root ledger. */
export function writeMethodologyUnmatchedRootLedger(
  root: string,
  input: MethodologyUnmatchedRootLedgerInputs,
): MethodologyUnmatchedRootLedger {
  const ledger = buildMethodologyUnmatchedRootLedger(input);
  assertNoSecrets(ledger, "methodology unmatched-root ledger");
  const directory = join(resolve(root), METHODOLOGY_UNMATCHED_ROOT_LEDGER_DIRECTORY);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  safeStoredDirectory(root, METHODOLOGY_UNMATCHED_ROOT_LEDGER_DIRECTORY);
  writeExclusiveJson(root, join(directory, `${ledger.artifactSha256}.json`), ledger);
  return ledger;
}

/** Read and fully rederive the stored curator root ledger from authenticated inputs. */
export function readMethodologyUnmatchedRootLedger(
  root: string,
  expectedArtifactSha256: string,
  input: MethodologyUnmatchedRootLedgerInputs,
): MethodologyUnmatchedRootLedger {
  const stored = readStoredMethodologyUnmatchedRootLedger(root, expectedArtifactSha256);
  const rebuilt = buildMethodologyUnmatchedRootLedger(input);
  if (canonicalJson(stored) !== canonicalJson(rebuilt)) {
    throw new Error("methodology unmatched-root ledger differs from rederived evidence");
  }
  return rebuilt;
}

/** Read the self-authenticating ledger before a consumer rebinds its curator assertions. */
export function readStoredMethodologyUnmatchedRootLedger(
  root: string,
  expectedArtifactSha256: string,
): MethodologyUnmatchedRootLedger {
  digest(expectedArtifactSha256, "expectedArtifactSha256");
  safeStoredDirectory(root, METHODOLOGY_UNMATCHED_ROOT_LEDGER_DIRECTORY);
  let path: string;
  try {
    path = safeStoredFile(
      root,
      join(METHODOLOGY_UNMATCHED_ROOT_LEDGER_DIRECTORY, `${expectedArtifactSha256}.json`),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("methodology unmatched-root ledger digest does not identify a stored artifact");
    }
    throw error;
  }
  const stored = parseMethodologyUnmatchedRootLedger(readExperimentJson(path), path);
  if (stored.artifactSha256 !== expectedArtifactSha256) {
    throw new Error("methodology unmatched-root ledger digest mismatch");
  }
  return stored;
}

/** Rebuild alias used by consumers that treat the ledger as a derived artifact. */
export function rebuildMethodologyUnmatchedRootLedger(
  input: MethodologyUnmatchedRootLedgerInputs,
): MethodologyUnmatchedRootLedger {
  return buildMethodologyUnmatchedRootLedger(input);
}

/** Parse and authenticate a serialized ledger without accepting caller-derived fields. */
export function parseMethodologyUnmatchedRootLedger(
  value: unknown,
  source = "methodology unmatched-root ledger",
): MethodologyUnmatchedRootLedger {
  const root = exactObject(value, [
    "schemaVersion", "protocol", "runId", "baseLedgerSha256", "effectiveAdjudicationSha256",
    "headResolutionSha256", "gradeSetSha256", "scheduleSha256", "reviewProtocol", "recordedAt",
    "roots", "rootCounts", "occurrenceCounts", "artifactSha256",
  ], source);
  if (root.schemaVersion !== 1 || root.protocol !== METHODOLOGY_UNMATCHED_ROOT_LEDGER_PROTOCOL) {
    throw new Error(`${source} protocol/version is invalid`);
  }
  const runId = parseRunId(root.runId, `${source}.runId`);
  const baseLedgerSha256 = digest(root.baseLedgerSha256, `${source}.baseLedgerSha256`);
  const effectiveAdjudicationSha256 = digest(root.effectiveAdjudicationSha256, `${source}.effectiveAdjudicationSha256`);
  const headResolutionSha256 = root.headResolutionSha256 === null
    ? null : digest(root.headResolutionSha256, `${source}.headResolutionSha256`);
  const gradeSetSha256 = digest(root.gradeSetSha256, `${source}.gradeSetSha256`);
  const scheduleSha256 = digest(root.scheduleSha256, `${source}.scheduleSha256`);
  if (root.reviewProtocol !== METHODOLOGY_UNMATCHED_ROOT_REVIEW_PROTOCOL) throw new Error(`${source}.reviewProtocol is invalid`);
  const recordedAt = timestamp(root.recordedAt, `${source}.recordedAt`);
  if (!Array.isArray(root.roots)) throw new Error(`${source}.roots must be an array`);
  const roots = root.roots.map((value, index) => parseGroup(value, index));
  const rootIds = roots.map((item) => item.rootIdentitySha256);
  if (new Set(rootIds).size !== rootIds.length || [...roots].some((_, i) => i > 0 && rootIds[i - 1]! >= rootIds[i]!)) {
    throw new Error(`${source}.roots must be uniquely sorted by root identity`);
  }
  const occurrenceKeys = roots.flatMap((item) => item.occurrences.map(occurrenceKey));
  if (new Set(occurrenceKeys).size !== occurrenceKeys.length) throw new Error(`${source}.roots contain a duplicate occurrence`);
  const rootCountsRoot = exactObject(root.rootCounts, ["confirmed-new", "unsupported", "unresolved"], `${source}.rootCounts`);
  const rootCounts = {
    "confirmed-new": nonnegativeInteger(rootCountsRoot["confirmed-new"], `${source}.rootCounts.confirmed-new`),
    unsupported: nonnegativeInteger(rootCountsRoot.unsupported, `${source}.rootCounts.unsupported`),
    unresolved: nonnegativeInteger(rootCountsRoot.unresolved, `${source}.rootCounts.unresolved`),
  };
  const occurrenceCountsRoot = exactObject(root.occurrenceCounts, ["confirmed-new", "unsupported", "unresolved"], `${source}.occurrenceCounts`);
  const occurrenceCounts = {
    "confirmed-new": nonnegativeInteger(occurrenceCountsRoot["confirmed-new"], `${source}.occurrenceCounts.confirmed-new`),
    unsupported: nonnegativeInteger(occurrenceCountsRoot.unsupported, `${source}.occurrenceCounts.unsupported`),
    unresolved: nonnegativeInteger(occurrenceCountsRoot.unresolved, `${source}.occurrenceCounts.unresolved`),
  };
  const computedRootCounts = { ...rootCounts };
  const computedOccurrenceCounts = { ...occurrenceCounts };
  for (const classification of CLASSIFICATIONS) {
    computedRootCounts[classification] = roots.filter((item) => item.classification === classification).length;
    computedOccurrenceCounts[classification] = roots.reduce((total, item) => total + item.occurrences.filter((occurrence) => occurrence.classification === classification).length, 0);
  }
  if (canonicalJson(rootCounts) !== canonicalJson(computedRootCounts)) throw new Error(`${source}.rootCounts are invalid`);
  if (canonicalJson(occurrenceCounts) !== canonicalJson(computedOccurrenceCounts)) throw new Error(`${source}.occurrenceCounts are invalid`);
  const body = { schemaVersion: 1 as const, protocol: METHODOLOGY_UNMATCHED_ROOT_LEDGER_PROTOCOL, runId, baseLedgerSha256, effectiveAdjudicationSha256, headResolutionSha256, gradeSetSha256, scheduleSha256, reviewProtocol: METHODOLOGY_UNMATCHED_ROOT_REVIEW_PROTOCOL, recordedAt, roots, rootCounts, occurrenceCounts };
  const artifactSha256 = digest(root.artifactSha256, `${source}.artifactSha256`);
  if (artifactSha256 !== canonicalJsonSha256(body)) throw new Error(`${source} artifact digest is invalid`);
  assertNoSecrets({ ...body, artifactSha256 }, source);
  return { ...body, artifactSha256 };
}

function authenticateSource(input: MethodologyUnmatchedRootLedgerInputs): Source {
  const schedule = parseMethodologySchedule(input.schedule, "methodology unmatched-root schedule");
  const scheduleSha256 = canonicalJsonSha256(schedule);
  if (scheduleSha256 !== digest(input.scheduleSha256, "scheduleSha256")) throw new Error("methodology unmatched-root schedule digest mismatch");
  const gradeSet = parseGradeSet(input.gradeSet, schedule);
  const grades = gradeSet.grades;
  const gradeSetRunId = gradeSet.gradeSetRunId;
  const first = grades[0];
  if (!first) throw new Error("methodology unmatched-root grade set is empty");
  const validated = validateMethodologyGradeSet({
    executionEvidenceSha256: first.projection.executionEvidenceSha256,
    inputPlanSha256: first.projection.inputPlanSha256,
    expectedAttemptIds: schedule.attempts.map((attempt) => attempt.id),
    grades,
  });
  if (validated.gradeSetSha256 !== digest(input.gradeSetSha256, "gradeSetSha256")) throw new Error("methodology unmatched-root grade-set digest mismatch");
  const effective = parseEffective(input.effectiveAdjudication);
  if (input.runId !== effective.runId || (gradeSetRunId !== null && input.runId !== gradeSetRunId)) throw new Error("methodology unmatched-root runId is stale or cross-run");
  if (effective.gradeSetSha256 !== validated.gradeSetSha256) throw new Error("methodology unmatched-root effective adjudication has a stale grade-set binding");
  if (effective.baseLedgerSha256 !== digest(input.baseLedgerSha256, "baseLedgerSha256")) throw new Error("methodology unmatched-root base ledger digest mismatch");
  if (effective.effectiveSha256 !== digest(input.effectiveAdjudicationSha256, "effectiveAdjudicationSha256")) throw new Error("methodology unmatched-root effective adjudication digest mismatch");
  if (input.headResolutionSha256 !== null) digest(input.headResolutionSha256, "headResolutionSha256");
  if (effective.headResolutionSha256 !== input.headResolutionSha256) throw new Error("methodology unmatched-root resolution head mismatch");
  const gradeById = new Map(grades.map((grade) => [grade.projection.attemptId, grade]));
  const expected = grades.flatMap((grade) => grade.unmatchedFindings.map((finding) => ({ attemptId: grade.projection.attemptId, findingIndex: finding.findingIndex, findingEvidenceSha256: finding.findingEvidenceSha256 })));
  const expectedKeys = expected.map(occurrenceKey).sort();
  const effectiveKeys = effective.records.map(occurrenceKey).sort();
  if (canonicalJson(expectedKeys) !== canonicalJson(effectiveKeys)) throw new Error("methodology unmatched-root effective adjudication is stale or tampered relative to grades");
  for (const record of effective.records) {
    const grade = gradeById.get(record.attemptId);
    const finding = grade?.findings.find((candidate) => candidate.findingIndex === record.findingIndex);
    if (!finding || finding.evidenceSha256 !== record.findingEvidenceSha256) throw new Error("methodology unmatched-root effective occurrence is not bound to its grade");
  }
  return { schedule, grades, gradeSetRunId, gradeSetSha256: validated.gradeSetSha256, effective, scheduleSha256 };
}

function parseGradeSet(value: unknown, schedule: MethodologySchedule): { grades: MethodologyAttemptGrade[]; gradeSetRunId: string | null } {
  if (Array.isArray(value)) return { grades: value as MethodologyAttemptGrade[], gradeSetRunId: null };
  const root = exactObject(value, ["schemaVersion", "protocol", "runId", "schedule", "executionEvidenceSha256", "inputPlanSha256", "gradeSetSha256", "grades", "recordedAt", "artifactSha256"], "methodology unmatched-root grade set");
  if (root.schemaVersion !== 1 || root.protocol !== "historical-methodology-grade-set-v1" || !Array.isArray(root.grades)) throw new Error("methodology unmatched-root grade set is invalid");
  const storedSchedule = parseMethodologySchedule(root.schedule, "methodology unmatched-root stored schedule");
  if (canonicalJson(storedSchedule) !== canonicalJson(schedule)) throw new Error("methodology unmatched-root grade set schedule is stale");
  const grades = root.grades as MethodologyAttemptGrade[];
  const first = grades[0];
  if (!first || root.executionEvidenceSha256 !== first.projection.executionEvidenceSha256 || root.inputPlanSha256 !== first.projection.inputPlanSha256) throw new Error("methodology unmatched-root grade set bindings are invalid");
  const checked = validateMethodologyGradeSet({ executionEvidenceSha256: root.executionEvidenceSha256, inputPlanSha256: root.inputPlanSha256, expectedAttemptIds: schedule.attempts.map((attempt) => attempt.id), grades });
  if (root.gradeSetSha256 !== checked.gradeSetSha256) throw new Error("methodology unmatched-root grade-set digest is invalid");
  const body = { schemaVersion: 1 as const, protocol: "historical-methodology-grade-set-v1" as const, runId: root.runId, schedule: storedSchedule, executionEvidenceSha256: root.executionEvidenceSha256, inputPlanSha256: root.inputPlanSha256, gradeSetSha256: checked.gradeSetSha256, grades: checked.grades, recordedAt: timestamp(root.recordedAt, "grade set recordedAt") };
  if (root.artifactSha256 !== canonicalJsonSha256(body)) throw new Error("methodology unmatched-root grade-set artifact is tampered");
  return { grades: checked.grades, gradeSetRunId: parseRunId(root.runId, "grade set runId") };
}

function parseEffective(value: unknown): MethodologyEffectiveAdjudication {
  const root = exactObject(value, ["schemaVersion", "protocol", "runId", "baseLedgerSha256", "gradeSetSha256", "records", "resolutions", "headResolutionSha256", "unresolvedCount", "effectiveSha256"], "methodology effective adjudication");
  if (root.schemaVersion !== 1 || root.protocol !== "historical-methodology-adjudication-effective-v1" || !Array.isArray(root.records) || !Array.isArray(root.resolutions)) throw new Error("methodology effective adjudication is invalid");
  const runId = parseRunId(root.runId, "effective.runId");
  const baseLedgerSha256 = digest(root.baseLedgerSha256, "effective.baseLedgerSha256");
  const gradeSetSha256 = digest(root.gradeSetSha256, "effective.gradeSetSha256");
  const records = root.records.map((value, index) => parseRecord(value, index));
  if (new Set(records.map(occurrenceKey)).size !== records.length) throw new Error("methodology effective adjudication contains duplicate occurrences");
  if (records.some((record, index) => index > 0 && compareRecord(records[index - 1]!, record) >= 0)) throw new Error("methodology effective adjudication records are not deterministically sorted");
  const resolutions = root.resolutions.map((value, index) => parseMethodologyAdjudicationResolution(value, `effective.resolutions[${index}]`));
  const recordByKey = new Map(records.map((record) => [occurrenceKey(record), record]));
  const resolvedKeys = new Set<string>();
  let previous: string | null = null;
  for (const [index, resolution] of resolutions.entries()) {
    if (resolution.runId !== runId || resolution.baseLedgerSha256 !== baseLedgerSha256 || resolution.gradeSetSha256 !== gradeSetSha256 || resolution.sequence !== index + 1 || resolution.previousResolutionSha256 !== previous) throw new Error("methodology effective adjudication resolution chain is stale or tampered");
    const key = occurrenceKey(resolution.occurrence);
    const resolved = recordByKey.get(key);
    if (!resolved || resolved.classification === "unresolved" || resolvedKeys.has(key)) throw new Error("methodology effective adjudication resolution occurrence is stale or duplicate");
    resolvedKeys.add(key);
    previous = resolution.resolutionSha256;
  }
  const headResolutionSha256 = root.headResolutionSha256 === null ? null : digest(root.headResolutionSha256, "effective.headResolutionSha256");
  if (headResolutionSha256 !== previous) throw new Error("methodology effective adjudication head is invalid");
  const unresolvedCount = nonnegativeInteger(root.unresolvedCount, "effective.unresolvedCount");
  if (unresolvedCount !== records.filter((record) => record.classification === "unresolved").length) throw new Error("methodology effective adjudication unresolved count is invalid");
  const body = { schemaVersion: 1 as const, protocol: "historical-methodology-adjudication-effective-v1" as const, runId, baseLedgerSha256, gradeSetSha256, records, resolutions, headResolutionSha256, unresolvedCount };
  const effectiveSha256 = digest(root.effectiveSha256, "effective.effectiveSha256");
  if (effectiveSha256 !== canonicalJsonSha256(body)) throw new Error("methodology effective adjudication digest is invalid");
  return { ...body, effectiveSha256 };
}

function parseRecord(value: unknown, index: number): MethodologyAdjudicationRecord {
  const root = exactObject(value, ["attemptId", "findingIndex", "findingEvidenceSha256", "classification", "rationale", "evidence"], `effective.records[${index}]`);
  const classification = root.classification;
  if (!CLASSIFICATIONS.includes(classification as UnmatchedRootClassification)) throw new Error(`effective.records[${index}].classification is invalid`);
  return { attemptId: parseAttemptId(root.attemptId, `effective.records[${index}].attemptId`), findingIndex: nonnegativeInteger(root.findingIndex, `effective.records[${index}].findingIndex`), findingEvidenceSha256: digest(root.findingEvidenceSha256, `effective.records[${index}].findingEvidenceSha256`), classification: classification as UnmatchedRootClassification, rationale: boundedText(root.rationale, `effective.records[${index}].rationale`), evidence: boundedText(root.evidence, `effective.records[${index}].evidence`) };
}

function parseAssignment(value: unknown, index: number): MethodologyUnmatchedRootAssignment {
  const root = exactObject(value, ["attemptId", "findingIndex", "findingEvidenceSha256", "rootIdentitySha256"], `assignments[${index}]`);
  return { attemptId: parseAttemptId(root.attemptId, `assignments[${index}].attemptId`), findingIndex: nonnegativeInteger(root.findingIndex, `assignments[${index}].findingIndex`), findingEvidenceSha256: digest(root.findingEvidenceSha256, `assignments[${index}].findingEvidenceSha256`), rootIdentitySha256: digest(root.rootIdentitySha256, `assignments[${index}].rootIdentitySha256`) };
}

function parseRootInput(value: unknown, index: number): MethodologyUnmatchedRootInput {
  const root = exactObject(value, ["rootIdentitySha256", "reviewerIdentitySha256s", "reviewerIndependence", "source", "evidence", "rationale"], `roots[${index}]`);
  const reviewers = root.reviewerIdentitySha256s;
  if (!Array.isArray(reviewers) || reviewers.length === 0) throw new Error(`roots[${index}].reviewerIdentitySha256s must be non-empty`);
  const reviewerIdentitySha256s = reviewers.map((item, memberIndex) => digest(item, `roots[${index}].reviewerIdentitySha256s[${memberIndex}]`)).sort();
  if (new Set(reviewerIdentitySha256s).size !== reviewerIdentitySha256s.length) throw new Error(`roots[${index}].reviewerIdentitySha256s contains duplicates`);
  if (root.reviewerIndependence !== "not-attested" && root.reviewerIndependence !== "operator-attested-independent") throw new Error(`roots[${index}].reviewerIndependence is invalid`);
  if (root.reviewerIndependence === "operator-attested-independent" && reviewerIdentitySha256s.length < 2) throw new Error(`roots[${index}] independent attestation requires at least two reviewer identities`);
  return { rootIdentitySha256: digest(root.rootIdentitySha256, `roots[${index}].rootIdentitySha256`), reviewerIdentitySha256s, reviewerIndependence: root.reviewerIndependence, source: boundedText(root.source, `roots[${index}].source`), evidence: boundedText(root.evidence, `roots[${index}].evidence`), rationale: boundedText(root.rationale, `roots[${index}].rationale`) };
}

function parseGroup(value: unknown, index: number): MethodologyUnmatchedRootGroup {
  const root = exactObject(value, ["rootIdentitySha256", "reviewerIdentitySha256s", "reviewerIndependence", "source", "evidence", "rationale", "classification", "caseName", "occurrences"], `roots[${index}]`);
  const metadata = parseRootInput({ rootIdentitySha256: root.rootIdentitySha256, reviewerIdentitySha256s: root.reviewerIdentitySha256s, reviewerIndependence: root.reviewerIndependence, source: root.source, evidence: root.evidence, rationale: root.rationale }, index);
  if (!CLASSIFICATIONS.includes(root.classification as UnmatchedRootClassification)) throw new Error(`roots[${index}].classification is invalid`);
  if (typeof root.caseName !== "string" || !CASE_NAME.test(root.caseName)) throw new Error(`roots[${index}].caseName is invalid`);
  if (!Array.isArray(root.occurrences) || root.occurrences.length === 0) throw new Error(`roots[${index}].occurrences must be non-empty`);
  const occurrences = root.occurrences.map((item, occurrenceIndex) => parseOutputOccurrence(item, index, occurrenceIndex));
  if (occurrences.some((item) => item.caseName !== root.caseName || item.caseName !== occurrences[0]!.caseName)) throw new Error(`roots[${index}] mixes case names`);
  if (occurrences.some((item, occurrenceIndex) => occurrenceIndex > 0 && compareOccurrence(occurrences[occurrenceIndex - 1]!, item) >= 0)) throw new Error(`roots[${index}].occurrences are not deterministically sorted`);
  if (root.classification !== deriveRootClassification(occurrences)) throw new Error(`roots[${index}].classification does not match its occurrences`);
  return { ...metadata, classification: root.classification as UnmatchedRootClassification, caseName: root.caseName, occurrences };
}

function parseOutputOccurrence(value: unknown, rootIndex: number, index: number): MethodologyUnmatchedRootOccurrence {
  const root = exactObject(value, ["attemptId", "findingIndex", "findingEvidenceSha256", "occurrenceSha256", "caseName", "armId", "repeat", "classification"], `roots[${rootIndex}].occurrences[${index}]`);
  const occurrence = { attemptId: parseAttemptId(root.attemptId, "occurrence.attemptId"), findingIndex: nonnegativeInteger(root.findingIndex, "occurrence.findingIndex"), findingEvidenceSha256: digest(root.findingEvidenceSha256, "occurrence.findingEvidenceSha256") };
  if (digest(root.occurrenceSha256, "occurrence.occurrenceSha256") !== canonicalJsonSha256(occurrence)) throw new Error("occurrence digest is invalid");
  if (root.armId !== "A" && root.armId !== "B" && root.armId !== "C" && root.armId !== "D") throw new Error("occurrence armId is invalid");
  if (typeof root.caseName !== "string" || !CASE_NAME.test(root.caseName) || !Number.isSafeInteger(root.repeat) || Number(root.repeat) < 1) throw new Error("occurrence metadata is invalid");
  if (!CLASSIFICATIONS.includes(root.classification as UnmatchedRootClassification)) throw new Error("occurrence classification is invalid");
  return { ...occurrence, occurrenceSha256: root.occurrenceSha256, caseName: root.caseName, armId: root.armId, repeat: Number(root.repeat), classification: root.classification as UnmatchedRootClassification };
}

function deriveRootClassification(
  occurrences: readonly Pick<MethodologyUnmatchedRootOccurrence, "classification">[],
): UnmatchedRootClassification {
  const final = new Set(occurrences.map((item) => item.classification).filter((item) => item !== "unresolved"));
  if (final.size > 1) throw new Error("methodology unmatched-root group mixes final classifications");
  if (occurrences.some((item) => item.classification === "unresolved")) return "unresolved";
  return [...final][0] ?? "unresolved";
}

function occurrenceKey(value: Pick<MethodologyUnmatchedRootAssignment, "attemptId" | "findingIndex" | "findingEvidenceSha256">): string { return `${value.attemptId}\0${value.findingIndex}\0${value.findingEvidenceSha256}`; }
function compareRecord(left: Pick<MethodologyAdjudicationRecord, "attemptId" | "findingIndex">, right: Pick<MethodologyAdjudicationRecord, "attemptId" | "findingIndex">): number { return left.attemptId.localeCompare(right.attemptId) || left.findingIndex - right.findingIndex; }
function compareOccurrence(left: MethodologyUnmatchedRootOccurrence, right: MethodologyUnmatchedRootOccurrence): number { return left.attemptId.localeCompare(right.attemptId) || left.findingIndex - right.findingIndex || left.findingEvidenceSha256.localeCompare(right.findingEvidenceSha256); }
function exactObject(value: unknown, keys: readonly string[], source: string): Record<string, any> { if (!value || typeof value !== "object" || Array.isArray(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) throw new Error(`${source} has an invalid shape`); return value as Record<string, any>; }
function digest(value: unknown, source: string): string { if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${source} must be a lowercase SHA-256 digest`); return value; }
function parseRunId(value: unknown, source: string): string { if (typeof value !== "string" || !RUN_ID.test(value)) throw new Error(`${source} is invalid`); return value; }
function parseAttemptId(value: unknown, source: string): string { if (typeof value !== "string" || !ATTEMPT_ID.test(value)) throw new Error(`${source} is invalid`); return value; }
function nonnegativeInteger(value: unknown, source: string): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${source} must be a non-negative integer`); return Number(value); }
function boundedText(value: unknown, source: string): string { if (typeof value !== "string" || !value.trim() || value.length > MAX_TEXT_LENGTH || [...value].some((char) => { const code = char.codePointAt(0)!; return code === 0 || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d); })) throw new Error(`${source} contains unsafe text`); return value; }
function timestamp(value: unknown, source: string): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`${source} must be a canonical timestamp`); return value; }
function safeStoredFile(rootValue: string, file: string): string { const path = join(resolve(rootValue), file); const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${file} must be a regular non-symlink file`); return path; }
function safeStoredDirectory(rootValue: string, directory: string): string { const path = join(resolve(rootValue), directory); const stat = lstatSync(path); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${directory} must be a regular non-symlink directory`); return path; }
