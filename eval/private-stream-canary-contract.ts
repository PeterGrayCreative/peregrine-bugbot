import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "../src/core/paths.js";
import { digest, freeze, hash, same, sha } from "./prediction-contract.js";
import { predictionExecutionSourceManifest } from "./prediction-execution-freeze.js";
import { predictionMcpToolDefinitions } from "./methodology-read-mcp.js";
import { SAFE_CANARY_PROMPT } from "./prediction-safe-canary.js";
import { predictionSafeCanaryCommand, SAFE_CANARY_MCP_URL } from "./prediction-safe-canary-command.js";
import { SAFE_CANARY_STREAM_BYTES } from "./prediction-safe-canary-stream.js";
import { PRIVATE_STREAM_IMAGE_ACCEPTANCE_V2, PRIVATE_STREAM_IMAGE_GATE_FILE_SHA256, verifyAcceptedPrivateStreamImage } from "./private-stream-image-acceptance-v2.js";

export const PRIVATE_STREAM_CANARY_AUTHORIZATION = "Move forward with anything you need to. You have my permission.";
export const PRIVATE_STREAM_CANARY_BASES = freeze({
  public: "904795f4f6c6a3b87bbd8eafbe696fc67e29c3fa", private: "c4875bc503ea52c4e8669a121e29a25825ca651f",
});
export const PRIVATE_STREAM_CANARY_HISTORY = freeze({
  finalImageGateSha256: "de09b32cd3dad2060cee8922a922f21ee32f4f411248ca5e023688b8d63903d3",
  safeCanaryFreezeSha256: "4169e8d08c918a1c4ebc60881253f0e1d71b8b48a4942f07613d56838462b2a9",
  consumedTombstoneSha256: "943e17d383bf684149546aea3a6f7b2e192495b5a410cfc3ff67e277d1279115",
  earlierAuthorizationFileSha256: "81a1a658b0c44a566447051e103bbccca89d4329af714809e749d94e1ef302f8",
  reviewLedgerSha256: "19136d8c6d7bf74a935c30d2d6e9faff1fde026faaf2029282286ef2a1ecf9c6",
  previousCanaryConsumed: true, previousOutcome: "FAIL", previousEligibility: "not-eligible",
  previousProviderCalls: null, previousSupportedClientLaunches: 0, unstartedReviewAttempts: 64, reviewAttemptsStarted: 0,
});
export const PRIVATE_STREAM_CANARY_POLICY = freeze({
  canaryId: "prediction-private-stream-sol-low-v1-000001",
  model: "gpt-5.6-sol", effort: "low", providerAccess: "cli-session", attempts: 1, retries: 0,
  reviewAttempts: 0, production: false, delegation: false,
  wallMs: 1_200_000, readCalls: 100, readBytes: 2_000_000, streamBytes: SAFE_CANARY_STREAM_BYTES,
  deadline: "monotonic-start-before-preparation; abort-reads-and-active-exec; uncancelled-cleanup",
  endpoint: SAFE_CANARY_MCP_URL, command: predictionSafeCanaryCommand(), promptSha256: sha(SAFE_CANARY_PROMPT),
  catalog: { complete: true, paginationComplete: true, tools: predictionMcpToolDefinitions(), resources: [], resourceTemplates: [], prompts: [] },
  session: { provider: "codex", cliVersion: "0.152.0", producerProfile: "private-stream-enum-only-v1",
    authenticated: true, isolated: true, fresh: true, credentialBytesInspected: false,
    credentialBytesPersisted: false, ambientHomeMounted: false, apiKeyFallback: false, pluginsEnabled: false },
  containment: { readOnlyRoot: true, droppedCapabilities: true, noNewPrivileges: true, emptyReadOnlyWorkspace: true,
    schemaOnlyAssets: true, isolatedHome: true, isolatedNetwork: true, allowlistedProviderGateway: true,
    fixedTokenlessClientEndpoint: true, secretOnlyInHostReaderAndForwarder: true, sidecarPidEnvSocketVisible: false,
    hostOutputMount: false, lastMessageFile: false, rawStreamsPersisted: false },
  servedIdentityCapture: "independently-authenticated-provider-metadata-or-explicit-unknown",
  providerAccounting: "client-launch-count-is-not-provider-call-count; unknown-is-null; terminal-input-plus-output-once",
  scientificEligibility: "not-eligible; no equal-compute, exact-backend or efficacy claim from infrastructure canary",
});

const acceptedImage = PRIVATE_STREAM_IMAGE_ACCEPTANCE_V2;
export const PRIVATE_STREAM_CANARY_IMAGE = freeze({
  image: acceptedImage.image, acceptanceSha256: digest(acceptedImage),
  sourceCommit: acceptedImage.sourceCommit, sourceFreezeSha256: acceptedImage.sourceFreezeSha256,
  workflow: acceptedImage.workflow, workflowRunId: acceptedImage.workflowRunId, workflowRunAttempt: acceptedImage.workflowRunAttempt,
  platforms: acceptedImage.platforms, artifacts: acceptedImage.artifacts, imageGateSha256: PRIVATE_STREAM_IMAGE_GATE_FILE_SHA256,
  finalImageGateSha256: PRIVATE_STREAM_CANARY_HISTORY.finalImageGateSha256,
  attestationBundleSha256: acceptedImage.files["attestations.json"].sha256,
  attestationVerificationSha256: acceptedImage.files["attestation-verification-v2.json"].sha256,
});

export const PRIVATE_STREAM_CANARY_PUBLIC_FILES = [
  "docs/validation/2026-09-16-private-stream-canary-contract.md",
  "eval/private-stream-canary-contract.ts", "eval/private-stream-canary-preflight.ts",
  "tests/eval-private-stream-canary-contract.test.ts",
] as const;

