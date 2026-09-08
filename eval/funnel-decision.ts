import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertNoSecrets } from "../src/security/secrets.js";
import type { BenchmarkCategory, ExperimentBenchmarkCategory, GradedRun, GroundTruth, RunRecord } from "../src/types.js";
import { assertGradedMatchesRun, parseGradedRun, parseMatrixRunManifest } from "./artifacts.js";
import { readCaseGroundTruth } from "./case-truth.js";
import { canonicalJson, canonicalJsonSha256, hashExperimentCorpus, readExperimentJson, writeExclusiveJson, type ExperimentScheduledAttempt } from "./experiment.js";
import { MATRIX_MANIFEST_FILENAME } from "./experiment-evidence.js";
import { parseBenchmarkCategoryBinding } from "./benchmark-panels.js";
import { assertGradingEvidenceConsistent, rootCauseKey, rootCauseMatches } from "./grading-contract.js";
import { requireValidExperimentGradingSeal, requireValidExperimentTerminalSeal } from "./experiment-seals.js";
import { CODEX_SEMANTIC_JUDGE } from "./judge-runtime.js";
import {
  adjudicationKey,
  adjudicationMap,
  readExperimentAdjudication,
  type ExperimentAdjudicationLedger,
  type FinalAdjudicationClassification,
} from "./adjudication-ledger.js";

export const FUNNEL_DECISION_FILENAME = "funnel-decision.json";
export const FUNNEL_ADJUDICATED_DECISION_FILENAME = "funnel-decision-adjudicated.json";

export interface FunnelCompletion {
  control: { scheduled: number; completed: number; failed: number };
  treatment: { scheduled: number; completed: number; failed: number };
}

export interface FunnelMetrics {
  reliableHighSeverityRegressions: string[];
  reliableOtherRegressions: string[];
  blockingUnsupportedFindings: { control: number; treatment: number };
  confirmedNewFindingsOnCleanControls: number;
  unresolvedRequiredAdjudications: number;
  diagnosticExcludedFindingCount: number;
  efficiency: {
    metric: "paired-median-wall-time";
    targetImprovementPercent: number | null;
    observedImprovementPercent: number | null;
    confidenceIntervalPercent: { lower: number; upper: number } | null;
    pairedAttempts: number;
    resamplingUnit: "case";
  };
}

export interface FunnelDecision {
  status: "advance" | "visible-funnel-complete" | "reject" | "inconclusive" | "diagnostic-only";
  nextCategory: BenchmarkCategory | null;
  reasons: string[];
}

export interface FunnelDecisionArtifact {
  schemaVersion: 1 | 2;
  experimentId: string;
  benchmarkCategory: ExperimentBenchmarkCategory;
  terminalSealSha256: string;
  terminal: "completed" | "stopped";
  gradingSealSha256?: string;
  completion: FunnelCompletion;
  metrics: FunnelMetrics | null;
  result: FunnelDecision;
  previousDecisionSha256?: string;
  adjudicationLedgerSha256?: string;
  decisionSha256: string;
}

