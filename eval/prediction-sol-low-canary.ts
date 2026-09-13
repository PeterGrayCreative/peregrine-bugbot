import { digest, exact, freeze, hash, same, sha, text } from "./prediction-contract.js";
import { PREDICTION_CLI_BRIDGE_POLICY, PREDICTION_SOL_LOW_CANARY_POLICY } from "./prediction-cli-policy.js";
import { METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE } from "./methodology-runtime-image.js";
import { predictionMcpToolDefinitions } from "./methodology-read-mcp.js";
import { predictionSolLowCanaryCommand } from "./prediction-sol-low-command.js";

export const SOL_LOW_CANARY_USER_AUTHORIZATION = "I authorize the canary only run. Use a sol low subagent to run the canary.";
interface TrustedBytes { bytes: string; expectedSha256: string }
export interface PredictionSolLowCanaryAuthority {
  r4Freeze: TrustedBytes; bridgeFreeze: TrustedBytes; assessmentFreeze: TrustedBytes; userAuthorization: TrustedBytes;
}
function trusted(input: TrustedBytes, kind: string): any {
  exact(input, ["bytes", "expectedSha256"], "trusted amendment input");
  same(sha(input.bytes), hash(input.expectedSha256), "amendment authority byte drift");
  const value = JSON.parse(input.bytes); same(value.kind, kind, "amendment predecessor kind drift"); return value;
}
function seal(value: any) { const { sha256, ...body } = value; same(digest(body), hash(sha256), "amendment predecessor seal drift"); }

/** Prospective registration only. The supplied text is an operator assertion,
 * never discovered authentication, a runtime capability, or batch permission. */
