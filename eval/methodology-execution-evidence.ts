import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../src/core/telemetry.js";
import { assertNoSecrets } from "../src/security/secrets.js";
import { canonicalJson, canonicalJsonSha256, readExperimentFile, readExperimentJson,
  writeExclusiveJson } from "./experiment.js";
import { readMethodologyAttemptLifecycleTerminal, readMethodologyAttemptStart, readMethodologyDispatchStarted } from "./methodology-attempt-lifecycle.js";
import { readMethodologyInputPlan, verifyMethodologyPlannedInvocation } from "./methodology-input-plan.js";
import { readMethodologyInvocation, readMethodologyInvocationRegistration } from "./methodology-invocations.js";
import { readMethodologyRunSeal } from "./methodology-run-seal.js";
import { readMethodologyAttemptTerminal } from "./methodology-terminal.js";

const FILE = "methodology-execution-evidence.json";
const HASH = /^[a-f0-9]{64}$/;
export const METHODOLOGY_STOPPED_RUN_CLOSURE_FILE = "methodology-stopped-run-closure.json";

export interface MethodologyStoppedRunClosureInput {
  invocationRegistrationSha256: string;
  inputPlanSha256: string;
  lifecycleReceipts: MethodologyLifecycleSealReceipt[];
  startedNonterminal: {
    attemptId: string;
    startSha256: string;
    intentReceipts: Array<{ stageIndex: 1 | 2; invocationSha256: string }>;
    dispatchReceipts: Array<{ stageIndex: 1 | 2; dispatchSha256: string }>;
  } | null;
  unstartedAttemptIds: string[];
  stoppedAt: string;
  stopReason: string;
  /** A caller declaration, not evidence that this module terminated a worker. */
  workerStopped: "established-by-caller";
}

export interface MethodologyStoppedRunClosure extends MethodologyStoppedRunClosureInput {
  schemaVersion: 2;
  kind: "methodology-stopped-run-closure";
  status: "stopped-with-missing-lifecycles";
  scheduleSha256: string;
  accounting: MethodologyExecutionEvidence["accounting"] & { startedNonterminal: number; unstarted: number; missing: number };
  artifactBindings: MethodologyExecutionEvidence["artifactBindings"];
  claims: MethodologyExecutionEvidence["claims"] & { workerTermination: "caller-declaration-not-process-proof" };
  recordSha256: string;
}

/** Close only after independently establishing that the worker stopped. Retain
 * the returned digest outside this mutable store. Late writes invalidate it. */
export function writeMethodologyStoppedRunClosure(root: string, input: MethodologyStoppedRunClosureInput): string {
  const body = deriveClosure(root, input);
  const record = { ...body, recordSha256: canonicalJsonSha256(body) };
  assertNoSecrets(record, "methodology stopped run closure");
  writeExclusiveJson(root, join(root, METHODOLOGY_STOPPED_RUN_CLOSURE_FILE), record);
  return record.recordSha256;
}

export function readMethodologyStoppedRunClosure(root: string, expectedSha256: string): MethodologyStoppedRunClosure {
  assertRoot(root);
  if (!HASH.test(expectedSha256)) throw new Error("caller-held stopped run closure digest is required");
  const record = readExperimentJson(join(root, METHODOLOGY_STOPPED_RUN_CLOSURE_FILE)) as MethodologyStoppedRunClosure;
  keys(record, [...CLOSURE_INPUT_KEYS, "schemaVersion", "kind", "status", "scheduleSha256", "accounting", "artifactBindings", "claims", "recordSha256"]);
  const { recordSha256, ...body } = record;
  if (recordSha256 !== expectedSha256 || recordSha256 !== canonicalJsonSha256(body)) throw new Error("stopped run closure digest mismatch");
  const expected = deriveClosure(root, { invocationRegistrationSha256: record.invocationRegistrationSha256,
    inputPlanSha256: record.inputPlanSha256, lifecycleReceipts: record.lifecycleReceipts,
    startedNonterminal: record.startedNonterminal, unstartedAttemptIds: record.unstartedAttemptIds,
    stoppedAt: record.stoppedAt, stopReason: record.stopReason, workerStopped: record.workerStopped });
  if (canonicalJson(body) !== canonicalJson(expected)) throw new Error("stopped run closure does not derive from its sealed inputs");
  assertNoSecrets(record, "methodology stopped run closure");
  return record;
}

