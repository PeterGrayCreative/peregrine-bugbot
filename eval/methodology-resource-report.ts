import { join } from "node:path";
import { assertNoSecrets } from "../src/security/secrets.js";
import type { UsageMetric } from "../src/types.js";
import { canonicalJson, canonicalJsonSha256, readExperimentJson, writeExclusiveJson } from "./experiment.js";
import {
  buildMethodologyResourceSet,
  type MethodologyResourceSetArtifact,
} from "./methodology-resource-artifact.js";
import { METHODOLOGY_ARM_IDS, parseMethodologySchedule, type MethodologyArmId } from "./methodology-schedule.js";

export const METHODOLOGY_RESOURCE_REPORT_FILE = "methodology-resource-report.json";
type NumericUsageMetric = Exclude<UsageMetric, "toolCallsByType">;

export interface MethodologyNumericResourceSummary {
  scheduled: number;
  observed: number;
  unknown: number;
  observedSubtotal: number;
  total: number | null;
  medianObserved: number | null;
  p95Observed: number | null;
}

export interface MethodologyArmResourceReport {
  armId: MethodologyArmId;
  outcomes: Record<"completed" | "review-failed" | "preflight-failed" | "interrupted" | "missing", number>;
  wallDurationMs: MethodologyNumericResourceSummary;
  reviewDurationMs: MethodologyNumericResourceSummary;
  usage: Record<NumericUsageMetric, MethodologyNumericResourceSummary>;
}

export interface MethodologyResourceReport {
  schemaVersion: 1;
  protocol: "historical-methodology-resource-report-v1";
  runId: string;
  scheduleSha256: string;
  executionEvidenceSha256: string;
  inputPlanSha256: string;
  resourceSetSha256: string;
  arms: MethodologyArmResourceReport[];
  claims: {
    missingMetrics: "unknown-not-zero";
    conditionalPairing: "not-calculated";
    monetaryCost: "reported-only-when-observed";
  };
  reportSha256: string;
}

export function buildMethodologyResourceReport(input: {
  schedule: unknown;
  resources: MethodologyResourceSetArtifact;
}): MethodologyResourceReport {
  const schedule = parseMethodologySchedule(input.schedule, "methodology resource report schedule");
  const rebuilt = buildMethodologyResourceSet({
    runId: input.resources.runId,
    schedule,
    executionEvidenceSha256: input.resources.executionEvidenceSha256,
    invocationRegistrationSha256: input.resources.invocationRegistrationSha256,
    inputPlanSha256: input.resources.inputPlanSha256,
    resources: input.resources.resources,
    recordedAt: input.resources.recordedAt,
  });
  if (canonicalJson(rebuilt) !== canonicalJson(input.resources)) {
    throw new Error("methodology resource report received an invalid resource set");
  }
  const byAttempt = new Map(input.resources.resources.map((resource) => [resource.attemptId, resource]));
  const arms = METHODOLOGY_ARM_IDS.map((armId): MethodologyArmResourceReport => {
    const attempts = schedule.attempts.filter((attempt) => attempt.armId === armId);
    const resources = attempts.map((attempt) => {
      const resource = byAttempt.get(attempt.id);
      if (!resource || resource.armId !== armId || resource.caseName !== attempt.caseName) {
        throw new Error(`methodology resource report arm ${armId} identity mismatch`);
      }
      return resource;
    });
    return {
      armId,
      outcomes: {
        completed: resources.filter((item) => item.outcome === "completed").length,
        "review-failed": resources.filter((item) => item.outcome === "review-failed").length,
        "preflight-failed": resources.filter((item) => item.outcome === "preflight-failed").length,
        interrupted: resources.filter((item) => item.outcome === "interrupted").length,
        missing: resources.filter((item) => item.outcome === "missing").length,
      },
      wallDurationMs: numericSummary(resources.map((item) => item.wallDurationMs)),
      reviewDurationMs: numericSummary(resources.map((item) => item.reviewDurationMs)),
      usage: Object.fromEntries(NUMERIC_USAGE_METRICS.map((metric) => [metric,
        numericSummary(resources.map((item) => item.usage?.[metric] ?? null)),
      ])) as Record<NumericUsageMetric, MethodologyNumericResourceSummary>,
    };
  });
  const body = {
    schemaVersion: 1 as const,
    protocol: "historical-methodology-resource-report-v1" as const,
    runId: input.resources.runId,
    scheduleSha256: input.resources.scheduleSha256,
    executionEvidenceSha256: input.resources.executionEvidenceSha256,
    inputPlanSha256: input.resources.inputPlanSha256,
    resourceSetSha256: input.resources.artifactSha256,
    arms,
    claims: {
      missingMetrics: "unknown-not-zero" as const,
      conditionalPairing: "not-calculated" as const,
      monetaryCost: "reported-only-when-observed" as const,
    },
  };
  return { ...body, reportSha256: canonicalJsonSha256(body) };
}

export function writeMethodologyResourceReport(root: string, input: {
  schedule: unknown;
  resources: MethodologyResourceSetArtifact;
}): MethodologyResourceReport {
  const report = buildMethodologyResourceReport(input);
  assertNoSecrets(report, "methodology resource report");
  writeExclusiveJson(root, join(root, METHODOLOGY_RESOURCE_REPORT_FILE), report);
  return report;
}

export function readMethodologyResourceReport(root: string, input: {
  expectedReportSha256: string;
  schedule: unknown;
  resources: MethodologyResourceSetArtifact;
}): MethodologyResourceReport {
  const raw = readExperimentJson(join(root, METHODOLOGY_RESOURCE_REPORT_FILE)) as MethodologyResourceReport;
  const report = buildMethodologyResourceReport(input);
  if (report.reportSha256 !== input.expectedReportSha256 || canonicalJson(report) !== canonicalJson(raw)) {
    throw new Error("methodology resource report digest mismatch");
  }
  return report;
}

const NUMERIC_USAGE_METRICS: NumericUsageMetric[] = [
  "inputTokens", "baseInputTokens", "uncachedInputTokens", "cachedInputTokens",
  "cacheWriteInputTokens", "cacheReadInputTokens", "outputTokens", "reasoningOutputTokens",
  "turns", "toolCalls", "toolOutputBytes", "promptBytes", "costUsd",
];

function numericSummary(values: readonly (number | null | undefined)[]): MethodologyNumericResourceSummary {
  const observed = values.filter((value): value is number => typeof value === "number");
  const observedSubtotal = observed.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(observedSubtotal) ||
      (observed.every(Number.isSafeInteger) && !Number.isSafeInteger(observedSubtotal))) {
    throw new Error("methodology resource report subtotal exceeds numeric bounds");
  }
  const sorted = [...observed].sort((left, right) => left - right);
  return {
    scheduled: values.length,
    observed: observed.length,
    unknown: values.length - observed.length,
    observedSubtotal,
    total: observed.length === values.length ? observedSubtotal : null,
    medianObserved: quantile(sorted, 0.5),
    p95Observed: quantile(sorted, 0.95),
  };
}

function quantile(sorted: readonly number[], probability: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.ceil(sorted.length * probability) - 1]!;
}
