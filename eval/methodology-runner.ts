import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseBreadthResult } from "../src/core/breadth-result.js";
import { RunFailureError, runFailureKind, runFailureTelemetry, type RunFailureKind } from "../src/core/run-failure.js";
import { combineUsage, parseUsage, sha256 } from "../src/core/telemetry.js";
import { runCodexStage } from "../src/engines/codex.js";
import { nonSensitiveEnvironment } from "../src/security/provider-env.js";
import { assertNoSecrets, safeDiagnostic } from "../src/security/secrets.js";
import type { ReviewContext, StageTelemetry, Usage } from "../src/types.js";
import { exec } from "../src/util/exec.js";
import type { LeakagePolicy } from "./case-isolation.js";
import { canonicalJson } from "./experiment.js";
import {
  verifyMethodologyAssetManifest,
  type MethodologyAssetManifest,
} from "./methodology-assets.js";
import {
  parseMethodologyDiscoveryOutput,
  parseMethodologyReviewOutput,
  type MethodologyDiscoveryOutput,
  type MethodologyReviewOutput,
} from "./methodology-output.js";
import { createMethodologyPromptValidator } from "./methodology-prompt-isolation.js";
import {
  compileMethodologyDiscoveryPrompt,
  compileMethodologyReviewPrompt,
  parseMethodologyRawScope,
  type CompiledMethodologyPrompt,
  type MethodologyRawScope,
} from "./methodology-prompts.js";
import {
  METHODOLOGY_MODEL,
  parseMethodologySchedule,
  type MethodologyScheduledAttempt,
} from "./methodology-schedule.js";

export const METHODOLOGY_RUN_PROTOCOL = "historical-methodology-run-v1" as const;

export interface MethodologyBeforeInvocationInput {
  attemptId: string;
  stageIndex: 1 | 2;
  compiled: CompiledMethodologyPrompt;
  assets: MethodologyAssetManifest;
  schemaText: string;
  model: typeof METHODOLOGY_MODEL;
  effort: "high";
  /** Registered maximum for this stage, not necessarily the applied child timeout. */
  stageMaximumMs: number;
  /** Absolute attempt deadline; callback time is charged before provider dispatch. */
  attemptDeadlineAt: string;
  /** Exact previous provider output bytes; null for the first invocation. */
  previousOutput: string | null;
  requestedAt: string;
}

export type MethodologyBeforeInvocation = (
  input: MethodologyBeforeInvocationInput,
) => string | Promise<string>;

export interface MethodologyInvocationReceipt {
  stageIndex: 1 | 2;
  /** Digest of the append-only invocation-intent record, not proof of provider contact. */
  invocationSha256: string;
}

export interface MethodologyModelScopeLimitation {
  source: "model";
  stage: "discovery" | "review";
  detail: string;
}

export interface MethodologyStageTrace {
  stageIndex: 1 | 2;
  stage: "discovery" | "review";
  invocationSha256: string;
  compiled: CompiledMethodologyPrompt;
  assetsTreeSha256: string;
  schemaSha256: string;
  appliedTimeoutMs: number;
  telemetry: StageTelemetry;
  rawOutputSha256: string | null;
  rawOutput: string | null;
  rawOutputOmittedReason?: "secret-unsafe";
  containmentCleanupFailed?: true;
}

export interface MethodologyAttemptResult {
  schemaVersion: 1;
  protocol: typeof METHODOLOGY_RUN_PROTOCOL;
  attempt: MethodologyScheduledAttempt;
  model: typeof METHODOLOGY_MODEL;
  effort: "high";
  durationMs: number;
  usage: Usage | null;
  stages: MethodologyStageTrace[];
  intentReceipts: MethodologyInvocationReceipt[];
  scope: {
    status: "unverified";
    meaning: "runner-availability-not-authenticated";
    modelLimitations: MethodologyModelScopeLimitation[];
  };
  outcome:
    | { status: "completed"; review: MethodologyReviewOutput }
    | { status: "failed"; failureKind: RunFailureKind; message: string };
}

export interface MethodologyRunnerInput {
  schedule: unknown;
  attemptId: string;
  assetManifest: unknown;
  rawScope: unknown;
  activatedLanes?: unknown;
  leakagePolicy: LeakagePolicy;
  context: ReviewContext;
  beforeInvocation: MethodologyBeforeInvocation;
  now?: () => number;
}

