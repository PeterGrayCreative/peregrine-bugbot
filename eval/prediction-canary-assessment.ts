import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCodexEvents } from "../src/engines/codex.js";
import { array, digest, exact, freeze, hash, integer, same, sha, text, unique } from "./prediction-contract.js";
import { predictionFailureEvidence } from "./prediction-cli-deadline.js";
import { observePredictionCliTokens, registerPredictionCliSession, assessPredictionCliBatch } from "./prediction-cli-session.js";
import { bindPredictionRegistration } from "./prediction-plan.js";
import { bindPredictionMounts, type PredictionMount } from "./prediction-mounts.js";
import { PREDICTION_CLI_BRIDGE_POLICY } from "./prediction-cli-bridge.js";
import { predictionCliCommand } from "./prediction-cli-command.js";
import { parsePredictionReadMcpAuditSnapshot } from "./methodology-read-mcp.js";
import { METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE } from "./methodology-runtime-image.js";
import { bindSolLowOperator, type CanaryTrustedBytes } from "./prediction-sol-low-operator-contract.js";
import { predictionSolLowCanaryCommand } from "./prediction-sol-low-command.js";
import { MECHANICAL_RECEIPT_PATH, validateMechanicalReceipts } from "./prediction-mechanical-receipts.js";
// @ts-expect-error Pinned built-in ESM runtime parser has no declaration file.
import { parseAuditSnapshot } from "../container/eval-runtime/egress-gateway.mjs";
// @ts-expect-error Pinned built-in ESM runtime parser has no declaration file.
import { parseMethodologyMcpForwarderAuditSnapshot } from "../container/eval-runtime/methodology-mcp-forwarder.mjs";

interface TrustedBytes { bytes: string; expectedSha256: string }
export interface PredictionCanaryAssessmentInput {
  runId: string; registration: TrustedBytes; mountManifest: TrustedBytes; r4Freeze: TrustedBytes; bridgeFreeze: TrustedBytes; runtimeFreeze: TrustedBytes;
  /** Pin supplied by the authenticated independent observer/control plane, not
   * calculated from the candidate packet by its submitter. No default exists. */
  observer: TrustedBytes | null;
  artifacts: { path: string; bytes: string }[];
}
export const CANARY_EVIDENCE_PATHS = ["bridge.json", "canary/start.json", "canary/invocation.json", "canary/execution.json", "canary/output/result.json",
  "canary/terminal.json", "canary/deadline/terminal.json", "canary/cleanup.json", "observer/catalog.json", "observer/identity.json",
  "observer/lifecycle.json", "observer/absence.json", "observer/tool-calls.json", "observer/batch-before.json", "observer/batch-after.json", "observer/runtime.json",
  "observer/gateway-audit.json", "observer/forwarder-audit.json"] as const;
const route = { model: "gpt-5.6-sol", effort: "high", providerAccess: "cli-session" };
export interface PredictionSolLowAssessmentInput extends PredictionCanaryAssessmentInput { operatorFreeze: CanaryTrustedBytes; operatorGate: CanaryTrustedBytes }
export const SOL_LOW_OPERATOR_EVIDENCE_PATHS = ["operator/preflight.json", "operator/dispatch.json", "operator/terminal.json", "operator/retained-inventory.json", "canary-ledger-start.json", "canary-ledger-terminal.json"] as const;
const fail = (condition: unknown, label: string) => { if (!condition) throw new Error(label); };
const record = (value: unknown): any => { fail(value && typeof value === "object" && !Array.isArray(value), "record required"); return value; };
function trusted(input: TrustedBytes | null, kind: string): any {
  fail(input, "authenticated observer evidence is absent");
  exact(input, ["bytes", "expectedSha256"], "trusted bytes");
  same(sha(input!.bytes), hash(input!.expectedSha256), "trusted artifact digest mismatch");
  const value = record(JSON.parse(input!.bytes)); same(value.kind, kind, "trusted artifact kind mismatch"); return value;
}
const seal = (value: any, field = "sha256") => { const { [field]: expected, ...body } = value; same(digest(body), hash(expected), "record seal mismatch"); };

/** Read-only validation, not authentication discovery or a dispatch capability.
 * Semantic exposure/leakage observations require an independently trusted
 * observer receipt. A self-hashed model answer cannot satisfy this contract. */
export function assessPredictionCanary(input: PredictionCanaryAssessmentInput) {
  return assessCanaryEvidence(input);
}
/** Separate low-route decision; never promotes an infrastructure canary into a
 * high-route batch-eligibility result or rewrites any submitted evidence. */
