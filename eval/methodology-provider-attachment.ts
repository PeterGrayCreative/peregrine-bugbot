import { realpathSync, lstatSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExperimentProviderAccess, ProviderExec } from "../src/types.js";
import { canonicalJsonSha256 } from "./experiment.js";
import {
  ACCEPTED_EVAL_RUNTIME_IMAGE,
  createContainedOutputReader,
  createContainedProviderExec,
  type ContainedProviderOptions,
} from "./runtime-containment.js";
import { startReviewReadMcpServer, type ReviewReadMcpAuditSnapshot, type ReviewReadMcpOptions } from "./methodology-read-mcp.js";
import type { ReviewReadToolLimits } from "./methodology-read-tools.js";
import {
  buildMethodologyScopeRecordV1,
  buildMethodologyScopeRecordV2,
  validateMethodologyScopeRecordV2StaticInput,
  type MethodologyScopeRecord,
} from "./methodology-scope-record.js";
import type { ModelScopeLimitation } from "./scope-completeness.js";
import {
  ACCEPTED_METHODOLOGY_EGRESS_IMAGE,
  createMethodologyEgressSupervisor,
  METHODOLOGY_MCP_LIMIT_MAXIMA,
  validateProviderAuthorities,
  type MethodologyEgressAttestation,
  type MethodologyEgressSupervisor,
} from "./methodology-egress.js";

export { ACCEPTED_EVAL_RUNTIME_IMAGE } from "./runtime-containment.js";

const ATTEMPT_ID = /^attempt-[0-9]{6}$/;
const TREE_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const ARM_IDS = ["A", "B", "C", "D"] as const;
const RUNNER = "codex" as const;
const PROFILE = "methodology-review" as const;
const MCP_SERVER_NAME = "source_read" as const;
const MCP_TOOLS = ["list_tree", "read_file", "search_text"] as const;

export type MethodologyArmId = (typeof ARM_IDS)[number];
export type MethodologyProviderAccess = Exclude<ExperimentProviderAccess, "not-applicable">;
export type MethodologyProviderExecutionClass = "provider" | "structural-mock";

/** The four directories exposed to a methodology provider. */
export interface MethodologyProviderAttachmentPaths {
  repo: string;
  home: string;
  assets: string;
  output: string;
}

export interface MethodologyProviderAttachmentRequest {
  attemptId: string;
  armId: MethodologyArmId;
  sourceHeadTree: string;
  paths: MethodologyProviderAttachmentPaths;
}

export type MethodologyProviderReadToolLimits = Omit<ReviewReadToolLimits, "excludedNamespaces"> & {
  readonly excludedNamespaces: readonly string[];
};

/** Numeric transport limits intentionally exclude mutable routing policy. */
export type MethodologyProviderMcpLimits = Pick<ReviewReadMcpOptions,
  "maxRequestBytes" | "maxResponseBytes" | "requestTimeoutMs" | "maxConnections" | "maxRequests">;

export interface MethodologyProviderAttachmentFactoryOptions {
  providerAccess: MethodologyProviderAccess;
  /** Exact provider authorities permitted by the methodology egress gateway. */
  providerAuthorities: readonly string[];
  readToolLimits: MethodologyProviderReadToolLimits;
  mcpLimits: MethodologyProviderMcpLimits;
  image?: string;
  outputByteLimit: number;
}

export interface StructuralMockMethodologyProviderAttachmentFactoryOptions
  extends Omit<MethodologyProviderAttachmentFactoryOptions, "providerAuthorities"> {
  /** Accepted for shared test configuration, but not used by the mock path. */
  providerAuthorities?: readonly string[];
  run: NonNullable<ContainedProviderOptions["run"]>;
}

interface MethodologyProviderAttachmentAttestationBase {
  readonly attemptId: string;
  readonly armId: MethodologyArmId;
  readonly sourceHeadTree: string;
  readonly effectiveRoots: Readonly<MethodologyProviderAttachmentPaths>;
  readonly image: string;
  readonly runner: "codex";
  readonly providerAccess: MethodologyProviderAccess;
  readonly profile: "methodology-review";
  readonly executionClass: MethodologyProviderExecutionClass;
  readonly outputByteLimit: number;
  readonly readLimitsSha256: string;
  readonly mcpLimitsSha256: string;
}

