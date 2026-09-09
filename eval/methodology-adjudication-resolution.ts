import { existsSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertNoSecrets } from "../src/security/secrets.js";
import {
  parseMethodologyGradeSetArtifact,
  type MethodologyGradeSetArtifact,
} from "./methodology-analysis-artifacts.js";
import {
  canonicalJson,
  canonicalJsonSha256,
  readExperimentJson,
  writeExclusiveJson,
} from "./experiment.js";
import type {
  MethodologyAdjudicationClassification,
  MethodologyAdjudicationLedger,
  MethodologyAdjudicationRecord,
} from "./methodology-adjudication.js";

export const METHODOLOGY_ADJUDICATION_RESOLUTION_PROTOCOL =
  "historical-methodology-adjudication-resolution-v1" as const;
export const METHODOLOGY_ADJUDICATION_EFFECTIVE_PROTOCOL =
  "historical-methodology-adjudication-effective-v1" as const;
export const METHODOLOGY_ADJUDICATION_RESOLUTION_DIRECTORY =
  "methodology-adjudication-resolutions" as const;
/** Short alias retained for callers that use the path as a directory name. */
export const METHODOLOGY_ADJUDICATION_RESOLUTION_DIR =
  METHODOLOGY_ADJUDICATION_RESOLUTION_DIRECTORY;

const SHA256 = /^[a-f0-9]{64}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ATTEMPT_ID = /^attempt-[0-9]{6}$/;
const RESOLUTION_FILENAME = /^resolution-([0-9]{6})\.json$/;
const TRUTH_VERSION = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_RESOLUTIONS = 999_999;
const MAX_TEXT_LENGTH = 4_000;

export type ResolutionClassification = Exclude<MethodologyAdjudicationClassification, "unresolved">;

export interface MethodologyAdjudicationOccurrenceIdentity {
  attemptId: string;
  findingIndex: number;
  findingEvidenceSha256: string;
}

export interface MethodologyAdjudicationResolution {
  schemaVersion: 1;
  protocol: typeof METHODOLOGY_ADJUDICATION_RESOLUTION_PROTOCOL;
  runId: string;
  baseLedgerSha256: string;
  gradeSetSha256: string;
  sequence: number;
  previousResolutionSha256: string | null;
  occurrence: MethodologyAdjudicationOccurrenceIdentity;
  occurrenceSha256: string;
  truthVersion: string;
  classification: ResolutionClassification;
  curatorIdentitySha256: string;
  reviewerIdentitySha256s: string[];
  reviewerIndependence: "not-attested" | "operator-attested-independent";
  recordedAt: string;
  rationale: string;
  evidence: string;
  resolutionSha256: string;
}

export interface MethodologyEffectiveAdjudication {
  schemaVersion: 1;
  protocol: typeof METHODOLOGY_ADJUDICATION_EFFECTIVE_PROTOCOL;
  runId: string;
  baseLedgerSha256: string;
  gradeSetSha256: string;
  records: MethodologyAdjudicationRecord[];
  resolutions: MethodologyAdjudicationResolution[];
  headResolutionSha256: string | null;
  unresolvedCount: number;
  effectiveSha256: string;
}

export interface ReadMethodologyAdjudicationResolutionInput {
  baseLedger: MethodologyAdjudicationLedger | unknown;
  /** The complete grade-set artifact from which truth versions are derived. */
  gradeSet: MethodologyGradeSetArtifact | unknown;
  /** The caller's observed head; null is the authenticated empty-chain head. */
  expectedHeadResolutionSha256: string | null;
  /** Permit an authenticated historical prefix for rederiving an older sealed decision. */
  allowHistoricalHead?: boolean;
}

export interface WriteMethodologyAdjudicationResolutionInput {
  baseLedger: MethodologyAdjudicationLedger | unknown;
  /** The complete grade-set artifact from which the appended truth is derived. */
  gradeSet: MethodologyGradeSetArtifact | unknown;
  occurrence: MethodologyAdjudicationOccurrenceIdentity;
  classification: ResolutionClassification;
  curatorIdentitySha256: string;
  reviewerIdentitySha256s: readonly string[];
  reviewerIndependence: "not-attested" | "operator-attested-independent";
  recordedAt: string;
  rationale: string;
  evidence: string;
  /** Required optimistic-concurrency guard for the append. */
  expectedHeadResolutionSha256: string | null;
}

