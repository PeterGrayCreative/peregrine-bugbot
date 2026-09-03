import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { claudeSchemaJson, packageRoot, schemaPath } from "../src/core/paths.js";
import { exec, lastJsonBlock } from "../src/util/exec.js";
import type { EngineResult, Finding, GradedRun, GroundTruth, RunRecord } from "../src/types.js";
import { readCaseGroundTruth } from "./case-truth.js";

type LegacyRunRecord = Omit<RunRecord, "schemaVersion" | "attemptId" | "finishedAt" | "outcome"> & {
  result: EngineResult;
};

/**
 * Grades each run against its case's ground_truth.json.
 *
 * Matching strategy:
 *  - JUDGE=claude or JUDGE=codex: a fixed judge model decides whether a finding
 *    describes the same root cause as a known bug. The judge is blind — it
 *    never sees which engine/models produced the finding, so it can't play
 *    favorites. Calibrate it early by human-spot-checking ~20% of judgments.
 *  - JUDGE=exact (default): file match + line-range overlap. Free and deterministic,
 *    useful for CI smoke tests and the mock engine, but too brittle to
 *    compare real models with.
 *
 * Unmatched fix-in-pr findings count as false positives. Follow-up findings are
 * retained for analysis but are not scored as incorrect PR demands.
 */
type Judge = "exact" | "claude" | "codex";

export async function gradeRuns(runsDir?: string, casesDir = "eval/cases"): Promise<void> {
  const dir = resolve(runsDir ?? latestRunsDir());
  const judge = parseJudge(process.env.JUDGE ?? "exact");
  const config = loadConfig();
  const judgeModel =
    process.env.PEREGRINE_JUDGE_MODEL ??
    (judge === "codex"
      ? process.env.PEREGRINE_CODEX_JUDGE_MODEL ?? config.runners.codex.investigationModel
      : process.env.PEREGRINE_CLAUDE_JUDGE_MODEL ?? config.runners.claude.investigationModel);
  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".json") && !f.endsWith(".graded.json") && f !== "matrix-manifest.json" && f !== "benchmark.json",
  );

  for (const file of files) {
    const run = JSON.parse(readFileSync(join(dir, file), "utf8")) as RunRecord | LegacyRunRecord;
    let result: EngineResult;
    if ("outcome" in run) {
      if (run.outcome.status === "failed") {
        console.log(`${file}: not graded (${run.outcome.failureKind} failure)`);
        continue;
      }
      result = run.outcome.result;
    } else {
      result = run.result;
    }
    const gt = readCaseGroundTruth(casesDir, run.caseName) as GroundTruth;

    const matches: Record<string, number | null> = {};
    const matchedFindingIdx = new Set<number>();

    for (const bug of gt.bugs) {
      let matched: number | null = null;
      for (let i = 0; i < result.findings.length; i++) {
        if (matchedFindingIdx.has(i)) continue;
        const f = result.findings[i]!;
        const isMatch =
          judge === "exact"
            ? exactMatch(f, bug)
            : await semanticMatch(judge, judgeModel, f, bug.description, bug.file);
        if (isMatch) {
          matched = i;
          matchedFindingIdx.add(i);
          break;
        }
      }
      matches[bug.id] = matched;
    }

    const normalizedRun = "outcome" in run
      ? run
      : {
          ...run,
          schemaVersion: 1 as const,
          attemptId: `${run.configName}--${run.caseName}--${run.repeat}`,
          caseCorpus: "unknown" as const,
          finishedAt: run.startedAt,
          outcome: { status: "completed" as const, result },
        };
    const graded: GradedRun = {
      ...normalizedRun,
      outcome: { status: "completed", result },
      matches,
      falsePositiveIndexes: result.findings
        .map((finding, i) => ({ finding, i }))
        .filter(({ finding, i }) => finding.disposition === "fix-in-pr" && !matchedFindingIdx.has(i))
        .map(({ i }) => i),
    };
    writeFileSync(join(dir, file.replace(/\.json$/, ".graded.json")), JSON.stringify(graded, null, 2));
    const found = Object.values(matches).filter((m) => m !== null).length;
    console.log(
      `${file}: ${found}/${gt.bugs.length} bugs found, ${graded.falsePositiveIndexes.length} FP`,
    );
  }
  console.log(`\nNext: npm run eval:report -- --runs ${dir}`);
}

