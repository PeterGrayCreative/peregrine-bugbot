import { canonicalJson, canonicalJsonSha256 } from "./experiment.js";
import {
  buildMethodologyAdjudicationLedger,
  validateMethodologyGradeSet,
  type MethodologyAdjudicationLedger,
} from "./methodology-adjudication.js";
import type { MethodologyAttemptGrade } from "./methodology-grading-contract.js";
import {
  buildMethodologyResourceSet,
  type MethodologyResourceSetArtifact,
} from "./methodology-resource-artifact.js";
import {
  METHODOLOGY_ARM_IDS,
  parseMethodologySchedule,
  type MethodologyArmId,
  type MethodologySchedule,
  type MethodologyScheduledAttempt,
} from "./methodology-schedule.js";
import type { MethodologyGradeSetArtifact } from "./methodology-analysis-artifacts.js";

/** Descriptive, failure-inclusive R3 contrasts. This module never contacts a provider. */
export const METHODOLOGY_CONTRAST_PROTOCOL = "historical-methodology-contrasts-v1" as const;
export const METHODOLOGY_CONTRAST_IDS = ["D-vs-C", "B-vs-A", "D-vs-A"] as const;
export type MethodologyContrastId = (typeof METHODOLOGY_CONTRAST_IDS)[number];

export interface MethodologyRecallMetric {
  matched: number;
  scheduled: number;
  caseMacro: number | null;
}

export interface MethodologyArmContrastMetrics {
  armId: MethodologyArmId;
  scheduledReviews: number;
  completion: {
    scheduled: number;
    completed: number;
    incomplete: number;
    failed: number;
    missing: number;
    rate: number | null;
  };
  registeredKnownRootRecall: MethodologyRecallMetric;
  unsupportedFindings: {
    count: number;
    perScheduledReview: number | null;
  };
  confirmedNewFindingOccurrences: {
    count: number;
    perScheduledReview: number | null;
  };
  unresolvedFindings: number;
  integrityBlockers: string[];
}

export interface MethodologyPairedWallTimeMetric {
  ratio: number | null;
  eligibleBlocks: number;
  totalBlocks: number;
  eligibleCases: number;
  totalCases: number;
  status: "defined" | "unknown";
  reason: "none" | "no-eligible-paired-completed-blocks" | "non-positive-denominator";
}

export interface MethodologyContrastMetric {
  left: number | null;
  right: number | null;
  delta: number | null;
}

export interface MethodologyContrast {
  contrastId: MethodologyContrastId;
  leftArm: MethodologyArmId;
  rightArm: MethodologyArmId;
  registeredKnownRootRecall: MethodologyContrastMetric;
  unsupportedFindingsPerScheduledReview: MethodologyContrastMetric;
  confirmedNewFindingOccurrencesPerScheduledReview: MethodologyContrastMetric;
  completionRate: MethodologyContrastMetric;
  pairedWallTime: MethodologyPairedWallTimeMetric;
}

export interface MethodologyContrastArtifact {
  schemaVersion: 1;
  protocol: typeof METHODOLOGY_CONTRAST_PROTOCOL;
  runId: string;
  scheduleSha256: string;
  executionEvidenceSha256: string;
  inputPlanSha256: string;
  gradeSetArtifactSha256: string;
  adjudicationLedgerSha256: string;
  resourceSetArtifactSha256: string;
  primaryContrast: "D-vs-C";
  arms: Record<MethodologyArmId, MethodologyArmContrastMetrics>;
  contrasts: Record<MethodologyContrastId, MethodologyContrast>;
  interaction: {
    registeredKnownRootRecall: number | null;
    unsupportedFindingsPerScheduledReview: number | null;
    confirmedNewFindingOccurrencesPerScheduledReview: number | null;
    completionRate: number | null;
    pairedWallTimeRatio: null;
    pairedWallTimeReason: "not-defined";
  };
  integrity: {
    unresolvedFindings: number;
    blockers: string[];
  };
  claims: {
    providerContact: "not-established";
    discovery: "finding-occurrences-only-root-deduplication-required";
    efficacy: "not-decided-by-this-descriptive-contrast";
  };
  contrastSha256: string;
}

