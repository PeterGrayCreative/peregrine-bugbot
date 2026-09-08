import { join } from "node:path";
import { assertNoSecrets } from "../src/security/secrets.js";
import {
  canonicalJson,
  canonicalJsonSha256,
  readExperimentJson,
  writeExclusiveJson,
} from "./experiment.js";
import {
  validateMethodologyGradeSet,
} from "./methodology-adjudication.js";
import {
  writeMethodologyGradeSet,
  type MethodologyGradeSetArtifact,
} from "./methodology-analysis-artifacts.js";
import {
  methodologyAttemptGradeSha256,
  methodologyFindingEvidenceSha256,
  methodologyGradingProjectionSha256,
  type MethodologyAttemptGrade,
} from "./methodology-grading-contract.js";
import {
  METHODOLOGY_SEALED_JUDGE_GRADING_PROTOCOL,
  gradeMethodologySealedJudge,
  type MethodologySealedJudgeGradeSet,
} from "./methodology-judge-grading.js";
import {
  readMethodologyJudgeBinding,
  type MethodologyJudgeBinding,
  type MethodologyJudgeBindingReadInputs,
} from "./methodology-judge-binding.js";
import { parseMethodologyReviewOutput } from "./methodology-output.js";
import { parseMethodologySchedule } from "./methodology-schedule.js";

export const METHODOLOGY_SEALED_JUDGE_GRADE_SET_FILE =
  "methodology-sealed-judge-grade-set.json";

const SHA256 = /^[a-f0-9]{64}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ATTEMPT_ID = /^attempt-[0-9]{6}$/;
const CASE_NAME = /^(?:development|validation)\/case-[a-f0-9]{8,32}$/;
const TRUTH_VERSION = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const METRICS = [
  "registered-known-root-recall", "total-recall", "emitted-finding-adjudication",
  "novel-discovery", "completion", "resource-use", "global-clean-specificity",
] as const;
const METRIC_REASONS = new Set([
  "registered-roots-only", "partial-truth-blocks-total-recall",
  "reviewed-comparison-has-no-registered-roots", "all-emitted-findings-require-adjudication",
  "discovery-is-separate-from-frozen-known-roots", "scheduled-review-accounting",
  "partial-truth-is-not-global-cleanliness", "empty-denominator", "no-scheduled-reviews",
]);

const SEALED_KEYS = [
  "schemaVersion", "protocol", "runId", "executionEvidenceSha256",
  "invocationRegistrationSha256", "inputPlanSha256", "projectionSetSha256",
  "occurrenceArtifactSha256", "judgeManifestSha256", "judgeTerminalSealSha256",
  "judgeConfigSha256", "grades", "gradeSetSha256", "claims", "artifactSha256",
] as const;

const GRADE_KEYS = [
  "schemaVersion", "protocol", "projection", "projectionSha256", "judgeConfigSha256",
  "findings", "pairVerdicts", "observationMatches", "rootCauseMatches",
  "rootMissAttribution", "unmatchedFindings", "completion", "metricEligibility",
  "claims", "gradeSha256",
] as const;

const PROJECTION_KEYS = [
  "schemaVersion", "kind", "executionEvidenceSha256", "inputPlanSha256",
  "caseRegistrationSha256", "truthSha256", "truthScopeSha256", "attemptId",
  "caseName", "status", "statusReason", "lifecycleTerminalSha256",
  "reviewTerminalSha256", "reviewRawOutputSha256", "reviewOutputSha256",
] as const;

export interface MethodologySealedJudgeDerivationInputs extends
  Omit<MethodologyJudgeBindingReadInputs, "expectedBindingSha256"> {
  expectedJudgeBindingSha256: string;
}

/**
 * Persist only grades rederived from a caller-anchored judge binding and its
 * definitive ledger. No caller-supplied grade set is accepted.
 */
