import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { exec, lastJsonBlock } from "../src/util/exec.js";
import type { Finding, GradedRun, GroundTruth, RunRecord } from "../src/types.js";

/**
 * Grades each run against its case's ground_truth.json.
 *
 * Matching strategy:
 *  - JUDGE=llm (default): a fixed judge model decides whether a finding
 *    describes the same root cause as a known bug. The judge is blind — it
 *    never sees which engine/models produced the finding, so it can't play
 *    favorites. Calibrate it early by human-spot-checking ~20% of judgments.
 *  - JUDGE=exact: file match + line-range overlap. Free and deterministic,
 *    useful for CI smoke tests and the mock engine, but too brittle to
 *    compare real models with.
 *
 * Unmatched findings count as false positives (all findings do, on clean cases).
 */
const JUDGE_MODEL = process.env.PEREGRINE_JUDGE_MODEL ?? "claude-sonnet-5";

export async function gradeRuns(runsDir?: string): Promise<void> {
  const dir = resolve(runsDir ?? latestRunsDir());
  const judge = (process.env.JUDGE ?? "llm") as "llm" | "exact";
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".graded.json"));

  for (const file of files) {
    const run = JSON.parse(readFileSync(join(dir, file), "utf8")) as RunRecord;
    const gt = JSON.parse(
      readFileSync(resolve("eval/cases", run.caseName, "ground_truth.json"), "utf8"),
    ) as GroundTruth;

    const matches: Record<string, number | null> = {};
    const matchedFindingIdx = new Set<number>();

    for (const bug of gt.bugs) {
      let matched: number | null = null;
      for (let i = 0; i < run.result.findings.length; i++) {
        if (matchedFindingIdx.has(i)) continue;
        const f = run.result.findings[i]!;
        const isMatch =
          judge === "exact" ? exactMatch(f, bug) : await llmMatch(f, bug.description, bug.file);
        if (isMatch) {
          matched = i;
          matchedFindingIdx.add(i);
          break;
        }
      }
      matches[bug.id] = matched;
    }

    const graded: GradedRun = {
      ...run,
      matches,
      falsePositiveIndexes: run.result.findings
        .map((_, i) => i)
        .filter((i) => !matchedFindingIdx.has(i)),
    };
    writeFileSync(join(dir, file.replace(/\.json$/, ".graded.json")), JSON.stringify(graded, null, 2));
    const found = Object.values(matches).filter((m) => m !== null).length;
    console.log(
      `${file}: ${found}/${gt.bugs.length} bugs found, ${graded.falsePositiveIndexes.length} FP`,
    );
  }
  console.log(`\nNext: npm run eval:report -- --runs ${dir}`);
}

function exactMatch(f: Finding, bug: { file: string; startLine: number; endLine: number }): boolean {
  return (
    f.file === bug.file && f.startLine <= bug.endLine + 2 && f.endLine >= bug.startLine - 2
  );
}

async function llmMatch(f: Finding, bugDescription: string, bugFile: string): Promise<boolean> {
  const prompt = [
    `You are grading a code-review benchmark. Answer with JSON only: {"same_root_cause": true|false}`,
    ``,
    `Known bug (ground truth): in ${bugFile} — ${bugDescription}`,
    ``,
    `Reviewer finding: in ${f.file} lines ${f.startLine}-${f.endLine} — ${f.title}. ${f.explanation}`,
    ``,
    `Does the finding describe the same underlying bug (same root cause), even if`,
    `worded differently or pointing at a slightly different line?`,
  ].join("\n");

  const res = await exec(
    "claude",
    ["-p", prompt, "--model", JUDGE_MODEL, "--output-format", "json", "--max-turns", "1"],
    { timeoutMs: 60_000 },
  );
  // A broken judge must never masquerade as "not a match" — that silently
  // zeroes recall and the benchmark reports garbage as data.
  if (res.timedOut || res.code !== 0) {
    throw new Error(
      `LLM judge failed (${JUDGE_MODEL}): ${res.timedOut ? "timeout" : (res.stderr || res.stdout).slice(0, 300)}. ` +
        `Use JUDGE=exact for keyless smoke runs.`,
    );
  }
  let verdict: { same_root_cause?: boolean } | undefined;
  try {
    const parsed = JSON.parse(res.stdout) as { result?: string };
    verdict = lastJsonBlock(parsed.result ?? "") as typeof verdict;
  } catch {
    /* handled below */
  }
  if (verdict?.same_root_cause === undefined) {
    throw new Error(
      `LLM judge returned an unparseable verdict: ${res.stdout.slice(0, 300)}`,
    );
  }
  return verdict.same_root_cause === true;
}

function latestRunsDir(): string {
  const runs = resolve("eval/runs");
  const dirs = readdirSync(runs).sort();
  const last = dirs[dirs.length - 1];
  if (!last) throw new Error("No run directories under eval/runs — run the matrix first.");
  return join(runs, last);
}
