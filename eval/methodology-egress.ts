import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { exec, type ExecResult } from "../src/util/exec.js";
import { canonicalJsonSha256 } from "./experiment.js";

/**
 * Docker is deliberately kept behind this small adapter.  In particular, a
 * caller cannot replace a topology-mutating command after it has been
 * validated: `dockerCall` reparses the final argv immediately before exec.
 */
export type DockerExec = (
  command: string,
  args: string[],
  options?: {
    env?: Record<string, string>;
    inheritEnv?: boolean;
    timeoutMs?: number;
  },
) => Promise<ExecResult>;

/** Sidecar-capable image accepted by the methodology egress supervisor. */
export const METHODOLOGY_EGRESS_RUNTIME_IMAGE =
  "ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:d62b740e61ef05f0813531544e5de89ce76e2eb4a8d55248d9f364b9afd7a171" as const;
export const METHODOLOGY_EGRESS_PROTOCOL = "methodology-egress-supervisor-v1" as const;
export const GATEWAY_ENTRYPOINT = "/usr/local/bin/peregrine-egress-gateway" as const;
export const FORWARDER_ENTRYPOINT = "/usr/local/bin/peregrine-methodology-mcp-forwarder" as const;
export const ACCEPTED_METHODOLOGY_EGRESS_IMAGE = METHODOLOGY_EGRESS_RUNTIME_IMAGE;
export const METHODOLOGY_MCP_LIMIT_MAXIMA = Object.freeze({
  maxRequestBytes: 50 * 1024 * 1024,
  maxResponseBytes: 50 * 1024 * 1024,
  maxHeaderBytes: 64 * 1024,
  requestTimeoutMs: 120_000,
  maxConnections: 1_024,
  maxRequests: 1_000_000,
} as const);

/**
 * Immutable environment inherited from the accepted image. Docker includes
 * these entries in Config.Env alongside the role-specific `--env` entries.
 * Keep this list exact: accepting arbitrary image additions would make the
 * inspect attestation non-deterministic.
 */
export const METHODOLOGY_EGRESS_BASE_ENV = Object.freeze([
  "PATH=/opt/peregrine-provider/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  "NODE_VERSION=22.22.1",
  "YARN_VERSION=1.22.22",
  "NODE_ENV=production",
  "HOME=/home/peregrine",
  "XDG_CONFIG_HOME=/home/peregrine/xdg-config",
  "XDG_CACHE_HOME=/home/peregrine/xdg-cache",
  "XDG_DATA_HOME=/home/peregrine/xdg-data",
  "TMPDIR=/tmp",
  "GIT_CONFIG_NOSYSTEM=1",
  "GIT_CONFIG_GLOBAL=/dev/null",
  "GIT_TERMINAL_PROMPT=0",
  "DISABLE_AUTOUPDATER=1",
  "DISABLE_UPDATES=1",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
] as const);

const NAME = /^[a-z0-9][a-z0-9_.-]{0,62}$/u;
const CONTAINER = /^[a-z0-9][a-z0-9_.-]{0,127}$/u;
const HEX = /^[a-f0-9]{64}$/u;
const IPV4_CIDR = /^(?:10\.(?:[0-9]{1,3}\.){2}[0-9]{1,3}|172\.(?:1[6-9]|2[0-9]|3[0-1])\.(?:[0-9]{1,3}\.)[0-9]{1,3}|192\.168\.(?:[0-9]{1,3}\.)[0-9]{1,3})\/(?:[1-2][0-9]|3[0-2])$/u;
const PROXY_ENV_NAMES = new Set([
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy",
  "NO_PROXY", "no_proxy", "EGRESS_PROXY", "MCP_FORWARDER_URL",
]);
const SECRET_ENV = /(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|COOKIE|AUTH(?:ORIZATION)?)(?:_|$)/iu;
const READINESS_LOG_TAIL = "64";
const MAX_READINESS_LOG_BYTES = 64 * 1024;

export interface MethodologyMcpLimits {
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
  readonly maxHeaderBytes: number;
  readonly requestTimeoutMs: number;
  readonly maxConnections: number;
  readonly maxRequests: number;
}

export interface MethodologyEgressSupervisorOptions {
  readonly attemptId: string;
  readonly armId: string;
  readonly sourceHeadTree: string;
  /** Exact lower-case DNS authorities, each ending in :443. */
  readonly providerAuthorities: readonly string[];
  /** Port on the host-bound MCP server. */
  readonly hostMcpPort: number;
  readonly mcpLimits: MethodologyMcpLimits;
  readonly image?: string;
  readonly readyTimeoutMs?: number;
  readonly stopTimeoutMs?: number;
}

export interface StructuralMockMethodologyEgressSupervisorOptions extends MethodologyEgressSupervisorOptions {
  /** Explicit test seam; structural mocks never attest provider execution. */
  readonly run: DockerExec;
}

export interface MethodologyEgressNames {
  /** Fresh, non-internal network through which the sidecars reach providers. */
  readonly externalNetwork: string;
  /** Fresh internal network shared by provider and sidecars only. */
  readonly network: string;
  readonly gateway: string;
  readonly forwarder: string;
}

export interface MethodologyEgressAttestation {
  readonly schemaVersion: 1;
  readonly protocol: typeof METHODOLOGY_EGRESS_PROTOCOL;
  readonly attemptId: string;
  readonly armId: string;
  readonly sourceHeadTree: string;
  readonly image: typeof ACCEPTED_METHODOLOGY_EGRESS_IMAGE;
  readonly providerAuthorities: readonly string[];
  readonly providerAuthoritiesSha256: string;
  readonly network: string;
  readonly networkSubnet: string;
  readonly externalNetwork: string;
  readonly externalNetworkSubnet: string;
  readonly gateway: { readonly name: string; readonly alias: "egress-gateway"; readonly entrypoint: typeof GATEWAY_ENTRYPOINT };
  readonly forwarder: { readonly name: string; readonly alias: "mcp-forwarder"; readonly entrypoint: typeof FORWARDER_ENTRYPOINT };
  readonly hostMcpPort: number;
  readonly mcpLimitsSha256: string;
  readonly topology: "gateway-and-forwarder-only-before-provider";
  readonly executionClass: "provider" | "structural-mock";
  readonly attestationSha256: string;
}

