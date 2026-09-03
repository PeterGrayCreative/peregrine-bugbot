import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  EngineResult,
  CaseCorpus,
  GradedRun,
  MatrixRunManifest,
  RunRecord,
} from "../src/types.js";
import type { RunFailureKind } from "../src/core/run-failure.js";
import { readCaseGroundTruth } from "./case-truth.js";

type LegacyGradedRun = Omit<GradedRun, "schemaVersion" | "attemptId" | "finishedAt" | "outcome"> & {
  result: EngineResult;
};
type ReportCostSource = "provider" | "estimated" | "mixed" | "mock" | "unknown" | null;

export interface ConfigStats {
  config: string;
  corpus: CaseCorpus | "unknown";
  completeness: "tracked" | "legacy-incomplete";
  expectedRuns: number | null;
  runs: number;
  completedRuns: number;
  failedRuns: number | null;
  missingRuns: number | null;
  completionRate: number | null;
  failuresByKind: Partial<Record<RunFailureKind, number>>;
  failureRatesByKind: Partial<Record<RunFailureKind, number>>;
  recallMean: number | null;
  recallStd: number | null;
  failureInclusiveRecallMean: number | null;
  fpPerCaseMean: number | null;
  costPerCaseMean: number | null;
  costPerCaseStd: number | null;
  costSource: ReportCostSource;
  durationSecMean: number | null;
  durationSecMedian: number | null;
  durationSecP95: number | null;
  breadthDurationSecMean: number | null;
  investigationDurationSecMean: number | null;
  breadthInputTokensMean: number | null;
  investigationInputTokensMean: number | null;
  inputTokensMean: number | null;
  uncachedInputTokensMean: number | null;
  cacheWriteInputTokensMean: number | null;
  cacheReadInputTokensMean: number | null;
  outputTokensMean: number | null;
  reasoningOutputTokensMean: number | null;
  turnsMean: number | null;
  toolCallsMean: number | null;
  toolOutputBytesMean: number | null;
  promptBytesMean: number | null;
  telemetryExpectedRuns: number | null;
  telemetryObserved: Record<string, number>;
  /** Known spend actually incurred; a lower bound when some attempts lack cost. */
  incurredCostUsdTotal: number | null;
  incurredCostObservedAttempts: number;
  incurredCostSource: ReportCostSource;
  validFindingsPerDollar: number | null;
}

export async function buildReport(
  runsDir?: string,
  options: { casesDir?: string } = {},
): Promise<ConfigStats[]> {
  const dir = resolve(runsDir ?? latestRunsDir());
  const casesDir = resolve(options.casesDir ?? "eval/cases");
  const manifestPath = join(dir, "matrix-manifest.json");
  const stats = existsSync(manifestPath)
    ? trackedStats(dir, casesDir, JSON.parse(readFileSync(manifestPath, "utf8")) as MatrixRunManifest)
    : legacyStats(dir);

  if (stats.length === 0) {
    throw new Error(`No benchmark run artifacts in ${dir} — run eval:grade first.`);
  }

  stats.sort((a, b) => (b.recallMean ?? -1) - (a.recallMean ?? -1));
  writeFileSync(join(dir, "benchmark.json"), JSON.stringify(stats, null, 2));
  writeFileSync(join(dir, "benchmark.html"), renderHtml(stats));
  printStats(stats, dir);
  return stats;
}

