import { type ExecResult, exec, lastJsonBlock } from "../util/exec.js";
import { buildEngineResult, parseReviewPayload, reviewSchemaJson } from "../core/review-result.js";
import { buildInvestigationPrompt } from "../core/prompt.js";
import { bundledSkillDir, packageRoot } from "../core/paths.js";
import type { ClaudeEffort, EngineResult, ReviewContext } from "../types.js";
import type { Engine } from "./engine.js";

type ExecFunction = typeof exec;

function breadthAgentJson(model: string, effort: ClaudeEffort): string {
  return JSON.stringify({
    "breadth-worker": {
      description:
        "Fast breadth sweep for invariant-first PR review. Nominate candidates and explicit no-risk conclusions only.",
      prompt:
        "Follow the breadth worker packet. Do not assign final severity, close high-risk lanes, or draft comments.",
      tools: ["Read", "Grep", "Glob"],
      model,
      effort,
    },
  });
}

function parseClaudePayload(result: ExecResult): {
  payload: ReturnType<typeof parseReviewPayload>;
  raw: unknown;
  usage: EngineResult["usage"];
} {
  let outer: Record<string, unknown>;
  try {
    outer = JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    throw new Error(`claude returned invalid JSON: ${result.stdout.slice(0, 300)}`);
  }

  const candidate =
    outer.structured_output ??
    (typeof outer.result === "object" ? outer.result : undefined) ??
    lastJsonBlock(String(outer.result ?? ""));
  if (candidate === undefined) {
    throw new Error(`claude returned no structured review output: ${result.stdout.slice(0, 300)}`);
  }

  const usage = outer.usage as Record<string, unknown> | undefined;
  return {
    payload: parseReviewPayload(candidate, "claude review output"),
    raw: outer,
    usage: {
      costUsd: typeof outer.total_cost_usd === "number" ? outer.total_cost_usd : undefined,
      inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined,
      outputTokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined,
    },
  };
}

export function createClaudeEngine(run: ExecFunction = exec): Engine {
  return {
    name: "claude",
    async review(ctx: ReviewContext): Promise<EngineResult> {
      const cfg = ctx.config.runners.claude;
      const started = Date.now();
      const skillDir = bundledSkillDir(cfg.skillName);
      const manifest = `${skillDir}/scripts/review-manifest.sh`;
      const prompt = buildInvestigationPrompt(
        ctx,
        skillDir,
        `Delegate the breadth sweep to the breadth-worker (${cfg.breadthModel}/${cfg.breadthEffort}); investigate and adjudicate on ${cfg.investigationModel}/${cfg.investigationEffort}.`,
      );
      const allowedTools = [
        "Task",
        "Read",
        "Grep",
        "Glob",
        `Bash(bash ${manifest}:*)`,
        "Bash(git show:*)",
        "Bash(git diff:*)",
        "Bash(git log:*)",
        "Bash(git status:*)",
        "Bash(git merge-base:*)",
        "Bash(git rev-parse:*)",
        "Bash(git config --get:*)",
        "Bash(rg:*)",
      ].join(",");

      const result = await run(
        "claude",
        [
          "--plugin-dir",
          packageRoot(),
          "-p",
          prompt,
          "--output-format",
          "json",
          "--json-schema",
          JSON.stringify(JSON.parse(reviewSchemaJson())),
          "--model",
          cfg.investigationModel,
          "--effort",
          cfg.investigationEffort,
          "--max-turns",
          String(ctx.deep ? cfg.maxTurns * 2 : cfg.maxTurns),
          "--max-budget-usd",
          String(ctx.deep ? cfg.maxBudgetUsd * 2 : cfg.maxBudgetUsd),
          "--permission-mode",
          "dontAsk",
          "--no-session-persistence",
          "--allowedTools",
          allowedTools,
          "--agents",
          breadthAgentJson(cfg.breadthModel, cfg.breadthEffort),
        ],
        {
          cwd: ctx.repoPath,
          timeoutMs: cfg.timeoutMs,
          env: {
            PEREGRINE_CLAUDE_BREADTH_MODEL: cfg.breadthModel,
            PEREGRINE_CLAUDE_BREADTH_EFFORT: cfg.breadthEffort,
            PEREGRINE_CLAUDE_INVESTIGATION_MODEL: cfg.investigationModel,
            PEREGRINE_CLAUDE_INVESTIGATION_EFFORT: cfg.investigationEffort,
          },
        },
      );

      if (result.timedOut) throw new Error(`claude timed out after ${cfg.timeoutMs}ms`);
      if (result.code !== 0) {
        throw new Error(
          `claude exited with code ${result.code}: ${claudeFailureDetail(result)}`,
        );
      }

      const parsed = parseClaudePayload(result);
      return buildEngineResult({
        engine: "claude",
        modelConfig: `${cfg.breadthModel}/${cfg.breadthEffort}->${cfg.investigationModel}/${cfg.investigationEffort}`,
        ctx,
        payload: parsed.payload,
        usage: parsed.usage,
        durationMs: Date.now() - started,
        raw: parsed.raw,
      });
    },
  };
}

function claudeFailureDetail(result: ExecResult): string {
  const raw = result.stderr || result.stdout;
  try {
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    const resultText = typeof parsed.result === "string" ? parsed.result : undefined;
    const errors = Array.isArray(parsed.errors) ? parsed.errors.join("; ") : undefined;
    return (resultText || errors || raw).slice(0, 2000);
  } catch {
    return raw.slice(0, 2000);
  }
}

export const claudeEngine = createClaudeEngine();