export interface SidecarAuditDiagnostic {
  readonly sidecar: "gateway" | "forwarder";
  readonly ready: boolean;
  readonly sealed: boolean;
  readonly selfDigestValid: boolean;
  readonly lineObserved: boolean;
}

/**
 * Opaque launch capability issued only after the supervisor has authenticated
 * its complete sidecar topology. Runtime containment accepts this capability,
 * never a caller-shaped copy of its fields.
 */
export interface MethodologyEgressLaunchCapability {
  readonly network: string;
  readonly proxyUrl: string;
  readonly internalMcpUrl: string;
  readonly executionClass: "provider" | "structural-mock";
  readonly attestationSha256: string;
}

export interface MethodologyEgressSupervisor {
  readonly network: string;
  readonly proxyUrl: string;
  readonly internalMcpUrl: string;
  readonly names: MethodologyEgressNames;
  readonly attestation: MethodologyEgressAttestation;
  readonly auditDiagnostics: readonly SidecarAuditDiagnostic[];
  readonly launchCapability: MethodologyEgressLaunchCapability;
  readonly close: () => Promise<void>;
}

const LAUNCH_CAPABILITIES = new WeakSet<object>();

/** Assert that a value is the supervisor-issued launch capability. */
export function assertMethodologyEgressLaunchCapability(
  value: unknown,
): asserts value is MethodologyEgressLaunchCapability {
  if (!value || typeof value !== "object" || !LAUNCH_CAPABILITIES.has(value)) {
    throw new TypeError("methodology egress launch capability was not issued by its supervisor");
  }
}

type ParsedNetworkCreate = { name: string; subnet: string; internal: boolean };
type ParsedRun = { name: string; network: string; image: string; entrypoint: string; env: readonly string[]; addHost?: string };

function fail(message: string): never { throw new TypeError(message); }

function validateAttemptId(value: string): void {
  if (typeof value !== "string" || !/^attempt-[0-9]{6}$/u.test(value)) fail("invalid methodology attempt id");
}

function validateTree(value: string): void {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value)) fail("invalid methodology source tree");
}

function validatePort(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) fail(`${label} must be a valid TCP port`);
}

function validateLimits(value: MethodologyMcpLimits): MethodologyMcpLimits {
  const keys = ["maxRequestBytes", "maxResponseBytes", "maxHeaderBytes", "requestTimeoutMs", "maxConnections", "maxRequests"] as const;
  if (!value || typeof value !== "object" || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) fail("MCP limits must be exact");
  for (const key of keys) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 1 || value[key] > METHODOLOGY_MCP_LIMIT_MAXIMA[key]) {
      fail(`invalid MCP limit ${key}`);
    }
  }
  if (value.maxResponseBytes < 4_096 || value.maxHeaderBytes < 1_024) fail("MCP limits are below the sidecar minimum");
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, value[key]])) as unknown as MethodologyMcpLimits);
}

/** Validate and canonicalize the provider destination policy before Docker exists. */
export function validateProviderAuthorities(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values) || values.length === 0) fail("provider host allowlist must be nonempty");
  const result = values.map((value) => {
    if (typeof value !== "string" || value.length === 0 || value.trim() !== value || value.length > 255) fail("provider host allowlist entries must be exact");
    const colon = value.indexOf(":");
    if (colon <= 0 || colon !== value.lastIndexOf(":") || value.slice(colon + 1) !== "443") fail("provider host allowlist ports must be exactly 443");
    const host = value.slice(0, colon);
    if (host.includes("..") || host.startsWith(".") || host.endsWith(".") || host.includes("*") || isIP(host) !== 0) fail("provider host allowlist contains an invalid host");
    if (host !== host.toLowerCase() || host.split(".").length < 2 || host.split(".").some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-") || !/^[a-z0-9-]+$/u.test(label))) fail("provider host allowlist host is not a DNS name");
    return `${host}:443`;
  });
  if (new Set(result).size !== result.length) fail("provider host allowlist contains duplicates");
  return Object.freeze(result);
}

export const parseProviderHostAllowlist = validateProviderAuthorities;

function assertImage(image: string): asserts image is typeof ACCEPTED_METHODOLOGY_EGRESS_IMAGE {
  if (image !== ACCEPTED_METHODOLOGY_EGRESS_IMAGE) fail("methodology egress image must equal the accepted immutable digest");
}

function validateName(value: string, label: string): void {
  if (!(label === "network" ? NAME : CONTAINER).test(value)) fail(`invalid ${label} name`);
}

function networkSubnet(): string {
  // A /28 in a private range normally untouched by Docker's default bridge.
  // The random octet is part of the attempt identity and prevents stale
  // networks from being accidentally reused.
  const bytes = randomBytes(2);
  return `10.254.${bytes[1]}.0/28`;
}

function names(attemptId: string): MethodologyEgressNames {
  const suffix = `${attemptId.slice("attempt-".length)}-${randomUUID()}`;
  const networkSuffix = randomUUID();
  return {
    externalNetwork: `peregrine-egress-x-${networkSuffix}`,
    network: `peregrine-egress-${networkSuffix}`,
    gateway: `peregrine-egress-gateway-${suffix}`,
    forwarder: `peregrine-egress-forwarder-${suffix}`,
  };
}

