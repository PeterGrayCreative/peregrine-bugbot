import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ClaudeEngineConfig, EngineResult, Finding, ReviewContext } from "../types.js";
import { exec, lastJsonBlock } from "../util/exec.js";
import type { Engine } from "./engine.js";

/**
 * Claude engine: runs the invariant-first-pr-review skill
 * (github.com/PeterGrayCreative/bugbot-codex-skills) via `claude -p`.
 *
 * Alignment with the skill's contract (SKILL.md):
 *  - The skill lives at <repoPath>/.claude/skills/<skillName>/ — CI copies
 *    skills/invariant-first-pr-review out of the skills repo into that path.
 *  - Two-tier routing is the ORCHESTRATOR's job ("skill metadata cannot
 *    enforce model routing"): the session model (--model) is the strong
 *    investigator tier; we define a `breadth-worker` subagent pinned to the
 *    fast tier for the breadth sweep.
 *  - When git objects exist (CI, historical eval cases) we pass base/head and
 *    let the skill drive git + its review-manifest script. For plain fixture
 *    dirs (seeded eval cases) we embed the diff — the skill's documented
 *    no-git fallback.
 *  - The skill requires the working tree stay untouched and treats
 *    .peregrine/ as profile config, so all bot scratch output (findings file)
 *    goes to a temp dir OUTSIDE the repo, permitted via --add-dir.
 *  - Bash is allowlisted only for the manifest script and read-only git.
 *    Deliberately NOT allowed: package scripts / running tests — in CI that
 *    would execute attacker-controlled PR code next to secrets. The skill
 *    downgrades to static proof ("state the static proof and reduce
 *    confidence"), which is the trade we want.
 */

function buildPrompt(ctx: ReviewContext, cfg: ClaudeEngineConfig, findingsFile: string): string {
  const limits = ctx.config.limits;
  const gitMode = Boolean(ctx.baseRef && ctx.headRef);

  const lines = [
    `Use the "${cfg.skillName}" skill to review this change. Do not post comments,`,
    `approve, request changes, or edit code — report only.`,
    ``,
    gitMode
      ? `Review base: ${ctx.baseRef}  head: ${ctx.headRef} (use merge-base...head per the skill).`
      : `This checkout has no usable git history. Use the skill's no-git fallback and review the diff below against the checked-out head state.`,
    ctx.prTitle ? `PR title: ${ctx.prTitle}` : ``,
    ctx.prBody ? `PR description (scope contract):\n${ctx.prBody}\n` : ``,
    `Routing: delegate the breadth sweep to the "breadth-worker" subagent (fast`,
    `tier: ${cfg.tier1Model}); investigate and adjudicate on the session model`,
    `(${cfg.tier2Model}). Deep-investigate at most ${limits.maxEscalations * (ctx.deep ? 2 : 1)} candidate areas.`,
    `Do not run package scripts or tests in this environment; use static proof`,
    `and reduce confidence accordingly.`,
    ``,
    `In addition to the skill's final report, write machine-readable findings to`,
    `${findingsFile} as JSON:`,
    `{"findings": [{"file", "startLine", "endLine", "severity": "high|medium|low",`,
    `"category", "title", "explanation", "failurePath", "confidence": 0..1}]}`,
    `Map confirmed blockers to high, confirmed discuss-level findings to medium,`,
    `follow-up hardening to low. failurePath is the concrete counterexample.`,
    `Rejected candidates must not appear. An empty findings array is a valid result.`,
  ];

  if (!gitMode) {
    lines.push(``, `--- DIFF (base...head) ---`, readFileSync(ctx.diffPath, "utf8"));
  }
  return lines.filter((l) => l !== null).join("\n");
}

function breadthAgentJson(cfg: ClaudeEngineConfig): string {
  return JSON.stringify({
    "breadth-worker": {
      description:
        "Fast-tier breadth sweep worker for invariant-first PR review. Receives the compact breadth packet; nominates candidates and explicit no-risk conclusions only.",
      prompt:
        "You are the breadth-sweep worker. Follow the breadth worker packet you are given. Nominate candidates and explicit no-risk conclusions only; never assign final severity, close high-risk lanes, or draft comments.",
      tools: ["Read", "Grep", "Glob"],
      model: cfg.tier1Model,
    },
  });
}

