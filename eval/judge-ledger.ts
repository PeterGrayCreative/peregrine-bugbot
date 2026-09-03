import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SemanticJudgeDecision } from "../src/types.js";
import { findingEvidenceSha256, semanticDecision } from "./grading-contract.js";
import { canonicalJsonSha256, writeExclusiveJson } from "./experiment.js";
import {
  CODEX_SEMANTIC_JUDGE,
  SemanticJudgeExecutionError,
  unavailableJudgeUsage,
  type SemanticJudgeExecutor,
  type SemanticJudgeUsage,
} from "./judge-runtime.js";
import type { Finding, GroundTruthBug } from "../src/types.js";

export const JUDGE_DIRECTORY = "judge";
export const JUDGE_MANIFEST = "judge/manifest.json";
export const JUDGE_STOP = "judge/stop.json";
export const JUDGE_TERMINAL_SEAL = "judge/terminal-seal.json";

const SHA256 = /^[a-f0-9]{64}$/;

export interface JudgeLimits {
  maxProviderCostUsd: number | null;
  maxProviderAttempts: number;
  maxWallTimeMs: number;
  maxFailureRate: number;
  minAttemptsForFailureRate: number;
  maxConsecutiveFailures: number;
}

export interface JudgePairInput {
  runAttemptId: string;
  bug: GroundTruthBug;
  finding: Finding;
  findingIndex: number;
  prompt: string;
}

export interface JudgeScheduledDecision {
  id: string;
  sequence: number;
  groundTruthSha256: string;
  findingEvidenceSha256: string;
  promptSha256: string;
  file: string;
}

export interface JudgeManifest {
  schemaVersion: 1;
  experimentId: string;
  experimentManifestSha256: string;
  experimentTerminalSealSha256: string;
  corpusSha256: string;
  judgeImplementationSha256: string;
  judgeConfigSha256: string;
  judge: typeof CODEX_SEMANTIC_JUDGE;
  providerAccess: "api-key" | "cli-session";
  limits: JudgeLimits;
  schedule: JudgeScheduledDecision[];
  manifestSha256: string;
}

export interface JudgeAttemptRecord {
  schemaVersion: 1;
  experimentId: string;
  judgeManifestSha256: string;
  decisionId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  providerCostUsd: number | null;
  usage: SemanticJudgeUsage;
  outcome:
    | { status: "completed"; verdict: "same-root-cause" | "different-root-cause" }
    | { status: "failed"; failureKind: NonNullable<SemanticJudgeDecision["failureKind"]> };
}

export interface JudgeRunResult {
  manifest: JudgeManifest;
  decisions: Array<{ comparisonId: string; decision: SemanticJudgeDecision }>;
  terminal: "completed" | "stopped";
}

export interface JudgeAccounting {
  providerAttempts: number;
  failures: number;
  durationMs: number;
  providerCostUsd: number;
  costUnavailableAttempts: number;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  turns: number | null;
  toolCalls: number | null;
}

export function buildJudgeManifest(input: {
  experimentId: string;
  experimentManifestSha256: string;
  experimentTerminalSealSha256: string;
  corpusSha256: string;
  judgeImplementationSha256: string;
  providerAccess: "api-key" | "cli-session";
  limits: JudgeLimits;
  pairs: readonly JudgePairInput[];
}): JudgeManifest {
  for (const [label, hash] of Object.entries({
    experimentManifestSha256: input.experimentManifestSha256,
    experimentTerminalSealSha256: input.experimentTerminalSealSha256,
    corpusSha256: input.corpusSha256,
    judgeImplementationSha256: input.judgeImplementationSha256,
  })) if (!SHA256.test(hash)) throw new Error(`${label} must be a SHA-256 digest`);
  const limits = parseJudgeLimits(input.limits);
  const judgeConfigSha256 = canonicalJsonSha256({ judge: CODEX_SEMANTIC_JUDGE, limits });
  const unique = new Map<string, Omit<JudgeScheduledDecision, "sequence">>();
  for (const pair of input.pairs) {
    const id = judgeComparisonId(pair, judgeConfigSha256);
    const item: Omit<JudgeScheduledDecision, "sequence"> = {
      id,
      groundTruthSha256: canonicalJsonSha256(pair.bug),
      findingEvidenceSha256: findingEvidenceSha256(pair.finding),
      promptSha256: sha256(pair.prompt),
      file: `judge/attempt-${id}.json`,
    };
    const prior = unique.get(id);
    if (prior && (prior.promptSha256 !== item.promptSha256 || prior.findingEvidenceSha256 !== item.findingEvidenceSha256)) {
      throw new Error("semantic comparison content-address collision");
    }
    unique.set(id, prior ?? item);
  }
  const schedule = [...unique.values()].sort((left, right) => left.id.localeCompare(right.id))
    .map((item, index) => ({ ...item, sequence: index + 1 }));
  const body = {
    schemaVersion: 1 as const,
    experimentId: bounded(input.experimentId, "experimentId"),
    experimentManifestSha256: input.experimentManifestSha256,
    experimentTerminalSealSha256: input.experimentTerminalSealSha256,
    corpusSha256: input.corpusSha256,
    judgeImplementationSha256: input.judgeImplementationSha256,
    judgeConfigSha256,
    judge: CODEX_SEMANTIC_JUDGE,
    providerAccess: input.providerAccess,
    limits,
    schedule,
  };
  return { ...body, manifestSha256: canonicalJsonSha256(body) };
}