export interface MethodologyAdjudicationResolutionChain {
  resolutions: MethodologyAdjudicationResolution[];
  headResolutionSha256: string | null;
  effective: MethodologyEffectiveAdjudication;
}

/** Return the canonical digest of one exact finding occurrence identity. */
export function methodologyAdjudicationOccurrenceSha256(
  occurrence: MethodologyAdjudicationOccurrenceIdentity,
): string {
  return canonicalJsonSha256(parseOccurrence(occurrence, "occurrence"));
}

/** Return the canonical digest of a resolution without its self-authenticating field. */
export function methodologyAdjudicationResolutionSha256(
  resolution: Omit<MethodologyAdjudicationResolution, "resolutionSha256">,
): string {
  return canonicalJsonSha256(resolution);
}

/** Build one authenticated append. Storage is performed by the write function below. */
export function buildMethodologyAdjudicationResolution(input: {
  baseLedger: MethodologyAdjudicationLedger | unknown;
  gradeSet: MethodologyGradeSetArtifact | unknown;
  sequence: number;
  previousResolutionSha256: string | null;
  occurrence: MethodologyAdjudicationOccurrenceIdentity;
  classification: ResolutionClassification;
  curatorIdentitySha256: string;
  reviewerIdentitySha256s: readonly string[];
  reviewerIndependence: "not-attested" | "operator-attested-independent";
  recordedAt: string;
  rationale: string;
  evidence: string;
}): MethodologyAdjudicationResolution {
  const base = parseBaseLedger(input.baseLedger);
  const gradeSet = authenticateGradeSetForBase(base, input.gradeSet);
  const occurrence = parseOccurrence(input.occurrence, "resolution occurrence");
  const sequence = boundedInteger(input.sequence, "resolution sequence", 1, MAX_RESOLUTIONS);
  const previousResolutionSha256 = input.previousResolutionSha256 === null
    ? null
    : digest(input.previousResolutionSha256, "previousResolutionSha256");
  if ((sequence === 1 && previousResolutionSha256 !== null) || (sequence > 1 && previousResolutionSha256 === null)) {
    throw new Error("resolution sequence and predecessor are inconsistent");
  }
  const classification = finalClassification(input.classification, "resolution classification");
  const reviewers = parseReviewers(
    input.reviewerIdentitySha256s,
    input.reviewerIndependence,
    "reviewerIdentitySha256s",
  );
  const body = {
    schemaVersion: 1 as const,
    protocol: METHODOLOGY_ADJUDICATION_RESOLUTION_PROTOCOL,
    runId: base.runId,
    baseLedgerSha256: base.ledgerSha256,
    gradeSetSha256: base.gradeSetSha256,
    sequence,
    previousResolutionSha256,
    occurrence,
    occurrenceSha256: methodologyAdjudicationOccurrenceSha256(occurrence),
    truthVersion: truthVersionForAttempt(gradeSet, occurrence.attemptId),
    classification,
    curatorIdentitySha256: digest(input.curatorIdentitySha256, "curatorIdentitySha256"),
    reviewerIdentitySha256s: reviewers.identities,
    reviewerIndependence: reviewers.independence,
    recordedAt: timestamp(input.recordedAt, "recordedAt"),
    rationale: boundedText(input.rationale, "rationale"),
    evidence: boundedText(input.evidence, "evidence"),
  };
  const resolution = { ...body, resolutionSha256: methodologyAdjudicationResolutionSha256(body) };
  assertNoSecrets(resolution, "methodology adjudication resolution");
  return resolution;
}

