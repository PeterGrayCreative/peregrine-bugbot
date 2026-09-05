import { join } from "node:path";
import { RUN_FAILURE_KINDS, runFailureKind, type RunFailureKind } from "../src/core/run-failure.js";
import { assertNoSecrets, safeDiagnostic } from "../src/security/secrets.js";
import type { ProviderExec, ReviewContext } from "../src/types.js";
import type { LeakagePolicy } from "./case-isolation.js";
import {
  canonicalJson,
  canonicalJsonSha256,
  readExperimentJson,
  writeExclusiveJson,
} from "./experiment.js";
import {
  readMethodologyInvocation,
  readMethodologyInvocationRegistration,
} from "./methodology-invocations.js";
import {
  runMethodologyAttempt,
  type MethodologyBeforeInvocation,
} from "./methodology-runner.js";
import { readMethodologyAttemptTerminal, writeMethodologyAttemptTerminal } from "./methodology-terminal.js";

const SHA256 = /^[a-f0-9]{64}$/;

export interface MethodologyAttemptPreparation {
  assetManifest: unknown;
  rawScope: unknown;
  activatedLanes?: unknown;
  leakagePolicy: LeakagePolicy;
  context: ReviewContext;
}

export interface MethodologyAttemptLifecycleInput {
  evidenceRoot: string;
  registrationSha256: string;
  attemptId: string;
  /** Called only after the immutable start record exists. */
  prepare: () => MethodologyAttemptPreparation | Promise<MethodologyAttemptPreparation>;
  /** Existing invocation-plan recorder; this wrapper does not create or replace it. */
  beforeInvocation: MethodologyBeforeInvocation;
  now?: () => number;
}

export interface MethodologyAttemptStartRecord {
  schemaVersion: 1;
  kind: "methodology-attempt-start";
  registrationSha256: string;
  attemptId: string;
  scheduledAttemptSha256: string;
  startedAt: string;
  recordSha256: string;
}

export interface MethodologyDispatchStartedRecord {
  schemaVersion: 1;
  kind: "methodology-stage-dispatch-started";
  registrationSha256: string;
  attemptId: string;
  stageIndex: 1 | 2;
  invocationSha256: string;
  startSha256: string;
  dispatchStartedAt: string;
  providerContact: "not-established-by-dispatch-start";
  recordSha256: string;
}

export interface MethodologyDispatchReceipt {
  stageIndex: 1 | 2;
  dispatchSha256: string;
}

export interface MethodologyLifecycleFailure {
  kind: RunFailureKind;
  message: string;
}

export interface MethodologyAttemptLifecycleTerminalRecord {
  schemaVersion: 1;
  kind: "methodology-attempt-lifecycle-terminal";
  registrationSha256: string;
  attemptId: string;
  startSha256: string;
  status: "review-terminal" | "preflight-failed" | "interrupted";
  dispatchReceipts: MethodologyDispatchReceipt[];
  reviewTerminalSha256: string | null;
  failure: MethodologyLifecycleFailure | null;
  finishedAt: string;
  providerContact: "not-established-by-lifecycle";
  recordSha256: string;
}

export interface MethodologyAttemptLifecycleReceipt {
  startSha256: string;
  lifecycleTerminalSha256: string;
  dispatchReceipts: MethodologyDispatchReceipt[];
  reviewTerminalSha256: string | null;
  status: MethodologyAttemptLifecycleTerminalRecord["status"];
}

/**
 * Adds durable attempt/dispatch lifecycle evidence around the existing runner.
 * A dispatch-start record proves only that the runner reached ProviderExec; it
 * does not prove provider contact, model identity, or successful execution.
 */