export function writeMethodologySealedJudgeGradeSet(
  analysisRoot: string,
  input: MethodologySealedJudgeDerivationInputs,
): MethodologySealedJudgeGradeSet {
  const validated = deriveBoundSealedGradeSet(analysisRoot, input);
  assertNoSecrets(validated, "methodology sealed judge grade set");
  writeExclusiveJson(analysisRoot, join(analysisRoot, METHODOLOGY_SEALED_JUDGE_GRADE_SET_FILE), validated);
  return validated;
}

/**
 * Check stored bytes, structure, and caller digest only. This raw reader does
 * not establish judge-ledger or source provenance; use the deriving writer or
 * legacy bridge for authenticated analysis.
 */
export function readMethodologySealedJudgeGradeSet(
  root: string,
  expectedArtifactSha256: string,
): MethodologySealedJudgeGradeSet {
  digest(expectedArtifactSha256, "expectedArtifactSha256");
  const raw = readExperimentJson(join(root, METHODOLOGY_SEALED_JUDGE_GRADE_SET_FILE));
  const validated = validateSealedGradeSet(raw);
  if (validated.artifactSha256 !== expectedArtifactSha256) {
    throw new Error("methodology sealed judge grade-set caller digest mismatch");
  }
  assertNoSecrets(validated, "methodology sealed judge grade set");
  return validated;
}

/**
 * Deterministically bridge authenticated sealed grades into the existing v1
 * artifact so legacy report/adjudication readers remain unchanged.
 */
export function writeMethodologyGradeSetFromSealedJudge(root: string, input: {
  expectedSealedGradeSetArtifactSha256: string;
  schedule: unknown;
  recordedAt: string;
} & MethodologySealedJudgeDerivationInputs): MethodologyGradeSetArtifact {
  const stored = readMethodologySealedJudgeGradeSet(
    root,
    input.expectedSealedGradeSetArtifactSha256,
  );
  const sealed = deriveBoundSealedGradeSet(root, input);
  if (canonicalJson(stored) !== canonicalJson(sealed)) {
    throw new Error("stored sealed judge grade set differs from authenticated derivation");
  }
  const schedule = parseMethodologySchedule(input.schedule, "sealed judge legacy bridge schedule");
  const validation = validateMethodologyGradeSet({
    executionEvidenceSha256: sealed.executionEvidenceSha256,
    inputPlanSha256: sealed.inputPlanSha256,
    expectedAttemptIds: schedule.attempts.map((attempt) => attempt.id),
    grades: sealed.grades,
  });
  if (validation.gradeSetSha256 !== sealed.gradeSetSha256 ||
      canonicalJson(validation.grades) !== canonicalJson(sealed.grades)) {
    throw new Error("sealed judge grades do not match the legacy bridge schedule");
  }
  const artifact = writeMethodologyGradeSet(root, {
    runId: sealed.runId,
    schedule,
    executionEvidenceSha256: sealed.executionEvidenceSha256,
    inputPlanSha256: sealed.inputPlanSha256,
    grades: validation.grades,
    recordedAt: input.recordedAt,
  });
  assertLegacyMethodologyGradeSetMatchesSealed(artifact, sealed);
  return artifact;
}

function deriveBoundSealedGradeSet(
  analysisRoot: string,
  input: MethodologySealedJudgeDerivationInputs,
): MethodologySealedJudgeGradeSet {
  digest(input.expectedJudgeBindingSha256, "expectedJudgeBindingSha256");
  const binding = readMethodologyJudgeBinding(analysisRoot, {
    ...input,
    expectedBindingSha256: input.expectedJudgeBindingSha256,
  });
  const gradeSet = validateSealedGradeSet(gradeMethodologySealedJudge(input));
  assertGradeSetMatchesBinding(gradeSet, binding);
  return gradeSet;
}