export type MethodologyProviderAttachmentAttestation =
  | (MethodologyProviderAttachmentAttestationBase & {
    readonly schemaVersion: 1;
    readonly protocol: "methodology-provider-attachment-v1";
  })
  | (MethodologyProviderAttachmentAttestationBase & {
    readonly schemaVersion: 2;
    readonly protocol: "methodology-provider-attachment-v2";
    readonly egress: MethodologyProviderEgressAttestation;
  });

export interface MethodologyProviderEgressAttestation {
  readonly protocol: "methodology-egress-supervisor-v1";
  readonly schemaVersion: 1;
  readonly attestationSha256: string;
  readonly network: string;
  readonly proxyUrl: string;
  readonly internalMcpUrl: string;
  readonly providerAuthoritiesSha256: string;
}

type MethodologyProviderAttachmentReferenceBase = {
  readonly schemaVersion: 1 | 2;
  readonly protocol: "methodology-provider-attachment-reference-v1" | "methodology-provider-attachment-reference-v2";
  readonly attemptId: string;
  readonly armId: MethodologyArmId;
  readonly sourceHeadTree: string;
  readonly effectiveRootsSha256: string;
  readonly image: string;
  readonly runner: "codex";
  readonly providerAccess: MethodologyProviderAccess;
  readonly profile: "methodology-review";
  readonly executionClass: MethodologyProviderExecutionClass;
  readonly outputByteLimit: number;
  readonly readLimitsSha256: string;
  readonly mcpLimitsSha256: string;
  readonly attestationSha256: string;
};
type MethodologyProviderAttachmentReferenceV1 = Omit<MethodologyProviderAttachmentReferenceBase,
  "schemaVersion" | "protocol"> & {
  readonly schemaVersion: 1;
  readonly protocol: "methodology-provider-attachment-reference-v1";
};
type MethodologyProviderAttachmentReferenceV2 = Omit<MethodologyProviderAttachmentReferenceBase,
  "schemaVersion" | "protocol"> & {
  readonly schemaVersion: 2;
  readonly protocol: "methodology-provider-attachment-reference-v2";
  readonly egressProtocol: "methodology-egress-supervisor-v1";
  readonly egressAttestationSha256: string;
  readonly egressNetwork: string;
  readonly proxyUrl: string;
  readonly internalMcpUrl: string;
  readonly providerAuthoritiesSha256: string;
};

export type MethodologyProviderNeutralReadMcp = {
    readonly protocol: "neutral-read-mcp-v2";
    readonly url: string;
    readonly serverName: "source_read";
    readonly enabledTools: readonly ["list_tree", "read_file", "search_text"];
    readonly attachment: MethodologyProviderAttachmentReferenceV1;
  };

export type MethodologyProviderEgressNeutralReadMcp = {
    readonly protocol: "neutral-read-mcp-v3";
    readonly url: string;
    readonly serverName: "source_read";
    readonly enabledTools: readonly ["list_tree", "read_file", "search_text"];
    readonly attachment: MethodologyProviderAttachmentReferenceV2;
};

interface MethodologyProviderAttachmentBase {
  readonly runProvider: ProviderExec;
  readonly readProviderOutput: (path: string) => string;
  readonly attestation: MethodologyProviderAttachmentAttestation;
  readonly finalizeScope: MethodologyProviderScopeFinalizer;
  readonly close: () => Promise<void>;
}

export interface MethodologyProviderAttachment extends MethodologyProviderAttachmentBase {
  readonly neutralReadMcp: MethodologyProviderNeutralReadMcp;
  /** Structural/mock attachments retain the original synchronous API. */
  readonly finalizeScope: MethodologyProviderSyncScopeFinalizer;
}

export interface MethodologyProviderEgressAttachment extends MethodologyProviderAttachmentBase {
  readonly neutralReadMcp: MethodologyProviderEgressNeutralReadMcp;
  readonly attestation: Extract<MethodologyProviderAttachmentAttestation, { schemaVersion: 2 }>;
  readonly finalizeScope: MethodologyProviderScopeFinalizer;
}

export interface MethodologyProviderScopeFinalizerInput {
  readonly registeredReviewScopeSha256: string;
  readonly modelLimitations: readonly ModelScopeLimitation[];
  readonly findingCount: number;
}

export type MethodologyProviderScopeFinalizer = (
  input: MethodologyProviderScopeFinalizerInput,
) => MethodologyScopeRecord | Promise<MethodologyScopeRecord>;
export type MethodologyProviderSyncScopeFinalizer = (
  input: MethodologyProviderScopeFinalizerInput,
) => MethodologyScopeRecord;