function trackedStats(dir: string, casesDir: string, manifest: MatrixRunManifest): ConfigStats[] {
  const byConfig = groupBy(
    manifest.expectedAttempts,
    (attempt) => `${attempt.configName}\0${attempt.corpus ?? "unknown"}`,
  );
  const countBugs = (attempt: MatrixRunManifest["expectedAttempts"][number]): number | null => {
    const snapshot = (attempt as { expectedBugCount?: number | null }).expectedBugCount;
    if (snapshot !== undefined) return snapshot;
    try {
      return readCaseGroundTruth(casesDir, attempt.caseName).bugs.length;
    } catch {
      return null;
    }
  };

  return [...byConfig.values()].map((attempts) => {
    const config = attempts[0]!.configName;
    const corpus = attempts[0]!.corpus ?? "unknown";
    const completed: GradedRun[] = [];
    const failed: Array<Extract<RunRecord["outcome"], { status: "failed" }>> = [];
    let missing = 0;
    let denominatorUnavailable = false;
    const failureInclusiveRecalls: number[] = [];

    for (const attempt of attempts) {
      const bugCount = countBugs(attempt);
      if (bugCount === null) denominatorUnavailable = true;
      const rawPath = join(dir, attempt.file);
      if (!existsSync(rawPath)) {
        missing++;
        if ((bugCount ?? 0) > 0) failureInclusiveRecalls.push(0);
        continue;
      }
      const raw = JSON.parse(readFileSync(rawPath, "utf8")) as RunRecord;
      if (raw.outcome.status === "failed") {
        failed.push(raw.outcome);
        if ((bugCount ?? 0) > 0) failureInclusiveRecalls.push(0);
        continue;
      }
      const gradedPath = rawPath.replace(/\.json$/, ".graded.json");
      if (!existsSync(gradedPath)) {
        throw new Error(`${attempt.file} completed but has no graded artifact — run eval:grade first.`);
      }
      const graded = JSON.parse(readFileSync(gradedPath, "utf8")) as GradedRun;
      completed.push(graded);
      const recall = runRecall(graded);
      if (recall !== null) failureInclusiveRecalls.push(recall);
    }

    return calculateStats({
      config,
      corpus,
      completeness: "tracked",
      expectedRuns: attempts.length,
      completed,
      failed,
      missing,
      failureInclusiveRecalls: denominatorUnavailable ? null : failureInclusiveRecalls,
    });
  });
}

function legacyStats(dir: string): ConfigStats[] {
  const graded = readdirSync(dir)
    .filter((file) => file.endsWith(".graded.json"))
    .map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")) as LegacyGradedRun | GradedRun);
  const byConfig = groupBy(graded, (run) => run.configName);
  return [...byConfig.entries()].map(([config, legacyRuns]) => {
    const completed = legacyRuns.map((run): GradedRun =>
      "outcome" in run
        ? run
        : {
            ...run,
            schemaVersion: 1 as const,
            attemptId: `${run.configName}--${run.caseName}--${run.repeat}`,
            finishedAt: run.startedAt,
            outcome: { status: "completed", result: run.result },
          },
    );
    return calculateStats({
      config,
      corpus: "unknown",
      completeness: "legacy-incomplete",
      expectedRuns: null,
      completed,
      failed: [],
      missing: null,
      failureInclusiveRecalls: null,
    });
  });
}

