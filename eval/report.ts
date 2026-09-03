import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  EngineResult,
  GradedRun,
  GroundTruth,
  MatrixRunManifest,
  RunRecord,
} from "../src/types.js";
import type { RunFailureKind } from "../src/core/run-failure.js";

type LegacyGradedRun = Omit<GradedRun, "schemaVersion" | "attemptId" | "finishedAt" | "outcome"> & {
  result: EngineResult;
};

export interface ConfigStats {
  config: string;
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
  durationSecMean: number | null;
  breadthDurationSecMean: number | null;
  investigationDurationSecMean: number | null;
  breadthInputTokensMean: number | null;
  investigationInputTokensMean: number | null;
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
  const byConfig = groupBy(manifest.expectedAttempts, (attempt) => attempt.configName);
  const bugCounts = new Map<string, number>();
  const countBugs = (caseName: string): number => {
    const cached = bugCounts.get(caseName);
    if (cached !== undefined) return cached;
    const truth = JSON.parse(
      readFileSync(join(casesDir, caseName, "ground_truth.json"), "utf8"),
    ) as GroundTruth;
    bugCounts.set(caseName, truth.bugs.length);
    return truth.bugs.length;
  };

  return [...byConfig.entries()].map(([config, attempts]) => {
    const completed: GradedRun[] = [];
    const failed: Array<Extract<RunRecord["outcome"], { status: "failed" }>> = [];
    let missing = 0;
    const failureInclusiveRecalls: number[] = [];

    for (const attempt of attempts) {
      const rawPath = join(dir, attempt.file);
      if (!existsSync(rawPath)) {
        missing++;
        if (countBugs(attempt.caseName) > 0) failureInclusiveRecalls.push(0);
        continue;
      }
      const raw = JSON.parse(readFileSync(rawPath, "utf8")) as RunRecord;
      if (raw.outcome.status === "failed") {
        failed.push(raw.outcome);
        if (countBugs(attempt.caseName) > 0) failureInclusiveRecalls.push(0);
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
      completeness: "tracked",
      expectedRuns: attempts.length,
      completed,
      failed,
      missing,
      failureInclusiveRecalls,
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
  const breadthDurations = stageNumbers(args.completed, "breadth", "durationMs").map((value) => value / 1000);
  const investigationDurations = stageNumbers(args.completed, "investigation", "durationMs").map((value) => value / 1000);
  const breadthInputs = stageUsageNumbers(args.completed, "breadth", "inputTokens");
  const investigationInputs = stageUsageNumbers(args.completed, "investigation", "inputTokens");
  const totalValid = args.completed.reduce(
    (sum, run) => sum + Object.values(run.matches).filter((match) => match !== null).length,
    0,
  );
  const totalCost = costs.reduce((sum, cost) => sum + cost, 0);
  const hasCompleteCost =
    args.completeness === "tracked" &&
    args.expectedRuns === args.completed.length &&
    costs.length === args.completed.length;

  const failuresByKind = countBy(args.failed, (failure) => failure.failureKind);
  const failureRatesByKind = Object.fromEntries(
    Object.entries(failuresByKind).map(([kind, count]) => [
      kind,
      args.expectedRuns === null ? 0 : count / args.expectedRuns,
    ]),
  );

  return {
    config: args.config,
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
      args.failureInclusiveRecalls === null ? null : mean(args.failureInclusiveRecalls),
    fpPerCaseMean: fps.length > 0 ? mean(fps) : null,
    costPerCaseMean: hasCompleteCost ? mean(costs) : null,
    costPerCaseStd: hasCompleteCost ? std(costs) : null,
    durationSecMean: durations.length > 0 ? mean(durations) : null,
    breadthDurationSecMean: completeMean(breadthDurations, args.completed.length),
    investigationDurationSecMean: completeMean(investigationDurations, args.completed.length),
    breadthInputTokensMean: completeMean(breadthInputs, args.completed.length),
    investigationInputTokensMean: completeMean(investigationInputs, args.completed.length),
    validFindingsPerDollar: hasCompleteCost && totalCost > 0 ? totalValid / totalCost : null,
  };
}

function runRecall(run: GradedRun): number | null {
  const total = Object.keys(run.matches).length;
  if (total === 0) return null;
  return Object.values(run.matches).filter((match) => match !== null).length / total;
}

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
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
      return `<circle cx="${x}" cy="${y}" r="6" fill="hsl(${(index * 67) % 360},70%,45%)"><title>${item.config}</title></circle>
<text x="${x + 10}" y="${y + 4}" font-size="11">${item.config}</text>`;
    })
    .join("\n");
  const rows = stats.map((item) => `<tr><td>${item.config}</td><td>${formatCompletion(item)}</td>
<td>${formatPercent(item.recallMean)} ± ${formatPercent(item.recallStd)}</td><td>${formatPercent(item.failureInclusiveRecallMean)}</td>
<td>${formatNumber(item.fpPerCaseMean, 1)}</td><td>${formatCost(item.costPerCaseMean, item.costPerCaseStd)}</td>
<td>${item.durationSecMean === null ? "n/a" : `${item.durationSecMean.toFixed(0)}s`}</td><td>${formatStages(item)}</td><td>${item.validFindingsPerDollar?.toFixed(1) ?? "—"}</td></tr>`).join("\n");

  return `<!doctype html><html><head><meta charset="utf-8"><title>peregrine-bugbot benchmark</title>
<style>body{font-family:system-ui;margin:2rem;max-width:1050px}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #ddd;padding:6px 10px;text-align:left;font-size:14px}th{background:#f5f5f5}</style></head>
<body><h1>peregrine-bugbot · model benchmark</h1>
<table><tr><th>config</th><th>completion</th><th>conditional recall</th><th>failure-inclusive recall</th><th>FP/case</th><th>cost/case</th><th>time</th><th>breadth / investigation</th><th>valid findings / $</th></tr>
${rows}</table>
<h2>Cost vs recall — pick the knee</h2>
<svg viewBox="0 0 600 360" width="600" style="border:1px solid #eee">
<line x1="60" y1="320" x2="560" y2="320" stroke="#999"/><line x1="60" y1="320" x2="60" y2="20" stroke="#999"/>
<text x="300" y="350" font-size="12" text-anchor="middle">cost per case ($, max $${maxCost.toFixed(2)})</text>
<text x="20" y="170" font-size="12" transform="rotate(-90 20 170)">conditional recall</text>
${points}</svg>
<p style="color:#666;font-size:13px">Conditional recall includes completed bug-bearing attempts. Failure-inclusive recall counts failed or missing bug-bearing attempts as misses. Legacy folders are explicitly incomplete. Cost is n/a unless every expected attempt completed with cost telemetry.</p>
</body></html>`;
}

function printStats(stats: ConfigStats[], dir: string): void {
  console.log(`\n${"config".padEnd(28)} ${"completion".padEnd(35)} conditional  incl. failures  FP/case  $/case`);
  for (const item of stats) {
    console.log(
      `${item.config.padEnd(28)} ${formatCompletion(item).padEnd(35)} ${formatPercent(item.recallMean).padEnd(12)} ${formatPercent(item.failureInclusiveRecallMean).padEnd(14)} ${formatNumber(item.fpPerCaseMean, 1).padEnd(8)} ${formatCost(item.costPerCaseMean, item.costPerCaseStd)}`,
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

function formatCost(meanCost: number | null, stdCost: number | null): string {
  return meanCost === null || stdCost === null ? "n/a" : `$${meanCost.toFixed(3)}±${stdCost.toFixed(3)}`;
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