export interface BuildMethodologyContrastsInput {
  schedule: unknown;
  gradeSet: MethodologyGradeSetArtifact;
  adjudication: MethodologyAdjudicationLedger;
  resourceSet: MethodologyResourceSetArtifact;
}

export function methodologyContrastsSha256(
  value: Omit<MethodologyContrastArtifact, "contrastSha256">,
): string {
  return canonicalJsonSha256(value);
}

/**
 * Rebuild and join the authenticated-looking analysis inputs, then calculate
 * only deterministic descriptive contrasts. The caller remains responsible
 * for authenticating the artifacts and any provider/runtime provenance.
 */
export function buildMethodologyContrasts(
  input: BuildMethodologyContrastsInput,
): MethodologyContrastArtifact {
  const schedule = parseMethodologySchedule(input.schedule, "methodology contrasts schedule");
  const validated = validateInputs(schedule, input);
  const gradeByAttempt = new Map(validated.grades.map((grade) => [grade.projection.attemptId, grade]));
  const resourceByAttempt = new Map(validated.resourceSet.resources.map((resource) => [resource.attemptId, resource]));
  const globalBlockers: string[] = [];
  const arms = {} as Record<MethodologyArmId, MethodologyArmContrastMetrics>;

  for (const armId of METHODOLOGY_ARM_IDS) {
    const attempts = schedule.attempts.filter((attempt) => attempt.armId === armId);
    const grades = attempts.map((attempt) => gradeByAttempt.get(attempt.id)!);
    const completion = {
      scheduled: attempts.length,
      completed: sum(grades, (grade) => grade.completion.completed),
      incomplete: sum(grades, (grade) => grade.completion.incomplete),
      failed: sum(grades, (grade) => grade.completion.failed),
      missing: sum(grades, (grade) => grade.completion.missing),
    };
    const blockers: string[] = [];
    if (completion.incomplete > 0) blockers.push(`${completion.incomplete} incomplete attempt(s)`);
    if (completion.failed > 0) blockers.push(`${completion.failed} failed attempt(s)`);
    if (completion.missing > 0) blockers.push(`${completion.missing} missing attempt(s)`);
    const recall = registeredRootRecall(schedule, attempts, gradeByAttempt);
    const unsupported = attempts.reduce((count, attempt) => count + validated.adjudication.records.filter((record) =>
      record.attemptId === attempt.id && record.classification === "unsupported").length, 0);
    const unresolved = attempts.reduce((count, attempt) => count + validated.adjudication.records.filter((record) =>
      record.attemptId === attempt.id && record.classification === "unresolved").length, 0);
    const confirmedNew = attempts.reduce((count, attempt) => count + validated.adjudication.records.filter((record) =>
      record.attemptId === attempt.id && record.classification === "confirmed-new").length, 0);
    if (unresolved > 0) blockers.push(`${unresolved} unresolved finding(s)`);
    const armMetrics: MethodologyArmContrastMetrics = {
      armId,
      scheduledReviews: attempts.length,
      completion: {
        ...completion,
        rate: attempts.length === 0 ? null : completion.completed / attempts.length,
      },
      registeredKnownRootRecall: recall,
      unsupportedFindings: {
        count: unsupported,
        perScheduledReview: attempts.length === 0 ? null : unsupported / attempts.length,
      },
      confirmedNewFindingOccurrences: {
        count: confirmedNew,
        perScheduledReview: attempts.length === 0 ? null : confirmedNew / attempts.length,
      },
      unresolvedFindings: unresolved,
      integrityBlockers: blockers,
    };
    arms[armId] = armMetrics;
    globalBlockers.push(...blockers.map((blocker) => `arm ${armId}: ${blocker}`));
  }

  const contrasts = {
    "D-vs-C": contrast("D-vs-C", "D", "C", arms, schedule, resourceByAttempt, gradeByAttempt),
    "B-vs-A": contrast("B-vs-A", "B", "A", arms, schedule, resourceByAttempt, gradeByAttempt),
    "D-vs-A": contrast("D-vs-A", "D", "A", arms, schedule, resourceByAttempt, gradeByAttempt),
  } satisfies Record<MethodologyContrastId, MethodologyContrast>;
  const interaction = {
    registeredKnownRootRecall: difference(contrasts["D-vs-C"].registeredKnownRootRecall.delta,
      contrasts["B-vs-A"].registeredKnownRootRecall.delta),
    unsupportedFindingsPerScheduledReview: difference(
      contrasts["D-vs-C"].unsupportedFindingsPerScheduledReview.delta,
      contrasts["B-vs-A"].unsupportedFindingsPerScheduledReview.delta,
    ),
    confirmedNewFindingOccurrencesPerScheduledReview: difference(
      contrasts["D-vs-C"].confirmedNewFindingOccurrencesPerScheduledReview.delta,
      contrasts["B-vs-A"].confirmedNewFindingOccurrencesPerScheduledReview.delta,
    ),
    completionRate: difference(contrasts["D-vs-C"].completionRate.delta,
      contrasts["B-vs-A"].completionRate.delta),
    pairedWallTimeRatio: null,
    pairedWallTimeReason: "not-defined" as const,
  };
  const unresolvedFindings = METHODOLOGY_ARM_IDS.reduce((total, armId) => total + arms[armId].unresolvedFindings, 0);
  const body = {
    schemaVersion: 1 as const,
    protocol: METHODOLOGY_CONTRAST_PROTOCOL,
    runId: validated.gradeSet.runId,
    scheduleSha256: canonicalJsonSha256(schedule),
    executionEvidenceSha256: validated.gradeSet.executionEvidenceSha256,
    inputPlanSha256: validated.gradeSet.inputPlanSha256,
    gradeSetArtifactSha256: validated.gradeSet.artifactSha256,
    adjudicationLedgerSha256: validated.adjudication.ledgerSha256,
    resourceSetArtifactSha256: validated.resourceSet.artifactSha256,
    primaryContrast: "D-vs-C" as const,
    arms,
    contrasts,
    interaction,
    integrity: { unresolvedFindings, blockers: unique(globalBlockers) },
    claims: {
      providerContact: "not-established" as const,
      discovery: "finding-occurrences-only-root-deduplication-required" as const,
      efficacy: "not-decided-by-this-descriptive-contrast" as const,
    },
  };
  return { ...body, contrastSha256: methodologyContrastsSha256(body) };
}

