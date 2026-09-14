import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { privateByteBinding, privateCommandBinding, privateFailureBinding } from "../eval/prediction-typed-evidence.js";
import { runProbe as runContainmentProbe } from "./run-eval-runtime-probe.js";
import { runEgressProbe, parseEgressProbeCliArgs, type ProbeRuntime, type ProbeProcessResult } from "./run-eval-egress-probe.js";
import { preparePrivateStreamRuntimePublication } from "./private-stream-runtime-contract.js";

const MAX_BYTES = 4 * 1024 * 1024;
/** No raw argv, environment, stream, error/cause or arbitrary producer fields
 * escape this wrapper. Existing probe validators inspect live bytes in memory. */
export function privateProbeRuntime(runtime: ProbeRuntime, receipts: unknown[]): ProbeRuntime & { cleanupFailed(): boolean } {
  let failedCleanup = false;
  const observer: ProbeRuntime & { cleanupFailed(): boolean } = { cleanupFailed: () => failedCleanup, spawn(command, args) {
    const cleanup = args[0] === "rm" || (args[0] === "network" || args[0] === "image") && args[1] === "rm";
    const environment = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
    const start = { sequence: receipts.length + 1, invocation: privateCommandBinding(command, args, environment), startedAt: Date.now() };
    const settings = { encoding: "utf8", stdio: "pipe", timeout: 120000, maxBuffer: MAX_BYTES, env: environment };
    try {
      const result = runtime.spawn(command, args, settings);
      const stream = (value: ProbeProcessResult["stdout"]) => { if (value !== undefined && value !== null && typeof value !== "string" && !Buffer.isBuffer(value)) throw new Error("invalid probe stream"); return Buffer.from(value ?? ""); };
      const stdout = stream(result.stdout), stderr = stream(result.stderr);
      if (stdout.length + stderr.length > MAX_BYTES || result.status !== null && (!Number.isInteger(result.status) || result.status < 0 || result.status > 255)) throw new Error("invalid bounded probe result");
      receipts.push({ ...start, closedAt: Date.now(), status: result.status, stdout: privateByteBinding(stdout), stderr: privateByteBinding(stderr), failure: result.error ? privateFailureBinding(result.error) : null });
      if (cleanup && (result.error || result.status !== 0)) {
        // The containment probe uses --rm, then defensively removes its exact
        // name. Reconcile that known producer case with a separate absence query.
        const name = args[2] ?? "";
        const missing = (value: ProbeProcessResult) => value.status === 1 && !value.error &&
          [`Error response from daemon: No such container: ${name}`, `Error: No such object: ${name}`].includes(String(value.stderr ?? "").trim());
        const autoRemoved = args.length === 3 && args[0] === "rm" && args[1] === "--force" && /^peregrine-image-smoke-[a-f0-9-]{36}$/.test(name) && missing(result);
        if (!autoRemoved || !missing(observer.spawn("docker", ["container", "inspect", name], settings))) failedCleanup = true;
      }
      // Do not spread extra fields, arbitrary result properties or native errors.
      return { status: result.status, stdout, stderr, ...(result.error ? { error: new Error("probe subprocess failed") } : {}) };
    } catch (error) {
      if (cleanup) failedCleanup = true;
      receipts.push({ ...start, closedAt: Date.now(), failure: privateFailureBinding(error) });
      return { status: null, error: new Error("private probe subprocess failed") };
    }
  } };
  return observer;
}

export function runPrivateStreamRuntimeProbe(options: { image: string; platform?: "linux/amd64" | "linux/arm64" }, runtime: ProbeRuntime = { spawn: (command, args, settings) => spawnSync(command, args, settings) }) {
  parseEgressProbeCliArgs(["--image", options.image, ...(options.platform ? ["--platform", options.platform] : [])]);
  const receipts: unknown[] = [], safe = privateProbeRuntime(runtime, receipts);
  let failure: ReturnType<typeof privateFailureBinding> | null = null;
  let containmentCompleted = false;
  try {
    runContainmentProbe(options.image, options.platform, safe);
    containmentCompleted = true;
    runEgressProbe(options.image, options.platform, safe, undefined, true);
    if (safe.cleanupFailed()) throw new Error("private probe cleanup failed");
  } catch (error) { failure = privateFailureBinding(error); }
  return { kind: "private-stream-runtime-probe-v1", image: options.image, platform: options.platform ?? "native", status: failure ? "FAIL" : "PASS", failure, receipts,
    rawMechanicalStreamsPersisted: false, clientForwarderTokenSupplied: false, fixedEndpoint: "http://mcp-forwarder:8082/mcp",
    providerCalls: 0, providerClientSessions: 0, credentialFreeVersionChecks: containmentCompleted ? { codex: "0.152.0", claude: "2.1.252" } : null,
    runtimeReady: false, executionReady: false, providerAuthorized: false,
    qualification: "Credential-free image/fixture proof, not a provider canary. Metadata-only receipts do not reconstruct omitted raw inspect bytes. Actual CLI/session/catalog and independent acceptance remain required." };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const args = process.argv.slice(2), at = args.indexOf("--revision"), reportAt = args.indexOf("--report");
    if (at < 0 || reportAt !== at + 2 || reportAt + 2 !== args.length) throw new Error("exact private probe arguments required");
    const options = parseEgressProbeCliArgs(args.slice(0, at)), source = preparePrivateStreamRuntimePublication(process.cwd(), args[at + 1]!);
    const report = resolve(args[reportAt + 1]!);
    if (existsSync(report)) throw new Error("prior report must not be overwritten");
    if (options.platform ? !new RegExp(`^${source.imageName.replaceAll(".", "\\.")}@sha256:[a-f0-9]{64}$`).test(options.image) : options.image !== "peregrine-eval-runtime:private-stream-v1-pr") throw new Error("wrong private publication image identity");
    // Reserve before any image operation; never overwrite earlier attempt evidence.
    writeFileSync(report + ".start.json", JSON.stringify({ kind: "private-stream-runtime-probe-start-v1", source, options, providerCalls: 0 }) + "\n", { flag: "wx", mode: 0o600 });
    const result = runPrivateStreamRuntimeProbe(options);
    writeFileSync(report, JSON.stringify({ ...result, sourceFreezeSha256: source.sha256 }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    if (result.status !== "PASS") process.exitCode = 1;
  } catch { process.stderr.write("Private-stream runtime probe failed; no runtime authorized.\n"); process.exitCode = 1; }
}