function parseJudge(value: string): Judge {
  if (value === "exact" || value === "claude" || value === "codex") return value;
  throw new Error(`JUDGE must be one of: exact, claude, codex (received ${JSON.stringify(value)})`);
}

function exactMatch(f: Finding, bug: { file: string; startLine: number; endLine: number }): boolean {
  return (
    f.file === bug.file && f.startLine <= bug.endLine + 2 && f.endLine >= bug.startLine - 2
  );
}

async function semanticMatch(
  judge: Exclude<Judge, "exact">,
  model: string,
  f: Finding,
  bugDescription: string,
  bugFile: string,
): Promise<boolean> {
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

  return judge === "claude" ? claudeMatch(model, prompt) : codexMatch(model, prompt);
}

async function claudeMatch(model: string, prompt: string): Promise<boolean> {
  const res = await exec(
    "claude",
    [
      "-p",
      prompt,
      "--model",
      model,
      "--output-format",
      "json",
      "--json-schema",
      claudeSchemaJson("judge-result"),
      "--max-turns",
      "1",
      "--permission-mode",
      "dontAsk",
      "--no-session-persistence",
    ],
    { timeoutMs: 60_000 },
  );
  if (res.timedOut || res.code !== 0) {
    throw new Error(
      `Claude judge failed (${model}): ${res.timedOut ? "timeout" : (res.stderr || res.stdout).slice(0, 300)}. ` +
        `Use JUDGE=exact for keyless smoke runs.`,
    );
  }
  let verdict: { same_root_cause?: boolean } | undefined;
  try {
    const parsed = JSON.parse(res.stdout) as {
      structured_output?: unknown;
      result?: unknown;
    };
    verdict = (parsed.structured_output ??
      (typeof parsed.result === "object" ? parsed.result : lastJsonBlock(String(parsed.result ?? "")))) as
      | typeof verdict
      | undefined;
  } catch {
    /* handled below */
  }
  if (verdict?.same_root_cause === undefined) {
    throw new Error(
      `Claude judge returned an unparseable verdict: ${res.stdout.slice(0, 300)}`,
    );
  }
  return verdict.same_root_cause === true;
}

async function codexMatch(model: string, prompt: string): Promise<boolean> {
  const outputDir = mkdtempSync(join(tmpdir(), "peregrine-judge-"));
  const output = join(outputDir, "verdict.json");
  try {
    const res = await exec(
      "codex",
      [
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--strict-config",
        "--sandbox",
        "read-only",
        "--model",
        model,
        "--config",
        'model_reasoning_effort="low"',
        "--cd",
        packageRoot(),
        "--output-schema",
        schemaPath("judge-result"),
        "--output-last-message",
        output,
        "--json",
        "--color",
        "never",
        "-",
      ],
      { cwd: packageRoot(), timeoutMs: 60_000, stdin: prompt },
    );
    if (res.timedOut || res.code !== 0) {
      throw new Error(
        `Codex judge failed (${model}): ${res.timedOut ? "timeout" : (res.stderr || res.stdout).slice(0, 300)}. ` +
          `Use JUDGE=exact for keyless smoke runs.`,
      );
    }
    const verdict = JSON.parse(readFileSync(output, "utf8")) as { same_root_cause?: unknown };
    if (typeof verdict.same_root_cause !== "boolean") {
      throw new Error(`Codex judge returned an invalid verdict: ${JSON.stringify(verdict).slice(0, 300)}`);
    }
    return verdict.same_root_cause;
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

function latestRunsDir(): string {
  const runs = resolve("eval/runs");
  const dirs = readdirSync(runs).sort();
  const last = dirs[dirs.length - 1];
  if (!last) throw new Error("No run directories under eval/runs — run the matrix first.");
  return join(runs, last);
}
