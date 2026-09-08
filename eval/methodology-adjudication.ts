import { canonicalJsonSha256 } from "./experiment.js";
import {
  methodologyAttemptGradeSha256,
  type MethodologyAttemptGrade,
} from "./methodology-grading-contract.js";

export const METHODOLOGY_ADJUDICATION_PROTOCOL = "historical-methodology-adjudication-v1" as const;
const SHA256 = /^[a-f0-9]{64}$/;
const ATTEMPT_ID = /^attempt-[0-9]{6}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type MethodologyAdjudicationClassification = "confirmed-new" | "unsupported" | "unresolved";

export interface MethodologyAdjudicationRecord {
  attemptId: string;
  findingIndex: number;
  findingEvidenceSha256: string;
  classification: MethodologyAdjudicationClassification;
  rationale: string;
  evidence: string;
}

export interface MethodologyAdjudicationLedger {
  schemaVersion: 1;
  protocol: typeof METHODOLOGY_ADJUDICATION_PROTOCOL;
  runId: string;
  executionEvidenceSha256: string;
  inputPlanSha256: string;
  gradeSetSha256: string;
  curatorIdentitySha256: string;
  reviewProtocol: "blind-to-arm-route-timing-v1";
  records: MethodologyAdjudicationRecord[];
  counts: Record<MethodologyAdjudicationClassification, number>;
  recordedAt: string;
  ledgerSha256: string;
}

export function validateMethodologyGradeSet(input: {
  executionEvidenceSha256: string;
  inputPlanSha256: string;
  expectedAttemptIds: readonly string[];
  grades: readonly MethodologyAttemptGrade[];
}): { grades: MethodologyAttemptGrade[]; gradeSetSha256: string } {
  const executionEvidenceSha256 = digest(input.executionEvidenceSha256, "executionEvidenceSha256");
  const inputPlanSha256 = digest(input.inputPlanSha256, "inputPlanSha256");
  const validated = input.grades.map((grade) => ({ grade, identity: validateGrade(grade) }))
    .sort((left, right) => left.identity.attemptId.localeCompare(right.identity.attemptId));
  const gradeAttemptIds = validated.map((item) => item.identity.attemptId);
  if (validated.length === 0 || new Set(gradeAttemptIds).size !== validated.length) {
    throw new Error("methodology adjudication requires unique grades");
  }
  if (!Array.isArray(input.expectedAttemptIds) || input.expectedAttemptIds.some((id) => !ATTEMPT_ID.test(id)) ||
      new Set(input.expectedAttemptIds).size !== input.expectedAttemptIds.length ||
      JSON.stringify([...input.expectedAttemptIds].sort()) !== JSON.stringify(gradeAttemptIds)) {
    throw new Error("methodology adjudication requires exactly every scheduled grade");
  }
  if (validated.some(({ identity }) => identity.executionEvidenceSha256 !== executionEvidenceSha256 ||
      identity.inputPlanSha256 !== inputPlanSha256)) {
    throw new Error("methodology adjudication grades do not belong to the bound run");
  }
  const grades = validated.map((item) => item.grade);
  const gradeSetSha256 = canonicalJsonSha256(validated.map(({ identity }) => ({
    attemptId: identity.attemptId,
    gradeSha256: identity.gradeSha256,
  })));
  return { grades, gradeSetSha256 };
}

