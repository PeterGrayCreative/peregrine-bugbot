import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClaudeEngineConfig, EngineResult, Finding, ReviewContext } from "../types.js";
import { exec, lastJsonBlock } from "../util/exec.js";
import type { Engine } from "./engine.js";

/**
 * Claude engine: shells out to the `claude` CLI in headless mode and lets the
 * bugbot-codex-skills skill drive the two-tier (breadth -> depth) review.
 *
 * Contract with the skill (adjust after aligning with the skill repo):
 *  - The skill is installed in <repoPath>/.claude/skills/<skillName>/ (CI
 *    checks out the skills repo there).
 *  - Tier models are passed via env: PEREGRINE_TIER1_MODEL / PEREGRINE_TIER2_MODEL.
 *    The CLI session model (--model) is the tier-2 model; the skill invokes
 *    tier-1 breadth passes at the tier-1 model.
 *  - The skill writes findings to .peregrine/findings.json (FINDINGS_FILE env).
 *    If it doesn't, we fall back to parsing the last JSON block of the output.
 *
 * Cost comes straight from the CLI's JSON result (total_cost_usd), which is
 * what the eval harness uses for the value-per-dollar comparison.
 */

const FINDINGS_FILE = ".peregrine/findings.json";

function buildPrompt(ctx: ReviewContext, cfg: ClaudeEngineConfig): string {
  const diff = readFileSync(ctx.diffPath, "utf8");
  const limits = ctx.config.limits;
  return [
    `Use the "${cfg.skillName}" skill to review the following pull-request diff for bugs.`,
    ``,
    `Process: breadth-first triage of the whole diff first, then deep investigation`,
    `of at most ${limits.maxEscalations} of the most suspicious areas${ctx.deep ? " (deep-dive mode: you may double the usual investigation budget)" : ""}.`,
    `Only report a finding if you can articulate the concrete failure path — the`,
    `specific input or state that triggers the bug. If you cannot, drop it.`,
    ``,
    `Write the final findings to ${FINDINGS_FILE} as JSON:`,
    `{"findings": [{"file", "startLine", "endLine", "severity": "high|medium|low",`,
    `"category", "title", "explanation", "failurePath", "confidence": 0..1}]}`,
    `An empty findings array is a perfectly good answer for a clean diff.`,
    ``,
    `--- DIFF (base...head) ---`,
    diff,
  ].join("\n");
}

function parseFindings(repoPath: string, resultText: string): Finding[] {
  const file = join(repoPath, FINDINGS_FILE);
  let parsed: unknown;
  if (existsSync(file)) {
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
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

    const args = [
      "-p",
      buildPrompt(ctx, cfg),
      "--output-format",
      "json",
      "--model",
      cfg.tier2Model,
      "--max-turns",
      String(ctx.deep ? cfg.maxTurns * 2 : cfg.maxTurns),
      // Read-only investigation + writing the findings file. PR content is
      // untrusted input — never let the review session run arbitrary commands.
      "--allowedTools",
      "Read,Grep,Glob,Write",
    ];

    const res = await exec("claude", args, {
      cwd: ctx.repoPath,
      timeoutMs: cfg.timeoutMs,
      env: {
        PEREGRINE_TIER1_MODEL: cfg.tier1Model,
        PEREGRINE_TIER2_MODEL: cfg.tier2Model,
        FINDINGS_FILE,
      },
    });

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
      findings: parseFindings(ctx.repoPath, resultText),
      usage,
      durationMs: Date.now() - started,
      raw,
    };
  },
};
