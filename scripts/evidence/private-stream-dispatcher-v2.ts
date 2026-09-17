import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { exact, same, sha, text } from "../../eval/prediction-contract.js";
import { acceptedCanaryContract } from "../../eval/private-stream-dispatcher-contract-v1.js";
import { createPrivateStreamRuntime, runtimeInputsBinding } from "../../eval/private-stream-dispatcher-runtime-v1.js";
import { consumeDispatcherLaunchPermissionV2, createPrivateStreamDispatcherV2, privateStreamDispatcherV2Source,
  reduceObservableCanaryStreamV2, verifyDispatcherGateV2, type DispatcherBindingV2 } from "../../eval/private-stream-dispatcher-v2.js";

/** Exact operator entrypoint for one observable infrastructure canary. It has
 * no batch, review or production mode and accepts no asserted model identity,
 * provider-call count, catalog or monetary cost from configuration. */
export async function privateStreamDispatcherMainV2(args: readonly string[]) {
  const startedAt = performance.now();
  if (args.length !== 5 || !["--preflight", "--canary"].includes(args[0]!) || args[1] !== "--config" || args[3] !== "--gate-sha256" || !/^[a-f0-9]{64}$/.test(args[4]!)) throw new Error("exact V2 dispatcher arguments required");
  const config = exact(JSON.parse(readFileSync(resolve(args[2]!), "utf8")), ["root", "privateRoot", "stateDirectory", "evidenceDirectory",
    "freezeFile", "acceptedFreezeFile", "gateFile", "binding", "sessionDirectory", "mountsRoot", "registrationFile", "registrationSha256",
    "manifestFile", "manifestSha256"], "V2 dispatcher config");
  const path = (key: string) => resolve(text(config[key]));
  const root = path("root"), privateRoot = path("privateRoot"), stateDirectory = path("stateDirectory"), evidenceDirectory = path("evidenceDirectory");
  const binding = config.binding as unknown as DispatcherBindingV2, gate = readFileSync(path("gateFile"));
  verifyDispatcherGateV2(gate, args[4]!, binding);
  const contract = acceptedCanaryContract(readFileSync(path("acceptedFreezeFile")));
  const authority = { registrationBytes: readFileSync(path("registrationFile"), "utf8"), registrationSha256: text(config.registrationSha256),
    manifestBytes: readFileSync(path("manifestFile"), "utf8"), manifestSha256: text(config.manifestSha256) };
  const input = { root, sessionDirectory: path("sessionDirectory"), mountsRoot: path("mountsRoot"), authority, contract };
  same(runtimeInputsBinding(input), binding.runtimeInputsSha256, "reviewed V2 runtime inputs mismatch");
  const git = (directory: string, values: string[]) => execFileSync("git", ["--no-replace-objects", ...values], { cwd: directory, encoding: "utf8", maxBuffer: 4_194_304 }).trim();
  const observeBinding = () => {
    same([git(root, ["rev-parse", "HEAD"]), git(privateRoot, ["rev-parse", "HEAD"])], [binding.publicCommit, binding.privateCommit], "exact V2 source commits required");
    same([git(root, ["status", "--porcelain", "--untracked-files=all"]), git(privateRoot, ["status", "--porcelain", "--untracked-files=all"])], ["", ""], "clean V2 sources required");
    same(privateStreamDispatcherV2Source(root).sha256, binding.sourceSha256, "V2 source drift");
    same(sha(resolve(stateDirectory)), binding.stateDirectorySha256, "V2 durable state location mismatch");
    const frozen = readFileSync(path("freezeFile")); same(sha(frozen), binding.privateFreezeSha256, "V2 private freeze mismatch");
    const record = JSON.parse(frozen.toString());
    same([record.kind, record.publicCommit, record.sourceSha256, record.executionReady, record.providerAuthorized],
      ["private-stream-dispatcher-freeze-v2", binding.publicCommit, binding.sourceSha256, false, false], "wrong V2 freeze or authority");
    same(readFileSync(join(root, ".nvmrc"), "utf8").trim(), "22", "pinned Node version changed");
    if (!process.version.startsWith("v22.")) throw new Error("Node22 required");
  };
  let receiptSequence = 0;
  const dispatcher = createPrivateStreamDispatcherV2({ binding, stateDirectory, evidenceDirectory, gate, gateSha256: args[4]!, observeBinding, startedAt,
    runtime: (runId, remainingMs) => createPrivateStreamRuntime(input, runId, binding, value => {
      const bytes = JSON.stringify(value) + "\n"; if (Buffer.byteLength(bytes) > 65_536) throw new Error("bounded runtime receipt required");
      writeFileSync(join(evidenceDirectory, `runtime-${String(++receiptSequence).padStart(6, "0")}.json`), bytes, { flag: "wx", mode: 0o600 });
    }, remainingMs, undefined, { executionClass: "real", consumePermission: consumeDispatcherLaunchPermissionV2, reduceStream: reduceObservableCanaryStreamV2 }),
    executionClass: "real" });
  await dispatcher.preflight();
  if (args[0] === "--preflight") {
    await dispatcher.closePreflight();
    return { preflightPassed: true, requestedRoute: { model: "gpt-5.6-sol", effort: "low" }, providerRequestCount: null,
      executionReady: false, capabilityIssued: false };
  }
  let capability: object;
  try { capability = dispatcher.issueCapability(); }
  catch (error) { try { await dispatcher.closePreflight(); } catch { /* original fail-closed error is authoritative */ } throw error; }
  return dispatcher.run(capability);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  privateStreamDispatcherMainV2(process.argv.slice(2)).then(result => {
    process.stdout.write(JSON.stringify(result) + "\n");
    if ("status" in result && result.status !== "infrastructure-canary-complete") process.exitCode = 1;
  }).catch(() => { process.stderr.write("Observable infrastructure canary failed closed; inspect typed evidence.\n"); process.exitCode = 1; });
}
