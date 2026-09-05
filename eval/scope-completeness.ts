import { createHash } from "node:crypto";

export const SCOPE_COMPLETENESS_PROTOCOL = "historical-efficacy-v1" as const;

export const SCOPE_COMPLETENESS_TRUST_BOUNDARY =
  "This contract binds the registered requirements and derives a verdict. Its consumer must match the registration digest to the immutable schedule and authenticate every runner evidence digest against the runner-owned artifact; model text and activity counts are not runner evidence.";

export type ScopeObservationKind = "input" | "tool" | "required-context";
export type ScopeCompletenessVerdict = "complete" | "incomplete" | "unverified";

export interface RequiredScopeObservation {
  id: string;
  kind: ScopeObservationKind;
  requirementSha256: string;
}

export interface RunnerScopeFact {
  observationId: string;
  requirementSha256: string;
  status: "available" | "unavailable";
  evidenceSha256: string;
}

export interface ModelScopeLimitation {
  kind:
    | "required-context-unavailable"
    | "input-unavailable-or-truncated"
    | "required-tool-unavailable"
    | "unable-to-complete";
  observationId?: string;
  detail: string;
}

export interface ScopeCompletenessEvidence {
  schemaVersion: 1;
  protocol: typeof SCOPE_COMPLETENESS_PROTOCOL;
  registeredScopeSha256: string;
  requiredObservations: RequiredScopeObservation[];
  runnerFacts: RunnerScopeFact[];
  modelLimitations: ModelScopeLimitation[];
  nonAuthoritativeActivity?: {
    toolCallCount: number;
    findingCount: number;
  };
}

export interface ScopeCompletenessResult {
  evidence: ScopeCompletenessEvidence;
  verdict: ScopeCompletenessVerdict;
  reasons: string[];
  /** This is scope-availability evidence, never proof that the model read or understood every file. */
  meaning: "registered-scope-availability-only";
}