const CLOSURE_INPUT_KEYS = ["invocationRegistrationSha256", "inputPlanSha256", "lifecycleReceipts",
  "startedNonterminal", "unstartedAttemptIds", "stoppedAt", "stopReason", "workerStopped"];

function deriveClosure(root: string, input: MethodologyStoppedRunClosureInput): Omit<MethodologyStoppedRunClosure, "recordSha256"> {
  keys(input, CLOSURE_INPUT_KEYS);
  if (input.workerStopped !== "established-by-caller" || typeof input.stopReason !== "string" ||
      input.stopReason.trim().length === 0 || input.stopReason.length > 2_000 ||
      typeof input.stoppedAt !== "string" || !Number.isFinite(Date.parse(input.stoppedAt)) ||
      new Date(input.stoppedAt).toISOString() !== input.stoppedAt) throw new Error("stopped run closure requires a valid stop declaration");
  const evidence = derive(root, { invocationRegistrationSha256: input.invocationRegistrationSha256,
    inputPlanSha256: input.inputPlanSha256, lifecycleReceipts: input.lifecycleReceipts,
    terminalRunSealSha256: null }, input);
  const registration = readMethodologyInvocationRegistration(root, input.invocationRegistrationSha256);
  const missing = registration.schedule.attempts.length - input.lifecycleReceipts.length;
  return { schemaVersion: 2, kind: "methodology-stopped-run-closure", status: "stopped-with-missing-lifecycles",
    ...input, scheduleSha256: canonicalJsonSha256(registration.schedule),
    accounting: { ...evidence.accounting, scheduled: registration.schedule.attempts.length, missing,
      startedNonterminal: input.startedNonterminal === null ? 0 : 1, unstarted: input.unstartedAttemptIds.length },
    artifactBindings: evidence.artifactBindings,
    claims: { ...evidence.claims, workerTermination: "caller-declaration-not-process-proof" } };
}

export interface MethodologyLifecycleSealReceipt {
  attemptId: string;
  lifecycleTerminalSha256: string;
}

export interface MethodologyExecutionEvidenceInput {
  invocationRegistrationSha256: string;
  inputPlanSha256: string;
  /** Required iff every lifecycle outcome contains a review terminal. */
  terminalRunSealSha256: string | null;
  lifecycleReceipts: MethodologyLifecycleSealReceipt[];
}

export interface MethodologyExecutionEvidence extends MethodologyExecutionEvidenceInput {
  schemaVersion: 1;
  kind: "methodology-execution-evidence";
  status: "all-scheduled-lifecycles-terminal";
  accounting: { scheduled: number; reviewTerminal: number; preflightFailed: number; interrupted: number };
  artifactBindings: Array<{ path: string; sha256: string }>;
  claims: {
    availability: "not-established";
    providerContact: "not-established";
    historicalEfficacy: "not-evaluated";
    curation: "bound-declarations-not-independent-human-verification";
  };
  recordSha256: string;
}

/**
 * Join previously separate operational seals. Every scheduled attempt must have
 * a lifecycle terminal; preflight failures and interrupted executions remain
 * explicit. A missing/stopped schedule cannot use this complete-only contract.
 * The caller retains the returned digest outside this mutable evidence store.
 */
export function writeMethodologyExecutionEvidence(root: string, input: MethodologyExecutionEvidenceInput): string {
  const body = derive(root, input);
  const record = { ...body, recordSha256: canonicalJsonSha256(body) };
  assertNoSecrets(record, "methodology execution evidence");
  writeExclusiveJson(root, join(root, FILE), record);
  return record.recordSha256;
}

