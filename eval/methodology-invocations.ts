import { createHash } from "node:crypto";
import { join } from "node:path";
import { assertNoSecrets } from "../src/security/secrets.js";
import { parseBreadthResult } from "../src/core/breadth-result.js";
import { canonicalJson, canonicalJsonSha256, readExperimentJson, writeExclusiveJson } from "./experiment.js";
import { parseMethodologyAssetManifest, type MethodologyAssetManifest } from "./methodology-assets.js";
import { parseMethodologyDiscoveryOutput } from "./methodology-output.js";
import type { CompiledMethodologyPrompt } from "./methodology-prompts.js";
import { parseMethodologySchedule, type MethodologySchedule } from "./methodology-schedule.js";

export interface MethodologyInvocationInput {
  attemptId: string;
  stageIndex: 1 | 2;
  compiled: CompiledMethodologyPrompt;
  assets: MethodologyAssetManifest;
  schemaText: string;
  model: "gpt-5.6-sol";
  effort: "high";
  stageMaximumMs: number;
  attemptDeadlineAt: string;
  previousOutput: string | null;
  requestedAt: string;
}

interface InvocationRegistration {
  schemaVersion: 1;
  kind: "methodology-invocation-registration";
  runId: string;
  schedule: MethodologySchedule;
  scopeSha256ByCase: Record<string, string>;
  assetsByArm: MethodologyAssetManifest[];
}

export interface MethodologyInvocationRecord {
  schemaVersion: 1;
  kind: "methodology-invocation-intent";
  registrationSha256: string;
  previousInvocationSha256: string | null;
  input: MethodologyInvocationInput;
  recordSha256: string;
}

const REGISTRATION = "methodology-invocation-registration.json";
const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Reuses experiment exclusive writes. A persisted intent proves input capture,
 * NOT that a provider was contacted or served the requested model. The caller
 * retains this registration digest outside the run and records terminal calls.
 */
export function registerMethodologyInvocations(root: string, input: {
  runId: string;
  schedule: unknown;
  scopeSha256ByCase: Record<string, string>;
  assetsByArm: MethodologyAssetManifest[];
}): string {
  const registration = parseRegistration({ schemaVersion: 1, kind: "methodology-invocation-registration", ...input });
  assertNoSecrets(registration, "methodology invocation registration");
  writeExclusiveJson(root, join(root, REGISTRATION), registration);
  return canonicalJsonSha256(registration);
}

export function createMethodologyInvocationRecorder(root: string, registrationSha256: string) {
  // A resumed writer must obtain prior receipts from a separately sealed
  // run record; this writer deliberately supports only its current session.
  const receipts = new Map<string, string>();
  return (input: MethodologyInvocationInput): string => {
    const registration = readRegistration(root, registrationSha256);
    const previous = input.stageIndex === 2
      ? readMethodologyInvocation(root, registrationSha256, input.attemptId, 1,
        receipts.get(filename(input.attemptId, 1)) ?? "") : null;
    validateInput(input, registration, previous);
    const body = { schemaVersion: 1 as const, kind: "methodology-invocation-intent" as const,
      registrationSha256, previousInvocationSha256: previous?.recordSha256 ?? null, input };
    const record = { ...body, recordSha256: canonicalJsonSha256(body) };
    assertNoSecrets(record, "methodology invocation record");
    writeExclusiveJson(root, join(root, filename(input.attemptId, input.stageIndex)), record);
    receipts.set(filename(input.attemptId, input.stageIndex), record.recordSha256);
    return record.recordSha256;
  };
}

export function readMethodologyInvocation(root: string, registrationSha256: string,
  attemptId: string, stageIndex: 1 | 2, expectedRecordSha256: string): MethodologyInvocationRecord {
  if (!isHash(expectedRecordSha256)) throw new Error("caller-held invocation digest is required");
  const registration = readRegistration(root, registrationSha256);
  const record = readExperimentJson(join(root, filename(attemptId, stageIndex))) as MethodologyInvocationRecord;
  keys(record, ["schemaVersion", "kind", "registrationSha256", "previousInvocationSha256", "input", "recordSha256"]);
  if (record.schemaVersion !== 1 || record.kind !== "methodology-invocation-intent" ||
      record.registrationSha256 !== registrationSha256 || record.input?.attemptId !== attemptId ||
      record.input?.stageIndex !== stageIndex) throw new Error("methodology invocation identity mismatch");
  const previous = stageIndex === 2 ? readMethodologyInvocation(root, registrationSha256, attemptId, 1,
    record.previousInvocationSha256 ?? "") : null;
  if (record.previousInvocationSha256 !== (previous?.recordSha256 ?? null)) {
    throw new Error("methodology invocation chain mismatch");
  }
  validateInput(record.input, registration, previous);
  const { recordSha256, ...body } = record;
  if (recordSha256 !== expectedRecordSha256 || recordSha256 !== canonicalJsonSha256(body)) {
    throw new Error("methodology invocation digest mismatch");
  }
  assertNoSecrets(record, "methodology invocation record");
  return record;
}

