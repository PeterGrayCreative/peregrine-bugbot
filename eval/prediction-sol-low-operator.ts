import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { digest, freeze, same, sha } from "./prediction-contract.js";
import { createPredictionSolLowCanaryBridge, createStructuralPredictionSolLowCanaryBridge } from "./prediction-cli-bridge.js";
import { predictionFailureEvidence } from "./prediction-cli-deadline.js";
import { preflightPredictionCliSession } from "./runtime-containment.js";
import { canaryTrusted, preflightSolLowOperator, type CanaryTrustedBytes } from "./prediction-sol-low-operator-contract.js";
import type { DockerExec } from "./methodology-egress.js";
import { exec } from "../src/util/exec.js";

interface Request { freeze: CanaryTrustedBytes; gate: CanaryTrustedBytes; reportDirectory: string; action: "preflight" | "authorize-one-canary" }
export function runSolLowOperator(request: Request) { return run(request); }
/** Test seam cannot mint a provider-class capability. */
export function runStructuralSolLowOperator(request: Request, executor: DockerExec) { return run(request, executor); }
async function run(input: Request, executor?: DockerExec) {
  const request = freeze(input);
  if (!["preflight", "authorize-one-canary"].includes(request.action)) throw new Error("explicit one-canary action required; no review, retry or batch action exists");
  const packet = canaryTrusted(request.freeze, "prediction-sol-low-operator-freeze-v1");
  const destination = resolve(packet.contract.execution.directory), report = resolve(request.reportDirectory);
  if (report === destination || report.startsWith(destination + "/") || destination.startsWith(report + "/")) throw new Error("preflight evidence must be separate from execution state");
  mkdirSync(report, { mode: 0o700 });
  const write = (name: string, value: unknown) => writeFileSync(join(report, name), JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600 });
  write("start.json", { kind: "prediction-sol-low-operator-start-v1", freezeSha256: request.freeze.expectedSha256, gateSha256: request.gate.expectedSha256,
    action: request.action, executionDirectory: destination, providerCalls: 0, executionStateCreated: false });
  let bridge: Awaited<ReturnType<typeof createPredictionSolLowCanaryBridge>> | undefined;
  let primary: unknown;
  try {
    const contract = await preflightSolLowOperator(request.freeze, request.gate), session = preflightPredictionCliSession();
    const image = contract.amendment.runtimeAcceptance.image;
    const imageResult = await (executor ?? exec)("docker", ["image", "inspect", "--format", "{{json .RepoDigests}}", image], { timeoutMs: 15_000, inheritEnv: false, env: { PATH: process.env.PATH ?? "" } });
    write("runtime-preflight.json", { image, result: imageResult, credentialContentsRead: false, imagePulled: false });
    if (imageResult.code !== 0 || imageResult.timedOut || !Array.isArray(JSON.parse(imageResult.stdout)) || !JSON.parse(imageResult.stdout).includes(image)) throw new Error("accepted immutable runtime unavailable; no image pull or execution state creation");
    const batch = JSON.parse(contract.options.freezeBytes).package.preauthorization.batch;
    write("preflight.json", { kind: "prediction-sol-low-operator-preflight-v1", contractSha256: digest(contract), session,
      sourceSha256: contract.source.sourceSha256, predecessorGateSha256: contract.predecessor.gateSha256, freshGateSha256: request.gate.expectedSha256,
      executionDirectoryAbsent: !existsSync(destination), batch, providerCalls: 0, executionStateCreated: false });
    if (request.action === "preflight") { write("terminal.json", { status: "preflight-passed-no-dispatch", providerCalls: 0, executionReady: false, batchAuthorized: false }); return { status: "preflight-passed-no-dispatch", providerCalls: 0 }; }
    // No await between the final read-only check and invoking the single-use
    // bridge constructor. It independently reconstructs and exclusively creates
    // the frozen directory; a racing process loses without consuming a slot.
    if (existsSync(destination)) throw new Error("canary ledger appeared after preflight");
    const options = { ...contract.options, recordMechanicalEvidence: true as const, solLowAmendment: { ...contract.options.solLowAmendment,
      freezeBytes: contract.bridgeFreeze.bytes, freezeSha256: contract.bridgeFreeze.expectedSha256 } };
    bridge = executor ? await createStructuralPredictionSolLowCanaryBridge({ ...options, run: executor }) : await createPredictionSolLowCanaryBridge(options);
    const scope = bridge.scope("canary", contract.amendment.canaryId);
    const capability = bridge.authorize({ scope, permission: executor ? "synthetic-only" : "one-provider-cli-attempt",
      approvalEvidenceSha256: contract.amendment.userAuthorization.sha256, independentGateSha256: contract.predecessor.gateSha256 });
    write("dispatch.json", { scope, freezeSha256: request.freeze.expectedSha256, freshGateSha256: request.gate.expectedSha256, before: bridge.snapshot() });
    const terminal = await bridge.run(capability);
    same(bridge.snapshot().batch, batch, "canary changed the review ledger");
    write("terminal.json", { status: "awaiting-independent-observations", terminalSha256: digest(terminal), snapshot: bridge.snapshot(),
      providerCalls: terminal.providerCalls, executionReady: false, batchAuthorized: false,
      missing: ["Independently authenticated complete catalog, model/tool provenance, identity limitations, lifecycle/absence and leakage review."],
      qualification: executor ? "Synthetic executor only; never provider evidence." : "Mechanical attempt only; no canary pass, retry, review slot or batch authorization." });
    return { status: "awaiting-independent-observations", terminal };
  } catch (error) {
    primary = error;
    write("failure.json", { status: "operator-failed-closed", failure: predictionFailureEvidence(error), snapshot: bridge?.snapshot() ?? null,
      providerCalls: existsSync(destination) ? null : 0, executionReady: false, batchAuthorized: false });
    throw error;
  } finally {
    // Immutable inventory of every retained partial/start/terminal/cleanup byte.
    // Observer interpretation remains separate and externally pinned.
    if (existsSync(destination)) {
      const inventory: { path: string; bytes: number; sha256: string }[] = [];
      let totalBytes = 0, entries = 0;
      const visit = (path: string) => { if (++entries > 10000) throw new Error("evidence entry limit exceeded"); const stat = lstatSync(path); if (stat.isSymbolicLink()) throw new Error("evidence symlink rejected");
        if (stat.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name));
        else if (stat.isFile()) { if (stat.nlink !== 1 || stat.size > 32_000_000 || (totalBytes += stat.size) > 64_000_000) throw new Error("evidence byte or hard-link limit exceeded");
          const bytes = readFileSync(path); inventory.push({ path: relative(destination, path), bytes: bytes.length, sha256: sha(bytes) }); }
        else throw new Error("unsupported evidence entry"); };
      try { visit(destination); write("retained-inventory.json", { inventory, sha256: digest(inventory), independentObservation: false }); }
      catch (error) {
        try { write("inventory-failure.json", { failure: predictionFailureEvidence(error), executionReady: false, batchAuthorized: false }); }
        catch (persistence) { throw new AggregateError([...(primary === undefined ? [] : [primary]), error, persistence], "operator and evidence retention failed"); }
        throw new AggregateError([...(primary === undefined ? [] : [primary]), error], "operator evidence retention failed");
      }
    }
  }
}
