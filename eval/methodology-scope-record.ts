import type { EvaluationIsolation } from "../src/types.js";
import { canonicalJson, canonicalJsonSha256 } from "./experiment.js";
import {
  parseReviewReadMcpAuditSnapshot,
  type ReviewReadMcpAuditSnapshot,
} from "./methodology-read-mcp.js";
import {
  evaluateScopeCompleteness,
  scopeRegistrationSha256,
  type ModelScopeLimitation,
  type RequiredScopeObservation,
  type RunnerScopeFact,
  type ScopeCompletenessResult,
} from "./scope-completeness.js";

export const METHODOLOGY_SCOPE_RECORD_PROTOCOL = "historical-methodology-scope-record-v1" as const;
export const METHODOLOGY_SCOPE_RECORD_BOUNDARY =
  "Version 1 is derived only from a trusted attachment's sealed invocation policy and runner-owned MCP audit. It deliberately carries no credential-bearing canary fact and therefore can never certify complete scope; a later canary requires a new versioned record.";

export const METHODOLOGY_SCOPE_OBSERVATION_IDS = Object.freeze({
  registeredReviewScope: "input.registered-review-scope",
  neutralReadAttachment: "tool.neutral-read-attachment",
  credentialBearingCanary: "tool.credential-bearing-canary",
} as const);

export const METHODOLOGY_CREDENTIAL_CANARY_REQUIREMENT_SHA256 = canonicalJsonSha256({
  schemaVersion: 1,
  protocol: "historical-methodology-credential-canary-requirement-v1",
  requiredExecutionClass: "provider",
  requiredResult: "passed",
  claim: "provider-connected-model-and-neutral-read-tool-availability",
});

export type MethodologyNeutralReadPolicyV2 = NonNullable<EvaluationIsolation["neutralReadMcp"]> & {
  protocol: "neutral-read-mcp-v2";
  attachment: NonNullable<NonNullable<EvaluationIsolation["neutralReadMcp"]>["attachment"]>;
};

export interface MethodologyScopeRecord {
  schemaVersion: 1;
  protocol: typeof METHODOLOGY_SCOPE_RECORD_PROTOCOL;
  audit: ReviewReadMcpAuditSnapshot;
  result: ScopeCompletenessResult;
  recordSha256: string;
}

export interface MethodologyScopeRecordInput {
  attemptId: string;
  armId: "A" | "B" | "C" | "D";
  registeredReviewScopeSha256: string;
  toolPolicy: MethodologyNeutralReadPolicyV2;
  audit: unknown;
  modelLimitations: readonly ModelScopeLimitation[];
  findingCount: number;
}

/**
 * Build the current fail-closed scope record. The caller must obtain toolPolicy
 * and audit from the branded provider attachment; terminal readers separately
 * bind them back to the sealed invocation and source registration.
 */
export function buildMethodologyScopeRecordV1(input: MethodologyScopeRecordInput): MethodologyScopeRecord {
  identity(input);
  const audit = parseReviewReadMcpAuditSnapshot(input.audit);
  const executionClass = input.toolPolicy.attachment.executionClass;
  const neutralReadAttachmentSha256 = canonicalJsonSha256(input.toolPolicy);
  const definitions = [
    {
      id: METHODOLOGY_SCOPE_OBSERVATION_IDS.registeredReviewScope,
      kind: "input" as const,
      artifactSha256: input.registeredReviewScopeSha256,
    },
    {
      id: METHODOLOGY_SCOPE_OBSERVATION_IDS.neutralReadAttachment,
      kind: "tool" as const,
      artifactSha256: neutralReadAttachmentSha256,
    },
    {
      id: METHODOLOGY_SCOPE_OBSERVATION_IDS.credentialBearingCanary,
      kind: "tool" as const,
      artifactSha256: METHODOLOGY_CREDENTIAL_CANARY_REQUIREMENT_SHA256,
    },
  ];
  const requiredObservations: RequiredScopeObservation[] = definitions.map(({ id, kind, artifactSha256 }) => ({
    id,
    kind,
    requirementSha256: requirementSha256(id, executionClass, artifactSha256),
  }));
  const requirementById = new Map(requiredObservations.map((item) => [item.id, item]));
  const auditUnavailable = audit.tools.incomplete > 0 || audit.tools.denied > 0 ||
    audit.denialCodes.length > 0 || audit.transportFailures.length > 0;
  const runnerFacts: RunnerScopeFact[] = [
    runnerFact(
      requirementById.get(METHODOLOGY_SCOPE_OBSERVATION_IDS.registeredReviewScope)!,
      "available",
      executionClass,
      {
        armId: input.armId,
        attemptId: input.attemptId,
        artifactSha256: input.registeredReviewScopeSha256,
      },
    ),
    runnerFact(
      requirementById.get(METHODOLOGY_SCOPE_OBSERVATION_IDS.neutralReadAttachment)!,
      auditUnavailable ? "unavailable" : "available",
      executionClass,
      {
        artifactSha256: neutralReadAttachmentSha256,
        attestationSha256: input.toolPolicy.attachment.attestationSha256,
        auditSha256: audit.snapshotSha256,
        status: auditUnavailable ? "unavailable" : "available",
      },
    ),
  ];
  const result = evaluateScopeCompleteness({
    schemaVersion: 1,
    protocol: "historical-efficacy-v1",
    registeredScopeSha256: scopeRegistrationSha256(requiredObservations),
    requiredObservations,
    runnerFacts,
    modelLimitations: [...input.modelLimitations],
    nonAuthoritativeActivity: {
      toolCallCount: audit.tools.attempted,
      findingCount: input.findingCount,
    },
  });
  if (result.verdict === "complete") {
    throw new Error("methodology scope record v1 cannot certify complete scope without a credential canary");
  }
  const body = {
    schemaVersion: 1 as const,
    protocol: METHODOLOGY_SCOPE_RECORD_PROTOCOL,
    audit,
    result,
  };
  return Object.freeze({ ...body, recordSha256: canonicalJsonSha256(body) });
}