/**
 * Execute one preregistered experimental attempt. This is not an Engine and
 * never constructs production findings, confidence, invariants, or a clean
 * verdict. Provider/runtime identity and runner availability remain external
 * authenticated evidence even after this function completes successfully.
 */
export async function runMethodologyAttempt(input: MethodologyRunnerInput): Promise<MethodologyAttemptResult> {
  const now = input.now ?? Date.now;
  const started = now();
  const schedule = parseMethodologySchedule(input.schedule);
  const attempt = schedule.attempts.find((candidate) => candidate.id === input.attemptId);
  if (!attempt) throw new Error("methodology attemptId is not present in the rederived schedule");
  if (typeof input.beforeInvocation !== "function") {
    throw new Error("methodology beforeInvocation callback is required");
  }
  const isolation = input.context.evaluationIsolation;
  if (!isolation?.providerOutputRoot || !isolation.runProvider || !isolation.readProviderOutput) {
    throw new Error("methodology execution requires runProvider, readProviderOutput, and providerOutputRoot");
  }
  const scope = parseMethodologyRawScope(input.rawScope);
  await assertMaterializedScope(input.context, scope);
  const retainedAssets = verifyMethodologyAssetManifest(
    isolation.providerAssetsRoot,
    input.assetManifest,
  );
  if (retainedAssets.armId !== attempt.armId) {
    throw new Error("methodology asset manifest does not match the scheduled arm");
  }

  const attemptDeadline = started + schedule.design.totalDeadlineMs;
  const stages: MethodologyStageTrace[] = [];
  const intentReceipts: MethodologyInvocationReceipt[] = [];
  const limitations: MethodologyModelScopeLimitation[] = [];
  const outputDirectory = mkdtempSync(join(isolation.providerOutputRoot, "methodology-"));
  let outcome: MethodologyAttemptResult["outcome"];

  try {
    let handoff: MethodologyDiscoveryOutput | ReturnType<typeof parseBreadthResult> | undefined;
    let previousOutput: string | null = null;
    if (attempt.expectedStages === 2) {
      const compiled = await compileMethodologyDiscoveryPrompt({
        armId: attempt.armId as "C" | "D",
        scope,
        ...(attempt.armId === "D" ? { activatedLanes: input.activatedLanes } : {}),
      });
      const stage = await invoke({
        input,
        attempt,
        scope,
        retainedAssets,
        compiled,
        stageIndex: 1,
        stageMaximumMs: attempt.stageDeadlineMs[0],
        attemptDeadline,
        previousOutput: null,
        outputDirectory,
        now,
        intentReceipts,
      });
      stages.push(stage.trace);
      previousOutput = stage.rawOutput;
      try {
        const raw = JSON.parse(stage.rawOutput) as unknown;
        if (attempt.armId === "C") {
          handoff = parseMethodologyDiscoveryOutput(raw);
          limitations.push(...handoff.limitations.map((detail) => ({
            source: "model" as const,
            stage: "discovery" as const,
            detail,
          })));
        } else {
          handoff = parseBreadthResult(raw, "methodology breadth output");
          assertNoSecrets(handoff, "methodology breadth output");
          limitations.push(...handoff.coverage.unavailable.map((detail) => ({
            source: "model" as const,
            stage: "discovery" as const,
            detail,
          })));
        }
      } catch (error) {
        stage.trace.telemetry.completed = false;
        omitSecretUnsafeRawOutput(stage.trace, "malformed methodology discovery output");
        throw new RunFailureError("parse", "methodology discovery returned invalid structured output", {
          cause: error,
        });
      }
    }

    const compiled = await compileMethodologyReviewPrompt({
      armId: attempt.armId,
      scope,
      ...((attempt.armId === "B" || attempt.armId === "D")
        ? { activatedLanes: input.activatedLanes }
        : {}),
      ...(handoff === undefined ? {} : { handoff }),
    });
    const stageIndex = attempt.expectedStages as 1 | 2;
    const stage = await invoke({
      input,
      attempt,
      scope,
      retainedAssets,
      compiled,
      stageIndex,
      stageMaximumMs: attempt.stageDeadlineMs[stageIndex - 1]!,
      attemptDeadline,
      previousOutput,
      outputDirectory,
      now,
      intentReceipts,
    });
    stages.push(stage.trace);
    let review: MethodologyReviewOutput;
    try {
      review = parseMethodologyReviewOutput(JSON.parse(stage.rawOutput));
    } catch (error) {
      stage.trace.telemetry.completed = false;
      omitSecretUnsafeRawOutput(stage.trace, "malformed methodology review output");
      throw new RunFailureError("parse", "methodology review returned invalid structured output", {
        cause: error,
      });
    }
    limitations.push(...review.limitations.map((detail) => ({
      source: "model" as const,
      stage: "review" as const,
      detail,
    })));
    outcome = { status: "completed", review };
  } catch (error) {
    if (error instanceof MethodologyStageFailure &&
        !stages.some((stage) => stage.stageIndex === error.trace.stageIndex)) {
      stages.push(error.trace);
    }
    outcome = {
      status: "failed",
      failureKind: runFailureKind(error),
      message: boundedFailureMessage(error),
    };
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }

  return {
    schemaVersion: 1,
    protocol: METHODOLOGY_RUN_PROTOCOL,
    attempt,
    model: METHODOLOGY_MODEL,
    effort: "high",
    durationMs: Math.max(0, now() - started),
    usage: stages.length === 0
      ? null
      : jsonSafeUsage(combineUsage(...stages.map((stage) => stage.telemetry.usage))),
    stages,
    intentReceipts,
    scope: {
      status: "unverified",
      meaning: "runner-availability-not-authenticated",
      modelLimitations: limitations,
    },
    outcome,
  };
}

