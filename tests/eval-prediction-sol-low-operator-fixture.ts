import type { TestContext } from "node:test";
import { basename, dirname, join } from "node:path";
import { realpathSync } from "node:fs";
import { digest, sha } from "../eval/prediction-contract.js";
import { compileSolLowOperator } from "../eval/prediction-sol-low-operator-contract.js";
import { predictionSolLowFixture, trustedLowFixture as trusted } from "./eval-prediction-sol-low-canary-fixture.js";
import { predictionCanaryAssessmentFixture, sealFixture } from "./eval-prediction-canary-assessment-fixture.js";
import { preparePredictionSolLowCanary, SOL_LOW_CANARY_USER_AUTHORIZATION } from "../eval/prediction-sol-low-canary.js";
import { predictionSolLowCanaryCommand } from "../eval/prediction-sol-low-command.js";
import type { PredictionSolLowAssessmentInput } from "../eval/prediction-canary-assessment.js";
import { renderContainedProviderArgs } from "../eval/runtime-containment.js";
import { renderMethodologySidecarArgs, methodologyGatewayEnvironment, methodologyForwarderEnvironment, GATEWAY_ENTRYPOINT, FORWARDER_ENTRYPOINT } from "../eval/methodology-egress.js";
import { PREDICTION_MCP_LIMITS } from "../eval/prediction-runtime-attachment.js";
import { canonicalJsonSha256 } from "../eval/experiment.js";
import { predictionDockerFixture } from "./eval-prediction-cli-bridge-fixture.js";

function operator(options: any, prior: any) {
  options = { ...options, directory: join(realpathSync(dirname(options.directory)), basename(options.directory)) };
  prior = { ...prior, execution: { ...prior.execution, directory: options.directory } };
  const predecessorFreeze = trusted({ ...prior, publicCommit: "d".repeat(40), actualCanaryStarted: false, unstartedReviewAttempts: 64 });
  options = { ...options, solLowAmendment: { ...options.solLowAmendment, freezeBytes: predecessorFreeze.bytes, freezeSha256: predecessorFreeze.expectedSha256 } };
  const predecessorGate = trusted({ kind: "prediction-sol-low-independent-gate-v1", verdict: "PASS", blockingFindings: [], publicCommit: "d".repeat(40), publicPredecessor: "b".repeat(40), privateCommit: "f".repeat(40),
    freezeSha256: predecessorFreeze.expectedSha256, reviewTask: "/root/sol_low_canary_astra_medium_gate", requestedModel: "gpt-6-astra", requestedReasoning: "medium", servedIdentity: null,
    provenance: "coordinator-relayed agent verdict, not independently retrieved or runtime-authenticated", boundary: "Synthetic only. No actual gate or provider evidence.", validated: "synthetic fixture" });
  const contract = compileSolLowOperator({ predecessorFreeze, predecessorGate, options });
  const frozen = trusted({ kind: "prediction-sol-low-operator-freeze-v1", contract, providerCalls: 0, providerAuthorized: false, executionReady: false, batchAuthorized: false });
  const gate = trusted({ kind: "prediction-sol-low-operator-review-v1", verdict: "PASS", blockingFindings: [], freezeSha256: frozen.expectedSha256, sourceSha256: contract.source.sourceSha256,
    reviewReference: "synthetic independent gate only", provenance: "operator-supplied independent review" });
  return { contract, frozen, gate, request: { freeze: frozen, gate, reportDirectory: join(options.mountsRoot, "operator-report"), action: "authorize-one-canary" as const } };
}
export async function solLowOperatorFixture(t: TestContext) { const f = await predictionSolLowFixture(t); return { ...f, ...operator(f.options, f.frozen) }; }