function calculateStats(args: {
  config: string;
  corpus: ConfigStats["corpus"];
  completeness: ConfigStats["completeness"];
  expectedRuns: number | null;
  completed: GradedRun[];
  failed: Array<Extract<RunRecord["outcome"], { status: "failed" }>>;
  missing: number | null;
  failureInclusiveRecalls: number[] | null;
}): ConfigStats {
  const recalls = args.completed.map(runRecall).filter((value): value is number => value !== null);
  const fps = args.completed.map((run) => run.falsePositiveIndexes.length);
  const costs = args.completed
    .map((run) => run.outcome.result.usage.costUsd)
    .filter((cost): cost is number => typeof cost === "number" && Number.isFinite(cost) && cost >= 0);
  const durations = [
    ...args.completed.map((run) => run.outcome.result.durationMs),
    ...args.failed.map((failure) => failure.durationMs),
  ].filter((duration): duration is number =>
    typeof duration === "number" && Number.isFinite(duration) && duration >= 0).map((duration) => duration / 1000);
  const usage = (field: keyof EngineResult["usage"]): number[] => args.completed
    .map((run) => run.outcome.result.usage[field])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  const breadthDurations = stageNumbers(args.completed, "breadth", "durationMs").map((value) => value / 1000);
  const investigationDurations = stageNumbers(args.completed, "investigation", "durationMs").map((value) => value / 1000);
  const breadthInputs = stageUsageNumbers(args.completed, "breadth", "inputTokens");
  const investigationInputs = stageUsageNumbers(args.completed, "investigation", "inputTokens");
  const failedTelemetry = args.failed.flatMap((failure) => failure.telemetry ? [failure.telemetry] : []);
  const failedStages = failedTelemetry.flatMap((telemetry) => telemetry.stages);
  const observedFailureUsage = (field: keyof EngineResult["usage"]): number => failedTelemetry
    .filter((telemetry) => {
      const value = telemetry.usage[field];
      return typeof value === "number" && Number.isFinite(value) && value >= 0;
    }).length;
  const usageValues = {
    inputTokens: usage("inputTokens"),
    uncachedInputTokens: usage("uncachedInputTokens"),
    cacheWriteInputTokens: usage("cacheWriteInputTokens"),
    cacheReadInputTokens: usage("cacheReadInputTokens"),
    outputTokens: usage("outputTokens"),
    reasoningOutputTokens: usage("reasoningOutputTokens"),
    turns: usage("turns"),
    toolCalls: usage("toolCalls"),
    toolOutputBytes: usage("toolOutputBytes"),
    promptBytes: usage("promptBytes"),
  };
  const totalValid = args.completed.reduce(
    (sum, run) => sum + Object.values(run.matches).filter((match) => match !== null).length,
    0,
  );
  const totalCost = finiteSum(costs);
  const isTrackedComplete =
    args.completeness === "tracked" &&
    args.expectedRuns === args.completed.length &&
    args.failed.length === 0 &&
    args.missing === 0;
  const hasCompleteDuration = args.completeness === "tracked" &&
    args.expectedRuns !== null && args.missing === 0 && durations.length === args.expectedRuns;
  const hasCompleteCost =
    isTrackedComplete &&
    costs.length === args.completed.length;
  const costSources = args.completed.map((run) => usageCostSource(run.outcome.result.usage));
  const costSource = hasCompleteCost ? summarizeCostSource(costSources) : null;
  const estimatedPricing = args.completed.map((run) => run.outcome.result.usage.pricing);
  const hasComparableCost = hasCompleteCost && totalCost !== null && costSource !== "mixed" && costSource !== "unknown" &&
    (costSource !== "estimated" || comparableEstimatedPricing(estimatedPricing));
  const incurred = incurredCosts(args.completed, args.failed);

  const failuresByKind = countBy(args.failed, (failure) => failure.failureKind);
  const failureRatesByKind = Object.fromEntries(
    Object.entries(failuresByKind).map(([kind, count]) => [
      kind,
      args.expectedRuns === null ? 0 : count / args.expectedRuns,
    ]),
  );

  return {
    config: args.config,
    corpus: args.corpus,
    completeness: args.completeness,
    expectedRuns: args.expectedRuns,
    runs: args.completed.length,
    completedRuns: args.completed.length,
    failedRuns: args.completeness === "tracked" ? args.failed.length : null,
    missingRuns: args.missing,
    completionRate: args.expectedRuns === null ? null : args.completed.length / args.expectedRuns,
    failuresByKind,
    failureRatesByKind,
    recallMean: recalls.length > 0 ? mean(recalls) : null,
    recallStd: recalls.length > 0 ? std(recalls) : null,
    failureInclusiveRecallMean:
      args.failureInclusiveRecalls === null || args.failureInclusiveRecalls.length === 0
        ? null
        : mean(args.failureInclusiveRecalls),
    fpPerCaseMean: fps.length > 0 ? mean(fps) : null,
    costPerCaseMean: hasComparableCost ? mean(costs) : null,
    costPerCaseStd: hasComparableCost ? std(costs) : null,
    costSource,
    durationSecMean: completeMean(durations, hasCompleteDuration ? args.expectedRuns! : 0),
    durationSecMedian: hasCompleteDuration ? median(durations) : null,
    durationSecP95: hasCompleteDuration ? durationP95(durations) : null,
    breadthDurationSecMean: completeMean(breadthDurations, isTrackedComplete ? args.expectedRuns! : 0),
    investigationDurationSecMean: completeMean(investigationDurations, isTrackedComplete ? args.expectedRuns! : 0),
    breadthInputTokensMean: completeMean(breadthInputs, isTrackedComplete ? args.expectedRuns! : 0),
    investigationInputTokensMean: completeMean(investigationInputs, isTrackedComplete ? args.expectedRuns! : 0),
    inputTokensMean: completeMean(usageValues.inputTokens, isTrackedComplete ? args.expectedRuns! : 0),
    uncachedInputTokensMean: completeMean(usageValues.uncachedInputTokens, isTrackedComplete ? args.expectedRuns! : 0),
    cacheWriteInputTokensMean: completeMean(usageValues.cacheWriteInputTokens, isTrackedComplete ? args.expectedRuns! : 0),
    cacheReadInputTokensMean: completeMean(usageValues.cacheReadInputTokens, isTrackedComplete ? args.expectedRuns! : 0),
    outputTokensMean: completeMean(usageValues.outputTokens, isTrackedComplete ? args.expectedRuns! : 0),
    reasoningOutputTokensMean: completeMean(usageValues.reasoningOutputTokens, isTrackedComplete ? args.expectedRuns! : 0),
    turnsMean: completeMean(usageValues.turns, isTrackedComplete ? args.expectedRuns! : 0),
    toolCallsMean: completeMean(usageValues.toolCalls, isTrackedComplete ? args.expectedRuns! : 0),
    toolOutputBytesMean: completeMean(usageValues.toolOutputBytes, isTrackedComplete ? args.expectedRuns! : 0),
    promptBytesMean: completeMean(usageValues.promptBytes, isTrackedComplete ? args.expectedRuns! : 0),
    telemetryExpectedRuns: args.expectedRuns,
    telemetryObserved: {
      costUsd: incurred.observedAttempts,
      durationMs: args.completeness === "tracked" ? durations.length : 0,
      breadthDurationMs: breadthDurations.length + failedStages.filter((stage) => stage.stage === "breadth").length,
      investigationDurationMs: investigationDurations.length + failedStages.filter((stage) => stage.stage === "investigation").length,
      breadthInputTokens: breadthInputs.length + failedStages.filter((stage) =>
        stage.stage === "breadth" && stage.usage.inputTokens !== undefined).length,
      investigationInputTokens: investigationInputs.length + failedStages.filter((stage) =>
        stage.stage === "investigation" && stage.usage.inputTokens !== undefined).length,
      ...Object.fromEntries(Object.entries(usageValues).map(([key, values]) => [
        key,
        values.length + observedFailureUsage(key as keyof EngineResult["usage"]),
      ])),
    },
    incurredCostUsdTotal: args.completeness === "tracked" ? finiteSum(incurred.costs) : null,
    incurredCostObservedAttempts: args.completeness === "tracked" ? incurred.observedAttempts : 0,
    incurredCostSource: args.completeness === "tracked" && incurred.costs.length > 0
      ? summarizeCostSource(incurred.sources)
      : null,
    validFindingsPerDollar: hasComparableCost && totalCost !== null && totalCost > 0 ? totalValid / totalCost : null,
  };
}

