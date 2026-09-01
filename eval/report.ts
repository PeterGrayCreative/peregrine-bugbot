import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { GradedRun } from "../src/types.js";

/**
 * Aggregates graded runs into benchmark.json + benchmark.html.
 * Per model config: recall (on cases with bugs), false positives per case,
 * cost per case, duration — mean ± stddev across repeats. The HTML includes
 * a cost-vs-recall scatter: pick the knee of that curve, not the leaderboard
 * winner.
 */
export interface ConfigStats {
  config: string;
  runs: number;
  recallMean: number;
  recallStd: number;
  fpPerCaseMean: number;
  costPerCaseMean: number;
  costPerCaseStd: number;
  durationSecMean: number;
  validFindingsPerDollar: number | null;
}

export async function buildReport(runsDir?: string): Promise<ConfigStats[]> {
  const dir = resolve(runsDir ?? latestRunsDir());
  const graded = readdirSync(dir)
    .filter((f) => f.endsWith(".graded.json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as GradedRun);

  if (graded.length === 0) {
    throw new Error(`No .graded.json files in ${dir} — run eval:grade first.`);
  }

  const byConfig = new Map<string, GradedRun[]>();
  for (const run of graded) {
    byConfig.set(run.configName, [...(byConfig.get(run.configName) ?? []), run]);
  }

  const stats: ConfigStats[] = [...byConfig.entries()].map(([config, runs]) => {
    const recalls = runs
      .filter((r) => Object.keys(r.matches).length > 0)
      .map((r) => {
        const total = Object.keys(r.matches).length;
        const found = Object.values(r.matches).filter((m) => m !== null).length;
        return found / total;
      });
    const fps = runs.map((r) => r.falsePositiveIndexes.length);
    const costs = runs
      .map((r) => r.result.usage.costUsd)
      .filter((c): c is number => typeof c === "number");
    const durations = runs.map((r) => r.result.durationMs / 1000);
    const totalValid = runs.reduce(
      (sum, r) => sum + Object.values(r.matches).filter((m) => m !== null).length,
      0,
    );
    const totalCost = costs.reduce((a, b) => a + b, 0);

    return {
      config,
      runs: runs.length,
      recallMean: mean(recalls),
      recallStd: std(recalls),
      fpPerCaseMean: mean(fps),
      costPerCaseMean: mean(costs),
      costPerCaseStd: std(costs),
      durationSecMean: mean(durations),
      validFindingsPerDollar: totalCost > 0 ? totalValid / totalCost : null,
    };
  });

  stats.sort((a, b) => b.recallMean - a.recallMean);

  writeFileSync(join(dir, "benchmark.json"), JSON.stringify(stats, null, 2));
  writeFileSync(join(dir, "benchmark.html"), renderHtml(stats));
  console.log(`\n${"config".padEnd(28)} recall        FP/case  $/case         valid/$`);
  for (const s of stats) {
    console.log(
      `${s.config.padEnd(28)} ${pct(s.recallMean)}±${pct(s.recallStd)}  ${s.fpPerCaseMean.toFixed(1).padEnd(7)}  $${s.costPerCaseMean.toFixed(3)}±${s.costPerCaseStd.toFixed(3)}  ${s.validFindingsPerDollar?.toFixed(1) ?? "∞ (free)"}`,
    );
  }
  console.log(`\nReport: ${join(dir, "benchmark.html")}`);
  return stats;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const std = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

function renderHtml(stats: ConfigStats[]): string {
  const maxCost = Math.max(...stats.map((s) => s.costPerCaseMean), 0.01);
  const points = stats
    .map((s, i) => {
      const x = 60 + (s.costPerCaseMean / maxCost) * 480;
      const y = 320 - s.recallMean * 280;
      return `<circle cx="${x}" cy="${y}" r="6" fill="hsl(${(i * 67) % 360},70%,45%)"><title>${s.config}</title></circle>
<text x="${x + 10}" y="${y + 4}" font-size="11">${s.config}</text>`;
    })
    .join("\n");

  const rows = stats
    .map(
      (s) => `<tr><td>${s.config}</td><td>${s.runs}</td><td>${pct(s.recallMean)} ± ${pct(s.recallStd)}</td>
<td>${s.fpPerCaseMean.toFixed(1)}</td><td>$${s.costPerCaseMean.toFixed(3)} ± ${s.costPerCaseStd.toFixed(3)}</td>
<td>${s.durationSecMean.toFixed(0)}s</td><td>${s.validFindingsPerDollar?.toFixed(1) ?? "—"}</td></tr>`,
    )
    .join("\n");

  return `<!doctype html><html><head><meta charset="utf-8"><title>peregrine-bugbot benchmark</title>
<style>body{font-family:system-ui;margin:2rem;max-width:900px}table{border-collapse:collapse;width:100%}
td,th{border:1px solid #ddd;padding:6px 10px;text-align:left;font-size:14px}th{background:#f5f5f5}</style></head>
<body><h1>peregrine-bugbot · model benchmark</h1>
<table><tr><th>config</th><th>runs</th><th>recall</th><th>FP/case</th><th>cost/case</th><th>time</th><th>valid findings / $</th></tr>
${rows}</table>
<h2>Cost vs recall — pick the knee</h2>
<svg viewBox="0 0 600 360" width="600" style="border:1px solid #eee">
<line x1="60" y1="320" x2="560" y2="320" stroke="#999"/><line x1="60" y1="320" x2="60" y2="20" stroke="#999"/>
<text x="300" y="350" font-size="12" text-anchor="middle">cost per case ($, max $${maxCost.toFixed(2)})</text>
<text x="20" y="170" font-size="12" transform="rotate(-90 20 170)">recall</text>
${points}</svg>
<p style="color:#666;font-size:13px">Recall over seeded+historical cases; FP counted on all cases (any finding on a clean case is an FP). Mean ± stddev across repeats.</p>
</body></html>`;
}

function latestRunsDir(): string {
  const runs = resolve("eval/runs");
  const dirs = readdirSync(runs).sort();
  const last = dirs[dirs.length - 1];
  if (!last) throw new Error("No run directories under eval/runs.");
  return join(runs, last);
}
