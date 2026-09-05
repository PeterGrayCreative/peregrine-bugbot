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

export const GRADING_VERSION = "root-cause-v2" as const;
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
  // Structured namespaces prevent an ungrouped bug id from colliding with a
  // curator-supplied group that happens to contain the same textual prefix.
  return JSON.stringify(bug.rootCauseGroup === undefined
    ? ["bug", bug.id]
    : ["group", bug.rootCauseGroup]);
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
  expectedJudge?: GradingEvidence["judge"],
): void {
  assertMatchReuseMatchesRootCause(truth, matches, source);
  if (evidence.version !== "root-cause-v1" && evidence.version !== "root-cause-v2") {
    throw new Error(`${source}.grading.version is invalid`);
  }
  const bugs = new Map(truth.bugs.map((bug) => [bug.id, bug]));
  const decisions = new Set<string>();
  const candidates: MatchCandidate[] = [];

  const expectedJudgeVersion = evidence.judge.kind === "exact" ? "exact-v1" : SEMANTIC_JUDGE_VERSION;
  if (evidence.judge.version !== expectedJudgeVersion) {
    throw new Error(`${source}.grading judge kind/version pairing is invalid`);
  }
  if (evidence.judge.kind === "exact" && evidence.decisions.length !== 0) {
    throw new Error(`${source}.grading exact evidence cannot contain semantic decisions`);
  }
  if (evidence.judge.kind === "exact" && evidence.judge.configSha256 !== undefined) {
    throw new Error(`${source}.grading exact evidence cannot declare a semantic judge fingerprint`);
  }
  if (evidence.judge.kind !== "exact" && evidence.judge.configSha256 === undefined) {
    throw new Error(`${source}.grading semantic evidence needs a judge config fingerprint`);
  }
  if (evidence.judge.kind !== "exact" && expectedJudge === undefined) {
    throw new Error(`${source}.grading semantic evidence has no immutable judge identity anchor`);
  }
  if (expectedJudge !== undefined && !isDeepStrictEqual(evidence.judge, expectedJudge)) {
    throw new Error(`${source}.grading judge identity does not match its immutable anchor`);
  }
  const pairs = new Set<string>();
  for (const decision of evidence.decisions) {
    if (evidence.judge.kind === "exact") throw new Error(`${source}.grading has a decision for an exact judge`);
    const bug = bugs.get(decision.bugId);
    if (!bug) throw new Error(`${source}.grading decision references unknown bug ${decision.bugId}`);
    if (!Number.isSafeInteger(decision.findingIndex) || decision.findingIndex < 0 || decision.findingIndex >= findings.length) {
      throw new Error(`${source}.grading decision references a missing finding occurrence`);
    }
    const finding = findings[decision.findingIndex]!;
    if (findingEvidenceSha256(finding) !== decision.findingEvidenceSha256) {
      throw new Error(`${source}.grading decision does not match its indexed finding occurrence`);
    }
    if (decision.judgeConfigSha256 !== evidence.judge.configSha256) {
      throw new Error(`${source}.grading decision judge config fingerprint is inconsistent`);
    }
    if (decision.decisionId !== judgeDecisionId({
      bug,
      finding,
      findingIndex: decision.findingIndex,
      verdict: decision.verdict,
      failureKind: decision.failureKind,
      judgeConfigSha256: decision.judgeConfigSha256,
    })) {
      throw new Error(`${source}.grading decision content address is invalid`);
    }
    const pair = JSON.stringify([decision.bugId, decision.findingIndex]);
    if (pairs.has(pair)) throw new Error(`${source}.grading contains duplicate decisions for one bug/finding occurrence`);
    pairs.add(pair);
    if (decisions.has(decision.decisionId)) throw new Error(`${source}.grading contains a duplicate decision`);
    decisions.add(decision.decisionId);
  }
  if (evidence.judge.kind !== "exact") {
    // Reconstruct the deterministic, verdict-independent Cartesian schedule.
    // Every pair is evidence: failures, negative decisions, and decisions after
    // an earlier positive may not be omitted.
    let cursor = 0;
    for (const bug of truth.bugs) {
      for (let findingIndex = 0; findingIndex < findings.length; findingIndex++) {
        const decision = evidence.decisions[cursor];
        if (!decision || decision.bugId !== bug.id || decision.findingIndex !== findingIndex) {
          throw new Error(`${source}.grading semantic decision coverage/order is incomplete`);
        }
        cursor += 1;
        if (decision.verdict === "same-root-cause") {
          candidates.push({ bugId: bug.id, findingIndex, sameRootCause: true, decisionId: decision.decisionId });
        }
      }
    }
    if (cursor !== evidence.decisions.length) {
      throw new Error(`${source}.grading semantic decision coverage/order contains extra decisions`);
    }
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
    // Preserve the interpretation of sealed v1 artifacts. V2 does not infer
    // review infrastructure failure from an unmatched root or a judge failure.
    const expectedStage = matches[bug.id] === null
      ? evidence.version === "root-cause-v1" ? "infrastructure" : "unattributed"
      : "none";
    if (evidence.missStages[bug.id] !== expectedStage) {
      throw new Error(`${source}.grading.missStages.${bug.id} lacks authenticated stage evidence`);
    }
  }

  // A run-bound, append-only curator adjudication ledger is a later slice.
  // Until it exists, behavioral classifications are deliberately unresolved;
  // accepting classifications from the artifact itself would self-authenticate
  // precision and FDR. Exact smoke remains deterministic transport evidence.
  const expectedUnmatched = classifyUnmatchedFindings(findings, matches, new Map());
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
  return args.laneActivated === true && args.breadthCandidate === true ? "investigation" : "unattributed";
}

export function judgeDecisionId(input: {
  bug: GroundTruthBug;
  finding: Finding;
  findingIndex: number;
  verdict: SemanticJudgeDecision["verdict"];
  failureKind?: SemanticJudgeDecision["failureKind"];
  judgeConfigSha256: string;
}): string {
  return createHash("sha256").update(JSON.stringify({
    judgeVersion: SEMANTIC_JUDGE_VERSION,
    judgeConfigSha256: input.judgeConfigSha256,
    bug: {
      id: input.bug.id,
      file: input.bug.file,
      description: input.bug.description,
      reachablePreconditions: input.bug.reachablePreconditions,
      observableImpact: input.bug.observableImpact,
      rootCauseGroup: input.bug.rootCauseGroup ?? null,
    },
    findingIndex: input.findingIndex,
    findingEvidenceSha256: findingEvidenceSha256(input.finding),
    verdict: input.verdict,
    failureKind: input.failureKind ?? null,
  })).digest("hex");
}

export function semanticDecision(
  bug: GroundTruthBug,
  finding: Finding,
  findingIndex: number,
  verdict: SemanticJudgeDecision["verdict"],
  judgeConfigSha256: string,
  failureKind?: SemanticJudgeDecision["failureKind"],
): SemanticJudgeDecision {
  return {
    decisionId: judgeDecisionId({ bug, finding, findingIndex, verdict, failureKind, judgeConfigSha256 }),
    judgeVersion: SEMANTIC_JUDGE_VERSION,
    judgeConfigSha256,
    bugId: bug.id,
    findingIndex,
    findingEvidenceSha256: findingEvidenceSha256(finding),
    verdict,
    ...(failureKind ? { failureKind } : {}),
  };
}
