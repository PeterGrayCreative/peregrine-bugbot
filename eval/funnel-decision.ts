import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BenchmarkCategory, MatrixRunManifest } from "../src/types.js";
import { parseMatrixRunManifest } from "./artifacts.js";
import { canonicalJsonSha256, readExperimentJson, writeExclusiveJson } from "./experiment.js";
import { MATRIX_MANIFEST_FILENAME } from "./experiment-evidence.js";
import { loadBenchmarkPanelRegistry } from "./benchmark-panels.js";
import {
  requireValidExperimentGradingSeal,
  requireValidExperimentTerminalSeal,
} from "./experiment-seals.js";

export const FUNNEL_DECISION_FILENAME = "funnel-decision.json";

export interface FunnelAssessment {
  schemaVersion: 1;
  experimentId: string;
  benchmarkCategory: BenchmarkCategory;
  reliableHighSeverityRegressions: number;
  reliableOtherRegressions: number;
  blockingUnsupportedFindings: { control: number; treatment: number };
  unresolvedRequiredAdjudications: number;
  efficiency: {
    metric: "paired-median-wall-time" | "effective-cost";
    targetImprovementPercent: number;
    observedImprovementPercent: number | null;
    confidenceIntervalPercent: { lower: number; upper: number } | null;
  };
  notes: string[];
}

export interface FunnelCompletion {
  control: { scheduled: number; completed: number; failed: number };
  treatment: { scheduled: number; completed: number; failed: number };
}

export interface FunnelDecision {
  status: "advance" | "complete" | "reject" | "inconclusive" | "diagnostic-only";
  nextCategory: BenchmarkCategory | null;
  reasons: string[];
}

export function evaluateFunnelDecision(input: {
  category: BenchmarkCategory;
  evidenceUse: "paired-acceptance" | "treatment-only-diagnostic";
  terminal: "completed" | "stopped";
  completion: FunnelCompletion;
  assessment: FunnelAssessment;
}): FunnelDecision {
  if (input.assessment.benchmarkCategory !== input.category) {
    throw new Error("funnel assessment category does not match the evaluated category");
  }
  const nextCategory = nextPanel(input.category);
  if (input.terminal === "stopped") {
    return decision("reject", null, ["The experiment stopped before its preregistered schedule completed."]);
  }
  if (input.evidenceUse === "treatment-only-diagnostic") {
    return decision("diagnostic-only", null, [
      "Treatment-only evidence can guide development but cannot advance or complete the funnel.",
    ]);
  }
  const { control, treatment } = input.completion;
  if (control.scheduled === 0 || treatment.scheduled === 0 || control.scheduled !== treatment.scheduled) {
    return decision("reject", null, ["Acceptance evidence is not a complete contemporaneous paired schedule."]);
  }
  if (control.completed + control.failed !== control.scheduled ||
    treatment.completed + treatment.failed !== treatment.scheduled) {
    return decision("reject", null, ["Scheduled attempts are missing terminal evidence."]);
  }
  if (treatment.completed / treatment.scheduled < control.completed / control.scheduled) {
    return decision("reject", null, ["Treatment completion rate regressed relative to control."]);
  }
  if (input.assessment.reliableHighSeverityRegressions > 0) {
    return decision("reject", null, ["A reliable high-severity root regressed."]);
  }
  if (input.assessment.blockingUnsupportedFindings.treatment >
    input.assessment.blockingUnsupportedFindings.control) {
    return decision("reject", null, ["Treatment introduced additional blocking unsupported findings."]);
  }
  if (input.assessment.reliableOtherRegressions > 0) {
    return input.category === "confirmation" || input.category === "full-checkpoint"
      ? decision("reject", null, ["A reliable registered root regressed at a confirmation gate."])
      : decision("inconclusive", null, ["A non-high reliable root regressed and requires confirmation."]);
  }
  if (input.assessment.unresolvedRequiredAdjudications > 0) {
    return decision("inconclusive", null, ["Required non-diagnostic findings remain unresolved."]);
  }

  const efficiency = input.assessment.efficiency;
  if (input.category === "smoke") {
    return decision("advance", nextCategory, ["Safety and completion gates passed; efficiency is not a smoke gate."]);
  }
  if (efficiency.observedImprovementPercent === null) {
    return decision("inconclusive", null, ["The preregistered efficiency metric is unavailable."]);
  }
  if (efficiency.observedImprovementPercent <= 0) {
    return decision("reject", null, ["Treatment did not improve the preregistered efficiency metric."]);
  }
  const interval = efficiency.confidenceIntervalPercent;
  if (interval && interval.upper < efficiency.targetImprovementPercent) {
    return decision("reject", null, ["The efficiency target is unattainable within the observed confidence interval."]);
  }
  if (input.category === "fast-screen") {
    return decision("advance", nextCategory, ["Safety gates passed and the efficiency signal is positive."]);
  }
  if (efficiency.observedImprovementPercent < efficiency.targetImprovementPercent ||
    !interval || interval.lower <= 0) {
    return decision("inconclusive", null, [
      "Confirmation requires the target improvement and a confidence interval wholly above zero.",
    ]);
  }
  return input.category === "full-checkpoint"
    ? decision("complete", null, ["All full-checkpoint safety, completion, and efficiency gates passed."])
    : decision("advance", nextCategory, ["All confirmation safety, completion, and efficiency gates passed."]);
}