function assertGradeSetMatchesBinding(
  gradeSet: MethodologySealedJudgeGradeSet,
  binding: MethodologyJudgeBinding,
): void {
  if (gradeSet.runId !== binding.runId ||
      gradeSet.executionEvidenceSha256 !== binding.executionEvidenceSha256 ||
      gradeSet.invocationRegistrationSha256 !== binding.invocationRegistrationSha256 ||
      gradeSet.inputPlanSha256 !== binding.inputPlanSha256 ||
      gradeSet.projectionSetSha256 !== binding.projectionSetSha256 ||
      gradeSet.occurrenceArtifactSha256 !== binding.occurrenceArtifactSha256 ||
      gradeSet.judgeManifestSha256 !== binding.judgeManifestSha256 ||
      gradeSet.judgeTerminalSealSha256 !== binding.judgeTerminalSealSha256) {
    throw new Error("sealed judge grade set does not match authenticated judge binding");
  }
}

/** Prove that a legacy artifact is an exact projection of the sealed grades. */
export function assertLegacyMethodologyGradeSetMatchesSealed(
  legacy: MethodologyGradeSetArtifact,
  sealedValue: unknown,
): void {
  const sealed = validateSealedGradeSet(sealedValue);
  if (legacy.runId !== sealed.runId ||
      legacy.executionEvidenceSha256 !== sealed.executionEvidenceSha256 ||
      legacy.inputPlanSha256 !== sealed.inputPlanSha256 ||
      legacy.gradeSetSha256 !== sealed.gradeSetSha256 ||
      canonicalJson(legacy.grades) !== canonicalJson(sealed.grades)) {
    throw new Error("legacy methodology grade set does not exactly match sealed judge grades");
  }
}

function validateSealedGradeSet(value: unknown): MethodologySealedJudgeGradeSet {
  const item = exactObject(value, SEALED_KEYS, "methodology sealed judge grade set");
  if (item.schemaVersion !== 1 || item.protocol !== METHODOLOGY_SEALED_JUDGE_GRADING_PROTOCOL) {
    throw new Error("methodology sealed judge grade-set protocol is invalid");
  }
  if (typeof item.runId !== "string" || !RUN_ID.test(item.runId)) {
    throw new Error("methodology sealed judge grade-set runId is invalid");
  }
  for (const field of [
    "executionEvidenceSha256", "invocationRegistrationSha256", "inputPlanSha256",
    "projectionSetSha256", "occurrenceArtifactSha256", "judgeManifestSha256",
    "judgeTerminalSealSha256", "judgeConfigSha256", "gradeSetSha256", "artifactSha256",
  ] as const) digest(item[field], `methodology sealed judge grade set.${field}`);
  if (!Array.isArray(item.grades) || item.grades.length === 0) {
    throw new Error("methodology sealed judge grade set requires grades");
  }
  const grades = item.grades.map((grade, index) => validateGrade(grade, index));
  const attemptIds = grades.map((grade) => grade.projection.attemptId);
  if (new Set(attemptIds).size !== grades.length ||
      canonicalJson(attemptIds) !== canonicalJson([...attemptIds].sort())) {
    throw new Error("methodology sealed judge grades must be unique and sorted by attempt ID");
  }
  if (grades.some((grade) =>
    grade.projection.executionEvidenceSha256 !== item.executionEvidenceSha256 ||
    grade.projection.inputPlanSha256 !== item.inputPlanSha256 ||
    grade.judgeConfigSha256 !== item.judgeConfigSha256)) {
    throw new Error("methodology sealed judge grade is not bound to the grade set");
  }
  const gradeSetSha256 = canonicalJsonSha256(grades.map((grade) => ({
    attemptId: grade.projection.attemptId,
    gradeSha256: grade.gradeSha256,
  })));
  if (gradeSetSha256 !== item.gradeSetSha256) {
    throw new Error("methodology sealed judge grade-set digest is invalid");
  }
  const claims = exactObject(item.claims, [
    "verdictSource", "semanticCorrectness", "humanCalibration",
  ], "methodology sealed judge grade-set claims");
  if (claims.verdictSource !== "completed-sealed-semantic-judge-ledger" ||
      claims.semanticCorrectness !== "not-established" || claims.humanCalibration !== "required") {
    throw new Error("methodology sealed judge grade-set claims are invalid");
  }
  const body = {
    schemaVersion: 1 as const,
    protocol: METHODOLOGY_SEALED_JUDGE_GRADING_PROTOCOL,
    runId: item.runId,
    executionEvidenceSha256: item.executionEvidenceSha256 as string,
    invocationRegistrationSha256: item.invocationRegistrationSha256 as string,
    inputPlanSha256: item.inputPlanSha256 as string,
    projectionSetSha256: item.projectionSetSha256 as string,
    occurrenceArtifactSha256: item.occurrenceArtifactSha256 as string,
    judgeManifestSha256: item.judgeManifestSha256 as string,
    judgeTerminalSealSha256: item.judgeTerminalSealSha256 as string,
    judgeConfigSha256: item.judgeConfigSha256 as string,
    grades,
    gradeSetSha256,
    claims: {
      verdictSource: "completed-sealed-semantic-judge-ledger" as const,
      semanticCorrectness: "not-established" as const,
      humanCalibration: "required" as const,
    },
  };
  const artifactSha256 = canonicalJsonSha256(body);
  if (artifactSha256 !== item.artifactSha256 || canonicalJson({ ...body, artifactSha256 }) !== canonicalJson(value)) {
    throw new Error("methodology sealed judge grade-set artifact digest is invalid");
  }
  return { ...body, artifactSha256 };
}