export async function runJudgeLedger(input: {
  runDirectory: string;
  manifest: JudgeManifest;
  pairs: readonly JudgePairInput[];
  execute: SemanticJudgeExecutor;
  now?: () => string;
}): Promise<JudgeRunResult> {
  const root = resolve(input.runDirectory);
  const judgeRoot = join(root, JUDGE_DIRECTORY);
  const stateRoot = join(judgeRoot, "state");
  prepareDirectories(judgeRoot, stateRoot);
  const parsed = parseJudgeManifest(input.manifest);
  const pairById = new Map(input.pairs.map((pair) => [judgeComparisonId(pair, parsed.judgeConfigSha256), pair]));
  if (parsed.schedule.some((item) => !pairById.has(item.id)) || pairById.size !== parsed.schedule.length) {
    throw new Error("judge pairs do not match immutable deduplicated schedule");
  }
  const manifestPath = join(root, JUDGE_MANIFEST);
  if (existsSync(manifestPath)) {
    const existing = parseJudgeManifest(readJson(manifestPath));
    if (existing.manifestSha256 !== parsed.manifestSha256) throw new Error("judge manifest conflicts with existing immutable ledger");
  } else {
    writeExclusiveJson(root, manifestPath, parsed);
  }
  if (existsSync(join(root, JUDGE_TERMINAL_SEAL))) return readSealedJudgeLedger(root, parsed, input.pairs);
  assertUnsealedLedgerPrefix(root, parsed);

  const now = input.now ?? (() => new Date().toISOString());
  const attempts: JudgeAttemptRecord[] = [];
  let consecutiveFailures = 0;
  for (const scheduled of parsed.schedule) {
    const existingPath = join(root, scheduled.file);
    if (existsSync(existingPath)) {
      const record = parseAttempt(readJson(existingPath), scheduled, parsed);
      attempts.push(record);
      consecutiveFailures = record.outcome.status === "failed" ? consecutiveFailures + 1 : 0;
      continue;
    }
    const startedPath = join(stateRoot, `${scheduled.id}.started.json`);
    const providerStartedPath = join(stateRoot, `${scheduled.id}.provider-started.json`);
    const hasStarted = existsSync(startedPath);
    const hasProviderStarted = existsSync(providerStartedPath);
    if (hasProviderStarted && !hasStarted) throw new Error("judge provider-started marker is missing its started marker");
    if (hasStarted) {
      const startedAt = parseMarker(readJson(startedPath), parsed, scheduled, "started");
      const reason = hasProviderStarted ? "interrupted-provider-attempt" : "interrupted-before-provider-start";
      if (hasProviderStarted) {
        const providerStartedAt = parseMarker(readJson(providerStartedPath), parsed, scheduled, "provider-started");
        if (Date.parse(providerStartedAt) < Date.parse(startedAt)) throw new Error("judge marker timestamps are inconsistent");
      }
      writeStopAndSeal(root, parsed, reason, scheduled.id, attempts, now());
      return readSealedJudgeLedger(root, parsed, input.pairs);
    }
    const reason = ceilingReason(attempts, consecutiveFailures, parsed.limits);
    if (reason) {
      writeStopAndSeal(root, parsed, reason, scheduled.id, attempts, now());
      return readSealedJudgeLedger(root, parsed, input.pairs);
    }
    assertUnsealedLedgerPrefix(root, parsed);
    const startedAt = now();
    writeExclusiveJson(root, startedPath, {
      schemaVersion: 1, experimentId: parsed.experimentId, decisionId: scheduled.id, startedAt,
    });
    assertUnsealedLedgerPrefix(root, parsed);
    writeExclusiveJson(root, providerStartedPath, {
      schemaVersion: 1, experimentId: parsed.experimentId, decisionId: scheduled.id, providerStartedAt: now(),
    });
    assertUnsealedLedgerPrefix(root, parsed);
    let outcome: JudgeAttemptRecord["outcome"];
    let durationMs = 0;
    let providerCostUsd: number | null = null;
    let usage = unavailableJudgeUsage();
    const executionStarted = Date.now();
    try {
      const result = await input.execute(pairById.get(scheduled.id)!.prompt);
      durationMs = nonnegativeInteger(result.durationMs, "judge durationMs");
      providerCostUsd = nullableCost(result.providerCostUsd);
      usage = parseUsage(result.usage);
      outcome = { status: "completed", verdict: result.verdict ? "same-root-cause" : "different-root-cause" };
    } catch (error) {
      durationMs = error instanceof SemanticJudgeExecutionError ? error.durationMs : Date.now() - executionStarted;
      usage = error instanceof SemanticJudgeExecutionError ? error.usage : unavailableJudgeUsage();
      outcome = { status: "failed", failureKind: failureKind(error) };
    }
    const record: JudgeAttemptRecord = {
      schemaVersion: 1,
      experimentId: parsed.experimentId,
      judgeManifestSha256: parsed.manifestSha256,
      decisionId: scheduled.id,
      startedAt,
      finishedAt: now(),
      durationMs,
      providerCostUsd,
      usage,
      outcome,
    };
    writeExclusiveJson(root, existingPath, record);
    attempts.push(record);
    consecutiveFailures = outcome.status === "failed" ? consecutiveFailures + 1 : 0;
    if (outcome.status === "failed") {
      writeStopAndSeal(root, parsed, "required-comparison-failed", `after-${scheduled.id}`, attempts, now());
      return readSealedJudgeLedger(root, parsed, input.pairs);
    }
    if (parsed.limits.maxProviderCostUsd !== null && providerCostUsd === null) {
      writeStopAndSeal(root, parsed, "provider-cost-unavailable", `after-${scheduled.id}`, attempts, now());
      return readSealedJudgeLedger(root, parsed, input.pairs);
    }
  }
  writeSeal(root, parsed, "completed", attempts, now());
  return readSealedJudgeLedger(root, parsed, input.pairs);
}