export type MethodologyProviderAttacher = (
  request: MethodologyProviderAttachmentRequest,
) => Promise<MethodologyProviderAttachment | MethodologyProviderEgressAttachment>;

export type MethodologyProviderLegacyAttacher = (
  request: MethodologyProviderAttachmentRequest,
) => Promise<MethodologyProviderAttachment>;
export type MethodologyProviderEgressAttacher = (
  request: MethodologyProviderAttachmentRequest,
) => Promise<MethodologyProviderEgressAttachment>;

type Binding = {
  request: MethodologyProviderAttachmentRequest;
  requestSha256: string;
  attestation: MethodologyProviderAttachmentAttestation;
};

const ATTACHMENT_BRAND = new WeakSet<object>();
const ATTESTATION_BRAND = new WeakSet<object>();
const ATTACHMENT_BINDINGS = new WeakMap<object, Binding>();
const ATTACHER_BRAND = new WeakSet<MethodologyProviderAttacher>();
const SCOPE_FINALIZER_BRAND = new WeakSet<MethodologyProviderScopeFinalizer>();
const SCOPE_RECORD_BINDINGS = new WeakMap<object, MethodologyProviderScopeFinalizer>();

/**
 * Build the only methodology provider adapter allowed by this protocol. Every
 * request gets a fresh MCP endpoint and an independently frozen binding.
 */
export function createMethodologyProviderAttacher(
  options: MethodologyProviderAttachmentFactoryOptions,
): MethodologyProviderEgressAttacher {
  return createAttacher(options, "provider") as MethodologyProviderEgressAttacher;
}

/** Test-only structural adapter. Its execution class is sealed into every
 * attachment and cannot satisfy provider-connected evidence requirements. */
export function createStructuralMockMethodologyProviderAttacher(
  options: StructuralMockMethodologyProviderAttachmentFactoryOptions,
): MethodologyProviderLegacyAttacher {
  return createAttacher(options, "structural-mock") as MethodologyProviderLegacyAttacher;
}