/** Rebuild a persisted record from already-authenticated terminal inputs. */
export function validateMethodologyScopeRecordV1(
  value: unknown,
  expected: Omit<MethodologyScopeRecordInput, "audit">,
): MethodologyScopeRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("methodology scope record must be an object");
  }
  const item = value as Record<string, unknown>;
  if (Object.keys(item).sort().join("\0") !==
      ["audit", "protocol", "recordSha256", "result", "schemaVersion"].sort().join("\0") ||
      item.schemaVersion !== 1 || item.protocol !== METHODOLOGY_SCOPE_RECORD_PROTOCOL) {
    throw new Error("methodology scope record identity is invalid");
  }
  const rebuilt = buildMethodologyScopeRecordV1({ ...expected, audit: item.audit });
  if (canonicalJson(rebuilt) !== canonicalJson(item)) {
    throw new Error("methodology scope record differs from authenticated runner evidence");
  }
  return rebuilt;
}

function identity(input: MethodologyScopeRecordInput): void {
  if (!/^attempt-[0-9]{6}$/.test(input.attemptId) || !["A", "B", "C", "D"].includes(input.armId) ||
      !/^[a-f0-9]{64}$/.test(input.registeredReviewScopeSha256)) {
    throw new Error("methodology scope record input identity is invalid");
  }
  const policy = input.toolPolicy;
  const attachment = policy?.attachment;
  if (policy?.protocol !== "neutral-read-mcp-v2" || policy.serverName !== "source_read" ||
      canonicalJson(policy.enabledTools) !== canonicalJson(["list_tree", "read_file", "search_text"]) ||
      !attachment || attachment.protocol !== "methodology-provider-attachment-reference-v1" ||
      attachment.attemptId !== input.attemptId || attachment.armId !== input.armId ||
      (attachment.executionClass !== "provider" && attachment.executionClass !== "structural-mock") ||
      !/^[a-f0-9]{64}$/.test(attachment.attestationSha256)) {
    throw new Error("methodology scope record tool policy is not the trusted v2 attachment shape");
  }
  if (!Array.isArray(input.modelLimitations) || !Number.isSafeInteger(input.findingCount) || input.findingCount < 0) {
    throw new Error("methodology scope record observations are invalid");
  }
}

function requirementSha256(observationId: string, executionClass: "provider" | "structural-mock",
  artifactSha256: string): string {
  return canonicalJsonSha256({
    protocol: "peregrine-methodology-scope-requirement-v1",
    observationId,
    executionClass,
    artifactSha256,
  });
}

function runnerFact(requirement: RequiredScopeObservation, status: "available" | "unavailable",
  executionClass: "provider" | "structural-mock", details: Record<string, string>): RunnerScopeFact {
  return {
    observationId: requirement.id,
    requirementSha256: requirement.requirementSha256,
    status,
    evidenceSha256: canonicalJsonSha256({
      protocol: "peregrine-methodology-scope-runner-evidence-v1",
      executionClass,
      observationId: requirement.id,
      ...details,
    }),
  };
}
