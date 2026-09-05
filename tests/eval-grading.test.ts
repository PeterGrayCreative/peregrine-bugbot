import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyMissStage,
  classifyUnmatchedFindings,
  assertGradingEvidenceConsistent,
  resolveMatches,
  rootCauseMatches,
  semanticDecision,
} from "../eval/grading-contract.js";
import { parseAdjudicationRecords } from "../eval/semantic-artifacts.js";
import { buildSemanticJudgePrompt, gradeResult } from "../eval/grade.js";
import { parseGroundTruth } from "../eval/case-truth.js";
import { calculateStats, renderBenchmarkHtml } from "../eval/report.js";
import { CORE_LANE_CATEGORY, CORE_LANE_IDS } from "../src/core/lanes.js";
import type { EngineResult, Finding, GroundTruth } from "../src/types.js";

const truth: GroundTruth = {
  bugs: [
    bug("symptom-a", "shared"),
    bug("symptom-b", "shared"),
    bug("unrelated", "other"),
  ],
};
const JUDGE_CONFIG_SHA256 = "c".repeat(64);
const JUDGE_IDENTITY = {
  kind: "codex" as const,
  version: "semantic-v1",
  configSha256: JUDGE_CONFIG_SHA256,
};

test("canonical lane registry maps all twelve lanes to finding categories", () => {
  assert.equal(CORE_LANE_IDS.length, 12);
  assert.deepEqual(Object.keys(CORE_LANE_CATEGORY), [...CORE_LANE_IDS]);
  assert.equal(CORE_LANE_CATEGORY["logic-correctness"], "logic");
  assert.equal(CORE_LANE_CATEGORY["boundaries-pagination"], "boundaries");
});

test("one systemic finding credits observations only in the same root-cause group", () => {
  const matches = resolveMatches(truth, 2, [
    { bugId: "symptom-a", findingIndex: 0, sameRootCause: true },
    { bugId: "symptom-b", findingIndex: 0, sameRootCause: true },
    { bugId: "unrelated", findingIndex: 0, sameRootCause: true },
    { bugId: "unrelated", findingIndex: 1, sameRootCause: true },
  ]);
  assert.deepEqual(matches, { "symptom-a": 0, "symptom-b": 0, unrelated: 1 });
  assert.deepEqual(rootCauseMatches(truth, matches), {
    '["group","shared"]': true,
    '["group","other"]': true,
  });
});

test("grouped and ungrouped root-cause namespaces cannot collide", () => {
  const collisionTruth: GroundTruth = {
    bugs: [bug("foo", undefined), bug("grouped", "bug:foo")],
  };
  const matches = resolveMatches(collisionTruth, 2, [
    { bugId: "foo", findingIndex: 0, sameRootCause: true },
    { bugId: "grouped", findingIndex: 0, sameRootCause: true },
    { bugId: "grouped", findingIndex: 1, sameRootCause: true },
  ]);
  assert.deepEqual(matches, { foo: 0, grouped: 1 });
  assert.equal(Object.keys(rootCauseMatches(collisionTruth, matches)).length, 2);
});