async function invoke(args: {
  input: MethodologyRunnerInput;
  attempt: MethodologyScheduledAttempt;
  scope: MethodologyRawScope;
  retainedAssets: MethodologyAssetManifest;
  compiled: CompiledMethodologyPrompt;
  stageIndex: 1 | 2;
  stageMaximumMs: number;
  attemptDeadline: number;
  previousOutput: string | null;
  outputDirectory: string;
  now: () => number;
  intentReceipts: MethodologyInvocationReceipt[];
}): Promise<{ trace: MethodologyStageTrace; rawOutput: string }> {
  const isolation = args.input.context.evaluationIsolation!;
  let assets: MethodologyAssetManifest;
  try {
    assets = verifyMethodologyAssetManifest(isolation.providerAssetsRoot, args.retainedAssets);
  } catch (error) {
    throw new RunFailureError("configuration", "methodology assets changed before invocation", { cause: error });
  }
  const schemaEntry = assets.files.find((entry) => entry.path === args.compiled.schemaPath);
  if (!schemaEntry) throw new RunFailureError("configuration", "compiled methodology schema is not mounted");
  const schemaPath = join(isolation.providerAssetsRoot, ...args.compiled.schemaPath.split("/"));
  let schemaText: string;
  try {
    schemaText = readFileSync(schemaPath, "utf8");
  } catch (error) {
    throw new RunFailureError("configuration", "compiled methodology schema is unreadable", { cause: error });
  }
  if (Buffer.byteLength(schemaText) !== schemaEntry.bytes || sha256(schemaText) !== schemaEntry.sha256) {
    throw new RunFailureError("configuration", "compiled methodology schema bytes do not match the asset manifest");
  }
  const requestedAtMs = args.now();
  const canonicalHandoff = args.previousOutput === null
    ? undefined
    : canonicalPreviousOutput(args.attempt.armId, args.previousOutput);
  const stageValidator = createMethodologyPromptValidator(
    args.input.leakagePolicy,
    args.compiled,
    args.scope,
    canonicalHandoff,
  );
  // Validate before persisting an invocation intent. runCodexStage repeats this
  // check immediately before dispatch.
  stageValidator({
    prompt: args.compiled.prompt,
    stage: args.compiled.stage === "discovery" ? "breadth" : "investigation",
    ...(canonicalHandoff === undefined ? {} : { untrustedModelText: canonicalHandoff }),
  });
  const compiledSnapshot = structuredClone(args.compiled);
  const callbackInput: MethodologyBeforeInvocationInput = {
    attemptId: args.attempt.id,
    stageIndex: args.stageIndex,
    compiled: structuredClone(args.compiled),
    assets: structuredClone(assets),
    schemaText,
    model: METHODOLOGY_MODEL,
    effort: "high",
    stageMaximumMs: args.stageMaximumMs,
    attemptDeadlineAt: new Date(args.attemptDeadline).toISOString(),
    previousOutput: args.previousOutput,
    requestedAt: new Date(requestedAtMs).toISOString(),
  };
  let invocationSha256: string;
  try {
    invocationSha256 = await args.input.beforeInvocation(callbackInput);
  } catch (error) {
    throw new RunFailureError("configuration", "methodology invocation sealing failed", { cause: error });
  }
  if (!/^[a-f0-9]{64}$/.test(invocationSha256)) {
    throw new RunFailureError("configuration", "methodology invocation sealing returned an invalid receipt");
  }
  args.intentReceipts.push({ stageIndex: args.stageIndex, invocationSha256 });
  try {
    verifyMethodologyAssetManifest(isolation.providerAssetsRoot, assets);
  } catch (error) {
    throw new RunFailureError("configuration", "methodology assets changed during invocation sealing", { cause: error });
  }
  if (canonicalJson(args.compiled) !== canonicalJson(compiledSnapshot) ||
      sha256(args.compiled.prompt) !== args.compiled.promptSha256) {
    throw new RunFailureError("configuration", "compiled methodology prompt changed during invocation sealing");
  }
  let currentSchemaText: string;
  try {
    currentSchemaText = readFileSync(schemaPath, "utf8");
  } catch (error) {
    throw new RunFailureError("configuration", "compiled methodology schema became unreadable during sealing", {
      cause: error,
    });
  }
  if (currentSchemaText !== schemaText) {
    throw new RunFailureError("configuration", "compiled methodology schema changed during invocation sealing");
  }
  const remainingMs = Math.min(args.stageMaximumMs, args.attemptDeadline - args.now());
  if (remainingMs <= 0) {
    throw new RunFailureError("timeout", "methodology attempt deadline was exhausted before provider invocation");
  }
  const stageName = args.compiled.stage === "discovery" ? "breadth" : "investigation";
  const stageContext: ReviewContext = {
    ...args.input.context,
    evaluationIsolation: {
      ...isolation,
      validatePrompt: stageValidator,
    },
  };
  const output = join(args.outputDirectory, `stage-${args.stageIndex}.json`);
  let result: Awaited<ReturnType<typeof runCodexStage>>;
  try {
    result = await runCodexStage({
      run: isolation.runProvider!,
      ctx: stageContext,
      model: METHODOLOGY_MODEL,
      effort: "high",
      schema: schemaPath,
      output,
      prompt: args.compiled.prompt,
      ...(canonicalHandoff === undefined ? {} : { untrustedModelText: canonicalHandoff }),
      timeoutMs: remainingMs,
      stage: stageName,
    });
  } catch (error) {
    const observed = runFailureTelemetry(error)?.stages.at(-1);
    if (!observed) throw error;
    throw new MethodologyStageFailure(error, {
      stageIndex: args.stageIndex,
      stage: args.compiled.stage,
      invocationSha256,
      compiled: args.compiled,
      assetsTreeSha256: assets.treeSha256,
      schemaSha256: schemaEntry.sha256,
      appliedTimeoutMs: remainingMs,
      telemetry: { ...observed, usage: jsonSafeUsage(observed.usage) },
      rawOutputSha256: null,
      rawOutput: null,
      ...(runFailureTelemetry(error)?.containmentCleanupFailed
        ? { containmentCleanupFailed: true as const }
        : {}),
    });
  }
  const telemetry: StageTelemetry = {
    stage: stageName,
    model: result.model,
    promptSha256: result.promptSha256,
    usage: jsonSafeUsage(result.usage),
    durationMs: result.durationMs,
    completed: true,
  };
  const trace: MethodologyStageTrace = {
    stageIndex: args.stageIndex,
    stage: args.compiled.stage,
    invocationSha256,
    compiled: args.compiled,
    assetsTreeSha256: assets.treeSha256,
    schemaSha256: schemaEntry.sha256,
    appliedTimeoutMs: remainingMs,
    telemetry,
    rawOutputSha256: sha256(result.output),
    rawOutput: result.output,
  };
  return { trace, rawOutput: result.output };
}

