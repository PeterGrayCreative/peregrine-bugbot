import type { EvaluationIsolation } from "../src/types.js";
import { canonicalJson, canonicalJsonSha256 } from "./experiment.js";
import { METHODOLOGY_EGRESS_RUNTIME_IMAGE } from "./runtime-containment.js";
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
export const METHODOLOGY_SCOPE_RECORD_V2_PROTOCOL = "historical-methodology-scope-record-v2" as const;
export const METHODOLOGY_SCOPE_RECORD_BOUNDARY =
  "Version 1 is derived only from a trusted attachment's sealed invocation policy and runner-owned MCP audit. It deliberately carries no credential-bearing canary fact and therefore can never certify complete scope; a later canary requires a new versioned record.";
export const METHODOLOGY_SCOPE_RECORD_V2_BOUNDARY =
  "Version 2 binds the neutral-read-mcp-v3 egress attachment, its exact routing policy, and the runner-owned sealed diagnostics for both sidecars. It deliberately carries no credential-bearing canary fact and therefore can never certify complete scope.";

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

export type MethodologyNeutralReadPolicyV3 = Extract<
  NonNullable<EvaluationIsolation["neutralReadMcp"]>,
  { protocol: "neutral-read-mcp-v3" }
>;

export interface MethodologySidecarAuditDiagnostic {
  readonly sidecar: "gateway" | "forwarder";
  readonly ready: boolean;
  readonly sealed: boolean;
  readonly selfDigestValid: boolean;
  readonly lineObserved: boolean;
}

export interface MethodologyScopeRecordV1 {
  schemaVersion: 1;
  protocol: typeof METHODOLOGY_SCOPE_RECORD_PROTOCOL;
  audit: ReviewReadMcpAuditSnapshot;
  result: ScopeCompletenessResult;
  recordSha256: string;
}

export interface MethodologyScopeRecordV2ToolPolicyBinding {
  readonly policySha256: string;
  readonly egressAttestationSha256: string;
  readonly egressNetwork: string;
  readonly proxyUrl: "http://egress-gateway:8081";
  readonly internalMcpUrl: string;
  readonly providerAuthoritiesSha256: string;
}

export interface MethodologyScopeRecordV2 {
  schemaVersion: 2;
  protocol: typeof METHODOLOGY_SCOPE_RECORD_V2_PROTOCOL;
  audit: ReviewReadMcpAuditSnapshot;
  toolPolicy: MethodologyNeutralReadPolicyV3;
  toolPolicyBinding: MethodologyScopeRecordV2ToolPolicyBinding;
  sidecarDiagnostics: readonly [MethodologySidecarAuditDiagnostic, MethodologySidecarAuditDiagnostic];
  result: ScopeCompletenessResult;
  recordSha256: string;
}

export type MethodologyScopeRecord = MethodologyScopeRecordV1 | MethodologyScopeRecordV2;

export interface MethodologyScopeRecordV1Input {
  attemptId: string;
  armId: "A" | "B" | "C" | "D";
  registeredReviewScopeSha256: string;
  toolPolicy: MethodologyNeutralReadPolicyV2;
  audit: unknown;
  modelLimitations: readonly ModelScopeLimitation[];
  findingCount: number;
}

/** Backward-compatible name for callers that build the v1 record. */
export type MethodologyScopeRecordInput = MethodologyScopeRecordV1Input;

export interface MethodologyScopeRecordV2Input {
  attemptId: string;
  armId: "A" | "B" | "C" | "D";
  registeredReviewScopeSha256: string;
  toolPolicy: MethodologyNeutralReadPolicyV3;
  audit: unknown;
  sidecarDiagnostics: readonly MethodologySidecarAuditDiagnostic[];
  modelLimitations: readonly ModelScopeLimitation[];
  findingCount: number;
}

export type MethodologyScopeRecordV2StaticInput = Omit<MethodologyScopeRecordV2Input,
  "audit" | "sidecarDiagnostics">;

/** Validate caller-controlled v2 finalizer input before irreversible cleanup. */
export function validateMethodologyScopeRecordV2StaticInput(
  input: MethodologyScopeRecordV2StaticInput,
): void {
  identityV2(input);
}

/**
 * Build the current fail-closed scope record. The caller must obtain toolPolicy
 * and audit from the branded provider attachment; terminal readers separately
 * bind them back to the sealed invocation and source registration.
 */