/** Source preparation only; installed dependency bytes and live runtime remain external. */
export function privateStreamCanarySource(root = packageRoot()) {
  const previous = predictionExecutionSourceManifest(root);
  const paths = new Set([...previous.files.map(file => file.path), ...PRIVATE_STREAM_CANARY_PUBLIC_FILES,
    "eval/private-stream-image-acceptance.ts", "eval/private-stream-image-acceptance-v1.json",
    "eval/private-stream-image-acceptance-v2.ts", "eval/private-stream-image-gate-v1.json"]);
  const files = [...paths].sort().map(path => {
    if (!lstatSync(join(root, path)).isFile()) throw new Error("source must be a regular file");
    const bytes = readFileSync(join(root, path)); return { path, bytes: bytes.length, sha256: sha(bytes) };
  });
  return freeze({ files, sha256: digest(files), boundary: previous.boundary });
}

interface PreparationInput {
  imageGate: Buffer; finalImageGate: Buffer; safeCanaryFreeze: Buffer; consumedTombstone: Buffer;
  earlierAuthorization: Buffer; currentAuthorization: string; readPublication: (path: string) => Buffer; root?: string;
}
function authenticatedJson(bytes: Buffer, expected: string) {
  same(sha(bytes), expected, "immutable predecessor bytes mismatch"); return JSON.parse(bytes.toString());
}

/** Exact historical bytes plus relayed current authorization, never an execution capability. */
export function preparePrivateStreamCanaryContract(input: PreparationInput) {
  const accepted = verifyAcceptedPrivateStreamImage(input.imageGate, input.readPublication);
  const finalGate = authenticatedJson(input.finalImageGate, PRIVATE_STREAM_CANARY_HISTORY.finalImageGateSha256);
  same([finalGate.verdict, finalGate.reviewedPublicCommit, finalGate.reviewedPrivateCommit],
    ["PASS", "327d4857550c8b242cc5bb6914ab9ae899ec52f8", "e0a02cb34e44329c9ebb31969a73e236f3c14b9e"], "final acceptance gate mismatch");
  same([finalGate.image, finalGate.sourceCommit, finalGate.workflowRunId, finalGate.workflowRunAttempt],
    [accepted.image, accepted.sourceCommit, accepted.workflowRunId, accepted.workflowRunAttempt], "final image/source/run mismatch");
  const prior = authenticatedJson(input.safeCanaryFreeze, PRIVATE_STREAM_CANARY_HISTORY.safeCanaryFreezeSha256);
  const tombstone = authenticatedJson(input.consumedTombstone, PRIVATE_STREAM_CANARY_HISTORY.consumedTombstoneSha256);
  same([tombstone.attemptConsumed, tombstone.retryAuthorized, tombstone.providerCalls], [true, false, null], "consumed canary changed");
  same(sha(input.earlierAuthorization), PRIVATE_STREAM_CANARY_HISTORY.earlierAuthorizationFileSha256, "earlier authorization changed");
  same(input.currentAuthorization, PRIVATE_STREAM_CANARY_AUTHORIZATION, "exact coordinator-relayed current authorization required");
  const registration = prior.registration;
  same([registration.reviewLedgerSha256, registration.unstartedReviewAttempts, registration.reviewAttemptsStarted],
    [PRIVATE_STREAM_CANARY_HISTORY.reviewLedgerSha256, 64, 0], "review ledger changed");
  same([registration.prompt, registration.command, registration.limits.wallMs, registration.toolBinding.definitions],
    [SAFE_CANARY_PROMPT, PRIVATE_STREAM_CANARY_POLICY.command, 1_200_000, predictionMcpToolDefinitions()], "frozen canary policy changed");
  const body = {
    kind: "private-stream-canary-execution-contract-v1", bases: PRIVATE_STREAM_CANARY_BASES,
    source: privateStreamCanarySource(input.root), policy: PRIVATE_STREAM_CANARY_POLICY,
    image: PRIVATE_STREAM_CANARY_IMAGE,
    scope: { sourceAttemptId: registration.sourceAttemptId as string, mountSha256: hash(registration.mountSha256),
      rawScopeSha256: hash(registration.rawScopeSha256), schemaSha256: hash(registration.schemaSha256),
      prompt: SAFE_CANARY_PROMPT, registrationSha256: hash(registration.sha256) },
    history: PRIVATE_STREAM_CANARY_HISTORY,
    authorization: { text: input.currentAuthorization, sha256: sha(input.currentAuthorization),
      provenance: "coordinator-relayed exact user text; not a cryptographic signature or independently retrieved message",
      scope: "one new private-stream Sol-low infrastructure canary after exact contract gate and session preflight",
      earlierText: input.earlierAuthorization.toString().trimEnd(), earlierAuthorizationConsumed: true,
      broaderProviderExperimentsAuthorized: false },
    readiness: { sourcePrepared: true, userAuthorizationRecorded: true, imageAccepted: true,
      independentExecutionGatePassed: false, sessionPreflightPassed: false, capabilityIssued: false,
      runtimeReady: false, executionReady: false, providerAuthorized: false, canaryAuthorized: false,
      retryAuthorized: false, batchAuthorized: false, productionAuthorized: false },
    providerCalls: 0,
  };
  return freeze({ ...body, sha256: digest(body) });
}
export type PrivateStreamCanaryContract = ReturnType<typeof preparePrivateStreamCanaryContract>;

/** Deliberately no provider/Docker adapter is introduced by source preparation. */
export function requirePrivateStreamCanaryDispatch(_input: unknown): never {
  throw new Error("private-stream canary execution unavailable: fresh exact execution-contract gate, session preflight and separately integrated single-use dispatcher required");
}
