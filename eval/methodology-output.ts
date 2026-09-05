import { assertNoSecrets } from "../src/security/secrets.js";
import type { Severity } from "../src/types.js";

/** Experimental common output only; never a production posting payload. */
export interface MethodologyFinding {
  file: string;
  startLine: number;
  endLine: number;
  explanation: string;
  impact: string;
  severity: Severity;
}

export interface MethodologyReviewOutput {
  status: "completed" | "unable-to-complete";
  limitations: string[];
  findings: MethodologyFinding[];
}

export interface MethodologyCandidate {
  file: string;
  startLine: number;
  endLine: number;
  hypothesis: string;
  evidenceNeeded: string;
}

export interface MethodologyDiscoveryOutput {
  status: "completed" | "unable-to-complete";
  limitations: string[];
  candidates: MethodologyCandidate[];
}

// Model completion is a self-report. Runner scope/transport/tool evidence can
// only further restrict eligibility; this parser never establishes cleanliness.
export function parseMethodologyReviewOutput(value: unknown): MethodologyReviewOutput {
  const root = record(value, ["status", "limitations", "findings"], "experimental review");
  const completion = parseCompletion(root);
  if (!Array.isArray(root.findings)) throw new Error("experimental review.findings must be an array");
  const findings = root.findings.map((value, index): MethodologyFinding => {
    const label = `experimental review.findings[${index}]`;
    const item = record(value, ["file", "startLine", "endLine", "explanation", "impact", "severity"], label);
    if (item.severity !== "high" && item.severity !== "medium" && item.severity !== "low") {
      throw new Error(`${label}.severity is invalid`);
    }
    return { ...location(item, label), explanation: text(item.explanation, `${label}.explanation`, 8000),
      impact: text(item.impact, `${label}.impact`, 8000), severity: item.severity };
  });
  const output = { ...completion, findings };
  assertNoSecrets(output, "experimental review");
  return output;
}

export function parseMethodologyDiscoveryOutput(value: unknown): MethodologyDiscoveryOutput {
  const root = record(value, ["status", "limitations", "candidates"], "experimental discovery");
  const completion = parseCompletion(root);
  if (!Array.isArray(root.candidates)) throw new Error("experimental discovery.candidates must be an array");
  const candidates = root.candidates.map((value, index): MethodologyCandidate => {
    const label = `experimental discovery.candidates[${index}]`;
    const item = record(value, ["file", "startLine", "endLine", "hypothesis", "evidenceNeeded"], label);
    return { ...location(item, label), hypothesis: text(item.hypothesis, `${label}.hypothesis`, 8000),
      evidenceNeeded: text(item.evidenceNeeded, `${label}.evidenceNeeded`, 8000) };
  });
  const output = { ...completion, candidates };
  assertNoSecrets(output, "experimental discovery");
  return output;
}

function parseCompletion(root: Record<string, unknown>): Pick<MethodologyReviewOutput, "status" | "limitations"> {
  if (root.status !== "completed" && root.status !== "unable-to-complete") {
    throw new Error("experimental output.status is invalid");
  }
  if (!Array.isArray(root.limitations)) throw new Error("experimental output.limitations must be an array");
  const limitations = root.limitations.map((value, index) => text(value, `limitations[${index}]`, 4000));
  if ((root.status === "completed") !== (limitations.length === 0)) {
    throw new Error("completed output requires no limitations; unable-to-complete requires a limitation");
  }
  return { status: root.status, limitations };
}

function location(item: Record<string, unknown>, label: string) {
  const file = text(item.file, `${label}.file`, 1024);
  if (file !== file.trim() || /^[A-Za-z]:|^\/|\\|[\u0000-\u001f\u007f]/.test(file) ||
    file.split("/").some((part) => ["", ".", "..", ".git"].includes(part.toLowerCase()))) {
    throw new Error(`${label}.file must be a safe repository-relative path`);
  }
  const startLine = line(item.startLine, `${label}.startLine`);
  const endLine = line(item.endLine, `${label}.endLine`);
  if (endLine < startLine) throw new Error(`${label}.endLine precedes startLine`);
  return { file, startLine, endLine };
}

function line(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} must be a positive safe integer`);
  return Number(value);
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) {
    throw new Error(`${label} must be nonblank bounded text`);
  }
  return value;
}

function record(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object)) if (!keys.includes(key)) throw new Error(`${label} has an unsupported field`);
  for (const key of keys) if (!Object.hasOwn(object, key)) throw new Error(`${label} is missing ${key}`);
  return object;
}