/** Append exactly one immutable resolution file and return the stored resolution. */
export function writeMethodologyAdjudicationResolution(
  rootDirectory: string,
  input: WriteMethodologyAdjudicationResolutionInput,
): MethodologyAdjudicationResolution {
  const root = resolve(rootDirectory);
  const base = parseBaseLedger(input.baseLedger);
  const gradeSet = authenticateGradeSetForBase(base, input.gradeSet);
  const chain = readResolutionFiles(root, base, gradeSet);
  const expectedHead = input.expectedHeadResolutionSha256;
  if (expectedHead !== chain.headResolutionSha256) {
    throw new Error("methodology adjudication resolution head digest does not match caller-held head");
  }
  const resolution = buildMethodologyAdjudicationResolution({
    baseLedger: base,
    gradeSet,
    sequence: chain.resolutions.length + 1,
    previousResolutionSha256: chain.headResolutionSha256,
    occurrence: input.occurrence,
    classification: input.classification,
    curatorIdentitySha256: input.curatorIdentitySha256,
    reviewerIdentitySha256s: input.reviewerIdentitySha256s,
    reviewerIndependence: input.reviewerIndependence,
    recordedAt: input.recordedAt,
    rationale: input.rationale,
    evidence: input.evidence,
  });
  assertResolutionTruthVersion(resolution, gradeSet);
  const key = occurrenceKey(resolution.occurrence);
  const unresolved = new Set(base.records.filter((record) => record.classification === "unresolved").map(occurrenceKey));
  if (!unresolved.has(key) || chain.resolutions.some((item) => occurrenceKey(item.occurrence) === key)) {
    throw new Error("methodology adjudication resolution occurrence is not currently unresolved");
  }
  const directory = ensureResolutionDirectory(root);
  writeExclusiveJson(root, join(directory, resolutionFilename(resolution.sequence)), resolution);
  return resolution;
}

/** Read, authenticate, and derive the effective adjudication view. */
export function readMethodologyAdjudicationResolutionChain(
  rootDirectory: string,
  input: ReadMethodologyAdjudicationResolutionInput,
): MethodologyAdjudicationResolutionChain {
  const base = parseBaseLedger(input.baseLedger);
  const gradeSet = authenticateGradeSetForBase(base, input.gradeSet);
  const chain = readResolutionFiles(resolve(rootDirectory), base, gradeSet);
  const resolutions = selectResolutionPrefix(
    chain.resolutions,
    input.expectedHeadResolutionSha256,
    input.allowHistoricalHead === true,
  );
  const headResolutionSha256 = resolutions.at(-1)?.resolutionSha256 ?? null;
  return {
    resolutions,
    headResolutionSha256,
    effective: deriveMethodologyEffectiveAdjudication(base, resolutions, gradeSet),
  };
}

function selectResolutionPrefix(
  resolutions: readonly MethodologyAdjudicationResolution[],
  expectedHeadResolutionSha256: string | null,
  allowHistoricalHead: boolean,
): MethodologyAdjudicationResolution[] {
  const latest = resolutions.at(-1)?.resolutionSha256 ?? null;
  if (!allowHistoricalHead) {
    if (expectedHeadResolutionSha256 !== latest) {
      throw new Error("methodology adjudication resolution head digest does not match caller-held head");
    }
    return [...resolutions];
  }
  if (expectedHeadResolutionSha256 === null) return [];
  const index = resolutions.findIndex(
    (resolution) => resolution.resolutionSha256 === expectedHeadResolutionSha256,
  );
  if (index < 0) {
    throw new Error("methodology adjudication historical head digest is not in the append-only chain");
  }
  return resolutions.slice(0, index + 1);
}

/** Convenience read that returns only the effective content-addressed view. */
export function readMethodologyEffectiveAdjudication(
  rootDirectory: string,
  input: ReadMethodologyAdjudicationResolutionInput,
): MethodologyEffectiveAdjudication {
  return readMethodologyAdjudicationResolutionChain(rootDirectory, input).effective;
}

/** Derive an effective view without changing or trusting mutable base records. */
export function deriveMethodologyEffectiveAdjudication(
  baseLedgerValue: MethodologyAdjudicationLedger | unknown,
  resolutionValues: readonly (MethodologyAdjudicationResolution | unknown)[],
  gradeSetValue: MethodologyGradeSetArtifact | unknown,
): MethodologyEffectiveAdjudication {
  const base = parseBaseLedger(baseLedgerValue);
  const gradeSet = authenticateGradeSetForBase(base, gradeSetValue);
  const resolutions = validateResolutionChain(base, resolutionValues, gradeSet);
  const byOccurrence = new Map(base.records.map((record) => [occurrenceKey(record), { ...record }]));
  for (const resolution of resolutions) {
    const current = byOccurrence.get(occurrenceKey(resolution.occurrence));
    if (!current || current.classification !== "unresolved") {
      throw new Error("methodology adjudication resolution occurrence is not currently unresolved");
    }
    byOccurrence.set(occurrenceKey(resolution.occurrence), {
      ...current,
      classification: resolution.classification,
      rationale: resolution.rationale,
      evidence: resolution.evidence,
    });
  }
  const records = base.records.map((record) => byOccurrence.get(occurrenceKey(record))!);
  const body = {
    schemaVersion: 1 as const,
    protocol: METHODOLOGY_ADJUDICATION_EFFECTIVE_PROTOCOL,
    runId: base.runId,
    baseLedgerSha256: base.ledgerSha256,
    gradeSetSha256: base.gradeSetSha256,
    records,
    resolutions,
    headResolutionSha256: resolutions.at(-1)?.resolutionSha256 ?? null,
    unresolvedCount: records.filter((record) => record.classification === "unresolved").length,
  };
  const effective = { ...body, effectiveSha256: canonicalJsonSha256(body) };
  assertNoSecrets(effective, "methodology effective adjudication");
  return effective;
}

