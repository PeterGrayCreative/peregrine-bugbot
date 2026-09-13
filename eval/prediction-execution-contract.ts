import { ACCEPTED_METHODOLOGY_EGRESS_IMAGE } from "./runtime-containment.js";
import { assertMethodologyProviderAttachment, type MethodologyProviderAttachmentRequest } from "./methodology-provider-attachment.js";
import { array, digest, exact, freeze, hash, integer, same, text, unique } from "./prediction-contract.js";
import { PREDICTION_LIMITS } from "./prediction-plan.js";

export const PREDICTION_RUNTIME_REQUIREMENTS = freeze({ protocol: "prediction-execution-contract-v1", runner: "codex", image: ACCEPTED_METHODOLOGY_EGRESS_IMAGE,
  requestedModel: "gpt-5.6-sol", requestedEffort: "high", caps: PREDICTION_LIMITS,
  topology: "one fresh single-session attempt with one case; no retries or delegation",
  process: "existing strict methodology container profile; read-only root and source/assets, private output, dropped capabilities, no new privileges, isolated home, no shell tools",
  credentials: "only the explicitly selected OpenAI credential; no ambient user home, git/ssh credentials, plugins, profiles or unrelated environment",
  network: "existing branded attempt-scoped internal network plus allowlisted provider gateway and neutral read forwarder; no bridge fallback",
  cancellation: "20-minute monotonic deadline starts before preparation; stop reads, abort pending work, retain partial output, await authenticated container/network removal before claiming termination",
  tokens: "cumulative model input includes cached input; cumulative output includes reasoning. Count input + output + disjoint preprocessing tokens once. Missing inclusion semantics/counters or unavailable hard caps reject preflight.",
  observedIdentity: "requested settings are not served identity; an authenticated served model, effort and concrete version must match every completed result",
  adjudication: "fresh authenticated Astra xhigh and Astra medium sessions plus separately reviewed free-text blinding bound to the exact packet; pattern screening alone is insufficient" });

/** These are properties of the checked-in adapter, not claims that no provider
 * anywhere offers such controls. Changing them requires a new supported bridge
 * and a separately reviewed successor freeze; a caller cannot set them true. */
export const PREDICTION_CODEX_SUPPORT = freeze({ protocol: "checked-in-codex-adapter-v1", aggregateTokenCapEnforced: false,
  outputTokenCapEnforced: false, liveCompleteTokenCounters: false, authenticatedServedIdentity: false,
  predictionReadPolicyAttached: false, wholeAttemptDeadlineAttached: false,
  evidence: ["src/engines/codex.ts", "src/core/telemetry.ts", "eval/runtime-containment.ts", "eval/methodology-provider-attachment.ts"],
  explanation: "Current engine reads terminal usage after the subprocess; its strict CLI argv lacks registered token-cap bindings. Existing neutral MCP exposes three tools, while prediction preparation includes literal read_link. The prediction monitor is not attached to provider execution." });

export interface PredictionAuthorization { readonly kind: "prediction-execution-authorization"; readonly approvalSha256: string }
interface Approval { freezeSha256: string; version: string; attemptIds: string[]; expiresAtMs: number; consumed: Set<string> }
const approvals = new WeakMap<PredictionAuthorization, Approval>();

/** Only a trusted control-plane caller may supply the expected approval digest,
 * obtained from an explicit user authorization independently of this JSON.
 * Hash authentication cannot itself prove who approved it. No approval is
 * loaded from ambient files/environment or inferred from preparation success. */
export function issuePredictionAuthorization(bytes: string, expectedApprovalSha256: string, expectedFreezeSha256: string): PredictionAuthorization {
  same(digest(JSON.parse(bytes)), hash(expectedApprovalSha256), "independently trusted approval digest required");
  const record = exact(JSON.parse(bytes), ["kind", "decision", "authorityReference", "freezeSha256", "model", "effort", "version", "attemptIds", "expiresAtMs"], "explicit authorization");
  same(record.kind, "explicit-user-provider-authorization-v1", "explicit authorization record required");
  same(record.decision, "authorize-exact-frozen-schedule", "provider authorization denied");
  text(record.authorityReference); same(record.freezeSha256, hash(expectedFreezeSha256), "authorization freeze mismatch");
  same(record.model, "gpt-5.6-sol", "authorization model drift"); same(record.effort, "high", "authorization effort drift");
  const attemptIds = array(record.attemptIds).map(text); unique(attemptIds);
  if (attemptIds.length === 0 || attemptIds.length > 64) throw new Error("authorization must name bounded scheduled attempts");
  const capability = freeze({ kind: "prediction-execution-authorization" as const, approvalSha256: expectedApprovalSha256 });
  approvals.set(capability, { freezeSha256: expectedFreezeSha256, version: text(record.version), attemptIds, expiresAtMs: integer(record.expiresAtMs), consumed: new Set() });
  return capability;
}
export function requirePredictionAuthorization(capability: PredictionAuthorization | null | undefined, freezeSha256: string, attemptId: string, version: string | null, nowMs = Date.now()): void {
  const bound = capability && approvals.get(capability);
  if (!bound) throw new Error("explicit scoped provider authorization capability is absent");
  if (bound.freezeSha256 !== hash(freezeSha256) || !bound.attemptIds.includes(attemptId) || version === null || bound.version !== version) throw new Error("authorization does not cover this freeze, attempt and route");
  if (!Number.isFinite(nowMs) || nowMs >= bound.expiresAtMs || bound.consumed.has(attemptId)) throw new Error("authorization expired or attempt already consumed");
}
/** Consume before starting preparation, including attempts that subsequently fail. */
export function consumePredictionAuthorization(capability: PredictionAuthorization, freezeSha256: string, attemptId: string, version: string, nowMs = Date.now()): void {
  requirePredictionAuthorization(capability, freezeSha256, attemptId, version, nowMs);
  approvals.get(capability)!.consumed.add(attemptId);
}

