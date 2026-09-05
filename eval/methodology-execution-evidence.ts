import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../src/core/telemetry.js";
import { assertNoSecrets } from "../src/security/secrets.js";
import { canonicalJson, canonicalJsonSha256, readExperimentFile, readExperimentJson,
  writeExclusiveJson } from "./experiment.js";
import { readMethodologyAttemptLifecycleTerminal, readMethodologyDispatchStarted } from "./methodology-attempt-lifecycle.js";
import { readMethodologyInputPlan, verifyMethodologyPlannedInvocation } from "./methodology-input-plan.js";
import { readMethodologyInvocation, readMethodologyInvocationRegistration } from "./methodology-invocations.js";
import { readMethodologyRunSeal } from "./methodology-run-seal.js";
import { readMethodologyAttemptTerminal } from "./methodology-terminal.js";

const FILE = "methodology-execution-evidence.json";
const HASH = /^[a-f0-9]{64}$/;

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

function derive(root: string, input: MethodologyExecutionEvidenceInput): Omit<MethodologyExecutionEvidence, "recordSha256"> {
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
      canonicalJson(registration.schedule.attempts.map((attempt) => attempt.id))) {
    throw new Error("execution evidence requires every scheduled lifecycle exactly once in schedule order");
  }
  const expectedFiles = new Set(["methodology-invocation-registration.json", "methodology-input-plan.json"]);
  const accounting = { scheduled: receipts.length, reviewTerminal: 0, preflightFailed: 0, interrupted: 0 };
  const reviewReceipts: Array<{ attemptId: string; terminalSha256: string }> = [];
  for (const receipt of receipts) {
    const lifecycle = readMethodologyAttemptLifecycleTerminal(root, input.invocationRegistrationSha256,
      receipt.attemptId, receipt.lifecycleTerminalSha256);
    expectedFiles.add(`${receipt.attemptId}.methodology-start.json`);
    expectedFiles.add(`${receipt.attemptId}.methodology-lifecycle-terminal.json`);
    const intentDigests = new Map<1 | 2, string>();
    for (const dispatch of lifecycle.dispatchReceipts) {
      const record = readMethodologyDispatchStarted(root, input.invocationRegistrationSha256,
        receipt.attemptId, dispatch.stageIndex, dispatch.dispatchSha256);
      expectedFiles.add(`${receipt.attemptId}.stage-${dispatch.stageIndex}.dispatch-started.json`);
      intentDigests.set(dispatch.stageIndex, record.invocationSha256);
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
    for (const [stageIndex, invocationSha256] of intentDigests) {
      const invocation = readMethodologyInvocation(root, input.invocationRegistrationSha256,
        receipt.attemptId, stageIndex, invocationSha256);
      verifyMethodologyPlannedInvocation({ root, invocationRegistrationSha256: input.invocationRegistrationSha256,
        inputPlanSha256: input.inputPlanSha256, invocation: invocation.input });
      expectedFiles.add(`${receipt.attemptId}.stage-${stageIndex}.input.json`);
    }
  }
  if (accounting.reviewTerminal === accounting.scheduled) {
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
  const actual = readdirSync(root).filter((name) => name !== FILE).sort();
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