export function buildMethodologyScopeRecordV1(input: MethodologyScopeRecordV1Input): MethodologyScopeRecordV1 {
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

/**
 * Build the egress-bound scope record. Sidecar diagnostics are deliberately
 * runner-owned and must be captured after both containers have sealed; an
 * invalid or incomplete summary is rejected rather than treated as clean.
 */
export function buildMethodologyScopeRecordV2(input: MethodologyScopeRecordV2Input): MethodologyScopeRecordV2 {
  validateMethodologyScopeRecordV2StaticInput(input);
  const audit = parseReviewReadMcpAuditSnapshot(input.audit);
  const sidecarDiagnostics = validateSidecarDiagnostics(input.sidecarDiagnostics);
  const policySha256 = canonicalJsonSha256(input.toolPolicy);
  const reference = input.toolPolicy.attachment;
  const providerAuthoritiesSha256 = requiredSha256(
    (reference as unknown as Record<string, unknown>).providerAuthoritiesSha256,
    "tool policy providerAuthoritiesSha256",
  );
  const toolPolicyBinding: MethodologyScopeRecordV2ToolPolicyBinding = {
    policySha256,
    egressAttestationSha256: reference.egressAttestationSha256,
    egressNetwork: reference.egressNetwork,
    proxyUrl: "http://egress-gateway:8081",
    internalMcpUrl: reference.internalMcpUrl,
    providerAuthoritiesSha256,
  };
  const executionClass = reference.executionClass;
  const definitions = [
    {
      id: METHODOLOGY_SCOPE_OBSERVATION_IDS.registeredReviewScope,
      kind: "input" as const,
      artifactSha256: input.registeredReviewScopeSha256,
    },
    {
      id: METHODOLOGY_SCOPE_OBSERVATION_IDS.neutralReadAttachment,
      kind: "tool" as const,
      artifactSha256: policySha256,
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
        artifactSha256: policySha256,
        attestationSha256: reference.attestationSha256,
        egressAttestationSha256: reference.egressAttestationSha256,
        providerAuthoritiesSha256,
        egressNetwork: reference.egressNetwork,
        proxyUrl: reference.proxyUrl,
        internalMcpUrl: reference.internalMcpUrl,
        sidecarDiagnosticsSha256: canonicalJsonSha256(sidecarDiagnostics),
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
    throw new Error("methodology scope record v2 cannot certify complete scope without a credential canary");
  }
  const body = {
    schemaVersion: 2 as const,
    protocol: METHODOLOGY_SCOPE_RECORD_V2_PROTOCOL,
    audit,
    toolPolicy: input.toolPolicy,
    toolPolicyBinding,
    sidecarDiagnostics,
    result,
  };
  return Object.freeze({ ...body, recordSha256: canonicalJsonSha256(body) });
}

/** Rebuild a persisted record from already-authenticated terminal inputs. */
export function validateMethodologyScopeRecordV1(
  value: unknown,
  expected: Omit<MethodologyScopeRecordInput, "audit">,
): MethodologyScopeRecordV1 {
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

/** Rebuild a v2 record from authenticated terminal inputs and exact diagnostics. */
export function validateMethodologyScopeRecordV2(
  value: unknown,
  expected: Omit<MethodologyScopeRecordV2Input, "audit" | "sidecarDiagnostics">,
): MethodologyScopeRecordV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("methodology scope record must be an object");
  }
  const item = value as Record<string, unknown>;
  const keys = ["audit", "protocol", "recordSha256", "result", "schemaVersion", "sidecarDiagnostics", "toolPolicy", "toolPolicyBinding"];
  if (Object.keys(item).sort().join("\0") !== keys.sort().join("\0") ||
      item.schemaVersion !== 2 || item.protocol !== METHODOLOGY_SCOPE_RECORD_V2_PROTOCOL) {
    throw new Error("methodology scope record v2 identity is invalid");
  }
  const rebuilt = buildMethodologyScopeRecordV2({
    ...expected,
    audit: item.audit,
    sidecarDiagnostics: item.sidecarDiagnostics as readonly MethodologySidecarAuditDiagnostic[],
    toolPolicy: expected.toolPolicy,
  });
  if (canonicalJson(rebuilt) !== canonicalJson(item)) {
    throw new Error("methodology scope record v2 differs from authenticated runner evidence");
  }
  return rebuilt;
}

function identityV2(input: MethodologyScopeRecordV2StaticInput): void {
  if (!/^attempt-[0-9]{6}$/.test(input.attemptId) || !["A", "B", "C", "D"].includes(input.armId) ||
      !/^[a-f0-9]{64}$/.test(input.registeredReviewScopeSha256)) {
    throw new Error("methodology scope record input identity is invalid");
  }
  const policy = input.toolPolicy;
  const attachment = policy?.attachment;
  const policyKeys = ["attachment", "enabledTools", "protocol", "serverName", "url"];
  const attachmentKeys = [
    "armId", "attemptId", "attestationSha256", "egressAttestationSha256", "egressNetwork",
    "egressProtocol", "effectiveRootsSha256", "executionClass", "image", "internalMcpUrl",
    "mcpLimitsSha256", "outputByteLimit", "profile", "providerAccess", "proxyUrl", "protocol",
    "providerAuthoritiesSha256", "readLimitsSha256", "runner", "schemaVersion", "sourceHeadTree",
  ];
  const attachmentAllowedKeys = attachmentKeys;
  if (!policy || Object.keys(policy).sort().join("\0") !== policyKeys.sort().join("\0") ||
      policy.protocol !== "neutral-read-mcp-v3" || policy.serverName !== "source_read" ||
      canonicalJson(policy.enabledTools) !== canonicalJson(["list_tree", "read_file", "search_text"]) ||
      !attachment || typeof attachment !== "object" ||
      Object.keys(attachment).some((key) => !attachmentAllowedKeys.includes(key)) ||
      attachmentKeys.some((key) => !Object.hasOwn(attachment, key)) ||
      attachment.schemaVersion !== 2 || attachment.protocol !== "methodology-provider-attachment-reference-v2" ||
      attachment.egressProtocol !== "methodology-egress-supervisor-v1" ||
      attachment.attemptId !== input.attemptId || attachment.armId !== input.armId ||
      attachment.executionClass !== "provider" || attachment.runner !== "codex" ||
      attachment.profile !== "methodology-review" || attachment.providerAccess !== "api-key" && attachment.providerAccess !== "cli-session" ||
      policy.url !== attachment.internalMcpUrl || attachment.proxyUrl !== "http://egress-gateway:8081" ||
      !/^http:\/\/mcp-forwarder:8082\/mcp\/[a-f0-9]{64}$/.test(attachment.internalMcpUrl) ||
      !/^[a-z0-9][a-z0-9_.-]{0,62}$/.test(attachment.egressNetwork) ||
      ["bridge", "host", "none"].includes(attachment.egressNetwork) ||
      !Number.isSafeInteger(attachment.outputByteLimit) || attachment.outputByteLimit < 1 ||
      attachment.outputByteLimit > 100_000_000 ||
      !/^[a-f0-9]{64}$/.test(attachment.attestationSha256) ||
      !/^[a-f0-9]{64}$/.test(attachment.egressAttestationSha256) ||
      !/^[a-f0-9]{64}$/.test(attachment.effectiveRootsSha256) ||
      !/^[a-f0-9]{64}$/.test(attachment.readLimitsSha256) ||
      !/^[a-f0-9]{64}$/.test(attachment.mcpLimitsSha256) ||
      attachment.image !== METHODOLOGY_EGRESS_RUNTIME_IMAGE ||
      typeof attachment.sourceHeadTree !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(attachment.sourceHeadTree)) {
    throw new Error("methodology scope record tool policy is not the trusted v3 attachment shape");
  }
  requiredSha256((attachment as unknown as Record<string, unknown>).providerAuthoritiesSha256,
    "tool policy providerAuthoritiesSha256");
  if (!Array.isArray(input.modelLimitations) || !Number.isSafeInteger(input.findingCount) || input.findingCount < 0 ||
      input.modelLimitations.some((limitation) => !validModelLimitation(limitation))) {
    throw new Error("methodology scope record observations are invalid");
  }
}

function validModelLimitation(value: unknown): value is ModelScopeLimitation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const allowed = new Set(["kind", "detail", "observationId"]);
  if (Object.keys(item).some((key) => !allowed.has(key)) || !Object.hasOwn(item, "kind") || !Object.hasOwn(item, "detail")) return false;
  if (!["required-context-unavailable", "input-unavailable-or-truncated", "required-tool-unavailable", "unable-to-complete"].includes(item.kind as string) ||
      typeof item.detail !== "string" || !item.detail.trim() || item.detail.length > 4_000) return false;
  if (item.observationId !== undefined &&
      (typeof item.observationId !== "string" || !Object.values(METHODOLOGY_SCOPE_OBSERVATION_IDS).includes(item.observationId as never))) return false;
  return true;
}