export function readSealedJudgeLedger(
  runDirectory: string,
  expected: JudgeManifest,
  pairs: readonly JudgePairInput[],
): JudgeRunResult {
  const root = resolve(runDirectory);
  const manifest = parseJudgeManifest(readJson(join(root, JUDGE_MANIFEST)));
  if (manifest.manifestSha256 !== expected.manifestSha256) throw new Error("sealed judge manifest does not match expected judge identity");
  const seal = readJson(join(root, JUDGE_TERMINAL_SEAL)) as Record<string, unknown>;
  exactKeys(seal, ["schemaVersion", "terminal", "experimentId", "judgeManifestSha256", "sealedAt", "artifacts", "artifactsSha256", "sealSha256"], "judge terminal seal");
  if (seal.schemaVersion !== 1 || (seal.terminal !== "completed" && seal.terminal !== "stopped") ||
    seal.experimentId !== manifest.experimentId || seal.judgeManifestSha256 !== manifest.manifestSha256 || !Array.isArray(seal.artifacts)) {
    throw new Error("judge terminal seal is invalid");
  }
  const sealBody = { ...seal }; delete sealBody.sealSha256;
  if (seal.sealSha256 !== canonicalJsonSha256(sealBody)) throw new Error("judge terminal seal content address is invalid");
  const stop = seal.terminal === "stopped" ? parseStop(readJson(join(root, JUDGE_STOP)), manifest) : undefined;
  assertExactLedgerTree(root, manifest, seal.terminal, stop);
  const expectedArtifacts = [JUDGE_MANIFEST, ...manifest.schedule.flatMap((item) => [
    `judge/state/${item.id}.started.json`, `judge/state/${item.id}.provider-started.json`, item.file,
  ].filter((path) => existsSync(join(root, path)))), ...(existsSync(join(root, JUDGE_STOP)) ? [JUDGE_STOP] : [])].sort();
  const artifacts = seal.artifacts as Array<{ path?: unknown; sha256?: unknown }>;
  if (canonicalJsonSha256(artifacts) !== seal.artifactsSha256 || artifacts.length !== expectedArtifacts.length) {
    throw new Error("judge terminal seal artifact index is invalid");
  }
  for (const [index, path] of expectedArtifacts.entries()) {
    const artifact = artifacts[index];
    if (artifact && typeof artifact === "object") exactKeys(artifact as Record<string, unknown>, ["path", "sha256"], "judge sealed artifact");
    if (artifact?.path !== path || artifact.sha256 !== hashFile(join(root, path))) throw new Error("judge terminal seal artifact digest mismatch");
  }
  const pairById = new Map(pairs.map((pair) => [judgeComparisonId(pair, manifest.judgeConfigSha256), pair]));
  const decisions: Array<{ comparisonId: string; decision: SemanticJudgeDecision }> = [];
  for (const item of manifest.schedule) {
    if (!existsSync(join(root, item.file))) continue;
    const attempt = parseAttempt(readJson(join(root, item.file)), item, manifest);
    const pair = pairById.get(item.id);
    if (!pair) throw new Error("judge ledger has a decision outside the supplied pair schedule");
    decisions.push({ comparisonId: item.id, decision: semanticDecision(
      pair.bug,
      pair.finding,
      pair.findingIndex,
      attempt.outcome.status === "failed" ? "failed" : attempt.outcome.verdict,
      manifest.judgeConfigSha256,
      attempt.outcome.status === "failed" ? attempt.outcome.failureKind : undefined,
    ) });
  }
  if (seal.terminal === "completed" && decisions.length !== manifest.schedule.length) throw new Error("completed judge ledger is missing decisions");
  return { manifest, decisions, terminal: seal.terminal };
}

