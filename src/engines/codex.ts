import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBreadthPrompt, buildInvestigationPrompt } from "../core/prompt.js";
import { parseBreadthResult } from "../core/breadth-result.js";
import { prepareReviewManifest } from "../core/manifest.js";
import { bundledSkillDir, schemaPath } from "../core/paths.js";
import { buildEngineResult, parseReviewPayload } from "../core/review-result.js";
import { applyUsageCost } from "../core/pricing.js";
import { RunFailureError, runFailureKind, runFailureTelemetry } from "../core/run-failure.js";
import { codexUsageFromEvents, combineUsage, sha256 } from "../core/telemetry.js";
import type { CodexEffort, EngineResult, ReviewContext, StageTelemetry, Usage } from "../types.js";
import { type ExecResult, exec } from "../util/exec.js";
import type { Engine } from "./engine.js";
import { assertNoSecrets, safeDiagnostic } from "../security/secrets.js";
import { isolatedProviderEnvironment, providerEnvironment } from "../security/provider-env.js";

type ExecFunction = typeof exec;

interface CodexStageResult {
  output: string;
  usage: Usage;
  durationMs: number;
  events: unknown[];
  malformedEventLines: number;
  model: string;
  promptSha256: string;
}

async function runStage(args: {
  run: ExecFunction;
  ctx: ReviewContext;
  model: string;
  effort: CodexEffort;
  schema: string;
  output: string;
  prompt: string;
  untrustedModelText?: string;
  timeoutMs: number;
  stage: StageTelemetry["stage"];
}): Promise<CodexStageResult> {
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
        "--ignore-rules",
        "--config", "project_doc_max_bytes=0",
        "--config", "project_doc_fallback_filenames=[]",
        "--config", `projects.${JSON.stringify(args.ctx.repoPath)}.trust_level="untrusted"`,
      ]
    : [];
  const result = await args.run(
    "codex",
    [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      ...isolationArgs,
      "--strict-config",
      "--sandbox",
      "read-only",
      "--model",
      args.model,
      "--config",
      `model_reasoning_effort=${JSON.stringify(args.effort)}`,
      "--cd",
      args.ctx.repoPath,
      "--output-schema",
      args.schema,
      "--output-last-message",
      args.output,
      "--json",
      "--color",
      "never",
      "-",
    ],
    {
      cwd: args.ctx.repoPath,
      timeoutMs: args.timeoutMs,
      stdin: args.prompt,
      env: args.ctx.evaluationIsolation
        ? isolatedProviderEnvironment("codex", args.ctx.evaluationIsolation.providerHome)
        : providerEnvironment("codex"),
      inheritEnv: false,
    },
  );
  const parsedEvents = parseCodexEvents(result.stdout);
  const observedUsage = applyUsageCost(
    codexUsageFromEvents(parsedEvents.events, args.prompt, {
      completeEventStream: !result.timedOut && result.code === 0 && parsedEvents.malformedEventLines === 0,
    }),
    args.model,
    args.ctx.config.pricing,
  );
  const stageTelemetry = (): StageTelemetry => ({
    stage: args.stage,
    model: args.model,
    promptSha256: sha256(args.prompt),
    usage: observedUsage,
    durationMs: Date.now() - started,
    completed: false,
  });
  if (result.timedOut) {
    throw codexStageFailure("timeout", `codex ${args.model} stage timed out after ${args.timeoutMs}ms`, stageTelemetry());
  }
  if (result.code !== 0) {
    throw codexStageFailure(
      "provider",
      `codex ${args.model} stage exited with code ${result.code}: ${safeDiagnostic(result.stderr || result.stdout, 500)}`,
      stageTelemetry(),
    );
  }

  let output: string;
  try {
    output = readFileSync(args.output, "utf8");
  } catch {
    throw new RunFailureError(
      "parse",
      `codex ${args.model} stage did not write its structured output file`,
      { telemetry: singleCodexStageFailure(args.model, stageTelemetry()) },
    );
  }
  return {
    output,
    usage: observedUsage,
    durationMs: Date.now() - started,
    events: parsedEvents.events,
    malformedEventLines: parsedEvents.malformedEventLines,
    model: args.model,
    promptSha256: sha256(args.prompt),
  };
}

function parseCodexEvents(stdout: string): { events: unknown[]; malformedEventLines: number } {
  let malformedEventLines = 0;
  const events = stdout.split("\n").filter((line) => line.trim().length > 0).flatMap((line) => {
    try {
      return [JSON.parse(line) as unknown];
    } catch {
      malformedEventLines++;
      return [];
    }
  });
  return { events, malformedEventLines };
}

function singleCodexStageFailure(modelConfig: string, stage: StageTelemetry) {
  return { engine: "codex" as const, modelConfig, usage: stage.usage, durationMs: stage.durationMs, stages: [stage] };
}

function codexStageFailure(kind: "timeout" | "provider", message: string, stage: StageTelemetry): RunFailureError {
  return new RunFailureError(kind, message, { telemetry: singleCodexStageFailure(stage.model, stage) });
}

function codexStage(stage: StageTelemetry["stage"], result: CodexStageResult, completed: boolean): StageTelemetry {
  return { stage, model: result.model, promptSha256: result.promptSha256, usage: result.usage, durationMs: result.durationMs, completed };
}

function wrapCodexFailure(error: unknown, modelConfig: string, started: number, completed: StageTelemetry[]): RunFailureError {
  const partial = runFailureTelemetry(error)?.stages ?? [];
  const stages = [...completed, ...partial];
  const telemetry = stages.length === 0
    ? undefined
    : {
        engine: "codex" as const,
        modelConfig,
        usage: stages.length === 1
          ? stages[0]!.usage
          : combineUsage(...stages.map((stage) => stage.usage)),
        durationMs: Date.now() - started,
        stages,
      };
  return new RunFailureError(runFailureKind(error), error instanceof Error ? error.message : "codex review failed", {
    cause: error,
    ...(telemetry ? { telemetry } : {}),
  });
}