export async function runMethodologyAttemptLifecycle(
  input: MethodologyAttemptLifecycleInput,
): Promise<MethodologyAttemptLifecycleReceipt> {
  const registration = readMethodologyInvocationRegistration(input.evidenceRoot, input.registrationSha256);
  const attempt = registration.schedule.attempts.find((item) => item.id === input.attemptId);
  if (!attempt) throw new Error("methodology lifecycle attempt is not registered");
  if (typeof input.prepare !== "function" || typeof input.beforeInvocation !== "function") {
    throw new Error("methodology lifecycle callbacks are required");
  }
  const now = input.now ?? Date.now;
  const start = writeStart(input.evidenceRoot, input.registrationSha256, attempt, timestamp(now()));
  const dispatchReceipts: MethodologyDispatchReceipt[] = [];
  let pendingInvocation: { stageIndex: 1 | 2; invocationSha256: string } | null = null;

  try {
    const prepared = await input.prepare();
    const isolation = prepared.context.evaluationIsolation;
    const underlyingProvider = isolation?.runProvider;
    if (!isolation || typeof underlyingProvider !== "function") {
      throw new Error("methodology lifecycle preparation requires an isolated ProviderExec");
    }
    const beforeInvocation: MethodologyBeforeInvocation = async (invocation) => {
      if (pendingInvocation !== null) {
        throw new Error("methodology lifecycle has an undispatched invocation intent");
      }
      const invocationSha256 = await input.beforeInvocation(invocation);
      if (!isSha256(invocationSha256)) {
        throw new Error("methodology lifecycle invocation callback returned an invalid digest");
      }
      readMethodologyInvocation(
        input.evidenceRoot,
        input.registrationSha256,
        input.attemptId,
        invocation.stageIndex,
        invocationSha256,
      );
      pendingInvocation = { stageIndex: invocation.stageIndex, invocationSha256 };
      return invocationSha256;
    };
    const runProvider: ProviderExec = async (command, args, options) => {
      if (!pendingInvocation) throw new Error("methodology provider dispatch lacks a sealed invocation intent");
      const pending = pendingInvocation;
      const dispatch = writeDispatch(input.evidenceRoot, input.registrationSha256, input.attemptId,
        start.recordSha256, pending.stageIndex, pending.invocationSha256, timestamp(now()));
      dispatchReceipts.push({ stageIndex: pending.stageIndex, dispatchSha256: dispatch.recordSha256 });
      pendingInvocation = null;
      return underlyingProvider(command, args, options);
    };
    const result = await runMethodologyAttempt({
      schedule: registration.schedule,
      attemptId: input.attemptId,
      assetManifest: prepared.assetManifest,
      rawScope: prepared.rawScope,
      ...(prepared.activatedLanes === undefined ? {} : { activatedLanes: prepared.activatedLanes }),
      leakagePolicy: prepared.leakagePolicy,
      context: {
        ...prepared.context,
        evaluationIsolation: { ...isolation, runProvider },
      },
      beforeInvocation,
      now,
    });
    const reviewTerminalSha256 = writeMethodologyAttemptTerminal(
      input.evidenceRoot,
      input.registrationSha256,
      result,
    );
    const terminal = writeLifecycleTerminal(input.evidenceRoot, {
      registrationSha256: input.registrationSha256,
      attemptId: input.attemptId,
      startSha256: start.recordSha256,
      status: "review-terminal",
      dispatchReceipts,
      reviewTerminalSha256,
      failure: null,
      finishedAt: timestamp(now()),
    });
    return receipt(terminal);
  } catch (error) {
    const terminal = writeLifecycleTerminal(input.evidenceRoot, {
      registrationSha256: input.registrationSha256,
      attemptId: input.attemptId,
      startSha256: start.recordSha256,
      status: dispatchReceipts.length === 0 ? "preflight-failed" : "interrupted",
      dispatchReceipts,
      reviewTerminalSha256: null,
      failure: { kind: runFailureKind(error), message: safeDiagnostic(
        error instanceof Error ? error.message : "methodology lifecycle failed",
      ) },
      finishedAt: timestamp(now()),
    });
    return receipt(terminal);
  }
}

export function readMethodologyAttemptStart(
  root: string,
  registrationSha256: string,
  attemptId: string,
  expectedSha256: string,
): MethodologyAttemptStartRecord {
  readRegisteredAttempt(root, registrationSha256, attemptId);
  const record = readExperimentJson(join(root, startFilename(attemptId))) as MethodologyAttemptStartRecord;
  strictKeys(record, ["schemaVersion", "kind", "registrationSha256", "attemptId",
    "scheduledAttemptSha256", "startedAt", "recordSha256"]);
  const attempt = readRegisteredAttempt(root, registrationSha256, attemptId);
  if (record.schemaVersion !== 1 || record.kind !== "methodology-attempt-start" ||
      record.registrationSha256 !== registrationSha256 || record.attemptId !== attemptId ||
      record.scheduledAttemptSha256 !== canonicalJsonSha256(attempt) ||
      !validTimestamp(record.startedAt)) {
    throw new Error("methodology lifecycle start identity is invalid");
  }
  verifyDigest(record, expectedSha256, "methodology lifecycle start");
  assertNoSecrets(record, "methodology lifecycle start");
  return record;
}