test("persisted semantic evidence rejects cross-group, digest, and stage tampering", () => {
  const finding = reviewFinding();
  const decisions = [
    semanticDecision(truth.bugs[0]!, finding, 0, "same-root-cause", JUDGE_CONFIG_SHA256),
    semanticDecision(truth.bugs[1]!, finding, 0, "same-root-cause", JUDGE_CONFIG_SHA256),
    semanticDecision(truth.bugs[2]!, finding, 0, "different-root-cause", JUDGE_CONFIG_SHA256),
  ];
  const evidence = {
    version: "root-cause-v1" as const,
    judge: JUDGE_IDENTITY,
    decisions,
    rootCauseMatches: { '["group","shared"]': true, '["group","other"]': false },
    missStages: { "symptom-a": "none" as const, "symptom-b": "none" as const, unrelated: "infrastructure" as const },
    unmatchedFindings: [],
  };
  assert.doesNotThrow(() => assertGradingEvidenceConsistent(
    truth, [finding], { "symptom-a": 0, "symptom-b": 0, unrelated: null }, evidence, "grade", JUDGE_IDENTITY,
  ));
  assert.throws(() => assertGradingEvidenceConsistent(
    truth,
    [finding],
    { "symptom-a": 0, "symptom-b": 0, unrelated: 0 },
    { ...evidence, rootCauseMatches: { '["group","shared"]': true, '["group","other"]': true }, missStages: { ...evidence.missStages, unrelated: "none" } },
    "grade", JUDGE_IDENTITY,
  ), /reuses finding/);
  assert.throws(() => assertGradingEvidenceConsistent(
    truth, [finding], { "symptom-a": 0, "symptom-b": 0, unrelated: null },
    { ...evidence, decisions: [{ ...decisions[0]!, decisionId: "a".repeat(64) }, decisions[1]!] }, "grade", JUDGE_IDENTITY,
  ), /content address/);
  assert.throws(() => assertGradingEvidenceConsistent(
    truth, [finding], { "symptom-a": 0, "symptom-b": 0, unrelated: null },
    { ...evidence, missStages: { ...evidence.missStages, unrelated: "breadth" } }, "grade", JUDGE_IDENTITY,
  ), /lacks authenticated stage evidence/);
  assert.throws(() => assertGradingEvidenceConsistent(
    truth, [finding], { "symptom-a": 0, "symptom-b": 0, unrelated: null },
    { ...evidence, decisions: [{ ...decisions[0]!, verdict: "different-root-cause" as const }, decisions[1]!] }, "grade", JUDGE_IDENTITY,
  ), /content address/);
  assert.throws(() => assertGradingEvidenceConsistent(
    truth, [finding], { "symptom-a": 0, "symptom-b": 0, unrelated: null },
    { ...evidence, decisions: [{ ...decisions[0]!, judgeConfigSha256: "d".repeat(64) }, decisions[1]!] }, "grade", JUDGE_IDENTITY,
  ), /fingerprint/);
  const alternateConfig = "d".repeat(64);
  assert.throws(() => assertGradingEvidenceConsistent(
    truth, [finding], { "symptom-a": 0, "symptom-b": 0, unrelated: null },
    {
      ...evidence,
      judge: { ...evidence.judge, configSha256: alternateConfig },
      decisions: [
        semanticDecision(truth.bugs[0]!, finding, 0, "same-root-cause", alternateConfig),
        semanticDecision(truth.bugs[1]!, finding, 0, "same-root-cause", alternateConfig),
        semanticDecision(truth.bugs[2]!, finding, 0, "different-root-cause", alternateConfig),
      ],
    },
    "grade", JUDGE_IDENTITY,
  ), /immutable anchor/);
  assert.throws(() => assertGradingEvidenceConsistent(
    truth,
    [finding],
    { "symptom-a": 0, "symptom-b": 0, unrelated: null },
    { ...evidence, judge: { ...evidence.judge, kind: "claude" as const } },
    "grade",
    JUDGE_IDENTITY,
  ), /judge identity/);
  assert.throws(() => assertGradingEvidenceConsistent(
    truth,
    [finding],
    { "symptom-a": 0, "symptom-b": 0, unrelated: null },
    { ...evidence, judge: { ...evidence.judge, version: "exact-v1" } },
    "grade",
    JUDGE_IDENTITY,
  ), /kind\/version/);
});

test("semantic decisions bind exact duplicate-finding occurrences", async () => {
  const duplicate = reviewFinding();
  const graded = await gradeResult(
    engineResult([duplicate, { ...duplicate }]),
    truth,
    { kind: "codex", model: "fixed-model", configSha256: JUDGE_CONFIG_SHA256 },
    async () => true,
  );
  assert.deepEqual(graded.matches, { "symptom-a": 0, "symptom-b": 0, unrelated: 1 });
  const unrelated = graded.grading.decisions.filter((decision) => decision.bugId === "unrelated");
  assert.deepEqual(unrelated.map((decision) => decision.findingIndex), [0, 1]);
  assert.notEqual(unrelated[0]!.decisionId, unrelated[1]!.decisionId);
  assert.doesNotThrow(() => assertGradingEvidenceConsistent(
    truth,
    [duplicate, { ...duplicate }],
    graded.matches,
    graded.grading,
    "duplicate grade", JUDGE_IDENTITY,
  ));
  assert.throws(() => assertGradingEvidenceConsistent(
    truth,
    [duplicate, { ...duplicate, title: "tampered occurrence" }],
    graded.matches,
    graded.grading,
    "duplicate grade", JUDGE_IDENTITY,
  ), /indexed finding occurrence/);
});

