import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { packageRoot } from "../src/core/paths.js";
import type { ProviderExec } from "../src/types.js";
import { canonicalJson } from "./experiment.js";
import { digest, freeze, same, sha } from "./prediction-contract.js";
import { preparePredictionPreauthorization, type PredictionPreauthorizationAuthority } from "./prediction-preauthorization.js";
import { predictionExecutionSourceManifest } from "./prediction-execution-freeze.js";
import { attachPredictionReadTools, PREDICTION_MCP_LIMITS } from "./prediction-runtime-attachment.js";
import { createStructuralPredictionCliDeadline } from "./prediction-cli-deadline.js";
import { createStructuralMockMethodologyEgressSupervisor, type DockerExec, type MethodologyEgressSupervisor } from "./methodology-egress.js";
import { createContainedProviderExec } from "./runtime-containment.js";
import { PREDICTION_CLI_BRIDGE_POLICY } from "./prediction-cli-policy.js";
import { predictionSafeCanaryCommand, SAFE_CANARY_MCP_URL } from "./prediction-safe-canary-command.js";
import { reduceSafeCanaryStream } from "./prediction-safe-canary-stream.js";
import { privateByteBinding, privateExecutionError, privateFailureBinding, privateResultBinding } from "./prediction-typed-evidence.js";
import { observePrivatePredictionExec } from "./prediction-private-mechanical-evidence.js";
import { preparePredictionSafeCanary, SAFE_CANARY_ID, SAFE_CANARY_PROMPT, type PredictionSafeCanary } from "./prediction-safe-canary.js";

/** Only the existing containment/deadline implementation is exercised. There
 * is deliberately no non-injected overload or provider-class authorization. */