export function parseFunnelAssessment(value: unknown, source = "funnel assessment"): FunnelAssessment {
  const root = strictObject(value, source, [
    "schemaVersion", "experimentId", "benchmarkCategory", "reliableHighSeverityRegressions",
    "reliableOtherRegressions", "blockingUnsupportedFindings", "unresolvedRequiredAdjudications",
    "efficiency", "notes",
  ]);
  if (root.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  const blocking = strictObject(root.blockingUnsupportedFindings, `${source}.blockingUnsupportedFindings`, ["control", "treatment"]);
  const efficiency = strictObject(root.efficiency, `${source}.efficiency`, [
    "metric", "targetImprovementPercent", "observedImprovementPercent", "confidenceIntervalPercent",
  ]);
  const interval = efficiency.confidenceIntervalPercent === null
    ? null
    : strictObject(efficiency.confidenceIntervalPercent, `${source}.efficiency.confidenceIntervalPercent`, ["lower", "upper"]);
  const notes = stringArray(root.notes, `${source}.notes`);
  const parsed: FunnelAssessment = {
    schemaVersion: 1,
    experimentId: hash(root.experimentId, `${source}.experimentId`),
    benchmarkCategory: category(root.benchmarkCategory, `${source}.benchmarkCategory`),
    reliableHighSeverityRegressions: count(root.reliableHighSeverityRegressions, `${source}.reliableHighSeverityRegressions`),
    reliableOtherRegressions: count(root.reliableOtherRegressions, `${source}.reliableOtherRegressions`),
    blockingUnsupportedFindings: {
      control: count(blocking.control, `${source}.blockingUnsupportedFindings.control`),
      treatment: count(blocking.treatment, `${source}.blockingUnsupportedFindings.treatment`),
    },
    unresolvedRequiredAdjudications: count(root.unresolvedRequiredAdjudications, `${source}.unresolvedRequiredAdjudications`),
    efficiency: {
      metric: member(efficiency.metric, ["paired-median-wall-time", "effective-cost"] as const, `${source}.efficiency.metric`),
      targetImprovementPercent: finite(efficiency.targetImprovementPercent, `${source}.efficiency.targetImprovementPercent`, 0),
      observedImprovementPercent: efficiency.observedImprovementPercent === null
        ? null
        : finite(efficiency.observedImprovementPercent, `${source}.efficiency.observedImprovementPercent`),
      confidenceIntervalPercent: interval === null ? null : {
        lower: finite(interval.lower, `${source}.efficiency.confidenceIntervalPercent.lower`),
        upper: finite(interval.upper, `${source}.efficiency.confidenceIntervalPercent.upper`),
      },
    },
    notes,
  };
  if (parsed.efficiency.confidenceIntervalPercent &&
    parsed.efficiency.confidenceIntervalPercent.lower > parsed.efficiency.confidenceIntervalPercent.upper) {
    throw new Error(`${source}.efficiency.confidenceIntervalPercent lower must not exceed upper`);
  }
  return parsed;
}

export function writeFunnelDecision(runDirectory: string, assessmentPath: string): FunnelDecision {
  const root = resolve(runDirectory);
  const matrix = parseMatrixRunManifest(
    readExperimentJson(join(root, MATRIX_MANIFEST_FILENAME)),
    join(root, MATRIX_MANIFEST_FILENAME),
  );
  const { seal: terminalSeal, evidence } = requireValidExperimentTerminalSeal(root, matrix);
  const categoryBinding = evidence.experiment.benchmarkCategory;
  if (!categoryBinding) throw new Error("experiment is not bound to a shortened benchmark category");
  const assessment = parseFunnelAssessment(JSON.parse(readFileSync(resolve(assessmentPath), "utf8")), assessmentPath);
  if (assessment.experimentId !== evidence.experiment.experimentId || assessment.benchmarkCategory !== categoryBinding.name) {
    throw new Error("funnel assessment does not match the experiment identity and category");
  }
  const diagnosticCases = loadBenchmarkPanelRegistry().panels[categoryBinding.name].roles.diagnosticOnlyCases;
  for (const caseId of diagnosticCases) {
    if (!assessment.notes.some((note) => note.includes(caseId) && /diagnostic/i.test(note))) {
      throw new Error(`funnel assessment must document diagnostic-only exclusion for ${caseId}`);
    }
  }
  const gradingSeal = terminalSeal.terminal === "completed"
    ? requireValidExperimentGradingSeal(root, matrix).seal
    : undefined;
  const completion = completionFromEvidence(evidence.experiment.schedule, evidence.records);
  const result = evaluateFunnelDecision({
    category: categoryBinding.name,
    evidenceUse: categoryBinding.evidenceUse,
    terminal: terminalSeal.terminal,
    completion,
    assessment,
  });
  const body = {
    schemaVersion: 1 as const,
    experimentId: evidence.experiment.experimentId,
    benchmarkCategory: categoryBinding,
    terminalSealSha256: terminalSeal.sealSha256,
    ...(gradingSeal ? { gradingSealSha256: gradingSeal.sealSha256 } : {}),
    assessment,
    assessmentSha256: canonicalJsonSha256(assessment),
    completion,
    result,
  };
  writeExclusiveJson(root, join(root, FUNNEL_DECISION_FILENAME), {
    ...body,
    decisionSha256: canonicalJsonSha256(body),
  });
  return result;
}

function completionFromEvidence(
  schedule: readonly { id: string; variant: "structural" | "control" | "treatment" }[],
  records: readonly { attemptId: string; outcome: { status: "completed" | "failed" } }[],
): FunnelCompletion {
  const byAttempt = new Map(records.map((record) => [record.attemptId, record]));
  const completion: FunnelCompletion = {
    control: { scheduled: 0, completed: 0, failed: 0 },
    treatment: { scheduled: 0, completed: 0, failed: 0 },
  };
  for (const attempt of schedule) {
    if (attempt.variant === "structural") continue;
    const variant = attempt.variant;
    const bucket = completion[variant];
    bucket.scheduled++;
    const status = byAttempt.get(attempt.id)?.outcome.status;
    if (status === "completed") bucket.completed++;
    if (status === "failed") bucket.failed++;
  }
  return completion;
}

function decision(status: FunnelDecision["status"], nextCategory: BenchmarkCategory | null, reasons: string[]): FunnelDecision {
  return { status, nextCategory, reasons };
}

function nextPanel(category: BenchmarkCategory): BenchmarkCategory | null {
  return ({ smoke: "fast-screen", "fast-screen": "confirmation", confirmation: "full-checkpoint", "full-checkpoint": null } as const)[category];
}

function strictObject(value: unknown, source: string, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be an object`);
  const root = value as Record<string, unknown>;
  const unexpected = Object.keys(root).filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !(key in root));
  if (unexpected.length) throw new Error(`${source} contains unsupported field ${unexpected[0]}`);
  if (missing.length) throw new Error(`${source} is missing ${missing[0]}`);
  return root;
}

function count(value: unknown, source: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${source} must be a non-negative integer`);
  return value as number;
}

function finite(value: unknown, source: string, minimum?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (minimum !== undefined && value < minimum)) {
    throw new Error(`${source} must be a finite number${minimum === undefined ? "" : ` >= ${minimum}`}`);
  }
  return value;
}

function hash(value: unknown, source: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${source} must be a SHA-256`);
  return value;
}

function category(value: unknown, source: string): BenchmarkCategory {
  return member(value, ["smoke", "fast-screen", "confirmation", "full-checkpoint"] as const, source);
}

function member<T extends string>(value: unknown, values: readonly T[], source: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new Error(`${source} is invalid`);
  return value as T;
}

function stringArray(value: unknown, source: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${source} must be an array`);
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) throw new Error(`${source}[${index}] must be non-empty`);
    return item;
  });
}