test("unmatched findings remain unresolved until blinded adjudication", () => {
  const finding = reviewFinding();
  const unresolved = classifyUnmatchedFindings([finding], { "symptom-a": null }, new Map());
  assert.equal(unresolved[0]?.classification, "unresolved");
  const confirmed = classifyUnmatchedFindings(
    [finding],
    { "symptom-a": null },
    new Map([[unresolved[0]!.findingEvidenceSha256, "confirmed-new"]]),
  );
  assert.equal(confirmed[0]?.classification, "confirmed-new");
});

test("persisted behavioral classifications remain unresolved without a sealed adjudication ledger", () => {
  const finding = reviewFinding();
  const evidence = {
    version: "root-cause-v1" as const,
    judge: JUDGE_IDENTITY,
    decisions: [semanticDecision(
      truth.bugs[0]!, finding, 0, "different-root-cause", JUDGE_CONFIG_SHA256,
    )],
    rootCauseMatches: { '["group","shared"]': false },
    missStages: { "symptom-a": "infrastructure" as const },
    unmatchedFindings: [{
      findingIndex: 0,
      findingEvidenceSha256: classifyUnmatchedFindings([finding], { "symptom-a": null }, new Map())[0]!.findingEvidenceSha256,
      classification: "unsupported" as const,
    }],
  };
  assert.throws(() => assertGradingEvidenceConsistent(
    { bugs: [truth.bugs[0]!] }, [finding], { "symptom-a": null }, evidence, "grade", JUDGE_IDENTITY,
  ), /unmatchedFindings is inconsistent/);
});

test("miss attribution is deterministic and presentation is not a detection miss", () => {
  assert.equal(classifyMissStage({ matched: true }), "none");
  assert.equal(classifyMissStage({ matched: true, presentationFiltered: true }), "presentation");
  assert.equal(classifyMissStage({ matched: false, laneActivated: false }), "routing");
  assert.equal(classifyMissStage({ matched: false, laneActivated: true, breadthCandidate: false }), "breadth");
  assert.equal(classifyMissStage({ matched: false, laneActivated: true, breadthCandidate: true, investigationBudgetExhausted: true }), "budget");
  assert.equal(classifyMissStage({ matched: false }), "unattributed");
  assert.equal(classifyMissStage({ matched: false, laneActivated: true, breadthCandidate: true }), "investigation");
  assert.equal(classifyMissStage({ matched: false, infrastructureFailure: true }), "infrastructure");
});

test("adjudication records are strict and reject duplicate evidence", () => {
  const digest = "a".repeat(64);
  const record = { findingEvidenceSha256: digest, classification: "unsupported", reason: "unmatched-high", evidence: "No reachable failure path." };
  assert.equal(parseAdjudicationRecords({ schemaVersion: 1, records: [record] })[0]?.classification, "unsupported");
  assert.throws(() => parseAdjudicationRecords({ schemaVersion: 1, records: [record, record] }), /duplicate/);
  assert.throws(() => parseAdjudicationRecords({ schemaVersion: 1, records: [{ ...record, engine: "codex" }] }), /unknown fields/);
});

test("semantic judge packet is blind to runner, route, config, and treatment", () => {
  const prompt = buildSemanticJudgePrompt(reviewFinding(), truth.bugs[0]!);
  assert.doesNotMatch(prompt, /\b(?:runner|route|config|control|treatment|variant|codex|claude)\b/i);
  assert.match(prompt, /reachablePreconditions/);
  assert.match(prompt, /observableImpact/);
});

