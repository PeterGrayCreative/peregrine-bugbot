import {
  FINDING_CATEGORIES,
  RUNNER_NAMES,
  type EngineResult,
  type Finding,
  type ReviewPayload,
  type RunnerName,
  type Usage,
} from "../types.js";
import { claudeSchemaJson } from "./paths.js";
import { assertNoSecrets } from "../security/secrets.js";

const MAX_RAW_SERIALIZED_CHARS = 200_000;

const FINDING_KEYS = new Set([
  "file",
  "startLine",
  "endLine",
  "severity",
  "disposition",
  "category",
  "invariant",
  "title",
  "explanation",
  "failurePath",
  "confidence",
]);
const RESULT_KEYS = new Set([
  "engine",
  "status",
  "modelConfig",
  "reviewedBaseRef",
  "reviewedHeadRef",
  "findings",
  "usage",
  "durationMs",
  "raw",
]);
const USAGE_KEYS = new Set([
  "inputTokens",
  "cachedInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "costUsd",
]);

export function reviewSchemaJson(): string {
  return claudeSchemaJson("review-result");
}

export function parseReviewPayload(value: unknown, source = "review output"): ReviewPayload {
  const root = plainObject(value, source);
  assertOnlyKeys(root, new Set(["findings"]), source);
  if (!Array.isArray(root.findings)) throw new Error(`${source}: "findings" must be an array`);
  const payload = {
    findings: root.findings.map((finding, index) => parseFinding(finding, `${source}.findings[${index}]`)),
  };
  assertNoSecrets(payload, `${source}.findings`);
  return payload;
}

/** Revalidate a serialized review artifact before it crosses into posting. */
export function parseEngineResult(value: unknown, source = "review result"): EngineResult {
  const root = plainObject(value, source);
  assertOnlyKeys(root, RESULT_KEYS, source);
  if (!RUNNER_NAMES.includes(root.engine as RunnerName)) {
    throw new Error(`${source}.engine must be one of: ${RUNNER_NAMES.join(", ")}`);
  }
  if (!(root.status === "completed" || root.status === "clean" || root.status === "skipped")) {
    throw new Error(`${source}.status must be completed, clean, or skipped`);
  }
  const modelConfig = requiredString(root.modelConfig, `${source}.modelConfig`, 1000);
  const payload = parseReviewPayload({ findings: root.findings }, source);
  assertNoSecrets(payload, `${source}.findings`);
  if (root.status === "clean" && payload.findings.length !== 0) {
    throw new Error(`${source}: clean results cannot contain findings`);
  }
  if (root.status === "completed" && payload.findings.length === 0) {
    throw new Error(`${source}: completed results must contain findings`);
  }
  if (typeof root.durationMs !== "number" || !Number.isFinite(root.durationMs) || root.durationMs < 0) {
    throw new Error(`${source}.durationMs must be a non-negative number`);
  }
  const usageObject = plainObject(root.usage, `${source}.usage`);
  assertOnlyKeys(usageObject, USAGE_KEYS, `${source}.usage`);
  const usage: Usage = {};
  for (const key of USAGE_KEYS) {
    const usageValue = usageObject[key];
    if (usageValue === undefined) continue;
    if (typeof usageValue !== "number" || !Number.isFinite(usageValue) || usageValue < 0) {
      throw new Error(`${source}.usage.${key} must be a non-negative number`);
    }
    usage[key as keyof Usage] = usageValue;
  }
  const reviewedBaseRef = optionalString(root.reviewedBaseRef, `${source}.reviewedBaseRef`, 1024);
  const reviewedHeadRef = optionalString(root.reviewedHeadRef, `${source}.reviewedHeadRef`, 1024);

  if (root.raw !== undefined) {
    const serializedRaw = JSON.stringify(root.raw);
    if (serializedRaw.length > MAX_RAW_SERIALIZED_CHARS) {
      throw new Error(`${source}.raw exceeds ${MAX_RAW_SERIALIZED_CHARS} serialized characters`);
    }
    assertNoSecrets(root.raw, `${source}.raw`);
  }

  return {
    engine: root.engine as RunnerName,
    status: root.status,
    modelConfig,
    reviewedBaseRef,
    reviewedHeadRef,
    findings: payload.findings,
    usage,
    durationMs: root.durationMs,
    raw: root.raw,
  };
}