function envArray(env: Record<string, string>): string[] {
  return Object.entries(env).map(([key, value]) => `${key}=${value}`);
}

function sidecarCommon(name: string, network: string, image: string, entrypoint: string, env: Record<string, string>, addHost?: string): string[] {
  return [
    "run", "--detach", "--name", name, "--pull", "never", "--network", network,
    "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--pids-limit", "64", "--user", "65532:65532",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=32m,uid=65532,gid=65532,mode=1777",
    "--tmpfs", "/home/peregrine:rw,noexec,nosuid,nodev,size=16m,uid=65532,gid=65532,mode=0700",
    ...(addHost ? ["--add-host", addHost] : []),
    ...envArray(env).flatMap((item) => ["--env", item]),
    "--entrypoint", entrypoint, image,
  ];
}

function parseNetworkCreateArgs(args: readonly string[], internal: boolean): ParsedNetworkCreate {
  const offset = internal ? 1 : 0;
  if (args.length !== (internal ? 9 : 8) || args[0] !== "network" || args[1] !== "create" ||
      (internal && args[2] !== "--internal") || args[2 + offset] !== "--ipv6=false" ||
      args[3 + offset] !== "--driver" || args[4 + offset] !== "bridge" || args[5 + offset] !== "--subnet") {
    fail(`invalid ${internal ? "internal" : "external"} network create argv`);
  }
  const subnet = args[6 + offset]!; const name = args[7 + offset]!;
  validateName(name, "network");
  const [address, mask] = subnet.split("/");
  const octets = address?.split(".").map(Number);
  const privateRange = octets?.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) && octets[3] === 0 && (octets[0] === 10 || octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31 || octets[0] === 192 && octets[1] === 168);
  if (!IPV4_CIDR.test(subnet) || mask !== "28" || !privateRange) fail("internal network must use one IPv4 /28 subnet");
  return { name, subnet, internal };
}

/** Public pure parser used by tests and by the supervisor just before exec. */
export function parseMethodologyEgressNetworkCreateArgs(args: readonly string[]): ParsedNetworkCreate { return parseNetworkCreateArgs(args, true); }
export function parseMethodologyEgressExternalNetworkCreateArgs(args: readonly string[]): ParsedNetworkCreate { return parseNetworkCreateArgs(args, false); }

function parseSidecarRunArgs(args: readonly string[], expected: { name: string; network: string; image: string; entrypoint: string; role: "gateway" | "forwarder" }): ParsedRun {
  let i = 0;
  const take = (expectedValue?: string): string => {
    const value = args[i++];
    if (value === undefined || expectedValue !== undefined && value !== expectedValue) fail("invalid sidecar run argv");
    return value;
  };
  take("run"); take("--detach"); take("--name"); const name = take();
  take("--pull"); take("never"); take("--network"); const network = take();
  take("--read-only"); take("--cap-drop"); take("ALL"); take("--security-opt"); take("no-new-privileges");
  take("--pids-limit"); take("64"); take("--user"); take("65532:65532");
  take("--tmpfs"); const tmp = take(); take("--tmpfs"); const home = take();
  if (tmp !== "/tmp:rw,noexec,nosuid,nodev,size=32m,uid=65532,gid=65532,mode=1777" || home !== "/home/peregrine:rw,noexec,nosuid,nodev,size=16m,uid=65532,gid=65532,mode=0700") fail("sidecar tmpfs policy is not exact");
  let addHost: string | undefined;
  if (args[i] === "--add-host") { take("--add-host"); addHost = take(); }
  if (expected.role === "gateway" && addHost !== undefined) fail("gateway must not receive host-gateway access");
  if (expected.role === "forwarder" && addHost !== "host.docker.internal:host-gateway") fail("forwarder requires host-gateway access");
  const env: string[] = [];
  while (args[i] === "--env") { take("--env"); env.push(take()); }
  take("--entrypoint"); const entrypoint = take(); const image = take();
  if (i !== args.length || name !== expected.name || network !== expected.network || image !== expected.image || entrypoint !== expected.entrypoint) fail("sidecar run argv identity mismatch");
  if (env.some((item) => SECRET_ENV.test(item.split("=", 1)[0]!) && !item.startsWith("MCP_FORWARDER_TOKEN="))) fail("sidecar run argv contains a credential environment");
  if (env.some((item) => PROXY_ENV_NAMES.has(item.split("=", 1)[0]!))) fail("sidecar run argv contains an inherited proxy environment");
  const expectedEnvironment = expected.role === "gateway"
    ? ["EGRESS_ALLOWED_AUTHORITIES", "EGRESS_BIND_HOST", "EGRESS_BIND_PORT", "EGRESS_MAX_CONNECTIONS", "EGRESS_MAX_REQUESTS", "EGRESS_MAX_HEADER_BYTES", "EGRESS_MAX_TUNNEL_BYTES", "EGRESS_DEADLINE_MS", "EGRESS_MAX_CLIENT_HELLO_BYTES"]
    : ["MCP_FORWARDER_BIND_HOST", "MCP_FORWARDER_BIND_PORT", "MCP_FORWARDER_ALLOWED_HOST", "MCP_FORWARDER_TOKEN", "MCP_FORWARDER_UPSTREAM_PORT", "MCP_FORWARDER_MAX_REQUEST_BYTES", "MCP_FORWARDER_MAX_RESPONSE_BYTES", "MCP_FORWARDER_MAX_HEADER_BYTES", "MCP_FORWARDER_REQUEST_TIMEOUT_MS", "MCP_FORWARDER_MAX_CONNECTIONS", "MCP_FORWARDER_MAX_REQUESTS"];
  const actualEnvironment = env.map((item) => item.slice(0, item.indexOf("="))).sort();
  if (JSON.stringify(actualEnvironment) !== JSON.stringify([...expectedEnvironment].sort())) fail("sidecar environment is not the exact allowlist");
  return { name, network, image, entrypoint, env: Object.freeze(env), ...(addHost ? { addHost } : {}) };
}