function canonicalPreviousOutput(armId: MethodologyScheduledAttempt["armId"], raw: string): string {
  const value = JSON.parse(raw) as unknown;
  return canonicalJson(armId === "C"
    ? parseMethodologyDiscoveryOutput(value)
    : parseBreadthResult(value, "methodology breadth handoff"));
}

async function assertMaterializedScope(context: ReviewContext, scope: MethodologyRawScope): Promise<void> {
  if (context.baseRef !== scope.baseRef || context.headRef !== scope.headRef || context.diffText !== scope.diff) {
    throw new Error("methodology raw scope does not match its isolated ReviewContext");
  }
  if (readFileSync(context.diffPath, "utf8") !== scope.diff) {
    throw new Error("methodology raw scope diff does not match the materialized diff file");
  }
  const git = async (args: string[], trim = true): Promise<string> => {
    const result = await exec("git", args, {
      cwd: context.repoPath,
      env: safeGitEnvironment(context.evaluationIsolation!.providerHome),
      inheritEnv: false,
    });
    if (result.timedOut || result.code !== 0) {
      throw new Error(`methodology materialized Git verification failed: ${result.stderr || result.stdout}`);
    }
    return trim ? result.stdout.trim() : result.stdout;
  };
  const [head, parent, mergeBase, remotes, status, commitCount] = await Promise.all([
    git(["rev-parse", "HEAD"]),
    git(["rev-parse", "HEAD^"]),
    git(["merge-base", scope.baseRef, scope.headRef]),
    git(["remote"]),
    git(["status", "--porcelain=v1", "--untracked-files=all"]),
    git(["rev-list", "--all", "--count"]),
  ]);
  if (head !== scope.headRef || parent !== scope.baseRef || mergeBase !== scope.baseRef || remotes || status || commitCount !== "2") {
    throw new Error("methodology ReviewContext is not an isolated two-commit materialization");
  }
  const diff = await git([
    "diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-color", "--find-renames",
    `${scope.baseRef}...${scope.headRef}`, "--",
  ], false);
  if (diff !== scope.diff) throw new Error("methodology raw diff does not match the materialized Git comparison");
  const changed = (await git([
    "diff", "--name-only", "-z", "--no-ext-diff", "--no-textconv", "--find-renames",
    `${scope.baseRef}...${scope.headRef}`, "--",
  ], false)).split("\0").filter(Boolean).sort(compareText);
  if (canonicalJson(changed) !== canonicalJson(scope.rawChangedPaths)) {
    throw new Error("methodology changed paths do not match the materialized Git comparison");
  }
}