export function evaluateFunnelDecision(input: {
  binding: ExperimentBenchmarkCategory;
  terminal: "completed" | "stopped";
  completion: FunnelCompletion;
  metrics: FunnelMetrics | null;
}): FunnelDecision {
  const gate = input.binding.definition.gate;
  if (input.terminal === "stopped") return decision("reject", null, ["The experiment stopped before its preregistered schedule completed."]);
  if (input.binding.evidenceUse === "treatment-only-diagnostic") {
    return decision("diagnostic-only", null, ["Treatment-only evidence can guide development but cannot advance or complete the funnel."]);
  }
  if (!input.metrics) throw new Error("completed paired evidence requires derived funnel metrics");
  const { control, treatment } = input.completion;
  if (control.scheduled === 0 || treatment.scheduled === 0 || control.scheduled !== treatment.scheduled) {
    return decision("reject", null, ["Acceptance evidence is not a complete contemporaneous paired schedule."]);
  }
  if (control.completed + control.failed !== control.scheduled || treatment.completed + treatment.failed !== treatment.scheduled) {
    return decision("reject", null, ["Scheduled attempts are missing terminal evidence."]);
  }
  if (control.failed > 0 || treatment.failed > 0) {
    return decision("reject", null, ["Acceptance evidence contains failed attempts; every paired attempt must complete."]);
  }
  if (treatment.completed / treatment.scheduled < control.completed / control.scheduled) {
    return decision("reject", null, ["Treatment completion rate regressed relative to control."]);
  }
  if (input.metrics.reliableHighSeverityRegressions.length > 0) {
    return decision("reject", null, ["A preregistered reliable high-severity root regressed."]);
  }
  if (input.metrics.blockingUnsupportedFindings.treatment > input.metrics.blockingUnsupportedFindings.control) {
    return decision("reject", null, ["Treatment introduced additional blocking unsupported findings on clean controls."]);
  }
  if (input.metrics.confirmedNewFindingsOnCleanControls > 0) {
    return decision("reject", null, ["A declared clean control contains a confirmed new finding and must be re-curated."]);
  }
  if (input.metrics.reliableOtherRegressions.length > 0) {
    return input.binding.name === "confirmation" || input.binding.name === "full-checkpoint"
      ? decision("reject", null, ["A preregistered reliable root regressed at a confirmation gate."])
      : decision("inconclusive", null, ["A non-high reliable root regressed and requires confirmation."]);
  }
  if (input.metrics.unresolvedRequiredAdjudications > 0) return decision("inconclusive", null, ["Required non-diagnostic findings remain unresolved."]);
  if (gate.targetImprovementPercent === null) {
    return decision("advance", gate.nextCategory, ["Safety and completion gates passed; efficiency is not a behavioral smoke gate."]);
  }
  const efficiency = input.metrics.efficiency;
  if (efficiency.observedImprovementPercent === null) return decision("inconclusive", null, ["The preregistered efficiency metric is unavailable."]);
  if (efficiency.observedImprovementPercent <= 0) return decision("reject", null, ["Treatment did not improve the preregistered efficiency metric."]);
  const interval = efficiency.confidenceIntervalPercent;
  if (interval && interval.upper < gate.targetImprovementPercent) {
    return decision("reject", null, ["The efficiency target is unattainable within the preregistered interval."]);
  }
  if (input.binding.name === "fast-screen") return decision("advance", gate.nextCategory, ["Safety gates passed and the efficiency signal is positive."]);
  if (efficiency.observedImprovementPercent < gate.targetImprovementPercent ||
    (gate.requireConfidenceIntervalAboveZero && (!interval || interval.lower <= 0))) {
    return decision("inconclusive", null, ["Confirmation requires the target improvement and a confidence interval wholly above zero."]);
  }
  return gate.mayComplete
    ? decision("visible-funnel-complete", null, ["All visible shortened-funnel safety, completion, and efficiency gates passed."])
    : decision("advance", gate.nextCategory, ["All confirmation safety, completion, and efficiency gates passed."]);
}

