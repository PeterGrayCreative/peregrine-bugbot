import { canonicalJson, canonicalJsonSha256 } from "./experiment.js";
import {
  readMethodologyJudgeLedger,
  type MethodologyJudgeInputs,
  type MethodologyJudgeRunResult,
} from "./methodology-judge-ledger.js";
import type { AuthenticatedMethodologyGradingProjection } from "./methodology-grading-projection.js";
import {
  gradeMethodologyAttempt,
  methodologyComparisonId,
  methodologyFindingEvidenceSha256,
  type MethodologyAttemptGrade,
  type MethodologyPairVerdictInput,
} from "./methodology-grading-contract.js";

export const METHODOLOGY_SEALED_JUDGE_GRADING_PROTOCOL =
  "historical-methodology-sealed-judge-grading-v1" as const;

const SHA256 = /^[a-f0-9]{64}$/;

export interface MethodologySealedJudgeGradeInputs extends MethodologyJudgeInputs {
  runDirectory: string;
  expectedOccurrenceArtifactSha256: string;
  expectedJudgeManifestSha256: string;
  expectedJudgeTerminalSealSha256: string;
  expectedProjectionSetSha256: string;
}

export interface MethodologySealedJudgeGradeSet {
  schemaVersion: 1;
  protocol: typeof METHODOLOGY_SEALED_JUDGE_GRADING_PROTOCOL;
  runId: string;
  executionEvidenceSha256: string;
  invocationRegistrationSha256: string;
  inputPlanSha256: string;
  projectionSetSha256: string;
  occurrenceArtifactSha256: string;
  judgeManifestSha256: string;
  judgeTerminalSealSha256: string;
  judgeConfigSha256: string;
  grades: MethodologyAttemptGrade[];
  gradeSetSha256: string;
  claims: {
    verdictSource: "completed-sealed-semantic-judge-ledger";
    semanticCorrectness: "not-established";
    humanCalibration: "required";
  };
  artifactSha256: string;
}

/**
 * Derive the only high-level methodology grade set from one definitive,
 * caller-anchored sealed semantic-judge ledger read. The caller supplies no
 * verdicts or metrics; those are reconstructed from authenticated ledger
 * occurrences and passed to the existing pure attempt grader.
 */
export function gradeMethodologySealedJudge(
  input: MethodologySealedJudgeGradeInputs,
): MethodologySealedJudgeGradeSet {
  const ledger = readMethodologyJudgeLedger(input);
  validateLedgerBinding(input, ledger);

  const grades = [...ledgerProjections(input)]
    .sort((left, right) => left.projection.attemptId.localeCompare(right.projection.attemptId))
    .map((item) => gradeMethodologyAttempt({
      projection: item.projection,
      expectedProjectionSha256: item.projectionSha256,
      truth: item.truth,
      reviewOutput: item.reviewOutput,
      judgeConfigSha256: ledger.manifest.judgeConfigSha256,
      pairVerdicts: pairVerdictsForProjection(item, ledger),
    }));

  const gradeSetSha256 = canonicalJsonSha256(grades.map((grade) => ({
    attemptId: grade.projection.attemptId,
    gradeSha256: grade.gradeSha256,
  })));
  const body = {
    schemaVersion: 1 as const,
    protocol: METHODOLOGY_SEALED_JUDGE_GRADING_PROTOCOL,
    runId: input.runId,
    executionEvidenceSha256: ledger.artifact.executionEvidenceSha256,
    invocationRegistrationSha256: ledger.artifact.invocationRegistrationSha256,
    inputPlanSha256: ledger.artifact.inputPlanSha256,
    projectionSetSha256: ledger.artifact.projectionSetSha256,
    occurrenceArtifactSha256: ledger.artifact.artifactSha256,
    judgeManifestSha256: ledger.manifest.manifestSha256,
    judgeTerminalSealSha256: input.expectedJudgeTerminalSealSha256,
    judgeConfigSha256: ledger.manifest.judgeConfigSha256,
    grades,
    gradeSetSha256,
    claims: {
      verdictSource: "completed-sealed-semantic-judge-ledger" as const,
      semanticCorrectness: "not-established" as const,
      humanCalibration: "required" as const,
    },
  };
  return { ...body, artifactSha256: canonicalJsonSha256(body) };
}

function ledgerProjections(
  input: MethodologySealedJudgeGradeInputs,
): AuthenticatedMethodologyGradingProjection[] {
  // The ledger reader rederives the projection set internally. This function
  // intentionally uses the caller's already-authenticated projection objects
  // only as the exact inputs that were authenticated by that read.
  return input.projections.projections;
}