function runRecall(run: GradedRun): number | null {
  const total = Object.keys(run.matches).length;
  if (total === 0) return null;
  return Object.values(run.matches).filter((match) => match !== null).length / total;
}

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const median = (values: number[]) => {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
};
const std = (values: number[]) => {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1),
  );
};
export const P95_MIN_SAMPLES = 20;
export const durationP95 = (values: number[]): number | null => {
  if (values.length < P95_MIN_SAMPLES) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(0.95 * ordered.length) - 1]!;
};
const pct = (value: number) => `${(value * 100).toFixed(0)}%`;

function renderHtml(stats: ConfigStats[]): string {
  const knownCosts = stats.map((item) => item.costPerCaseMean).filter((cost): cost is number => cost !== null);
  const maxCost = Math.max(...knownCosts, 0.01);
  const points = stats
    .filter((item) => item.costPerCaseMean !== null && item.recallMean !== null)
    .map((item, index) => {
      const x = 60 + (item.costPerCaseMean! / maxCost) * 480;
      const y = 320 - item.recallMean! * 280;
      return `<circle cx="${x}" cy="${y}" r="6" fill="hsl(${(index * 67) % 360},70%,45%)"><title>${item.config} · ${item.corpus}</title></circle>
<text x="${x + 10}" y="${y + 4}" font-size="11">${item.config} · ${item.corpus}</text>`;
    })
    .join("\n");
  const rows = stats.map((item) => `<tr><td>${item.config}</td><td>${item.corpus}</td><td>${formatCompletion(item)}</td>
<td>${formatPercent(item.recallMean)} ± ${formatPercent(item.recallStd)}</td><td>${formatPercent(item.failureInclusiveRecallMean)}</td>
<td>${formatNumber(item.fpPerCaseMean, 1)}</td><td>${formatCost(item.costPerCaseMean, item.costPerCaseStd, item.costSource)}</td>
<td>${formatDuration(item)}</td><td>${formatUsage(item)}</td><td>${formatAvailability(item)}</td><td>${formatIncurredCost(item)}</td><td>${formatStages(item)}</td><td>${item.validFindingsPerDollar?.toFixed(1) ?? "—"}</td></tr>`).join("\n");

  return `<!doctype html><html><head><meta charset="utf-8"><title>peregrine-bugbot benchmark</title>
<style>body{font-family:system-ui;margin:2rem;max-width:1050px}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #ddd;padding:6px 10px;text-align:left;font-size:14px}th{background:#f5f5f5}</style></head>
<body><h1>peregrine-bugbot · model benchmark</h1>
<table><tr><th>config</th><th>corpus</th><th>completion</th><th>conditional recall</th><th>failure-inclusive recall</th><th>FP/case</th><th>cost/case</th><th>time mean / median / p95</th><th>usage / work</th><th>telemetry observed</th><th>incurred cost lower bound</th><th>breadth / investigation</th><th>valid findings / $</th></tr>
${rows}</table>
<h2>Cost vs recall — pick the knee</h2>
<svg viewBox="0 0 600 360" width="600" style="border:1px solid #eee">
<line x1="60" y1="320" x2="560" y2="320" stroke="#999"/><line x1="60" y1="320" x2="60" y2="20" stroke="#999"/>
<text x="300" y="350" font-size="12" text-anchor="middle">cost per case ($, max $${maxCost.toFixed(2)})</text>
<text x="20" y="170" font-size="12" transform="rotate(-90 20 170)">conditional recall</text>
${points}</svg>
<p style="color:#666;font-size:13px">Conditional recall includes completed bug-bearing attempts. Failure-inclusive recall counts failed or missing bug-bearing attempts as misses. Comparison time and usage are n/a unless every expected attempt has the required telemetry; wall time includes failed attempts. P95 requires at least 20 attempts. Incurred cost is a lower bound that retains known spend from failed attempts. Legacy folders are explicitly incomplete.</p>
</body></html>`;
}

