import { breadthSchemaJson, parseBreadthResult } from "../core/breadth-result.js";
import { prepareReviewManifest } from "../core/manifest.js";
import { buildBreadthPrompt, buildInvestigationPrompt } from "../core/prompt.js";
import { bundledSkillDir, packageRoot } from "../core/paths.js";
import { buildEngineResult, parseReviewPayload, reviewSchemaJson } from "../core/review-result.js";
import { assertNoSecrets, safeDiagnostic } from "../security/secrets.js";
import { providerEnvironment } from "../security/provider-env.js";
import type { ClaudeEffort, EngineResult, ReviewContext, Usage } from "../types.js";
import { type ExecResult, exec, lastJsonBlock } from "../util/exec.js";
import type { Engine } from "./engine.js";

type ExecFunction = typeof exec;

interface ClaudeStageResult<T> {
  output: T;
  usage: Usage;
  durationMs: number;
}

async function runStage<T>(args: {
  run: ExecFunction;
  ctx: ReviewContext;
  model: string;
  effort: ClaudeEffort;
  prompt: string;
  schema: string;
  maxTurns: number;
  maxBudgetUsd: number;
  timeoutMs: number;
  allowedTools: string;
  parse: (value: unknown) => T;
}): Promise<ClaudeStageResult<T>> {
  const started = Date.now();
  const result = await args.run(
    "claude",
    [
      "--plugin-dir", packageRoot(),
      "-p", args.prompt,
      "--output-format", "json",
      "--json-schema", args.schema,
      "--model", args.model,
      "--effort", args.effort,
      "--max-turns", String(args.maxTurns),
      "--max-budget-usd", String(args.maxBudgetUsd),
      "--permission-mode", "dontAsk",
      "--no-session-persistence",
      "--allowedTools", args.allowedTools,
    ],
    {
      cwd: args.ctx.repoPath,
      timeoutMs: args.timeoutMs,
      env: providerEnvironment("claude"),
      inheritEnv: false,
    },
  );
  if (result.timedOut) throw new Error(`claude ${args.model} stage timed out after ${args.timeoutMs}ms`);
  if (result.code !== 0) {
    throw new Error(`claude ${args.model} stage exited with code ${result.code}: ${claudeFailureDetail(result)}`);
  }
  const parsed = parseClaudeEnvelope(result);
  const output = args.parse(parsed.structured);
  assertNoSecrets(output, `claude ${args.model} stage output`);
  return { output, usage: parsed.usage, durationMs: Date.now() - started };
}

function parseClaudeEnvelope(result: ExecResult): { structured: unknown; usage: Usage } {
  let outer: Record<string, unknown>;
  try {
    outer = JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    throw new Error("claude returned invalid JSON");
  }
  const structured =
    outer.structured_output ??
    (typeof outer.result === "object" ? outer.result : undefined) ??
    lastJsonBlock(String(outer.result ?? ""));
  if (structured === undefined) {
    throw new Error("claude returned no structured output");
  }
  const usage = outer.usage as Record<string, unknown> | undefined;
  return {
    structured,
    usage: {
      costUsd: typeof outer.total_cost_usd === "number" ? outer.total_cost_usd : undefined,
      inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined,
      outputTokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined,
    },
  };
}

function combineUsage(left: Usage, right: Usage): Usage {
  const combined: Usage = {};
  for (const key of ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens", "costUsd"] as const) {
    const values = [left[key], right[key]].filter((value): value is number => typeof value === "number");
    if (values.length > 0) combined[key] = values.reduce((sum, value) => sum + value, 0);
  }
  return combined;
}

export function createClaudeEngine(run: ExecFunction = exec): Engine {
  return {
    name: "claude",
    async review(ctx: ReviewContext): Promise<EngineResult> {
      const cfg = ctx.config.runners.claude;
      const started = Date.now();
      const skillDir = bundledSkillDir(cfg.skillName);
      const manifest = await prepareReviewManifest(ctx, cfg.skillName);
      const totalTurns = ctx.deep ? cfg.maxTurns * 2 : cfg.maxTurns;
      const totalBudget = ctx.deep ? cfg.maxBudgetUsd * 2 : cfg.maxBudgetUsd;
      const breadthTurns = Math.max(1, Math.floor(totalTurns * 0.25));
      const breadthBudget = totalBudget * 0.25;
      const breadthTimeout = Math.min(300_000, Math.floor(cfg.timeoutMs * 0.35));

      const breadth = await runStage({
        run,
        ctx,
        model: cfg.breadthModel,
        effort: cfg.breadthEffort,
        prompt: buildBreadthPrompt(ctx, skillDir, manifest),
        schema: breadthSchemaJson(),
        maxTurns: breadthTurns,
        maxBudgetUsd: breadthBudget,
        timeoutMs: breadthTimeout,
        allowedTools: ["Read", "Grep", "Glob"].join(","),
        parse: (value) => parseBreadthResult(value, "claude breadth output"),
      });

      const elapsed = Date.now() - started;
      const remaining = cfg.timeoutMs - elapsed;
      if (remaining <= 0) throw new Error(`claude review exhausted its ${cfg.timeoutMs}ms timeout`);
      const investigation = await runStage({
        run,
        ctx,
        model: cfg.investigationModel,
        effort: cfg.investigationEffort,
        prompt: buildInvestigationPrompt(
          ctx,
          skillDir,
          `A separate ${cfg.breadthModel}/${cfg.breadthEffort} breadth process produced the ledger below. Investigate and adjudicate on ${cfg.investigationModel}/${cfg.investigationEffort}.`,
          JSON.stringify(breadth.output),
          manifest,
        ),
        schema: reviewSchemaJson(),
        maxTurns: Math.max(1, totalTurns - breadthTurns),
        maxBudgetUsd: totalBudget - breadthBudget,
        timeoutMs: remaining,
        allowedTools: ["Read", "Grep", "Glob"].join(","),
        parse: (value) => parseReviewPayload(value, "claude review output"),
      });

      return buildEngineResult({
        engine: "claude",
        modelConfig: `${cfg.breadthModel}/${cfg.breadthEffort}->${cfg.investigationModel}/${cfg.investigationEffort}`,
        ctx,
        payload: investigation.output,
        usage: combineUsage(breadth.usage, investigation.usage),
        durationMs: Date.now() - started,
        raw: {
          manifest: manifest.available ? "runner-generated" : manifest.reason,
          breadth: { output: breadth.output, usage: breadth.usage, durationMs: breadth.durationMs },
          investigation: { usage: investigation.usage, durationMs: investigation.durationMs },
        },
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
    return safeDiagnostic(resultText || errors || raw);
  } catch {
    return safeDiagnostic(raw);
  }
}

export const claudeEngine = createClaudeEngine();