export function buildMethodologyAdjudicationLedger(input: {
  runId: string;
  executionEvidenceSha256: string;
  inputPlanSha256: string;
  expectedAttemptIds: readonly string[];
  grades: readonly MethodologyAttemptGrade[];
  curatorIdentitySha256: string;
  reviewProtocol: "blind-to-arm-route-timing-v1";
  records: readonly MethodologyAdjudicationRecord[];
  recordedAt: string;
}): MethodologyAdjudicationLedger {
  if (!RUN_ID.test(input.runId)) throw new Error("methodology adjudication runId is invalid");
  const executionEvidenceSha256 = digest(input.executionEvidenceSha256, "executionEvidenceSha256");
  const inputPlanSha256 = digest(input.inputPlanSha256, "inputPlanSha256");
  const curatorIdentitySha256 = digest(input.curatorIdentitySha256, "curatorIdentitySha256");
  if (input.reviewProtocol !== "blind-to-arm-route-timing-v1") {
    throw new Error("methodology adjudication must remain blind to arm, route, and timing");
  }
  const { gradeSetSha256 } = validateMethodologyGradeSet({
    executionEvidenceSha256,
    inputPlanSha256,
    expectedAttemptIds: input.expectedAttemptIds,
    grades: input.grades,
  });
  const records = input.records.map(parseRecord).sort(compareRecord);
  const recordKeys = records.map(adjudicationKey);
  if (new Set(recordKeys).size !== recordKeys.length) {
    throw new Error("methodology adjudication contains a duplicate finding decision");
  }
  const required = input.grades.flatMap((grade) => grade.unmatchedFindings.map((finding) => ({
    attemptId: grade.projection.attemptId,
    findingIndex: finding.findingIndex,
    findingEvidenceSha256: finding.findingEvidenceSha256,
  }))).sort(compareRecord);
  const requiredKeys = required.map(adjudicationKey);
  if (JSON.stringify(recordKeys) !== JSON.stringify(requiredKeys)) {
    throw new Error("methodology adjudication must decide every and only unmatched finding occurrence");
  }
  const recordedAt = timestamp(input.recordedAt, "recordedAt");
  const counts = {
    "confirmed-new": records.filter((item) => item.classification === "confirmed-new").length,
    unsupported: records.filter((item) => item.classification === "unsupported").length,
    unresolved: records.filter((item) => item.classification === "unresolved").length,
  };
  const body = {
    schemaVersion: 1 as const,
    protocol: METHODOLOGY_ADJUDICATION_PROTOCOL,
    runId: input.runId,
    executionEvidenceSha256,
    inputPlanSha256,
    gradeSetSha256,
    curatorIdentitySha256,
    reviewProtocol: input.reviewProtocol,
    records,
    counts,
    recordedAt,
  };
  return { ...body, ledgerSha256: canonicalJsonSha256(body) };
}

export function methodologyAdjudicationMap(ledger: MethodologyAdjudicationLedger): ReadonlyMap<string, MethodologyAdjudicationClassification> {
  return new Map(ledger.records.map((record) => [adjudicationKey(record), record.classification]));
}

export function adjudicationKey(record: Pick<MethodologyAdjudicationRecord,
  "attemptId" | "findingIndex" | "findingEvidenceSha256">): string {
  return `${record.attemptId}\0${record.findingIndex}\0${record.findingEvidenceSha256}`;
}

function validateGrade(grade: MethodologyAttemptGrade) {
  if (!grade || typeof grade !== "object" || grade.schemaVersion !== 1 ||
      grade.protocol !== "historical-methodology-grading-v1") {
    throw new Error("methodology adjudication grade is invalid");
  }
  const { gradeSha256, ...body } = grade;
  if (digest(gradeSha256, "gradeSha256") !== methodologyAttemptGradeSha256(body)) {
    throw new Error("methodology adjudication grade digest is invalid");
  }
  if (!ATTEMPT_ID.test(grade.projection.attemptId)) throw new Error("methodology adjudication attempt ID is invalid");
  return {
    attemptId: grade.projection.attemptId,
    executionEvidenceSha256: grade.projection.executionEvidenceSha256,
    inputPlanSha256: grade.projection.inputPlanSha256,
    gradeSha256,
  };
}

function parseRecord(record: MethodologyAdjudicationRecord): MethodologyAdjudicationRecord {
  if (!record || typeof record !== "object" || Object.keys(record).sort().join("\0") !== [
    "attemptId", "classification", "evidence", "findingEvidenceSha256", "findingIndex", "rationale",
  ].sort().join("\0")) throw new Error("methodology adjudication record has an invalid shape");
  if (!ATTEMPT_ID.test(record.attemptId) || !Number.isSafeInteger(record.findingIndex) || record.findingIndex < 0) {
    throw new Error("methodology adjudication record identity is invalid");
  }
  digest(record.findingEvidenceSha256, "findingEvidenceSha256");
  if (record.classification !== "confirmed-new" && record.classification !== "unsupported" &&
      record.classification !== "unresolved") throw new Error("methodology adjudication classification is invalid");
  return {
    ...record,
    rationale: boundedText(record.rationale, "rationale"),
    evidence: boundedText(record.evidence, "evidence"),
  };
}

function compareRecord(left: Pick<MethodologyAdjudicationRecord, "attemptId" | "findingIndex">,
  right: Pick<MethodologyAdjudicationRecord, "attemptId" | "findingIndex">): number {
  return left.attemptId.localeCompare(right.attemptId) || left.findingIndex - right.findingIndex;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
  return value;
}

function boundedText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4_000) {
    throw new Error(`${label} must contain 1-4000 characters`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`${label} must be a canonical timestamp`);
  }
  return value;
}
