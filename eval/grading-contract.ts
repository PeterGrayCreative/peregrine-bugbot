import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  Finding,
  GradingEvidence,
  GroundTruth,
  GroundTruthBug,
  MissStage,
  SemanticJudgeDecision,
  UnmatchedFindingAdjudication,
} from "../src/types.js";

export const GRADING_VERSION = "root-cause-v1" as const;
export const SEMANTIC_JUDGE_VERSION = "semantic-v1" as const;

export interface MatchCandidate {
  bugId: string;
  findingIndex: number;
  sameRootCause: boolean;
  decisionId?: string;
}

export function findingEvidenceSha256(finding: Finding): string {
  return createHash("sha256").update(JSON.stringify({
    file: finding.file,
    startLine: finding.startLine,
    endLine: finding.endLine,
    disposition: finding.disposition,
    category: finding.category,
    invariant: finding.invariant,
    title: finding.title,
    explanation: finding.explanation,
    failurePath: finding.failurePath,
  })).digest("hex");
}

export function rootCauseKey(bug: GroundTruthBug): string {
  return bug.rootCauseGroup ?? `bug:${bug.id}`;
}

/**
 * Resolve positive pair judgments deterministically. A finding can satisfy more
 * than one observation only when every reuse belongs to the same curator-owned
 * root-cause group. It can never absorb an unrelated bug.
 */
export function resolveMatches(
  truth: GroundTruth,
  findingCount: number,
  candidates: readonly MatchCandidate[],
): Record<string, number | null> {
  const bugs = new Map(truth.bugs.map((bug) => [bug.id, bug]));
  const matches = Object.fromEntries(truth.bugs.map((bug) => [bug.id, null])) as Record<string, number | null>;
  const findingGroups = new Map<number, string>();
  for (const candidate of candidates) {
    if (!candidate.sameRootCause || matches[candidate.bugId] !== null) continue;
    const bug = bugs.get(candidate.bugId);
    if (!bug) throw new Error(`match candidate references unknown bug ${candidate.bugId}`);
    if (!Number.isSafeInteger(candidate.findingIndex) || candidate.findingIndex < 0 || candidate.findingIndex >= findingCount) {
      throw new Error(`match candidate for ${candidate.bugId} references a missing finding`);
    }
    const group = rootCauseKey(bug);
    const claimedGroup = findingGroups.get(candidate.findingIndex);
    if (claimedGroup !== undefined && claimedGroup !== group) continue;
    findingGroups.set(candidate.findingIndex, group);
    matches[bug.id] = candidate.findingIndex;
  }
  return matches;
}

export function rootCauseMatches(
  truth: GroundTruth,
  matches: Readonly<Record<string, number | null>>,
): Record<string, boolean> {
  const grouped = new Map<string, GroundTruthBug[]>();
  for (const bug of truth.bugs) {
    const key = rootCauseKey(bug);
    grouped.set(key, [...(grouped.get(key) ?? []), bug]);
  }
  return Object.fromEntries([...grouped].map(([group, bugs]) => [
    group,
    bugs.some((bug) => matches[bug.id] !== null),
  ]));
}

export function assertMatchReuseMatchesRootCause(
  truth: GroundTruth,
  matches: Readonly<Record<string, number | null>>,
  source: string,
): void {
  const bugs = new Map(truth.bugs.map((bug) => [bug.id, bug]));
  const findingGroups = new Map<number, string>();
  for (const [bugId, findingIndex] of Object.entries(matches)) {
    if (findingIndex === null) continue;
    const bug = bugs.get(bugId);
    if (!bug) throw new Error(`${source}.matches references unknown bug ${bugId}`);
    const group = rootCauseKey(bug);
    const prior = findingGroups.get(findingIndex);
    if (prior !== undefined && prior !== group) {
      throw new Error(`${source}.matches reuses finding ${findingIndex} across root-cause groups`);
    }
    findingGroups.set(findingIndex, group);
  }
}

/**
 * Authenticate the semantic meaning of persisted root-cause grading evidence.
 * Schema validation alone is insufficient: all content-addresses and derived
 * fields must agree with the exact truth, findings, and matches being reported.
 */
