#!/usr/bin/env tsx
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { getEngine } from "./engines/engine.js";
import { postReview } from "./github/post-review.js";
import type { ReviewContext } from "./types.js";

/**
 * peregrine-bugbot CLI
 *
 *   review  --repo <path> --diff <patch> [--engine claude] [--deep] [--post]
 *           Posting requires env: GITHUB_TOKEN, PR_OWNER, PR_REPO, PR_NUMBER, PR_HEAD_SHA
 *   matrix  [--config eval/matrix.config.json]      run the model-comparison matrix
 *   grade   [--runs eval/runs/<dir>]                grade runs against ground truth
 *   report  [--runs eval/runs/<dir>]                aggregate graded runs -> benchmark
 */

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const has = (flag: string) => process.argv.includes(flag);

async function cmdReview(): Promise<void> {
  const config = loadConfig(arg("--config") ?? "peregrine.config.json");
  const engineName = arg("--engine") ?? config.engine;
  const repoPath = resolve(arg("--repo") ?? ".");
  const diffPath = resolve(arg("--diff") ?? ".peregrine/pr.diff");

  const diffLines = readFileSync(diffPath, "utf8").split("\n").length;
  if (diffLines > config.limits.maxDiffLines && !has("--deep")) {
    console.log(
      `Diff is ${diffLines} lines (> ${config.limits.maxDiffLines}); skipping deep review. ` +
        `Mention @peregrine-bugbot to force one.`,
    );
    return;
  }

  const ctx: ReviewContext = { repoPath, diffPath, deep: has("--deep"), config };
  const result = await getEngine(engineName).review(ctx);

  mkdirSync(".peregrine", { recursive: true });
  writeFileSync(".peregrine/result.json", JSON.stringify(result, null, 2));
  console.log(
    `[peregrine] ${result.findings.length} finding(s) · cost $${result.usage.costUsd?.toFixed(3) ?? "?"} · ${(result.durationMs / 1000).toFixed(0)}s`,
  );

  if (has("--post")) {
    const token = process.env.GITHUB_TOKEN;
    const target = {
      owner: process.env.PR_OWNER ?? "",
      repo: process.env.PR_REPO ?? "",
      prNumber: Number(process.env.PR_NUMBER ?? 0),
      headSha: process.env.PR_HEAD_SHA ?? "",
    };
    if (!token || !target.owner || !target.repo || !target.prNumber || !target.headSha) {
      throw new Error("--post requires GITHUB_TOKEN, PR_OWNER, PR_REPO, PR_NUMBER, PR_HEAD_SHA");
    }
    const { posted, skipped } = await postReview(result, target, config, token);
    console.log(`[peregrine] posted ${posted}, skipped ${skipped}`);
  } else {
    for (const f of result.findings) {
      console.log(`  - [${f.severity}] ${f.file}:${f.startLine} ${f.title}`);
    }
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "review":
      return cmdReview();
    case "matrix":
      return (await import("../eval/run-matrix.js")).runMatrix(arg("--config"));
    case "grade":
      return (await import("../eval/grade.js")).gradeRuns(arg("--runs"));
    case "report":
      return (await import("../eval/report.js")).buildReport(arg("--runs"));
    default:
      console.error("Usage: peregrine <review|matrix|grade|report> [options]");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
