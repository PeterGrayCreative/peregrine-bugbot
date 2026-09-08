import { join } from "node:path";
import { assertNoSecrets } from "../src/security/secrets.js";
import { RUN_FAILURE_KINDS } from "../src/core/run-failure.js";
import { parseBreadthResult } from "../src/core/breadth-result.js";
import { combineUsage, parseUsage, sha256 } from "../src/core/telemetry.js";
import { canonicalJson, canonicalJsonSha256, readExperimentJson, writeExclusiveJson } from "./experiment.js";
import { readMethodologyInvocation, readMethodologyInvocationRegistration } from "./methodology-invocations.js";
import { parseMethodologyDiscoveryOutput, parseMethodologyReviewOutput } from "./methodology-output.js";
import type { MethodologyAttemptResult } from "./methodology-runner.js";

interface MethodologyTerminalRecord {
  schemaVersion: 1;
  kind: "methodology-attempt-terminal";
  registrationSha256: string;
  result: MethodologyAttemptResult;
  recordSha256: string;
}

/** Retain the returned digest in the outer run seal; local hashes are not signatures. */
export function writeMethodologyAttemptTerminal(root: string, registrationSha256: string,
  result: MethodologyAttemptResult): string {
  validateResult(root, registrationSha256, result);
  const body = { schemaVersion: 1 as const, kind: "methodology-attempt-terminal" as const,
    registrationSha256, result };
  const record = { ...body, recordSha256: canonicalJsonSha256(body) };
  assertNoSecrets(record, "methodology terminal record");
  writeExclusiveJson(root, join(root, filename(result.attempt.id)), record);
  return record.recordSha256;
}

export function readMethodologyAttemptTerminal(root: string, registrationSha256: string,
  attemptId: string, expectedRecordSha256: string): MethodologyAttemptResult {
  const record = readExperimentJson(join(root, filename(attemptId))) as MethodologyTerminalRecord;
  if (!record || canonicalJson(Object.keys(record).sort()) !== canonicalJson([
    "kind", "recordSha256", "registrationSha256", "result", "schemaVersion",
  ]) || record.schemaVersion !== 1 || record.kind !== "methodology-attempt-terminal" ||
      record.registrationSha256 !== registrationSha256 || record.result?.attempt?.id !== attemptId) {
    throw new Error("methodology terminal identity mismatch");
  }
  const { recordSha256, ...body } = record;
  if (!/^[a-f0-9]{64}$/.test(expectedRecordSha256) || recordSha256 !== expectedRecordSha256 ||
      recordSha256 !== canonicalJsonSha256(body)) throw new Error("methodology terminal digest mismatch");
  validateResult(root, registrationSha256, record.result);
  assertNoSecrets(record, "methodology terminal record");
  return record.result;
}

