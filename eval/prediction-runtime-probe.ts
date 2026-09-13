import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { exec, type ExecResult } from "../src/util/exec.js";
import { safeDiagnostic } from "../src/security/secrets.js";
import { canonicalJson } from "./experiment.js";
import { digest, freeze, sha } from "./prediction-contract.js";
import { bindPredictionRegistration } from "./prediction-plan.js";
import { bindPredictionMounts } from "./prediction-mounts.js";
import { createStructuralPredictionCliDeadline, predictionFailureEvidence } from "./prediction-cli-deadline.js";
import { attachPredictionReadTools, PREDICTION_MCP_LIMITS, type PredictionRuntimeAuthority } from "./prediction-runtime-attachment.js";
import { ACCEPTED_METHODOLOGY_EGRESS_IMAGE, ZERO_PROVIDER_FORWARDER_CANDIDATE_IMAGE, createMethodologyEgressSupervisor, createZeroProviderCandidateEgressSupervisor } from "./methodology-egress.js";

/** Fixed credential-free Node probe, never a configurable provider dispatcher.
 * The accepted image must already be local. Pull/authentication is an external
 * explicitly authorized preparation step, never an automatic fallback. */
export async function runPredictionRuntimeProbe(directory: string, authority: PredictionRuntimeAuthority, mountsRoot: string, attemptId: string, candidate = false) {
  if (typeof candidate !== "boolean") throw new Error("invalid zero-provider candidate selection");
  const runtimeImage = candidate ? ZERO_PROVIDER_FORWARDER_CANDIDATE_IMAGE : ACCEPTED_METHODOLOGY_EGRESS_IMAGE;
  mkdirSync(directory, { mode: 0o700 });
  const write = (name: string, value: unknown) => writeFileSync(join(directory, name), canonicalJson(value) + "\n", { flag: "wx", mode: 0o600 });
  write("start.json", { kind: "zero-provider-runtime-boundary-probe", attemptId, image: runtimeImage, candidate, providerCalls: 0 });
  const docker = (args: string[]) => exec("docker", args, { inheritEnv: false, env: { PATH: process.env.PATH ?? "" }, timeoutMs: 15_000 });
  let attachment: Awaited<ReturnType<typeof attachPredictionReadTools>> | undefined;
  let egress: Awaited<ReturnType<typeof createZeroProviderCandidateEgressSupervisor>> | undefined;
  let setup: ReturnType<typeof createZeroProviderCandidateEgressSupervisor> | undefined, running: Promise<ExecResult> | undefined;
  const containerName = `peregrine-prediction-probe-${randomUUID()}`, output = join(directory, "client-output");
  let clientStarted = false;
  const cleanupEvidence: { resource: string; result: ExecResult }[] = [];
  const guard = createStructuralPredictionCliDeadline({ directory: join(directory, "deadline"), attemptId: "zero-provider-runtime-probe",
    closeReads() {}, teardown: async () => {
      const failures: unknown[] = [];
      await setup?.catch(error => { if (predictionFailureEvidence(error).cleanupUnproven) failures.push(error); });
      if (clientStarted) {
        const removed = await docker(["rm", "--force", containerName]); cleanupEvidence.push({ resource: "client-remove", result: removed });
        const absent = await docker(["ps", "--all", "--quiet", "--filter", `name=^/${containerName}$`]); cleanupEvidence.push({ resource: "client-absence", result: absent });
        if (removed.code !== 0 || removed.timedOut || absent.code !== 0 || absent.timedOut || absent.stdout.trim()) failures.push(new Error("zero-provider client removal/absence unproven"));
      }
      try { await egress?.close(); } catch (error) { failures.push(error); }
      try { await attachment?.close(); } catch (error) { failures.push(error); }
      if (egress) {
        for (const name of [egress.names.gateway, egress.names.forwarder]) {
          const result = await docker(["ps", "--all", "--quiet", "--filter", `name=^/${name}$`]); cleanupEvidence.push({ resource: name, result });
          if (result.code !== 0 || result.timedOut || result.stdout.trim()) failures.push(new Error("sidecar absence unproven"));
        }
        for (const name of [egress.names.network, egress.names.externalNetwork]) {
          const result = await docker(["network", "ls", "--quiet", "--filter", `name=^${name}$`]); cleanupEvidence.push({ resource: name, result });
          if (result.code !== 0 || result.timedOut || result.stdout.trim()) failures.push(new Error("network absence unproven"));
        }
      }
      write("cleanup.json", cleanupEvidence);
      if (failures.length) throw new AggregateError(failures, "zero-provider runtime cleanup failed");
    } }, 20_000);
  try {
    const image = await docker(["image", "inspect", runtimeImage]); write("image-inspect.json", image);
    if (image.code !== 0 || image.timedOut) throw new Error("pinned image unavailable; no automatic pull");
    const registration = guard.read(() => bindPredictionRegistration(authority.registrationBytes, authority.registrationSha256));
    const mounts = guard.read(() => bindPredictionMounts(authority.manifestBytes, authority.manifestSha256, registration));
    const scheduled = registration.schedule.find(attempt => attempt.id === attemptId);
    if (!scheduled) throw new Error("unregistered runtime probe source");
    const mount = mounts.find(mount => mount.caseId === scheduled.caseId)!;
    attachment = await attachPredictionReadTools(authority, mountsRoot, attemptId, guard, { host: "0.0.0.0", allowedHosts: ["host.docker.internal:1"] });
    const endpoint = new URL(attachment.url);
    attachment.replaceAuthorizedHosts([`host.docker.internal:${endpoint.port}`]);
    const { maxSessions: _, ...limits } = PREDICTION_MCP_LIMITS;
    setup = (candidate ? createZeroProviderCandidateEgressSupervisor : createMethodologyEgressSupervisor)({ attemptId: "attempt-000001", armId: scheduled.arm, sourceHeadTree: mount.headTree,
      providerAuthorities: ["zero-provider.invalid:443"], hostMcpPort: Number(endpoint.port), hostMcpToken: endpoint.pathname.slice("/mcp/".length),
      deadlineSignal: guard.signal, mcpLimits: { ...limits, maxHeaderBytes: 8192 }, stopTimeoutMs: 5000 });
    egress = await setup; guard.read(() => undefined);
    write("attachment.json", { binding: attachment.binding, egress: egress.attestation, endpointPathMatches: new URL(egress.internalMcpUrl).pathname === endpoint.pathname });
    mkdirSync(output, { mode: 0o700 });
    const clientPath = fileURLToPath(new URL("./prediction-runtime-client.mjs", import.meta.url));
    const uid = process.getuid!(), gid = process.getgid!();
    const args = ["run", "--name", containerName, "--pull", "never", "--network", egress.network, "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--pids-limit", "32", "--user", `${uid}:${gid}`, "--tmpfs", `/tmp:rw,noexec,nosuid,nodev,size=16m,uid=${uid},gid=${gid},mode=1777`,
      "--tmpfs", `/home/peregrine:rw,noexec,nosuid,nodev,size=16m,uid=${uid},gid=${gid},mode=0700`,
      "--mount", `type=bind,source=${clientPath},target=/probe/client.mjs,readonly`, "--mount", `type=bind,source=${output},target=/output`,
      "--entrypoint", "node", runtimeImage, "/probe/client.mjs", egress.internalMcpUrl,
      mount.allowedFiles.find(entry => entry.mode === "120000")?.path ?? "unavailable-native-link"];
    write("client-launch.json", { args, credentialMounts: 0, providerCommands: 0, clientScriptSha256: sha(readFileSync(clientPath)) });
    clientStarted = true;
    running = guard.run(exec, "docker", args, { inheritEnv: false, env: { PATH: process.env.PATH ?? "" } });
    while (!existsSync(join(output, "ready.json")) && !guard.signal.aborted) await new Promise(resolve => setTimeout(resolve, 50));
    if (existsSync(join(output, "ready.json"))) {
      write("client-running.json", await docker(["top", containerName, "-eo", "pid,ppid,args"]));
    }
    const execution = await running; write("execution.json", execution);
    const terminal = await guard.finish();
    if (!existsSync(join(output, "ready.json")) || !execution.timedOut || !terminal.deadlineExceeded || !terminal.teardownCompleted) throw new Error("zero-provider reader/deadline/cleanup proof incomplete");
    const client = JSON.parse(readFileSync(join(output, "ready.json"), "utf8"));
    const body = { kind: "prediction-runtime-boundary-probe-v1", image: runtimeImage, candidate, client, binding: attachment.binding,
      deadline: terminal, mcpAudit: attachment.sealAudit(), reader: attachment.readerSnapshot(), cleanupEvidence, sidecarAudit: egress.auditDiagnostics,
      providerCalls: 0, reviewAttemptsStarted: 0, executionReady: false, providerAuthorized: false,
      qualification: "Actual credential-free Node client and sidecar/container cleanup only; not a Codex agent, served model, or provider experiment." };
    const result = freeze({ ...body, sha256: digest(body) }); write("result.json", result); return result;
  } catch (error) {
    await running?.catch(() => undefined);
    let finishError: unknown; try { await guard.finish(); } catch (failure) { finishError = failure; }
    write("failure.json", { error: predictionFailureEvidence(error), finishError: finishError ? safeDiagnostic(String(finishError)) : null, providerCalls: 0 });
    throw error;
  }
}
