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
  f.files["canary/invocation.json"].args = predictionSolLowCanaryCommand("http://mcp-forwarder:8082/mcp/" + "a".repeat(64));
  const route = { model: "gpt-5.6-sol", effort: "low", providerAccess: "cli-session" };
  Object.assign(f.files["observer/identity.json"], { requested: route, observedRequest: { model: route.model, effort: route.effort } });
  f.files["observer/runtime.json"].sourceSha256 = op.contract.source.sourceSha256;
  const deadline = f.files["canary/deadline/terminal.json"]; deadline.attemptId = amendment.canaryId; deadline.events[0].detail.attemptId = amendment.canaryId; sealFixture(deadline);
  f.files["canary/terminal.json"].deadline = deadline;
  for (const path of ["observer/lifecycle.json", "observer/absence.json"]) f.files[path].deadlineSha256 = deadline.sha256;
  f.observer.kind = "authenticated-prediction-sol-low-canary-observer-v1";
  f.observer.binding = { ...scope, bridgeFreezeSha256: f.input.bridgeFreeze.expectedSha256, runtimeFreezeSha256: f.input.runtimeFreeze.expectedSha256, operatorFreezeSha256: op.frozen.expectedSha256, operatorGateSha256: op.gate.expectedSha256 };
  const batch = f.pack.preauthorization.batch;
  const repin = () => {
    const terminal = f.files["canary/terminal.json"];
    f.files["operator/preflight.json"] = { contractSha256: digest(op.contract), sourceSha256: op.contract.source.sourceSha256, predecessorGateSha256: op.contract.predecessor.gateSha256, freshGateSha256: op.gate.expectedSha256, executionDirectoryAbsent: true, providerCalls: 0, executionStateCreated: false, batch };
    f.files["operator/dispatch.json"] = { scope, freezeSha256: op.frozen.expectedSha256, freshGateSha256: op.gate.expectedSha256, before: { batch } };
    f.files["operator/terminal.json"] = { status: "awaiting-independent-observations", terminalSha256: digest(terminal), providerCalls: 1, executionReady: false, batchAuthorized: false, snapshot: { batch } };
    f.files["canary-ledger-start.json"] = { bindings, ...amendment.separateLedger, batchAuthorized: false };
    f.files["canary-ledger-terminal.json"] = { bindings, ledger: { ...amendment.separateLedger, status: terminal.terminal.status, providerCalls: 1, terminalSha256: digest(terminal), terminal: terminal.terminal, batchAuthorized: false } };
    const inventory = Object.entries(f.files).filter(([path]) => !path.startsWith("operator/") && !path.startsWith("observer/")).map(([path, value]) => {
      const bytes = path === "canary/output/result.json" ? value : JSON.stringify(value); return { path, bytes: Buffer.byteLength(bytes), sha256: sha(bytes) }; });
    for (const part of ["client", "sidecars"]) inventory.push({ path: `canary/mechanical-${part}/000001-terminal.json`, bytes: 1, sha256: sha("synthetic mechanical witness only") });
    f.files["operator/retained-inventory.json"] = { inventory, sha256: digest(inventory), independentObservation: false };
    return Object.assign(f.repin(), { operatorFreeze: op.frozen, operatorGate: op.gate }) as PredictionSolLowAssessmentInput;
  };
  return { ...f, op, input: repin(), repin };
}
