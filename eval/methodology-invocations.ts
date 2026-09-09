import { createHash } from "node:crypto";
import { join } from "node:path";
import { assertNoSecrets } from "../src/security/secrets.js";
import { parseBreadthResult } from "../src/core/breadth-result.js";
import { canonicalJson, canonicalJsonSha256, readExperimentJson, writeExclusiveJson } from "./experiment.js";
import { parseMethodologyAssetManifest, type MethodologyAssetManifest } from "./methodology-assets.js";
import { parseMethodologyDiscoveryOutput } from "./methodology-output.js";
import type { CompiledMethodologyPrompt } from "./methodology-prompts.js";
import { parseMethodologySchedule, type MethodologySchedule } from "./methodology-schedule.js";
import type { EvaluationIsolation } from "../src/types.js";
import { ACCEPTED_EVAL_RUNTIME_IMAGE } from "./runtime-containment.js";

export interface MethodologyInvocationInput {
  attemptId: string;
  stageIndex: 1 | 2;
  compiled: CompiledMethodologyPrompt;
  assets: MethodologyAssetManifest;
  schemaText: string;
  model: "gpt-5.6-sol";
  effort: "high";
  /** Absent only in pre-tool-policy structural artifacts. */
  toolPolicy?: NonNullable<EvaluationIsolation["neutralReadMcp"]>;
  stageMaximumMs: number;
  attemptDeadlineAt: string;
  previousOutput: string | null;
  requestedAt: string;
}

interface InvocationRegistrationBase {
  kind: "methodology-invocation-registration";
  runId: string;
  schedule: MethodologySchedule;
  scopeSha256ByCase: Record<string, string>;
  assetsByArm: MethodologyAssetManifest[];
}

interface LegacyInvocationRegistration extends InvocationRegistrationBase {
  schemaVersion: 1;
}

interface NoRetryPolicy {
  mode: "none";
  maxDiagnosticChildren: 0;
}

interface CurrentInvocationRegistration extends InvocationRegistrationBase {
  schemaVersion: 2;
  retryPolicy: NoRetryPolicy;
}

type InvocationRegistration = LegacyInvocationRegistration | CurrentInvocationRegistration;

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
  const registration = parseRegistration({ schemaVersion: 2, kind: "methodology-invocation-registration",
    ...input, retryPolicy: { mode: "none", maxDiagnosticChildren: 0 } });
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
    if (registration.schemaVersion !== 2) {
      throw new Error("legacy methodology invocation registration is read-only");
    }
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
    "stageMaximumMs", "attemptDeadlineAt", "previousOutput", "requestedAt"], ["toolPolicy"]);
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
  if (input.toolPolicy !== undefined) validateToolPolicy(input.toolPolicy, input.attemptId, attempt.armId);
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

function validateToolPolicy(
  value: NonNullable<EvaluationIsolation["neutralReadMcp"]>,
  attemptId: string,
  armId: "A" | "B" | "C" | "D",
): void {
  keys(value, ["protocol", "url", "serverName", "enabledTools"], ["attachment"]);
  if (!(["neutral-read-mcp-v1", "neutral-read-mcp-v2"] as const).includes(value.protocol) ||
      value.serverName !== "source_read" ||
      canonicalJson(value.enabledTools) !== canonicalJson(["list_tree", "read_file", "search_text"])) {
    throw new Error("methodology invocation tool policy is invalid");
  }
  if (value.protocol === "neutral-read-mcp-v1") {
    if (value.attachment !== undefined) throw new Error("legacy methodology tool policy cannot carry attachment evidence");
  } else {
    validateAttachmentReference(value.attachment, attemptId, armId);
  }
  let url: URL;
  try { url = new URL(value.url); }
  catch { throw new Error("methodology invocation tool policy URL is invalid"); }
  if (url.protocol !== "http:" || url.hostname !== "host.docker.internal" ||
      !/^[1-9][0-9]{0,4}$/.test(url.port) || Number(url.port) > 65535 ||
      !/^\/mcp\/[a-f0-9]{64}$/.test(url.pathname) || url.search || url.hash || url.username || url.password) {
    throw new Error("methodology invocation tool policy URL is outside the allowed shape");
  }
}