test("semantic disagreements and judge failures remain explicit fail-closed evidence", async () => {
  const result = engineResult([reviewFinding(), { ...reviewFinding(), title: "Unrelated report", explanation: "A separate symptom." }]);
  let calls = 0;
  const graded = await gradeResult(result, { bugs: [truth.bugs[0]!] }, { kind: "codex", model: "fixed-model", configSha256: JUDGE_CONFIG_SHA256 }, async () => {
    calls += 1;
    if (calls === 1) throw new Error("Codex judge failed: timeout");
    return false;
  });
  assert.equal(graded.matches["symptom-a"], null);
  assert.deepEqual(graded.grading.decisions.map((decision) => [decision.verdict, decision.failureKind]), [
    ["failed", "timeout"],
    ["different-root-cause", undefined],
  ]);
  assert.equal(graded.grading.version, "root-cause-v2");
  assert.equal(graded.grading.missStages["symptom-a"], "unattributed");
  assert.equal(graded.grading.unmatchedFindings.length, 2);
  assert.equal(graded.falsePositiveIndexes.length, 0);
  assert.doesNotThrow(() => assertGradingEvidenceConsistent(
    { bugs: [truth.bugs[0]!] }, result.findings, graded.matches, graded.grading, "grade", JUDGE_IDENTITY,
  ));
  assert.throws(() => assertGradingEvidenceConsistent(
    { bugs: [truth.bugs[0]!] },
    result.findings,
    graded.matches,
    { ...graded.grading, decisions: graded.grading.decisions.slice(1) },
    "grade",
    JUDGE_IDENTITY,
  ), /coverage\/order/);
  assert.throws(() => assertGradingEvidenceConsistent(
    { bugs: [truth.bugs[0]!] },
    result.findings,
    graded.matches,
    { ...graded.grading, decisions: graded.grading.decisions.slice(0, 1) },
    "grade",
    JUDGE_IDENTITY,
  ), /coverage\/order/);
});

test("semantic grading continues past a positive claimed by another root cause", async () => {
  const graded = await gradeResult(
    engineResult([reviewFinding(), { ...reviewFinding(), title: "Second finding" }]),
    truth,
    { kind: "codex", model: "fixed-model", configSha256: JUDGE_CONFIG_SHA256 },
    async () => true,
  );
  assert.deepEqual(graded.matches, { "symptom-a": 0, "symptom-b": 0, unrelated: 1 });
});

test("clean controls preserve unsupported findings and ground truth rejects duplicate IDs", async () => {
  const graded = await gradeResult(
    engineResult([reviewFinding()]),
    { bugs: [] },
    { kind: "exact" },
  );
  assert.deepEqual(graded.matches, {});
  assert.deepEqual(graded.falsePositiveIndexes, [0]);
  assert.equal(graded.grading.unmatchedFindings[0]?.classification, "unsupported");
  assert.doesNotThrow(() => assertGradingEvidenceConsistent(
    { bugs: [] }, [reviewFinding()], {}, graded.grading, "exact grade", { kind: "exact", version: "exact-v1" },
  ));
  assert.throws(() => assertGradingEvidenceConsistent(
    { bugs: [] },
    [reviewFinding()],
    {},
    { ...graded.grading, judge: { kind: "exact", version: "semantic-v1" } },
    "exact grade",
    { kind: "exact", version: "exact-v1" },
  ), /kind\/version/);
  assert.throws(() => parseGroundTruth({ bugs: [bug("duplicate", "a"), bug("duplicate", "a")] }), /duplicate id/);
});

test("behavioral reporting separates root-cause cost and blocking clean-control findings", () => {
  const result = engineResult([reviewFinding()]);
  const common = {
    version: "root-cause-v1" as const,
    judge: JUDGE_IDENTITY,
    decisions: [],
    missStages: { "symptom-a": "none" as const },
    unmatchedFindings: [],
  };
  const stats = calculateStats({
    config: "route",
    runner: "codex",
    corpus: "development",
    benchmarkKind: "behavioral",
    completeness: "tracked",
    expectedRuns: 2,
    completed: [1, 2].map(() => ({
      caseName: "development/case-one",
      outcome: { status: "completed" as const, result },
      matches: { "symptom-a": 0 },
      falsePositiveIndexes: [],
      grading: { ...common, rootCauseMatches: { '["group","shared"]': true } },
    })),
    failed: [],
    missing: 0,
    failureInclusiveRecalls: [1, 1],
    expectedRootCauseRuns: 2,
    structuralExpectedMarkers: null,
  });
  assert.equal(stats.rootCauseRecallMean, 1);
  assert.equal(stats.costPerReliablyFoundRootCause, null);
  assert.equal(stats.blockingFalsePositivesOnCleanCases, 0);
  assert.match(renderBenchmarkHtml([stats]), /cost\/reliably found root cause/);
  assert.match(renderBenchmarkHtml([stats], {
    providerAttempts: 2, failures: 0, durationMs: 1000, providerCostUsd: 0,
    costUnavailableAttempts: 2, inputTokens: 20, cachedInputTokens: 4,
    outputTokens: 2, reasoningTokens: 1, turns: 2, toolCalls: 0,
  }), /Semantic judge accounting[\s\S]*20 \/ 4 \/ 2 \/ 1/);
});