function validateInputs(schedule: MethodologySchedule, input: BuildMethodologyContrastsInput): {
  gradeSet: MethodologyGradeSetArtifact;
  grades: MethodologyAttemptGrade[];
  adjudication: MethodologyAdjudicationLedger;
  resourceSet: MethodologyResourceSetArtifact;
} {
  const gradeSet = input.gradeSet;
  if (!gradeSet || gradeSet.schemaVersion !== 1 || gradeSet.protocol !== "historical-methodology-grade-set-v1") {
    throw new Error("methodology contrasts grade set is invalid");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(gradeSet.runId) ||
      !canonicalTimestamp(gradeSet.recordedAt)) {
    throw new Error("methodology contrasts grade set metadata is invalid");
  }
  if (canonicalJson(gradeSet.schedule) !== canonicalJson(schedule)) {
    throw new Error("methodology contrasts schedule does not match grade-set schedule");
  }
  const gradeValidation = validateMethodologyGradeSet({
    executionEvidenceSha256: gradeSet.executionEvidenceSha256,
    inputPlanSha256: gradeSet.inputPlanSha256,
    expectedAttemptIds: schedule.attempts.map((attempt) => attempt.id),
    grades: gradeSet.grades,
  });
  if (canonicalJson(gradeValidation.grades) !== canonicalJson(gradeSet.grades) ||
      gradeValidation.gradeSetSha256 !== gradeSet.gradeSetSha256) {
    throw new Error("methodology contrasts grade-set digest mismatch");
  }
  if (canonicalJsonSha256({
    schemaVersion: 1,
    protocol: "historical-methodology-grade-set-v1",
    runId: gradeSet.runId,
    schedule,
    executionEvidenceSha256: gradeSet.executionEvidenceSha256,
    inputPlanSha256: gradeSet.inputPlanSha256,
    gradeSetSha256: gradeSet.gradeSetSha256,
    grades: gradeSet.grades,
    recordedAt: gradeSet.recordedAt,
  }) !== gradeSet.artifactSha256) {
    throw new Error("methodology contrasts grade-set artifact digest mismatch");
  }
  const attemptById = new Map(schedule.attempts.map((attempt) => [attempt.id, attempt]));
  for (const grade of gradeSet.grades) {
    const attempt = attemptById.get(grade.projection.attemptId);
    if (!attempt || grade.projection.caseName !== attempt.caseName) {
      throw new Error("methodology contrasts grade does not match scheduled attempt");
    }
  }

  const adjudication = input.adjudication;
  const rebuiltLedger = buildMethodologyAdjudicationLedger({
    runId: adjudication.runId,
    executionEvidenceSha256: adjudication.executionEvidenceSha256,
    inputPlanSha256: adjudication.inputPlanSha256,
    expectedAttemptIds: schedule.attempts.map((attempt) => attempt.id),
    grades: gradeSet.grades,
    curatorIdentitySha256: adjudication.curatorIdentitySha256,
    reviewProtocol: adjudication.reviewProtocol,
    records: adjudication.records,
    recordedAt: adjudication.recordedAt,
  });
  if (canonicalJson(rebuiltLedger) !== canonicalJson(adjudication) ||
      adjudication.runId !== gradeSet.runId ||
      adjudication.executionEvidenceSha256 !== gradeSet.executionEvidenceSha256 ||
      adjudication.inputPlanSha256 !== gradeSet.inputPlanSha256 ||
      adjudication.gradeSetSha256 !== gradeSet.gradeSetSha256) {
    throw new Error("methodology contrasts adjudication ledger binding is invalid");
  }

  const resourceSet = input.resourceSet;
  const rebuiltResourceSet = buildMethodologyResourceSet({
    runId: resourceSet.runId,
    schedule,
    executionEvidenceSha256: resourceSet.executionEvidenceSha256,
    invocationRegistrationSha256: resourceSet.invocationRegistrationSha256,
    inputPlanSha256: resourceSet.inputPlanSha256,
    resources: resourceSet.resources,
    recordedAt: resourceSet.recordedAt,
  });
  if (canonicalJson(rebuiltResourceSet) !== canonicalJson(resourceSet) ||
      resourceSet.runId !== gradeSet.runId ||
      resourceSet.executionEvidenceSha256 !== gradeSet.executionEvidenceSha256 ||
      resourceSet.inputPlanSha256 !== gradeSet.inputPlanSha256 ||
      resourceSet.scheduleSha256 !== canonicalJsonSha256(schedule)) {
    throw new Error("methodology contrasts resource-set binding is invalid");
  }
  const resourceByAttempt = new Map(resourceSet.resources.map((resource) => [resource.attemptId, resource]));
  const caseBindings = new Map<string, { truthSha256: string; truthScopeSha256: string; caseRegistrationSha256: string }>();
  for (const attempt of schedule.attempts) {
    const grade = gradeSet.grades.find((candidate) => candidate.projection.attemptId === attempt.id)!;
    const resource = resourceByAttempt.get(attempt.id)!;
    if (grade.projection.lifecycleTerminalSha256 !== resource.lifecycleTerminalSha256 ||
        grade.projection.reviewTerminalSha256 !== resource.reviewTerminalSha256) {
      throw new Error(`methodology contrasts terminal digest binding is invalid for ${attempt.id}`);
    }
    const expectedOutcome = expectedResourceOutcome(grade);
    if (resource.outcome !== expectedOutcome) {
      throw new Error(`methodology contrasts status/outcome binding is invalid for ${attempt.id}`);
    }
    const binding = {
      truthSha256: grade.projection.truthSha256,
      truthScopeSha256: grade.projection.truthScopeSha256,
      caseRegistrationSha256: grade.projection.caseRegistrationSha256,
    };
    const prior = caseBindings.get(attempt.caseName);
    if (prior && canonicalJson(prior) !== canonicalJson(binding)) {
      throw new Error(`methodology contrasts case artifact bindings differ across repeats for ${attempt.caseName}`);
    }
    caseBindings.set(attempt.caseName, binding);
  }
  return { gradeSet, grades: gradeValidation.grades, adjudication, resourceSet };
}

