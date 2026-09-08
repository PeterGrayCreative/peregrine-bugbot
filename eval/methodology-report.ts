import { canonicalJson, canonicalJsonSha256 } from "./experiment.js";
import {
  buildMethodologyAdjudicationLedger,
  methodologyAdjudicationMap,
  adjudicationKey,
  type MethodologyAdjudicationLedger,
} from "./methodology-adjudication.js";
import type { MethodologyAttemptGrade } from "./methodology-grading-contract.js";
import {
  METHODOLOGY_ARM_IDS,
  parseMethodologySchedule,
  type MethodologyArmId,
} from "./methodology-schedule.js";

export interface MethodologyArmReport {
  armId: MethodologyArmId;
  completion: { scheduled: number; completed: number; incomplete: number; failed: number; missing: number };
  registeredKnownRootRecall: {
    matched: number;
    scheduled: number;
    micro: number | null;
    caseMacro: number | null;
  };
  findings: {
    emitted: number;
    confirmedKnown: number;
    confirmedNew: number;
    unsupported: number;
    unresolved: number;
    precisionLower: number | null;
    precisionUpper: number | null;
    unsupportedPerScheduledReview: number;
  };
  promotionalEligibility: {
    eligible: boolean;
    blockers: string[];
  };
}

export interface MethodologyReport {
  schemaVersion: 1;
  protocol: "historical-methodology-report-v1";
  runId: string;
  scheduleSha256: string;
  executionEvidenceSha256: string;
  inputPlanSha256: string;
  adjudicationLedgerSha256: string;
  arms: MethodologyArmReport[];
  claims: {
    totalRecall: "not-established";
    globalCleanliness: "not-established";
    resourceUse: "not-yet-integrated";
    efficacy: "not-decided-by-this-descriptive-report";
  };
  reportSha256: string;
}

