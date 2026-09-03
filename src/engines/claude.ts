import { breadthSchemaJson, parseBreadthResult } from "../core/breadth-result.js";
import { prepareReviewManifest } from "../core/manifest.js";
import { buildBreadthPrompt, buildInvestigationPrompt } from "../core/prompt.js";
import { bundledSkillDir, packageRoot } from "../core/paths.js";
import { join } from "node:path";
import { buildEngineResult, parseReviewPayload, reviewSchemaJson } from "../core/review-result.js";
import { applyUsageCost } from "../core/pricing.js";
import { RunFailureError } from "../core/run-failure.js";
import { claudeUsageFromEnvelope, combineUsage, sha256 } from "../core/telemetry.js";
import { assertNoSecrets, safeDiagnostic } from "../security/secrets.js";
import { isolatedProviderEnvironment, providerEnvironment } from "../security/provider-env.js";
import type { ClaudeEffort, EngineResult, ReviewContext, Usage } from "../types.js";
import { type ExecResult, exec, lastJsonBlock } from "../util/exec.js";
import type { Engine } from "./engine.js";

type ExecFunction = typeof exec;

interface ClaudeStageResult<T> {
  output: T;
  usage: Usage;
  durationMs: number;
  model: string;
  promptSha256: string;
}

async function runStage<T>(args: {
  run: ExecFunction;
  ctx: ReviewContext;
  model: string;
  effort: ClaudeEffort;
  prompt: string;
  stage: "breadth" | "investigation";
  untrustedModelText?: string;
  schema: string;
  maxTurns: number;
  maxBudgetUsd: number;
  timeoutMs: number;
  allowedTools: string;
  parse: (value: unknown) => T;
}): Promise<ClaudeStageResult<T>> {
  const started = Date.now();
  try {
    args.ctx.evaluationIsolation?.validatePrompt({
      prompt: args.prompt,
      stage: args.stage,
      untrustedModelText: args.untrustedModelText,
    });
  } catch (error) {
    throw new RunFailureError(
      "configuration",
      `evaluation ${args.stage} prompt isolation failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const isolationArgs = args.ctx.evaluationIsolation
    ? [
        "--bare",
        "--disable-slash-commands",
        "--setting-sources", "",
        "--strict-mcp-config",
        "--no-chrome",
      ]
    : [];
  const result = await args.run(
    "claude",
    [
      "--plugin-dir", args.ctx.evaluationIsolation?.providerAssetsRoot ?? packageRoot(),
      ...isolationArgs,
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
      env: args.ctx.evaluationIsolation
        ? isolatedProviderEnvironment("claude", args.ctx.evaluationIsolation.providerHome)
        : providerEnvironment("claude"),
      inheritEnv: false,
    },
  );
  if (result.timedOut) {
    throw new RunFailureError("timeout", `claude ${args.model} stage timed out after ${args.timeoutMs}ms`);
  }
  if (result.code !== 0) {
    throw new RunFailureError(
      "provider",
      `claude ${args.model} stage exited with code ${result.code}: ${claudeFailureDetail(result)}`,
    );
  }
  let parsed: ReturnType<typeof parseClaudeEnvelope>;
  let output: T;
  try {
    parsed = parseClaudeEnvelope(result, args.prompt);
    output = args.parse(parsed.structured);
  } catch (error) {
    throw new RunFailureError(
      "parse",
      error instanceof Error ? error.message : "claude returned invalid structured output",
      { cause: error },
    );
  }
  assertNoSecrets(output, `claude ${args.model} stage output`);
  return {
    output,
    usage: applyUsageCost(parsed.usage, args.model, args.ctx.config.pricing),
    durationMs: Date.now() - started,
    model: args.model,
    promptSha256: sha256(args.prompt),
  };
}

function parseClaudeEnvelope(
  result: ExecResult,
  prompt: string,
): { structured: unknown; usage: Usage } {
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
  return {
    structured,
    usage: claudeUsageFromEnvelope(outer, prompt),
  };
}

export function createClaudeEngine(run: ExecFunction = exec): Engine {
  return {
    name: "claude",
    async review(ctx: ReviewContext): Promise<EngineResult> {
      const cfg = ctx.config.runners.claude;
      const started = Date.now();
      const skillDir = ctx.evaluationIsolation
        ? join(ctx.evaluationIsolation.providerAssetsRoot, "skills", cfg.skillName)
        : bundledSkillDir(cfg.skillName);
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
        stage: "breadth",
        schema: breadthSchemaJson(),
        maxTurns: breadthTurns,
        maxBudgetUsd: breadthBudget,
        timeoutMs: breadthTimeout,
        allowedTools: ["Read", "Grep", "Glob"].join(","),
        parse: (value) => parseBreadthResult(value, "claude breadth output"),
      });

      const elapsed = Date.now() - started;
      const remaining = cfg.timeoutMs - elapsed;
      if (remaining <= 0) {
        throw new RunFailureError("timeout", `claude review exhausted its ${cfg.timeoutMs}ms timeout`);
      }
      const breadthText = JSON.stringify(breadth.output);
      const investigation = await runStage({
        run,
        ctx,
        model: cfg.investigationModel,
        effort: cfg.investigationEffort,
        prompt: buildInvestigationPrompt(
          ctx,
          skillDir,
          `A separate ${cfg.breadthModel}/${cfg.breadthEffort} breadth process produced the ledger below. Investigate and adjudicate on ${cfg.investigationModel}/${cfg.investigationEffort}.`,
          breadthText,
          manifest,
        ),
        stage: "investigation",
        untrustedModelText: breadthText,
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
          breadth: {
            output: breadth.output,
            model: breadth.model,
            promptSha256: breadth.promptSha256,
            usage: breadth.usage,
            durationMs: breadth.durationMs,
          },
          investigation: {
            model: investigation.model,
            promptSha256: investigation.promptSha256,
            usage: investigation.usage,
            durationMs: investigation.durationMs,
          },
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