function validateResult(root: string, registrationSha256: string, result: MethodologyAttemptResult): void {
  onlyKeys(result, ["schemaVersion", "protocol", "attempt", "model", "effort", "durationMs", "usage",
    "stages", "intentReceipts", "scope", "outcome"]);
  const registration = readMethodologyInvocationRegistration(root, registrationSha256);
  const scheduled = registration.schedule.attempts.find((attempt) => attempt.id === result?.attempt?.id);
  if (!scheduled || canonicalJson(scheduled) !== canonicalJson(result.attempt) || result.schemaVersion !== 1 ||
      result.protocol !== "historical-methodology-run-v1" || result.model !== "gpt-5.6-sol" || result.effort !== "high") {
    throw new Error("methodology terminal schedule identity mismatch");
  }
  finiteDuration(result.durationMs);
  if (!Array.isArray(result.intentReceipts) || !Array.isArray(result.stages) ||
      result.intentReceipts.length > scheduled.expectedStages || result.stages.length > result.intentReceipts.length) {
    throw new Error("methodology terminal invocation count mismatch");
  }
  const inputs = result.intentReceipts.map((receipt, index) => {
    onlyKeys(receipt, ["stageIndex", "invocationSha256"]);
    if (receipt.stageIndex !== index + 1) throw new Error("methodology terminal receipt sequence mismatch");
    return readMethodologyInvocation(root, registrationSha256, scheduled.id, receipt.stageIndex, receipt.invocationSha256);
  });
  if (inputs.length === 2 && !result.stages[0]?.telemetry.completed) {
    throw new Error("methodology second invocation lacks a completed predecessor");
  }
  const limitations: MethodologyAttemptResult["scope"]["modelLimitations"] = [];
  for (const [index, stage] of result.stages.entries()) {
    onlyKeys(stage, ["stageIndex", "stage", "invocationSha256", "compiled", "assetsTreeSha256",
      "schemaSha256", "appliedTimeoutMs", "telemetry", "rawOutputSha256", "rawOutput"],
    ["rawOutputOmittedReason", "containmentCleanupFailed"]);
    const input = inputs[index];
    if (!input || stage.stageIndex !== index + 1 || stage.invocationSha256 !== input.recordSha256 ||
        canonicalJson(stage.compiled) !== canonicalJson(input.input.compiled) || stage.stage !== stage.compiled.stage ||
        stage.assetsTreeSha256 !== input.input.assets.treeSha256 || stage.schemaSha256 !== sha256(input.input.schemaText)) {
      throw new Error("methodology terminal stage input mismatch");
    }
    const telemetry = stage.telemetry;
    onlyKeys(telemetry, ["stage", "model", "promptSha256", "usage", "durationMs", "completed"]);
    if (!telemetry || telemetry.model !== "gpt-5.6-sol" || telemetry.promptSha256 !== stage.compiled.promptSha256 ||
        telemetry.stage !== (stage.stage === "discovery" ? "breadth" : "investigation") || typeof telemetry.completed !== "boolean") {
      throw new Error("methodology terminal telemetry identity mismatch");
    }
    parseUsage(telemetry.usage, "methodology stage usage");
    finiteDuration(telemetry.durationMs);
    finiteDuration(stage.appliedTimeoutMs);
    if (stage.appliedTimeoutMs <= 0 || stage.appliedTimeoutMs > input.input.stageMaximumMs ||
        stage.appliedTimeoutMs > Date.parse(input.input.attemptDeadlineAt) - Date.parse(input.input.requestedAt)) {
      throw new Error("methodology terminal applied timeout exceeds intent ceiling");
    }
    if (stage.rawOutput === null ? stage.rawOutputSha256 !== null || telemetry.completed :
        typeof stage.rawOutput !== "string" || sha256(stage.rawOutput) !== stage.rawOutputSha256) {
      throw new Error("methodology terminal raw output digest mismatch");
    }
    if ((stage.containmentCleanupFailed !== undefined && stage.containmentCleanupFailed !== true) ||
        (stage.rawOutputOmittedReason !== undefined &&
          (stage.rawOutputOmittedReason !== "secret-unsafe" || stage.rawOutput !== null))) {
      throw new Error("methodology terminal output/cleanup restriction is invalid");
    }
    if (index === 0 && inputs[1] && (stage.rawOutput === null || inputs[1].input.previousOutput !== stage.rawOutput)) {
      throw new Error("methodology terminal handoff differs from actual first-stage output");
    }
    if (stage.rawOutput !== null) {
      try {
        const raw: unknown = JSON.parse(stage.rawOutput);
        const details = stage.stage === "review" ? parseMethodologyReviewOutput(raw).limitations
          : scheduled.armId === "C" ? parseMethodologyDiscoveryOutput(raw).limitations
            : parseBreadthResult(raw, "methodology terminal breadth").coverage.unavailable;
        limitations.push(...details.map((detail) => ({ source: "model" as const, stage: stage.stage, detail })));
      } catch (error) {
        if (stage.telemetry.completed) throw error;
      }
    }
  }
  const expectedUsage = result.stages.length ? JSON.parse(JSON.stringify(
    combineUsage(...result.stages.map((stage) => stage.telemetry.usage)))) : null;
  if (canonicalJson(result.usage) !== canonicalJson(expectedUsage)) throw new Error("methodology terminal usage differs from stages");
  onlyKeys(result.scope, ["status", "meaning", "modelLimitations"]);
  if (result.scope?.status !== "unverified" || result.scope.meaning !== "runner-availability-not-authenticated" ||
      !Array.isArray(result.scope.modelLimitations)) throw new Error("methodology terminal cannot assert verified scope");
  if (canonicalJson(limitations) !== canonicalJson(result.scope.modelLimitations)) {
    throw new Error("methodology terminal scope limitations differ from outputs");
  }
  const allStagesCompleted = result.stages.length === scheduled.expectedStages && result.stages.every((stage) =>
    stage.telemetry.completed && !stage.containmentCleanupFailed && stage.rawOutput !== null);
  if (result.outcome?.status === "completed") {
    onlyKeys(result.outcome, ["status", "review"]);
    if (!allStagesCompleted) {
      throw new Error("methodology terminal completion lacks completed stages");
    }
    const review = parseMethodologyReviewOutput(JSON.parse(result.stages.at(-1)!.rawOutput!));
    if (canonicalJson(review) !== canonicalJson(result.outcome.review)) throw new Error("methodology terminal review differs from output");
  } else if (result.outcome?.status !== "failed" || !RUN_FAILURE_KINDS.includes(result.outcome.failureKind) ||
      typeof result.outcome.message !== "string") {
    throw new Error("methodology terminal outcome is invalid");
  } else {
    onlyKeys(result.outcome, ["status", "failureKind", "message"]);
    if (allStagesCompleted) throw new Error("methodology terminal cannot relabel completed stages as failed");
  }
}

function filename(attemptId: string): string {
  if (!/^attempt-[0-9]{6}$/.test(attemptId)) throw new Error("invalid methodology terminal path");
  return `${attemptId}.methodology-terminal.json`;
}
function finiteDuration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("methodology duration must be a nonnegative integer");
}
function onlyKeys(value: unknown, expected: string[], optional: string[] = []): void {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      expected.some((key) => !Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !expected.includes(key) && !optional.includes(key))) {
    throw new Error("methodology terminal has invalid fields");
  }
}