/** Parse one stored resolution, rejecting unknown fields and stale self-digests. */
export function parseMethodologyAdjudicationResolution(
  value: unknown,
  source = "methodology adjudication resolution",
): MethodologyAdjudicationResolution {
  const root = exactObject(value, [
    "schemaVersion", "protocol", "runId", "baseLedgerSha256", "gradeSetSha256", "sequence",
    "previousResolutionSha256", "occurrence", "occurrenceSha256", "classification",
    "truthVersion", "curatorIdentitySha256", "reviewerIdentitySha256s", "reviewerIndependence",
    "recordedAt", "rationale", "evidence", "resolutionSha256",
  ], source);
  if (root.schemaVersion !== 1 || root.protocol !== METHODOLOGY_ADJUDICATION_RESOLUTION_PROTOCOL) {
    throw new Error(`${source} protocol/version is invalid`);
  }
  const reviewers = parseReviewers(
    root.reviewerIdentitySha256s,
    root.reviewerIndependence,
    `${source}.reviewerIdentitySha256s`,
  );
  const body = {
    schemaVersion: 1 as const,
    protocol: METHODOLOGY_ADJUDICATION_RESOLUTION_PROTOCOL,
    runId: runId(root.runId, `${source}.runId`),
    baseLedgerSha256: digest(root.baseLedgerSha256, `${source}.baseLedgerSha256`),
    gradeSetSha256: digest(root.gradeSetSha256, `${source}.gradeSetSha256`),
    sequence: boundedInteger(root.sequence, `${source}.sequence`, 1, MAX_RESOLUTIONS),
    previousResolutionSha256: root.previousResolutionSha256 === null
      ? null
      : digest(root.previousResolutionSha256, `${source}.previousResolutionSha256`),
    occurrence: parseOccurrence(root.occurrence, `${source}.occurrence`),
    occurrenceSha256: digest(root.occurrenceSha256, `${source}.occurrenceSha256`),
    truthVersion: boundedText(root.truthVersion, `${source}.truthVersion`, 256),
    classification: finalClassification(root.classification, `${source}.classification`),
    curatorIdentitySha256: digest(root.curatorIdentitySha256, `${source}.curatorIdentitySha256`),
    reviewerIdentitySha256s: reviewers.identities,
    reviewerIndependence: reviewers.independence,
    recordedAt: timestamp(root.recordedAt, `${source}.recordedAt`),
    rationale: boundedText(root.rationale, `${source}.rationale`),
    evidence: boundedText(root.evidence, `${source}.evidence`),
  };
  if (body.occurrenceSha256 !== methodologyAdjudicationOccurrenceSha256(body.occurrence)) {
    throw new Error(`${source}.occurrenceSha256 does not authenticate occurrence`);
  }
  const resolutionSha256 = digest(root.resolutionSha256, `${source}.resolutionSha256`);
  if (resolutionSha256 !== methodologyAdjudicationResolutionSha256(body)) {
    throw new Error(`${source}.resolutionSha256 does not authenticate contents`);
  }
  const parsed = { ...body, resolutionSha256 };
  assertNoSecrets(parsed, `${source} artifact`);
  return parsed;
}