export function parseMethodologyEgressSidecarRunArgs(args: readonly string[], expected: Parameters<typeof parseSidecarRunArgs>[1]): ParsedRun { return parseSidecarRunArgs(args, expected); }

function parseConnectArgs(args: readonly string[], expected: { network: string; container: string; alias: string }): void {
  if (args.length !== 6 || args[0] !== "network" || args[1] !== "connect" || args[2] !== "--alias" || args[4] !== expected.network || args[5] !== expected.container || args[3] !== expected.alias) fail("invalid sidecar network connect argv");
  validateName(expected.network, "network"); validateName(expected.container, "container");
}

export function parseMethodologyEgressNetworkConnectArgs(args: readonly string[], expected: { network: string; container: string; alias: string }): void { parseConnectArgs(args, expected); }

function parseStopArgs(args: readonly string[], expectedName: string): void {
  if (JSON.stringify(args) !== JSON.stringify(["stop", "--time", "15", expectedName])) fail("invalid sidecar stop argv");
}

function parseRemoveArgs(args: readonly string[], expectedName: string): void {
  if (JSON.stringify(args) !== JSON.stringify(["rm", "--force", expectedName])) fail("invalid sidecar remove argv");
}

function parseNetworkRemoveArgs(args: readonly string[], expectedName: string): void {
  if (JSON.stringify(args) !== JSON.stringify(["network", "rm", expectedName])) fail("invalid internal network remove argv");
}

function dockerEnvironment(): Record<string, string> { return { PATH: process.env.PATH ?? "" }; }

async function dockerCall(run: DockerExec, args: string[], mutate?: () => void, timeoutMs = 15_000): Promise<ExecResult> {
  // The callback is intentionally invoked here, immediately before the
  // injected/default executor.  It is not safe to validate a cached argv.
  mutate?.();
  return run("docker", args, { timeoutMs, env: dockerEnvironment(), inheritEnv: false });
}

function successful(result: ExecResult): boolean { return result.code === 0 && !result.timedOut; }

function requireSuccess(result: ExecResult, label: string): ExecResult {
  if (!successful(result)) throw new Error(`${label} failed`);
  return result;
}

async function waitForReady(run: DockerExec, name: string, protocol: string, deadlineMs: number): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  let seen = "";
  while (Date.now() <= deadline) {
    const result = await dockerCall(run, ["logs", "--tail", READINESS_LOG_TAIL, "--since", "0s", name], undefined, Math.min(5_000, Math.max(1, deadline - Date.now())));
    if (successful(result)) {
      seen = `${seen}\n${result.stdout}`.slice(-MAX_READINESS_LOG_BYTES);
      if (seen.split(/\r?\n/u).some((line) => {
        try { const value = JSON.parse(line) as Record<string, unknown>; return value.status === "ready" && value.protocol === protocol && value.ready === true; } catch { return false; }
      })) return;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))));
  }
  throw new Error(`timed out waiting for ${protocol} readiness`);
}

function parseJsonLines(stdout: string): Record<string, unknown>[] {
  return stdout.split(/\r?\n/u).flatMap((line) => {
    try { const value = JSON.parse(line) as unknown; return value && typeof value === "object" && !Array.isArray(value) ? [value as Record<string, unknown>] : []; } catch { return []; }
  });
}

function digest(value: unknown, protocol: string, field = "sha256"): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const supplied = body[field];
  if (typeof supplied !== "string" || !HEX.test(supplied)) return false;
  const copy = { ...body }; delete copy[field];
  // The gateway intentionally omits `sealed` from the domain-separated body;
  // the forwarder includes it. Preserve each merged sidecar's wire contract.
  if (protocol === "egress-gateway-audit-v1") delete copy.sealed;
  return createHash("sha256").update(`${protocol}\0`).update(JSON.stringify(copy)).digest("hex") === supplied;
}

function sealedDiagnostic(sidecar: "gateway" | "forwarder", stdout: string): SidecarAuditDiagnostic {
  const protocol = sidecar === "gateway" ? "egress-gateway-v1" : "methodology-mcp-forwarder-v1";
  const lines = parseJsonLines(stdout);
  const ready = lines.some((value) => value.status === "ready" && value.protocol === protocol);
  const sealed = lines.some((value) => value.status === "sealed" && value.protocol === protocol && value.audit && typeof value.audit === "object");
  const audit = lines.find((value) => value.status === "sealed" && value.protocol === protocol)?.audit;
  const selfDigestValid = sidecar === "gateway"
    ? digest(audit, "egress-gateway-audit-v1", "sha256")
    : digest(audit, "methodology-mcp-forwarder-audit-v1", "snapshotSha256");
  return Object.freeze({ sidecar, ready, sealed, selfDigestValid, lineObserved: sealed });
}