function createAttacher(
  options: MethodologyProviderAttachmentFactoryOptions | StructuralMockMethodologyProviderAttachmentFactoryOptions,
  executionClass: MethodologyProviderExecutionClass,
): MethodologyProviderAttacher {
  const factory = freezeFactoryOptions(options, executionClass);
  const attach: MethodologyProviderAttacher = async (request) => {
    const snapshot = normalizeRequest(request);
    const roots = snapshot.paths;
    let mcp: Awaited<ReturnType<typeof startReviewReadMcpServer>> | undefined;
    let egress: MethodologyEgressSupervisor | undefined;
    try {
      // A non-loopback listener must supply an initial Host allowlist to the
      // existing server. This inert authority is replaced by the exact,
      // post-bind Docker authority below; port zero is never a valid client
      // authority and therefore does not widen the endpoint.
      mcp = await startReviewReadMcpServer(roots.repo, factory.readToolLimits as ReviewReadToolLimits, {
        ...factory.mcpLimits,
        host: "0.0.0.0",
        port: 0,
        allowedHosts: ["host.docker.internal:1"],
        allowedOrigins: [],
        maxSessions: snapshot.armId === "C" || snapshot.armId === "D" ? 2 : 1,
      });
      const bound = new URL(mcp.url);
      if (bound.hostname !== "0.0.0.0" || !bound.port) throw new Error("MCP listener did not bind an ephemeral port");
      const useEgress = factory.executionClass === "provider";
      const dockerAuthority = `host.docker.internal:${bound.port}`;
      mcp.replaceAuthorizedHosts([dockerAuthority]);
      if (useEgress) {
        egress = await createMethodologyEgressSupervisor({
          attemptId: snapshot.attemptId,
          armId: snapshot.armId,
          sourceHeadTree: snapshot.sourceHeadTree,
          providerAuthorities: factory.providerAuthorities,
          hostMcpPort: Number(bound.port),
          mcpLimits: {
            ...factory.mcpLimits,
            maxHeaderBytes: Math.max(1024, Math.min(factory.mcpLimits.maxRequestBytes, 16_384)),
          },
          image: ACCEPTED_METHODOLOGY_EGRESS_IMAGE,
        });
      }
      const containerUrl = egress?.internalMcpUrl ?? `http://${dockerAuthority}${bound.pathname}`;
      const attestationBase = {
        attemptId: snapshot.attemptId,
        armId: snapshot.armId,
        sourceHeadTree: snapshot.sourceHeadTree,
        effectiveRoots: roots,
        image: useEgress ? ACCEPTED_METHODOLOGY_EGRESS_IMAGE : factory.image,
        runner: RUNNER,
        providerAccess: factory.providerAccess,
        profile: PROFILE,
        executionClass: factory.executionClass,
        outputByteLimit: factory.outputByteLimit,
        readLimitsSha256: canonicalJsonSha256(factory.readToolLimits),
        mcpLimitsSha256: canonicalJsonSha256(factory.mcpLimits),
      };
      const attestation = useEgress
        ? freezeAttestation({ ...attestationBase, schemaVersion: 2, protocol: "methodology-provider-attachment-v2",
          egress: egressAttestation(egress!) })
        : freezeAttestation({ ...attestationBase, schemaVersion: 1, protocol: "methodology-provider-attachment-v1" });
      const runProvider = createContainedProviderExec({
        runner: RUNNER,
        providerAccess: factory.providerAccess,
        checkoutDir: roots.repo,
        assetsDir: roots.assets,
        outputDir: roots.output,
        image: useEgress ? ACCEPTED_METHODOLOGY_EGRESS_IMAGE : factory.image,
        run: factory.run,
        profile: PROFILE,
        ...(egress ? { methodologyEgress: egress.launchCapability } : {}),
      });
      const readProviderOutput = createContainedOutputReader(roots.output, factory.outputByteLimit);
      const attachmentReference = useEgress ? Object.freeze({
        schemaVersion: 2 as const,
        protocol: "methodology-provider-attachment-reference-v2" as const,
        attemptId: snapshot.attemptId,
        armId: snapshot.armId,
        sourceHeadTree: snapshot.sourceHeadTree,
        effectiveRootsSha256: canonicalJsonSha256(roots),
        image: useEgress ? ACCEPTED_METHODOLOGY_EGRESS_IMAGE : factory.image,
        runner: RUNNER,
        providerAccess: factory.providerAccess,
        profile: PROFILE,
        executionClass: factory.executionClass,
        outputByteLimit: factory.outputByteLimit,
        readLimitsSha256: attestation.readLimitsSha256,
        mcpLimitsSha256: attestation.mcpLimitsSha256,
        attestationSha256: canonicalJsonSha256(attestation),
        egressProtocol: egress!.attestation.protocol,
        egressAttestationSha256: egress!.attestation.attestationSha256,
        egressNetwork: egress!.network,
        proxyUrl: egress!.proxyUrl,
        internalMcpUrl: egress!.internalMcpUrl,
        providerAuthoritiesSha256: egress!.attestation.providerAuthoritiesSha256,
      }) : Object.freeze({
        schemaVersion: 1 as const,
        protocol: "methodology-provider-attachment-reference-v1" as const,
        attemptId: snapshot.attemptId,
        armId: snapshot.armId,
        sourceHeadTree: snapshot.sourceHeadTree,
        effectiveRootsSha256: canonicalJsonSha256(roots),
        image: factory.image,
        runner: RUNNER,
        providerAccess: factory.providerAccess,
        profile: PROFILE,
        executionClass: factory.executionClass,
        outputByteLimit: factory.outputByteLimit,
        readLimitsSha256: attestation.readLimitsSha256,
        mcpLimitsSha256: attestation.mcpLimitsSha256,
        attestationSha256: canonicalJsonSha256(attestation),
      });
      const neutralReadMcp = useEgress ? Object.freeze({
        protocol: "neutral-read-mcp-v3" as const,
        url: containerUrl,
        serverName: MCP_SERVER_NAME,
        enabledTools: MCP_TOOLS,
        attachment: attachmentReference,
      }) as MethodologyProviderEgressNeutralReadMcp : Object.freeze({
        protocol: "neutral-read-mcp-v2" as const,
        url: containerUrl,
        serverName: MCP_SERVER_NAME,
        enabledTools: MCP_TOOLS,
        attachment: attachmentReference,
      }) as MethodologyProviderNeutralReadMcp;
      let closed = false;
      let scopeFinalized = false;
      let closePromise: Promise<void> | undefined;
      let mcpClosed = false;
      let finalizerCleanupFailureRecorded = false;
      let sealedMcpAudit: ReviewReadMcpAuditSnapshot | undefined;
      const cleanup = async (): Promise<void> => {
        if (closed) return;
        const errors: Error[] = [];
        // Sidecars must stop/seal before the host MCP is closed. The resulting
        // diagnostics are then copied into the v2 scope record.
        try { await egress?.close(); } catch (error) { errors.push(error instanceof Error ? error : new Error(String(error))); }
        if (!sealedMcpAudit) {
          try { sealedMcpAudit = mcp!.sealAudit(); } catch (error) { errors.push(error instanceof Error ? error : new Error(String(error))); }
        }
        if (!mcpClosed) {
          try { await mcp!.close(); mcpClosed = true; } catch (error) { errors.push(error instanceof Error ? error : new Error(String(error))); }
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, "methodology provider attachment cleanup failed");
        closed = true;
      };
      const close = (): Promise<void> => {
        if (closed) return Promise.resolve();
        if (finalizerCleanupFailureRecorded) {
          // The lifecycle already persisted the cleanup failure. Retry once
          // best-effort from the outer finally without replacing that receipt.
          return cleanup().catch(() => undefined);
        }
        if (!closePromise) {
          const operation = cleanup();
          closePromise = operation.catch((error) => {
            // A transient sidecar/MCP cleanup failure must remain visible to
            // the lifecycle, but a later close can retry the failed steps.
            closePromise = undefined;
            throw error;
          });
        }
        return closePromise;
      };
      const finalizeScope: MethodologyProviderScopeFinalizer = (input) => {
        if (scopeFinalized) throw new Error("methodology provider scope can only be finalized once");
        if (closed) throw new Error("methodology provider scope cannot be finalized after attachment cleanup");
        if (useEgress) {
          // Cleanup is part of finalization, not an outer best-effort step. A
          // failed cleanup is intentionally propagated so the lifecycle can
          // write an interrupted terminal and omit a misleading scope record.
          return (async () => {
            validateMethodologyScopeRecordV2StaticInput({
              attemptId: snapshot.attemptId,
              armId: snapshot.armId,
              registeredReviewScopeSha256: input.registeredReviewScopeSha256,
              toolPolicy: neutralReadMcp as MethodologyProviderEgressNeutralReadMcp,
              modelLimitations: input.modelLimitations,
              findingCount: input.findingCount,
            });
            try {
              await cleanup();
            } catch (error) {
              finalizerCleanupFailureRecorded = true;
              throw error;
            }
            const record = buildMethodologyScopeRecordV2({
              attemptId: snapshot.attemptId,
              armId: snapshot.armId,
              registeredReviewScopeSha256: input.registeredReviewScopeSha256,
              toolPolicy: neutralReadMcp as MethodologyProviderEgressNeutralReadMcp,
              audit: sealedMcpAudit ?? mcp!.sealAudit(),
              sidecarDiagnostics: egress!.auditDiagnostics,
              modelLimitations: input.modelLimitations,
              findingCount: input.findingCount,
            });
            scopeFinalized = true;
            SCOPE_RECORD_BINDINGS.set(record, finalizeScope);
            return record;
          })();
        }
        if (closed) throw new Error("methodology provider scope cannot be finalized after attachment cleanup");
        const record = buildMethodologyScopeRecordV1({
          attemptId: snapshot.attemptId,
          armId: snapshot.armId,
          registeredReviewScopeSha256: input.registeredReviewScopeSha256,
          toolPolicy: neutralReadMcp as Extract<MethodologyProviderNeutralReadMcp, { protocol: "neutral-read-mcp-v2" }>,
          audit: sealedMcpAudit = mcp!.sealAudit(),
          modelLimitations: input.modelLimitations,
          findingCount: input.findingCount,
        });
        scopeFinalized = true;
        SCOPE_RECORD_BINDINGS.set(record, finalizeScope);
        return record;
      };
      Object.freeze(finalizeScope);
      SCOPE_FINALIZER_BRAND.add(finalizeScope);
      const attachment = {
        runProvider,
        readProviderOutput,
        neutralReadMcp,
      } as MethodologyProviderAttachment;
      // Keep the legacy runner-facing enumerable shape (the three execution
      // capabilities) while retaining the trust material for callers that
      // explicitly request it. Both properties remain immutable and branded.
      Object.defineProperties(attachment, {
        attestation: { value: attestation, enumerable: false, writable: false, configurable: false },
        finalizeScope: { value: finalizeScope, enumerable: false, writable: false, configurable: false },
        close: { value: close, enumerable: false, writable: false, configurable: false },
      });
      Object.freeze(attachment);
      ATTACHMENT_BRAND.add(attachment);
      ATTACHMENT_BINDINGS.set(attachment, {
        request,
        requestSha256: canonicalRequestSha256(snapshot),
        attestation,
      });
      return attachment;
    } catch (error) {
      const cleanup: Error[] = [];
      try { await egress?.close(); } catch (cleanupError) { cleanup.push(cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError))); }
      try { await mcp?.close(); } catch (cleanupError) { cleanup.push(cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError))); }
      if (cleanup.length) throw new AggregateError([error, ...cleanup], "methodology provider attachment setup and cleanup failed");
      throw error;
    }
  };
  Object.freeze(attach);
  ATTACHER_BRAND.add(attach);
  return attach;
}

