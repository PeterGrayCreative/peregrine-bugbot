import { randomBytes, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { exec, type ExecResult } from "../src/util/exec.js";
import { digest, exact, freeze, same, sha } from "./prediction-contract.js";
import { PRIVATE_STREAM_CANARY_IMAGE, PRIVATE_STREAM_CANARY_POLICY, type PrivateStreamCanaryContract } from "./private-stream-canary-contract.js";
import { renderContainedProviderArgs } from "./runtime-containment.js";
import { attachPredictionReadTools, PREDICTION_MCP_LIMITS, type PredictionRuntimeAuthority } from "./prediction-runtime-attachment.js";
import { SAFE_CANARY_PROMPT } from "./prediction-safe-canary.js";
import { predictionSafeCanaryCommand } from "./prediction-safe-canary-command.js";
import { reduceSafeCanaryStream } from "./prediction-safe-canary-stream.js";
import { privateCommandBinding, privateResultBinding } from "./prediction-typed-evidence.js";
import { PREDICTION_CLI_BRIDGE_POLICY } from "./prediction-cli-policy.js";
import { GATEWAY_ENTRYPOINT, FORWARDER_ENTRYPOINT, renderMethodologySidecarArgs, methodologyGatewayEnvironment,
  methodologyForwarderEnvironment, parseMethodologyEgressNetworkCreateArgs, parseMethodologyEgressExternalNetworkCreateArgs,
  parseMethodologyEgressSidecarRunArgs, parseMethodologyEgressNetworkConnectArgs,
  parseMethodologyEgressContainerInspect, parseMethodologyEgressNetworkInspect } from "./methodology-egress.js";
import { consumeDispatcherLaunchPermission, type DispatcherRuntime, type SessionObservation } from "./private-stream-dispatcher-v1.js";
import { ACCEPTED_IMAGE_CONFIGS, type DispatcherBinding } from "./private-stream-dispatcher-contract-v1.js";
import { parseObservationRecords } from "./methodology-observation.js";
import { validateSidecarHostInspect } from "./methodology-inspect-policy.js";
import { METHODOLOGY_EGRESS_RUNTIME_IMAGE, METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE } from "./methodology-runtime-image.js";

export interface RuntimeInputs {
  root: string; sessionDirectory: string; mountsRoot: string; authority: PredictionRuntimeAuthority;
  contract: PrivateStreamCanaryContract;
}
export function runtimeInputsBinding(input: RuntimeInputs) {
  return digest({ root: resolve(input.root), sessionDirectory: resolve(input.sessionDirectory), mountsRoot: resolve(input.mountsRoot),
    authority: input.authority, contractSha256: input.contract.sha256 });
}
export function observeSessionMetadata(directory: string): SessionObservation {
  if (!isAbsolute(directory) || /[,\r\n\0]/.test(directory) || realpathSync(directory) !== directory) throw new Error("canonical private session path required");
  const dir = lstatSync(directory), auth = lstatSync(join(directory, "auth.json"));
  if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid?.() || (dir.mode & 0o077) !== 0 ||
    !auth.isFile() || auth.isSymbolicLink() || auth.nlink !== 1 || auth.uid !== dir.uid || (auth.mode & 0o077) !== 0 || auth.size === 0) throw new Error("isolated private session metadata invalid");
  same(readdirSync(directory), ["auth.json"], "session must contain only auth.json");
  // No read/open/hash of auth.json. This binding detects metadata replacement;
  // authenticated status is established separately by the pinned CLI.
  return { sessionIdentitySha256: digest({ directory: sha(directory), dev: auth.dev, ino: auth.ino, size: auth.size,
    mtimeMs: auth.mtimeMs, ctimeMs: auth.ctimeMs, mode: auth.mode, uid: auth.uid }), cliVersion: "0.152.0", authenticated: false };
}
function successful(result: ExecResult) {
  if (result.code !== 0 || result.timedOut || result.outputLimitExceeded || result.cleanupErrors?.length) throw new Error("private runtime command failed");
  return result;
}
function parseSingle(bytes: string): Record<string, any> {
  const values = parseObservationRecords(bytes);
  if (!Array.isArray(values) || values.length !== 1 || !values[0] || typeof values[0] !== "object") throw new Error("one complete inspect record required");
  return values[0];
}
/** Authenticate the new immutable image fields first, then reuse the reviewed
 * strict topology/schema validator on a structural identity projection. This
 * projection is not a receipt and never claims the predecessor image ran. */