test("reporting excludes diagnostic-only findings and applies sealed adjudications", () => {
  const digest = "a".repeat(64);
  const unmatched = {
    findingIndex: 0,
    findingEvidenceSha256: digest,
    classification: "unresolved" as const,
  };
  const completed = [
    {
      attemptId: "attempt-000001",
      caseName: "validation/case-diagnostic",
      outcome: { status: "completed" as const, result: engineResult([reviewFinding()]) },
      matches: {},
      falsePositiveIndexes: [],
      grading: {
        version: "root-cause-v2" as const,
        judge: JUDGE_IDENTITY,
        decisions: [],
        rootCauseMatches: {},
        missStages: {},
        unmatchedFindings: [unmatched],
      },
    },
    {
      attemptId: "attempt-000002",
      caseName: "development/case-clean",
      outcome: { status: "completed" as const, result: engineResult([reviewFinding()]) },
      matches: {},
      falsePositiveIndexes: [],
      grading: {
        version: "root-cause-v2" as const,
        judge: JUDGE_IDENTITY,
        decisions: [],
        rootCauseMatches: {},
        missStages: {},
        unmatchedFindings: [unmatched],
      },
    },
  ];
  const stats = calculateStats({
    config: "route", runner: "codex", corpus: "development", benchmarkKind: "behavioral",
    completeness: "tracked", expectedRuns: 2, completed, failed: [], missing: 0,
    failureInclusiveRecalls: [], expectedRootCauseRuns: 0, structuralExpectedMarkers: null,
    diagnosticOnlyCaseIds: new Set(["case-diagnostic"]),
    adjudications: new Map([[`attempt-000002\0${0}\0${digest}`, "unsupported"]]),
  });
  assert.equal(stats.diagnosticExcludedRuns, 1);
  assert.equal(stats.diagnosticExcludedFindings, 1);
  assert.equal(stats.unresolvedFindings, 0);
  assert.equal(stats.unsupportedFindings, 1);
  assert.equal(stats.falseDiscoveryRate, 1);
  assert.equal(stats.fpPerCaseMean, 1);
});

test("legacy automatic infrastructure misses report as unattributed", () => {
  const stats = calculateStats({
    config: "route", runner: "codex", corpus: "development", benchmarkKind: "behavioral",
    completeness: "tracked", expectedRuns: 1,
    completed: [{
      caseName: "development/case-one",
      outcome: { status: "completed", result: engineResult([]) },
      matches: { "symptom-a": null }, falsePositiveIndexes: [],
      grading: {
        version: "root-cause-v1", judge: JUDGE_IDENTITY, decisions: [],
        rootCauseMatches: { '["group","shared"]': false },
        missStages: { "symptom-a": "infrastructure" }, unmatchedFindings: [],
      },
    }],
    failed: [], missing: 0, failureInclusiveRecalls: [0], expectedRootCauseRuns: 1,
    structuralExpectedMarkers: null,
  });
  assert.deepEqual(stats.missesByStage, { unattributed: 1 });
});