export function readMethodologyDispatchStarted(
  root: string,
  registrationSha256: string,
  attemptId: string,
  stageIndex: 1 | 2,
  expectedSha256: string,
): MethodologyDispatchStartedRecord {
  const record = readExperimentJson(join(root, dispatchFilename(attemptId, stageIndex))) as MethodologyDispatchStartedRecord;
  strictKeys(record, ["schemaVersion", "kind", "registrationSha256", "attemptId", "stageIndex",
    "invocationSha256", "startSha256", "dispatchStartedAt", "providerContact", "recordSha256"]);
  if (record.schemaVersion !== 1 || record.kind !== "methodology-stage-dispatch-started" ||
      record.registrationSha256 !== registrationSha256 || record.attemptId !== attemptId ||
      record.stageIndex !== stageIndex || !isSha256(record.invocationSha256) || !isSha256(record.startSha256) ||
      !validTimestamp(record.dispatchStartedAt) || record.providerContact !== "not-established-by-dispatch-start") {
    throw new Error("methodology dispatch-start identity is invalid");
  }
  verifyDigest(record, expectedSha256, "methodology dispatch-start");
  const start = readMethodologyAttemptStart(root, registrationSha256, attemptId, record.startSha256);
  if (Date.parse(record.dispatchStartedAt) < Date.parse(start.startedAt)) {
    throw new Error("methodology dispatch-start precedes attempt start");
  }
  readMethodologyInvocation(root, registrationSha256, attemptId, stageIndex, record.invocationSha256);
  assertNoSecrets(record, "methodology dispatch-start");
  return record;
}

export function readMethodologyAttemptLifecycleTerminal(
  root: string,
  registrationSha256: string,
  attemptId: string,
  expectedSha256: string,
): MethodologyAttemptLifecycleTerminalRecord {
  const record = readExperimentJson(join(root, lifecycleFilename(attemptId))) as MethodologyAttemptLifecycleTerminalRecord;
  strictKeys(record, ["schemaVersion", "kind", "registrationSha256", "attemptId", "startSha256", "status",
    "dispatchReceipts", "reviewTerminalSha256", "failure", "finishedAt", "providerContact", "recordSha256"]);
  if (record.schemaVersion !== 1 || record.kind !== "methodology-attempt-lifecycle-terminal" ||
      record.registrationSha256 !== registrationSha256 || record.attemptId !== attemptId ||
      !isSha256(record.startSha256) || !validTimestamp(record.finishedAt) ||
      record.providerContact !== "not-established-by-lifecycle") {
    throw new Error("methodology lifecycle terminal identity is invalid");
  }
  verifyDigest(record, expectedSha256, "methodology lifecycle terminal");
  const start = readMethodologyAttemptStart(root, registrationSha256, attemptId, record.startSha256);
  if (Date.parse(record.finishedAt) < Date.parse(start.startedAt)) {
    throw new Error("methodology lifecycle terminal precedes attempt start");
  }
  const dispatchReceipts = parseDispatchReceipts(record.dispatchReceipts);
  const dispatchRecords = dispatchReceipts.map((dispatch) =>
    readMethodologyDispatchStarted(root, registrationSha256, attemptId,
      dispatch.stageIndex, dispatch.dispatchSha256));
  if (record.status === "review-terminal") {
    if (!isSha256(record.reviewTerminalSha256) || record.failure !== null) {
      throw new Error("methodology review-terminal lifecycle outcome is invalid");
    }
    const result = readMethodologyAttemptTerminal(
      root,
      registrationSha256,
      attemptId,
      record.reviewTerminalSha256,
    );
    const intendedPrefix = result.intentReceipts.slice(0, dispatchRecords.length);
    const dispatchesMatchIntents = dispatchRecords.every((dispatch, index) => {
      const intent = intendedPrefix[index];
      return intent?.stageIndex === dispatch.stageIndex &&
        intent.invocationSha256 === dispatch.invocationSha256;
    });
    if (!dispatchesMatchIntents ||
        (result.outcome.status === "completed" && dispatchRecords.length !== result.intentReceipts.length)) {
      throw new Error("methodology lifecycle dispatches do not match terminal invocation intents");
    }
  } else if (record.status === "preflight-failed" || record.status === "interrupted") {
    if (record.reviewTerminalSha256 !== null || !validFailure(record.failure) ||
        (record.status === "preflight-failed") !== (dispatchReceipts.length === 0)) {
      throw new Error("methodology failed lifecycle outcome is invalid");
    }
  } else {
    throw new Error("methodology lifecycle terminal status is invalid");
  }
  assertNoSecrets(record, "methodology lifecycle terminal");
  return { ...record, dispatchReceipts };
}

function writeStart(root: string, registrationSha256: string, attempt: object,
  startedAt: string): MethodologyAttemptStartRecord {
  const attemptId = (attempt as { id?: unknown }).id;
  if (typeof attemptId !== "string") throw new Error("methodology lifecycle scheduled attempt lacks an id");
  const body = { schemaVersion: 1 as const, kind: "methodology-attempt-start" as const,
    registrationSha256, attemptId, scheduledAttemptSha256: canonicalJsonSha256(attempt), startedAt };
  const record = { ...body, recordSha256: canonicalJsonSha256(body) };
  assertNoSecrets(record, "methodology lifecycle start");
  writeExclusiveJson(root, join(root, startFilename(attemptId)), record);
  return record;
}

