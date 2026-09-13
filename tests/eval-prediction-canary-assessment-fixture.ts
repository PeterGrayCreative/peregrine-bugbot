import type { TestContext } from "node:test";
import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { digest, sha } from "../eval/prediction-contract.js";
import { registerPredictionCliSession, assessPredictionCliBatch, observePredictionCliTokens } from "../eval/prediction-cli-session.js";
import { preparePredictionPreauthorization } from "../eval/prediction-preauthorization.js";
import { METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE } from "../eval/methodology-runtime-image.js";
import { PREDICTION_CLI_BRIDGE_POLICY } from "../eval/prediction-cli-bridge.js";
import { predictionCliCommand } from "../eval/prediction-cli-command.js";
import type { PredictionCanaryAssessmentInput } from "../eval/prediction-canary-assessment.js";
import { predictionMountFixture } from "./eval-prediction-mount-fixture.js";

export const trustedFixture = (value: unknown) => { const bytes = JSON.stringify(value); return { bytes, expectedSha256: sha(bytes) }; };
export function sealFixture(value: any, field = "sha256") { delete value[field]; value[field] = digest(value); return value; }
/** Fabricated observer/provider observations for validator tests only. No client,
 * Docker, HTTP or provider executor is created. Never real canary evidence. */
export async function predictionCanaryAssessmentFixture(t: TestContext, native = false) {
  const f = predictionMountFixture(t);
  if (!native) {
    for (const c of f.manifest.cases) {
      unlinkSync(join(f.root, c.reviewerId, "head/link"));
      c.inventories.base = c.inventories.base.filter(e => e.path !== "link"); c.inventories.head = c.inventories.head.filter(e => e.path !== "link");
      c.allowedFiles = c.allowedFiles.filter(e => e.path !== "head/link"); c.inputDigest = sha(JSON.stringify(c.allowedFiles, null, 2) + "\n");
    }
    for (const b of f.manifest.attemptBindings) b.inputDigest = f.manifest.cases.find(c => c.reviewerId === b.reviewerId)!.inputDigest;
    f.authority.manifestBytes = JSON.stringify(f.manifest); f.authority.manifestSha256 = sha(f.authority.manifestBytes);
  }
  const cli = registerPredictionCliSession(f.authority.registrationBytes, f.authority.registrationSha256, sha("synthetic predecessor"));
  const runtime: any = { kind: "prediction-runtime-acceptance-freeze-v1", acceptance: METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE, scientificRegistration: cli,
    tools: [{ kind: "synthetic inventory, not image observations", sha256: sha("fixture only") }], providerAuthorized: false, executionReady: false, cliAgentCanaryProven: false, providerCalls: 0 };
  const authority = { preparation: f.authority, runtimeAcceptanceFreeze: trustedFixture(runtime), cliSessionFreeze: trustedFixture({ kind: "prospective-cli-session-registration-freeze-v4", registration: cli, initialLedger: assessPredictionCliBatch(cli, []) }) };
  const pack: any = JSON.parse(JSON.stringify(await preparePredictionPreauthorization(authority, f.root))), p = pack.preauthorization, canary = pack.canary, first = p.attempts[0];
  const r4 = trustedFixture({ kind: "prediction-r4-preauthorization-freeze-v1", package: pack, providerAuthorized: false, executionReady: false, providerCalls: 0 });
  const bridgeFreeze = trustedFixture({ kind: "prediction-cli-bridge-freeze-v1", predecessorFreezeSha256: r4.expectedSha256, packageSha256: pack.sha256, canarySha256: canary.sha256,
    acceptedRuntime: { freezeSha256: authority.runtimeAcceptanceFreeze.expectedSha256, acceptance: runtime.acceptance }, source: p.source,
    bridgePolicy: PREDICTION_CLI_BRIDGE_POLICY, bridgePolicySha256: digest(PREDICTION_CLI_BRIDGE_POLICY), providerCalls: 0, providerAuthorized: false, executionReady: false });
  const bindings = { runId: "synthetic-assessment-run", freezeSha256: r4.expectedSha256, packageSha256: pack.sha256, canarySha256: canary.sha256,
    sourceSha256: p.source.sourceSha256, policySha256: digest(PREDICTION_CLI_BRIDGE_POLICY), executionClass: "provider" };
  const route = { model: "gpt-5.6-sol", effort: "high", providerAccess: "cli-session" };
  const scope = { ...bindings, purpose: "canary", attemptId: canary.canaryId, sourceAttemptId: first.id, promptSha256: canary.promptSha256, mountSha256: first.mountSha256, rawScopeSha256: first.rawScopeSha256, ...route };
  const egress = sealFixture({ executionClass: "provider", image: runtime.acceptance.image, providerAuthorities: PREDICTION_CLI_BRIDGE_POLICY.providerAuthorities,
    topology: "gateway-and-forwarder-only-before-provider", network: "synthetic-internal", externalNetwork: "synthetic-external", gateway: { name: "synthetic-gateway" }, forwarder: { name: "synthetic-forwarder" } }, "attestationSha256");
  const session = "synthetic-model-session", diff = readFileSync(join(f.firstRoot, "review.diff"), "utf8");
  const complete = (value: object) => ({ status: "complete-for-indexed-export", truncated: false, limitations: [], unavailable: [], ...value });
  const transcript = [
    { tool: "list_tree", arguments: {}, value: complete({ entries: [{ path: "review.diff", type: "file" }] }) },
    { tool: "read_file", arguments: { path: "review.diff" }, value: complete({ text: diff }) },
    { tool: "search_text", arguments: { query: "diff --git", path: "review.diff" }, value: complete({ matches: [{ path: "review.diff", line: 1, text: diff.split("\n")[0] }] }) },
    { tool: "read_link", arguments: { path: native ? "head/link" : "review.diff" }, value: native ? { kind: "literal-symlink-source", target: "index.ts", followed: false } : { status: "incomplete", limitations: ["invalid-or-unavailable-read"], unavailable: true } },
  ].map((v, i) => ({ ticket: i + 1, tool: v.tool, arguments: v.arguments, response: JSON.stringify(v.value), delivered: true }));
  const toolCalls = transcript.map((v, i) => ({ sequence: i + 4, name: v.tool, status: i === 3 && !native ? "incomplete" : "complete-for-indexed-export", resultSha256: sha("review-read-mcp-tool-result-v1\0" + JSON.stringify({ content: [{ type: "text", text: v.response }], isError: JSON.parse(v.response).status === "incomplete" })), incompleteCodes: [] }));
  const auditBody = { schemaVersion: 1, protocol: "review-read-mcp-audit-v1", requests: { observed: 7, budgeted: 7, parsed: 7, denied: 0 }, sessions: { attempted: 1, initialized: 1, ready: 1, denied: 0 },
    tools: { attempted: 4, complete: native ? 4 : 3, incomplete: native ? 0 : 1, denied: 0 }, toolCalls, incompleteResultCodes: [], denialCodes: [], transportFailures: [] };
  const audit = { ...auditBody, snapshotSha256: sha("review-read-mcp-audit-snapshot-v1\0" + JSON.stringify(auditBody)) };
  const events = [{ type: "thread.started", thread_id: session }, { type: "turn.started" }, ...transcript.map(v => ({ type: "item.completed", item: { id: `tool-${v.ticket}`, type: "mcp_tool_call", server: "source_read", tool: v.tool, arguments: v.arguments, result: { content: [{ type: "text", text: v.response }] } } })), { type: "turn.completed", usage: { input_tokens: 20, output_tokens: 5 } }];
  const deadline = sealFixture({ kind: "prediction-cli-deadline-terminal-v1", attemptId: canary.canaryId, executionClass: "whole-attempt", wallMs: 1200000, deadlineExceeded: false,
    cancellationReason: null, elapsedMs: 40, executionError: null, cleanupError: null, readCloseError: null, evidenceError: null, teardownCompleted: true,
    events: ["start", "exec-start", "exec-closed", "teardown-complete"].map((kind, i) => ({ kind, elapsedMs: i * 10,
      detail: [{ attemptId: canary.canaryId, wallMs: 1200000, executionClass: "whole-attempt", providerAuthorization: "not-issued-by-this-primitive" }, { command: "codex", remainingMs: 1199989 }, { code: 0, timedOut: false, cleanupErrors: [], cleanupErrorsTruncated: false }, null][i] })), providerContainmentProven: false, providerAuthorized: false });
  const output = "Synthetic infrastructure result only. No model or provider ran.";
  const gatewayBody = { schemaVersion: 1, protocol: "egress-gateway-audit-v1", events: [{ seq: 1, kind: "connect", decision: "allow", reason: "allowed", authorityDigest: sha("chatgpt.com:443") }] };
  const forwarderBody = { schemaVersion: 1, protocol: "methodology-mcp-forwarder-audit-v1", sealed: true, requests: { observed: 7, allowed: 7, denied: 0, forwarded: 7, budgeted: 7 },
    events: Array.from({ length: 7 }, (_, i) => ({ sequence: i + 1, decision: "allow", code: "forwarded" })) };
  const files: Record<string, any> = {
    "bridge.json": { bindings, source: p.source, policy: PREDICTION_CLI_BRIDGE_POLICY, providerAuthorized: false, executionReady: false },
    "canary/start.json": { bindings, scope, approval: { scope, permission: "one-provider-cli-attempt", approvalEvidenceSha256: sha("synthetic approval"), independentGateSha256: sha("synthetic gate") } },
    "canary/invocation.json": { scope, args: predictionCliCommand("http://mcp-forwarder:8082/mcp/" + "a".repeat(64), false), prompt: canary.prompt, providerImage: runtime.acceptance.image, assets: [], egress,
      attachment: { inputDigest: first.mountSha256, attemptId: first.id, registrationSha256: p.authoritySha256.registration, mountManifestSha256: p.authoritySha256.mounts, toolDefinitionsSha256: digest(p.toolBinding.definitions) } },
    "canary/execution.json": { code: 0, timedOut: false, stdout: events.map(e => JSON.stringify(e)).join("\n"), stderr: "" },
    "canary/output/result.json": output,
    "canary/terminal.json": { bindings, scope, providerCalls: 1, failure: null, disallowed: [], tokens: observePredictionCliTokens(events, true), deadline,
      terminal: { status: "completed", events, completeEventStream: true, rawOutput: output, cleanupProven: true, deadlineExceeded: false } },
    "canary/deadline/terminal.json": deadline,
    "canary/cleanup.json": { reader: { inputDigest: first.mountSha256, closed: true, pending: [], stopped: false, calls: 4, bytes: transcript.reduce((sum, t) => sum + Buffer.byteLength(t.response), 0), transcript }, audit,
      sidecars: ["gateway", "forwarder"].map(sidecar => ({ sidecar, ready: false, sealed: true, selfDigestValid: true, lineObserved: true })) },
    "observer/runtime.json": { image: runtime.acceptance.image, tools: runtime.tools, sourceSha256: p.source.sourceSha256, configurationSupported: true, modelSessionId: session },
    "observer/batch-before.json": p.batch, "observer/batch-after.json": structuredClone(p.batch),
    "observer/catalog.json": { modelSessionId: session, complete: true, repositoryTools: p.toolBinding.definitions, bookkeeping: [] },
    "observer/identity.json": { modelSessionId: session, requested: route, observedRequest: { model: route.model, effort: route.effort }, servedModel: null, servedVersion: null, provenance: "unavailable", providerEvidenceReference: null },
    "observer/lifecycle.json": { modelSessionId: session, clientProcessId: 12345, clientContainer: "peregrine-eval-synthetic-client", deadlineSha256: deadline.sha256, guardStartedBeforePreparation: true, deadlineSignalAttached: true, clientClosed: true, cleanupUncancelled: true, elapsedTimeoutObserved: false, forcedTerminationObserved: false },
    "observer/absence.json": { modelSessionId: session, deadlineSha256: deadline.sha256, clientContainer: "peregrine-eval-synthetic-client", resources: [["process", "12345"], ["container", "peregrine-eval-synthetic-client"], ["container", egress.gateway.name], ["container", egress.forwarder.name], ["network", egress.network], ["network", egress.externalNetwork]].map(([kind, id]) => ({ kind, id, observedAbsent: true, afterClientClosed: true, uncancelled: true, queryResult: { code: 0, stdout: "", timedOut: false } })) },
    "observer/tool-calls.json": { modelSessionId: session, nativeLinkMode: native ? "literal-native-link" : "no-native-link-refusal", calls: transcript.map(t => ({ eventId: `tool-${t.ticket}`, ticket: t.ticket, source: "model", responseSha256: sha(t.response) })) },
    "observer/gateway-audit.json": { ...gatewayBody, sealed: true, sha256: sha("egress-gateway-audit-v1\0" + JSON.stringify(gatewayBody)) },
    "observer/forwarder-audit.json": { ...forwarderBody, snapshotSha256: sha("methodology-mcp-forwarder-audit-v1\0" + JSON.stringify(forwarderBody)) },
  };
  const observer: any = { kind: "authenticated-prediction-canary-observer-v1", binding: { ...scope, bridgeFreezeSha256: bridgeFreeze.expectedSha256, runtimeFreezeSha256: authority.runtimeAcceptanceFreeze.expectedSha256 },
    observerReference: "synthetic external trust fixture only", observerSessionId: "synthetic-observer", modelSessionId: session, reviewSessionId: "synthetic-reviewer" };
  const input: PredictionCanaryAssessmentInput = { runId: bindings.runId, registration: { bytes: f.authority.registrationBytes, expectedSha256: f.authority.registrationSha256 }, mountManifest: { bytes: f.authority.manifestBytes, expectedSha256: f.authority.manifestSha256 }, r4Freeze: r4, bridgeFreeze, runtimeFreeze: authority.runtimeAcceptanceFreeze, observer: null, artifacts: [] };
  const repin = () => {
    input.artifacts = Object.entries(files).map(([path, value]) => ({ path, bytes: path === "canary/output/result.json" ? value : JSON.stringify(value) }));
    observer.inventory = input.artifacts.map(a => ({ path: a.path, bytes: Buffer.byteLength(a.bytes), sha256: sha(a.bytes) })).sort((a, b) => a.path.localeCompare(b.path));
    observer.review = { inventorySha256: digest(observer.inventory), completeCapabilityExposureReviewed: true, leakageAbsent: true, unsupportedIdentityClaimsAbsent: true, noScoredReview: true };
    input.observer = trustedFixture(observer); return input;
  };
  const syncReads = () => {
    const transcript = files["canary/cleanup.json"].reader.transcript;
    const events = files["canary/terminal.json"].terminal.events;
    const calls = events.filter((e: any) => e.type === "item.completed");
    transcript.forEach((v: any, i: number) => { Object.assign(calls[i].item, { tool: v.tool, arguments: v.arguments, result: { content: [{ type: "text", text: v.response }] } }); });
    files["canary/execution.json"].stdout = events.map((e: any) => JSON.stringify(e)).join("\n");
    files["canary/terminal.json"].tokens = observePredictionCliTokens(events, true);
    const cleanup = files["canary/cleanup.json"], audit = cleanup.audit;
    cleanup.reader.bytes = transcript.reduce((sum: number, t: any) => sum + Buffer.byteLength(t.response), 0);
    audit.toolCalls = transcript.map((v: any, i: number) => ({ sequence: i + 4, name: v.tool, status: JSON.parse(v.response).status === "incomplete" ? "incomplete" : "complete-for-indexed-export",
      resultSha256: sha("review-read-mcp-tool-result-v1\0" + JSON.stringify({ content: [{ type: "text", text: v.response }], isError: JSON.parse(v.response).status === "incomplete" })), incompleteCodes: [] }));
    audit.tools = { attempted: 4, complete: audit.toolCalls.filter((v: any) => v.status === "complete-for-indexed-export").length, incomplete: audit.toolCalls.filter((v: any) => v.status === "incomplete").length, denied: 0 };
    delete audit.snapshotSha256; audit.snapshotSha256 = sha("review-read-mcp-audit-snapshot-v1\0" + JSON.stringify(audit));
    files["observer/tool-calls.json"].calls = transcript.map((t: any) => ({ eventId: `tool-${t.ticket}`, ticket: t.ticket, source: "model", responseSha256: sha(t.response) }));
    return repin();
  };
  return { input: repin(), repin, syncReads, files, observer, root: f.root };
}
