import { join } from "node:path";
import { assertNoSecrets } from "../src/security/secrets.js";
import {
  canonicalJson,
  canonicalJsonSha256,
  readExperimentJson,
  writeExclusiveJson,
} from "./experiment.js";
import {
  buildMethodologyAdjudicationLedger,
  validateMethodologyGradeSet,
  type MethodologyAdjudicationLedger,
  type MethodologyAdjudicationRecord,
} from "./methodology-adjudication.js";
import type { MethodologyAttemptGrade } from "./methodology-grading-contract.js";
import { buildMethodologyReport, type MethodologyReport } from "./methodology-report.js";
import { parseMethodologySchedule, type MethodologySchedule } from "./methodology-schedule.js";

export const METHODOLOGY_GRADE_SET_FILE = "methodology-grade-set.json";
export const METHODOLOGY_ADJUDICATION_FILE = "methodology-adjudication.json";
export const METHODOLOGY_REPORT_FILE = "methodology-report.json";

export interface MethodologyGradeSetArtifact {
  schemaVersion: 1;
  protocol: "historical-methodology-grade-set-v1";
  runId: string;
  schedule: MethodologySchedule;
  executionEvidenceSha256: string;
  inputPlanSha256: string;
  gradeSetSha256: string;
  grades: MethodologyAttemptGrade[];
  recordedAt: string;
  artifactSha256: string;
}

export function writeMethodologyGradeSet(root: string, input: {
  runId: string;
  schedule: unknown;
  executionEvidenceSha256: string;
  inputPlanSha256: string;
  grades: readonly MethodologyAttemptGrade[];
  recordedAt: string;
}): MethodologyGradeSetArtifact {
  const artifact = buildGradeSet(input);
  assertNoSecrets(artifact, "methodology grade set");
  writeExclusiveJson(root, join(root, METHODOLOGY_GRADE_SET_FILE), artifact);
  return artifact;
}

export function readMethodologyGradeSet(root: string, expectedArtifactSha256: string): MethodologyGradeSetArtifact {
  const raw = readExperimentJson(join(root, METHODOLOGY_GRADE_SET_FILE)) as MethodologyGradeSetArtifact;
  const schedule = readScheduleFromGradeSet(raw);
  const artifact = buildGradeSet({
    runId: raw.runId,
    schedule,
    executionEvidenceSha256: raw.executionEvidenceSha256,
    inputPlanSha256: raw.inputPlanSha256,
    grades: raw.grades,
    recordedAt: raw.recordedAt,
  });
  if (artifact.artifactSha256 !== expectedArtifactSha256 || canonicalJson(artifact) !== canonicalJson(raw)) {
    throw new Error("methodology grade-set artifact digest mismatch");
  }
  return artifact;
}

export function writeMethodologyAdjudicationArtifact(root: string, input: {
  gradeSet: MethodologyGradeSetArtifact;
  curatorIdentitySha256: string;
  records: readonly MethodologyAdjudicationRecord[];
  recordedAt: string;
}): MethodologyAdjudicationLedger {
  const ledger = buildMethodologyAdjudicationLedger({
    runId: input.gradeSet.runId,
    executionEvidenceSha256: input.gradeSet.executionEvidenceSha256,
    inputPlanSha256: input.gradeSet.inputPlanSha256,
    expectedAttemptIds: input.gradeSet.schedule.attempts.map((attempt) => attempt.id),
    grades: input.gradeSet.grades,
    curatorIdentitySha256: input.curatorIdentitySha256,
    reviewProtocol: "blind-to-arm-route-timing-v1",
    records: input.records,
    recordedAt: input.recordedAt,
  });
  if (ledger.gradeSetSha256 !== input.gradeSet.gradeSetSha256) {
    throw new Error("methodology adjudication does not match grade-set artifact");
  }
  assertNoSecrets(ledger, "methodology adjudication");
  writeExclusiveJson(root, join(root, METHODOLOGY_ADJUDICATION_FILE), ledger);
  return ledger;
}