export function assessPredictionSolLowCanary(input: PredictionSolLowAssessmentInput) {
  return assessCanaryEvidence(input, input);
}
function assessCanaryEvidence(input: PredictionCanaryAssessmentInput, lowInput?: PredictionSolLowAssessmentInput) {
  const checks: string[] = [], limitations = ["No batch authorization or dispatch is granted.", "Normal completion is not an elapsed timeout or forced-termination observation."];
  let binding: unknown = null, tokens: unknown = null, identity: unknown = null;
  try {
    text(input.runId);
    const r4 = trusted(input.r4Freeze, "prediction-r4-preauthorization-freeze-v1"), bridge = trusted(input.bridgeFreeze, "prediction-cli-bridge-freeze-v1"), runtime = trusted(input.runtimeFreeze, "prediction-runtime-acceptance-freeze-v1");
    const operator = lowInput ? bindSolLowOperator(lowInput.operatorFreeze, lowInput.operatorGate) : null;
    const pack = r4.package, p = pack.preauthorization, originalCanary = pack.canary, first = p.attempts[0];
    let canary = originalCanary;
    same([input.registration.expectedSha256, input.mountManifest.expectedSha256], [p.authoritySha256.registration, p.authoritySha256.mounts], "original registration or mount authority drift");
    const registration = bindPredictionRegistration(input.registration.bytes, input.registration.expectedSha256);
    const mounts = bindPredictionMounts(input.mountManifest.bytes, input.mountManifest.expectedSha256, registration), mount = mounts.find(m => m.caseId === first.caseId)!;
    const cli = registerPredictionCliSession(input.registration.bytes, input.registration.expectedSha256, p.scientificRegistration.predecessorFreezeSha256);
    same(p.scientificRegistration, cli, "prospective scientific registration drift"); same(p.batch, assessPredictionCliBatch(cli, []), "initial review ledger drift");
    same(p.attempts.map((a: any) => ({ id: a.id, caseId: a.caseId, repeat: a.repeat, arm: a.arm, status: a.status, providerCalls: a.providerCalls })), registration.schedule.map(a => ({ ...a, status: "unstarted" })), "review schedule mutation");
    same(first.mountSha256, mount.inputDigest, "selected mount drift");
    seal(p); seal(canary); same(digest({ preauthorization: p, canary }), pack.sha256, "package seal mismatch");
    same(canary.preauthorizationSha256, p.sha256, "canary parent mismatch");
    same([bridge.predecessorFreezeSha256, bridge.packageSha256, bridge.canarySha256, bridge.acceptedRuntime.freezeSha256],
      [input.r4Freeze.expectedSha256, pack.sha256, canary.sha256, input.runtimeFreeze.expectedSha256], "predecessor cross-binding mismatch");
    same(runtime.acceptance, METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE, "runtime acceptance mismatch");
    same([p.runtimeAcceptance, canary.runtimeAcceptance, bridge.acceptedRuntime.acceptance], [runtime.acceptance, runtime.acceptance, runtime.acceptance], "runtime drift");
    same(bridge.bridgePolicy, PREDICTION_CLI_BRIDGE_POLICY, "bridge policy drift"); same(bridge.bridgePolicySha256, digest(bridge.bridgePolicy), "bridge policy seal mismatch");
    same(digest(bridge.source.files), bridge.source.sourceSha256, "bridge source seal mismatch");
    for (const predecessor of [r4, bridge, runtime]) same([predecessor.providerAuthorized, predecessor.executionReady, predecessor.providerCalls], [false, false, 0], "preparation promoted to authorization");
    same([canary.sourceAttemptId, canary.mountSha256, canary.maximumAttempts, canary.scheduledReviewAttemptsConsumed, canary.retries, canary.delegation], [first.id, first.mountSha256, 1, 0, 0, false], "registered canary scope drift");
    same(canary.route, p.route, "canary route drift"); same(canary.caps, p.caps, "canary cap drift");
    same([p.route.model, p.route.effort, p.route.providerAccess, p.caps.hard.wallMs, p.caps.hard.readCalls, p.caps.hard.returnedBytes], [route.model, route.effort, route.providerAccess, 1200000, 100, 2000000], "registered route/cap mismatch");
    fail(p.attempts.length === 64 && p.attempts.every((a: any) => a.status === "unstarted" && a.output === null && a.servedIdentity === null), "review-slot mutation");
    checks.push("frozen-authorities");
    if (operator) {
      same([operator.options.freezeBytes, operator.options.freezeSha256, operator.options.runId], [input.r4Freeze.bytes, input.r4Freeze.expectedSha256, input.runId], "operator R4/run mismatch");
      same(operator.amendment.predecessor.bridgeFreezeSha256, input.bridgeFreeze.expectedSha256, "operator predecessor bridge mismatch");
      canary = { ...operator.amendment, outputPolicy: originalCanary.outputPolicy };
    }
    const selectedRoute = operator ? { ...route, effort: "low" } : route;
    const selectedPolicy = operator?.amendment.policy ?? bridge.bridgePolicy, selectedSource = operator?.source ?? bridge.source;
    const observer = trusted(input.observer, operator ? "authenticated-prediction-sol-low-canary-observer-v1" : "authenticated-prediction-canary-observer-v1");
    exact(observer, ["kind", "binding", "observerReference", "observerSessionId", "modelSessionId", "reviewSessionId", "inventory", "review"], "observer receipt");
    for (const key of ["observerReference", "observerSessionId", "modelSessionId", "reviewSessionId"]) text(observer[key]);
    unique([observer.observerSessionId, observer.modelSessionId, observer.reviewSessionId]);
    const bindings = { runId: input.runId, freezeSha256: input.r4Freeze.expectedSha256, packageSha256: pack.sha256, canarySha256: canary.sha256,
      sourceSha256: selectedSource.sourceSha256, policySha256: digest(selectedPolicy), executionClass: "provider",
      ...(operator ? { amendmentFreezeSha256: operator.bridgeFreeze.expectedSha256, userAuthorizationSha256: canary.userAuthorization.sha256,
        predecessorCanarySha256: canary.predecessor.canarySha256, predecessorBridgeFreezeSha256: canary.predecessor.bridgeFreezeSha256, predecessorAssessmentFreezeSha256: canary.predecessor.assessmentFreezeSha256 } : {}) };
    const scope = { ...bindings, purpose: "canary", attemptId: canary.canaryId, sourceAttemptId: first.id, promptSha256: canary.promptSha256,
      mountSha256: first.mountSha256, rawScopeSha256: first.rawScopeSha256, ...selectedRoute };
    binding = { ...scope, bridgeFreezeSha256: input.bridgeFreeze.expectedSha256, runtimeFreezeSha256: input.runtimeFreeze.expectedSha256,
      ...(operator ? { operatorFreezeSha256: lowInput!.operatorFreeze.expectedSha256, operatorGateSha256: lowInput!.operatorGate.expectedSha256 } : {}) };
    same(observer.binding, binding, "stale or cross-run observer binding");
    const requiredPaths = [...CANARY_EVIDENCE_PATHS, ...(operator ? [...SOL_LOW_OPERATOR_EVIDENCE_PATHS, ...input.artifacts.filter(a => MECHANICAL_RECEIPT_PATH.test(a.path)).map(a => a.path)] : [])];
    fail(input.artifacts.length === requiredPaths.length, "complete exact artifact inventory required");
    unique(input.artifacts.map(a => a.path)); same(input.artifacts.map(a => a.path).sort(), [...requiredPaths].sort(), "unexpected or missing evidence path");
    const inventory = input.artifacts.map(a => { fail(typeof a.bytes === "string" && Buffer.byteLength(a.bytes) <= 16_777_216, "artifact byte limit"); return { path: a.path, bytes: Buffer.byteLength(a.bytes), sha256: sha(a.bytes) }; }).sort((a, b) => a.path.localeCompare(b.path));
    same(inventory, observer.inventory, "authenticated inventory mismatch");
    same(observer.review, { inventorySha256: digest(inventory), completeCapabilityExposureReviewed: true, leakageAbsent: true, unsupportedIdentityClaimsAbsent: true, noScoredReview: true }, "independent semantic/capability review absent or failed");
    const raw = (path: string) => input.artifacts.find(a => a.path === path)!.bytes, get = (path: string): any => record(JSON.parse(raw(path)));
    const bridgeRecord = get("bridge.json"), start = get("canary/start.json"), invocation = get("canary/invocation.json"), terminal = get("canary/terminal.json"), execution = get("canary/execution.json");
    for (const value of [bridgeRecord, start, terminal]) same(value.bindings, bindings, "run binding mismatch");
    same(bridgeRecord.source, selectedSource, "stale bridge bytes"); same(bridgeRecord.policy, selectedPolicy, "run policy drift");
    for (const value of [start, invocation, terminal]) same(value.scope, scope, "attempt scope mismatch");
    same(start.approval.scope, scope, "approval scope mismatch"); same(start.approval.permission, "one-provider-cli-attempt", "synthetic or unauthorized attempt");
    hash(start.approval.approvalEvidenceSha256); hash(start.approval.independentGateSha256);
    if (operator) validateLowOperatorRecords(operator, lowInput!, get, raw, start, scope, bindings, terminal);
    same(invocation.providerImage, runtime.acceptance.image, "client image mismatch"); same(invocation.assets, [], "ambient canary assets exposed");
    same(invocation.prompt, canary.prompt, "canary prompt drift"); same(sha(invocation.prompt), canary.promptSha256, "canary prompt seal mismatch");
    const urlArg = array(invocation.args).map(text).find(v => v.startsWith("mcp_servers.source_read.url="));
    fail(urlArg, "scoped MCP endpoint missing"); const url = JSON.parse(urlArg!.slice("mcp_servers.source_read.url=".length));
    same(invocation.args, operator ? predictionSolLowCanaryCommand(url) : predictionCliCommand(url, false), "requested CLI route/configuration mismatch");
    same([invocation.attachment.inputDigest, invocation.attachment.attemptId, invocation.attachment.registrationSha256, invocation.attachment.mountManifestSha256, invocation.attachment.toolDefinitionsSha256],
      [first.mountSha256, first.id, p.authoritySha256.registration, p.authoritySha256.mounts, digest(p.toolBinding.definitions)], "reader attachment mismatch");
    const egress = invocation.egress; seal(egress, "attestationSha256");
    if (operator) same([egress.schemaVersion, egress.protocol, egress.attemptId, egress.armId, egress.sourceHeadTree],
      [1, "methodology-egress-supervisor-v1", "attempt-000001", first.arm, mount.headTree], "low sidecar source/attempt binding drift");
    same([egress.executionClass, egress.image, egress.providerAuthorities, egress.topology], ["provider", runtime.acceptance.image, bridge.bridgePolicy.providerAuthorities, "gateway-and-forwarder-only-before-provider"], "egress scope mismatch");
    same(get("observer/runtime.json"), { image: runtime.acceptance.image, tools: runtime.tools, sourceSha256: selectedSource.sourceSha256, configurationSupported: true, modelSessionId: observer.modelSessionId }, "client/runtime/tool bytes or support unknown");
    same(get("observer/batch-before.json"), p.batch, "review ledger changed before canary"); same(get("observer/batch-after.json"), p.batch, "canary mutated review ledger");
    checks.push("exact-run-and-artifacts");
    const catalog = get("observer/catalog.json"); exact(catalog, ["modelSessionId", "complete", "repositoryTools", "bookkeeping"], "capability catalog");
    same([catalog.modelSessionId, catalog.complete, catalog.repositoryTools], [observer.modelSessionId, true, p.toolBinding.definitions], "unknown or disallowed repository capability exposure");
    const bookkeeping = array(catalog.bookkeeping).map(value => { const item = exact(value, ["name", "effects", "identicalAcrossArms"], "bookkeeping capability"); fail(["plan", "todo_list"].includes(text(item.name)), "unknown bookkeeping capability"); same([item.effects, item.identicalAcrossArms], [[], true], "bookkeeping has unknown or disallowed effects"); return text(item.name); }); unique(bookkeeping);
    same(execution.code, 0, "canary execution failed"); same(execution.timedOut, false, "canary timed out"); same(execution.cleanupErrors ?? [], [], "execution cleanup failed");
    const parsed = parseCodexEvents(execution.stdout); fail(parsed.malformedEventLines === 0, "malformed terminal stream");
    const events = parsed.events.map(record);
    fail(events.filter(e => e.type === "thread.started").length === 1 && events[0].type === "thread.started" && events[0].thread_id === observer.modelSessionId, "one fresh observed model session required");
    fail(events.filter(e => e.type === "turn.started").length === 1 && events[1]?.type === "turn.started", "exactly one ordered turn start required before items");
    fail(events.filter(e => e.type === "turn.completed").length === 1 && events.at(-1).type === "turn.completed", "ambiguous or missing terminal usage");
    for (const event of events) {
      fail(["thread.started", "turn.started", "turn.completed", "item.started", "item.updated", "item.completed"].includes(event.type), "unknown or failed event");
      if (event.type.startsWith("item.")) {
        const item = record(event.item);
        fail(["mcp_tool_call", "agent_message", "reasoning", ...bookkeeping].includes(item.type), "unknown or disallowed used capability");
        if (item.type === "mcp_tool_call") fail(item.server === "source_read" && PREDICTION_CLI_BRIDGE_POLICY.repositoryTools.includes(item.tool), "disallowed tool use");
      }
    }
    const calls = validateItemLifecycles(events);
    tokens = observePredictionCliTokens(events, true); fail((tokens as any).status === "known", "token telemetry unknown");
    same(terminal.tokens, tokens, "terminal token telemetry mismatch"); same(terminal.terminal.events, events, "terminal stream mismatch");
    const output = raw("canary/output/result.json"); fail(Buffer.byteLength(output) > 0 && Buffer.byteLength(output) <= canary.outputPolicy.maximumBytes, "raw output missing or truncated");
    same([terminal.providerCalls, terminal.failure, terminal.disallowed, terminal.terminal.status, terminal.terminal.completeEventStream, terminal.terminal.rawOutput, terminal.terminal.cleanupProven, terminal.terminal.deadlineExceeded], [1, null, [], "completed", true, output, true, false], "terminal failure or partial evidence");
    checks.push("observed-client-and-capabilities");
    const observedIdentity = get("observer/identity.json"); exact(observedIdentity, ["modelSessionId", "requested", "observedRequest", "servedModel", "servedVersion", "provenance", "providerEvidenceReference"], "identity receipt");
    same([observedIdentity.modelSessionId, observedIdentity.requested, observedIdentity.observedRequest], [observer.modelSessionId, selectedRoute, { model: selectedRoute.model, effort: selectedRoute.effort }], "requested Sol route not observed");
    fail(observedIdentity.servedModel === null || observedIdentity.servedModel === route.model, "known served-model mismatch");
    if (observedIdentity.servedModel === null && observedIdentity.servedVersion === null) { same([observedIdentity.provenance, observedIdentity.providerEvidenceReference], ["unavailable", null], "untrusted identity claim"); limitations.push("Exact served model/version remain unavailable under the preregistered CLI contract."); }
    else { same(observedIdentity.provenance, "independently-authenticated-provider-metadata", "untrusted positive identity claim"); text(observedIdentity.providerEvidenceReference); if (observedIdentity.servedVersion !== null) text(observedIdentity.servedVersion); }
    identity = observedIdentity;
    validateCanaryReads(get("canary/cleanup.json"), calls, get("observer/tool-calls.json"), mount, observer.modelSessionId);
    checks.push("identity-and-authenticated-reads");
    const deadline = get("canary/deadline/terminal.json"), cleanup = get("canary/cleanup.json"), lifecycle = get("observer/lifecycle.json"); seal(deadline);
    same(terminal.deadline, deadline, "deadline record mismatch");
    same([deadline.attemptId, deadline.executionClass, deadline.wallMs, deadline.deadlineExceeded, deadline.cancellationReason, deadline.executionError, deadline.cleanupError, deadline.readCloseError, deadline.evidenceError, deadline.teardownCompleted], [canary.canaryId, "whole-attempt", 1200000, false, null, null, null, null, null, true], "deadline or cleanup gap");
    fail(Number.isFinite(deadline.elapsedMs) && deadline.elapsedMs >= 0 && deadline.elapsedMs < 1200000, "deadline elapsed gap");
    same(deadline.events.map((e: any) => e.kind), ["start", "exec-start", "exec-closed", "teardown-complete"], "missing lifecycle event");
    fail(deadline.events.every((e: any, i: number, all: any[]) => Number.isFinite(e.elapsedMs) && e.elapsedMs >= (i ? all[i - 1].elapsedMs : 0) && e.elapsedMs <= deadline.elapsedMs), "lifecycle order gap");
    same(deadline.events[0].detail, { attemptId: canary.canaryId, wallMs: 1200000, executionClass: "whole-attempt", providerAuthorization: "not-issued-by-this-primitive" }, "guard start contract mismatch");
    fail(integer(deadline.events[1].detail.remainingMs) > 0 && deadline.events[1].detail.remainingMs <= 1200000 - deadline.events[1].elapsedMs && deadline.events[1].detail.command === "codex", "execution deadline budget mismatch");
    same(deadline.events[2].detail, { code: 0, timedOut: false, cleanupErrors: [], cleanupErrorsTruncated: false }, "client closure failure");
    fail(integer(lifecycle.clientProcessId) > 0 && /^peregrine-eval-[a-zA-Z0-9-]+$/.test(text(lifecycle.clientContainer)), "client process/container identity missing");
    same(lifecycle, { modelSessionId: observer.modelSessionId, clientProcessId: lifecycle.clientProcessId, clientContainer: lifecycle.clientContainer, deadlineSha256: deadline.sha256, guardStartedBeforePreparation: true, deadlineSignalAttached: true, clientClosed: true, cleanupUncancelled: true, elapsedTimeoutObserved: false, forcedTerminationObserved: false }, "authenticated lifecycle observations incomplete");
    same(cleanup.sidecars.map((a: any) => [a.sidecar, a.sealed, a.selfDigestValid, a.lineObserved]), [["gateway", true, true, true], ["forwarder", true, true, true]], "sealed sidecar audit missing");
    const gateway = parseAuditSnapshot(get("observer/gateway-audit.json")), forwarder = parseMethodologyMcpForwarderAuditSnapshot(get("observer/forwarder-audit.json"));
    fail(gateway.events.length > 0 && gateway.events.every((e: any) => e.decision === "allow" && (e.authorityDigest === undefined || bridge.bridgePolicy.providerAuthorities.some((a: string) => sha(a) === e.authorityDigest))), "disallowed or missing gateway observations");
    fail(gateway.events.some((e: any) => e.kind === "connect" && e.authorityDigest), "provider connection not observed");
    same([forwarder.requests.denied, forwarder.requests.forwarded, forwarder.events.filter((e: any) => e.code === "forwarded").length], [0, cleanup.audit.requests.observed, cleanup.audit.requests.observed], "forwarder/reader audit closure gap");
    fail(forwarder.events.every((e: any) => e.decision === "allow"), "forwarder denial observed");
    const absence = get("observer/absence.json"); exact(absence, ["modelSessionId", "deadlineSha256", "clientContainer", "resources"], "cleanup absence evidence");
    same([absence.clientContainer, absence.modelSessionId, absence.deadlineSha256], [lifecycle.clientContainer, observer.modelSessionId, deadline.sha256], "absence cross-run mismatch");
    const expectedResources = [["process", String(lifecycle.clientProcessId)], ["container", lifecycle.clientContainer], ["container", egress.gateway.name], ["container", egress.forwarder.name], ["network", egress.network], ["network", egress.externalNetwork]];
    same(absence.resources.map((r: any) => [r.kind, r.id]), expectedResources, "cleanup resource closure incomplete");
    for (const value of absence.resources) { const r = exact(value, ["kind", "id", "observedAbsent", "afterClientClosed", "uncancelled", "queryResult"], "absence observation"); same([r.observedAbsent, r.afterClientClosed, r.uncancelled], [true, true, true], "cleanup absence unproven"); same(r.queryResult, { code: 0, stdout: "", timedOut: false }, "cleanup query failed or found resources"); }
    checks.push("deadline-and-complete-cleanup");
  } catch (error) {
    return freezeAssessment("not-eligible", input, binding, checks, limitations, predictionFailureEvidence(error), tokens, identity, Boolean(lowInput));
  }
  return freezeAssessment(lowInput ? "infrastructure-canary-observed-no-batch-eligibility" : "eligible-for-separate-batch-authorization", input, binding, checks, limitations, null, tokens, identity, Boolean(lowInput));
}