function ipv4InCidr(value: string, cidr: string): boolean {
  const address = value.split("/", 1)[0]!;
  const [ip, maskText] = cidr.split("/");
  const toInt = (candidate: string): number | undefined => {
    const octets = candidate.split(".").map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return undefined;
    return (((octets[0]! << 24) >>> 0) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0;
  };
  const actual = toInt(address); const base = toInt(ip ?? ""); const mask = Number(maskText);
  if (actual === undefined || base === undefined || !Number.isInteger(mask) || mask < 0 || mask > 32) return false;
  const bits = mask === 0 ? 0 : (0xffffffff << (32 - mask)) >>> 0;
  return (actual & bits) === (base & bits);
}

function parseInspect(stdout: string, expected: { name: string; network: string; externalNetwork: string; subnet: string; externalSubnet: string; image: string; entrypoint: string; alias: string; env: Record<string, string>; addHost?: string }): Record<string, unknown> {
  const values = parseJsonLines(stdout);
  const value = values[0];
  if (!value) fail(`missing ${expected.name} Docker inspect evidence`);
  if (value.Name !== `/${expected.name}` || value.Path !== expected.entrypoint || JSON.stringify(value.Args ?? []) !== "[]") fail(`invalid ${expected.name} entrypoint inspect evidence`);
  if (!value.Config || typeof value.Config !== "object" || Array.isArray(value.Config)) fail(`invalid ${expected.name} config inspect evidence`);
  {
    const config = value.Config as Record<string, unknown>;
    if (config.Image !== expected.image) fail(`invalid ${expected.name} image inspect evidence`);
    if (config.Entrypoint !== undefined && JSON.stringify(config.Entrypoint) !== JSON.stringify([expected.entrypoint])) fail(`invalid ${expected.name} configured entrypoint`);
    if (!Array.isArray(config.Env) || new Set(config.Env).size !== config.Env.length || config.Env.some((item) => typeof item !== "string" || !item.includes("=") || PROXY_ENV_NAMES.has(item.split("=", 1)[0]!) || SECRET_ENV.test(item.split("=", 1)[0]!) && item.split("=", 1)[0] !== "MCP_FORWARDER_TOKEN")) fail(`invalid ${expected.name} credential/proxy environment`);
    const expectedEnv = [...METHODOLOGY_EGRESS_BASE_ENV, ...Object.entries(expected.env).map(([key, value]) => `${key}=${value}`)].sort();
    const actualEnv = (config.Env as string[]).slice().sort();
    if (JSON.stringify(actualEnv) !== JSON.stringify(expectedEnv)) fail(`invalid ${expected.name} environment policy`);
  }
  const mounts = value.Mounts;
  if (!Array.isArray(mounts) || mounts.some((mount) => {
    if (!mount || typeof mount !== "object") return true;
    const item = mount as Record<string, unknown>;
    return item.Type !== "tmpfs" || (item.Destination !== "/tmp" && item.Destination !== "/home/peregrine");
  }) || new Set(mounts.map((mount) => (mount as Record<string, unknown>).Destination)).size !== mounts.length) fail(`${expected.name} must not have host mounts`);
  const hostConfig = value.HostConfig as Record<string, unknown> | undefined;
  if (!hostConfig || hostConfig.ReadonlyRootfs !== true || JSON.stringify(hostConfig.CapDrop) !== JSON.stringify(["ALL"]) ||
      !Array.isArray(hostConfig.SecurityOpt) || !hostConfig.SecurityOpt.includes("no-new-privileges") ||
      hostConfig.PidsLimit !== 64 || hostConfig.User !== "65532:65532" ||
      JSON.stringify(hostConfig.Tmpfs) !== JSON.stringify({
        "/tmp": "rw,noexec,nosuid,nodev,size=32m,uid=65532,gid=65532,mode=1777",
        "/home/peregrine": "rw,noexec,nosuid,nodev,size=16m,uid=65532,gid=65532,mode=0700",
      })) fail(`${expected.name} inspect does not attest the sidecar containment policy`);
  const state = value.State as Record<string, unknown> | undefined;
  if (!state || state.Running !== true) fail(`${expected.name} inspect does not prove a running sidecar`);
  const networks = (value.NetworkSettings as Record<string, unknown> | undefined)?.Networks as Record<string, unknown> | undefined;
  if (!networks || JSON.stringify(Object.keys(networks).sort()) !== JSON.stringify([expected.externalNetwork, expected.network].sort())) fail(`${expected.name} inspect has an unexpected network topology`);
  const internalEndpoint = networks[expected.network] as Record<string, unknown> | undefined;
  const externalEndpoint = networks[expected.externalNetwork] as Record<string, unknown> | undefined;
  const aliases = internalEndpoint?.Aliases;
  if (!Array.isArray(aliases) || !aliases.includes(expected.alias) || aliases.some((item) => item !== expected.alias && item !== expected.name)) fail(`${expected.name} inspect has an unexpected internal alias`);
  if (typeof internalEndpoint?.IPAddress !== "string" || !ipv4InCidr(internalEndpoint.IPAddress, expected.subnet) ||
      typeof externalEndpoint?.IPAddress !== "string" || !ipv4InCidr(externalEndpoint.IPAddress, expected.externalSubnet)) fail(`${expected.name} inspect has no IPv4 address in its attempt networks`);
  const extraHosts = (hostConfig?.ExtraHosts ?? []) as unknown;
  if (expected.addHost === undefined) {
    if (Array.isArray(extraHosts) && extraHosts.length !== 0) fail(`${expected.name} must not receive host-gateway access`);
  } else if (!Array.isArray(extraHosts) || !extraHosts.includes(expected.addHost)) fail(`${expected.name} is missing host-gateway access`);
  return value;
}

export function parseMethodologyEgressContainerInspect(
  stdout: string,
  expected: { name: string; network: string; externalNetwork: string; subnet: string; externalSubnet: string; image: string; entrypoint: string; alias: string; env: Record<string, string>; addHost?: string },
): Record<string, unknown> { return parseInspect(stdout, expected); }

function parseNetworkInspect(stdout: string, expected: { name: string; network: string; subnet: string; sidecars: readonly string[]; internal?: boolean }): void {
  const trimmed = stdout.trim();
  let values: unknown[];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    values = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    values = parseJsonLines(stdout);
  }
  if (values.length !== 1) fail("network inspect must return exactly one network");
  const value = values[0] as Record<string, unknown> | undefined;
  if (!value || value.Name !== expected.network || value.Driver !== "bridge" || value.Internal !== (expected.internal ?? true) || value.EnableIPv6 !== false) fail("network inspect evidence is not exact");
  const ipam = value.IPAM as Record<string, unknown> | undefined;
  const configs = ipam?.Config;
  if (!Array.isArray(configs) || configs.length !== 1 || (configs[0] as Record<string, unknown>).Subnet !== expected.subnet) fail("internal network IPv4 IPAM is not exact");
  const containers = value.Containers as Record<string, unknown> | undefined;
  if (!containers || Object.keys(containers).length !== expected.sidecars.length) fail("internal network has unexpected members");
  const addresses: string[] = [];
  const observed = Object.values(containers).map((entry) => {
    const item = entry as Record<string, unknown>;
    if (typeof item.Name !== "string" || typeof item.IPv4Address !== "string" || item.IPv6Address) fail("network member is not IPv4-only");
    const address = item.IPv4Address.split("/", 1)[0]!;
    if (!ipv4InCidr(address, expected.subnet)) fail("network member address is outside the attested subnet");
    addresses.push(address);
    return item.Name.replace(/^\//u, "");
  }).sort();
  if (JSON.stringify(observed) !== JSON.stringify([...expected.sidecars].sort())) fail("internal network members are not the two sidecars");
  if (new Set(addresses).size !== addresses.length) fail("network member addresses are not distinct");
}

export function parseMethodologyEgressNetworkInspect(
  stdout: string,
  expected: { name: string; network: string; subnet: string; sidecars: readonly string[]; internal?: boolean },
): void { parseNetworkInspect(stdout, expected); }

function topologyEnvForGateway(authorities: readonly string[]): Record<string, string> {
  return { EGRESS_ALLOWED_AUTHORITIES: authorities.join(","), EGRESS_BIND_HOST: "0.0.0.0", EGRESS_BIND_PORT: "8081", EGRESS_MAX_CONNECTIONS: "32", EGRESS_MAX_REQUESTS: "64", EGRESS_MAX_HEADER_BYTES: "16384", EGRESS_MAX_TUNNEL_BYTES: "16777216", EGRESS_DEADLINE_MS: "15000", EGRESS_MAX_CLIENT_HELLO_BYTES: "65536" };
}

function topologyEnvForForwarder(token: string, hostMcpPort: number, limits: MethodologyMcpLimits): Record<string, string> {
  return { MCP_FORWARDER_BIND_HOST: "0.0.0.0", MCP_FORWARDER_BIND_PORT: "8082", MCP_FORWARDER_ALLOWED_HOST: "mcp-forwarder:8082", MCP_FORWARDER_TOKEN: token, MCP_FORWARDER_UPSTREAM_PORT: String(hostMcpPort), ...Object.fromEntries(Object.entries(limits).map(([key, value]) => [`MCP_FORWARDER_${key.replace(/[A-Z]/gu, (letter) => `_${letter}`).toUpperCase()}`, String(value)])) };
}

function aggregate(primary: unknown, cleanup: readonly Error[]): never {
  if (cleanup.length) throw new AggregateError([primary, ...cleanup], "methodology egress operation and cleanup both failed");
  throw primary;
}

/** Start and authenticate the provider sidecars using the built-in Docker executor. */
export async function createMethodologyEgressSupervisor(options: MethodologyEgressSupervisorOptions): Promise<MethodologyEgressSupervisor> {
  if (options && typeof options === "object" && Object.prototype.hasOwnProperty.call(options, "run")) {
    fail("provider egress supervisor cannot inject a Docker executor");
  }
  return createSupervisor(options, exec, "provider");
}

/**
 * Structural-only test seam. Its capability is explicitly branded as a
 * structural mock and therefore cannot be used as provider evidence.
 */
export async function createStructuralMockMethodologyEgressSupervisor(
  options: StructuralMockMethodologyEgressSupervisorOptions,
): Promise<MethodologyEgressSupervisor> {
  return createSupervisor(options, options.run, "structural-mock");
}

async function createSupervisor(
  options: MethodologyEgressSupervisorOptions,
  run: DockerExec,
  executionClass: "provider" | "structural-mock",
): Promise<MethodologyEgressSupervisor> {
  validateAttemptId(options.attemptId); validateTree(options.sourceHeadTree);
  if (typeof options.armId !== "string" || !/^[A-D]$/u.test(options.armId)) fail("invalid methodology arm id");
  const authorities = validateProviderAuthorities(options.providerAuthorities);
  validatePort(options.hostMcpPort, "host MCP port");
  const limits = validateLimits(options.mcpLimits);
  const image = options.image ?? ACCEPTED_METHODOLOGY_EGRESS_IMAGE; assertImage(image);
  const readyTimeoutMs = options.readyTimeoutMs ?? 10_000;
  if (!Number.isSafeInteger(readyTimeoutMs) || readyTimeoutMs < 100 || readyTimeoutMs > 120_000) fail("invalid sidecar readiness timeout");
  const stopTimeoutMs = options.stopTimeoutMs ?? 15_000;
  if (!Number.isSafeInteger(stopTimeoutMs) || stopTimeoutMs < 1 || stopTimeoutMs > 120_000) fail("invalid sidecar stop timeout");
  const n = names(options.attemptId); const subnet = networkSubnet(); let externalSubnet = networkSubnet();
  while (externalSubnet === subnet) externalSubnet = networkSubnet();
  const token = randomBytes(32).toString("hex");
  const gatewayEnv = topologyEnvForGateway(authorities);
  const forwarderEnv = topologyEnvForForwarder(token, options.hostMcpPort, limits);
  const created: Array<"gateway" | "forwarder"> = [];
  let externalNetworkCreated = false;
  let internalNetworkCreated = false;
  let primary: unknown;
  const diagnostics: SidecarAuditDiagnostic[] = [];
  const cleanupProgress = createCleanupProgress();
  try {
    const externalNetworkArgs = ["network", "create", "--ipv6=false", "--driver", "bridge", "--subnet", externalSubnet, n.externalNetwork];
    externalNetworkCreated = true;
    requireSuccess(await dockerCall(run, externalNetworkArgs, () => { parseNetworkCreateArgs(externalNetworkArgs, false); }), "external network creation");
    const networkArgs = ["network", "create", "--internal", "--ipv6=false", "--driver", "bridge", "--subnet", subnet, n.network];
    internalNetworkCreated = true;
    requireSuccess(await dockerCall(run, networkArgs, () => { parseNetworkCreateArgs(networkArgs, true); }), "internal network creation");
    const gatewayArgs = sidecarCommon(n.gateway, n.externalNetwork, image, GATEWAY_ENTRYPOINT, gatewayEnv);
    created.push("gateway");
    requireSuccess(await dockerCall(run, gatewayArgs, () => { parseSidecarRunArgs(gatewayArgs, { name: n.gateway, network: n.externalNetwork, image, entrypoint: GATEWAY_ENTRYPOINT, role: "gateway" }); }), "gateway sidecar start");
    const forwarderArgs = sidecarCommon(n.forwarder, n.externalNetwork, image, FORWARDER_ENTRYPOINT, forwarderEnv, "host.docker.internal:host-gateway");
    created.push("forwarder");
    requireSuccess(await dockerCall(run, forwarderArgs, () => { parseSidecarRunArgs(forwarderArgs, { name: n.forwarder, network: n.externalNetwork, image, entrypoint: FORWARDER_ENTRYPOINT, role: "forwarder" }); }), "forwarder sidecar start");
    await waitForReady(run, n.gateway, "egress-gateway-v1", readyTimeoutMs);
    await waitForReady(run, n.forwarder, "methodology-mcp-forwarder-v1", readyTimeoutMs);
    const gatewayConnect = ["network", "connect", "--alias", "egress-gateway", n.network, n.gateway];
    requireSuccess(await dockerCall(run, gatewayConnect, () => { parseConnectArgs(gatewayConnect, { network: n.network, container: n.gateway, alias: "egress-gateway" }); }), "gateway internal network attach");
    const forwarderConnect = ["network", "connect", "--alias", "mcp-forwarder", n.network, n.forwarder];
    requireSuccess(await dockerCall(run, forwarderConnect, () => { parseConnectArgs(forwarderConnect, { network: n.network, container: n.forwarder, alias: "mcp-forwarder" }); }), "forwarder internal network attach");
    const inspect = requireSuccess(await dockerCall(run, ["inspect", n.gateway, n.forwarder], undefined), "sidecar inspect");
    // Docker's default JSON output is one array; test executors may return one
    // JSON object per line. Both are accepted, but every sidecar is checked.
    const inspectValues = inspect.stdout.trim().startsWith("[") ? JSON.parse(inspect.stdout) as unknown[] : parseJsonLines(inspect.stdout);
    if (!Array.isArray(inspectValues) || inspectValues.length !== 2) throw new Error("sidecar inspect did not return both containers");
    parseInspect(JSON.stringify(inspectValues[0]), { name: n.gateway, network: n.network, externalNetwork: n.externalNetwork, subnet, externalSubnet, image, entrypoint: GATEWAY_ENTRYPOINT, alias: "egress-gateway", env: gatewayEnv });
    parseInspect(JSON.stringify(inspectValues[1]), { name: n.forwarder, network: n.network, externalNetwork: n.externalNetwork, subnet, externalSubnet, image, entrypoint: FORWARDER_ENTRYPOINT, alias: "mcp-forwarder", env: forwarderEnv, addHost: "host.docker.internal:host-gateway" });
    const networkInspect = requireSuccess(await dockerCall(run, ["network", "inspect", n.network], undefined), "internal network inspect");
    parseNetworkInspect(networkInspect.stdout, { name: n.network, network: n.network, subnet, sidecars: [n.gateway, n.forwarder] });
    const externalInspect = requireSuccess(await dockerCall(run, ["network", "inspect", n.externalNetwork], undefined), "external network inspect");
    parseNetworkInspect(externalInspect.stdout, { name: n.externalNetwork, network: n.externalNetwork, subnet: externalSubnet, sidecars: [n.gateway, n.forwarder], internal: false });
  } catch (error) { primary = error; }
  if (primary !== undefined) {
    const cleanup = await cleanupSidecars(run, n, created, externalNetworkCreated, internalNetworkCreated, diagnostics, 15_000, cleanupProgress);
    aggregate(primary, cleanup);
  }
  const attestationBody = { schemaVersion: 1 as const, protocol: METHODOLOGY_EGRESS_PROTOCOL, attemptId: options.attemptId, armId: options.armId, sourceHeadTree: options.sourceHeadTree, image, providerAuthorities: authorities, providerAuthoritiesSha256: canonicalJsonSha256(authorities), network: n.network, networkSubnet: subnet, externalNetwork: n.externalNetwork, externalNetworkSubnet: externalSubnet, gateway: { name: n.gateway, alias: "egress-gateway" as const, entrypoint: GATEWAY_ENTRYPOINT }, forwarder: { name: n.forwarder, alias: "mcp-forwarder" as const, entrypoint: FORWARDER_ENTRYPOINT }, hostMcpPort: options.hostMcpPort, mcpLimitsSha256: canonicalJsonSha256(limits), topology: "gateway-and-forwarder-only-before-provider" as const, executionClass };
  const attestation = Object.freeze({ ...attestationBody, attestationSha256: canonicalJsonSha256(attestationBody) });
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (!closePromise) {
      const operation = (async () => {
      const cleanup = await cleanupSidecars(run, n, ["gateway", "forwarder"], true, true, diagnostics, stopTimeoutMs, cleanupProgress);
      if (cleanup.length) throw new AggregateError(cleanup, "methodology egress cleanup failed");
      })();
      closePromise = operation.catch((error) => {
        closePromise = undefined;
        throw error;
      });
    }
    return closePromise;
  };
  const proxyUrl = "http://egress-gateway:8081";
  const internalMcpUrl = `http://mcp-forwarder:8082/mcp/${token}`;
  const launchCapability = Object.freeze({
    network: n.network,
    proxyUrl,
    internalMcpUrl,
    executionClass,
    attestationSha256: attestation.attestationSha256,
  });
  LAUNCH_CAPABILITIES.add(launchCapability);
  return Object.freeze({
    network: n.network,
    proxyUrl,
    internalMcpUrl,
    names: Object.freeze(n),
    attestation,
    auditDiagnostics: diagnostics,
    launchCapability,
    close,
  });
}