function validateGrade(value: unknown, index: number): MethodologyAttemptGrade {
  const label = `methodology sealed judge grade set.grades[${index}]`;
  const item = exactObject(value, GRADE_KEYS, label);
  if (item.schemaVersion !== 1 || item.protocol !== "historical-methodology-grading-v1") {
    throw new Error(`${label} protocol is invalid`);
  }
  const projection = validateProjection(item.projection, `${label}.projection`);
  digest(item.projectionSha256, `${label}.projectionSha256`);
  if (item.projectionSha256 !== methodologyGradingProjectionSha256(projection)) {
    throw new Error(`${label} projection digest is invalid`);
  }
  digest(item.judgeConfigSha256, `${label}.judgeConfigSha256`);

  if (!Array.isArray(item.findings)) throw new Error(`${label}.findings must be an array`);
  const findings = item.findings.map((finding, findingIndex) => {
    const parsed = exactObject(finding, [
      "file", "startLine", "endLine", "explanation", "impact", "severity",
      "findingIndex", "evidenceSha256",
    ], `${label}.findings[${findingIndex}]`);
    if (parsed.findingIndex !== findingIndex) throw new Error(`${label}.findings must use canonical indexes`);
    digest(parsed.evidenceSha256, `${label}.findings[${findingIndex}].evidenceSha256`);
    const neutral = parseMethodologyReviewOutput({
      status: "completed", limitations: [], findings: [{
        file: parsed.file, startLine: parsed.startLine, endLine: parsed.endLine,
        explanation: parsed.explanation, impact: parsed.impact, severity: parsed.severity,
      }],
    }).findings[0]!;
    if (parsed.evidenceSha256 !== methodologyFindingEvidenceSha256(neutral)) {
      throw new Error(`${label}.findings[${findingIndex}] evidence digest is invalid`);
    }
    return { ...neutral, findingIndex, evidenceSha256: parsed.evidenceSha256 as string };
  });

  if (!Array.isArray(item.pairVerdicts)) throw new Error(`${label}.pairVerdicts must be an array`);
  const pairVerdicts = item.pairVerdicts.map((verdict, verdictIndex) => {
    const parsed = exactObject(verdict, [
      "comparisonId", "bugId", "findingIndex", "findingEvidenceSha256", "verdict",
    ], `${label}.pairVerdicts[${verdictIndex}]`);
    digest(parsed.comparisonId, `${label}.pairVerdicts[${verdictIndex}].comparisonId`);
    if (typeof parsed.bugId !== "string" || !/^bug-[a-f0-9]{8,32}$/.test(parsed.bugId)) {
      throw new Error(`${label}.pairVerdicts[${verdictIndex}].bugId is invalid`);
    }
    nonnegativeInteger(parsed.findingIndex, `${label}.pairVerdicts[${verdictIndex}].findingIndex`);
    digest(parsed.findingEvidenceSha256, `${label}.pairVerdicts[${verdictIndex}].findingEvidenceSha256`);
    if (parsed.verdict !== "same-root-cause" && parsed.verdict !== "different-root-cause" && parsed.verdict !== "failed") {
      throw new Error(`${label}.pairVerdicts[${verdictIndex}].verdict is invalid`);
    }
    return parsed as unknown as MethodologyAttemptGrade["pairVerdicts"][number];
  });
  validateVerdictLinks(pairVerdicts, findings, label);

  const observationMatches = stringMap(item.observationMatches, `${label}.observationMatches`, (entry, entryLabel) => {
    if (entry !== null) nonnegativeInteger(entry, entryLabel);
    return entry as number | null;
  });
  const rootCauseMatches = stringMap(item.rootCauseMatches, `${label}.rootCauseMatches`, (entry, entryLabel) => {
    if (typeof entry !== "boolean") throw new Error(`${entryLabel} must be boolean`);
    return entry;
  });
  const rootMissAttribution = stringMap(item.rootMissAttribution, `${label}.rootMissAttribution`, (entry, entryLabel) => {
    if (entry !== "none" && entry !== "unattributed") throw new Error(`${entryLabel} is invalid`);
    return entry;
  });

  if (!Array.isArray(item.unmatchedFindings)) throw new Error(`${label}.unmatchedFindings must be an array`);
  const unmatchedFindings = item.unmatchedFindings.map((unmatched, unmatchedIndex) => {
    const parsed = exactObject(unmatched, ["findingIndex", "findingEvidenceSha256", "classification"],
      `${label}.unmatchedFindings[${unmatchedIndex}]`);
    nonnegativeInteger(parsed.findingIndex, `${label}.unmatchedFindings[${unmatchedIndex}].findingIndex`);
    digest(parsed.findingEvidenceSha256, `${label}.unmatchedFindings[${unmatchedIndex}].findingEvidenceSha256`);
    if (parsed.classification !== "unresolved") throw new Error(`${label}.unmatchedFindings classification is invalid`);
    return parsed as unknown as MethodologyAttemptGrade["unmatchedFindings"][number];
  });
  validateUnmatchedLinks(unmatchedFindings, findings, label);

  const completion = validateCompletion(item.completion, projection.status, `${label}.completion`);
  const metricEligibility = validateMetricEligibility(item.metricEligibility, `${label}.metricEligibility`);
  const claims = exactObject(item.claims, [
    "globalCleanliness", "providerContact", "independentCuration",
  ], `${label}.claims`);
  if (claims.globalCleanliness !== "not-established" || claims.providerContact !== "not-established" ||
      claims.independentCuration !== "not-established") throw new Error(`${label}.claims are invalid`);
  digest(item.gradeSha256, `${label}.gradeSha256`);
  const body = {
    schemaVersion: 1 as const,
    protocol: "historical-methodology-grading-v1" as const,
    projection,
    projectionSha256: item.projectionSha256 as string,
    judgeConfigSha256: item.judgeConfigSha256 as string,
    findings,
    pairVerdicts,
    observationMatches,
    rootCauseMatches,
    rootMissAttribution,
    unmatchedFindings,
    completion,
    metricEligibility,
    claims: {
      globalCleanliness: "not-established" as const,
      providerContact: "not-established" as const,
      independentCuration: "not-established" as const,
    },
  };
  if (item.gradeSha256 !== methodologyAttemptGradeSha256(body) ||
      canonicalJson({ ...body, gradeSha256: item.gradeSha256 }) !== canonicalJson(value)) {
    throw new Error(`${label} digest is invalid`);
  }
  return { ...body, gradeSha256: item.gradeSha256 as string };
}