/** Reads only authenticated accounting; semantic inputs are not needed. */
export function readJudgeAccounting(runDirectory: string): JudgeAccounting {
  const root = resolve(runDirectory);
  const manifest = parseJudgeManifest(readJson(join(root, JUDGE_MANIFEST)));
  const seal = readJson(join(root, JUDGE_TERMINAL_SEAL)) as Record<string, unknown>;
  exactKeys(seal, ["schemaVersion", "terminal", "experimentId", "judgeManifestSha256", "sealedAt", "artifacts", "artifactsSha256", "sealSha256"], "judge terminal seal");
  if (seal.terminal !== "completed" || seal.judgeManifestSha256 !== manifest.manifestSha256 || !Array.isArray(seal.artifacts)) {
    throw new Error("definitive report requires a completed semantic judge ledger");
  }
  const sealBody = { ...seal }; delete sealBody.sealSha256;
  if (seal.sealSha256 !== canonicalJsonSha256(sealBody) || seal.artifactsSha256 !== canonicalJsonSha256(seal.artifacts)) {
    throw new Error("semantic judge terminal seal is not authenticated");
  }
  assertExactLedgerTree(root, manifest, "completed");
  const artifacts = seal.artifacts as Array<{ path?: unknown; sha256?: unknown }>;
  const expectedPaths = [JUDGE_MANIFEST, ...manifest.schedule.flatMap((item) => [
    `judge/state/${item.id}.started.json`, `judge/state/${item.id}.provider-started.json`, item.file,
  ])].sort();
  if (JSON.stringify(artifacts.map((item) => item.path)) !== JSON.stringify(expectedPaths)) throw new Error("semantic judge seal has an incomplete artifact index");
  for (const artifact of artifacts) {
    if (artifact && typeof artifact === "object") exactKeys(artifact as Record<string, unknown>, ["path", "sha256"], "judge sealed artifact");
    if (typeof artifact.path !== "string" || artifact.sha256 !== hashFile(join(root, artifact.path))) throw new Error("semantic judge accounting artifact digest mismatch");
  }
  const attempts = manifest.schedule.map((item) => parseAttempt(readJson(join(root, item.file)), item, manifest));
  if (attempts.some((item) => item.outcome.status === "failed")) throw new Error("failed required judge comparisons cannot produce a definitive report");
  const total = (field: keyof SemanticJudgeUsage): number | null => {
    const values = attempts.map((item) => item.usage[field]);
    return values.some((value) => value === null) ? null : (values as number[]).reduce((sum, value) => sum + value, 0);
  };
  return {
    providerAttempts: attempts.length,
    failures: 0,
    durationMs: attempts.reduce((sum, item) => sum + item.durationMs, 0),
    providerCostUsd: attempts.reduce((sum, item) => sum + (item.providerCostUsd ?? 0), 0),
    costUnavailableAttempts: attempts.filter((item) => item.providerCostUsd === null).length,
    inputTokens: total("inputTokens"), cachedInputTokens: total("cachedInputTokens"),
    outputTokens: total("outputTokens"), reasoningTokens: total("reasoningTokens"),
    turns: total("turns"), toolCalls: total("toolCalls"),
  };
}