export function verifyPrivateStreamSidecarInspect(bytes: string,
  expected: Parameters<typeof parseMethodologyEgressContainerInspect>[1], imageId: string) {
  const raw = parseSingle(bytes);
  same([expected.image, raw.Image, raw.Config.Image, raw.Config.Labels?.["org.opencontainers.image.revision"]],
    [PRIVATE_STREAM_CANARY_IMAGE.image, imageId, PRIVATE_STREAM_CANARY_IMAGE.image, PRIVATE_STREAM_CANARY_IMAGE.sourceCommit], "private sidecar image binding mismatch");
  if (!Object.values(ACCEPTED_IMAGE_CONFIGS).includes(imageId)) throw new Error("unaccepted image config");
  const projected = structuredClone(raw);
  if (raw.ImageManifestDescriptor !== undefined) {
    const descriptor = exact(raw.ImageManifestDescriptor, ["mediaType", "digest", "size", "platform"], "private image descriptor");
    const platform = exact(descriptor.platform, ["architecture", "os"], "private platform");
    const architecture = platform.architecture as "amd64" | "arm64";
    same([platform.os, descriptor.mediaType, descriptor.size, descriptor.digest, imageId],
      ["linux", "application/vnd.oci.image.manifest.v1+json", 2951,
        PRIVATE_STREAM_CANARY_IMAGE.platforms[`linux/${architecture}`], ACCEPTED_IMAGE_CONFIGS[architecture]], "private manifest mismatch");
    projected.ImageManifestDescriptor.digest = METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE.platforms[`linux/${architecture}`];
  }
  projected.Image = METHODOLOGY_EGRESS_RUNTIME_IMAGE.split("@")[1]; projected.Config.Image = METHODOLOGY_EGRESS_RUNTIME_IMAGE;
  projected.Config.Labels["org.opencontainers.image.revision"] = METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE.sourceCommit;
  return parseMethodologyEgressContainerInspect(JSON.stringify(projected), { ...expected, image: METHODOLOGY_EGRESS_RUNTIME_IMAGE });
}
export function verifyClientInspect(bytes: string, expected: { name: string; image: string; imageId: string; network: string;
  checkout: string; assets: string; auth: string; uid: number; gid: number; imageEnvironment: string[]; args: string[] }) {
  const v = parseSingle(bytes), h = v.HostConfig, c = v.Config;
  same([v.Name, v.Image, c.Image, c.Cmd, c.User, c.WorkingDir, c.Entrypoint, v.State.Status, v.State.Running],
    ["/" + expected.name, expected.imageId, expected.image, expected.args, `${expected.uid}:${expected.gid}`, "/workspace", ["codex"], "created", false], "client identity/command mismatch");
  same([h.ReadonlyRootfs, h.CapDrop, h.CapAdd, h.Privileged, h.SecurityOpt, h.PidsLimit, h.NetworkMode,
    h.PidMode, h.IpcMode, h.Binds, h.Devices, h.DeviceRequests, h.VolumesFrom, h.PortBindings, h.LogConfig.Type],
    [true, ["ALL"], null, false, ["no-new-privileges"], 256, expected.network, "", "private", null, [], null, null, {}, "none"], "client containment mismatch");
  same(c.Env, [...expected.imageEnvironment, "HTTPS_PROXY=http://egress-gateway:8081", "NO_PROXY=mcp-forwarder:8082"], "client environment mismatch");
  same(Object.keys(v.NetworkSettings.Networks), [expected.network], "client network exposure mismatch");
  const mounts = v.Mounts.filter((m: any) => m.Type !== "tmpfs").map((m: any) => ({ type: m.Type, source: m.Source, destination: m.Destination, rw: m.RW, propagation: m.Propagation }));
  same(mounts.sort((a: any, b: any) => a.destination.localeCompare(b.destination)), [
    { type: "bind", source: expected.auth, destination: "/home/peregrine/.codex/auth.json", rw: false, propagation: "rprivate" },
    { type: "bind", source: expected.assets, destination: "/opt/peregrine", rw: false, propagation: "rprivate" },
    { type: "bind", source: expected.checkout, destination: "/workspace", rw: false, propagation: "rprivate" },
  ], "client mount exposure mismatch");
  same(h.Tmpfs, { "/tmp": `rw,noexec,nosuid,nodev,size=64m,uid=${expected.uid},gid=${expected.gid}`,
    "/home/peregrine": `rw,noexec,nosuid,nodev,size=128m,uid=${expected.uid},gid=${expected.gid}`,
    "/home/peregrine/.codex": `rw,noexec,nosuid,nodev,size=128m,uid=${expected.uid},gid=${expected.gid},mode=0700` }, "isolated ephemeral session mismatch");
  same(h.Mounts, [[expected.checkout, "/workspace"], [expected.assets, "/opt/peregrine"], [expected.auth, "/home/peregrine/.codex/auth.json"]]
    .map(([Source, Target]) => ({ Type: "bind", Source, Target, ReadOnly: true })), "client host mount policy mismatch");
  // All remaining HostConfig fields retain the reviewed deny-by-default shape.
  const host = { ...h }; delete host.Mounts;
  host.LogConfig = { Type: "json-file", Config: {} }; host.PidsLimit = 64;
  host.Tmpfs = { "/home/peregrine": "rw,noexec,nosuid,nodev,size=16m,uid=65532,gid=65532,mode=0700",
    "/tmp": "rw,noexec,nosuid,nodev,size=32m,uid=65532,gid=65532,mode=1777" };
  same(h.LogConfig, { Type: "none", Config: {} }, "client log policy mismatch");
  validateSidecarHostInspect(host, expected.network);
}