test("root-cause recall excludes clean controls and fails closed for incomplete bug attempts", () => {
  const result = engineResult([reviewFinding()]);
  const evidence = (rootCauseMatches: Record<string, boolean>) => ({
    version: "root-cause-v1" as const,
    judge: JUDGE_IDENTITY,
    decisions: [],
    rootCauseMatches,
    missStages: {},
    unmatchedFindings: [],
  });
  const bugRun = {
    outcome: { status: "completed" as const, result },
    matches: { "symptom-a": 0 },
    falsePositiveIndexes: [],
    grading: evidence({ first: true, second: false }),
  };
  const cleanRun = {
    outcome: { status: "completed" as const, result },
    matches: {},
    falsePositiveIndexes: [],
    grading: evidence({}),
  };
  const stats = (
    completed: Parameters<typeof calculateStats>[0]["completed"],
    expectedRuns: number,
    expectedRootCauseRuns: number,
    failed: Parameters<typeof calculateStats>[0]["failed"] = [],
    missing = 0,
  ) => calculateStats({
    config: "route",
    runner: "codex",
    corpus: "development",
    benchmarkKind: "behavioral",
    completeness: "tracked",
    expectedRuns,
    completed,
    failed,
    missing,
    failureInclusiveRecalls: [],
    expectedRootCauseRuns,
    structuralExpectedMarkers: null,
  });

  assert.equal(stats([bugRun, cleanRun], 2, 1).rootCauseRecallMean, 0.5);
  assert.equal(stats([cleanRun], 1, 0).rootCauseRecallMean, null);
  assert.equal(stats([bugRun, cleanRun], 3, 2, [], 1).rootCauseRecallMean, null);
  assert.equal(stats([bugRun, cleanRun], 3, 2, [{
    outcome: { status: "failed", failureKind: "provider", message: "provider failed", durationMs: 1 },
  }]).rootCauseRecallMean, null);
  assert.equal(stats([{ ...bugRun, grading: undefined }, cleanRun], 2, 1).rootCauseRecallMean, null);
});

test("reliable root-cause cost uses a strict majority including two of three repeats", () => {
  const result = engineResult([reviewFinding()]);
  const completed = [true, true, false].map((found) => ({
    caseName: "development/case-one",
    outcome: { status: "completed" as const, result },
    matches: { "symptom-a": found ? 0 : null },
    falsePositiveIndexes: [],
    grading: {
      version: "root-cause-v1" as const,
      judge: JUDGE_IDENTITY,
      decisions: [],
      missStages: { "symptom-a": found ? "none" as const : "infrastructure" as const },
      unmatchedFindings: found ? [] : [{
        findingIndex: 0,
        findingEvidenceSha256: "a".repeat(64),
        classification: "unresolved" as const,
      }],
      rootCauseMatches: { '["group","shared"]': found },
    },
  }));
  const stats = calculateStats({
    config: "route",
    runner: "codex",
    corpus: "development",
    benchmarkKind: "behavioral",
    completeness: "tracked",
    expectedRuns: 3,
    completed,
    failed: [],
    missing: 0,
    failureInclusiveRecalls: [1, 1, 0],
    expectedRootCauseRuns: 3,
    structuralExpectedMarkers: null,
  });
  assert.equal(stats.costPerReliablyFoundRootCause, 1.5);
});

function bug(id: string, rootCauseGroup?: string): GroundTruth["bugs"][number] {
  return {
    id,
    ...(rootCauseGroup === undefined ? {} : { rootCauseGroup }),
    lane: "logic-correctness",
    expectedDisposition: "fix-in-pr",
    expectedSeverity: "high",
    file: "src/a.ts",
    startLine: 1,
    endLine: 1,
    description: "A shared calculation is incorrect.",
    reachablePreconditions: "The function is called.",
    observableImpact: "The result is incorrect.",
    provenance: "Curated test fixture.",
  };
}

function reviewFinding(): Finding {
  return {
    file: "src/a.ts",
    startLine: 1,
    endLine: 1,
    severity: "high",
    disposition: "fix-in-pr",
    category: "logic",
    invariant: "Calculation remains correct.",
    title: "Incorrect calculation",
    explanation: "The new expression returns the wrong value.",
    failurePath: "Call the function.",
    confidence: 0.99,
  };
}

function engineResult(findings: Finding[]): EngineResult {
  return {
    engine: "codex" as const,
    status: "completed" as const,
    modelConfig: "test",
    reviewedBaseRef: "base",
    reviewedHeadRef: "head",
    findings,
    usage: {
      provider: "openai" as const,
      aggregation: "single-snapshot" as const,
      costUsd: 0.5,
      costSource: "provider" as const,
      unavailable: [],
    },
    durationMs: 1,
  };
}