export function deriveFunnelMetrics(input: {
  binding: ExperimentBenchmarkCategory;
  schedule: readonly ExperimentScheduledAttempt[];
  records: readonly RunRecord[];
  gradedRuns: ReadonlyMap<string, GradedRun>;
  truths: ReadonlyMap<string, GroundTruth>;
  adjudications?: ReadonlyMap<string, FinalAdjudicationClassification>;
}): FunnelMetrics {
  const policy = input.binding.definition.gate;
  const diagnostic = new Set(input.binding.definition.roles.diagnosticOnlyCases);
  const clean = new Set(input.binding.definition.roles.cleanControls);
  const records = new Map(input.records.map((record) => [record.attemptId, record]));
  const rootCounts = new Map<string, { high: boolean; control: number; treatment: number }>();
  let controlUnsupported = 0;
  let treatmentUnsupported = 0;
  let unresolvedRequiredAdjudications = 0;
  let diagnosticExcludedFindingCount = 0;
  let confirmedNewFindingsOnCleanControls = 0;
  for (const attempt of input.schedule) {
    if (attempt.variant === "structural") continue;
    const caseId = caseIdOf(attempt.caseName);
    const run = input.gradedRuns.get(attempt.id);
    if (!run) continue;
    const truth = required(input.truths.get(attempt.caseName), `missing truth for ${attempt.caseName}`);
    for (const [root, matched] of Object.entries(rootCauseMatches(truth, run.matches))) {
      const key = `${attempt.caseName}\u0000${root}`;
      const bugs = truth.bugs.filter((bug) => rootCauseKey(bug) === root);
      const counts = rootCounts.get(key) ?? { high: bugs.some((bug) => bug.expectedSeverity === "high"), control: 0, treatment: 0 };
      if (matched) counts[attempt.variant]++;
      rootCounts.set(key, counts);
    }
    const unmatched = required(run.grading, `missing authenticated grading evidence for ${attempt.id}`).unmatchedFindings.map((item) => ({
      ...item,
      classification: input.adjudications?.get(
        adjudicationKey(attempt.id, item.findingIndex, item.findingEvidenceSha256),
      ) ?? item.classification,
    }));
    if (diagnostic.has(caseId)) {
      diagnosticExcludedFindingCount += unmatched.length;
      continue;
    }
    unresolvedRequiredAdjudications += unmatched.filter((item) => item.classification === "unresolved").length;
    if (clean.has(caseId)) {
      for (const item of unmatched) {
        if (item.classification === "confirmed-new") confirmedNewFindingsOnCleanControls++;
        if (item.classification === "unsupported" && run.outcome.result.findings[item.findingIndex]?.disposition === "fix-in-pr") {
          if (attempt.variant === "control") controlUnsupported++;
          else treatmentUnsupported++;
        }
      }
    }
  }
  const reliableHighSeverityRegressions: string[] = [];
  const reliableOtherRegressions: string[] = [];
  for (const [root, counts] of rootCounts) {
    if (counts.control >= policy.reliableDetectionMinimum && counts.treatment < policy.reliableDetectionMinimum) {
      (counts.high ? reliableHighSeverityRegressions : reliableOtherRegressions).push(root);
    }
  }
  const deltasByCase = new Map<string, number[]>();
  const byBlock = new Map<string, Partial<Record<"control" | "treatment", RunRecord>>>();
  for (const attempt of input.schedule) {
    if (attempt.variant === "structural") continue;
    const record = records.get(attempt.id);
    if (!record || record.outcome.status !== "completed") continue;
    const pair = byBlock.get(attempt.blockId) ?? {};
    pair[attempt.variant] = record;
    byBlock.set(attempt.blockId, pair);
  }
  for (const pair of byBlock.values()) {
    if (!pair.control || !pair.treatment || pair.control.attemptDurationMs <= 0) continue;
    const delta = 100 * (pair.control.attemptDurationMs - pair.treatment.attemptDurationMs) / pair.control.attemptDurationMs;
    const values = deltasByCase.get(pair.control.caseName) ?? [];
    values.push(delta);
    deltasByCase.set(pair.control.caseName, values);
  }
  const deltas = [...deltasByCase.values()].flat();
  return {
    reliableHighSeverityRegressions: reliableHighSeverityRegressions.sort(),
    reliableOtherRegressions: reliableOtherRegressions.sort(),
    blockingUnsupportedFindings: { control: controlUnsupported, treatment: treatmentUnsupported },
    confirmedNewFindingsOnCleanControls,
    unresolvedRequiredAdjudications,
    diagnosticExcludedFindingCount,
    efficiency: {
      metric: policy.efficiencyMetric,
      targetImprovementPercent: policy.targetImprovementPercent,
      observedImprovementPercent: deltas.length ? median(deltas) : null,
      confidenceIntervalPercent: deltasByCase.size > 1 ? clusterBootstrapInterval(deltasByCase, policy.bootstrapSamples, policy.bootstrapSeed) : null,
      pairedAttempts: deltas.length,
      resamplingUnit: "case",
    },
  };
}

