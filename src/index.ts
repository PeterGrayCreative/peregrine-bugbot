#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadConfig } from "./config.js";
import { filterDiff } from "./core/diff.js";
import { packageRoot } from "./core/paths.js";
import { parseEngineResult } from "./core/review-result.js";
import { getEngine } from "./engines/engine.js";
import { postReview } from "./github/post-review.js";
import type { EngineResult, ReviewContext, RunnerName } from "./types.js";
import { exec } from "./util/exec.js";

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

const has = (flag: string) => process.argv.includes(flag);

async function cmdReview(): Promise<void> {
  const started = Date.now();
  const config = loadConfig(arg("--config") ?? "peregrine.config.json");
  const runner = (arg("--runner") ?? config.runner) as RunnerName;
  const repoPath = resolve(arg("--repo") ?? ".");
  const diffPath = resolve(arg("--diff") ?? ".peregrine/pr.diff");
  const outputPath = resolve(arg("--output") ?? ".peregrine/result.json");
  const filtered = filterDiff(readFileSync(diffPath, "utf8"), config.filters.ignorePaths);

  let result: EngineResult;
  if (filtered.lineCount > config.limits.maxDiffLines && !has("--deep")) {
    result = {
      engine: runner,
      status: "skipped",
      modelConfig: "not-run",
      reviewedBaseRef: arg("--base"),
      reviewedHeadRef: arg("--head"),
      findings: [],
      usage: {},
      durationMs: Date.now() - started,
      raw: {
        reason: "diff-line-limit",
        filteredDiffLines: filtered.lineCount,
        maxDiffLines: config.limits.maxDiffLines,
        ignoredFiles: filtered.ignoredFiles,
      },
    };
  } else {
    const ctx: ReviewContext = {
      repoPath,
      diffPath,
      diffText: filtered.text,
      ignoredFiles: filtered.ignoredFiles,
      baseRef: arg("--base"),
      headRef: arg("--head"),
      prTitle: process.env.PR_TITLE,
      prBody: process.env.PR_BODY,
      profilePath: arg("--profile"),
      deep: has("--deep"),
      config,
    };
    result = await getEngine(runner).review(ctx);
  }

  writeResult(outputPath, result);
  console.log(
    `[peregrine] ${result.status} · ${result.findings.length} finding(s) · cost $${result.usage.costUsd?.toFixed(3) ?? "?"} · ${(result.durationMs / 1000).toFixed(0)}s`,
  );

  if (has("--post")) {
    if (result.status === "skipped") {
      console.log("[peregrine] skipped result was not posted");
      return;
    }
    const { token, target } = postTargetFromEnv("--post");
    const post = await postReview(result, target, config, token, filtered.text);
    console.log(
      post.superseded
        ? "[peregrine] result superseded by a newer PR head; nothing posted"
        : `[peregrine] posted ${post.posted}, skipped ${post.skipped}${post.bodyFallback ? " (body fallback)" : ""}`,
    );
  } else {
    for (const finding of result.findings) {
      console.log(`  - [${finding.severity}] ${finding.file}:${finding.startLine} ${finding.title}`);
    }
  }
}

async function cmdPost(): Promise<void> {
  const config = loadConfig(arg("--config") ?? "peregrine.config.json");
  const resultPath = resolve(arg("--result") ?? ".peregrine/result.json");
  const diffPath = resolve(arg("--diff") ?? ".peregrine/pr.diff");
  const result = parseEngineResult(JSON.parse(readFileSync(resultPath, "utf8")), resultPath);
  if (result.status === "skipped") {
    console.log("[peregrine] skipped result was not posted");
    return;
  }
  const { token, target } = postTargetFromEnv("post");
  const filtered = filterDiff(readFileSync(diffPath, "utf8"), config.filters.ignorePaths);
  const posted = await postReview(result, target, config, token, filtered.text);
  console.log(
    posted.superseded
      ? "[peregrine] result superseded by a newer PR head; nothing posted"
      : `[peregrine] posted ${posted.posted}, skipped ${posted.skipped}${posted.bodyFallback ? " (body fallback)" : ""}`,
  );
}

function postTargetFromEnv(command: string): {
  token: string;
  target: { owner: string; repo: string; prNumber: number; headSha: string };
} {
  const token = process.env.GITHUB_TOKEN ?? "";
  const target = {
    owner: process.env.PR_OWNER ?? "",
    repo: process.env.PR_REPO ?? "",
    prNumber: Number(process.env.PR_NUMBER ?? 0),
    headSha: process.env.PR_HEAD_SHA ?? "",
  };
  if (!token || !target.owner || !target.repo || !target.prNumber || !target.headSha) {
    throw new Error(`${command} requires GITHUB_TOKEN, PR_OWNER, PR_REPO, PR_NUMBER, PR_HEAD_SHA`);
  }
  return { token, target };
}

function writeResult(path: string, result: EngineResult): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
}

async function cmdDoctor(): Promise<void> {
  const root = packageRoot();
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string };
  console.log(`Peregrine ${pkg.version ?? "unknown"}`);
  console.log(`Package root: ${root}`);
  console.log("Canonical source: https://github.com/PeterGrayCreative/peregrine-bugbot@main");
  console.log(`Codex plugin: ${existsSync(join(root, ".codex-plugin", "plugin.json")) ? "present" : "MISSING"}`);
  console.log(`Claude plugin: ${existsSync(join(root, ".claude-plugin", "plugin.json")) ? "present" : "MISSING"}`);
  console.log("Codex update: npm run plugin:update:codex");
  console.log("Claude update: npm run plugin:update:claude");

  const discovered = new Map<string, string[]>();
  for (const skillsRoot of [
    join(homedir(), ".agents", "skills"),
    join(homedir(), ".codex", "skills"),
    join(homedir(), ".claude", "skills"),
  ]) {
    if (!existsSync(skillsRoot) || !statSync(skillsRoot).isDirectory()) continue;
    for (const name of readdirSync(skillsRoot)) {
      if (!existsSync(join(skillsRoot, name, "SKILL.md"))) continue;
      discovered.set(name, [...(discovered.get(name) ?? []), join(skillsRoot, name)]);
    }
  }
  for (const name of ["invariant-first-pr-review", "build-review-profile"]) {
    const paths = discovered.get(name) ?? [];
    console.log(`${name}: ${paths.length === 0 ? "not installed outside plugin" : paths.join(", ")}`);
    if (paths.length > 1) console.log(`  warning: duplicate discovery roots expose ${name} more than once`);
  }

  for (const command of ["claude", "codex"] as const) {
    const result = await exec(command, ["--version"], { timeoutMs: 10_000 });
    console.log(`${command}: ${result.code === 0 ? result.stdout.trim() || result.stderr.trim() : "not available"}`);
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  switch (command) {
    case "review":
      return cmdReview();
    case "doctor":
      return cmdDoctor();
    case "post":
      return cmdPost();
    case "matrix": {
      await (await import("../eval/run-matrix.js")).runMatrix(arg("--config"));
      return;
    }
    case "grade": {
      await (await import("../eval/grade.js")).gradeRuns(arg("--runs"));
      return;
    }
    case "report": {
      await (await import("../eval/report.js")).buildReport(arg("--runs"));
      return;
    }
    default:
      console.error("Usage: peregrine <review|post|doctor|matrix|grade|report> [options]");
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