/** Real adapter; constructing it does not run commands. The injected seam is
 * used only by deterministic tests. All durable receipts contain bounded typed
 * fields and one-way bindings, never inspect/log/CLI/credential bytes. */
export interface PrivateStreamRuntimeHooks<Binding extends object> {
  /** A successor dispatcher may provide its own process-local permission
   * consumer without weakening the immutable V1 default. */
  consumePermission(permission: object, runId: string, binding: Binding, executionClass: "real" | "synthetic"): void;
  /** A versioned successor may accept additional bounded CLI counters while
   * preserving the V1 reducer as the default. */
  reduceStream(stdout: string): ReturnType<typeof reduceSafeCanaryStream>;
  executionClass?: "real" | "synthetic";
}
export function createPrivateStreamRuntime<Binding extends object = DispatcherBinding>(input: RuntimeInputs, runId: string, binding: Binding,
  receipt: (value: unknown) => void, remainingMs: () => number, run: typeof exec = exec, hooks?: PrivateStreamRuntimeHooks<Binding>): DispatcherRuntime {
  input = { ...input, authority: freeze(input.authority), contract: freeze(input.contract) };
  const image = PRIVATE_STREAM_CANARY_IMAGE.image;
  same(input.contract.image.image, image, "private-stream accepted image required");
  const uid = process.getuid?.(), gid = process.getgid?.();
  if (!Number.isSafeInteger(uid) || uid! <= 0 || !Number.isSafeInteger(gid) || gid! < 0) throw new Error("nonroot host identity required");
  if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error("dispatcher run identity required");
  const identity = { uid: uid!, gid: gid! }, suffix = runId;
  const names = { external: `peregrine-egress-x-${suffix}`, internal: `peregrine-egress-${suffix}`,
    gateway: `peregrine-egress-gateway-000001-${suffix}`, forwarder: `peregrine-egress-forwarder-000001-${suffix}`,
    client: `peregrine-eval-${runId}` };
  const byte = randomBytes(1)[0]!, subnet = `10.254.${byte}.0/28`, externalSubnet = `10.254.${(byte + 1) % 256}.0/28`;
  const containers = new Set<string>(), networks = new Set<string>();
  let scratch: string | undefined, attachment: Awaited<ReturnType<typeof attachPredictionReadTools>> | undefined;
  let closing = false, launched = false, receiptFailed = false, session: SessionObservation | undefined, imageId = "", imageEnvironment: string[] = [];
  let readerClose: Promise<void> | undefined; const nativeLinks = new Set<string>();
  async function docker(args: string[], signal?: AbortSignal, stdin?: string) {
    if (signal?.aborted) throw new Error("runtime deadline expired");
    const invocation = privateCommandBinding("docker", args, { PATH: process.env.PATH ?? "" });
    const result = await run("docker", args, { inheritEnv: false, env: { PATH: process.env.PATH ?? "" },
      timeoutMs: signal ? remainingMs() : 15_000, deadlineSignal: signal,
      maximumOutputBytes: PRIVATE_STREAM_CANARY_POLICY.streamBytes, stdin });
    // A failed evidence write cannot prevent mandatory teardown.
    try { receipt({ invocation, result: privateResultBinding(result), teardown: !signal }); }
    catch { receiptFailed = true; if (signal) throw new Error("runtime evidence persistence failed"); }
    return result;
  }
  async function removeContainer(name: string) {
    await docker(["rm", "--force", name]);
    const result = successful(await docker(["ps", "--all", "--quiet", "--filter", `name=^/${name}$`]));
    if (result.stdout.trim()) throw new Error("container absence unproven");
  }
  async function metadata(command: string[], signal: AbortSignal) {
    const name = `peregrine-eval-${randomUUID()}`; containers.add(name);
    const args = renderContainedProviderArgs({ runner: "codex", profile: "prediction-safe-canary", image,
      containerName: name, identity, checkoutDir: join(scratch!, "workspace"), assetsDir: join(scratch!, "assets"),
      outputDir: "unused", access: ["--mount", `type=bind,source=${input.sessionDirectory}/auth.json,target=/home/peregrine/.codex/auth.json,readonly`],
      command: "codex", commandArgs: command });
    args.splice(1, 0, "--log-driver", "none"); args[args.indexOf("--network") + 1] = "none";
    args.splice(args.indexOf(image), 0, "--entrypoint", "codex"); args.splice(args.indexOf(image) + 1, 1);
    try { return successful(await docker(args, signal)); }
    finally { await removeContainer(name); containers.delete(name); }
  }
  return {
    async session(signal) {
      session = observeSessionMetadata(input.sessionDirectory);
      scratch = realpathSync(mkdtempSync(join(tmpdir(), "peregrine-private-dispatcher-")));
      mkdirSync(join(scratch, "workspace"), { mode: 0o700 }); mkdirSync(join(scratch, "assets"), { mode: 0o700 });
      const schema = readFileSync(join(input.root, "schemas/canary-status.schema.json"));
      same(sha(schema), input.contract.scope.schemaSha256, "canary schema mismatch");
      writeFileSync(join(scratch, "assets/canary-status.schema.json"), schema, { flag: "wx", mode: 0o400 });
      const inspected = parseSingle(successful(await docker(["image", "inspect", image], signal)).stdout);
      if (!Array.isArray(inspected.RepoDigests) || !inspected.RepoDigests.includes(image) || inspected.Os !== "linux" ||
        !["amd64", "arm64"].includes(inspected.Architecture) || !/^sha256:[a-f0-9]{64}$/.test(inspected.Id)) throw new Error("accepted local image unavailable");
      same(inspected.Config.Labels?.["org.opencontainers.image.revision"], PRIVATE_STREAM_CANARY_IMAGE.sourceCommit, "image source label mismatch");
      same(inspected.Id, ACCEPTED_IMAGE_CONFIGS[inspected.Architecture as keyof typeof ACCEPTED_IMAGE_CONFIGS], "accepted platform config mismatch");
      if (!Array.isArray(inspected.Config.Env) || inspected.Config.Env.some((v: unknown) => typeof v !== "string" || /(?:TOKEN|KEY|SECRET|PASSWORD|PROXY)=/i.test(v))) throw new Error("unexpected image environment");
      imageId = inspected.Id; imageEnvironment = inspected.Config.Env;
      const version = await metadata(["--version"], signal);
      same([version.stdout.trim(), version.stderr.trim()], ["codex-cli 0.152.0", ""], "pinned Codex version mismatch");
      const login = await metadata(["login", "status"], signal);
      if (![login.stdout.trim(), login.stderr.trim()].includes("Logged in using ChatGPT") ||
        [login.stdout.trim(), login.stderr.trim()].some(v => v !== "" && v !== "Logged in using ChatGPT")) throw new Error("authenticated ChatGPT session required");
      same(observeSessionMetadata(input.sessionDirectory), session, "session changed during preflight");
      return { ...session, authenticated: true };
    },
    async prepare(signal, read) {
      if (!session || !scratch || closing) throw new Error("session preflight required");
      attachment = await attachPredictionReadTools(input.authority, input.mountsRoot, input.contract.scope.sourceAttemptId,
        { signal, read }, { host: "0.0.0.0", allowedHosts: ["host.docker.internal:1"] });
      same(attachment.binding.inputDigest, input.contract.scope.mountSha256, "exact canary mount mismatch");
      same(attachment.definitions, PRIVATE_STREAM_CANARY_POLICY.catalog.tools, "MCP catalog mismatch");
      // attachPredictionReadTools authenticated and verified these manifest
      // bytes. Native links are intentionally excluded from ordinary reads;
      // their explicit bounded limitation is not a transport failure.
      const mounted = JSON.parse(input.authority.manifestBytes).cases.find((item: { inputDigest: string }) => item.inputDigest === input.contract.scope.mountSha256);
      for (const entry of mounted.allowedFiles) if (entry.mode === "120000") nativeLinks.add(entry.path);
      const endpoint = new URL(attachment.url); attachment.replaceAuthorizedHosts([`host.docker.internal:${endpoint.port}`]);
      for (const [name, internal, block] of [[names.external, false, externalSubnet], [names.internal, true, subnet]] as const) {
        read(() => undefined);
        const args = ["network", "create", ...(internal ? ["--internal"] : []), "--ipv6=false", "--driver", "bridge", "--subnet", block, name];
        (internal ? parseMethodologyEgressNetworkCreateArgs : parseMethodologyEgressExternalNetworkCreateArgs)(args);
        networks.add(name); successful(await docker(args, signal));
      }
      const { maxSessions: _, ...limits } = PREDICTION_MCP_LIMITS;
      const gatewayEnv = methodologyGatewayEnvironment(PREDICTION_CLI_BRIDGE_POLICY.providerAuthorities);
      const forwarderEnv = methodologyForwarderEnvironment(endpoint.pathname.slice(5), Number(endpoint.port), { ...limits, maxHeaderBytes: 8192 }, true);
      const helpers = [["gateway", names.gateway, GATEWAY_ENTRYPOINT, "egress-gateway", gatewayEnv],
        ["forwarder", names.forwarder, FORWARDER_ENTRYPOINT, "mcp-forwarder", forwarderEnv]] as const;
      for (const [role, name, entrypoint, alias, env] of helpers) {
        read(() => undefined);
        const addHost = role === "forwarder" ? "host.docker.internal:host-gateway" : undefined;
        const args = renderMethodologySidecarArgs(name, names.external, image, entrypoint, env, addHost);
        parseMethodologyEgressSidecarRunArgs(args, { name, network: names.external, image, entrypoint, role, ...(role === "forwarder" ? { fixedClientPath: true as const } : {}) });
        containers.add(name); successful(await docker(args, signal));
        const connect = ["network", "connect", "--alias", alias, names.internal, name];
        parseMethodologyEgressNetworkConnectArgs(connect, { network: names.internal, container: name, alias }); successful(await docker(connect, signal));
      }
      for (const [role, name, entrypoint, alias, env] of helpers) {
        const addHost = role === "forwarder" ? "host.docker.internal:host-gateway" : undefined;
        verifyPrivateStreamSidecarInspect(successful(await docker(["inspect", name], signal)).stdout,
          { name, network: names.internal, externalNetwork: names.external, subnet, externalSubnet, image, entrypoint, alias, env, ...(addHost ? { addHost } : {}) }, imageId);
      }
      for (const [name, internal, block] of [[names.internal, true, subnet], [names.external, false, externalSubnet]] as const) {
        parseMethodologyEgressNetworkInspect(successful(await docker(["network", "inspect", name], signal)).stdout,
          { name, network: name, subnet: block, sidecars: [names.gateway, names.forwarder], internal });
      }
    },
    async launch(signal, permission) {
      const executionClass = hooks?.executionClass ?? (run === exec ? "real" : "synthetic");
      if (hooks) hooks.consumePermission(permission, runId, binding, executionClass);
      else consumeDispatcherLaunchPermission(permission, runId, binding as unknown as DispatcherBinding, executionClass);
      if (!attachment || !session || !scratch || launched || closing) throw new Error("single prepared launch required");
      launched = true;
      same(observeSessionMetadata(input.sessionDirectory), session, "session changed before launch");
      same(readdirSync(join(scratch, "workspace")), [], "workspace must remain empty");
      same(readdirSync(join(scratch, "assets")), ["canary-status.schema.json"], "schema-only assets required");
      const command = predictionSafeCanaryCommand();
      const args = renderContainedProviderArgs({ runner: "codex", profile: "prediction-safe-canary", image,
        containerName: names.client, identity, checkoutDir: join(scratch, "workspace"), assetsDir: join(scratch, "assets"), outputDir: "unused",
        access: ["--mount", `type=bind,source=${input.sessionDirectory}/auth.json,target=/home/peregrine/.codex/auth.json,readonly`],
        command: "codex", commandArgs: command, methodologyEgress: { network: names.internal, proxyUrl: "http://egress-gateway:8081" } });
      args[0] = "create"; args.splice(1, 0, "--log-driver", "none"); containers.add(names.client);
      args.splice(args.indexOf(image), 0, "--entrypoint", "codex"); args.splice(args.indexOf(image) + 1, 1);
      successful(await docker(args, signal));
      verifyClientInspect(successful(await docker(["inspect", names.client], signal)).stdout,
        { name: names.client, image, imageId, network: names.internal, checkout: join(scratch, "workspace"), assets: join(scratch, "assets"),
          auth: join(input.sessionDirectory, "auth.json"), ...identity, imageEnvironment, args: command });
      const result = successful(await docker(["start", "--attach", "--interactive", names.client], signal, SAFE_CANARY_PROMPT));
      if (result.stderr.trim()) throw new Error("unexpected canary error stream");
      const stream = (hooks?.reduceStream ?? reduceSafeCanaryStream)(result.stdout), reader = attachment.readerSnapshot(), audit = attachment.auditSnapshot();
      same([audit.sessions.attempted, audit.sessions.initialized, audit.sessions.ready, audit.sessions.denied,
        audit.requests.denied, audit.tools.denied, audit.denialCodes, audit.transportFailures], [1, 1, 1, 0, 0, 0, [], []], "actual MCP session/read transport mismatch");
      if (reader.stopped || reader.pending.length || reader.calls > 100 || reader.bytes > 2_000_000 || reader.transcript.some(call => !call.delivered)) throw new Error("reader budget or delivery mismatch");
      const calls = stream.projection.filter(event => event.type === "item.completed" && "itemType" in event && event.itemType === "mcp_tool_call");
      same(calls.map(call => ({ tool: "tool" in call ? call.tool : null, argumentsSha256: "argumentsSha256" in call ? call.argumentsSha256 : null })),
        reader.transcript.map(call => ({ tool: call.tool, argumentsSha256: digest(call.arguments) })), "CLI tool activity differs from trusted reader");
      for (const call of reader.transcript) {
        const response = JSON.parse(call.response);
        if (call.tool !== "read_link" && response.status !== "complete-for-indexed-export") {
          const linkExclusionsOnly = ["list_tree", "search_text"].includes(call.tool) && response.status === "incomplete" && response.truncated === false &&
            Array.isArray(response.unavailable) && response.unavailable.length > 0 && response.unavailable.every((entry: { path: string; reason: string }) => entry.reason === "unsupported-file-type" && nativeLinks.has(entry.path));
          if (!linkExclusionsOnly) throw new Error("required reader operation unavailable");
        }
        if (call.tool === "read_link") {
          const literal = response.kind === "literal-symlink-source" && response.followed === false;
          const refused = nativeLinks.size === 0 && response.unavailable === true && (call.arguments as { path?: string }).path === "review.diff";
          if (!literal && !refused || stream.output.tools.read_link !== (literal ? "literal-link-read" : "refused-no-link")) throw new Error("literal link evidence mismatch");
        }
      }
      receipt({ actualReadUseSha256: digest(reader.transcript), auditSha256: digest(audit), calls: reader.calls, bytes: reader.bytes });
      return result.stdout;
    },
    closeReads() { closing = true; if (attachment) { readerClose ??= attachment.close(); void readerClose.catch(() => undefined); } },
    async kill() {
      // remove --force is idempotent with respect to absence; the separate query
      // is authoritative, including interrupted or uncertain starts.
      if (containers.has(names.client)) await removeContainer(names.client);
    },
    async cleanup() {
      closing = true; const errors: unknown[] = [];
      try { if (attachment) await (readerClose ??= attachment.close()); } catch { errors.push("reads"); }
      for (const name of containers) { try { await removeContainer(name); } catch { errors.push("container"); } }
      for (const name of networks) {
        try {
          await docker(["network", "rm", name]);
          const result = successful(await docker(["network", "ls", "--quiet", "--filter", `name=^${name}$`]));
          if (result.stdout.trim()) throw new Error("network remains");
        } catch { errors.push("network"); }
      }
      if (attachment) {
        try { receipt({ readAuditSha256: digest(attachment.sealAudit()), readerSha256: digest(attachment.readerSnapshot()) }); }
        catch { errors.push("read-evidence"); }
      }
      if (scratch) { try { rmSync(scratch, { recursive: true, force: true }); } catch { errors.push("scratch"); } }
      if (errors.length || receiptFailed) throw new Error("mandatory private runtime cleanup unproven");
      return { readsClosed: true, clientAbsent: true, sidecarsAbsent: true, networkAbsent: true, sessionRemoved: true, independentlyObserved: true };
    },
  };
}