function expectedResourceOutcome(grade: MethodologyAttemptGrade): MethodologyResourceSetArtifact["resources"][number]["outcome"] {
  const { status, statusReason } = grade.projection;
  if (status === "completed" || status === "incomplete") return "completed";
  if (status === "missing") return "missing";
  if (statusReason === "preflight-failed") return "preflight-failed";
  if (statusReason === "interrupted") return "interrupted";
  if (statusReason === "review-execution-failed") return "review-failed";
  throw new Error(`methodology contrasts cannot map grade status ${status}/${statusReason}`);
}

function registeredRootRecall(
  schedule: MethodologySchedule,
  attempts: readonly MethodologyScheduledAttempt[],
  gradeByAttempt: ReadonlyMap<string, MethodologyAttemptGrade>,
): MethodologyRecallMetric {
  const cases = schedule.cases.filter((item) => item.expectedBugCount !== null && item.expectedBugCount > 0);
  let matched = 0;
  let scheduled = 0;
  const caseRates: number[] = [];
  for (const caseItem of cases) {
    const caseAttempts = attempts.filter((attempt) => attempt.caseName === caseItem.caseName);
    const allCaseAttempts = schedule.attempts.filter((attempt) => attempt.caseName === caseItem.caseName);
    const firstGrade = gradeByAttempt.get(allCaseAttempts[0]?.id ?? "");
    if (!firstGrade) throw new Error(`bug-bearing case ${caseItem.caseName} is missing a scheduled grade`);
    const roots = Object.keys(firstGrade.rootCauseMatches).sort();
    if (roots.length !== caseItem.expectedBugCount) {
      throw new Error(`bug-bearing case ${caseItem.caseName} registered root count does not match expectedBugCount`);
    }
    for (const attempt of allCaseAttempts) {
      const grade = gradeByAttempt.get(attempt.id);
      if (!grade) throw new Error(`bug-bearing case ${caseItem.caseName} is missing a scheduled grade`);
      const observed = Object.keys(grade.rootCauseMatches).sort();
      if (observed.some((root) => typeof grade.rootCauseMatches[root] !== "boolean") ||
          canonicalJson(observed) !== canonicalJson(roots)) {
        throw new Error(`bug-bearing case ${caseItem.caseName} registered root roster differs across scheduled repeats`);
      }
    }
    const expectedPerCase = caseAttempts.length * roots.length;
    let matchedCase = 0;
    for (const attempt of caseAttempts) {
      const grade = gradeByAttempt.get(attempt.id);
      for (const root of roots) if (grade?.rootCauseMatches[root] === true) matchedCase += 1;
    }
    matched += matchedCase;
    scheduled += expectedPerCase;
    caseRates.push(matchedCase / expectedPerCase);
  }
  return {
    matched,
    scheduled,
    caseMacro: caseRates.length === 0 ? null : mean(caseRates),
  };
}