function validateLowOperatorRecords(operator: ReturnType<typeof bindSolLowOperator>, input: PredictionSolLowAssessmentInput, get: (path: string) => any,
  raw: (path: string) => string, start: any, scope: any, bindings: any, terminal: any) {
  same([start.approval.approvalEvidenceSha256, start.approval.independentGateSha256], [operator.amendment.userAuthorization.sha256, operator.predecessor.gateSha256], "low authorization or predecessor gate drift");
  const preflight = get("operator/preflight.json"), dispatch = get("operator/dispatch.json"), end = get("operator/terminal.json"), retained = get("operator/retained-inventory.json");
  same([preflight.contractSha256, preflight.sourceSha256, preflight.predecessorGateSha256, preflight.freshGateSha256, preflight.executionDirectoryAbsent, preflight.providerCalls, preflight.executionStateCreated],
    [digest(operator), operator.source.sourceSha256, operator.predecessor.gateSha256, input.operatorGate.expectedSha256, true, 0, false], "preflight incomplete or stale");
  same([dispatch.scope, dispatch.freezeSha256, dispatch.freshGateSha256], [scope, input.operatorFreeze.expectedSha256, input.operatorGate.expectedSha256], "operator dispatch mismatch");
  same([end.status, end.terminalSha256, end.providerCalls, end.executionReady, end.batchAuthorized], ["awaiting-independent-observations", digest(terminal), 1, false, false], "operator terminal mismatch");
  const batch = JSON.parse(operator.options.freezeBytes).package.preauthorization.batch;
  same([preflight.batch, dispatch.before.batch, end.snapshot.batch], [batch, batch, batch], "operator mutated review slots");
  same(get("canary-ledger-start.json"), { bindings, ...operator.amendment.separateLedger, batchAuthorized: false }, "low start ledger mismatch");
  same(get("canary-ledger-terminal.json"), { bindings, ledger: { ...operator.amendment.separateLedger, status: terminal.terminal.status, providerCalls: 1, terminalSha256: digest(terminal), terminal: terminal.terminal, batchAuthorized: false } }, "low terminal ledger mismatch");
  same(retained.sha256, digest(retained.inventory), "retained inventory seal drift"); unique(retained.inventory.map((v: any) => text(v.path)));
  for (const path of [...CANARY_EVIDENCE_PATHS.filter(p => !p.startsWith("observer/")), "canary-ledger-start.json", "canary-ledger-terminal.json"]) {
    same(retained.inventory.find((v: any) => v.path === path), { path, bytes: Buffer.byteLength(raw(path)), sha256: sha(raw(path)) }, "retained mechanical artifact mismatch");
  }
  validateMechanicalReceipts(input.artifacts, retained, scope, get, { directory: operator.execution.directory, session: preflight.session });
}