type SidecarName = "gateway" | "forwarder";
type CleanupProgress = {
  readonly stopped: Set<SidecarName>;
  readonly audited: Set<SidecarName>;
  readonly removed: Set<SidecarName>;
  readonly containerAbsenceProven: Set<SidecarName>;
  readonly networkRemoved: Set<string>;
  readonly networkAbsenceProven: Set<string>;
};

function createCleanupProgress(): CleanupProgress {
  return {
    stopped: new Set(), audited: new Set(), removed: new Set(), containerAbsenceProven: new Set(),
    networkRemoved: new Set(), networkAbsenceProven: new Set(),
  };
}

function replaceDiagnostic(diagnostics: SidecarAuditDiagnostic[], diagnostic: SidecarAuditDiagnostic): void {
  const index = diagnostics.findIndex((item) => item.sidecar === diagnostic.sidecar);
  if (index === -1) diagnostics.push(diagnostic);
  else diagnostics[index] = diagnostic;
}

async function cleanupSidecars(
  run: DockerExec,
  n: MethodologyEgressNames,
  created: readonly SidecarName[],
  externalNetworkCreated: boolean,
  internalNetworkCreated: boolean,
  diagnostics: SidecarAuditDiagnostic[],
  stopTimeoutMs = 15_000,
  progress = createCleanupProgress(),
): Promise<Error[]> {
  const errors: Error[] = [];
  for (const sidecar of ["gateway", "forwarder"] as const) {
    if (!created.includes(sidecar)) continue;
    const name = sidecar === "gateway" ? n.gateway : n.forwarder;
    try {
      if (!progress.stopped.has(sidecar)) {
        const stopArgs = ["stop", "--time", "15", name];
        const stopped = await dockerCall(run, stopArgs, () => parseStopArgs(stopArgs, name), stopTimeoutMs);
        if (!successful(stopped)) errors.push(new Error(`${sidecar} sidecar stop failed`));
        else progress.stopped.add(sidecar);
      }
      if (!progress.audited.has(sidecar)) {
        const logs = await dockerCall(run, ["logs", "--tail", READINESS_LOG_TAIL, name], undefined, 10_000);
        const diagnostic = sealedDiagnostic(sidecar, logs.stdout.slice(-MAX_READINESS_LOG_BYTES));
        replaceDiagnostic(diagnostics, diagnostic);
        if (!diagnostic.sealed || !diagnostic.selfDigestValid) errors.push(new Error(`${sidecar} sidecar sealed self-digest evidence is invalid`));
        else progress.audited.add(sidecar);
      }
    } catch { errors.push(new Error(`${sidecar} sidecar stop/audit failed`)); }
    try {
      if (!progress.removed.has(sidecar)) {
        const args = ["rm", "--force", name];
        const removed = await dockerCall(run, args, () => parseRemoveArgs(args, name));
        if (!successful(removed)) errors.push(new Error(`${sidecar} sidecar removal failed`));
        else progress.removed.add(sidecar);
      }
      if (!progress.containerAbsenceProven.has(sidecar)) {
        const proof = await dockerCall(run, ["ps", "--all", "--quiet", "--filter", `name=^/${name}$`]);
        if (!successful(proof) || proof.stdout.trim()) errors.push(new Error(`${sidecar} sidecar absence was not proven`));
        else {
          progress.containerAbsenceProven.add(sidecar);
          progress.removed.add(sidecar);
          progress.stopped.add(sidecar);
        }
      }
    } catch { errors.push(new Error(`${sidecar} sidecar removal/absence failed`)); }
  }
  for (const network of [n.externalNetwork, n.network] as const) {
    const createdNetwork = network === n.externalNetwork ? externalNetworkCreated : internalNetworkCreated;
    if (!createdNetwork) continue;
    try {
      if (!progress.networkRemoved.has(network)) {
        const args = ["network", "rm", network];
        const removed = await dockerCall(run, args, () => parseNetworkRemoveArgs(args, network));
        if (!successful(removed)) errors.push(new Error(`${network === n.externalNetwork ? "external" : "internal"} network removal failed`));
        else progress.networkRemoved.add(network);
      }
      if (!progress.networkAbsenceProven.has(network)) {
        const proof = await dockerCall(run, ["network", "ls", "--quiet", "--filter", `name=^${network}$`]);
        if (!successful(proof) || proof.stdout.trim()) errors.push(new Error(`${network === n.externalNetwork ? "external" : "internal"} network absence was not proven`));
        else {
          progress.networkAbsenceProven.add(network);
          progress.networkRemoved.add(network);
        }
      }
    } catch { errors.push(new Error(`${network === n.externalNetwork ? "external" : "internal"} network removal/absence failed`)); }
  }
  return errors;
}