export interface PredictionObservedRoute { model: string; effort: string; version: string; sourceEventSha256: string }
export function checkPredictionObservedRoute(version: string | null, observed: PredictionObservedRoute | null) {
  const mismatches: string[] = [], unavailable: string[] = [];
  if (version === null) unavailable.push("requested-served-version-unfrozen"); else text(version);
  if (observed === null) unavailable.push("served-identity-unobserved");
  else {
    exact(observed, ["model", "effort", "version", "sourceEventSha256"], "served route");
    hash(observed.sourceEventSha256); text(observed.model); text(observed.effort); text(observed.version);
    if (observed.model !== "gpt-5.6-sol") mismatches.push("served-model-mismatch");
    if (observed.effort !== "high") mismatches.push("served-effort-mismatch");
    if (version !== null && observed.version !== version) mismatches.push("served-version-mismatch");
  }
  return freeze({ matches: mismatches.length === 0 && unavailable.length === 0, mismatches, unavailable,
    identityAuthentication: "source digest binding only; trusted observer provenance remains required" });
}

export interface PredictionRuntimePreflightInput {
  freezeSha256: string; attemptId: string; runtimeAttemptId: string; arm: "A" | "B"; sourceHeadTree: string;
  requestedVersion: string | null; authorization?: PredictionAuthorization | null;
  attachment?: unknown; attachmentRequest?: MethodologyProviderAttachmentRequest; nowMs?: number;
}
export function predictionRuntimePreflight(input: PredictionRuntimePreflightInput) {
  hash(input.freezeSha256); text(input.attemptId);
  const blockers: string[] = [];
  try { requirePredictionAuthorization(input.authorization, input.freezeSha256, input.attemptId, input.requestedVersion, input.nowMs); }
  catch { blockers.push("explicit-scoped-provider-authorization-absent-or-invalid"); }
  if (input.requestedVersion === null) blockers.push("concrete-served-route-version-unfrozen");
  if (!input.attachment || !input.attachmentRequest) blockers.push("authenticated-attempt-containment-attachment-absent");
  else {
    try {
      assertMethodologyProviderAttachment(input.attachment, input.attachmentRequest);
      const a = input.attachment.attestation, r = input.attachmentRequest;
      if (a.executionClass !== "provider" || a.schemaVersion !== 2 || a.image !== ACCEPTED_METHODOLOGY_EGRESS_IMAGE ||
        r.attemptId !== input.runtimeAttemptId || r.armId !== input.arm || r.sourceHeadTree !== input.sourceHeadTree) throw new Error("attempt containment identity mismatch");
    } catch { blockers.push("containment-brand-scope-or-egress-mismatch"); }
  }
  for (const [supported, reason] of [
    [PREDICTION_CODEX_SUPPORT.aggregateTokenCapEnforced, "aggregate-token-cap-unenforceable"],
    [PREDICTION_CODEX_SUPPORT.outputTokenCapEnforced, "output-token-cap-unenforceable"],
    [PREDICTION_CODEX_SUPPORT.liveCompleteTokenCounters, "live-complete-token-accounting-unavailable"],
    [PREDICTION_CODEX_SUPPORT.authenticatedServedIdentity, "served-identity-observer-unbound"],
    [PREDICTION_CODEX_SUPPORT.predictionReadPolicyAttached, "prediction-read-policy-unattached"],
    [PREDICTION_CODEX_SUPPORT.wholeAttemptDeadlineAttached, "whole-attempt-deadline-unattached"],
  ] as const) if (!supported) blockers.push(reason);
  return freeze({ kind: "prediction-runtime-preflight-v1", attemptId: input.attemptId, freezeSha256: input.freezeSha256,
    requestedRoute: { model: "gpt-5.6-sol", effort: "high", version: input.requestedVersion },
    allowed: blockers.length === 0, blockers, providerCalls: 0, requirementsSha256: digest(PREDICTION_RUNTIME_REQUIREMENTS), supportSha256: digest(PREDICTION_CODEX_SUPPORT) });
}
export function requirePredictionRuntimePreflight(input: PredictionRuntimePreflightInput): void {
  const result = predictionRuntimePreflight(input);
  if (!result.allowed) throw new Error(`prediction execution blocked: ${result.blockers.join(", ")}`);
}