export function readMethodologyAdjudicationArtifact(root: string, input: {
  expectedLedgerSha256: string;
  gradeSet: MethodologyGradeSetArtifact;
}): MethodologyAdjudicationLedger {
  const raw = readExperimentJson(join(root, METHODOLOGY_ADJUDICATION_FILE)) as MethodologyAdjudicationLedger;
  const ledger = buildMethodologyAdjudicationLedger({
    runId: raw.runId,
    executionEvidenceSha256: raw.executionEvidenceSha256,
    inputPlanSha256: raw.inputPlanSha256,
    expectedAttemptIds: input.gradeSet.schedule.attempts.map((attempt) => attempt.id),
    grades: input.gradeSet.grades,
    curatorIdentitySha256: raw.curatorIdentitySha256,
    reviewProtocol: raw.reviewProtocol,
    records: raw.records,
    recordedAt: raw.recordedAt,
  });
  if (ledger.ledgerSha256 !== input.expectedLedgerSha256 ||
      ledger.gradeSetSha256 !== input.gradeSet.gradeSetSha256 ||
      canonicalJson(ledger) !== canonicalJson(raw)) {
    throw new Error("methodology adjudication artifact digest mismatch");
  }
  return ledger;
}

export function writeMethodologyReportArtifact(root: string, input: {
  schedule: unknown;
  gradeSet: MethodologyGradeSetArtifact;
  adjudication: MethodologyAdjudicationLedger;
}): MethodologyReport {
  const report = buildMethodologyReport({
    runId: input.gradeSet.runId,
    schedule: input.schedule,
    executionEvidenceSha256: input.gradeSet.executionEvidenceSha256,
    inputPlanSha256: input.gradeSet.inputPlanSha256,
    grades: input.gradeSet.grades,
    adjudication: input.adjudication,
  });
  assertNoSecrets(report, "methodology report");
  writeExclusiveJson(root, join(root, METHODOLOGY_REPORT_FILE), report);
  return report;
}

export function readMethodologyReportArtifact(root: string, input: {
  expectedReportSha256: string;
  gradeSet: MethodologyGradeSetArtifact;
  adjudication: MethodologyAdjudicationLedger;
}): MethodologyReport {
  const raw = readExperimentJson(join(root, METHODOLOGY_REPORT_FILE)) as MethodologyReport;
  const report = buildMethodologyReport({
    runId: input.gradeSet.runId,
    schedule: input.gradeSet.schedule,
    executionEvidenceSha256: input.gradeSet.executionEvidenceSha256,
    inputPlanSha256: input.gradeSet.inputPlanSha256,
    grades: input.gradeSet.grades,
    adjudication: input.adjudication,
  });
  if (report.reportSha256 !== input.expectedReportSha256 || canonicalJson(report) !== canonicalJson(raw)) {
    throw new Error("methodology report artifact digest mismatch");
  }
  return report;
}

function buildGradeSet(input: {
  runId: string;
  schedule: unknown;
  executionEvidenceSha256: string;
  inputPlanSha256: string;
  grades: readonly MethodologyAttemptGrade[];
  recordedAt: string;
}): MethodologyGradeSetArtifact {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.runId)) throw new Error("methodology grade-set runId is invalid");
  const schedule = parseMethodologySchedule(input.schedule, "methodology grade-set schedule");
  const { grades, gradeSetSha256 } = validateMethodologyGradeSet({
    executionEvidenceSha256: input.executionEvidenceSha256,
    inputPlanSha256: input.inputPlanSha256,
    expectedAttemptIds: schedule.attempts.map((attempt) => attempt.id),
    grades: input.grades,
  });
  const recordedAt = timestamp(input.recordedAt);
  const body = {
    schemaVersion: 1 as const,
    protocol: "historical-methodology-grade-set-v1" as const,
    runId: input.runId,
    schedule,
    executionEvidenceSha256: input.executionEvidenceSha256,
    inputPlanSha256: input.inputPlanSha256,
    gradeSetSha256,
    grades,
    recordedAt,
  };
  const artifactSha256 = canonicalJsonSha256(body);
  return { ...body, artifactSha256 };
}

function readScheduleFromGradeSet(raw: MethodologyGradeSetArtifact): MethodologySchedule {
  const value = raw as MethodologyGradeSetArtifact & { schedule?: unknown };
  if (!value.schedule) throw new Error("methodology grade-set artifact is missing its schedule");
  return parseMethodologySchedule(value.schedule, "methodology grade-set stored schedule");
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error("methodology grade-set recordedAt must be a canonical timestamp");
  }
  return value;
}
