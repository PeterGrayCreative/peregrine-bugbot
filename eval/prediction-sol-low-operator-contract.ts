import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { digest, exact, freeze, hash, same, sha, text } from "./prediction-contract.js";
import { predictionExecutionSourceManifest } from "./prediction-execution-freeze.js";
import { preparePredictionPreauthorization } from "./prediction-preauthorization.js";
import { preparePredictionSolLowCanary } from "./prediction-sol-low-canary.js";
import type { PredictionSolLowCanaryBridgeOptions } from "./prediction-cli-bridge.js";

export interface CanaryTrustedBytes { bytes: string; expectedSha256: string }
export interface SolLowOperatorRegistration {
  predecessorFreeze: CanaryTrustedBytes;
  predecessorGate: CanaryTrustedBytes;
  options: PredictionSolLowCanaryBridgeOptions;
}
export function canaryTrusted(input: CanaryTrustedBytes, kind: string): any {
  exact(input, ["bytes", "expectedSha256"], "trusted canary bytes");
  same(sha(input.bytes), hash(input.expectedSha256), "trusted canary bytes drift");
  const value = JSON.parse(input.bytes); same(value.kind, kind, "canary artifact kind mismatch"); return value;
}
const commit = (value: unknown) => { if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) throw new Error("full commit required"); return value; };

/** Prospective source successor, not a new canary, gate, or authorization. */
export function compileSolLowOperator(registration: SolLowOperatorRegistration, source = predictionExecutionSourceManifest()) {
  const r = freeze(registration), prior = canaryTrusted(r.predecessorFreeze, "prediction-sol-low-canary-freeze-v1");
  const gate = canaryTrusted(r.predecessorGate, "prediction-sol-low-independent-gate-v1"), o = r.options;
  same([gate.verdict, gate.blockingFindings, gate.publicCommit, gate.freezeSha256], ["PASS", [], prior.publicCommit, r.predecessorFreeze.expectedSha256], "predecessor independent gate mismatch");
  commit(gate.publicCommit); commit(gate.publicPredecessor); commit(gate.privateCommit);
  same([gate.reviewTask, gate.requestedModel, gate.requestedReasoning, gate.servedIdentity, gate.provenance],
    ["/root/sol_low_canary_astra_medium_gate", "gpt-6-astra", "medium", null, "coordinator-relayed agent verdict, not independently retrieved or runtime-authenticated"], "gate provenance drift");
  text(gate.boundary); text(gate.validated);
  const amendment = preparePredictionSolLowCanary(o.solLowAmendment.authority);
  same([prior.amendment, prior.execution, prior.providerCalls, prior.providerAuthorized, prior.executionReady, prior.batchAuthorized, prior.actualCanaryStarted, prior.unstartedReviewAttempts],
    [amendment, { runId: o.runId, directory: resolve(o.directory) }, 0, false, false, false, false, 64], "predecessor canary or ledger mismatch");
  same(o.solLowAmendment.freezeBytes, r.predecessorFreeze.bytes, "original canary freeze bytes required");
  same(o.solLowAmendment.freezeSha256, r.predecessorFreeze.expectedSha256, "original canary freeze pin required");
  same(o.solLowAmendment.authority.r4Freeze, { bytes: o.freezeBytes, expectedSha256: o.freezeSha256 }, "original R4 authority mismatch");
  same(digest(source.files), source.sourceSha256, "operator source seal drift");
  const bridgeFreeze = { kind: "prediction-sol-low-canary-freeze-v1", amendment, source, execution: prior.execution,
    predecessorFreezeSha256: r.predecessorFreeze.expectedSha256, predecessorGateSha256: r.predecessorGate.expectedSha256,
    providerCalls: 0, providerAuthorized: false, executionReady: false, batchAuthorized: false };
  const bytes = JSON.stringify(bridgeFreeze);
  return freeze({ kind: "prediction-sol-low-operator-contract-v1", registration: { predecessorFreeze: r.predecessorFreeze, predecessorGate: r.predecessorGate }, source, amendment, options: o,
    bridgeFreeze: { bytes, expectedSha256: sha(bytes) },
    predecessor: { freezeSha256: r.predecessorFreeze.expectedSha256, gateSha256: r.predecessorGate.expectedSha256, publicCommit: gate.publicCommit, privateCommit: gate.privateCommit },
    execution: prior.execution, maximumAttempts: 1, reviewAttemptsAllowed: 0, batchAuthorized: false, providerAuthorized: false, executionReady: false,
    observerBoundary: "Mechanical artifacts are not independent catalog, model-originated tool, identity, or leakage observations. Missing independently pinned observations make the low-route assessment not-eligible." });
}
export type SolLowOperatorContract = ReturnType<typeof compileSolLowOperator>;

/** Read-only preflight: no directory, session read, process, capability or ledger
 * mutation. Session content remains opaque; containment validates its metadata. */
export function bindSolLowOperator(input: CanaryTrustedBytes, freshGate: CanaryTrustedBytes) {
  const packet = canaryTrusted(input, "prediction-sol-low-operator-freeze-v1");
  const contract = compileSolLowOperator({ ...packet.contract.registration, options: packet.contract.options }, packet.contract.source);
  same(packet.contract, contract, "operator freeze/source reconstruction mismatch");
  same([packet.providerCalls, packet.providerAuthorized, packet.executionReady, packet.batchAuthorized], [0, false, false, false], "operator freeze grants authority");
  const gate = canaryTrusted(freshGate, "prediction-sol-low-operator-review-v1");
  exact(gate, ["kind", "verdict", "blockingFindings", "freezeSha256", "sourceSha256", "reviewReference", "provenance"], "fresh operator gate");
  same([gate.verdict, gate.blockingFindings, gate.freezeSha256, gate.sourceSha256], ["PASS", [], input.expectedSha256, contract.source.sourceSha256], "fresh operator gate mismatch");
  text(gate.reviewReference); same(gate.provenance, "operator-supplied independent review", "gate trust boundary required");
  return contract;
}
export async function preflightSolLowOperator(input: CanaryTrustedBytes, freshGate: CanaryTrustedBytes) {
  const contract = bindSolLowOperator(input, freshGate);
  same(contract.source, predictionExecutionSourceManifest(), "operator source changed");
  const current = await preparePredictionPreauthorization(contract.options.authority, contract.options.mountsRoot);
  const old = JSON.parse(contract.options.freezeBytes).package;
  const { source: a, sha256: b, ...before } = old.preauthorization, { source: c, sha256: d, ...after } = current.preauthorization;
  same(before, after, "preflight scientific or mount drift");
  same([process.versions.node.split(".")[0], readFileSync(join(process.cwd(), ".nvmrc"), "utf8").trim()], ["22", "22"], "pinned Node22 required");
  const destination = resolve(contract.execution.directory), parent = dirname(destination);
  if (existsSync(destination)) throw new Error("exclusive canary ledger already exists; no retry permitted");
  if (!lstatSync(parent).isDirectory() || realpathSync(parent) !== parent) throw new Error("canonical execution parent required");
  same(contract, compileSolLowOperator({ ...contract.registration, options: contract.options }), "source drift during preflight");
  return contract;
}