function parseJudgeManifest(value: unknown): JudgeManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("judge manifest must be an object");
  const manifest = value as JudgeManifest;
  exactKeys(manifest as unknown as Record<string, unknown>, [
    "schemaVersion", "experimentId", "experimentManifestSha256", "experimentTerminalSealSha256",
    "corpusSha256", "judgeImplementationSha256", "judgeConfigSha256", "judge", "providerAccess",
    "limits", "schedule", "manifestSha256",
  ], "judge manifest");
  if (manifest.schemaVersion !== 1 || manifest.judge?.kind !== "codex" || manifest.judge.model !== CODEX_SEMANTIC_JUDGE.model ||
    manifest.judge.effort !== CODEX_SEMANTIC_JUDGE.effort || manifest.judge.version !== CODEX_SEMANTIC_JUDGE.version ||
    (manifest.providerAccess !== "api-key" && manifest.providerAccess !== "cli-session") || !Array.isArray(manifest.schedule)) {
    throw new Error("judge manifest has an unsupported identity or shape");
  }
  exactKeys(manifest.judge as unknown as Record<string, unknown>, ["kind", "model", "effort", "version"], "judge identity");
  exactKeys(manifest.limits as unknown as Record<string, unknown>, [
    "maxProviderCostUsd", "maxProviderAttempts", "maxWallTimeMs", "maxFailureRate",
    "minAttemptsForFailureRate", "maxConsecutiveFailures",
  ], "judge limits");
  const body = { ...manifest } as Record<string, unknown>;
  delete body.manifestSha256;
  if (!SHA256.test(manifest.manifestSha256) || canonicalJsonSha256(body) !== manifest.manifestSha256) {
    throw new Error("judge manifest content address is invalid");
  }
  for (const digest of [manifest.experimentManifestSha256, manifest.experimentTerminalSealSha256, manifest.corpusSha256, manifest.judgeImplementationSha256, manifest.judgeConfigSha256]) {
    if (!SHA256.test(digest)) throw new Error("judge manifest contains an invalid digest");
  }
  if (manifest.judgeConfigSha256 !== canonicalJsonSha256({ judge: CODEX_SEMANTIC_JUDGE, limits: parseJudgeLimits(manifest.limits) })) {
    throw new Error("judge manifest config fingerprint is invalid");
  }
  for (const [index, item] of manifest.schedule.entries()) {
    exactKeys(item as unknown as Record<string, unknown>, ["id", "sequence", "groundTruthSha256", "findingEvidenceSha256", "promptSha256", "file"], "judge schedule item");
    if (!SHA256.test(item.id) || item.sequence !== index + 1 || item.file !== `judge/attempt-${item.id}.json` ||
      !SHA256.test(item.promptSha256) || !SHA256.test(item.groundTruthSha256) ||
      !SHA256.test(item.findingEvidenceSha256)) throw new Error("judge schedule is invalid");
    if (index > 0 && manifest.schedule[index - 1]!.id.localeCompare(item.id) >= 0) throw new Error("judge schedule is not strictly content-address sorted");
  }
  return manifest;
}

function parseAttempt(value: unknown, scheduled: JudgeScheduledDecision, manifest: JudgeManifest): JudgeAttemptRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("judge attempt must be an object");
  const attempt = value as JudgeAttemptRecord;
  exactKeys(attempt as unknown as Record<string, unknown>, [
    "schemaVersion", "experimentId", "judgeManifestSha256", "decisionId", "startedAt", "finishedAt",
    "durationMs", "providerCostUsd", "usage", "outcome",
  ], "judge attempt");
  parseUsage(attempt.usage);
  if (attempt.outcome && typeof attempt.outcome === "object") {
    exactKeys(attempt.outcome as unknown as Record<string, unknown>,
      attempt.outcome.status === "completed" ? ["status", "verdict"] : ["status", "failureKind"], "judge attempt outcome");
  }
  if (attempt.schemaVersion !== 1 || attempt.experimentId !== manifest.experimentId ||
    attempt.judgeManifestSha256 !== manifest.manifestSha256 || attempt.decisionId !== scheduled.id ||
    !Number.isSafeInteger(attempt.durationMs) || attempt.durationMs < 0 ||
    (attempt.providerCostUsd !== null && (typeof attempt.providerCostUsd !== "number" || attempt.providerCostUsd < 0)) ||
    !attempt.outcome || (attempt.outcome.status !== "completed" && attempt.outcome.status !== "failed")) {
    throw new Error(`judge attempt ${scheduled.id} is invalid`);
  }
  if (attempt.outcome.status === "completed" && attempt.outcome.verdict !== "same-root-cause" && attempt.outcome.verdict !== "different-root-cause") {
    throw new Error(`judge attempt ${scheduled.id} verdict is invalid`);
  }
  if (attempt.outcome.status === "failed" && !["timeout", "provider", "parse", "configuration", "unknown"].includes(attempt.outcome.failureKind)) {
    throw new Error(`judge attempt ${scheduled.id} failure kind is invalid`);
  }
  if (Date.parse(attempt.finishedAt) < Date.parse(attempt.startedAt)) throw new Error(`judge attempt ${scheduled.id} timestamps are invalid`);
  return attempt;
}

function writeStopAndSeal(root: string, manifest: JudgeManifest, reason: string, beforeDecisionId: string, attempts: JudgeAttemptRecord[], now: string): void {
  writeExclusiveJson(root, join(root, JUDGE_STOP), {
    schemaVersion: 1, experimentId: manifest.experimentId, judgeManifestSha256: manifest.manifestSha256,
    reason, beforeDecisionId, observed: observed(attempts), recordedAt: now,
  });
  writeSeal(root, manifest, "stopped", attempts, now);
}