function validateProjection(value: unknown, label: string): MethodologyAttemptGrade["projection"] {
  const item = exactObject(value, PROJECTION_KEYS, label);
  if (item.schemaVersion !== 2 || item.kind !== "methodology-grading-projection") throw new Error(`${label} kind/version is invalid`);
  for (const field of [
    "executionEvidenceSha256", "inputPlanSha256", "caseRegistrationSha256", "truthSha256", "truthScopeSha256",
  ] as const) digest(item[field], `${label}.${field}`);
  if (typeof item.attemptId !== "string" || !ATTEMPT_ID.test(item.attemptId)) throw new Error(`${label}.attemptId is invalid`);
  if (typeof item.caseName !== "string" || !CASE_NAME.test(item.caseName)) throw new Error(`${label}.caseName is invalid`);
  if (item.status !== "completed" && item.status !== "incomplete" && item.status !== "failed" && item.status !== "missing") {
    throw new Error(`${label}.status is invalid`);
  }
  const reasonValid = (item.status === "completed" && item.statusReason === "authenticated-complete") ||
    (item.status === "incomplete" && (item.statusReason === "runner-scope-unverified" || item.statusReason === "model-unable-to-complete")) ||
    (item.status === "failed" && (item.statusReason === "preflight-failed" || item.statusReason === "interrupted" || item.statusReason === "review-execution-failed")) ||
    (item.status === "missing" && item.statusReason === "outer-run-missing");
  if (!reasonValid) throw new Error(`${label}.statusReason is inconsistent`);
  for (const field of [
    "lifecycleTerminalSha256", "reviewTerminalSha256", "reviewRawOutputSha256", "reviewOutputSha256",
  ] as const) if (item[field] !== null) digest(item[field], `${label}.${field}`);
  if (item.status === "missing" ? item.lifecycleTerminalSha256 !== null : item.lifecycleTerminalSha256 === null) {
    throw new Error(`${label}.lifecycleTerminalSha256 is inconsistent`);
  }
  const needsReviewTerminal = item.status === "completed" || item.status === "incomplete" || item.statusReason === "review-execution-failed";
  if (needsReviewTerminal !== (item.reviewTerminalSha256 !== null)) throw new Error(`${label}.reviewTerminalSha256 is inconsistent`);
  if ((item.status === "completed" || item.status === "incomplete") !== (item.reviewRawOutputSha256 !== null)) {
    throw new Error(`${label}.reviewRawOutputSha256 is inconsistent`);
  }
  return item as unknown as MethodologyAttemptGrade["projection"];
}