function readResolutionFiles(
  root: string,
  base: MethodologyAdjudicationLedger,
  gradeSet: MethodologyGradeSetArtifact,
): {
  resolutions: MethodologyAdjudicationResolution[];
  headResolutionSha256: string | null;
} {
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("methodology run root must be a real directory");
  }
  const directory = join(root, METHODOLOGY_ADJUDICATION_RESOLUTION_DIRECTORY);
  let stat;
  try {
    stat = lstatSync(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { resolutions: [], headResolutionSha256: null };
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("methodology adjudication resolution directory must be a real directory");
  }
  const entries = readdirSync(directory, { withFileTypes: true });
  const numbered: Array<{ sequence: number; name: string }> = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error("methodology adjudication resolution directory contains a non-regular entry");
    }
    const match = RESOLUTION_FILENAME.exec(entry.name);
    if (!match) throw new Error("methodology adjudication resolution directory contains an unsupported file");
    const sequence = Number(match[1]);
    if (sequence < 1 || sequence > MAX_RESOLUTIONS) throw new Error("methodology adjudication resolution sequence is out of bounds");
    numbered.push({ sequence, name: entry.name });
  }
  numbered.sort((left, right) => left.sequence - right.sequence);
  const resolutions: MethodologyAdjudicationResolution[] = [];
  for (let index = 0; index < numbered.length; index += 1) {
    const item = numbered[index]!;
    const expectedSequence = index + 1;
    if (item.sequence !== expectedSequence) throw new Error("methodology adjudication resolutions must be contiguous");
    const resolution = parseMethodologyAdjudicationResolution(
      readExperimentJson(join(directory, item.name)),
      join(directory, item.name),
    );
    resolutions.push(resolution);
  }
  validateResolutionChain(base, resolutions, gradeSet);
  return { resolutions, headResolutionSha256: resolutions.at(-1)?.resolutionSha256 ?? null };
}

function validateResolutionChain(
  base: MethodologyAdjudicationLedger,
  values: readonly (MethodologyAdjudicationResolution | unknown)[],
  gradeSet: MethodologyGradeSetArtifact,
): MethodologyAdjudicationResolution[] {
  const resolutions = values.map((value, index) => parseMethodologyAdjudicationResolution(value, `resolution[${index}]`));
  const unresolved = new Set(base.records.filter((record) => record.classification === "unresolved").map(occurrenceKey));
  const seen = new Set<string>();
  let previous: string | null = null;
  let previousRecordedAt: string | null = null;
  for (let index = 0; index < resolutions.length; index += 1) {
    const resolution = resolutions[index]!;
    if (resolution.runId !== base.runId || resolution.baseLedgerSha256 !== base.ledgerSha256 ||
        resolution.gradeSetSha256 !== base.gradeSetSha256) {
      throw new Error("methodology adjudication resolution is stale or belongs to another run");
    }
    if (resolution.sequence !== index + 1 || resolution.previousResolutionSha256 !== previous) {
      throw new Error("methodology adjudication resolution sequence or predecessor is invalid");
    }
    if (previousRecordedAt !== null && resolution.recordedAt <= previousRecordedAt) {
      throw new Error("methodology adjudication resolution timestamps must increase with sequence");
    }
    if (resolution.occurrenceSha256 !== methodologyAdjudicationOccurrenceSha256(resolution.occurrence) ||
        !unresolved.has(occurrenceKey(resolution.occurrence)) ||
        seen.has(occurrenceKey(resolution.occurrence))) {
      throw new Error("methodology adjudication resolution occurrence is duplicate, stale, or not unresolved");
    }
    assertResolutionTruthVersion(resolution, gradeSet);
    seen.add(occurrenceKey(resolution.occurrence));
    unresolved.delete(occurrenceKey(resolution.occurrence));
    previous = resolution.resolutionSha256;
    previousRecordedAt = resolution.recordedAt;
  }
  return resolutions;
}

function assertResolutionTruthVersion(
  resolution: MethodologyAdjudicationResolution,
  gradeSet: MethodologyGradeSetArtifact,
): void {
  const expected = truthVersionForAttempt(gradeSet, resolution.occurrence.attemptId);
  if (expected !== resolution.truthVersion) {
    throw new Error("methodology adjudication resolution truth version does not match its authenticated grade");
  }
}