function printStats(stats: ConfigStats[], dir: string): void {
  console.log(`\n${"config".padEnd(24)} ${"corpus".padEnd(18)} ${"completion".padEnd(35)} conditional  incl. failures  FP/case  $/case`);
  for (const item of stats) {
    console.log(
      `${item.config.padEnd(24)} ${item.corpus.padEnd(18)} ${formatCompletion(item).padEnd(35)} ${formatPercent(item.recallMean).padEnd(12)} ${formatPercent(item.failureInclusiveRecallMean).padEnd(14)} ${formatNumber(item.fpPerCaseMean, 1).padEnd(8)} ${formatCost(item.costPerCaseMean, item.costPerCaseStd, item.costSource)}`,
    );
  }
  console.log(`\nReport: ${join(dir, "benchmark.html")}`);
}

function formatCompletion(stats: ConfigStats): string {
  if (stats.completeness === "legacy-incomplete") return "legacy/incomplete";
  return `${stats.completedRuns}/${stats.expectedRuns} (${pct(stats.completionRate ?? 0)}); ${stats.failedRuns} failed; ${stats.missingRuns} missing`;
}

function formatPercent(value: number | null): string {
  return value === null ? "n/a" : pct(value);
}

function formatNumber(value: number | null, digits: number): string {
  return value === null ? "n/a" : value.toFixed(digits);
}

