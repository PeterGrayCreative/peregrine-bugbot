import { breadthSchemaJson, parseBreadthResult } from "../core/breadth-result.js";
import { prepareReviewManifest } from "../core/manifest.js";
import { buildBreadthPrompt, buildInvestigationPrompt } from "../core/prompt.js";
import { bundledSkillDir, packageRoot } from "../core/paths.js";
import { join } from "node:path";
import { buildEngineResult, parseReviewPayload, reviewSchemaJson } from "../core/review-result.js";
import { applyUsageCost } from "../core/pricing.js";
import { RunFailureError, runFailureKind, runFailureTelemetry } from "../core/run-failure.js";
import { claudeUsageFromEnvelope, combineUsage, promptBytes, sha256, withUnavailable } from "../core/telemetry.js";
import { assertNoSecrets, safeDiagnostic } from "../security/secrets.js";
import { isolatedProviderEnvironment, providerEnvironment } from "../security/provider-env.js";
import type { ClaudeEffort, EngineResult, ReviewContext, StageTelemetry, Usage } from "../types.js";
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
  untrustedModelText?: string;
  schema: string;
  maxTurns: number;
  maxBudgetUsd: number;
  timeoutMs: number;
  allowedTools: string;
  stage: StageTelemetry["stage"];
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
  const observed = claudeUsageFromResult(result, args.prompt);
  const failureTelemetry = (usage = observed): StageTelemetry => ({
    stage: args.stage,
    model: args.model,
    promptSha256: sha256(args.prompt),
    usage: applyUsageCost(usage, args.model, args.ctx.config.pricing),
    durationMs: Date.now() - started,
    completed: false,
  });
  if (result.timedOut) {
    throw stageFailure("timeout", `claude ${args.model} stage timed out after ${args.timeoutMs}ms`, failureTelemetry());
  }
  if (result.code !== 0) {
    throw stageFailure(
      "provider",
      `claude ${args.model} stage exited with code ${result.code}: ${claudeFailureDetail(result)}`,
      failureTelemetry(),
    );
  }
  let parsed: ReturnType<typeof parseClaudeEnvelope>;
  let output: T;
  try {
    parsed = parseClaudeEnvelope(result, args.prompt);
    output = args.parse(parsed.structured);
    assertNoSecrets(output, `claude ${args.model} stage output`);
  } catch (error) {
    throw new RunFailureError(
      "parse",
      error instanceof Error ? error.message : "claude returned invalid structured output",
      {
        cause: error,
        telemetry: singleStageFailure("claude", args.model, failureTelemetry(observed)),
      },
    );
  }
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

function claudeUsageFromResult(result: ExecResult, prompt: string): Usage {
  try {
    const envelope = JSON.parse(result.stdout) as unknown;
    return envelope && typeof envelope === "object" && !Array.isArray(envelope)
      ? claudeUsageFromEnvelope(envelope as Record<string, unknown>, prompt)
      : unknownClaudeUsage(prompt);
  } catch {
    return unknownClaudeUsage(prompt);
  }
}

function unknownClaudeUsage(prompt: string): Usage {
  return withUnavailable({ provider: "anthropic", promptBytes: promptBytes(prompt) });
}

function singleStageFailure(engine: "claude", modelConfig: string, stage: StageTelemetry) {
  return { engine, modelConfig, usage: stage.usage, durationMs: stage.durationMs, stages: [stage] };
}

function stageFailure(kind: "timeout" | "provider", message: string, stage: StageTelemetry): RunFailureError {
  return new RunFailureError(kind, message, { telemetry: singleStageFailure("claude", stage.model, stage) });
}

function completedStage<T>(stage: StageTelemetry["stage"], result: ClaudeStageResult<T>): StageTelemetry {
  return { stage, model: result.model, promptSha256: result.promptSha256, usage: result.usage, durationMs: result.durationMs, completed: true };
}

function wrapClaudeFailure(error: unknown, modelConfig: string, started: number, completed: StageTelemetry[]): RunFailureError {
  const partial = runFailureTelemetry(error)?.stages ?? [];
  const stages = [...completed, ...partial];
  return new RunFailureError(
    runFailureKind(error),
    error instanceof Error ? error.message : "claude review failed",
    {
      cause: error,
      telemetry: {
        engine: "claude",
        modelConfig,
        usage: combineUsage(...stages.map((stage) => stage.usage)),
        durationMs: Date.now() - started,
        stages,
      },
    },
  );
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
      const modelConfig = `${cfg.breadthModel}/${cfg.breadthEffort}->${cfg.investigationModel}/${cfg.investigationEffort}`;
      let breadth: ClaudeStageResult<ReturnType<typeof parseBreadthResult>>;
      try {
        breadth = await runStage({
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
          stage: "breadth",
          parse: (value) => parseBreadthResult(value, "claude breadth output"),
        });
      } catch (error) {
        throw wrapClaudeFailure(error, modelConfig, started, []);
      }

      const elapsed = Date.now() - started;
      const remaining = cfg.timeoutMs - elapsed;
      if (remaining <= 0) {
        throw wrapClaudeFailure(
          new RunFailureError("timeout", `claude review exhausted its ${cfg.timeoutMs}ms timeout`),
          modelConfig,
          started,
          [completedStage("breadth", breadth)],
        );
      }
      const breadthText = JSON.stringify(breadth.output);
      let investigation: ClaudeStageResult<ReturnType<typeof parseReviewPayload>>;
      try {
        investigation = await runStage({
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
          untrustedModelText: breadthText,
          schema: reviewSchemaJson(),
          maxTurns: Math.max(1, totalTurns - breadthTurns),
          maxBudgetUsd: totalBudget - breadthBudget,
          timeoutMs: remaining,
          allowedTools: ["Read", "Grep", "Glob"].join(","),
          stage: "investigation",
          parse: (value) => parseReviewPayload(value, "claude review output"),
        });
      } catch (error) {
        throw wrapClaudeFailure(error, modelConfig, started, [completedStage("breadth", breadth)]);
      }

      return buildEngineResult({
        engine: "claude",
        modelConfig,
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