function validateSidecarDiagnostics(
  value: readonly MethodologySidecarAuditDiagnostic[],
): readonly [MethodologySidecarAuditDiagnostic, MethodologySidecarAuditDiagnostic] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error("methodology scope record requires exactly gateway and forwarder sidecar diagnostics");
  }
  const result = value.map((diagnostic, index) => {
    if (!diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) {
      throw new Error("methodology sidecar diagnostic is invalid");
    }
    const keys = ["lineObserved", "ready", "sealed", "selfDigestValid", "sidecar"];
    if (Object.keys(diagnostic).sort().join("\0") !== keys.sort().join("\0")) {
      throw new Error("methodology sidecar diagnostic fields are invalid");
    }
    const expectedSidecar = index === 0 ? "gateway" : "forwarder";
    if (diagnostic.sidecar !== expectedSidecar) {
      throw new Error("methodology sidecar diagnostics must contain one gateway followed by one forwarder");
    }
    for (const field of ["ready", "sealed", "selfDigestValid", "lineObserved"] as const) {
      if (diagnostic[field] !== true) {
        throw new Error(`methodology ${expectedSidecar} sidecar diagnostic ${field} is not proven`);
      }
    }
    return Object.freeze({
      sidecar: diagnostic.sidecar,
      ready: true,
      sealed: true,
      selfDigestValid: true,
      lineObserved: true,
    });
  });
  return Object.freeze([result[0]!, result[1]!]);
}

function requiredSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256`);
  }
  return value;
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