function writeSeal(root: string, manifest: JudgeManifest, terminal: "completed" | "stopped", attempts: JudgeAttemptRecord[], sealedAt: string): void {
  const artifacts = [JUDGE_MANIFEST, ...manifest.schedule.flatMap((item) => [
    `judge/state/${item.id}.started.json`, `judge/state/${item.id}.provider-started.json`, item.file,
  ].filter((path) => existsSync(join(root, path)))), ...(existsSync(join(root, JUDGE_STOP)) ? [JUDGE_STOP] : [])]
    .sort().map((path) => ({ path, sha256: hashFile(join(root, path)) }));
  const body = {
    schemaVersion: 1, terminal, experimentId: manifest.experimentId,
    judgeManifestSha256: manifest.manifestSha256, sealedAt, artifacts,
    artifactsSha256: canonicalJsonSha256(artifacts),
  };
  writeExclusiveJson(root, join(root, JUDGE_TERMINAL_SEAL), { ...body, sealSha256: canonicalJsonSha256(body) });
}

function ceilingReason(attempts: JudgeAttemptRecord[], consecutiveFailures: number, limits: JudgeLimits): string | undefined {
  const state = observed(attempts);
  if (state.providerAttempts >= limits.maxProviderAttempts) return "provider-attempt-ceiling";
  if (state.wallTimeMs >= limits.maxWallTimeMs) return "wall-time-ceiling";
  if (limits.maxProviderCostUsd !== null && state.providerCostUsd >= limits.maxProviderCostUsd) return "provider-cost-ceiling";
  if (consecutiveFailures >= limits.maxConsecutiveFailures) return "consecutive-failure-ceiling";
  if (attempts.length >= limits.minAttemptsForFailureRate && state.failureRate > limits.maxFailureRate) return "failure-rate-ceiling";
  return undefined;
}

function observed(attempts: JudgeAttemptRecord[]) {
  const failures = attempts.filter((item) => item.outcome.status === "failed").length;
  return {
    providerAttempts: attempts.length,
    failures,
    failureRate: attempts.length === 0 ? 0 : failures / attempts.length,
    wallTimeMs: attempts.reduce((sum, item) => sum + item.durationMs, 0),
    providerCostUsd: attempts.reduce((sum, item) => sum + (item.providerCostUsd ?? 0), 0),
    costUnavailableDecisionIds: attempts.filter((item) => item.providerCostUsd === null).map((item) => item.decisionId),
  };
}

function parseJudgeLimits(value: JudgeLimits): JudgeLimits {
  const parsed = { ...value };
  if (parsed.maxProviderCostUsd !== null && (!Number.isFinite(parsed.maxProviderCostUsd) || parsed.maxProviderCostUsd < 0)) throw new Error("invalid judge cost ceiling");
  for (const field of ["maxProviderAttempts", "maxWallTimeMs", "minAttemptsForFailureRate", "maxConsecutiveFailures"] as const) {
    if (!Number.isSafeInteger(parsed[field]) || parsed[field] < (field.startsWith("min") || field.startsWith("maxConsecutive") ? 1 : 0)) throw new Error(`invalid judge ${field}`);
  }
  if (!Number.isFinite(parsed.maxFailureRate) || parsed.maxFailureRate < 0 || parsed.maxFailureRate > 1) throw new Error("invalid judge failure-rate ceiling");
  return parsed;
}

function prepareDirectories(judgeRoot: string, stateRoot: string): void {
  if (!existsSync(judgeRoot)) mkdirSync(judgeRoot, { mode: 0o700 });
  if (!existsSync(stateRoot)) mkdirSync(stateRoot, { mode: 0o700 });
  for (const directory of [judgeRoot, stateRoot]) {
    const stat = lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("judge ledger directories must be real directories");
    if ((stat.mode & 0o077) !== 0) throw new Error("judge ledger directories must remain private");
  }
  for (const entry of readdirSync(judgeRoot)) {
    const path = join(judgeRoot, entry);
    if (lstatSync(path).isSymbolicLink()) throw new Error("judge ledger cannot contain symbolic links");
  }
}