function pairVerdictsForProjection(
  item: MethodologyJudgeInputs["projections"]["projections"][number],
  ledger: MethodologyJudgeRunResult,
): MethodologyPairVerdictInput[] {
  if (item.projection.status !== "completed") {
    assertNoOccurrencesForAttempt(item.projection.attemptId, ledger);
    return [];
  }

  const review = item.reviewOutput;
  if (review === null) throw new Error("completed methodology projection requires review output");
  const expected = item.truth.bugs.flatMap((bug) => review.findings.map((finding, findingIndex) => ({
    bug,
    finding,
    findingIndex,
    key: occurrenceKey(item.projection.attemptId, bug.id, findingIndex),
  })));
  const occurrences = ledger.occurrences.filter(({ attemptId }) => attemptId === item.projection.attemptId);
  const seen = new Set<string>();
  const occurrenceByKey = new Map<string, (typeof occurrences)[number]>();
  for (const occurrence of occurrences) {
    if (seen.has(occurrenceKey(occurrence.attemptId, occurrence.bugId, occurrence.findingIndex))) {
      throw new Error("methodology judge ledger contains a duplicate occurrence mapping");
    }
    seen.add(occurrenceKey(occurrence.attemptId, occurrence.bugId, occurrence.findingIndex));
    occurrenceByKey.set(occurrenceKey(occurrence.attemptId, occurrence.bugId, occurrence.findingIndex), occurrence);
  }
  if (occurrences.length !== expected.length || seen.size !== expected.length) {
    throw new Error("methodology judge ledger occurrence mapping is missing or extra");
  }

  return expected.map(({ bug, finding, findingIndex, key }) => {
    const occurrence = occurrenceByKey.get(key);
    if (!occurrence) throw new Error("methodology judge ledger occurrence mapping is missing");
    const findingEvidenceSha256 = methodologyFindingEvidenceSha256(finding);
    if (occurrence.findingEvidenceSha256 !== findingEvidenceSha256 ||
        occurrence.methodologyComparisonId !== methodologyComparisonId({
          bug,
          finding,
          judgeConfigSha256: ledger.manifest.judgeConfigSha256,
        })) {
      throw new Error("methodology judge occurrence comparison or finding evidence is inconsistent");
    }
    const { decision } = occurrence;
    if (decision.judgeConfigSha256 !== ledger.manifest.judgeConfigSha256 ||
        decision.verdict !== "same-root-cause" &&
        decision.verdict !== "different-root-cause" &&
        decision.verdict !== "failed") {
      throw new Error("methodology judge occurrence verdict or config is inconsistent");
    }
    return {
      comparisonId: occurrence.methodologyComparisonId,
      bugId: bug.id,
      findingIndex,
      findingEvidenceSha256,
      verdict: decision.verdict,
    };
  });
}

function assertNoOccurrencesForAttempt(attemptId: string, ledger: MethodologyJudgeRunResult): void {
  if (ledger.occurrences.some((occurrence) => occurrence.attemptId === attemptId)) {
    throw new Error("non-completed methodology projection cannot receive judge occurrences");
  }
}

function occurrenceKey(attemptId: string, bugId: string, findingIndex: number): string {
  return canonicalJson([attemptId, bugId, findingIndex]);
}

function validateLedgerBinding(
  input: MethodologySealedJudgeGradeInputs,
  ledger: MethodologyJudgeRunResult,
): void {
  for (const [label, value] of Object.entries({
    executionEvidenceSha256: input.projections.executionEvidenceSha256,
    invocationRegistrationSha256: input.projections.invocationRegistrationSha256,
    inputPlanSha256: input.projections.inputPlanSha256,
    expectedOccurrenceArtifactSha256: input.expectedOccurrenceArtifactSha256,
    expectedJudgeManifestSha256: input.expectedJudgeManifestSha256,
    expectedJudgeTerminalSealSha256: input.expectedJudgeTerminalSealSha256,
    expectedProjectionSetSha256: input.expectedProjectionSetSha256,
  })) {
    if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
  }
  if (ledger.runId !== input.runId || ledger.manifest.experimentId !== input.runId || ledger.artifact.runId !== input.runId) {
    throw new Error("methodology sealed judge ledger belongs to a different run");
  }
  if (ledger.terminal !== "completed") throw new Error("methodology sealed judge grading requires a completed ledger");
  if (ledger.artifact.executionEvidenceSha256 !== input.projections.executionEvidenceSha256 ||
      ledger.artifact.invocationRegistrationSha256 !== input.projections.invocationRegistrationSha256 ||
      ledger.artifact.inputPlanSha256 !== input.projections.inputPlanSha256 ||
      ledger.manifest.experimentManifestSha256 !== input.projections.invocationRegistrationSha256 ||
      ledger.manifest.experimentTerminalSealSha256 !== input.projections.executionEvidenceSha256 ||
      ledger.artifact.artifactSha256 !== input.expectedOccurrenceArtifactSha256 ||
      ledger.manifest.manifestSha256 !== input.expectedJudgeManifestSha256 ||
      ledger.artifact.projectionSetSha256 !== input.expectedProjectionSetSha256) {
    throw new Error("methodology sealed judge ledger trust anchors are inconsistent");
  }
  if (ledger.generic.manifest.manifestSha256 !== input.expectedJudgeManifestSha256 ||
      ledger.generic.decisions.length !== ledger.manifest.schedule.length ||
      ledger.occurrences.some(({ decision }) => decision.judgeConfigSha256 !== ledger.manifest.judgeConfigSha256)) {
    throw new Error("methodology sealed judge ledger decisions are inconsistent with its manifest");
  }
  const projectionAttempts = new Set(input.projections.projections.map(({ projection }) => projection.attemptId));
  if (ledger.occurrences.some(({ attemptId }) => !projectionAttempts.has(attemptId))) {
    throw new Error("methodology judge ledger contains cross-attempt occurrence evidence");
  }
}