class MethodologyStageFailure extends RunFailureError {
  readonly trace: MethodologyStageTrace;

  constructor(cause: unknown, trace: MethodologyStageTrace) {
    super(
      runFailureKind(cause),
      cause instanceof Error ? cause.message : "methodology provider stage failed",
      { cause, telemetry: runFailureTelemetry(cause) },
    );
    this.name = "MethodologyStageFailure";
    this.trace = trace;
  }
}

function boundedFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "methodology execution failed";
  return safeDiagnostic(message, 2_000);
}

function omitSecretUnsafeRawOutput(trace: MethodologyStageTrace, source: string): void {
  if (trace.rawOutput === null) return;
  try {
    assertNoSecrets(trace.rawOutput, source);
  } catch {
    trace.rawOutput = null;
    trace.rawOutputSha256 = null;
    trace.rawOutputOmittedReason = "secret-unsafe";
  }
}

function jsonSafeUsage(usage: Usage): Usage {
  return parseUsage(JSON.parse(JSON.stringify(usage)), "methodology observed usage");
}

function safeGitEnvironment(providerHome: string): Record<string, string> {
  const environment = nonSensitiveEnvironment();
  for (const name of Object.keys(environment)) {
    if (name.startsWith("GIT_")) delete environment[name];
  }
  return {
    ...environment,
    HOME: providerHome,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