function validateCompletion(value: unknown, status: MethodologyAttemptGrade["projection"]["status"], label: string) {
  const item = exactObject(value, ["scheduled", "completed", "incomplete", "failed", "missing"], label);
  const expected = {
    scheduled: 1 as const,
    completed: (status === "completed" ? 1 : 0) as 0 | 1,
    incomplete: (status === "incomplete" ? 1 : 0) as 0 | 1,
    failed: (status === "failed" ? 1 : 0) as 0 | 1,
    missing: (status === "missing" ? 1 : 0) as 0 | 1,
  };
  if (canonicalJson(item) !== canonicalJson(expected)) throw new Error(`${label} is inconsistent`);
  return expected;
}

function validateMetricEligibility(value: unknown, label: string): MethodologyAttemptGrade["metricEligibility"] {
  const item = exactObject(value, ["protocol", "truthVersion", "truthStatus", "truthCompleteness", "selections"], label);
  if (item.protocol !== "historical-efficacy-v1" || typeof item.truthVersion !== "string" || !TRUTH_VERSION.test(item.truthVersion) ||
      (item.truthStatus !== "known-roots" && item.truthStatus !== "reviewed-comparison") || item.truthCompleteness !== "partial" ||
      !Array.isArray(item.selections) || item.selections.length !== METRICS.length) throw new Error(`${label} is invalid`);
  const selections = item.selections.map((selection, index) => {
    const row = exactObject(selection, ["metric", "disposition", "denominator", "reason"], `${label}.selections[${index}]`);
    if (row.metric !== METRICS[index] || !["included", "excluded", "unavailable"].includes(String(row.disposition)) ||
      typeof row.reason !== "string" || !METRIC_REASONS.has(row.reason)) {
      throw new Error(`${label}.selections[${index}] is invalid`);
    }
    let denominator: { source: "registered-known-roots" | "emitted-findings" | "scheduled-reviews"; count: number } | null = null;
    if (row.denominator !== null) {
      const parsed = exactObject(row.denominator, ["source", "count"], `${label}.selections[${index}].denominator`);
      if (parsed.source !== "registered-known-roots" && parsed.source !== "emitted-findings" && parsed.source !== "scheduled-reviews") {
        throw new Error(`${label}.selections[${index}].denominator.source is invalid`);
      }
      denominator = { source: parsed.source, count: nonnegativeInteger(parsed.count, `${label}.selections[${index}].denominator.count`) };
    }
    return { metric: row.metric, disposition: row.disposition, denominator, reason: row.reason };
  });
  return { protocol: "historical-efficacy-v1", truthVersion: item.truthVersion,
    truthStatus: item.truthStatus, truthCompleteness: "partial", selections } as MethodologyAttemptGrade["metricEligibility"];
}