function parseFindings(findingsFile: string, resultText: string): Finding[] {
  let parsed: unknown;
  if (existsSync(findingsFile)) {
    try {
      parsed = JSON.parse(readFileSync(findingsFile, "utf8"));
    } catch {
      /* fall through to text parsing */
    }
  }
  parsed ??= lastJsonBlock(resultText);
  const list = (parsed as { findings?: unknown })?.findings ?? parsed;
  if (!Array.isArray(list)) return [];
  return list
    .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
    .map((f) => ({
      file: String(f.file ?? ""),
      startLine: Number(f.startLine ?? 0),
      endLine: Number(f.endLine ?? f.startLine ?? 0),
      severity: (["high", "medium", "low"].includes(String(f.severity))
        ? String(f.severity)
        : "medium") as Finding["severity"],
      category: String(f.category ?? "logic"),
      title: String(f.title ?? "Untitled finding"),
      explanation: String(f.explanation ?? ""),
      failurePath: String(f.failurePath ?? ""),
      confidence: Math.max(0, Math.min(1, Number(f.confidence ?? 0.5))),
    }))
    .filter((f) => f.file && f.startLine > 0);
}

export const claudeEngine: Engine = {
  name: "claude",
  async review(ctx: ReviewContext): Promise<EngineResult> {
    const cfg = ctx.config.engines.claude;
    const started = Date.now();

    const outDir = mkdtempSync(join(tmpdir(), "peregrine-out-"));
    const findingsFile = join(outDir, "findings.json");

    const manifestScript = `.claude/skills/${cfg.skillName}/scripts/review-manifest.sh`;
    const allowedTools = [
      "Task",
      "Read",
      "Grep",
      "Glob",
      "Write",
      `Bash(bash ${manifestScript}:*)`,
      "Bash(git show:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git status:*)",
      "Bash(git merge-base:*)",
      "Bash(git rev-parse:*)",
      "Bash(git config --get:*)",
      "Bash(rg:*)",
    ].join(",");

    const baseArgs = [
      "-p",
      buildPrompt(ctx, cfg, findingsFile),
      "--output-format",
      "json",
      "--model",
      cfg.tier2Model,
      "--max-turns",
      String(ctx.deep ? cfg.maxTurns * 2 : cfg.maxTurns),
      "--allowedTools",
      allowedTools,
      "--add-dir",
      outDir,
    ];

    const env = {
      PEREGRINE_TIER1_MODEL: cfg.tier1Model,
      PEREGRINE_TIER2_MODEL: cfg.tier2Model,
    };

    // Prefer defining the fast-tier subagent explicitly; if this CLI build
    // doesn't support --agents, retry without it (the prompt still instructs
    // fast-tier delegation, the skill's "routing unavailable" path applies).
    let res = await exec("claude", [...baseArgs, "--agents", breadthAgentJson(cfg)], {
      cwd: ctx.repoPath,
      timeoutMs: cfg.timeoutMs,
      env,
    });
    if (res.code !== 0 && /unknown option|unrecognized|--agents/i.test(res.stderr)) {
      res = await exec("claude", baseArgs, { cwd: ctx.repoPath, timeoutMs: cfg.timeoutMs, env });
    }

    if (res.timedOut) {
      throw new Error(`claude engine timed out after ${cfg.timeoutMs}ms`);
    }

    // Headless JSON result: { result, total_cost_usd, usage: {...}, ... }
    let resultText = res.stdout;
    let usage: EngineResult["usage"] = {};
    let raw: unknown;
    try {
      const parsed = JSON.parse(res.stdout) as Record<string, unknown>;
      raw = parsed;
      resultText = String(parsed.result ?? "");
      const u = parsed.usage as Record<string, number> | undefined;
      usage = {
        costUsd: typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : undefined,
        inputTokens: u?.input_tokens,
        outputTokens: u?.output_tokens,
      };
    } catch {
      /* non-JSON output; still try to salvage findings from text */
    }

    return {
      engine: "claude",
      modelConfig: `${cfg.tier1Model}->${cfg.tier2Model}`,
      findings: parseFindings(findingsFile, resultText),
      usage,
      durationMs: Date.now() - started,
      raw,
    };
  },
};