/** Add a pre-start observer without allowing the wrapper to replace the frozen
 * request, returned attachment, or cleanup capability. */
export function observeMethodologyProviderAttacher(
  attacher: MethodologyProviderAttacher,
  observer: (request: MethodologyProviderAttachmentRequest) => void,
): MethodologyProviderAttacher {
  assertMethodologyProviderAttacher(attacher);
  if (typeof observer !== "function") throw new Error("methodology provider attachment observer is invalid");
  const observed: MethodologyProviderAttacher = async (request) => {
    observer(request);
    return attacher(request);
  };
  Object.freeze(observed);
  ATTACHER_BRAND.add(observed);
  return observed;
}

export function assertMethodologyProviderAttacher(value: unknown): asserts value is MethodologyProviderAttacher {
  if (typeof value !== "function" || !ATTACHER_BRAND.has(value as MethodologyProviderAttacher)) {
    throw new Error("historical methodology runner requires the trusted provider attacher");
  }
}

/**
 * Assert both object branding and the original request/attestation identity.
 * A structurally identical object, including one received over JSON, is not a
 * trusted attachment.
 */
export function assertMethodologyProviderAttachment(
  value: unknown,
  request: MethodologyProviderAttachmentRequest,
  attestation?: MethodologyProviderAttachmentAttestation,
): asserts value is MethodologyProviderAttachment | MethodologyProviderEgressAttachment {
  const candidate = value as Partial<MethodologyProviderAttachment> | null;
  const expectedAttestation = attestation ?? candidate?.attestation;
  if (!value || typeof value !== "object" || !ATTACHMENT_BRAND.has(value) ||
      !ATTACHMENT_BINDINGS.has(value) || !expectedAttestation || !ATTESTATION_BRAND.has(expectedAttestation)) {
    throw new Error("methodology provider attachment is not trusted");
  }
  const binding = ATTACHMENT_BINDINGS.get(value)!;
  const normalized = normalizeRequest(request);
  if (binding.request !== request || binding.attestation !== expectedAttestation ||
      typeof candidate?.finalizeScope !== "function" || !SCOPE_FINALIZER_BRAND.has(candidate.finalizeScope) ||
      canonicalRequestSha256(normalized) !== binding.requestSha256 ||
      expectedAttestation.attemptId !== normalized.attemptId ||
      expectedAttestation.armId !== normalized.armId ||
      expectedAttestation.sourceHeadTree !== normalized.sourceHeadTree ||
      canonicalJsonSha256(expectedAttestation.effectiveRoots) !== canonicalJsonSha256(normalized.paths) ||
      !validAttachmentProtocol(expectedAttestation, candidate?.neutralReadMcp as MethodologyProviderNeutralReadMcp | MethodologyProviderEgressNeutralReadMcp | undefined) ||
      canonicalJsonSha256(expectedAttestation) !== candidate.neutralReadMcp?.attachment.attestationSha256 ||
      canonicalJsonSha256(expectedAttestation.effectiveRoots) !== candidate.neutralReadMcp?.attachment.effectiveRootsSha256) {
    throw new Error("methodology provider attachment request or attestation mismatch");
  }
}