function validateAttachmentReference(
  value: NonNullable<NonNullable<EvaluationIsolation["neutralReadMcp"]>["attachment"]> | undefined,
  attemptId: string,
  armId: "A" | "B" | "C" | "D",
): void {
  if (!value) throw new Error("trusted methodology tool policy lacks attachment evidence");
  keys(value, ["schemaVersion", "protocol", "attemptId", "armId", "sourceHeadTree",
    "effectiveRootsSha256", "image", "runner", "providerAccess", "profile", "executionClass",
    "outputByteLimit", "readLimitsSha256",
    "mcpLimitsSha256", "attestationSha256"]);
  if (value.schemaVersion !== 1 || value.protocol !== "methodology-provider-attachment-reference-v1" ||
      value.attemptId !== attemptId || value.armId !== armId ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.sourceHeadTree) ||
      value.image !== ACCEPTED_EVAL_RUNTIME_IMAGE || value.runner !== "codex" ||
      !["api-key", "cli-session"].includes(value.providerAccess) || value.profile !== "methodology-review" ||
      !["provider", "structural-mock"].includes(value.executionClass) ||
      !Number.isSafeInteger(value.outputByteLimit) || value.outputByteLimit < 1 || value.outputByteLimit > 100_000_000 ||
      [value.effectiveRootsSha256, value.readLimitsSha256, value.mcpLimitsSha256,
        value.attestationSha256].some((digest) => !isHash(digest))) {
    throw new Error("methodology invocation attachment evidence is invalid");
  }
}

function parseRegistration(value: unknown): InvocationRegistration {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("methodology invocation registration identity is invalid");
  }
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 1 && input.schemaVersion !== 2) {
    throw new Error("methodology invocation registration identity is invalid");
  }
  keys(input, ["schemaVersion", "kind", "runId", "schedule", "scopeSha256ByCase", "assetsByArm",
    ...(input.schemaVersion === 2 ? ["retryPolicy"] : [])]);
  if (input.kind !== "methodology-invocation-registration" ||
      typeof input.runId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(input.runId)) {
    throw new Error("methodology invocation registration identity is invalid");
  }
  const schedule = parseMethodologySchedule(input.schedule);
  const scopeSha256ByCase = input.scopeSha256ByCase;
  if (!scopeSha256ByCase || typeof scopeSha256ByCase !== "object" || Array.isArray(scopeSha256ByCase)) {
    throw new Error("invalid registered scope digest");
  }
  keys(scopeSha256ByCase, schedule.cases.map((item) => item.caseName));
  if (Object.values(scopeSha256ByCase).some((value) => !isHash(value))) throw new Error("invalid registered scope digest");
  if (!Array.isArray(input.assetsByArm)) throw new Error("invalid registered assets");
  const assetsByArm = input.assetsByArm.map(parseMethodologyAssetManifest).sort((a, b) => a.armId.localeCompare(b.armId));
  if (assetsByArm.map((item) => item.armId).join("") !== "ABCD") throw new Error("registration requires each arm's assets");
  const base = { kind: "methodology-invocation-registration" as const, runId: input.runId,
    schedule, scopeSha256ByCase: { ...scopeSha256ByCase }, assetsByArm };
  if (input.schemaVersion === 1) return { schemaVersion: 1, ...base };
  const retryPolicy = input.retryPolicy as Record<string, unknown>;
  keys(retryPolicy, ["mode", "maxDiagnosticChildren"]);
  if (retryPolicy.mode !== "none" || retryPolicy.maxDiagnosticChildren !== 0) {
    throw new Error("methodology invocation registration retry policy is invalid");
  }
  return { schemaVersion: 2, ...base, retryPolicy: { mode: "none", maxDiagnosticChildren: 0 } };
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
function keys(value: unknown, expected: string[], optional: string[] = []): void {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !expected.includes(key) && !optional.includes(key)) ||
      expected.some((key) => !Object.hasOwn(value, key))) {
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