export function createCodexEngine(run: ExecFunction = exec): Engine {
  return {
    name: "codex",
    async review(ctx: ReviewContext): Promise<EngineResult> {
      const cfg = ctx.config.runners.codex;
      const started = Date.now();
      const skillDir = ctx.evaluationIsolation
        ? join(ctx.evaluationIsolation.providerAssetsRoot, "skills", cfg.skillName)
        : bundledSkillDir(cfg.skillName);
      const manifest = await prepareReviewManifest(ctx, cfg.skillName);
      const modelConfig = `${cfg.breadthModel}/${cfg.breadthEffort}->${cfg.investigationModel}/${cfg.investigationEffort}`;
      const outDir = mkdtempSync(join(tmpdir(), "peregrine-codex-"));
      try {
        const breadthOutput = join(outDir, "breadth.json");
        const breadthTimeout = Math.min(300_000, Math.floor(cfg.timeoutMs * 0.35));
        let breadth: CodexStageResult;
        try {
          breadth = await runStage({
            run,
            ctx,
            model: cfg.breadthModel,
            effort: cfg.breadthEffort,
            schema: ctx.evaluationIsolation
              ? join(ctx.evaluationIsolation.providerAssetsRoot, "schemas", "breadth-result.schema.json")
              : schemaPath("breadth-result"),
            output: breadthOutput,
            prompt: buildBreadthPrompt(ctx, skillDir, manifest),
            timeoutMs: breadthTimeout,
            stage: "breadth",
          });
        } catch (error) {
          throw wrapCodexFailure(error, modelConfig, started, []);
        }
        let breadthPayload;
        try {
          breadthPayload = parseBreadthResult(JSON.parse(breadth.output), "codex breadth output");
          assertNoSecrets(breadthPayload, "codex breadth output");
        } catch (error) {
          throw wrapCodexFailure(
            new RunFailureError("parse", "codex breadth stage returned invalid structured JSON", { cause: error }),
            modelConfig,
            started,
            [codexStage("breadth", breadth, false)],
          );
        }
        const elapsed = Date.now() - started;
        const remaining = cfg.timeoutMs - elapsed;
        if (remaining <= 0) {
          throw wrapCodexFailure(
            new RunFailureError("timeout", `codex review exhausted its ${cfg.timeoutMs}ms timeout`),
            modelConfig,
            started,
            [codexStage("breadth", breadth, true)],
          );
        }
        const reviewOutput = join(outDir, "review.json");
        const breadthText = JSON.stringify(breadthPayload);
        let investigation: CodexStageResult;
        try {
          investigation = await runStage({
            run,
            ctx,
            model: cfg.investigationModel,
            effort: cfg.investigationEffort,
            schema: ctx.evaluationIsolation
              ? join(ctx.evaluationIsolation.providerAssetsRoot, "schemas", "review-result.schema.json")
              : schemaPath("review-result"),
            output: reviewOutput,
            prompt: buildInvestigationPrompt(
              ctx,
              skillDir,
              `A separate ${cfg.breadthModel}/${cfg.breadthEffort} breadth pass produced the ledger below. Investigate and adjudicate on ${cfg.investigationModel}/${cfg.investigationEffort}.`,
              breadthText,
              manifest,
            ),
            untrustedModelText: breadthText,
            timeoutMs: remaining,
            stage: "investigation",
          });
        } catch (error) {
          throw wrapCodexFailure(error, modelConfig, started, [codexStage("breadth", breadth, true)]);
        }

        let rawPayload: unknown;
        try {
          rawPayload = JSON.parse(investigation.output);
        } catch (error) {
          throw wrapCodexFailure(
            new RunFailureError("parse", "codex investigation returned invalid structured JSON", { cause: error }),
            modelConfig,
            started,
            [codexStage("breadth", breadth, true), codexStage("investigation", investigation, false)],
          );
        }
        let payload;
        try {
          payload = parseReviewPayload(rawPayload, "codex review output");
        } catch (error) {
          throw wrapCodexFailure(
            new RunFailureError(
              "parse",
              error instanceof Error ? error.message : "codex investigation returned invalid structured output",
              { cause: error },
            ),
            modelConfig,
            started,
            [codexStage("breadth", breadth, true), codexStage("investigation", investigation, false)],
          );
        }
        try {
          return buildEngineResult({
            engine: "codex",
            modelConfig,
            ctx,
            payload,
            usage: combineUsage(breadth.usage, investigation.usage),
            durationMs: Date.now() - started,
            raw: {
              manifest: manifest.available ? manifest.output : manifest.reason,
              breadth: {
                output: breadthPayload,
                model: breadth.model,
                promptSha256: breadth.promptSha256,
                usage: breadth.usage,
                durationMs: breadth.durationMs,
                malformedEventLines: breadth.malformedEventLines,
              },
              investigation: {
                output: rawPayload,
                model: investigation.model,
                promptSha256: investigation.promptSha256,
                usage: investigation.usage,
                durationMs: investigation.durationMs,
                malformedEventLines: investigation.malformedEventLines,
              },
            },
          });
        } catch (error) {
          throw wrapCodexFailure(
            new RunFailureError(
              "parse",
              error instanceof Error ? error.message : "codex could not construct the review artifact",
              { cause: error },
            ),
            modelConfig,
            started,
            [codexStage("breadth", breadth, true), codexStage("investigation", investigation, true)],
          );
        }
      } finally {
        rmSync(outDir, { recursive: true, force: true });
      }
    },
  };
}

export const codexEngine = createCodexEngine();
