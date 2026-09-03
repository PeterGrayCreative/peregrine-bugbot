import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageRoot, schemaPath } from "../src/core/paths.js";
import type { ExperimentProviderAccess } from "../src/types.js";
import type { ExecResult } from "../src/util/exec.js";
import {
  createContainedOutputReader,
  createContainedProviderExec,
  type ContainedProviderOptions,
} from "./runtime-containment.js";
import { canonicalJsonSha256, hashPathTree } from "./experiment.js";

export const CODEX_SEMANTIC_JUDGE = Object.freeze({
  kind: "codex" as const,
  model: "gpt-5.6-luna" as const,
  effort: "medium" as const,
  version: "semantic-v1" as const,
});

export interface SemanticJudgeRuntimeResult {
  verdict: boolean;
  durationMs: number;
  providerCostUsd: number | null;
  usage: SemanticJudgeUsage;
}

export interface SemanticJudgeUsage {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  turns: number | null;
  toolCalls: number | null;
}

export const unavailableJudgeUsage = (): SemanticJudgeUsage => ({
  inputTokens: null, cachedInputTokens: null, outputTokens: null,
  reasoningTokens: null, turns: null, toolCalls: null,
});

export class SemanticJudgeExecutionError extends Error {
  constructor(message: string, readonly durationMs: number, readonly usage: SemanticJudgeUsage = unavailableJudgeUsage()) {
    super(message);
  }
}

export type SemanticJudgeExecutor = (prompt: string) => Promise<SemanticJudgeRuntimeResult>;

/**
 * Builds the only provider-backed semantic judge supported by immutable
 * experiments. The container receives an empty checkout, one result schema,
 * the prompt over stdin, and a private attempt-owned output directory. It is
 * never given the repository, corpus, ground truth, or review artifacts.
 */
export function createContainedCodexSemanticJudge(options: {
  providerAccess: Exclude<ExperimentProviderAccess, "not-applicable">;
  run?: ContainedProviderOptions["run"];
}): SemanticJudgeExecutor {
  return async (prompt: string) => {
    const root = mkdtempSync(join(tmpdir(), "peregrine-semantic-judge-"));
    const checkoutDir = join(root, "empty-checkout");
    const assetsDir = join(root, "assets");
    const outputDir = join(root, "output");
    mkdirSync(checkoutDir, { mode: 0o700 });
    mkdirSync(assetsDir, { mode: 0o700 });
    mkdirSync(outputDir, { mode: 0o700 });
    chmodSync(outputDir, 0o700);
    copyFileSync(schemaPath("judge-result"), join(assetsDir, "judge-result.schema.json"));
    const contained = createContainedProviderExec({
      runner: "codex",
      providerAccess: options.providerAccess,
      checkoutDir,
      assetsDir,
      outputDir,
      profile: "semantic-judge",
      ...(options.run ? { run: options.run } : {}),
    });
    const started = Date.now();
    let result: ExecResult | undefined;
    try {
      result = await contained("codex", semanticJudgeArguments(), {
        timeoutMs: 60_000,
        stdin: prompt,
        env: {},
        inheritEnv: false,
      });
      if (result.cleanupErrors?.length) {
        throw new SemanticJudgeExecutionError("semantic judge cleanup failed", Date.now() - started);
      }
      if (result.timedOut || result.code !== 0) {
        throw new SemanticJudgeExecutionError(result.timedOut ? "semantic judge timeout" : "semantic judge provider failure", Date.now() - started);
      }
      const readOutput = createContainedOutputReader(outputDir, 16 * 1024);
      const parsed = JSON.parse(readOutput(join(outputDir, "verdict.json"))) as { same_root_cause?: unknown };
      if (typeof parsed.same_root_cause !== "boolean") throw new SemanticJudgeExecutionError("semantic judge parse failure", Date.now() - started);
      return {
        verdict: parsed.same_root_cause,
        durationMs: Date.now() - started,
        // Codex CLI sessions do not expose an authenticated monetary charge.
        providerCostUsd: null,
        usage: unavailableJudgeUsage(),
      };
    } catch (error) {
      if (error instanceof SemanticJudgeExecutionError) throw error;
      throw new SemanticJudgeExecutionError(
        error instanceof Error ? error.message : "semantic judge unknown failure",
        Date.now() - started,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

export function semanticJudgeArguments(): string[] {
  return [
    "exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config",
    "--disable", "shell_tool", "--disable", "unified_exec",
    "--sandbox", "read-only", "--model", CODEX_SEMANTIC_JUDGE.model,
    "--config", `model_reasoning_effort="${CODEX_SEMANTIC_JUDGE.effort}"`,
    "--config", "project_doc_max_bytes=0",
    "--config", "project_doc_fallback_filenames=[]",
    "--config", 'projects."/workspace".trust_level="untrusted"',
    "--cd", "/workspace", "--output-schema", "/opt/peregrine/judge-result.schema.json",
    "--output-last-message", "/output/verdict.json", "--json", "--color", "never", "-",
  ];
}

export function semanticJudgeImplementationSha256(judge: unknown): string {
  const root = packageRoot();
  return canonicalJsonSha256({
    implementation: hashPathTree(join(root, "eval", "grade.ts")),
    gradingContract: hashPathTree(join(root, "eval", "grading-contract.ts")),
    ledger: hashPathTree(join(root, "eval", "judge-ledger.ts")),
    runtime: hashPathTree(join(root, "eval", "judge-runtime.ts")),
    containment: hashPathTree(join(root, "eval", "runtime-containment.ts")),
    resultSchema: hashPathTree(schemaPath("judge-result")),
    evidenceSchema: hashPathTree(join(root, "schemas", "grading-evidence.schema.json")),
    judge,
  });
}