function contrast(
  contrastId: MethodologyContrastId,
  leftArm: MethodologyArmId,
  rightArm: MethodologyArmId,
  arms: Record<MethodologyArmId, MethodologyArmContrastMetrics>,
  schedule: MethodologySchedule,
  resourceByAttempt: ReadonlyMap<string, MethodologyResourceSetArtifact["resources"][number]>,
  gradeByAttempt: ReadonlyMap<string, MethodologyAttemptGrade>,
): MethodologyContrast {
  const left = arms[leftArm];
  const right = arms[rightArm];
  return {
    contrastId,
    leftArm,
    rightArm,
    registeredKnownRootRecall: metric(left.registeredKnownRootRecall.caseMacro, right.registeredKnownRootRecall.caseMacro),
    unsupportedFindingsPerScheduledReview: metric(left.unsupportedFindings.perScheduledReview,
      right.unsupportedFindings.perScheduledReview),
    confirmedNewFindingOccurrencesPerScheduledReview: metric(left.confirmedNewFindingOccurrences.perScheduledReview,
      right.confirmedNewFindingOccurrences.perScheduledReview),
    completionRate: metric(left.completion.rate, right.completion.rate),
    pairedWallTime: pairedWallTime(schedule, leftArm, rightArm, resourceByAttempt, gradeByAttempt),
  };
}