export async function createStructuralSafeCanary(options: { authority: PredictionPreauthorizationAuthority; mountsRoot: string;
  registration: PredictionSafeCanary; directory: string; runId: string; run: DockerExec; wallMs?: number }) {
  if (typeof options.run !== "function" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(options.runId)) throw new Error("explicit structural executor and bounded run identity required");
  options = { ...options, authority: freeze(options.authority), mountsRoot: resolve(options.mountsRoot) };
  if (options.wallMs !== undefined && (!Number.isSafeInteger(options.wallMs) || options.wallMs < 1 || options.wallMs > 1200000)) throw new Error("invalid structural deadline");
  const registration = await preparePredictionSafeCanary(options.authority, options.mountsRoot);
  same(options.registration, registration, "safe canary registration/source tamper");
  const directory = resolve(options.directory), source = registration.source, scopeSha256 = digest({ registrationSha256: registration.sha256, runId: options.runId, directory });
  const binding = { runId: options.runId, attemptId: SAFE_CANARY_ID, scopeSha256, sourceSha256: source.sourceSha256 };
  const capabilities = new WeakSet<object>(); let used = false;
  const write = (name: string, value: unknown) => writeFileSync(join(directory, name), canonicalJson(value) + "\n", { flag: "wx", mode: 0o600 });
  return {
    authorizeSynthetic(attemptId: string) {
      if (used || attemptId !== SAFE_CANARY_ID) throw new Error("only the unused separate synthetic canary is admissible");
      const token = Object.freeze({ kind: "safe-canary-synthetic-only", toJSON(): never { throw new Error("nonserializable one-use authorization"); } });
      capabilities.add(token); return token;
    },
    async run(token: object) {
      if (used || !capabilities.has(token)) throw new Error("one-use scoped synthetic capability required");
      same(predictionExecutionSourceManifest(), source, "stale safe canary source");
      mkdirSync(directory, { mode: 0o700 }); used = true; capabilities.delete(token);
      write("start.json", { kind: "prediction-safe-canary-start-v1", binding, registrationSha256: registration.sha256,
        executionClass: "structural-mock", providerAuthorized: false, providerCalls: 0 });
      let attachment: Awaited<ReturnType<typeof attachPredictionReadTools>> | undefined, egress: MethodologyEgressSupervisor | undefined;
      let setup: Promise<MethodologyEgressSupervisor> | undefined, stream: ReturnType<typeof reduceSafeCanaryStream> | null = null;
      let failure: ReturnType<typeof privateFailureBinding> | null = null;
      let phase: "preparation" | "execution" | "teardown" = "preparation";
      const guard = createStructuralPredictionCliDeadline({ directory: join(directory, "deadline"), attemptId: SAFE_CANARY_ID, closeReads() {}, teardown: async () => {
        phase = "teardown";
        const errors: unknown[] = [];
        await setup?.catch(error => { if (privateFailureBinding(error).cleanupUnproven) errors.push(error); });
        try { await egress?.close(); } catch (error) { errors.push(error); }
        try { await attachment?.close(); } catch (error) { errors.push(error); }
        write("cleanup.json", { kind: "prediction-safe-canary-cleanup-v1", binding,
          sidecarAudit: privateByteBinding(JSON.stringify(egress?.auditDiagnostics ?? null)),
          reader: privateByteBinding(JSON.stringify(attachment?.readerSnapshot() ?? null)),
          readAudit: privateByteBinding(JSON.stringify(attachment?.sealAudit() ?? null)),
          failures: errors.map(privateFailureBinding) });
        if (errors.length) throw new AggregateError([], "private mandatory cleanup failed");
      } }, options.wallMs ?? registration.limits.wallMs);
      try {
        const run = observePrivatePredictionExec(join(directory, "mechanical"), { ...binding, channel: "client" }, {
          run: options.run, policySha256: registration.sha256, phase: () => phase, validate: (_args, result) => { privateResultBinding(result); },
        });
        attachment = await attachPredictionReadTools(options.authority.preparation, options.mountsRoot, registration.sourceAttemptId, guard, { host: "0.0.0.0", allowedHosts: ["host.docker.internal:1"] });
        same(attachment.binding.inputDigest, registration.mountSha256, "safe canary mount mismatch");
        const endpoint = new URL(attachment.url); attachment.replaceAuthorizedHosts([`host.docker.internal:${endpoint.port}`]);
        const p = await preparePredictionPreauthorization(options.authority, options.mountsRoot);
        const first = p.preauthorization.attempts[0]!, mount = p.preauthorization.dryRun.preparation.sourceBindings.find(m => m.caseId === first.caseId)!;
        const { maxSessions: _, ...limits } = PREDICTION_MCP_LIMITS;
        setup = createStructuralMockMethodologyEgressSupervisor({ attemptId: "attempt-000001", armId: first.arm, sourceHeadTree: mount.headTree,
          providerAuthorities: PREDICTION_CLI_BRIDGE_POLICY.providerAuthorities, hostMcpPort: Number(endpoint.port), hostMcpToken: endpoint.pathname.slice(5),
          deadlineSignal: guard.signal, mcpLimits: { ...limits, maxHeaderBytes: 8192 }, fixedClientPath: true, run });
        egress = await setup;
        same(egress.internalMcpUrl, SAFE_CANARY_MCP_URL, "secret endpoint reached client");
        const checkout = join(directory, "workspace"), assets = join(directory, "assets");
        guard.read(() => {
          mkdirSync(checkout, { mode: 0o700 }); mkdirSync(assets, { mode: 0o700 });
          const schema = readFileSync(join(packageRoot(), "schemas/canary-status.schema.json")); same(sha(schema), registration.schemaSha256, "canary schema drift");
          writeFileSync(join(assets, "canary-status.schema.json"), schema, { flag: "wx", mode: 0o600 });
          same(readdirSync(checkout), [], "unexpected workspace companion"); same(readdirSync(assets), ["canary-status.schema.json"], "unexpected asset companion");
        });
        write("invocation.json", { kind: "prediction-safe-canary-invocation-v1", binding, registrationSha256: registration.sha256,
          commandSha256: registration.commandSha256, promptSha256: registration.promptSha256, attachment: attachment.binding,
          privateTopology: egress.privateObservation, runtimeAcceptance: "unavailable-structural-only" });
        const contained = createContainedProviderExec({ runner: "codex", providerAccess: "cli-session", checkoutDir: checkout, assetsDir: assets,
          outputDir: join(directory, "never-mounted-output"), profile: "prediction-safe-canary", image: registration.runtime.acceptedPredecessor.image,
          methodologyEgress: egress.launchCapability, run });
        const args = predictionSafeCanaryCommand().map(v => v === "/workspace" ? checkout : v === "/opt/peregrine/canary-status.schema.json" ? join(assets, "canary-status.schema.json") : v);
        const safeRun: ProviderExec = async (...input) => {
          try {
            const result = await contained(...input), reduced = privateResultBinding(result);
            write("execution.json", { kind: "prediction-safe-canary-execution-v1", binding, result: reduced });
            if (reduced.cleanupFailed) throw new AggregateError([], "private client cleanup unproven");
            if (result.code !== 0 || result.timedOut || reduced.outputLimitExceeded) throw new Error("canary execution did not complete safely");
            stream = reduceSafeCanaryStream(result.stdout);
            write("output.json", { binding, stream });
            return { stdout: "", stderr: "", code: result.code, timedOut: false };
          } catch (error) { failure = privateFailureBinding(error); throw privateExecutionError(error); }
        };
        phase = "execution";
        await guard.run(safeRun, "codex", args, { stdin: SAFE_CANARY_PROMPT, inheritEnv: false, env: {} });
      } catch (error) { failure ??= privateFailureBinding(error); }
      const deadline = await guard.finish();
      const record = freeze({ kind: "prediction-safe-canary-terminal-v1", binding, registrationSha256: registration.sha256,
        status: failure || !stream || !deadline.teardownCompleted || deadline.evidenceError || deadline.deadlineExceeded ? "failed" : "synthetic-completed",
        failure, streamSha256: stream ? digest(stream) : null, deadline, reviewLedgerSha256: registration.reviewLedgerSha256,
        reviewAttemptsStarted: 0, unstartedReviewAttempts: 64, providerCalls: 0, providerAuthorized: false, executionReady: false, batchAuthorized: false,
        eligibility: "not-eligible", observerEvidence: null, runtimeAcceptance: null });
      write("terminal.json", record); return record;
    },
  };
}