const OBSERVATION_ID = /^[a-z][a-z0-9.-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function scopeRegistrationSha256(
  requiredObservations: readonly RequiredScopeObservation[],
): string {
  const tuples = [...requiredObservations]
    .sort((left, right) => lexicalCompare(left.id, right.id))
    .map(({ id, kind, requirementSha256 }) => [id, kind, requirementSha256]);
  return createHash("sha256")
    .update("peregrine-scope-completeness-registration-v1\0")
    .update(JSON.stringify({ protocol: SCOPE_COMPLETENESS_PROTOCOL, requiredObservations: tuples }))
    .digest("hex");
}

export function evaluateScopeCompleteness(
  value: unknown,
  label = "scope completeness evidence",
): ScopeCompletenessResult {
  const root = strictObject(value, label, [
    "schemaVersion",
    "protocol",
    "registeredScopeSha256",
    "requiredObservations",
    "runnerFacts",
    "modelLimitations",
  ], ["nonAuthoritativeActivity"]);
  if (root.schemaVersion !== 1) throw new Error(`${label}.schemaVersion must be 1`);
  if (root.protocol !== SCOPE_COMPLETENESS_PROTOCOL) {
    throw new Error(`${label}.protocol must be ${SCOPE_COMPLETENESS_PROTOCOL}`);
  }
  const registeredScopeSha256 = sha256(root.registeredScopeSha256, `${label}.registeredScopeSha256`);

  if (!Array.isArray(root.requiredObservations) || root.requiredObservations.length === 0) {
    throw new Error(`${label}.requiredObservations must be a non-empty array`);
  }
  const requirements = new Map<string, RequiredScopeObservation>();
  for (const [index, value] of root.requiredObservations.entries()) {
    const source = `${label}.requiredObservations[${index}]`;
    const item = strictObject(value, source, ["id", "kind", "requirementSha256"]);
    const id = observationId(item.id, `${source}.id`);
    if (requirements.has(id)) throw new Error(`${source}.id is duplicated`);
    if (item.kind !== "input" && item.kind !== "tool" && item.kind !== "required-context") {
      throw new Error(`${source}.kind is invalid`);
    }
    requirements.set(id, {
      id,
      kind: item.kind,
      requirementSha256: sha256(item.requirementSha256, `${source}.requirementSha256`),
    });
  }

  if (!Array.isArray(root.runnerFacts)) throw new Error(`${label}.runnerFacts must be an array`);
  const runnerFacts: RunnerScopeFact[] = root.runnerFacts.map((value, index) => {
    const source = `${label}.runnerFacts[${index}]`;
    const item = strictObject(value, source, [
      "observationId", "requirementSha256", "status", "evidenceSha256",
    ]);
    const observationIdValue = observationId(item.observationId, `${source}.observationId`);
    const requirement = requirements.get(observationIdValue);
    if (!requirement) throw new Error(`${source}.observationId is not registered`);
    const requirementSha256 = sha256(item.requirementSha256, `${source}.requirementSha256`);
    if (requirementSha256 !== requirement.requirementSha256) {
      throw new Error(`${source}.requirementSha256 does not match the registered observation`);
    }
    if (item.status !== "available" && item.status !== "unavailable") {
      throw new Error(`${source}.status is invalid`);
    }
    return {
      observationId: observationIdValue,
      requirementSha256,
      status: item.status,
      evidenceSha256: sha256(item.evidenceSha256, `${source}.evidenceSha256`),
    };
  });

  if (!Array.isArray(root.modelLimitations)) {
    throw new Error(`${label}.modelLimitations must be an array`);
  }
  const modelLimitations: ModelScopeLimitation[] = root.modelLimitations.map((value, index) => {
    const source = `${label}.modelLimitations[${index}]`;
    const item = strictObject(value, source, ["kind", "detail"], ["observationId"]);
    if (item.kind !== "required-context-unavailable" &&
      item.kind !== "input-unavailable-or-truncated" &&
      item.kind !== "required-tool-unavailable" && item.kind !== "unable-to-complete") {
      throw new Error(`${source}.kind is invalid`);
    }
    const observationIdValue = item.observationId === undefined
      ? undefined
      : observationId(item.observationId, `${source}.observationId`);
    if (observationIdValue !== undefined && !requirements.has(observationIdValue)) {
      throw new Error(`${source}.observationId is not registered`);
    }
    if (typeof item.detail !== "string" || !item.detail.trim() || item.detail.length > 4_000) {
      throw new Error(`${source}.detail must be a non-empty bounded string`);
    }
    return {
      kind: item.kind,
      ...(observationIdValue === undefined ? {} : { observationId: observationIdValue }),
      detail: item.detail,
    };
  });

  let nonAuthoritativeActivity: ScopeCompletenessEvidence["nonAuthoritativeActivity"];
  if (root.nonAuthoritativeActivity !== undefined) {
    const source = `${label}.nonAuthoritativeActivity`;
    const activity = strictObject(root.nonAuthoritativeActivity, source, ["toolCallCount", "findingCount"]);
    nonAuthoritativeActivity = {
      toolCallCount: nonnegativeInteger(activity.toolCallCount, `${source}.toolCallCount`),
      findingCount: nonnegativeInteger(activity.findingCount, `${source}.findingCount`),
    };
  }

  const requiredObservations = [...requirements.values()].sort((left, right) => lexicalCompare(left.id, right.id));
  if (registeredScopeSha256 !== scopeRegistrationSha256(requiredObservations)) {
    throw new Error(`${label}.registeredScopeSha256 does not match the registered observations`);
  }
  runnerFacts.sort((left, right) =>
    lexicalCompare(left.observationId, right.observationId) ||
    lexicalCompare(left.status, right.status) || lexicalCompare(left.evidenceSha256, right.evidenceSha256));
  modelLimitations.sort((left, right) =>
    lexicalCompare(left.kind, right.kind) ||
    lexicalCompare(left.observationId ?? "", right.observationId ?? "") || lexicalCompare(left.detail, right.detail));

  const reasons: string[] = [];
  let hasIncompleteEvidence = false;
  for (const requirement of requiredObservations) {
    const statuses = new Set(runnerFacts
      .filter((fact) => fact.observationId === requirement.id)
      .map((fact) => fact.status));
    if (statuses.has("available") && statuses.has("unavailable")) {
      hasIncompleteEvidence = true;
      reasons.push(`runner-contradiction:${requirement.id}`);
    } else if (statuses.has("unavailable")) {
      hasIncompleteEvidence = true;
      reasons.push(`runner-unavailable:${requirement.id}`);
    } else if (!statuses.has("available")) {
      reasons.push(`missing-runner-availability:${requirement.id}`);
    }
  }
  for (const limitation of modelLimitations) {
    hasIncompleteEvidence = true;
    reasons.push(`model-limitation:${limitation.kind}:${limitation.observationId ?? "global"}`);
  }

  const evidence: ScopeCompletenessEvidence = {
    schemaVersion: 1,
    protocol: SCOPE_COMPLETENESS_PROTOCOL,
    registeredScopeSha256,
    requiredObservations,
    runnerFacts,
    modelLimitations,
    ...(nonAuthoritativeActivity === undefined ? {} : { nonAuthoritativeActivity }),
  };
  return {
    evidence,
    verdict: hasIncompleteEvidence ? "incomplete" : reasons.length > 0 ? "unverified" : "complete",
    reasons,
    meaning: "registered-scope-availability-only",
  };
}

function strictObject(
  value: unknown,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const object = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  const unexpected = Object.keys(object).find((key) => !allowed.has(key));
  if (unexpected !== undefined) throw new Error(`${label} contains unsupported field ${unexpected}`);
  const missing = required.find((key) => !Object.hasOwn(object, key));
  if (missing !== undefined) throw new Error(`${label} is missing ${missing}`);
  return object;
}

function observationId(value: unknown, label: string): string {
  if (typeof value !== "string" || !OBSERVATION_ID.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
  return value;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} must be a nonnegative integer`);
  return Number(value);
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