function validateItemLifecycles(events: any[]) {
  // ID ownership starts at the first event for every capability, including
  // completion-only non-I/O items. It cannot depend on seeing an MCP read first.
  const items = new Map<string, { type: string; identity: unknown; completed: boolean }>(), calls: any[] = [];
  for (const event of events) {
    if (!event.type.startsWith("item.")) continue;
    const item = event.item;
    fail(typeof item.id === "string" && item.id.length > 0, "tool lifecycle requires a unique id");
    const identity = { server: item.server, tool: item.tool, arguments: item.arguments };
    let owner = items.get(item.id);
    if (owner) {
      same(item.type, owner.type, "tool lifecycle changed capability type");
      fail(event.type !== "item.started" && !owner.completed, "tool lifecycle duplicate start or terminal disposition");
      if (item.type === "mcp_tool_call") same(identity, owner.identity, "tool lifecycle identity mismatch");
    } else {
      // The documented JSONL example permits a completion-only agent message.
      // Other types need an observed start; unknown protocol variants fail closed.
      fail(event.type === "item.started" || item.type === "agent_message" && event.type === "item.completed", "tool lifecycle missing start");
      owner = { type: item.type, identity, completed: false }; items.set(item.id, owner);
    }
    if (event.type === "item.completed") {
      owner.completed = true;
      if (item.type === "mcp_tool_call") {
        fail((item.status === undefined || item.status === "completed") && (item.error === undefined || item.error === null), "tool disposition failed or unknown");
        calls.push(event);
      }
    }
  }
  fail([...items.values()].every(item => item.completed), "tool lifecycle has unfinished items before turn terminal");
  return calls;
}