function validateInput(input: MethodologyInvocationInput, registration: InvocationRegistration,
  previous: MethodologyInvocationRecord | null): void {
  keys(input, ["attemptId", "stageIndex", "compiled", "assets", "schemaText", "model", "effort",
    "stageMaximumMs", "attemptDeadlineAt", "previousOutput", "requestedAt"]);
  const attempt = registration.schedule.attempts.find((item) => item.id === input.attemptId);
  if (!attempt || ![1, 2].includes(input.stageIndex) || input.stageIndex > attempt.expectedStages) {
    throw new Error("methodology invocation is not scheduled");
  }
  const compiled = input.compiled;
  keys(compiled, ["armId", "stage", "schemaPath", "prompt", "promptSha256", "rawScopeSha256",
    "methodSourceSha256", "handoffSha256"]);
  const discovery = attempt.expectedStages === 2 && input.stageIndex === 1;
  const expectedSchema = discovery ? (attempt.armId === "C"
    ? "schemas/methodology-discovery.schema.json" : "schemas/breadth-result.schema.json")
    : "schemas/methodology-review.schema.json";
  if (compiled.armId !== attempt.armId || compiled.stage !== (discovery ? "discovery" : "review") ||
      compiled.schemaPath !== expectedSchema || typeof compiled.prompt !== "string" ||
      compiled.promptSha256 !== hash(compiled.prompt) ||
      compiled.rawScopeSha256 !== registration.scopeSha256ByCase[attempt.caseName]) {
    throw new Error("methodology invocation compiled input mismatch");
  }
  const generic = attempt.armId === "A" || attempt.armId === "C";
  if (generic ? compiled.methodSourceSha256 !== null : !isHash(compiled.methodSourceSha256)) {
    throw new Error("methodology invocation method source mismatch");
  }
  const assets = parseMethodologyAssetManifest(input.assets);
  const registeredAssets = registration.assetsByArm.find((item) => item.armId === attempt.armId);
  if (canonicalJson(assets) !== canonicalJson(registeredAssets)) throw new Error("methodology invocation assets mismatch");
  const schema = assets.files.find((file) => file.path === expectedSchema)!;
  if (typeof input.schemaText !== "string" || hash(input.schemaText) !== schema.sha256 ||
      Buffer.byteLength(input.schemaText) !== schema.bytes) throw new Error("methodology invocation schema mismatch");
  if (input.model !== registration.schedule.design.callerConfig.model || input.effort !== "high" ||
      input.stageMaximumMs !== attempt.stageDeadlineMs[input.stageIndex - 1]) {
    throw new Error("methodology invocation route or ceiling mismatch");
  }
  const requestedAt = timestamp(input.requestedAt);
  const deadline = timestamp(input.attemptDeadlineAt);
  if (deadline <= requestedAt || deadline - requestedAt > registration.schedule.design.totalDeadlineMs) {
    throw new Error("methodology invocation deadline exceeds registration");
  }
  if (previous) {
    if (input.attemptDeadlineAt !== previous.input.attemptDeadlineAt ||
        requestedAt < timestamp(previous.input.requestedAt) || typeof input.previousOutput !== "string") {
      throw new Error("methodology invocation predecessor mismatch");
    }
    const raw: unknown = JSON.parse(input.previousOutput);
    const handoff = canonicalJson(attempt.armId === "C"
      ? parseMethodologyDiscoveryOutput(raw) : parseBreadthResult(raw, "methodology invocation handoff"));
    const tag = attempt.armId === "C" ? "candidate-handoff" : "breadth-handoff";
    if (compiled.handoffSha256 !== hash(handoff) ||
        !compiled.prompt.includes(`<${tag} untrusted="true">\n${handoff}\n</${tag}>`)) {
      throw new Error("methodology invocation handoff mismatch");
    }
  } else if (input.previousOutput !== null || compiled.handoffSha256 !== null) {
    throw new Error("methodology initial invocation cannot have a handoff");
  }
}

function parseRegistration(value: unknown): InvocationRegistration {
  const input = value as InvocationRegistration;
  keys(input, ["schemaVersion", "kind", "runId", "schedule", "scopeSha256ByCase", "assetsByArm"]);
  if (input.schemaVersion !== 1 || input.kind !== "methodology-invocation-registration" ||
      typeof input.runId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(input.runId)) {
    throw new Error("methodology invocation registration identity is invalid");
  }
  const schedule = parseMethodologySchedule(input.schedule);
  keys(input.scopeSha256ByCase, schedule.cases.map((item) => item.caseName));
  if (Object.values(input.scopeSha256ByCase).some((value) => !isHash(value))) throw new Error("invalid registered scope digest");
  if (!Array.isArray(input.assetsByArm)) throw new Error("invalid registered assets");
  const assetsByArm = input.assetsByArm.map(parseMethodologyAssetManifest).sort((a, b) => a.armId.localeCompare(b.armId));
  if (assetsByArm.map((item) => item.armId).join("") !== "ABCD") throw new Error("registration requires each arm's assets");
  return { schemaVersion: 1, kind: "methodology-invocation-registration", runId: input.runId,
    schedule, scopeSha256ByCase: { ...input.scopeSha256ByCase }, assetsByArm };
}

export function readMethodologyInvocationRegistration(root: string, expected: string): InvocationRegistration {
  if (!isHash(expected)) throw new Error("invalid methodology registration digest");
  const registration = parseRegistration(readExperimentJson(join(root, REGISTRATION)));
  if (canonicalJsonSha256(registration) !== expected) throw new Error("methodology registration digest mismatch");
  return registration;
}
const readRegistration = readMethodologyInvocationRegistration;
function filename(attemptId: string, stageIndex: 1 | 2): string {
  if (!/^attempt-[0-9]{6}$/.test(attemptId) || ![1, 2].includes(stageIndex)) throw new Error("invalid invocation path");
  return `${attemptId}.stage-${stageIndex}.input.json`;
}
function keys(value: unknown, expected: string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")) {
    throw new Error("methodology invocation artifact has invalid fields");
  }
}
function isHash(value: unknown): value is string { return typeof value === "string" && SHA256.test(value); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function timestamp(value: string): number {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error("invalid invocation timestamp");
  return parsed;
}