function pairedWallTime(
  schedule: MethodologySchedule,
  leftArm: MethodologyArmId,
  rightArm: MethodologyArmId,
  resources: ReadonlyMap<string, MethodologyResourceSetArtifact["resources"][number]>,
  grades: ReadonlyMap<string, MethodologyAttemptGrade>,
): MethodologyPairedWallTimeMetric {
  const blocks = new Map<string, MethodologyScheduledAttempt[]>();
  for (const attempt of schedule.attempts) {
    const block = blocks.get(attempt.blockId) ?? [];
    block.push(attempt);
    blocks.set(attempt.blockId, block);
  }
  const ratiosByCase = new Map<string, number[]>();
  let eligibleBlocks = 0;
  let pairedCompletedBlocks = 0;
  for (const attempts of blocks.values()) {
    const leftAttempt = attempts.find((attempt) => attempt.armId === leftArm);
    const rightAttempt = attempts.find((attempt) => attempt.armId === rightArm);
    const left = leftAttempt ? resources.get(leftAttempt.id) : undefined;
    const right = rightAttempt ? resources.get(rightAttempt.id) : undefined;
    const leftGrade = leftAttempt ? grades.get(leftAttempt.id) : undefined;
    const rightGrade = rightAttempt ? grades.get(rightAttempt.id) : undefined;
    if (!left || !right || left.outcome !== "completed" || right.outcome !== "completed" ||
        left.wallDurationMs === null || right.wallDurationMs === null ||
        leftGrade?.completion.completed !== 1 || rightGrade?.completion.completed !== 1) continue;
    pairedCompletedBlocks += 1;
    if (left.wallDurationMs <= 0 || right.wallDurationMs <= 0) continue;
    const ratio = left.wallDurationMs / right.wallDurationMs;
    const caseName = leftAttempt!.caseName;
    const values = ratiosByCase.get(caseName) ?? [];
    values.push(ratio);
    ratiosByCase.set(caseName, values);
    eligibleBlocks += 1;
  }
  const caseMedians = [...ratiosByCase.values()].map(median);
  return {
    ratio: caseMedians.length === 0 ? null : median(caseMedians),
    eligibleBlocks,
    totalBlocks: blocks.size,
    eligibleCases: caseMedians.length,
    totalCases: schedule.cases.length,
    status: caseMedians.length === 0 ? "unknown" : "defined",
    reason: caseMedians.length === 0
      ? pairedCompletedBlocks > 0 ? "non-positive-denominator" : "no-eligible-paired-completed-blocks"
      : "none",
  };
}

function metric(left: number | null, right: number | null): MethodologyContrastMetric {
  return { left, right, delta: difference(left, right) };
}

function difference(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left - right;
}

function sum<T>(items: readonly T[], select: (item: T) => number): number {
  return items.reduce((total, item) => total + select(item), 0);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function canonicalTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