function validAttachmentProtocol(
  attestation: MethodologyProviderAttachmentAttestation,
  policy: MethodologyProviderNeutralReadMcp | MethodologyProviderEgressNeutralReadMcp | undefined,
): boolean {
  if (!policy || policy.attachment === undefined) return false;
  if (attestation.schemaVersion === 1) {
    return attestation.protocol === "methodology-provider-attachment-v1" && policy.protocol === "neutral-read-mcp-v2" &&
      policy.attachment.protocol === "methodology-provider-attachment-reference-v1";
  }
  return attestation.protocol === "methodology-provider-attachment-v2" && policy.protocol === "neutral-read-mcp-v3" &&
    policy.attachment.protocol === "methodology-provider-attachment-reference-v2" &&
    attestation.egress !== undefined &&
    policy.attachment.egressAttestationSha256 === attestation.egress.attestationSha256 &&
    policy.attachment.egressNetwork === attestation.egress.network &&
    policy.attachment.proxyUrl === attestation.egress.proxyUrl &&
    policy.attachment.internalMcpUrl === attestation.egress.internalMcpUrl &&
    policy.attachment.providerAuthoritiesSha256 === attestation.egress.providerAuthoritiesSha256 &&
    policy.attachment.internalMcpUrl === policy.url;
}