/** Fabricated complete external observations, never output of the operator. */
export async function solLowAssessmentFixture(t: TestContext) {
  const f = await predictionCanaryAssessmentFixture(t), old = f.pack.canary;
  const authority = { r4Freeze: f.input.r4Freeze, bridgeFreeze: f.input.bridgeFreeze,
    assessmentFreeze: trusted({ kind: "prediction-canary-assessment-freeze-v4", providerCalls: 0, providerAuthorized: false, executionReady: false, reviewAttemptsStarted: 0, unstartedReviewAttempts: 64, batchAuthorized: false,
      privateBindings: [["r4-preauthorization-v1/freeze-1.json", f.input.r4Freeze.expectedSha256], ["cli-bridge-v1/freeze-1.json", f.input.bridgeFreeze.expectedSha256]].map(([path, sha256]) => ({ path: "ai-exploratory/prediction-development-v1/" + path, sha256 })) }),
    userAuthorization: { bytes: SOL_LOW_CANARY_USER_AUTHORIZATION, expectedSha256: sha(SOL_LOW_CANARY_USER_AUTHORIZATION) } };
  const amendment = preparePredictionSolLowCanary(authority), directory = join(f.root, "low-assessment-execution"), runId = f.input.runId;
  const prior = { kind: "prediction-sol-low-canary-freeze-v1", amendment, source: f.pack.preauthorization.source, execution: { runId, directory }, providerCalls: 0, providerAuthorized: false, executionReady: false, batchAuthorized: false };
  const op = operator({ authority: f.authority, mountsRoot: f.root, freezeBytes: f.input.r4Freeze.bytes, freezeSha256: f.input.r4Freeze.expectedSha256, directory, runId, solLowAmendment: { authority } }, prior);
  const bindings = { ...f.files["bridge.json"].bindings, canarySha256: amendment.sha256, sourceSha256: op.contract.source.sourceSha256, policySha256: amendment.policySha256,
    amendmentFreezeSha256: op.contract.bridgeFreeze.expectedSha256, userAuthorizationSha256: amendment.userAuthorization.sha256,
    predecessorCanarySha256: old.sha256, predecessorBridgeFreezeSha256: f.input.bridgeFreeze.expectedSha256, predecessorAssessmentFreezeSha256: authority.assessmentFreeze.expectedSha256 };
  const scope = { ...f.files["canary/start.json"].scope, ...bindings, effort: "low", attemptId: amendment.canaryId };
  for (const path of ["bridge.json", "canary/start.json", "canary/terminal.json"]) f.files[path].bindings = bindings;
  for (const path of ["canary/start.json", "canary/invocation.json", "canary/terminal.json"]) f.files[path].scope = scope;
  f.files["bridge.json"].source = op.contract.source; f.files["bridge.json"].policy = amendment.policy;
  f.files["canary/start.json"].approval = { scope, permission: "one-provider-cli-attempt", approvalEvidenceSha256: amendment.userAuthorization.sha256, independentGateSha256: op.contract.predecessor.gateSha256 };
  const capability = { kind: "forwarding-capability-sha256-v1", sha256: sha("a".repeat(64)) };
  f.files["canary/terminal.json"].outputRedaction = { kind: capability.kind, originalSha256: sha(f.files["canary/output/result.json"]), persistedSha256: sha(f.files["canary/output/result.json"]) };
  f.files["canary/invocation.json"].forwarderCapability = capability;
  f.files["canary/invocation.json"].args = predictionSolLowCanaryCommand("http://mcp-forwarder:8082/mcp/" + capability.sha256);
  const route = { model: "gpt-5.6-sol", effort: "low", providerAccess: "cli-session" };
  Object.assign(f.files["observer/identity.json"], { requested: route, observedRequest: { model: route.model, effort: route.effort } });
  f.files["observer/runtime.json"].sourceSha256 = op.contract.source.sourceSha256;
  const deadline = f.files["canary/deadline/terminal.json"]; deadline.attemptId = amendment.canaryId; deadline.events[0].detail.attemptId = amendment.canaryId;
  const clock = (at: number) => ({ kind: "node-performance-clock-v1", processId: 4242, timeOriginMs: 0.5, monotonicMs: at, unixMs: at });
  deadline.kind = "prediction-cli-deadline-terminal-v2"; deadline.clock = clock(0);
  deadline.elapsedMs = 310; deadline.events.forEach((e: any, i: number) => { e.elapsedMs = i * 100; }); deadline.events[1].detail.remainingMs = 1199899; sealFixture(deadline);
  f.files["canary/terminal.json"].deadline = deadline;
  for (const path of ["observer/lifecycle.json", "observer/absence.json"]) f.files[path].deadlineSha256 = deadline.sha256;
  f.observer.kind = "authenticated-prediction-sol-low-canary-observer-v1";
  f.observer.binding = { ...scope, bridgeFreezeSha256: f.input.bridgeFreeze.expectedSha256, runtimeFreezeSha256: f.input.runtimeFreeze.expectedSha256, operatorFreezeSha256: op.frozen.expectedSha256, operatorGateSha256: op.gate.expectedSha256 };
  const batch = f.pack.preauthorization.batch;
  // Actual synthetic receipt bytes, not inventory-name witnesses. Kept separate
  // from repin so resealing an attack cannot silently repair its receipt.
  const captured = (bytes: string) => ({ bytes, complete: true, sha256: sha(bytes) });
  const egress = f.files["canary/invocation.json"].egress, image = f.files["canary/invocation.json"].providerImage;
  const suffix = "12345678-1234-1234-1234-123456789abc";
  egress.network = `peregrine-egress-${suffix}`; egress.externalNetwork = `peregrine-egress-x-${suffix}`;
  egress.gateway.name = `peregrine-egress-gateway-000001-${suffix}`; egress.forwarder.name = `peregrine-egress-forwarder-000001-${suffix}`;
  f.files["observer/absence.json"].resources.slice(2).forEach((r: any, i: number) => { r.id = [egress.gateway.name, egress.forwarder.name, egress.network, egress.externalNetwork][i]; });
  Object.assign(egress, { schemaVersion: 1, protocol: "methodology-egress-supervisor-v1", attemptId: "attempt-000001", armId: f.pack.preauthorization.attempts[0].arm,
    sourceHeadTree: f.pack.preauthorization.dryRun.preparation.sourceBindings.find((m: any) => m.caseId === f.pack.preauthorization.attempts[0].caseId).headTree,
    providerAuthoritiesSha256: canonicalJsonSha256(egress.providerAuthorities) });
  const clientName = "peregrine-eval-12345678-1234-1234-1234-123456789abc";
  f.files["observer/lifecycle.json"].clientContainer = clientName; f.files["observer/absence.json"].clientContainer = clientName;
  f.files["observer/absence.json"].resources[1].id = clientName;
  const session = { providerAccess: "cli-session", directory: join(f.root, "synthetic-session"), identity: { uid: 501, gid: 20 }, credentialContentsRead: false };
  const { maxSessions: _, ...transport } = PREDICTION_MCP_LIMITS, limits = { ...transport, maxHeaderBytes: 8192 };
  Object.assign(egress, { networkSubnet: "10.254.1.0/28", externalNetworkSubnet: "10.254.2.0/28", hostMcpPort: 31337, mcpLimitsSha256: canonicalJsonSha256(limits) });
  Object.assign(egress.gateway, { alias: "egress-gateway", entrypoint: GATEWAY_ENTRYPOINT }); Object.assign(egress.forwarder, { alias: "mcp-forwarder", entrypoint: FORWARDER_ENTRYPOINT }); sealFixture(egress, "attestationSha256");
  f.files["canary/execution.json"].processId = 12345;
  const ordinals = { client: 0, sidecars: 0 };
  const receipt = (channel: "client" | "sidecars", args: string[], startedAt: number, cleanup = false, stdout = "", client = false) => {
    const sequence = ++ordinals[channel], prefix = `canary/mechanical-${channel}/${String(sequence).padStart(6, "0")}`;
    const binding = { runId, attemptId: scope.attemptId, scopeSha256: digest(scope), sourceSha256: scope.sourceSha256, channel };
    f.files[prefix + "-start.json"] = { kind: "prediction-mechanical-start-v3", clock: clock(startedAt), binding, forwarderCapability: capability, sequence, command: "docker", args,
      stdinSha256: client ? scope.promptSha256 : null, deadlineAttached: !cleanup, aborted: false, timeoutMs: 10000, cleanup, startedAt };
    const result = client ? f.files["canary/execution.json"] : { code: 0, timedOut: false, processId: 20000 + sequence, stdout, stderr: "" };
    f.files[prefix + "-terminal.json"] = { kind: "prediction-mechanical-terminal-v3", clock: clock(startedAt + 1), binding, forwarderCapability: capability, sequence, result: { ...result, stdout: captured(result.stdout), stderr: captured(result.stderr) }, closedAt: startedAt + 1, evidenceError: null };
  };
  receipt("client", renderContainedProviderArgs({ runner: "codex", profile: "prediction-sol-low-canary", image, containerName: clientName, identity: session.identity,
    checkoutDir: join(op.contract.execution.directory, "canary/workspace"), assetsDir: join(op.contract.execution.directory, "canary/assets"), outputDir: join(op.contract.execution.directory, "canary/output"),
    access: ["--mount", `type=bind,source=${session.directory}/auth.json,target=/home/peregrine/.codex/auth.json,readonly`], command: "codex", commandArgs: f.files["canary/invocation.json"].args,
    methodologyEgress: { network: egress.network, proxyUrl: "http://egress-gateway:8081" } }), 100, false, "", true);
  receipt("client", ["rm", "--force", clientName], 105, true);
  receipt("client", ["ps", "--all", "--quiet", "--filter", `name=^/${clientName}$`], 110, true);
  let at = 10;
  const docker = predictionDockerFixture(async () => { throw new Error("fixture setup never invokes client"); }, () => at);
  const setupReceipt = async (args: string[]) => { at += 2; const result = await docker.run("docker", args); receipt("sidecars", args, at, false, result.stdout); };
  await setupReceipt(["network", "create", "--ipv6=false", "--driver", "bridge", "--subnet", egress.externalNetworkSubnet, egress.externalNetwork]);
  await setupReceipt(["network", "create", "--internal", "--ipv6=false", "--driver", "bridge", "--subnet", egress.networkSubnet, egress.network]);
  await setupReceipt(renderMethodologySidecarArgs(egress.gateway.name, egress.externalNetwork, image, GATEWAY_ENTRYPOINT, methodologyGatewayEnvironment(egress.providerAuthorities)));
  await setupReceipt(renderMethodologySidecarArgs(egress.forwarder.name, egress.externalNetwork, image, FORWARDER_ENTRYPOINT, methodologyForwarderEnvironment(capability.sha256, egress.hostMcpPort, limits), "host.docker.internal:host-gateway"));
  for (const role of ["gateway", "forwarder"]) await setupReceipt(["logs", "--tail", "64", egress[role].name]);
  for (const role of ["gateway", "forwarder"]) await setupReceipt(["network", "connect", "--alias", egress[role].alias, egress.network, egress[role].name]);
  await setupReceipt(["inspect", egress.gateway.name, egress.forwarder.name]);
  for (const name of [egress.network, egress.externalNetwork]) await setupReceipt(["network", "inspect", name]);
  at = 220;
  for (const role of ["gateway", "forwarder"]) {
    const name = egress[role].name;
    receipt("sidecars", ["stop", "--time", "15", name], at += 2, true);
    receipt("sidecars", ["logs", "--tail", "64", name], at += 2, true, JSON.stringify({ status: "sealed", protocol: role === "gateway" ? "egress-gateway-v1" : "methodology-mcp-forwarder-v1", audit: f.files[`observer/${role}-audit.json`] }));
    receipt("sidecars", ["rm", "--force", name], at += 2, true);
    receipt("sidecars", ["ps", "--all", "--quiet", "--filter", `name=^/${name}$`], at += 2, true);
  }
  for (const name of [egress.externalNetwork, egress.network]) {
    receipt("sidecars", ["network", "rm", name], at += 2, true);
    receipt("sidecars", ["network", "ls", "--quiet", "--filter", `name=^${name}$`], at += 2, true);
  }
  const syncMechanicalExecution = () => { const result = f.files["canary/execution.json"];
    f.files["canary/mechanical-client/000001-terminal.json"].result = { ...result, stdout: captured(result.stdout), stderr: captured(result.stderr) }; };
  const repin = () => {
    const terminal = f.files["canary/terminal.json"];
    f.files["operator/preflight.json"] = { contractSha256: digest(op.contract), sourceSha256: op.contract.source.sourceSha256, predecessorGateSha256: op.contract.predecessor.gateSha256, freshGateSha256: op.gate.expectedSha256, executionDirectoryAbsent: true, providerCalls: 0, executionStateCreated: false, batch, session };
    f.files["operator/dispatch.json"] = { scope, freezeSha256: op.frozen.expectedSha256, freshGateSha256: op.gate.expectedSha256, before: { batch } };
    f.files["operator/terminal.json"] = { status: "awaiting-independent-observations", terminalSha256: digest(terminal), providerCalls: 1, executionReady: false, batchAuthorized: false, snapshot: { batch } };
    f.files["canary-ledger-start.json"] = { bindings, ...amendment.separateLedger, batchAuthorized: false };
    f.files["canary-ledger-terminal.json"] = { bindings, ledger: { ...amendment.separateLedger, status: terminal.terminal.status, providerCalls: 1, terminalSha256: digest(terminal), terminal: terminal.terminal, batchAuthorized: false } };
    const inventory = Object.entries(f.files).filter(([path]) => !path.startsWith("operator/") && !path.startsWith("observer/")).map(([path, value]) => {
      const bytes = path === "canary/output/result.json" ? value : JSON.stringify(value); return { path, bytes: Buffer.byteLength(bytes), sha256: sha(bytes) }; });
    f.files["operator/retained-inventory.json"] = { inventory, sha256: digest(inventory), independentObservation: false };
    return Object.assign(f.repin(), { operatorFreeze: op.frozen, operatorGate: op.gate }) as PredictionSolLowAssessmentInput;
  };
  return { ...f, op, input: repin(), repin, syncMechanicalExecution };
}