function writeDispatch(root: string, registrationSha256: string, attemptId: string,
  startSha256: string, stageIndex: 1 | 2, invocationSha256: string,
  dispatchStartedAt: string): MethodologyDispatchStartedRecord {
  const body = { schemaVersion: 1 as const, kind: "methodology-stage-dispatch-started" as const,
    registrationSha256, attemptId, stageIndex, invocationSha256, startSha256, dispatchStartedAt,
    providerContact: "not-established-by-dispatch-start" as const };
  const record = { ...body, recordSha256: canonicalJsonSha256(body) };
  assertNoSecrets(record, "methodology dispatch-start");
  writeExclusiveJson(root, join(root, dispatchFilename(attemptId, stageIndex)), record);
  return record;
}

function writeLifecycleTerminal(root: string,
  input: Omit<MethodologyAttemptLifecycleTerminalRecord, "schemaVersion" | "kind" | "providerContact" | "recordSha256">,
): MethodologyAttemptLifecycleTerminalRecord {
  const body = { schemaVersion: 1 as const, kind: "methodology-attempt-lifecycle-terminal" as const,
    ...input, providerContact: "not-established-by-lifecycle" as const };
  const record = { ...body, recordSha256: canonicalJsonSha256(body) };
  assertNoSecrets(record, "methodology lifecycle terminal");
  writeExclusiveJson(root, join(root, lifecycleFilename(input.attemptId)), record);
  return record;
}

function readRegisteredAttempt(root: string, registrationSha256: string, attemptId: string) {
  const registration = readMethodologyInvocationRegistration(root, registrationSha256);
  const attempt = registration.schedule.attempts.find((item) => item.id === attemptId);
  if (!attempt) throw new Error("methodology lifecycle attempt is not registered");
  return attempt;
}

function parseDispatchReceipts(value: unknown): MethodologyDispatchReceipt[] {
  if (!Array.isArray(value) || value.length > 2) throw new Error("methodology lifecycle dispatch receipts are invalid");
  return value.map((item, index) => {
    strictKeys(item, ["stageIndex", "dispatchSha256"]);
    const receipt = item as MethodologyDispatchReceipt;
    if (receipt.stageIndex !== index + 1 || !isSha256(receipt.dispatchSha256)) {
      throw new Error("methodology lifecycle dispatch receipt sequence is invalid");
    }
    return receipt;
  });
}

function validFailure(value: unknown): value is MethodologyLifecycleFailure {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  strictKeys(value, ["kind", "message"]);
  const failure = value as MethodologyLifecycleFailure;
  return RUN_FAILURE_KINDS.includes(failure.kind) && typeof failure.message === "string" &&
    failure.message.length > 0 && failure.message.length <= 2_000;
}

function verifyDigest(record: { recordSha256: string }, expected: string, source: string): void {
  const { recordSha256, ...body } = record;
  if (!isSha256(expected) || recordSha256 !== expected || recordSha256 !== canonicalJsonSha256(body)) {
    throw new Error(`${source} digest mismatch`);
  }
}

function strictKeys(value: unknown, expected: string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort(compareText).join("\0") !== [...expected].sort(compareText).join("\0")) {
    throw new Error("methodology lifecycle artifact has invalid fields");
  }
}

function receipt(record: MethodologyAttemptLifecycleTerminalRecord): MethodologyAttemptLifecycleReceipt {
  return { startSha256: record.startSha256, lifecycleTerminalSha256: record.recordSha256,
    dispatchReceipts: [...record.dispatchReceipts], reviewTerminalSha256: record.reviewTerminalSha256,
    status: record.status };
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value;
}

function timestamp(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("methodology lifecycle clock is invalid");
  return new Date(value).toISOString();
}

function startFilename(attemptId: string): string {
  assertAttemptId(attemptId);
  return `${attemptId}.methodology-start.json`;
}

function dispatchFilename(attemptId: string, stageIndex: 1 | 2): string {
  assertAttemptId(attemptId);
  if (stageIndex !== 1 && stageIndex !== 2) throw new Error("methodology lifecycle stage is invalid");
  return `${attemptId}.stage-${stageIndex}.dispatch-started.json`;
}

function lifecycleFilename(attemptId: string): string {
  assertAttemptId(attemptId);
  return `${attemptId}.methodology-lifecycle-terminal.json`;
}

function assertAttemptId(value: string): void {
  if (!/^attempt-[0-9]{6}$/.test(value)) throw new Error("methodology lifecycle attempt path is invalid");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