export function assertMethodologyProviderScopeFinalizer(
  value: unknown,
): asserts value is MethodologyProviderScopeFinalizer {
  if (typeof value !== "function" || !SCOPE_FINALIZER_BRAND.has(value as MethodologyProviderScopeFinalizer)) {
    throw new Error("methodology scope finalizer is not trusted");
  }
}

export function assertMethodologyProviderScopeRecord(
  value: unknown,
  finalizer: unknown,
): asserts value is MethodologyScopeRecord {
  assertMethodologyProviderScopeFinalizer(finalizer);
  if (!value || typeof value !== "object" || SCOPE_RECORD_BINDINGS.get(value) !== finalizer) {
    throw new Error("methodology scope record is not bound to this trusted finalizer");
  }
}

function freezeFactoryOptions(
  options: MethodologyProviderAttachmentFactoryOptions | StructuralMockMethodologyProviderAttachmentFactoryOptions,
  executionClass: MethodologyProviderExecutionClass,
): Readonly<{
  providerAccess: MethodologyProviderAccess;
  readToolLimits: MethodologyProviderReadToolLimits;
  mcpLimits: MethodologyProviderMcpLimits;
  image: string;
  providerAuthorities: readonly string[];
  run: ContainedProviderOptions["run"];
  executionClass: MethodologyProviderExecutionClass;
  outputByteLimit: number;
}> {
  if (!options || typeof options !== "object" || options.providerAccess !== "api-key" && options.providerAccess !== "cli-session") {
    throw new Error("invalid methodology provider access");
  }
  const providerAuthorities = executionClass === "provider"
    ? validateProviderAuthorities(options.providerAuthorities ?? [])
    : options.providerAuthorities === undefined ? Object.freeze([]) : validateProviderAuthorities(options.providerAuthorities);
  const image = executionClass === "provider" ? ACCEPTED_METHODOLOGY_EGRESS_IMAGE : options.image ?? ACCEPTED_EVAL_RUNTIME_IMAGE;
  if (executionClass === "provider" && options.image !== undefined && options.image !== ACCEPTED_METHODOLOGY_EGRESS_IMAGE) {
    throw new Error("methodology provider attachments require the sidecar-capable immutable GHCR digest");
  }
  if (executionClass === "structural-mock" && image !== ACCEPTED_EVAL_RUNTIME_IMAGE) {
    throw new Error("structural methodology mock must use the legacy accepted immutable GHCR digest");
  }
  const run = "run" in options ? options.run : undefined;
  if (executionClass === "provider" && Object.prototype.hasOwnProperty.call(options, "egressRun")) {
    throw new Error("provider attachment cannot inject a Docker executor");
  }
  if (executionClass === "provider" && run !== undefined) throw new Error("provider attachment cannot inject a Docker executor");
  if (executionClass === "structural-mock" && typeof run !== "function") throw new Error("structural mock attachment requires a Docker executor");
  if (!Number.isSafeInteger(options.outputByteLimit) || options.outputByteLimit < 1 || options.outputByteLimit > 100_000_000) {
    throw new Error("invalid provider output byte limit");
  }
  const readToolLimits = freezeReadLimits(options.readToolLimits);
  const mcpLimits = freezeMcpLimits(options.mcpLimits);
  return Object.freeze({ providerAccess: options.providerAccess, readToolLimits, mcpLimits, image,
    run, executionClass, outputByteLimit: options.outputByteLimit, providerAuthorities });
}