export function writeFunnelDecision(runDirectory: string, casesDirectory = "eval/cases"): FunnelDecision {
  const root = resolve(runDirectory);
  const basePath = join(root, FUNNEL_DECISION_FILENAME);
  const derivedBase = buildFunnelDecisionArtifact(root, casesDirectory);
  const base = existsSync(basePath)
    ? parseFunnelDecisionArtifact(readExperimentJson(basePath), basePath)
    : derivedBase;
  if (base.schemaVersion !== 1 || canonicalJson(base) !== canonicalJson(derivedBase)) {
    throw new Error(`${basePath} does not match the currently verified sealed experiment evidence`);
  }
  if (!existsSync(basePath)) writeExclusiveJson(root, basePath, base);

  const ledger = readExperimentAdjudication(root);
  if (!ledger) return base.result;
  const revised = buildFunnelDecisionArtifact(root, casesDirectory, ledger, base);
  const revisedPath = join(root, FUNNEL_ADJUDICATED_DECISION_FILENAME);
  if (existsSync(revisedPath)) {
    const parsed = parseFunnelDecisionArtifact(readExperimentJson(revisedPath), revisedPath);
    if (canonicalJson(parsed) !== canonicalJson(revised)) throw new Error(`${revisedPath} does not match the currently verified adjudicated evidence`);
    return parsed.result;
  }
  writeExclusiveJson(root, revisedPath, revised);
  return revised.result;
}

export function readFunnelDecisionArtifact(
  runDirectory: string,
  casesDirectory = "eval/cases",
): FunnelDecisionArtifact {
  const root = resolve(runDirectory);
  const basePath = join(root, FUNNEL_DECISION_FILENAME);
  const base = parseFunnelDecisionArtifact(readExperimentJson(basePath), basePath);
  const derivedBase = buildFunnelDecisionArtifact(root, casesDirectory);
  if (base.schemaVersion !== 1 || canonicalJson(base) !== canonicalJson(derivedBase)) {
    throw new Error(`${basePath} does not match the currently verified sealed experiment evidence`);
  }
  const ledger = readExperimentAdjudication(root);
  if (!ledger) {
    if (existsSync(join(root, FUNNEL_ADJUDICATED_DECISION_FILENAME))) throw new Error("adjudicated funnel decision has no valid adjudication ledger");
    return base;
  }
  const revisedPath = join(root, FUNNEL_ADJUDICATED_DECISION_FILENAME);
  if (!existsSync(revisedPath)) throw new Error("adjudication ledger exists but its derived funnel decision has not been written");
  const parsed = parseFunnelDecisionArtifact(readExperimentJson(revisedPath), revisedPath);
  const derived = buildFunnelDecisionArtifact(root, casesDirectory, ledger, base);
  if (parsed.schemaVersion !== 2 || canonicalJson(parsed) !== canonicalJson(derived)) throw new Error(`${revisedPath} does not match the currently verified adjudicated evidence`);
  return parsed;
}