function formatCost(
  meanCost: number | null,
  stdCost: number | null,
  source: ConfigStats["costSource"],
): string {
  return meanCost === null || stdCost === null
    ? "n/a"
    : `$${meanCost.toFixed(3)}±${stdCost.toFixed(3)} (${costSourceLabel(source)})`;
}

function completeMean(values: number[], expected: number): number | null {
  if (expected <= 0 || values.length !== expected) return null;
  const total = finiteSum(values);
  return total === null ? null : total / values.length;
}

function rawStage(run: GradedRun, stage: "breadth" | "investigation"): Record<string, unknown> | undefined {
  const raw = run.outcome.result.raw;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = (raw as Record<string, unknown>)[stage];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stageNumbers(runs: GradedRun[], stage: "breadth" | "investigation", field: string): number[] {
  return runs
    .map((run) => rawStage(run, stage)?.[field])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function stageUsageNumbers(runs: GradedRun[], stage: "breadth" | "investigation", field: string): number[] {
  return runs
    .map((run) => {
      const usage = rawStage(run, stage)?.usage;
      return usage && typeof usage === "object" && !Array.isArray(usage)
        ? (usage as Record<string, unknown>)[field]
        : undefined;
    })
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function formatStages(stats: ConfigStats): string {
  if (stats.breadthDurationSecMean === null || stats.investigationDurationSecMean === null) return "n/a";
  const tokens = stats.breadthInputTokensMean === null || stats.investigationInputTokensMean === null
    ? ""
    : ` · ${stats.breadthInputTokensMean.toFixed(0)} / ${stats.investigationInputTokensMean.toFixed(0)} input tokens`;
  return `${stats.breadthDurationSecMean.toFixed(0)}s / ${stats.investigationDurationSecMean.toFixed(0)}s${tokens}`;
}

function formatDuration(stats: ConfigStats): string {
  return stats.durationSecMean === null || stats.durationSecMedian === null
    ? "n/a"
    : `${stats.durationSecMean.toFixed(0)}s / ${stats.durationSecMedian.toFixed(0)}s / ${stats.durationSecP95 === null ? "n/a" : `${stats.durationSecP95.toFixed(0)}s`}`;
}

function formatIncurredCost(stats: ConfigStats): string {
  if (stats.incurredCostUsdTotal === null) return "n/a";
  return `$${stats.incurredCostUsdTotal.toFixed(3)} (${costSourceLabel(stats.incurredCostSource)}; ${stats.incurredCostObservedAttempts} attempt(s))`;
}

function costSourceLabel(source: ConfigStats["costSource"]): string {
  return source === "provider" ? "provider-reported" : source === "mixed" ? "mixed-source" : source ?? "unknown";
}

function formatUsage(stats: ConfigStats): string {
  const tokenFields: Array<[string, number | null]> = [
    ["uncached", stats.uncachedInputTokensMean],
    ["write", stats.cacheWriteInputTokensMean],
    ["read", stats.cacheReadInputTokensMean],
    ["out", stats.outputTokensMean],
    ["reasoning", stats.reasoningOutputTokensMean],
  ];
  const work = stats.turnsMean === null || stats.toolCallsMean === null ||
    stats.toolOutputBytesMean === null || stats.promptBytesMean === null
    ? "work n/a"
    : `${stats.turnsMean.toFixed(1)} turns · ${stats.toolCallsMean.toFixed(1)} tools · ${stats.toolOutputBytesMean.toFixed(0)} tool B · ${stats.promptBytesMean.toFixed(0)} prompt B`;
  return `${tokenFields.map(([label, value]) => `${label} ${value?.toFixed(0) ?? "n/a"}`).join(" · ")} · ${work}`;
}

function summarizeCostSource(
  sources: Array<Exclude<ReportCostSource, null> | undefined>,
): ConfigStats["costSource"] {
  if (sources.some((source) => source === undefined)) return "unknown";
  const unique = new Set(sources);
  if (unique.size > 1) return "mixed";
  return sources[0] ?? "unknown";
}

function usageCostSource(usage: EngineResult["usage"]): Exclude<ReportCostSource, null> | undefined {
  return usage.provider === "mock" ? "mock" : usage.costSource;
}

function comparableEstimatedPricing(
  references: Array<EngineResult["usage"]["pricing"]>,
): boolean {
  if (references.some((reference) => reference === undefined)) return false;
  const [first] = references;
  return references.every((reference) =>
    reference!.catalogVersion === first!.catalogVersion &&
    reference!.pricingAsOf === first!.pricingAsOf);
}

function formatAvailability(stats: ConfigStats): string {
  const expected = stats.telemetryExpectedRuns;
  return Object.entries(stats.telemetryObserved)
    .map(([metric, observed]) => `${metric} ${observed}/${expected ?? "n/a"}`)
    .join(" · ");
}

function incurredCosts(
  completed: GradedRun[],
  failed: Array<Extract<RunRecord["outcome"], { status: "failed" }>>,
): { costs: number[]; sources: Array<Exclude<ReportCostSource, null> | undefined>; observedAttempts: number } {
  const costs: number[] = [];
  const sources: Array<Exclude<ReportCostSource, null> | undefined> = [];
  let observedAttempts = 0;
  for (const run of completed) {
    const usage = run.outcome.result.usage;
    if (usage.costUsd === undefined) continue;
    costs.push(usage.costUsd);
    sources.push(usageCostSource(usage));
    observedAttempts++;
  }
  for (const failure of failed) {
    const stageCosts = failure.telemetry?.stages
      .map((stage) => ({ cost: stage.usage.costUsd, source: usageCostSource(stage.usage) }))
      .filter((item): item is { cost: number; source: Exclude<ReportCostSource, null> | undefined } =>
        typeof item.cost === "number" && Number.isFinite(item.cost) && item.cost >= 0) ?? [];
    if (stageCosts.length === 0) continue;
    const attemptCost = stageCosts.reduce((sum, item) => sum + item.cost, 0);
    if (!Number.isFinite(attemptCost)) continue;
    costs.push(attemptCost);
    sources.push(...stageCosts.map((item) => item.source));
    observedAttempts++;
  }
  return { costs, sources, observedAttempts };
}

function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const group = key(value);
    grouped.set(group, [...(grouped.get(group) ?? []), value]);
  }
  return grouped;
}

function finiteSum(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number.isFinite(total) ? total : null;
}

function countBy<T>(values: T[], key: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const group = key(value);
    counts[group] = (counts[group] ?? 0) + 1;
  }
  return counts;
}

function latestRunsDir(): string {
  const runs = resolve("eval/runs");
  const dirs = readdirSync(runs).sort();
  const last = dirs[dirs.length - 1];
  if (!last) throw new Error("No run directories under eval/runs.");
  return join(runs, last);
}