function egressAttestation(value: MethodologyEgressSupervisor): MethodologyProviderEgressAttestation {
  const source = value.attestation;
  return Object.freeze({
    protocol: source.protocol,
    schemaVersion: source.schemaVersion,
    attestationSha256: source.attestationSha256,
    network: source.network,
    proxyUrl: value.proxyUrl,
    internalMcpUrl: value.internalMcpUrl,
    providerAuthoritiesSha256: source.providerAuthoritiesSha256,
  });
}

function freezeReadLimits(value: MethodologyProviderReadToolLimits): MethodologyProviderReadToolLimits {
  if (!value || typeof value !== "object" || !Array.isArray(value.excludedNamespaces)) throw new Error("invalid methodology read limits");
  const copy = { ...value, excludedNamespaces: [...value.excludedNamespaces] };
  // createReviewReadTools performs the canonical validation; invoking it on a
  // caller-owned root is not possible here, so retain the exact numeric policy
  // checks locally and let server construction validate the rest.
  for (const name of ["maxIndexEntries", "maxFileBytes", "maxOutputBytes", "maxSearchMatches"] as const) {
    if (!Number.isSafeInteger(copy[name]) || copy[name] < 1 || copy[name] > 100_000_000) throw new Error(`invalid ${name}`);
  }
  if (copy.maxOutputBytes < 512 || copy.excludedNamespaces.some((item) => typeof item !== "string")) throw new Error("invalid methodology read limits");
  return Object.freeze({ ...copy, excludedNamespaces: Object.freeze(copy.excludedNamespaces) });
}

function freezeMcpLimits(value: MethodologyProviderMcpLimits): MethodologyProviderMcpLimits {
  if (!value || typeof value !== "object") throw new Error("invalid methodology MCP limits");
  const keys = ["maxRequestBytes", "maxResponseBytes", "requestTimeoutMs", "maxConnections", "maxRequests"] as const;
  for (const key of keys) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 1 || value[key] > METHODOLOGY_MCP_LIMIT_MAXIMA[key]) {
      throw new Error(`invalid ${key}`);
    }
  }
  if (value.maxResponseBytes < 4096) throw new Error("MCP response limit must be at least 4096 bytes");
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, value[key]])) as MethodologyProviderMcpLimits);
}

function normalizeRequest(value: MethodologyProviderAttachmentRequest): MethodologyProviderAttachmentRequest {
  if (!value || typeof value !== "object" || !ATTEMPT_ID.test(value.attemptId) || !ARM_IDS.includes(value.armId) ||
      !TREE_ID.test(value.sourceHeadTree) || !value.paths || typeof value.paths !== "object") {
    throw new Error("invalid methodology provider attachment request");
  }
  const paths = value.paths;
  const keys = ["repo", "home", "assets", "output"];
  if (Object.keys(paths).sort().join("\0") !== keys.sort().join("\0")) throw new Error("methodology attachment paths must be exact");
  const effective = Object.fromEntries(keys.map((key) => [key, canonicalRoot(paths[key as keyof MethodologyProviderAttachmentPaths], key)])) as unknown as MethodologyProviderAttachmentPaths;
  const roots = Object.values(effective);
  if (roots.some((root, index) => roots.some((other, otherIndex) => index !== otherIndex && overlaps(root, other)))) {
    throw new Error("methodology attachment roots must be distinct and non-overlapping");
  }
  return Object.freeze({ attemptId: value.attemptId, armId: value.armId, sourceHeadTree: value.sourceHeadTree,
    paths: Object.freeze(effective) });
}

function canonicalRoot(value: unknown, label: string): string {
  if (typeof value !== "string" || !isAbsolute(value) || /[\0\r\n,]/.test(value)) throw new Error(`${label} root is invalid`);
  const root = realpathSync(resolve(value));
  if (!lstatSync(root).isDirectory()) throw new Error(`${label} root must be a directory`);
  return root;
}

function overlaps(left: string, right: string): boolean {
  return left === right || inside(left, right) || inside(right, left);
}
function inside(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function canonicalRequestSha256(request: MethodologyProviderAttachmentRequest): string {
  return canonicalJsonSha256({ attemptId: request.attemptId, armId: request.armId,
    sourceHeadTree: request.sourceHeadTree, paths: request.paths });
}

function freezeAttestation(value: MethodologyProviderAttachmentAttestation): MethodologyProviderAttachmentAttestation {
  const attestation = Object.freeze({ ...value, effectiveRoots: Object.freeze({ ...value.effectiveRoots }) });
  ATTESTATION_BRAND.add(attestation);
  return attestation;
}