function parseBaseLedger(value: unknown): MethodologyAdjudicationLedger {
  const root = exactObject(value, [
    "schemaVersion", "protocol", "runId", "executionEvidenceSha256", "inputPlanSha256", "gradeSetSha256",
    "curatorIdentitySha256", "reviewProtocol", "records", "counts", "recordedAt", "ledgerSha256",
  ], "base methodology adjudication");
  if (root.schemaVersion !== 1 || root.protocol !== "historical-methodology-adjudication-v1") {
    throw new Error("base methodology adjudication must remain historical-methodology-adjudication-v1");
  }
  if (!Array.isArray(root.records)) throw new Error("base methodology adjudication records must be an array");
  if (!root.counts || typeof root.counts !== "object" || Array.isArray(root.counts)) throw new Error("base methodology adjudication counts are invalid");
  if (root.reviewProtocol !== "blind-to-arm-route-timing-v1") throw new Error("base methodology adjudication review protocol is invalid");
  const countsRoot = root.counts as Record<string, unknown>;
  exactObject(countsRoot, ["confirmed-new", "unsupported", "unresolved"], "base methodology adjudication counts");
  const records = root.records.map((item, index) => parseBaseRecord(item, `base methodology adjudication.records[${index}]`));
  const keys = records.map(occurrenceKey);
  if (new Set(keys).size !== keys.length) throw new Error("base methodology adjudication contains duplicate occurrences");
  for (let index = 1; index < records.length; index += 1) {
    const previous = records[index - 1]!;
    const current = records[index]!;
    if (previous.attemptId > current.attemptId ||
        (previous.attemptId === current.attemptId && previous.findingIndex > current.findingIndex)) {
      throw new Error("base methodology adjudication records are not deterministically sorted");
    }
  }
  const counts = {
    "confirmed-new": records.filter((record) => record.classification === "confirmed-new").length,
    unsupported: records.filter((record) => record.classification === "unsupported").length,
    unresolved: records.filter((record) => record.classification === "unresolved").length,
  };
  if (canonicalJson(countsRoot) !== canonicalJson(counts)) throw new Error("base methodology adjudication counts are invalid");
  const body = {
    schemaVersion: 1 as const,
    protocol: "historical-methodology-adjudication-v1" as const,
    runId: runId(root.runId, "base methodology adjudication.runId"),
    executionEvidenceSha256: digest(root.executionEvidenceSha256, "base executionEvidenceSha256"),
    inputPlanSha256: digest(root.inputPlanSha256, "base inputPlanSha256"),
    gradeSetSha256: digest(root.gradeSetSha256, "base gradeSetSha256"),
    curatorIdentitySha256: digest(root.curatorIdentitySha256, "base curatorIdentitySha256"),
    reviewProtocol: "blind-to-arm-route-timing-v1" as const,
    records,
    counts,
    recordedAt: timestamp(root.recordedAt, "base recordedAt"),
  };
  const ledgerSha256 = digest(root.ledgerSha256, "base ledgerSha256");
  if (ledgerSha256 !== canonicalJsonSha256(body)) throw new Error("base methodology adjudication ledger digest is invalid");
  return { ...body, ledgerSha256 };
}

function authenticateGradeSetForBase(
  base: MethodologyAdjudicationLedger,
  value: unknown,
): MethodologyGradeSetArtifact {
  const gradeSet = parseMethodologyGradeSetArtifact(value);
  if (gradeSet.runId !== base.runId ||
      gradeSet.executionEvidenceSha256 !== base.executionEvidenceSha256 ||
      gradeSet.inputPlanSha256 !== base.inputPlanSha256 ||
      gradeSet.gradeSetSha256 !== base.gradeSetSha256) {
    throw new Error("methodology adjudication grade-set artifact does not match base ledger");
  }
  return gradeSet;
}

function truthVersionForAttempt(gradeSet: MethodologyGradeSetArtifact, attemptId: string): string {
  const grade = gradeSet.grades.find((candidate) => candidate.projection.attemptId === attemptId);
  const truthVersion = grade?.metricEligibility.truthVersion;
  if (typeof truthVersion !== "string" || !TRUTH_VERSION.test(truthVersion)) {
    throw new Error("methodology adjudication grade-set artifact has no valid truth version for occurrence");
  }
  return truthVersion;
}

