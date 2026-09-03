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
  assert.deepEqual(rootCauseMatches(truth, matches), { shared: true, other: true });
});

test("persisted semantic evidence rejects cross-group, digest, and stage tampering", () => {
  const finding = reviewFinding();
  const decisions = [
    semanticDecision(truth.bugs[0]!, finding, "same-root-cause"),
    semanticDecision(truth.bugs[1]!, finding, "same-root-cause"),
  ];
  const evidence = {
    version: "root-cause-v1" as const,
    judge: { kind: "codex" as const, version: "semantic-v1" },
    decisions,
    rootCauseMatches: { shared: true, other: false },
    missStages: { "symptom-a": "none" as const, "symptom-b": "none" as const, unrelated: "infrastructure" as const },
    unmatchedFindings: [],
  };
  assert.doesNotThrow(() => assertGradingEvidenceConsistent(
    truth, [finding], { "symptom-a": 0, "symptom-b": 0, unrelated: null }, evidence, "grade",
  ));
  assert.throws(() => assertGradingEvidenceConsistent(
    truth,
    [finding],
    { "symptom-a": 0, "symptom-b": 0, unrelated: 0 },
    { ...evidence, rootCauseMatches: { shared: true, other: true }, missStages: { ...evidence.missStages, unrelated: "none" } },
    "grade",
  ), /reuses finding/);
  assert.throws(() => assertGradingEvidenceConsistent(
    truth, [finding], { "symptom-a": 0, "symptom-b": 0, unrelated: null },
    { ...evidence, decisions: [{ ...decisions[0]!, decisionId: "a".repeat(64) }, decisions[1]!] }, "grade",
  ), /content address/);
  assert.throws(() => assertGradingEvidenceConsistent(
    truth, [finding], { "symptom-a": 0, "symptom-b": 0, unrelated: null },
    { ...evidence, missStages: { ...evidence.missStages, unrelated: "breadth" } }, "grade",
  ), /lacks authenticated stage evidence/);
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

test("miss attribution is deterministic and presentation is not a detection miss", () => {
  assert.equal(classifyMissStage({ matched: true }), "none");
  assert.equal(classifyMissStage({ matched: true, presentationFiltered: true }), "presentation");
  assert.equal(classifyMissStage({ matched: false, laneActivated: false }), "routing");
  assert.equal(classifyMissStage({ matched: false, laneActivated: true, breadthCandidate: false }), "breadth");
  assert.equal(classifyMissStage({ matched: false, laneActivated: true, breadthCandidate: true, investigationBudgetExhausted: true }), "budget");
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
  assert.doesNotMatch(prompt, /(?:runner|route|config|control|treatment|variant|codex|claude)/i);
  assert.match(prompt, /Reachable preconditions/);
  assert.match(prompt, /Observable impact/);
});

test("semantic disagreements and judge failures remain explicit fail-closed evidence", async () => {
  const result = engineResult([reviewFinding(), { ...reviewFinding(), title: "Unrelated report", explanation: "A separate symptom." }]);
  let calls = 0;
  const graded = await gradeResult(result, { bugs: [truth.bugs[0]!] }, { kind: "codex", model: "fixed-model" }, new Map(), async () => {
    calls += 1;
    if (calls === 1) throw new Error("Codex judge failed: timeout");
    return false;
  });
  assert.equal(graded.matches["symptom-a"], null);
  assert.deepEqual(graded.grading.decisions.map((decision) => [decision.verdict, decision.failureKind]), [
    ["failed", "timeout"],
    ["different-root-cause", undefined],
  ]);
  assert.equal(graded.grading.missStages["symptom-a"], "infrastructure");
  assert.equal(graded.grading.unmatchedFindings.length, 2);
  assert.equal(graded.falsePositiveIndexes.length, 0);
});

test("semantic grading continues past a positive claimed by another root cause", async () => {
  const graded = await gradeResult(
    engineResult([reviewFinding(), { ...reviewFinding(), title: "Second finding" }]),
    truth,
    { kind: "codex", model: "fixed-model" },
    new Map(),
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
  assert.throws(() => parseGroundTruth({ bugs: [bug("duplicate", "a"), bug("duplicate", "a")] }), /duplicate id/);
});

test("behavioral reporting separates root-cause cost and blocking clean-control findings", () => {
  const result = engineResult([reviewFinding()]);
  const common = {
    version: "root-cause-v1" as const,
    judge: { kind: "codex" as const, version: "semantic-v1" },
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
      grading: { ...common, rootCauseMatches: { shared: true } },
    })),
    failed: [],
    missing: 0,
    failureInclusiveRecalls: [1, 1],
    structuralExpectedMarkers: null,
  });
  assert.equal(stats.rootCauseRecallMean, 1);
  assert.equal(stats.costPerReliablyFoundRootCause, 1);
  assert.equal(stats.blockingFalsePositivesOnCleanCases, 0);
  assert.match(renderBenchmarkHtml([stats]), /cost\/reliably found root cause/);
});

function bug(id: string, rootCauseGroup: string): GroundTruth["bugs"][number] {
  return {
    id,
    rootCauseGroup,
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