export function assertGradingEvidenceConsistent(
  truth: GroundTruth,
  findings: readonly Finding[],
  matches: Readonly<Record<string, number | null>>,
  evidence: GradingEvidence,
  source: string,
): void {
  assertMatchReuseMatchesRootCause(truth, matches, source);
  const bugs = new Map(truth.bugs.map((bug) => [bug.id, bug]));
  const decisions = new Set<string>();
  const candidates: MatchCandidate[] = [];

  if (evidence.judge.kind === "exact" && evidence.decisions.length !== 0) {
    throw new Error(`${source}.grading exact evidence cannot contain semantic decisions`);
  }
  for (const decision of evidence.decisions) {
    if (evidence.judge.kind === "exact") throw new Error(`${source}.grading has a decision for an exact judge`);
    const bug = bugs.get(decision.bugId);
    if (!bug) throw new Error(`${source}.grading decision references unknown bug ${decision.bugId}`);
    const findingIndex = findings.findIndex((finding) => findingEvidenceSha256(finding) === decision.findingEvidenceSha256);
    if (findingIndex === -1) throw new Error(`${source}.grading decision references unknown finding evidence`);
    if (decision.decisionId !== judgeDecisionId(bug, findings[findingIndex]!)) {
      throw new Error(`${source}.grading decision content address is invalid`);
    }
    if (decisions.has(decision.decisionId)) throw new Error(`${source}.grading contains a duplicate decision`);
    decisions.add(decision.decisionId);
    if (decision.verdict === "same-root-cause") {
      candidates.push({ bugId: bug.id, findingIndex, sameRootCause: true, decisionId: decision.decisionId });
    }
  }
  if (evidence.judge.kind !== "exact") {
    const resolved = resolveMatches(truth, findings.length, candidates);
    if (!isDeepStrictEqual(resolved, matches)) {
      throw new Error(`${source}.grading decisions do not support its matches`);
    }
  }

  const expectedGroups = rootCauseMatches(truth, matches);
  if (!isDeepStrictEqual(expectedGroups, evidence.rootCauseMatches)) {
    throw new Error(`${source}.grading.rootCauseMatches is inconsistent`);
  }
  for (const bug of truth.bugs) {
    const expectedStage = matches[bug.id] === null ? "infrastructure" : "none";
    if (evidence.missStages[bug.id] !== expectedStage) {
      throw new Error(`${source}.grading.missStages.${bug.id} lacks authenticated stage evidence`);
    }
  }

  const classifications = new Map(evidence.unmatchedFindings.map((item) => [
    item.findingEvidenceSha256,
    item.classification,
  ]));
  const expectedUnmatched = classifyUnmatchedFindings(findings, matches, classifications);
  if (evidence.judge.kind === "exact") {
    for (const item of expectedUnmatched) item.classification = "unsupported";
  }
  if (!isDeepStrictEqual(expectedUnmatched, evidence.unmatchedFindings)) {
    throw new Error(`${source}.grading.unmatchedFindings is inconsistent`);
  }
}

export function classifyUnmatchedFindings(
  findings: readonly Finding[],
  matches: Readonly<Record<string, number | null>>,
  adjudications: ReadonlyMap<string, UnmatchedFindingAdjudication["classification"]>,
): UnmatchedFindingAdjudication[] {
  const matched = new Set(Object.values(matches).filter((value): value is number => value !== null));
  return findings.flatMap((finding, findingIndex) => {
    if (matched.has(findingIndex) || finding.disposition !== "fix-in-pr") return [];
    const findingEvidenceSha256Value = findingEvidenceSha256(finding);
    return [{
      findingIndex,
      findingEvidenceSha256: findingEvidenceSha256Value,
      classification: adjudications.get(findingEvidenceSha256Value) ?? "unresolved",
    }];
  });
}

export function classifyMissStage(args: {
  matched: boolean;
  presentationFiltered?: boolean;
  infrastructureFailure?: boolean;
  laneActivated?: boolean;
  breadthCandidate?: boolean;
  investigationBudgetExhausted?: boolean;
}): MissStage {
  if (args.presentationFiltered) return "presentation";
  if (args.matched) return "none";
  if (args.infrastructureFailure) return "infrastructure";
  if (args.laneActivated === false) return "routing";
  if (args.breadthCandidate === false) return "breadth";
  if (args.investigationBudgetExhausted) return "budget";
  return "investigation";
}

export function judgeDecisionId(bug: GroundTruthBug, finding: Finding): string {
  return createHash("sha256").update(JSON.stringify({
    judgeVersion: SEMANTIC_JUDGE_VERSION,
    bug: {
      id: bug.id,
      file: bug.file,
      description: bug.description,
      reachablePreconditions: bug.reachablePreconditions,
      observableImpact: bug.observableImpact,
      rootCauseGroup: bug.rootCauseGroup ?? null,
    },
    findingEvidenceSha256: findingEvidenceSha256(finding),
  })).digest("hex");
}

export function semanticDecision(
  bug: GroundTruthBug,
  finding: Finding,
  verdict: SemanticJudgeDecision["verdict"],
  failureKind?: SemanticJudgeDecision["failureKind"],
): SemanticJudgeDecision {
  return {
    decisionId: judgeDecisionId(bug, finding),
    judgeVersion: SEMANTIC_JUDGE_VERSION,
    bugId: bug.id,
    findingEvidenceSha256: findingEvidenceSha256(finding),
    verdict,
    ...(failureKind ? { failureKind } : {}),
  };
}