function parseBaseRecord(value: unknown, source: string): MethodologyAdjudicationRecord {
  const root = exactObject(value, ["attemptId", "findingIndex", "findingEvidenceSha256", "classification", "rationale", "evidence"], source);
  const classification = root.classification;
  if (classification !== "confirmed-new" && classification !== "unsupported" && classification !== "unresolved") {
    throw new Error(`${source}.classification is invalid`);
  }
  return {
    attemptId: attemptId(root.attemptId, `${source}.attemptId`),
    findingIndex: boundedInteger(root.findingIndex, `${source}.findingIndex`, 0, Number.MAX_SAFE_INTEGER),
    findingEvidenceSha256: digest(root.findingEvidenceSha256, `${source}.findingEvidenceSha256`),
    classification,
    rationale: boundedText(root.rationale, `${source}.rationale`),
    evidence: boundedText(root.evidence, `${source}.evidence`),
  };
}

function parseOccurrence(value: unknown, source: string): MethodologyAdjudicationOccurrenceIdentity {
  const root = exactObject(value, ["attemptId", "findingIndex", "findingEvidenceSha256"], source);
  return {
    attemptId: attemptId(root.attemptId, `${source}.attemptId`),
    findingIndex: boundedInteger(root.findingIndex, `${source}.findingIndex`, 0, Number.MAX_SAFE_INTEGER),
    findingEvidenceSha256: digest(root.findingEvidenceSha256, `${source}.findingEvidenceSha256`),
  };
}

function occurrenceKey(value: MethodologyAdjudicationOccurrenceIdentity | MethodologyAdjudicationRecord): string {
  return `${value.attemptId}\0${value.findingIndex}\0${value.findingEvidenceSha256}`;
}

function exactObject(value: unknown, keys: readonly string[], source: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`${source} has an invalid shape`);
  return value as Record<string, unknown>;
}

function digest(value: unknown, source: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${source} must be a lowercase SHA-256 digest`);
  return value;
}

function runId(value: unknown, source: string): string {
  if (typeof value !== "string" || !RUN_ID.test(value)) throw new Error(`${source} is invalid`);
  return value;
}

function attemptId(value: unknown, source: string): string {
  if (typeof value !== "string" || !ATTEMPT_ID.test(value)) throw new Error(`${source} is invalid`);
  return value;
}

function boundedInteger(value: unknown, source: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${source} must be a finite integer between ${minimum} and ${maximum}`);
  }
  return Number(value);
}

function boundedText(value: unknown, source: string, maximum = MAX_TEXT_LENGTH): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\0]/.test(value)) {
    throw new Error(`${source} must contain 1-${maximum} characters`);
  }
  return value;
}

function digestArray(value: unknown, source: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${source} must be a non-empty array`);
  const parsed = value.map((item, index) => digest(item, `${source}[${index}]`)).sort();
  if (new Set(parsed).size !== parsed.length) throw new Error(`${source} contains duplicates`);
  return parsed;
}

function reviewerIndependence(value: unknown): MethodologyAdjudicationResolution["reviewerIndependence"] {
  if (value !== "not-attested" && value !== "operator-attested-independent") {
    throw new Error("reviewerIndependence is invalid");
  }
  return value;
}

function parseReviewers(
  identitiesValue: unknown,
  independenceValue: unknown,
  source: string,
): {
  identities: string[];
  independence: MethodologyAdjudicationResolution["reviewerIndependence"];
} {
  const identities = digestArray(identitiesValue, source);
  const independence = reviewerIndependence(independenceValue);
  if (independence === "operator-attested-independent" && identities.length < 2) {
    throw new Error("independently attested adjudication requires at least two reviewer identities");
  }
  return { identities, independence };
}

function timestamp(value: unknown, source: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`${source} must be a canonical timestamp`);
  }
  return value;
}

function finalClassification(value: unknown, source: string): ResolutionClassification {
  if (value !== "confirmed-new" && value !== "unsupported") throw new Error(`${source} must be final`);
  return value;
}

function resolutionFilename(sequence: number): string {
  return `resolution-${String(sequence).padStart(6, "0")}.json`;
}

function ensureResolutionDirectory(root: string): string {
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("methodology run root must be a real directory");
  }
  const directory = join(root, METHODOLOGY_ADJUDICATION_RESOLUTION_DIRECTORY);
  if (!existsSync(directory)) mkdirSync(directory);
  const stat = lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("methodology adjudication resolution directory must be a real directory");
  return directory;
}