export function readMethodologyExecutionEvidence(root: string, expectedSha256: string): MethodologyExecutionEvidence {
  assertRoot(root);
  if (!HASH.test(expectedSha256)) throw new Error("caller-held execution evidence digest is required");
  const record = readExperimentJson(join(root, FILE)) as MethodologyExecutionEvidence;
  keys(record, ["schemaVersion", "kind", "status", "accounting", "artifactBindings", "claims",
    "invocationRegistrationSha256", "inputPlanSha256", "terminalRunSealSha256", "lifecycleReceipts", "recordSha256"]);
  const { recordSha256, ...body } = record;
  if (recordSha256 !== expectedSha256 || recordSha256 !== canonicalJsonSha256(body)) {
    throw new Error("methodology execution evidence digest mismatch");
  }
  const expected = derive(root, { invocationRegistrationSha256: record.invocationRegistrationSha256,
    inputPlanSha256: record.inputPlanSha256, terminalRunSealSha256: record.terminalRunSealSha256,
    lifecycleReceipts: record.lifecycleReceipts });
  if (canonicalJson(body) !== canonicalJson(expected)) throw new Error("methodology execution evidence does not derive from its sealed inputs");
  assertNoSecrets(record, "methodology execution evidence");
  return record;
}

function derive(root: string, input: MethodologyExecutionEvidenceInput,
  closure?: MethodologyStoppedRunClosureInput): Omit<MethodologyExecutionEvidence, "recordSha256"> {
  assertRoot(root);
  keys(input, ["invocationRegistrationSha256", "inputPlanSha256", "terminalRunSealSha256", "lifecycleReceipts"]);
  if (!HASH.test(input.invocationRegistrationSha256) || !HASH.test(input.inputPlanSha256) ||
      (input.terminalRunSealSha256 !== null && !HASH.test(input.terminalRunSealSha256))) {
    throw new Error("methodology execution evidence requires caller-held component digests");
  }
  const registration = readMethodologyInvocationRegistration(root, input.invocationRegistrationSha256);
  readMethodologyInputPlan(root, input.invocationRegistrationSha256, input.inputPlanSha256);
  if (!Array.isArray(input.lifecycleReceipts)) throw new Error("methodology lifecycle receipts must be an array");
  const receipts = input.lifecycleReceipts.map((receipt) => {
    keys(receipt, ["attemptId", "lifecycleTerminalSha256"]);
    if (!/^attempt-[0-9]{6}$/.test(receipt.attemptId) || !HASH.test(receipt.lifecycleTerminalSha256)) {
      throw new Error("methodology lifecycle receipt is invalid");
    }
    return { ...receipt };
  });
  if (canonicalJson(receipts.map((receipt) => receipt.attemptId)) !==
      canonicalJson(registration.schedule.attempts.slice(0, closure ? receipts.length : undefined).map((attempt) => attempt.id))) {
    throw new Error("execution evidence requires every scheduled lifecycle exactly once in schedule order");
  }
  const expectedFiles = new Set(["methodology-invocation-registration.json", "methodology-input-plan.json"]);
  const accounting = { scheduled: receipts.length, reviewTerminal: 0, preflightFailed: 0, interrupted: 0 };
  const reviewReceipts: Array<{ attemptId: string; terminalSha256: string }> = [];
  let previousFinishedAt = -Infinity;
  for (const receipt of receipts) {
    const lifecycle = readMethodologyAttemptLifecycleTerminal(root, input.invocationRegistrationSha256,
      receipt.attemptId, receipt.lifecycleTerminalSha256);
    let attemptStartedAt = -Infinity;
    if (closure) {
      const start = readMethodologyAttemptStart(root, input.invocationRegistrationSha256, receipt.attemptId, lifecycle.startSha256);
      attemptStartedAt = Date.parse(start.startedAt);
      if (Date.parse(start.startedAt) < previousFinishedAt) throw new Error("stopped run closure has overlapping schedule timestamps");
      previousFinishedAt = Date.parse(lifecycle.finishedAt);
      if (previousFinishedAt > Date.parse(closure.stoppedAt)) throw new Error("lifecycle terminal follows stopped run closure");
    }
    expectedFiles.add(`${receipt.attemptId}.methodology-start.json`);
    expectedFiles.add(`${receipt.attemptId}.methodology-lifecycle-terminal.json`);
    const intentDigests = new Map<1 | 2, string>();
    const dispatchTimes = new Map<1 | 2, number>();
    for (const dispatch of lifecycle.dispatchReceipts) {
      const record = readMethodologyDispatchStarted(root, input.invocationRegistrationSha256,
        receipt.attemptId, dispatch.stageIndex, dispatch.dispatchSha256);
      if (closure && Date.parse(record.dispatchStartedAt) > Date.parse(lifecycle.finishedAt)) throw new Error("dispatch follows lifecycle terminal");
      expectedFiles.add(`${receipt.attemptId}.stage-${dispatch.stageIndex}.dispatch-started.json`);
      intentDigests.set(dispatch.stageIndex, record.invocationSha256);
      dispatchTimes.set(dispatch.stageIndex, Date.parse(record.dispatchStartedAt));
    }
    if (lifecycle.status === "review-terminal") {
      accounting.reviewTerminal++;
      const result = readMethodologyAttemptTerminal(root, input.invocationRegistrationSha256,
        receipt.attemptId, lifecycle.reviewTerminalSha256!);
      expectedFiles.add(`${receipt.attemptId}.methodology-terminal.json`);
      reviewReceipts.push({ attemptId: receipt.attemptId, terminalSha256: lifecycle.reviewTerminalSha256! });
      for (const intent of result.intentReceipts) intentDigests.set(intent.stageIndex, intent.invocationSha256);
    } else if (lifecycle.status === "preflight-failed") accounting.preflightFailed++;
    else accounting.interrupted++;
    let previousStageTime = attemptStartedAt;
    for (const [stageIndex, invocationSha256] of [...intentDigests].sort(([left], [right]) => left - right)) {
      const invocation = readMethodologyInvocation(root, input.invocationRegistrationSha256,
        receipt.attemptId, stageIndex, invocationSha256);
      verifyMethodologyPlannedInvocation({ root, invocationRegistrationSha256: input.invocationRegistrationSha256,
        inputPlanSha256: input.inputPlanSha256, invocation: invocation.input });
      if (closure) {
        const requested = Date.parse(invocation.input.requestedAt);
        const dispatched = dispatchTimes.get(stageIndex);
        if (requested < previousStageTime || requested > Date.parse(lifecycle.finishedAt) ||
            (dispatched !== undefined && dispatched < requested)) throw new Error("stopped run closure terminal stage timestamps are out of order");
        previousStageTime = dispatched ?? requested;
      }
      expectedFiles.add(`${receipt.attemptId}.stage-${stageIndex}.input.json`);
    }
  }
  if (closure) {
    if (receipts.length >= registration.schedule.attempts.length) throw new Error("stopped run closure requires missing scheduled lifecycles");
    const pending = closure.startedNonterminal;
    if (pending !== null) {
      keys(pending, ["attemptId", "startSha256", "intentReceipts", "dispatchReceipts"]);
      if (pending.attemptId !== registration.schedule.attempts[receipts.length]!.id) throw new Error("stopped run closure started attempt skips the terminal prefix");
      const start = readMethodologyAttemptStart(root, input.invocationRegistrationSha256, pending.attemptId, pending.startSha256);
      if (Date.parse(start.startedAt) < previousFinishedAt || Date.parse(start.startedAt) > Date.parse(closure.stoppedAt)) throw new Error("stopped run closure start timestamp is out of order");
      expectedFiles.add(`${pending.attemptId}.methodology-start.json`);
      if (!Array.isArray(pending.intentReceipts) || !Array.isArray(pending.dispatchReceipts) ||
          pending.intentReceipts.length > 2 || pending.dispatchReceipts.length > pending.intentReceipts.length ||
          pending.intentReceipts.length - pending.dispatchReceipts.length > 1) throw new Error("stopped run closure stage prefix is invalid");
      let previousTime = Date.parse(start.startedAt);
      for (const [index, intent] of pending.intentReceipts.entries()) {
        keys(intent, ["stageIndex", "invocationSha256"]);
        if (intent.stageIndex !== index + 1) throw new Error("stopped run closure intent sequence is invalid");
        const invocation = readMethodologyInvocation(root, input.invocationRegistrationSha256, pending.attemptId, intent.stageIndex, intent.invocationSha256);
        verifyMethodologyPlannedInvocation({ root, invocationRegistrationSha256: input.invocationRegistrationSha256,
          inputPlanSha256: input.inputPlanSha256, invocation: invocation.input });
        const requested = Date.parse(invocation.input.requestedAt);
        if (requested < previousTime || requested > Date.parse(closure.stoppedAt)) throw new Error("stopped run closure intent timestamp is out of order");
        previousTime = requested;
        expectedFiles.add(`${pending.attemptId}.stage-${intent.stageIndex}.input.json`);
        const dispatch = pending.dispatchReceipts[index];
        if (dispatch) {
          keys(dispatch, ["stageIndex", "dispatchSha256"]);
          if (dispatch.stageIndex !== intent.stageIndex) throw new Error("stopped run closure dispatch sequence is invalid");
          const record = readMethodologyDispatchStarted(root, input.invocationRegistrationSha256, pending.attemptId, dispatch.stageIndex, dispatch.dispatchSha256);
          if (record.invocationSha256 !== intent.invocationSha256 || record.startSha256 !== pending.startSha256 ||
              Date.parse(record.dispatchStartedAt) < previousTime || Date.parse(record.dispatchStartedAt) > Date.parse(closure.stoppedAt)) throw new Error("stopped run closure dispatch binding is invalid");
          previousTime = Date.parse(record.dispatchStartedAt);
          expectedFiles.add(`${pending.attemptId}.stage-${dispatch.stageIndex}.dispatch-started.json`);
        }
      }
    }
    const suffix = registration.schedule.attempts.slice(receipts.length + (pending === null ? 0 : 1)).map((attempt) => attempt.id);
    if (!Array.isArray(closure.unstartedAttemptIds) || canonicalJson(closure.unstartedAttemptIds) !== canonicalJson(suffix)) throw new Error("stopped run closure requires the exact unstarted schedule suffix");
  } else if (accounting.reviewTerminal === accounting.scheduled) {
    if (input.terminalRunSealSha256 === null) throw new Error("review-terminal execution evidence requires its complete run seal");
    const seal = readMethodologyRunSeal(root, input.invocationRegistrationSha256, input.terminalRunSealSha256);
    if (canonicalJson(seal.terminalReceipts) !== canonicalJson(reviewReceipts)) {
      throw new Error("execution lifecycle receipts disagree with the complete run seal");
    }
    expectedFiles.add("methodology-run-terminal-seal.json");
  } else if (input.terminalRunSealSha256 !== null) {
    throw new Error("non-review lifecycle outcomes cannot claim a complete review-terminal run seal");
  }
  // Dedicated evidence store: unknown, nested, orphaned, or symlinked files are
  // not silently ignored. In-progress output files belong in isolated output.
  const actual = readdirSync(root).filter((name) => name !== (closure ? METHODOLOGY_STOPPED_RUN_CLOSURE_FILE : FILE)).sort();
  const expected = [...expectedFiles].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error("execution evidence contains missing, nested, or orphaned artifacts");
  const artifactBindings = expected.map((path) => {
    const stat = lstatSync(join(root, path));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("execution evidence artifacts must be direct regular files");
    return { path, sha256: sha256(readExperimentFile(join(root, path))) };
  });
  return { schemaVersion: 1, kind: "methodology-execution-evidence", status: "all-scheduled-lifecycles-terminal",
    ...input, lifecycleReceipts: receipts, accounting, artifactBindings,
    claims: { availability: "not-established", providerContact: "not-established", historicalEfficacy: "not-evaluated",
      curation: "bound-declarations-not-independent-human-verification" } };
}

function assertRoot(root: string): void {
  const stat = lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("execution evidence root must be a direct directory");
}

function keys(value: unknown, expected: string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expected].sort())) {
    throw new Error("methodology execution evidence has invalid fields");
  }
}