function buildFunnelDecisionArtifact(
  runDirectory: string,
  casesDirectory: string,
  adjudicationLedger?: ExperimentAdjudicationLedger,
  previousDecision?: FunnelDecisionArtifact,
): FunnelDecisionArtifact {
  const root = resolve(runDirectory);
  const matrixPath = join(root, MATRIX_MANIFEST_FILENAME);
  const matrix = parseMatrixRunManifest(readExperimentJson(matrixPath), matrixPath);
  const { seal: terminalSeal, evidence } = requireValidExperimentTerminalSeal(root, matrix);
  const binding = evidence.experiment.benchmarkCategory;
  if (!binding) throw new Error("experiment is not bound to a shortened benchmark category");
  if (evidence.experiment.lineage) throw new Error("retry experiments cannot decide a shortened-funnel gate");
  const completion = completionFromEvidence(evidence.experiment.schedule, evidence.records);
  let gradingSealSha256: string | undefined;
  let metrics: FunnelMetrics | null = null;
  if (terminalSeal.terminal === "completed") {
    const grading = requireValidExperimentGradingSeal(root, matrix);
    gradingSealSha256 = grading.seal.sealSha256;
    const uniqueCases = [...new Set(evidence.experiment.schedule.map((attempt) => attempt.caseName))];
    const corpusRoot = resolve(casesDirectory);
    if (hashExperimentCorpus(corpusRoot, uniqueCases) !== evidence.experiment.hashes.corpusSha256) {
      throw new Error("current benchmark corpus does not match the experiment's authenticated corpus snapshot");
    }
    const records = new Map(evidence.records.map((record) => [record.attemptId, record]));
    const truths = new Map(uniqueCases.map((caseName) => [caseName, readCaseGroundTruth(corpusRoot, caseName)]));
    const declaredJudge = evidence.experiment.protocol.judge;
    const expectedJudge: NonNullable<GradedRun["grading"]>["judge"] = declaredJudge.kind === "exact"
      ? { kind: "exact", version: "exact-v1" }
      : {
          kind: declaredJudge.kind,
          version: "semantic-v1",
          configSha256: canonicalJsonSha256({ judge: CODEX_SEMANTIC_JUDGE, limits: declaredJudge.limits }),
        };
    const gradedRuns = new Map<string, GradedRun>();
    for (const attempt of evidence.experiment.schedule) {
      const record = records.get(attempt.id);
      if (!record || record.outcome.status !== "completed") continue;
      const path = join(root, attempt.file.replace(/\.json$/, ".graded.json"));
      if (!existsSync(path)) throw new Error(`missing sealed grade ${path}`);
      const graded = parseGradedRun(readExperimentJson(path), path, attempt);
      assertGradedMatchesRun(graded, record, path);
      const truth = required(truths.get(attempt.caseName), `missing truth for ${attempt.caseName}`);
      const expectedBugIds = truth.bugs.map((bug) => bug.id).sort();
      const actualBugIds = Object.keys(graded.matches).sort();
      if (expectedBugIds.length !== actualBugIds.length || expectedBugIds.some((id, index) => id !== actualBugIds[index])) {
        throw new Error(`${path}.matches does not match ground truth bug IDs`);
      }
      const gradingEvidence = required(graded.grading, `missing authenticated grading evidence for ${attempt.id}`);
      assertGradingEvidenceConsistent(truth, graded.outcome.result.findings, graded.matches, gradingEvidence, path, expectedJudge);
      gradedRuns.set(attempt.id, graded);
    }
    metrics = deriveFunnelMetrics({
      binding,
      schedule: evidence.experiment.schedule,
      records: evidence.records,
      gradedRuns,
      truths,
      ...(adjudicationLedger ? { adjudications: adjudicationMap(adjudicationLedger) } : {}),
    });
  }
  const result = evaluateFunnelDecision({ binding, terminal: terminalSeal.terminal, completion, metrics });
  const body = {
    schemaVersion: adjudicationLedger ? 2 as const : 1 as const,
    experimentId: evidence.experiment.experimentId,
    benchmarkCategory: binding,
    terminalSealSha256: terminalSeal.sealSha256,
    terminal: terminalSeal.terminal,
    ...(gradingSealSha256 ? { gradingSealSha256 } : {}),
    completion,
    metrics,
    result,
    ...(adjudicationLedger ? {
      previousDecisionSha256: required(previousDecision?.decisionSha256, "adjudicated decision requires its prior decision"),
      adjudicationLedgerSha256: adjudicationLedger.ledgerSha256,
    } : {}),
  };
  const artifact = { ...body, decisionSha256: canonicalJsonSha256(body) };
  assertNoSecrets(artifact, "funnel decision artifact");
  return artifact;
}