export function buildEngineResult(args: {
  engine: RunnerName;
  modelConfig: string;
  ctx: { baseRef?: string; headRef?: string };
  payload: ReviewPayload;
  usage: Usage;
  durationMs: number;
  raw?: unknown;
}): EngineResult {
  assertNoSecrets(args.payload, `${args.engine} review output`);
  if (args.raw !== undefined) {
    const serializedRaw = JSON.stringify(args.raw);
    if (serializedRaw.length > MAX_RAW_SERIALIZED_CHARS) {
      throw new Error(`${args.engine} raw telemetry exceeds ${MAX_RAW_SERIALIZED_CHARS} serialized characters`);
    }
    assertNoSecrets(args.raw, `${args.engine} raw telemetry`);
  }
  return {
    engine: args.engine,
    status: args.payload.findings.length === 0 ? "clean" : "completed",
    modelConfig: args.modelConfig,
    reviewedBaseRef: args.ctx.baseRef,
    reviewedHeadRef: args.ctx.headRef,
    findings: args.payload.findings,
    usage: args.usage,
    durationMs: args.durationMs,
    raw: args.raw,
  };
}

function parseFinding(value: unknown, source: string): Finding {
  const finding = plainObject(value, source);
  assertOnlyKeys(finding, FINDING_KEYS, source);
  const file = requiredString(finding.file, `${source}.file`, 1024);
  if (
    file.startsWith("/") ||
    /^[A-Za-z]:/.test(file) ||
    file.includes("\\") ||
    file.includes("\0") ||
    file.split("/").some((part) => part === ".." || part === "." || part.length === 0) ||
    file === ".git" ||
    file.startsWith(".git/")
  ) {
    throw new Error(`${source}.file must be a safe repository-relative Git path`);
  }

  const startLine = positiveInteger(finding.startLine, `${source}.startLine`);
  const endLine = positiveInteger(finding.endLine, `${source}.endLine`);
  if (endLine < startLine) throw new Error(`${source}.endLine must be >= startLine`);

  if (!(["high", "medium", "low"] as unknown[]).includes(finding.severity)) {
    throw new Error(`${source}.severity must be high, medium, or low`);
  }
  if (!(["fix-in-pr", "follow-up"] as unknown[]).includes(finding.disposition)) {
    throw new Error(`${source}.disposition must be fix-in-pr or follow-up`);
  }
  if (!FINDING_CATEGORIES.includes(finding.category as Finding["category"])) {
    throw new Error(`${source}.category is not a supported finding category`);
  }
  if (typeof finding.confidence !== "number" || finding.confidence < 0 || finding.confidence > 1) {
    throw new Error(`${source}.confidence must be a number between 0 and 1`);
  }

  return {
    file,
    startLine,
    endLine,
    severity: finding.severity as Finding["severity"],
    disposition: finding.disposition as Finding["disposition"],
    category: finding.category as Finding["category"],
    invariant: invariantSlug(finding.invariant, `${source}.invariant`),
    title: requiredString(finding.title, `${source}.title`, 300),
    explanation: requiredString(finding.explanation, `${source}.explanation`, 8000),
    failurePath: requiredString(finding.failurePath, `${source}.failurePath`, 8000),
    confidence: finding.confidence,
  };
}

function invariantSlug(value: unknown, source: string): string {
  const slug = requiredString(value, source, 120);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`${source} must be a lowercase hyphen-delimited stable slug`);
  }
  return slug;
}

function plainObject(value: unknown, source: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${source}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: Set<string>, source: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) throw new Error(`${source}: unexpected field(s): ${unexpected.join(", ")}`);
}

function requiredString(value: unknown, source: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${source} must be a non-empty string`);
  }
  if (value.length > maxLength) throw new Error(`${source} exceeds ${maxLength} characters`);
  return value;
}

function optionalString(value: unknown, source: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, source, maxLength);
}

function positiveInteger(value: unknown, source: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${source} must be a positive integer`);
  }
  return value;
}
