import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBreadthPrompt, buildInvestigationPrompt } from "../core/prompt.js";
import { parseBreadthResult } from "../core/breadth-result.js";
import { prepareReviewManifest } from "../core/manifest.js";
import { bundledSkillDir, schemaPath } from "../core/paths.js";
import { buildEngineResult, parseReviewPayload } from "../core/review-result.js";
import type { CodexEffort, EngineResult, ReviewContext, Usage } from "../types.js";
import { type ExecResult, exec } from "../util/exec.js";
import type { Engine } from "./engine.js";
import { assertNoSecrets, safeDiagnostic } from "../security/secrets.js";
import { providerEnvironment } from "../security/provider-env.js";

type ExecFunction = typeof exec;

interface CodexStageResult {
  output: string;
  usage: Usage;
  durationMs: number;
  events: unknown[];
}

async function runStage(args: {
  run: ExecFunction;
  ctx: ReviewContext;
  model: string;
  effort: CodexEffort;
  schema: string;
  output: string;
  prompt: string;
  timeoutMs: number;
}): Promise<CodexStageResult> {
  const started = Date.now();
  const result = await args.run(
    "codex",
    [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
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
      env: providerEnvironment("codex"),
      inheritEnv: false,
    },
  );
  if (result.timedOut) throw new Error(`codex ${args.model} stage timed out after ${args.timeoutMs}ms`);
  if (result.code !== 0) {
    throw new Error(
      `codex ${args.model} stage exited with code ${result.code}: ${safeDiagnostic(result.stderr || result.stdout, 500)}`,
    );
  }

  let output: string;
  try {
    output = readFileSync(args.output, "utf8");
  } catch {
    throw new Error(`codex ${args.model} stage did not write its structured output file`);
  }
  const events = result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return undefined;
      }
    })
    .filter((event): event is unknown => event !== undefined);
  return { output, usage: usageFromEvents(events), durationMs: Date.now() - started, events };
}

function usageFromEvents(events: unknown[]): Usage {
  const totals: Usage = {};
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const value = event as Record<string, unknown>;
    if (value.type !== "turn.completed" || !value.usage || typeof value.usage !== "object") continue;
    const usage = value.usage as Record<string, unknown>;
    addUsage(totals, "inputTokens", usage.input_tokens);
    addUsage(totals, "cachedInputTokens", usage.cached_input_tokens);
    addUsage(totals, "outputTokens", usage.output_tokens);
    addUsage(totals, "reasoningOutputTokens", usage.reasoning_output_tokens);
  }
  return totals;
}

function addUsage(target: Usage, key: keyof Usage, value: unknown): void {
  if (typeof value === "number") target[key] = (target[key] ?? 0) + value;
}

function combineUsage(left: Usage, right: Usage): Usage {
  const combined: Usage = {};
  for (const key of ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens"] as const) {
    const value = (left[key] ?? 0) + (right[key] ?? 0);
    if (value > 0) combined[key] = value;
  }
  return combined;
}

export function createCodexEngine(run: ExecFunction = exec): Engine {
  return {
    name: "codex",
    async review(ctx: ReviewContext): Promise<EngineResult> {
      const cfg = ctx.config.runners.codex;
      const started = Date.now();
      const skillDir = bundledSkillDir(cfg.skillName);
      const manifest = await prepareReviewManifest(ctx, cfg.skillName);
      const outDir = mkdtempSync(join(tmpdir(), "peregrine-codex-"));
      try {
        const breadthOutput = join(outDir, "breadth.json");
        const breadthTimeout = Math.min(300_000, Math.floor(cfg.timeoutMs * 0.35));
        const breadth = await runStage({
          run,
          ctx,
          model: cfg.breadthModel,
          effort: cfg.breadthEffort,
          schema: schemaPath("breadth-result"),
          output: breadthOutput,
          prompt: buildBreadthPrompt(ctx, skillDir, manifest),
          timeoutMs: breadthTimeout,
        });
        let breadthPayload;
        try {
          breadthPayload = parseBreadthResult(JSON.parse(breadth.output), "codex breadth output");
        } catch {
          throw new Error("codex breadth stage returned invalid structured JSON");
        }
        assertNoSecrets(breadthPayload, "codex breadth output");

        const elapsed = Date.now() - started;
        const remaining = cfg.timeoutMs - elapsed;
        if (remaining <= 0) throw new Error(`codex review exhausted its ${cfg.timeoutMs}ms timeout`);
        const reviewOutput = join(outDir, "review.json");
        const investigation = await runStage({
          run,
          ctx,
          model: cfg.investigationModel,
          effort: cfg.investigationEffort,
          schema: schemaPath("review-result"),
          output: reviewOutput,
          prompt: buildInvestigationPrompt(
            ctx,
            skillDir,
            `A separate ${cfg.breadthModel}/${cfg.breadthEffort} breadth pass produced the ledger below. Investigate and adjudicate on ${cfg.investigationModel}/${cfg.investigationEffort}.`,
            JSON.stringify(breadthPayload),
            manifest,
          ),
          timeoutMs: remaining,
        });

        let rawPayload: unknown;
        try {
          rawPayload = JSON.parse(investigation.output);
        } catch {
          throw new Error("codex investigation returned invalid structured JSON");
        }
        const payload = parseReviewPayload(rawPayload, "codex review output");
        return buildEngineResult({
          engine: "codex",
          modelConfig: `${cfg.breadthModel}/${cfg.breadthEffort}->${cfg.investigationModel}/${cfg.investigationEffort}`,
          ctx,
          payload,
          usage: combineUsage(breadth.usage, investigation.usage),
          durationMs: Date.now() - started,
          raw: {
            manifest: manifest.available ? "runner-generated" : manifest.reason,
            breadth: {
              output: breadthPayload,
              usage: breadth.usage,
              durationMs: breadth.durationMs,
            },
            investigation: {
              output: rawPayload,
              usage: investigation.usage,
              durationMs: investigation.durationMs,
            },
          },
        });
      } finally {
        rmSync(outDir, { recursive: true, force: true });
      }
    },
  };
}

export const codexEngine = createCodexEngine();
