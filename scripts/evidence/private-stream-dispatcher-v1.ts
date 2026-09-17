import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { exact, same, sha, text } from "../../eval/prediction-contract.js";
import { acceptedCanaryContract, observeDispatcherSource, verifyDispatcherGate, type DispatcherBinding } from "../../eval/private-stream-dispatcher-contract-v1.js";
import { createSignedObserver } from "../../eval/private-stream-dispatcher-observer-v1.js";
import { createPrivateStreamRuntime, runtimeInputsBinding } from "../../eval/private-stream-dispatcher-runtime-v1.js";
import { createPrivateStreamDispatcher } from "../../eval/private-stream-dispatcher-v1.js";

/** No default configuration, gate trust, execution capability or production
 * routing. The operator must separately pin the reviewed gate's exact bytes. */
export async function privateStreamDispatcherMain(args: readonly string[]) {
  const startedAt = performance.now();
  if (args.length !== 5 || !["--preflight", "--canary"].includes(args[0]!) || args[1] !== "--config" || args[3] !== "--gate-sha256" || !/^[a-f0-9]{64}$/.test(args[4]!)) throw new Error("exact dispatcher arguments required");
  const config = exact(JSON.parse(readFileSync(resolve(args[2]!), "utf8")), ["root", "privateRoot", "stateDirectory", "evidenceDirectory", "freezeFile", "acceptedFreezeFile",
    "gateFile", "binding", "sessionDirectory", "mountsRoot", "registrationFile", "registrationSha256", "manifestFile", "manifestSha256", "observerSocket", "observerPublicKeyFile"], "dispatcher config");
  const path = (key: string) => resolve(text(config[key]));
  const root = path("root"), privateRoot = path("privateRoot"), stateDirectory = path("stateDirectory"), evidenceDirectory = path("evidenceDirectory");
  const binding = config.binding as DispatcherBinding, gate = readFileSync(path("gateFile"));
  verifyDispatcherGate(gate, args[4]!, binding);
  const contract = acceptedCanaryContract(readFileSync(path("acceptedFreezeFile")));
  const authority = { registrationBytes: readFileSync(path("registrationFile"), "utf8"), registrationSha256: text(config.registrationSha256),
    manifestBytes: readFileSync(path("manifestFile"), "utf8"), manifestSha256: text(config.manifestSha256) };
  const input = { root, sessionDirectory: path("sessionDirectory"), mountsRoot: path("mountsRoot"), authority, contract };
  same(runtimeInputsBinding(input), binding.runtimeInputsSha256, "reviewed runtime inputs mismatch");
  const key = readFileSync(path("observerPublicKeyFile"), "utf8");
  same(sha(key), binding.observerKeySha256, "observer public key mismatch");
  const observeBinding = () => {
    observeDispatcherSource(root, binding, stateDirectory);
    const git = (args: string[]) => execFileSync("git", ["--no-replace-objects", ...args], { cwd: privateRoot, encoding: "utf8", maxBuffer: 4_194_304 }).trim();
    same(git(["rev-parse", "HEAD"]), binding.privateCommit, "private evidence commit mismatch");
    same(git(["status", "--porcelain", "--untracked-files=all"]), "", "private evidence source must be clean");
    const bytes = readFileSync(path("freezeFile")); same(sha(bytes), binding.privateFreezeSha256, "private source freeze mismatch");
    const frozen = JSON.parse(bytes.toString());
    same([frozen.publicCommit, frozen.sourceSha256, frozen.executionReady, frozen.providerAuthorized],
      [binding.publicCommit, binding.sourceSha256, false, false], "dispatcher freeze authority mismatch");
    same(readFileSync(join(root, ".nvmrc"), "utf8").trim(), "22", "pinned Node version changed");
    if (!process.version.startsWith("v22.")) throw new Error("Node22 required");
  };
  let receiptSequence = 0;
  const dispatcher = createPrivateStreamDispatcher({ binding, stateDirectory, evidenceDirectory, gate, gateSha256: args[4]!, observeBinding, startedAt,
    runtime: (runId, remainingMs) => createPrivateStreamRuntime(input, runId, binding, value => {
      // Runtime receipts are already typed by the adapter, including failures.
      // This is never a generic provider-output or error-message serializer.
      writeFileSync(join(evidenceDirectory, `runtime-${String(++receiptSequence).padStart(6, "0")}.json`), JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600 });
    }, remainingMs), observer: createSignedObserver(path("observerSocket"), key, binding.observerKeySha256), executionClass: "real" });
  await dispatcher.preflight();
  if (args[0] === "--preflight") {
    await dispatcher.closePreflight();
    try { lstatSync(stateDirectory); throw new Error("preflight created execution state"); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
    return { preflightPassed: true, providerCalls: 0, executionReady: false, capabilityIssued: false };
  }
  try { return await dispatcher.run(dispatcher.issueCapability()); }
  catch { try { await dispatcher.closePreflight(); } catch { /* consumed attempts already own mandatory cleanup */ } throw new Error("private canary dispatch failed"); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  privateStreamDispatcherMain(process.argv.slice(2)).then(result => {
    process.stdout.write(JSON.stringify(result) + "\n");
    if ("status" in result && result.status !== "infrastructure-evidence-complete") process.exitCode = 1;
  }).catch(() => { process.stderr.write("Private-stream dispatcher failed closed; inspect typed evidence.\n"); process.exitCode = 1; });
}