export function preparePredictionSolLowCanary(authority: PredictionSolLowCanaryAuthority) {
  const r4 = trusted(authority.r4Freeze, "prediction-r4-preauthorization-freeze-v1"), bridge = trusted(authority.bridgeFreeze, "prediction-cli-bridge-freeze-v1");
  const assessment = trusted(authority.assessmentFreeze, "prediction-canary-assessment-freeze-v4"), pack = r4.package, p = pack.preauthorization, old = pack.canary, first = p.attempts[0];
  for (const prior of [r4, bridge, assessment]) same([prior.providerCalls, prior.providerAuthorized, prior.executionReady], [0, false, false], "predecessor authorization or execution drift");
  same([assessment.reviewAttemptsStarted, assessment.unstartedReviewAttempts, assessment.batchAuthorized], [0, 64, false], "predecessor review ledger drift");
  seal(p); seal(old); same(digest({ preauthorization: p, canary: old }), pack.sha256, "original package seal drift");
  same([old.preauthorizationSha256, bridge.predecessorFreezeSha256, bridge.packageSha256, bridge.canarySha256],
    [p.sha256, authority.r4Freeze.expectedSha256, pack.sha256, old.sha256], "original canary/bridge cross-binding drift");
  same(bridge.bridgePolicy, PREDICTION_CLI_BRIDGE_POLICY, "original high bridge policy drift");
  same(bridge.bridgePolicySha256, digest(PREDICTION_CLI_BRIDGE_POLICY), "original high policy seal drift");
  same([p.runtimeAcceptance, old.runtimeAcceptance, bridge.acceptedRuntime.acceptance], [METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE, METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE, METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE], "accepted runtime drift");
  same(bridge.acceptedRuntime.freezeSha256, p.authoritySha256.runtimeAcceptanceFreeze, "runtime predecessor cross-binding drift");
  for (const [path, expected] of [["r4-preauthorization-v1/freeze-1.json", authority.r4Freeze.expectedSha256], ["cli-bridge-v1/freeze-1.json", authority.bridgeFreeze.expectedSha256]]) {
    if (!assessment.privateBindings.some((b: any) => b.path === `ai-exploratory/prediction-development-v1/${path}` && b.sha256 === expected)) throw new Error("assessment predecessor authority mismatch");
  }
  same(old.route, { model: "gpt-5.6-sol", effort: "high", providerAccess: "cli-session", exactServedModel: null, exactServedVersion: null }, "original high route drift");
  same(p.route, old.route, "original review route drift");
  same([old.sourceAttemptId, old.sourceCaseId, old.mountSha256, old.maximumAttempts, old.scheduledReviewAttemptsConsumed, old.retries, old.delegation], [first.id, first.caseId, first.mountSha256, 1, 0, 0, false], "original canary scope drift");
  same(old.toolBinding.definitions, predictionMcpToolDefinitions(), "four-tool definition drift");
  same(old.caps.hard, { wallMs: 1200000, readCalls: 100, returnedBytes: 2000000, retries: 0, delegation: false, concurrentAttempts: 1 }, "registered canary caps drift");
  if (p.attempts.length !== 64 || p.attempts.some((a: any) => a.status !== "unstarted" || a.providerCalls !== 0 || a.output !== null || a.servedIdentity !== null)) throw new Error("review slot mutation");
  same(sha(old.prompt), old.promptSha256, "original neutral prompt drift");
  exact(authority.userAuthorization, ["bytes", "expectedSha256"], "operator authorization assertion");
  same(authority.userAuthorization.bytes, SOL_LOW_CANARY_USER_AUTHORIZATION, "exact canary-only user authorization required");
  same(sha(authority.userAuthorization.bytes), hash(authority.userAuthorization.expectedSha256), "user authorization byte drift");
  const route = { ...old.route, effort: "low" }, canaryId = "prediction-infrastructure-canary-sol-low-000001";
  const body = { kind: "prediction-sol-low-canary-amendment-v1", canaryId, predecessor: {
    r4FreezeSha256: authority.r4Freeze.expectedSha256, packageSha256: pack.sha256, preauthorizationSha256: p.sha256, canarySha256: old.sha256,
    bridgeFreezeSha256: authority.bridgeFreeze.expectedSha256, assessmentFreezeSha256: authority.assessmentFreeze.expectedSha256, runtimeFreezeSha256: p.authoritySha256.runtimeAcceptanceFreeze },
    userAuthorization: { text: authority.userAuthorization.bytes, sha256: authority.userAuthorization.expectedSha256, provenance: "operator-provided authorization assertion",
      context: "User statement in current coordinating Codex thread, relayed by operator; exact thread ID and independent retrieval evidence unavailable.", independentlyAuthenticated: false },
    sourceAttemptId: old.sourceAttemptId, sourceCaseId: old.sourceCaseId, mountSha256: old.mountSha256, rawScopeSha256: first.rawScopeSha256,
    prompt: old.prompt, promptSha256: old.promptSha256, route, routeSha256: digest(route), caps: old.caps, capsSha256: digest(old.caps),
    toolBinding: old.toolBinding, toolsSha256: digest(old.toolBinding), runtimeAcceptance: METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE,
    runtimeSha256: digest(METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE), policy: PREDICTION_SOL_LOW_CANARY_POLICY, policySha256: digest(PREDICTION_SOL_LOW_CANARY_POLICY),
    commandTemplate: predictionSolLowCanaryCommand("http://mcp-forwarder:8082/mcp/" + "0".repeat(64)),
    maximumAttempts: 1, retries: 0, delegation: false, scheduledReviewAttemptsConsumed: 0, reviewAttemptsAllowed: 0,
    separateLedger: { id: canaryId, status: "unstarted", providerCalls: 0, terminal: null, reviewLedgerSha256: digest(p.batch), unstartedReviewAttempts: 64 },
    identityPolicy: "Requested Sol/low must be observed where available. Known mismatch or unauthenticated positive served identity fails. Exact served backend version may remain null; model self-report never establishes identity.",
    requiredBeforeDispatch: ["Fresh independent gate bound to this amendment freeze and exact source bytes.", "Separate nonserializable one-use operator capability for this canary and no review slots."],
    requiredAfterAttempt: ["Independent complete-catalog, four-tool, no-leakage, terminal-usage and cleanup review; the original high-only assessor is not a low-route pass.", "No batch eligibility or efficacy claim from this low-route infrastructure canary. Any future review batch still requires separate explicit authorization."],
    providerAuthorized: false, executionReady: false, batchAuthorized: false, providerCalls: 0,
    boundary: "Prospective canary-only route amendment. Original Sol/high package, canary, bridge policy, assessor and 64 review slots remain unchanged; user text alone grants no runtime capability." };
  return freeze({ ...body, sha256: digest(body) });
}
export type PredictionSolLowCanaryAmendment = ReturnType<typeof preparePredictionSolLowCanary>;

/** Independently pinned observer metadata, not model-authored identity. This is
 * one required observation only; it cannot pass a canary or authorize a batch. */
export function observePredictionSolLowIdentity(amendment: PredictionSolLowCanaryAmendment, receipt: TrustedBytes, runId: string) {
  seal(amendment); text(runId);
  same(amendment.route, { model: "gpt-5.6-sol", effort: "low", providerAccess: "cli-session", exactServedModel: null, exactServedVersion: null }, "identity amendment route drift");
  const value = trusted(receipt, "prediction-sol-low-canary-identity-observation-v1");
  exact(value, ["kind", "runId", "amendmentSha256", "requested", "observedRequest", "servedModel", "servedVersion", "provenance", "providerEvidenceReference"], "low identity observation");
  same([value.runId, value.amendmentSha256, value.requested, value.observedRequest], [runId, amendment.sha256, amendment.route, { model: "gpt-5.6-sol", effort: "low" }], "requested low route or identity scope mismatch");
  if (value.servedModel !== null && value.servedModel !== "gpt-5.6-sol") throw new Error("known served model mismatch");
  if (value.servedModel === null && value.servedVersion === null) same([value.provenance, value.providerEvidenceReference], ["unavailable", null], "fabricated positive identity");
  else { same(value.provenance, "independently-authenticated-provider-metadata", "fabricated positive identity"); text(value.providerEvidenceReference); if (value.servedVersion !== null) text(value.servedVersion); }
  return freeze({ observation: value, sha256: receipt.expectedSha256, executionReady: false, batchAuthorized: false });
}
