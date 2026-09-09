import { realpathSync, lstatSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { EvaluationIsolation, ExperimentProviderAccess, ProviderExec } from "../src/types.js";
import { canonicalJsonSha256 } from "./experiment.js";
import {
  ACCEPTED_EVAL_RUNTIME_IMAGE,
  createContainedOutputReader,
  createContainedProviderExec,
  type ContainedProviderOptions,
} from "./runtime-containment.js";
import {
  REVIEW_READ_MCP_PROTOCOL,
  startReviewReadMcpServer,
  type ReviewReadMcpOptions,
} from "./methodology-read-mcp.js";
import type { ReviewReadToolLimits } from "./methodology-read-tools.js";

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
  readToolLimits: MethodologyProviderReadToolLimits;
  mcpLimits: MethodologyProviderMcpLimits;
  image?: string;
  outputByteLimit: number;
}

export interface StructuralMockMethodologyProviderAttachmentFactoryOptions
  extends MethodologyProviderAttachmentFactoryOptions {
  run: NonNullable<ContainedProviderOptions["run"]>;
}

export interface MethodologyProviderAttachmentAttestation {
  readonly schemaVersion: 1;
  readonly protocol: "methodology-provider-attachment-v1";
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

export type MethodologyProviderNeutralReadMcp = NonNullable<EvaluationIsolation["neutralReadMcp"]> & {
  readonly protocol: "neutral-read-mcp-v2";
  readonly attachment: NonNullable<NonNullable<EvaluationIsolation["neutralReadMcp"]>["attachment"]>;
};

export interface MethodologyProviderAttachment {
  readonly runProvider: ProviderExec;
  readonly readProviderOutput: (path: string) => string;
  readonly neutralReadMcp: MethodologyProviderNeutralReadMcp;
  readonly attestation: MethodologyProviderAttachmentAttestation;
  readonly close: () => Promise<void>;
}

export type MethodologyProviderAttacher = (
  request: MethodologyProviderAttachmentRequest,
) => Promise<MethodologyProviderAttachment>;

type Binding = {
  request: MethodologyProviderAttachmentRequest;
  requestSha256: string;
  attestation: MethodologyProviderAttachmentAttestation;
};

const ATTACHMENT_BRAND = new WeakSet<object>();
const ATTESTATION_BRAND = new WeakSet<object>();
const ATTACHMENT_BINDINGS = new WeakMap<object, Binding>();
const ATTACHER_BRAND = new WeakSet<MethodologyProviderAttacher>();

/**
 * Build the only methodology provider adapter allowed by this protocol. Every
 * request gets a fresh MCP endpoint and an independently frozen binding.
 */
export function createMethodologyProviderAttacher(
  options: MethodologyProviderAttachmentFactoryOptions,
): MethodologyProviderAttacher {
  return createAttacher(options, "provider");
}

/** Test-only structural adapter. Its execution class is sealed into every
 * attachment and cannot satisfy provider-connected evidence requirements. */
export function createStructuralMockMethodologyProviderAttacher(
  options: StructuralMockMethodologyProviderAttachmentFactoryOptions,
): MethodologyProviderAttacher {
  return createAttacher(options, "structural-mock");
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
      const dockerAuthority = `host.docker.internal:${bound.port}`;
      mcp.replaceAuthorizedHosts([dockerAuthority]);
      const containerUrl = `http://${dockerAuthority}${bound.pathname}`;
      const attestation = freezeAttestation({
        schemaVersion: 1,
        protocol: "methodology-provider-attachment-v1",
        attemptId: snapshot.attemptId,
        armId: snapshot.armId,
        sourceHeadTree: snapshot.sourceHeadTree,
        effectiveRoots: roots,
        image: factory.image,
        runner: RUNNER,
        providerAccess: factory.providerAccess,
        profile: PROFILE,
        executionClass: factory.executionClass,
        outputByteLimit: factory.outputByteLimit,
        readLimitsSha256: canonicalJsonSha256(factory.readToolLimits),
        mcpLimitsSha256: canonicalJsonSha256(factory.mcpLimits),
      });
      const runProvider = createContainedProviderExec({
        runner: RUNNER,
        providerAccess: factory.providerAccess,
        checkoutDir: roots.repo,
        assetsDir: roots.assets,
        outputDir: roots.output,
        image: factory.image,
        run: factory.run,
        profile: PROFILE,
      });
      const readProviderOutput = createContainedOutputReader(roots.output, factory.outputByteLimit);
      const attachmentReference = Object.freeze({
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
      let closed = false;
      const close = async (): Promise<void> => {
        if (closed) return;
        closed = true;
        await mcp!.close();
      };
      const attachment = {
        runProvider,
        readProviderOutput,
        neutralReadMcp: Object.freeze({
          protocol: "neutral-read-mcp-v2",
          url: containerUrl,
          serverName: MCP_SERVER_NAME,
          enabledTools: MCP_TOOLS,
          attachment: attachmentReference,
        }),
      } as MethodologyProviderAttachment;
      // Keep the legacy runner-facing enumerable shape (the three execution
      // capabilities) while retaining the trust material for callers that
      // explicitly request it. Both properties remain immutable and branded.
      Object.defineProperties(attachment, {
        attestation: { value: attestation, enumerable: false, writable: false, configurable: false },
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
      await mcp?.close();
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
): asserts value is MethodologyProviderAttachment {
  const candidate = value as Partial<MethodologyProviderAttachment> | null;
  const expectedAttestation = attestation ?? candidate?.attestation;
  if (!value || typeof value !== "object" || !ATTACHMENT_BRAND.has(value) ||
      !ATTACHMENT_BINDINGS.has(value) || !expectedAttestation || !ATTESTATION_BRAND.has(expectedAttestation)) {
    throw new Error("methodology provider attachment is not trusted");
  }
  const binding = ATTACHMENT_BINDINGS.get(value)!;
  const normalized = normalizeRequest(request);
  if (binding.request !== request || binding.attestation !== expectedAttestation ||
      canonicalRequestSha256(normalized) !== binding.requestSha256 ||
      expectedAttestation.attemptId !== normalized.attemptId ||
      expectedAttestation.armId !== normalized.armId ||
      expectedAttestation.sourceHeadTree !== normalized.sourceHeadTree ||
      canonicalJsonSha256(expectedAttestation.effectiveRoots) !== canonicalJsonSha256(normalized.paths) ||
      candidate?.neutralReadMcp?.protocol !== "neutral-read-mcp-v2" ||
      canonicalJsonSha256(expectedAttestation) !== candidate.neutralReadMcp.attachment.attestationSha256 ||
      canonicalJsonSha256(expectedAttestation.effectiveRoots) !== candidate.neutralReadMcp.attachment.effectiveRootsSha256) {
    throw new Error("methodology provider attachment request or attestation mismatch");
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
  run: ContainedProviderOptions["run"];
  executionClass: MethodologyProviderExecutionClass;
  outputByteLimit: number;
}> {
  if (!options || typeof options !== "object" || options.providerAccess !== "api-key" && options.providerAccess !== "cli-session") {
    throw new Error("invalid methodology provider access");
  }
  const image = options.image ?? ACCEPTED_EVAL_RUNTIME_IMAGE;
  if (image !== ACCEPTED_EVAL_RUNTIME_IMAGE) throw new Error("evaluation runtime image must equal the accepted immutable GHCR digest");
  const run = "run" in options ? options.run : undefined;
  if (executionClass === "provider" && run !== undefined) throw new Error("provider attachment cannot inject a Docker executor");
  if (executionClass === "structural-mock" && typeof run !== "function") throw new Error("structural mock attachment requires a Docker executor");
  if (!Number.isSafeInteger(options.outputByteLimit) || options.outputByteLimit < 1 || options.outputByteLimit > 100_000_000) {
    throw new Error("invalid provider output byte limit");
  }
  const readToolLimits = freezeReadLimits(options.readToolLimits);
  const mcpLimits = freezeMcpLimits(options.mcpLimits);
  return Object.freeze({ providerAccess: options.providerAccess, readToolLimits, mcpLimits, image,
    run, executionClass, outputByteLimit: options.outputByteLimit });
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
  for (const key of keys) if (!Number.isSafeInteger(value[key]) || value[key] < 1 || value[key] > 100_000_000) throw new Error(`invalid ${key}`);
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