function validateCanaryReads(cleanup: any, modelCalls: any[], evidence: any, mount: PredictionMount, sessionId: string) {
  const reader = cleanup.reader, audit = parsePredictionReadMcpAuditSnapshot(cleanup.audit);
  same([reader.inputDigest, reader.closed, reader.pending, reader.stopped], [mount.inputDigest, true, [], false], "reader lifecycle/scope mismatch");
  fail(integer(reader.calls) <= 100 && integer(reader.bytes) <= 2000000, "read budget exceeded");
  same([audit.sessions.attempted, audit.sessions.initialized, audit.sessions.ready, audit.sessions.denied, audit.denialCodes, audit.transportFailures], [1, 1, 1, 0, [], []], "reader session/transport failure");
  same(evidence.modelSessionId, sessionId, "tool provenance session mismatch");
  // Search results are only line excerpts. Authenticate full byte witnesses
  // against the frozen mount; an observer assertion or a hit's own hash is not
  // sufficient to establish that the excerpt was present in mounted source.
  const searchSources = new Map<string, string[]>();
  for (const value of array(evidence.searchSources)) {
    const witness = exact(value, ["path", "bytes"], "search source witness"), path = text(witness.path);
    fail(!searchSources.has(path), "duplicate search source witness");
    const source = mount.allowedFiles.find(f => f.path === path);
    fail(source && source.mode !== "120000" && typeof witness.bytes === "string", "search source outside authenticated regular-file mount");
    same([Buffer.byteLength(witness.bytes as string), sha(witness.bytes as string)], [source!.bytes, source!.sha256], "search source bytes differ from authenticated mount");
    searchSources.set(path, (witness.bytes as string).split("\n"));
  }
  const transcript = array(reader.transcript).map(record); fail(transcript.length >= 4 && transcript.length === reader.calls && transcript.length === audit.toolCalls.length, "missing reader transcript");
  same(transcript.reduce((sum, t) => sum + Buffer.byteLength(t.response), 0), reader.bytes, "returned-byte accounting mismatch");
  same(evidence.calls.length, transcript.length, "model/reader call closure incomplete"); same(modelCalls.length, transcript.length, "unmatched model tool calls"); unique(modelCalls.map(e => text(e.item.id)));
  const responses = transcript.map((t, index) => {
    same([t.ticket, t.delivered], [index + 1, true], "undelivered or missing reader result");
    const link = evidence.calls[index], event = modelCalls[index].item, parsed = JSON.parse(t.response);
    same(link, { eventId: event.id, ticket: t.ticket, source: "model", responseSha256: sha(t.response) }, "untrusted tool provenance");
    same([event.server, event.tool, event.arguments], ["source_read", t.tool, t.arguments], "model/reader tool mismatch");
    if (t.tool === "read_file" || t.tool === "read_link") {
      const source = mount.allowedFiles.find(f => f.path === t.arguments.path); fail(source, "read outside authenticated mounted scope");
      if (t.tool === "read_file" && parsed.text !== null && parsed.text !== undefined) { fail(source!.mode !== "120000" && typeof parsed.text === "string", "file read followed a link or returned malformed text"); same(sha(parsed.text), source!.sha256, "read contents differ from mounted source"); }
    }
    if (t.tool === "search_text") {
      const args = t.arguments, scope = args.path ?? "";
      fail(Object.keys(args).every(k => ["query", "path"].includes(k)) && (args.path === undefined || typeof args.path === "string") &&
        typeof args.query === "string" && args.query.length > 0 && Buffer.byteLength(args.query) <= 1024 && !/[\r\n\0]/.test(args.query), "invalid literal search arguments");
      fail(scope === "" || mount.allowedFiles.some(f => f.path === scope || f.path.startsWith(scope + "/")), "search outside authenticated mounted scope");
      for (const value of array(parsed.matches)) {
        const hit = exact(value, ["path", "line", "text"], "search hit"), path = text(hit.path), source = searchSources.get(path);
        fail(source !== undefined && (scope === "" || path === scope || path.startsWith(scope + "/")), "search hit outside authenticated source or requested scope");
        fail(Number.isSafeInteger(hit.line) && (hit.line as number) > 0 && typeof hit.text === "string" && hit.text.includes(args.query), "search hit line or literal mismatch");
        same(hit.text, source![(hit.line as number) - 1], "search hit content differs from authenticated source line");
      }
    }
    same(event.result.content, [{ type: "text", text: t.response }], "model did not receive authenticated reader result");
    const rpcResult = { content: [{ type: "text", text: t.response }], isError: parsed.status === "incomplete" };
    same([audit.toolCalls[index]!.name, audit.toolCalls[index]!.resultSha256], [t.tool, sha("review-read-mcp-tool-result-v1\0" + JSON.stringify(rpcResult))], "reader audit/result mismatch");
    return { ...t, parsed };
  });
  const complete = (r: any) => r.parsed.status === "complete-for-indexed-export" && r.parsed.truncated === false && r.parsed.limitations.length === 0 && r.parsed.unavailable.length === 0;
  const nativeLinks = mount.allowedFiles.filter(f => f.mode === "120000");
  fail(responses.some(r => r.tool === "list_tree" && Object.keys(r.arguments).length === 0 && (complete(r) || r.parsed.status === "incomplete" && r.parsed.truncated === false && digest(r.parsed.limitations) === digest(["unsupported-file-type"]) && r.parsed.unavailable.every((v: any) => v.reason === "unsupported-file-type" && nativeLinks.some(l => l.path === v.path)))), "required root listing unavailable");
  const diff = responses.find(r => r.tool === "read_file" && r.arguments.path === "review.diff" && complete(r)); fail(diff && typeof diff.parsed.text === "string" && diff.parsed.text.length > 0, "required diff read unavailable");
  same(sha(diff.parsed.text), mount.diffSha256, "returned diff bytes do not match authenticated mount");
  fail(responses.some(r => r.tool === "search_text" && complete(r) && typeof r.arguments.query === "string" && r.arguments.query.length > 0 && diff.parsed.text.includes(r.arguments.query) && r.parsed.matches.some((m: any) => m.path === "review.diff" && m.text.includes(r.arguments.query))), "required literal diff search unavailable");
  if (!nativeLinks.length) {
    same(evidence.nativeLinkMode, "no-native-link-refusal", "native-link eligibility mismatch");
    fail(responses.some(r => r.tool === "read_link" && r.arguments.path === "review.diff" && digest(r.parsed) === digest({ status: "incomplete", limitations: ["invalid-or-unavailable-read"], unavailable: true })), "required authenticated read_link refusal missing");
  } else {
    same(evidence.nativeLinkMode, "literal-native-link", "native-link eligibility mismatch");
    fail(responses.some(r => r.tool === "read_link" && r.parsed.kind === "literal-symlink-source" && r.parsed.followed === false && nativeLinks.some(l => l.path === r.arguments.path && typeof r.parsed.target === "string" && sha(r.parsed.target) === l.sha256)), "required literal-link evidence missing");
  }
}
function freezeAssessment(recommendation: string, input: PredictionCanaryAssessmentInput, binding: unknown, checks: string[], limitations: string[], failure: unknown, tokens: unknown, identity: unknown, low = false) {
  const body = { kind: low ? "prediction-sol-low-canary-assessment-v3" : "prediction-canary-assessment-v4", recommendation, inputSha256: digest(input), binding, checks, limitations, failure, tokens, identity,
    providerAuthorized: false, executionReady: false, batchAuthorized: false, providerCalls: 0,
    boundary: "Deterministic validation of externally authenticated evidence, not independent observation, dispatch authority, efficacy evidence or an R5 pass." };
  return freeze({ ...body, sha256: digest(body) });
}
export function persistPredictionCanaryAssessment(directory: string, input: PredictionCanaryAssessmentInput) {
  mkdirSync(directory, { mode: 0o700 }); const assessment = assessPredictionCanary(input);
  writeFileSync(join(directory, "assessment.json"), JSON.stringify(assessment) + "\n", { flag: "wx", mode: 0o600 }); return assessment;
}
export function requirePredictionBatchAuthorization(_assessment: unknown): never {
  throw new Error("canary assessment is not batch authorization; separate explicit authorization remains required");
}