/** Structural/content-address parser; use readFunnelDecisionArtifact to verify referenced run evidence. */
export function parseFunnelDecisionArtifact(value: unknown, source = "funnel decision"): FunnelDecisionArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be an object`);
  const artifact = value as FunnelDecisionArtifact;
  const keys = ["schemaVersion", "experimentId", "benchmarkCategory", "terminalSealSha256", "terminal", "completion", "metrics", "result", "decisionSha256"];
  if (artifact.gradingSealSha256 !== undefined) keys.push("gradingSealSha256");
  if (artifact.previousDecisionSha256 !== undefined) keys.push("previousDecisionSha256");
  if (artifact.adjudicationLedgerSha256 !== undefined) keys.push("adjudicationLedgerSha256");
  const unexpected = Object.keys(artifact).filter((key) => !keys.includes(key));
  if (unexpected.length || (artifact.schemaVersion !== 1 && artifact.schemaVersion !== 2) || typeof artifact.decisionSha256 !== "string") throw new Error(`${source} has an invalid shape`);
  const revised = artifact.schemaVersion === 2;
  if (revised !== (artifact.previousDecisionSha256 !== undefined) || revised !== (artifact.adjudicationLedgerSha256 !== undefined)) throw new Error(`${source} adjudication linkage does not match its schema version`);
  const { decisionSha256, ...body } = artifact;
  if (!/^[a-f0-9]{64}$/.test(decisionSha256) || decisionSha256 !== canonicalJsonSha256(body)) {
    throw new Error(`${source}.decisionSha256 does not authenticate its contents`);
  }
  const binding = parseBenchmarkCategoryBinding(artifact.benchmarkCategory, `${source}.benchmarkCategory`);
  if (!isSha256(artifact.experimentId) || !isSha256(artifact.terminalSealSha256) ||
    (artifact.gradingSealSha256 !== undefined && !isSha256(artifact.gradingSealSha256)) ||
    (artifact.previousDecisionSha256 !== undefined && !isSha256(artifact.previousDecisionSha256)) ||
    (artifact.adjudicationLedgerSha256 !== undefined && !isSha256(artifact.adjudicationLedgerSha256))) {
    throw new Error(`${source} contains an invalid identity hash`);
  }
  if (artifact.terminal !== "completed" && artifact.terminal !== "stopped") throw new Error(`${source}.terminal is invalid`);
  if ((artifact.terminal === "completed") !== (artifact.gradingSealSha256 !== undefined)) {
    throw new Error(`${source}.gradingSealSha256 must be present exactly for completed experiments`);
  }
  const completion = parseCompletion(artifact.completion, `${source}.completion`);
  const metrics = artifact.metrics === null ? null : parseMetrics(artifact.metrics, binding, `${source}.metrics`);
  const result = evaluateFunnelDecision({ binding, terminal: artifact.terminal, completion, metrics });
  if (JSON.stringify(result) !== JSON.stringify(artifact.result)) throw new Error(`${source}.result is not derived from its evidence`);
  assertNoSecrets(artifact, `${source} artifact`);
  return { ...artifact, benchmarkCategory: binding, completion, metrics, result };
}

function completionFromEvidence(schedule: readonly ExperimentScheduledAttempt[], records: readonly RunRecord[]): FunnelCompletion {
  const byAttempt = new Map(records.map((record) => [record.attemptId, record]));
  const completion: FunnelCompletion = { control: { scheduled: 0, completed: 0, failed: 0 }, treatment: { scheduled: 0, completed: 0, failed: 0 } };
  for (const attempt of schedule) {
    if (attempt.variant === "structural") continue;
    const bucket = completion[attempt.variant];
    bucket.scheduled++;
    const status = byAttempt.get(attempt.id)?.outcome.status;
    if (status === "completed") bucket.completed++;
    if (status === "failed") bucket.failed++;
  }
  return completion;
}

function clusterBootstrapInterval(groups: ReadonlyMap<string, readonly number[]>, samples: number, seed: number): { lower: number; upper: number } {
  const clusters = [...groups.values()];
  let state = seed >>> 0;
  const next = (): number => ((state = (Math.imul(1664525, state) + 1013904223) >>> 0) / 0x100000000);
  const estimates: number[] = [];
  for (let sample = 0; sample < samples; sample++) {
    const values: number[] = [];
    for (let index = 0; index < clusters.length; index++) values.push(...clusters[Math.floor(next() * clusters.length)]!);
    estimates.push(median(values));
  }
  estimates.sort((left, right) => left - right);
  return { lower: quantile(estimates, 0.025), upper: quantile(estimates, 0.975) };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function quantile(values: readonly number[], probability: number): number {
  const position = (values.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return values[lower]! + fraction * ((values[lower + 1] ?? values[lower]!) - values[lower]!);
}

function caseIdOf(caseName: string): string { return caseName.split("/").at(-1)!; }
function required<T>(value: T | undefined, message: string): T { if (value === undefined) throw new Error(message); return value; }
function decision(status: FunnelDecision["status"], nextCategory: BenchmarkCategory | null, reasons: string[]): FunnelDecision { return { status, nextCategory, reasons }; }

function parseCompletion(value: unknown, source: string): FunnelCompletion {
  const root = exactObject(value, ["control", "treatment"], source);
  const bucket = (value: unknown, label: string) => {
    const item = exactObject(value, ["scheduled", "completed", "failed"], label);
    return { scheduled: count(item.scheduled, `${label}.scheduled`), completed: count(item.completed, `${label}.completed`), failed: count(item.failed, `${label}.failed`) };
  };
  return { control: bucket(root.control, `${source}.control`), treatment: bucket(root.treatment, `${source}.treatment`) };
}

function parseMetrics(value: unknown, binding: ExperimentBenchmarkCategory, source: string): FunnelMetrics {
  const root = exactObject(value, [
    "reliableHighSeverityRegressions", "reliableOtherRegressions", "blockingUnsupportedFindings",
    "confirmedNewFindingsOnCleanControls", "unresolvedRequiredAdjudications", "diagnosticExcludedFindingCount", "efficiency",
  ], source);
  const blocking = exactObject(root.blockingUnsupportedFindings, ["control", "treatment"], `${source}.blockingUnsupportedFindings`);
  const efficiency = exactObject(root.efficiency, [
    "metric", "targetImprovementPercent", "observedImprovementPercent", "confidenceIntervalPercent", "pairedAttempts", "resamplingUnit",
  ], `${source}.efficiency`);
  if (efficiency.metric !== binding.definition.gate.efficiencyMetric || efficiency.targetImprovementPercent !== binding.definition.gate.targetImprovementPercent || efficiency.resamplingUnit !== "case") {
    throw new Error(`${source}.efficiency does not match the frozen gate`);
  }
  let interval: FunnelMetrics["efficiency"]["confidenceIntervalPercent"] = null;
  if (efficiency.confidenceIntervalPercent !== null) {
    const raw = exactObject(efficiency.confidenceIntervalPercent, ["lower", "upper"], `${source}.efficiency.confidenceIntervalPercent`);
    interval = { lower: finite(raw.lower, `${source}.efficiency.confidenceIntervalPercent.lower`), upper: finite(raw.upper, `${source}.efficiency.confidenceIntervalPercent.upper`) };
    if (interval.lower > interval.upper) throw new Error(`${source}.efficiency confidence interval is reversed`);
  }
  return {
    reliableHighSeverityRegressions: stringArray(root.reliableHighSeverityRegressions, `${source}.reliableHighSeverityRegressions`),
    reliableOtherRegressions: stringArray(root.reliableOtherRegressions, `${source}.reliableOtherRegressions`),
    blockingUnsupportedFindings: { control: count(blocking.control, `${source}.blockingUnsupportedFindings.control`), treatment: count(blocking.treatment, `${source}.blockingUnsupportedFindings.treatment`) },
    confirmedNewFindingsOnCleanControls: count(root.confirmedNewFindingsOnCleanControls, `${source}.confirmedNewFindingsOnCleanControls`),
    unresolvedRequiredAdjudications: count(root.unresolvedRequiredAdjudications, `${source}.unresolvedRequiredAdjudications`),
    diagnosticExcludedFindingCount: count(root.diagnosticExcludedFindingCount, `${source}.diagnosticExcludedFindingCount`),
    efficiency: {
      metric: "paired-median-wall-time", targetImprovementPercent: binding.definition.gate.targetImprovementPercent,
      observedImprovementPercent: efficiency.observedImprovementPercent === null ? null : finite(efficiency.observedImprovementPercent, `${source}.efficiency.observedImprovementPercent`),
      confidenceIntervalPercent: interval, pairedAttempts: count(efficiency.pairedAttempts, `${source}.efficiency.pairedAttempts`), resamplingUnit: "case",
    },
  };
}

function exactObject(value: unknown, keys: readonly string[], source: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be an object`);
  const root = value as Record<string, unknown>;
  const unexpected = Object.keys(root).filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !(key in root));
  if (unexpected.length || missing.length) throw new Error(`${source} has an invalid shape`);
  return root;
}
function isSha256(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function count(value: unknown, source: string): number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${source} must be a non-negative integer`); return value as number; }
function finite(value: unknown, source: string): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${source} must be finite`); return value; }
function stringArray(value: unknown, source: string): string[] { if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) throw new Error(`${source} must be a string array`); return value as string[]; }
