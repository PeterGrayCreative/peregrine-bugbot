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
  costSource: "provider" | "estimated" | "mixed" | "unknown" | null;
  durationSecMean: number | null;
  durationSecMedian: number | null;
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
  telemetryExpectedRuns: number;
  telemetryObserved: Record<string, number>;
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
    .filter((cost): cost is number => typeof cost === "number");
  const durations = args.completed.map((run) => run.outcome.result.durationMs / 1000);
  const usage = (field: keyof EngineResult["usage"]): number[] => args.completed
    .map((run) => run.outcome.result.usage[field])
    .filter((value): value is number => typeof value === "number");
  const breadthDurations = stageNumbers(args.completed, "breadth", "durationMs").map((value) => value / 1000);
  const investigationDurations = stageNumbers(args.completed, "investigation", "durationMs").map((value) => value / 1000);
  const breadthInputs = stageUsageNumbers(args.completed, "breadth", "inputTokens");
  const investigationInputs = stageUsageNumbers(args.completed, "investigation", "inputTokens");
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
  const totalCost = costs.reduce((sum, cost) => sum + cost, 0);
  const hasCompleteCost =
    args.completeness === "tracked" &&
    args.expectedRuns === args.completed.length &&
    costs.length === args.completed.length;
  const costSources = args.completed.map((run) => run.outcome.result.usage.costSource);
  const costSource = hasCompleteCost ? summarizeCostSource(costSources) : null;
  const estimatedPricing = args.completed.map((run) => run.outcome.result.usage.pricing);
  const hasComparableCost = hasCompleteCost && costSource !== "mixed" && costSource !== "unknown" &&
    (costSource !== "estimated" || comparableEstimatedPricing(estimatedPricing));

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
    durationSecMean: durations.length > 0 ? mean(durations) : null,
    durationSecMedian: durations.length > 0 ? median(durations) : null,
    breadthDurationSecMean: completeMean(breadthDurations, args.completed.length),
    investigationDurationSecMean: completeMean(investigationDurations, args.completed.length),
    breadthInputTokensMean: completeMean(breadthInputs, args.completed.length),
    investigationInputTokensMean: completeMean(investigationInputs, args.completed.length),
    inputTokensMean: completeMean(usageValues.inputTokens, args.completed.length),
    uncachedInputTokensMean: completeMean(usageValues.uncachedInputTokens, args.completed.length),
    cacheWriteInputTokensMean: completeMean(usageValues.cacheWriteInputTokens, args.completed.length),
    cacheReadInputTokensMean: completeMean(usageValues.cacheReadInputTokens, args.completed.length),
    outputTokensMean: completeMean(usageValues.outputTokens, args.completed.length),
    reasoningOutputTokensMean: completeMean(usageValues.reasoningOutputTokens, args.completed.length),
    turnsMean: completeMean(usageValues.turns, args.completed.length),
    toolCallsMean: completeMean(usageValues.toolCalls, args.completed.length),
    toolOutputBytesMean: completeMean(usageValues.toolOutputBytes, args.completed.length),
    promptBytesMean: completeMean(usageValues.promptBytes, args.completed.length),
    telemetryExpectedRuns: args.expectedRuns ?? args.completed.length,
    telemetryObserved: {
      costUsd: costs.length,
      durationMs: durations.length,
      breadthDurationMs: breadthDurations.length,
      investigationDurationMs: investigationDurations.length,
      breadthInputTokens: breadthInputs.length,
      investigationInputTokens: investigationInputs.length,
      ...Object.fromEntries(Object.entries(usageValues).map(([key, values]) => [key, values.length])),
    },
    validFindingsPerDollar: hasComparableCost && totalCost > 0 ? totalValid / totalCost : null,
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
<td>${formatDuration(item)}</td><td>${formatUsage(item)}</td><td>${formatAvailability(item)}</td><td>${formatStages(item)}</td><td>${item.validFindingsPerDollar?.toFixed(1) ?? "—"}</td></tr>`).join("\n");

  return `<!doctype html><html><head><meta charset="utf-8"><title>peregrine-bugbot benchmark</title>
<style>body{font-family:system-ui;margin:2rem;max-width:1050px}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #ddd;padding:6px 10px;text-align:left;font-size:14px}th{background:#f5f5f5}</style></head>
<body><h1>peregrine-bugbot · model benchmark</h1>
<table><tr><th>config</th><th>corpus</th><th>completion</th><th>conditional recall</th><th>failure-inclusive recall</th><th>FP/case</th><th>cost/case</th><th>time mean / median</th><th>usage / work</th><th>telemetry observed</th><th>breadth / investigation</th><th>valid findings / $</th></tr>
${rows}</table>
<h2>Cost vs recall — pick the knee</h2>
<svg viewBox="0 0 600 360" width="600" style="border:1px solid #eee">
<line x1="60" y1="320" x2="560" y2="320" stroke="#999"/><line x1="60" y1="320" x2="60" y2="20" stroke="#999"/>
<text x="300" y="350" font-size="12" text-anchor="middle">cost per case ($, max $${maxCost.toFixed(2)})</text>
<text x="20" y="170" font-size="12" transform="rotate(-90 20 170)">conditional recall</text>
${points}</svg>
<p style="color:#666;font-size:13px">Conditional recall includes completed bug-bearing attempts. Failure-inclusive recall counts failed or missing bug-bearing attempts as misses. Legacy folders are explicitly incomplete. Cost is n/a unless every expected attempt completed with cost telemetry; provider and estimated costs are labeled.</p>
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
    : `$${meanCost.toFixed(3)}±${stdCost.toFixed(3)} (${source ?? "unknown"})`;
}

function completeMean(values: number[], expected: number): number | null {
  return expected > 0 && values.length === expected ? mean(values) : null;
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
    .filter((value): value is number => typeof value === "number");
}

function stageUsageNumbers(runs: GradedRun[], stage: "breadth" | "investigation", field: string): number[] {
  return runs
    .map((run) => {
      const usage = rawStage(run, stage)?.usage;
      return usage && typeof usage === "object" && !Array.isArray(usage)
        ? (usage as Record<string, unknown>)[field]
        : undefined;
    })
    .filter((value): value is number => typeof value === "number");
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
    : `${stats.durationSecMean.toFixed(0)}s / ${stats.durationSecMedian.toFixed(0)}s`;
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
  sources: Array<EngineResult["usage"]["costSource"]>,
): ConfigStats["costSource"] {
  if (sources.some((source) => source === undefined)) return "unknown";
  const unique = new Set(sources);
  if (unique.size > 1) return "mixed";
  return sources[0] ?? "unknown";
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
    .map(([metric, observed]) => `${metric} ${observed}/${expected}`)
    .join(" · ");
}

function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const group = key(value);
    grouped.set(group, [...(grouped.get(group) ?? []), value]);
  }
  return grouped;
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