function failureKind(error: unknown): NonNullable<SemanticJudgeDecision["failureKind"]> {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("timeout")) return "timeout";
  if (message.includes("parse")) return "parse";
  if (message.includes("config")) return "configuration";
  if (message.includes("provider")) return "provider";
  return "unknown";
}
function readJson(path: string): unknown {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error("judge artifact must be a bounded regular non-symlink file");
  return JSON.parse(readFileSync(path, "utf8"));
}
function hashFile(path: string): string {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("judge artifact must be a regular non-symlink file");
  return sha256(readFileSync(path));
}
function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function bounded(value: string, label: string): string { if (!value || value.length > 512) throw new Error(`${label} is invalid`); return value; }
function nonnegativeInteger(value: number, label: string): number { if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid`); return value; }
function nullableCost(value: number | null): number | null { if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error("judge provider cost is invalid"); return value; }

export function judgeComparisonId(pair: JudgePairInput, judgeConfigSha256: string): string {
  return canonicalJsonSha256({
    judgeVersion: CODEX_SEMANTIC_JUDGE.version,
    judgeConfigSha256,
    promptSha256: sha256(pair.prompt),
    groundTruthSha256: canonicalJsonSha256(pair.bug),
    findingEvidenceSha256: findingEvidenceSha256(pair.finding),
  });
}

function parseUsage(value: SemanticJudgeUsage): SemanticJudgeUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("judge usage is invalid");
  exactKeys(value as unknown as Record<string, unknown>, ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningTokens", "turns", "toolCalls"], "judge usage");
  const output = { ...value };
  for (const [key, metric] of Object.entries(output)) {
    if (metric !== null && (!Number.isSafeInteger(metric) || metric < 0)) throw new Error(`judge usage ${key} is invalid`);
  }
  return output;
}

function assertUnsealedLedgerPrefix(root: string, manifest: JudgeManifest): void {
  const judgeRoot = join(root, JUDGE_DIRECTORY);
  const expected = new Set<string>(["manifest.json", "state"]);
  let sawGap = false;
  let sawPartial = false;
  for (const item of manifest.schedule) {
    const attemptPath = item.file.slice("judge/".length);
    const started = `state/${item.id}.started.json`;
    const provider = `state/${item.id}.provider-started.json`;
    const present = [started, provider, attemptPath].map((path) => existsSync(join(judgeRoot, path)));
    if (present[2] && (!present[0] || !present[1])) throw new Error("judge attempt is missing marker evidence");
    if (present[1] && !present[0]) throw new Error("judge provider-started marker is missing its started marker");
    if (present[2]) {
      if (sawGap || sawPartial) throw new Error("judge ledger contains evidence after a schedule gap");
      expected.add(attemptPath); expected.add(started); expected.add(provider);
      const startedAt = parseMarker(readJson(join(judgeRoot, started)), manifest, item, "started");
      const providerStartedAt = parseMarker(readJson(join(judgeRoot, provider)), manifest, item, "provider-started");
      const attempt = parseAttempt(readJson(join(judgeRoot, attemptPath)), item, manifest);
      if (attempt.startedAt !== startedAt || Date.parse(providerStartedAt) < Date.parse(startedAt) || Date.parse(attempt.finishedAt) < Date.parse(providerStartedAt)) {
        throw new Error("judge marker and attempt timestamps are inconsistent");
      }
    } else if (present[0]) {
      if (sawGap || sawPartial) throw new Error("judge ledger contains interrupted evidence after a schedule gap");
      expected.add(started);
      const startedAt = parseMarker(readJson(join(judgeRoot, started)), manifest, item, "started");
      if (present[1]) {
        expected.add(provider);
        const providerStartedAt = parseMarker(readJson(join(judgeRoot, provider)), manifest, item, "provider-started");
        if (Date.parse(providerStartedAt) < Date.parse(startedAt)) throw new Error("judge marker timestamps are inconsistent");
      }
      sawPartial = true;
      sawGap = true;
    } else {
      sawGap = true;
    }
  }
  assertObservedJudgeTree(judgeRoot, expected);
}

function assertExactLedgerTree(
  root: string,
  manifest: JudgeManifest,
  terminal: unknown,
  stop?: { reason: string; beforeDecisionId: string },
): void {
  const judgeRoot = join(root, JUDGE_DIRECTORY);
  const expected = new Set<string>(["manifest.json", "terminal-seal.json", "state"]);
  let sawGap = false;
  let interruptedDecisionId: string | undefined;
  for (const item of manifest.schedule) {
    const attemptPath = item.file.slice("judge/".length);
    const started = `state/${item.id}.started.json`;
    const provider = `state/${item.id}.provider-started.json`;
    const [hasAttempt, hasStarted, hasProviderStarted] = [attemptPath, started, provider]
      .map((path) => existsSync(join(judgeRoot, path)));
    if (hasAttempt && (!hasStarted || !hasProviderStarted)) throw new Error("judge attempt is missing marker evidence");
    if (hasProviderStarted && !hasStarted) throw new Error("judge provider-started marker is missing its started marker");
    if (hasStarted && !hasAttempt) {
      const expectedReason = hasProviderStarted ? "interrupted-provider-attempt" : "interrupted-before-provider-start";
      if (terminal !== "stopped" || sawGap || interruptedDecisionId || stop?.reason !== expectedReason || stop?.beforeDecisionId !== item.id) {
        throw new Error("judge ledger contains unauthenticated interrupted marker evidence");
      }
      expected.add(started);
      const startedAt = parseMarker(readJson(join(judgeRoot, started)), manifest, item, "started");
      if (hasProviderStarted) {
        expected.add(provider);
        const providerStartedAt = parseMarker(readJson(join(judgeRoot, provider)), manifest, item, "provider-started");
        if (Date.parse(providerStartedAt) < Date.parse(startedAt)) throw new Error("judge marker timestamps are inconsistent");
      }
      interruptedDecisionId = item.id;
      sawGap = true;
    } else if (!hasAttempt) sawGap = true;
    else {
      if (sawGap) throw new Error("judge ledger contains evidence after a schedule gap");
      expected.add(attemptPath); expected.add(started); expected.add(provider);
      const startedAt = parseMarker(readJson(join(judgeRoot, started)), manifest, item, "started");
      const providerStartedAt = parseMarker(readJson(join(judgeRoot, provider)), manifest, item, "provider-started");
      const attempt = parseAttempt(readJson(join(judgeRoot, attemptPath)), item, manifest);
      if (attempt.startedAt !== startedAt || Date.parse(providerStartedAt) < Date.parse(startedAt) || Date.parse(attempt.finishedAt) < Date.parse(providerStartedAt)) {
        throw new Error("judge marker and attempt timestamps are inconsistent");
      }
    }
  }
  if (terminal === "completed" && sawGap) throw new Error("completed judge ledger is missing scheduled evidence");
  if (terminal === "stopped" && stop?.reason.startsWith("interrupted-") && interruptedDecisionId !== stop.beforeDecisionId) {
    throw new Error("judge interruption stop is missing its marker evidence");
  }
  if (terminal === "stopped") expected.add("stop.json");
  assertObservedJudgeTree(judgeRoot, expected);
}

function assertObservedJudgeTree(judgeRoot: string, expected: Set<string>): void {
  const observed = new Set<string>(["state"]);
  const visit = (directory: string, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error("judge ledger contains a symlink or special artifact");
      if (entry.isDirectory()) visit(path, relative); else observed.add(relative);
    }
  };
  visit(judgeRoot);
  if (JSON.stringify([...observed].sort()) !== JSON.stringify([...expected].sort())) throw new Error("judge ledger tree contains extra or missing artifacts");
}

function parseMarker(value: unknown, manifest: JudgeManifest, item: JudgeScheduledDecision, kind: "started" | "provider-started"): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("judge marker is invalid");
  const marker = value as Record<string, unknown>;
  const timestamp = kind === "started" ? "startedAt" : "providerStartedAt";
  exactKeys(marker, ["schemaVersion", "experimentId", "decisionId", timestamp], "judge marker");
  if (marker.schemaVersion !== 1 || marker.experimentId !== manifest.experimentId || marker.decisionId !== item.id ||
    typeof marker[timestamp] !== "string" || !Number.isFinite(Date.parse(marker[timestamp] as string))) throw new Error("judge marker is invalid");
  return marker[timestamp] as string;
}

function parseStop(value: unknown, manifest: JudgeManifest): { reason: string; beforeDecisionId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("judge stop is invalid");
  const stop = value as Record<string, unknown>;
  exactKeys(stop, ["schemaVersion", "experimentId", "judgeManifestSha256", "reason", "beforeDecisionId", "observed", "recordedAt"], "judge stop");
  const reasons = [
    "provider-attempt-ceiling", "provider-cost-unavailable", "provider-cost-ceiling", "wall-time-ceiling",
    "failure-rate-ceiling", "consecutive-failure-ceiling", "required-comparison-failed",
    "interrupted-before-provider-start", "interrupted-provider-attempt",
  ];
  if (stop.schemaVersion !== 1 || stop.experimentId !== manifest.experimentId || stop.judgeManifestSha256 !== manifest.manifestSha256 ||
    !reasons.includes(String(stop.reason)) || typeof stop.beforeDecisionId !== "string" || typeof stop.recordedAt !== "string" || !Number.isFinite(Date.parse(stop.recordedAt))) throw new Error("judge stop is invalid");
  if (!stop.observed || typeof stop.observed !== "object" || Array.isArray(stop.observed)) throw new Error("judge stop observed state is invalid");
  exactKeys(stop.observed as Record<string, unknown>, ["providerAttempts", "failures", "failureRate", "wallTimeMs", "providerCostUsd", "costUnavailableDecisionIds"], "judge stop observed state");
  const observed = stop.observed as Record<string, unknown>;
  for (const field of ["providerAttempts", "failures", "wallTimeMs"] as const) {
    if (!Number.isSafeInteger(observed[field]) || (observed[field] as number) < 0) throw new Error("judge stop observed state is invalid");
  }
  if (typeof observed.failureRate !== "number" || observed.failureRate < 0 || observed.failureRate > 1 ||
    typeof observed.providerCostUsd !== "number" || observed.providerCostUsd < 0 || !Array.isArray(observed.costUnavailableDecisionIds)) {
    throw new Error("judge stop observed state is invalid");
  }
  return { reason: String(stop.reason), beforeDecisionId: stop.beforeDecisionId as string };
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = [...keys].sort(); const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} has unsupported or missing fields`);
}