export function buildMethodologyReport(input: {
  runId: string;
  schedule: unknown;
  executionEvidenceSha256: string;
  inputPlanSha256: string;
  grades: readonly MethodologyAttemptGrade[];
  adjudication: MethodologyAdjudicationLedger;
}): MethodologyReport {
  const schedule = parseMethodologySchedule(input.schedule, "methodology report schedule");
  const expectedAttemptIds = schedule.attempts.map((attempt) => attempt.id);
  const rebuiltLedger = buildMethodologyAdjudicationLedger({
    runId: input.adjudication.runId,
    executionEvidenceSha256: input.adjudication.executionEvidenceSha256,
    inputPlanSha256: input.adjudication.inputPlanSha256,
    expectedAttemptIds,
    grades: input.grades,
    curatorIdentitySha256: input.adjudication.curatorIdentitySha256,
    reviewProtocol: input.adjudication.reviewProtocol,
    records: input.adjudication.records,
    recordedAt: input.adjudication.recordedAt,
  });
  if (canonicalJson(rebuiltLedger) !== canonicalJson(input.adjudication)) {
    throw new Error("methodology report adjudication ledger is invalid");
  }
  if (input.runId !== input.adjudication.runId ||
      input.executionEvidenceSha256 !== input.adjudication.executionEvidenceSha256 ||
      input.inputPlanSha256 !== input.adjudication.inputPlanSha256) {
    throw new Error("methodology report inputs do not identify one run");
  }
  const gradeByAttempt = new Map(input.grades.map((grade) => [grade.projection.attemptId, grade]));
  const adjudications = methodologyAdjudicationMap(input.adjudication);
  const arms = METHODOLOGY_ARM_IDS.map((armId): MethodologyArmReport => {
    const attempts = schedule.attempts.filter((attempt) => attempt.armId === armId);
    const grades = attempts.map((attempt) => gradeByAttempt.get(attempt.id)!);
    const completion = {
      scheduled: attempts.length,
      completed: sum(grades, (grade) => grade.completion.completed),
      incomplete: sum(grades, (grade) => grade.completion.incomplete),
      failed: sum(grades, (grade) => grade.completion.failed),
      missing: sum(grades, (grade) => grade.completion.missing),
    };
    const eligibleGrades = grades.filter(hasRegisteredRecall);
    const matched = sum(eligibleGrades, (grade) => Object.values(grade.rootCauseMatches).filter(Boolean).length);
    const registered = sum(eligibleGrades, (grade) => Object.keys(grade.rootCauseMatches).length);
    const cases = new Map<string, { matched: number; registered: number }>();
    for (const grade of eligibleGrades) {
      const current = cases.get(grade.projection.caseName) ?? { matched: 0, registered: 0 };
      current.matched += Object.values(grade.rootCauseMatches).filter(Boolean).length;
      current.registered += Object.keys(grade.rootCauseMatches).length;
      cases.set(grade.projection.caseName, current);
    }
    const caseRates = [...cases.values()].filter((item) => item.registered > 0)
      .map((item) => item.matched / item.registered);
    const emitted = sum(grades, (grade) => grade.findings.length);
    const confirmedKnown = sum(grades, (grade) => new Set(
      Object.values(grade.observationMatches).filter((value): value is number => value !== null),
    ).size);
    const classified = grades.flatMap((grade) => grade.unmatchedFindings.map((finding) =>
      adjudications.get(adjudicationKey({
        attemptId: grade.projection.attemptId,
        findingIndex: finding.findingIndex,
        findingEvidenceSha256: finding.findingEvidenceSha256,
      }))!));
    const confirmedNew = classified.filter((item) => item === "confirmed-new").length;
    const unsupported = classified.filter((item) => item === "unsupported").length;
    const unresolved = classified.filter((item) => item === "unresolved").length;
    if (confirmedKnown + classified.length !== emitted) {
      throw new Error(`methodology report arm ${armId} finding accounting is inconsistent`);
    }
    const confirmed = confirmedKnown + confirmedNew;
    const adjudicatedTotal = confirmed + unsupported + unresolved;
    const blockers = [
      ...(completion.incomplete > 0 ? [`${completion.incomplete} incomplete attempt(s)`] : []),
      ...(completion.failed > 0 ? [`${completion.failed} failed attempt(s)`] : []),
      ...(completion.missing > 0 ? [`${completion.missing} missing attempt(s)`] : []),
      ...(unresolved > 0 ? [`${unresolved} unresolved finding(s)`] : []),
      "resource use not integrated",
    ];
    return {
      armId,
      completion,
      registeredKnownRootRecall: {
        matched,
        scheduled: registered,
        micro: registered === 0 ? null : matched / registered,
        caseMacro: caseRates.length === 0 ? null : caseRates.reduce((total, value) => total + value, 0) / caseRates.length,
      },
      findings: {
        emitted,
        confirmedKnown,
        confirmedNew,
        unsupported,
        unresolved,
        precisionLower: adjudicatedTotal === 0 ? null : confirmed / adjudicatedTotal,
        precisionUpper: adjudicatedTotal === 0 ? null : (confirmed + unresolved) / adjudicatedTotal,
        unsupportedPerScheduledReview: unsupported / attempts.length,
      },
      promotionalEligibility: { eligible: blockers.length === 0, blockers },
    };
  });
  const body = {
    schemaVersion: 1 as const,
    protocol: "historical-methodology-report-v1" as const,
    runId: input.runId,
    scheduleSha256: canonicalJsonSha256(schedule),
    executionEvidenceSha256: input.executionEvidenceSha256,
    inputPlanSha256: input.inputPlanSha256,
    adjudicationLedgerSha256: input.adjudication.ledgerSha256,
    arms,
    claims: {
      totalRecall: "not-established" as const,
      globalCleanliness: "not-established" as const,
      resourceUse: "not-yet-integrated" as const,
      efficacy: "not-decided-by-this-descriptive-report" as const,
    },
  };
  return { ...body, reportSha256: canonicalJsonSha256(body) };
}

function hasRegisteredRecall(grade: MethodologyAttemptGrade): boolean {
  return grade.metricEligibility.selections.some((selection) =>
    selection.metric === "registered-known-root-recall" && selection.disposition === "included");
}

function sum<T>(items: readonly T[], select: (item: T) => number): number {
  return items.reduce((total, item) => total + select(item), 0);
}