function validateVerdictLinks(
  verdicts: MethodologyAttemptGrade["pairVerdicts"],
  findings: MethodologyAttemptGrade["findings"],
  label: string,
): void {
  const findingByIndex = new Map(findings.map((finding) => [finding.findingIndex, finding]));
  for (const verdict of verdicts) {
    const finding = findingByIndex.get(verdict.findingIndex);
    if (!finding || finding.evidenceSha256 !== verdict.findingEvidenceSha256) {
      throw new Error(`${label}.pairVerdicts contains an invalid finding reference`);
    }
  }
}

function validateUnmatchedLinks(
  unmatched: MethodologyAttemptGrade["unmatchedFindings"],
  findings: MethodologyAttemptGrade["findings"],
  label: string,
): void {
  const findingByIndex = new Map(findings.map((finding) => [finding.findingIndex, finding]));
  const keys = unmatched.map((finding) => `${finding.findingIndex}\0${finding.findingEvidenceSha256}`);
  if (new Set(keys).size !== keys.length) throw new Error(`${label}.unmatchedFindings contains duplicates`);
  for (const unmatchedFinding of unmatched) {
    const finding = findingByIndex.get(unmatchedFinding.findingIndex);
    if (!finding || finding.evidenceSha256 !== unmatchedFinding.findingEvidenceSha256) {
      throw new Error(`${label}.unmatchedFindings contains an invalid finding reference`);
    }
  }
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== keys.length || Object.keys(item).some((key) => !keys.includes(key))) {
    throw new Error(`${label} has an invalid shape`);
  }
  for (const key of keys) if (!Object.hasOwn(item, key)) throw new Error(`${label} is missing ${key}`);
  return item;
}

function stringMap<T>(value: unknown, label: string, parse: (entry: unknown, entryLabel: string) => T): Record<string, T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
    if (!key || key.includes("\0")) throw new Error(`${label} contains an invalid key`);
    return [key, parse(entry, `${label}.${key}`)];
  }));
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} must be a nonnegative integer`);
  return Number(value);
}

function digest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
}
