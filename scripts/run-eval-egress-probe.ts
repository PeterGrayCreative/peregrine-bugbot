import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NETWORK = /^[a-z0-9][a-z0-9_.-]{0,62}$/u;
const CONTAINER = /^[a-z0-9][a-z0-9_.-]{0,127}$/u;
const IMAGE = /^[a-z0-9][a-z0-9./:_-]*(?:@sha256:[a-f0-9]{64})?$/u;
const DIGEST_IMAGE = /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/u;
const HOST = /^[a-z0-9.-]+$/u;
const IPV4 = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/u;
const FIXTURE_PROTOCOL = "eval-egress-fixture-v1";
const GATEWAY_PROTOCOL = "egress-gateway-v1";
const FORWARDER_PROTOCOL = "methodology-mcp-forwarder-v1";
const TEST_SUBNET = "8.8.8.0/24";
const PROVIDER_IP = "8.8.8.2";
const MCP_IP = "8.8.8.3";
const PROVIDER_ALIAS = "fake-provider.invalid";
const MCP_ALIAS = "fake-mcp";
const GATEWAY_ALIAS = "egress-gateway";
const FORWARDER_ALIAS = "mcp-forwarder";
const GATEWAY_ENTRYPOINT = "/usr/local/bin/peregrine-egress-gateway";
const FORWARDER_ENTRYPOINT = "/usr/local/bin/peregrine-methodology-mcp-forwarder";
const GATEWAY_PORT = 8081;
const FORWARDER_PORT = 8082;
const MCP_UPSTREAM_PORT = 8080;
/** The only image allowed to provide the provider, MCP, and reviewer code. */
export const VERIFIER_IMAGE = "node:22.22.1-bookworm-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d";
export const VERIFIER_FIXTURE_SHA256 = "8bcdf28e63df0232d4d30df275e762a65cdd077ebb96c9a859db064261dc4329";
const HEX_DIGEST = /^[a-f0-9]{64}$/u;
const GATEWAY_AUDIT_PROTOCOL = "egress-gateway-audit-v1";
const FORWARDER_AUDIT_PROTOCOL = "methodology-mcp-forwarder-audit-v1";
const CORRELATION_CHALLENGE = /^[a-f0-9]{64}$/u;
const FORWARDER_DENIAL_CODES = new Set([
  "absolute-form-not-supported", "content-encoding-not-supported", "content-type-not-supported", "connect-not-supported", "duplicate-header",
  "expect-not-supported", "forwarder-closed", "header-byte-limit", "host-not-allowed", "method-not-supported", "path-not-allowed",
  "request-byte-limit", "request-deadline", "request-limit", "request-unavailable", "upgrade-not-supported", "upstream-failure",
  "upstream-response-byte-limit", "upstream-redirect", "invalid-request",
]);
const IPV4_CIDR = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d|[12]\d|3[0-2])$/u;

export interface ProbeProcessResult {
  error?: Error;
  status: number | null;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
}

export interface ProbeRuntime {
  spawn(command: string, args: readonly string[], options: Record<string, unknown>): ProbeProcessResult;
}

export interface EgressProbeOptions {
  image: string;
  fixturePath?: string;
  platform?: "linux/amd64" | "linux/arm64";
}

export interface EgressProbeCliOptions {
  image: string;
  platform?: EgressProbeOptions["platform"];
}

export interface EgressProbeNames {
  reviewerNetwork: string;
  externalNetwork: string;
  provider: string;
  mcp: string;
  gateway: string;
  forwarder: string;
  reviewer: string;
}

const systemRuntime: ProbeRuntime = {
  spawn(command, args, options) {
    return spawnSync(command, args, options);
  },
};

function fail(message: string): never { throw new TypeError(message); }

function validateName(value: string, kind: string): void {
  if (!((kind === "network" ? NETWORK : CONTAINER).test(value))) fail(`invalid ${kind} name`);
}

function validatePath(value: string, label: string): void {
  if (!isAbsolute(value) || value.includes(",") || /[\r\n\0]/u.test(value)) fail(`${label} must be an absolute mount-safe path`);
}

function validateImage(image: string, platform?: EgressProbeOptions["platform"]): void {
  if (!IMAGE.test(image) || image.includes("@") && !DIGEST_IMAGE.test(image)) fail("invalid runtime image reference");
  if (platform !== undefined && !DIGEST_IMAGE.test(image)) fail("platform probes require an immutable image digest");
  if (platform !== undefined && platform !== "linux/amd64" && platform !== "linux/arm64") fail("unsupported probe platform");
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseJsonLine(line: string, label: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(line); } catch { fail(`invalid ${label} JSON`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`invalid ${label}`);
  return value as Record<string, unknown>;
}

function exactKeys(value: object, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`invalid ${label} shape`);
}

function nonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(`invalid ${label}`);
}

function isCanonicalIpv4(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => /^(?:0|[1-9]\d{0,2})$/u.test(part) && Number(part) <= 255);
}

interface ParsedFixtureAudit {
  status: "sealed";
  schemaVersion: 1;
  protocol: typeof FIXTURE_PROTOCOL;
  sealed: true;
  role: "provider" | "mcp" | "reviewer";
  audit: Record<string, unknown>;
  sha256: string;
}

/** Runner-owned parser for the fixed fixture protocol. Never import a candidate parser. */
export function parseEgressProbeFixtureAuditLine(line: string, expectedRole: ParsedFixtureAudit["role"]): ParsedFixtureAudit {
  const value = parseJsonLine(line, "fixture audit");
  const baseKeys = ["audit", "protocol", "role", "schemaVersion", "sealed", "sha256", "status"];
  exactKeys(value, baseKeys, "fixture audit");
  if (value.status !== "sealed" || value.schemaVersion !== 1 || value.protocol !== FIXTURE_PROTOCOL || value.sealed !== true || value.role !== expectedRole || typeof value.sha256 !== "string" || !HEX_DIGEST.test(value.sha256)) fail("invalid fixture audit");
  if (!value.audit || typeof value.audit !== "object" || Array.isArray(value.audit)) fail("invalid fixture audit payload");
  const audit = value.audit as Record<string, unknown>;
  const expectedAuditKeys = expectedRole === "provider"
    ? ["acceptedChallenges", "acceptedSni", "connections", "hellos", "mismatchedSni", "sourceAddresses", "unexpectedChallenges"]
    : expectedRole === "mcp" ? ["acceptedChallenges", "requests", "sourceAddresses", "unexpectedChallenges"]
      : ["directMcpFailed", "directMcpIpFailed", "directProviderFailed", "directProviderIpFailed", "gatewayProviderReached", "mcpViaSourceRead", "mismatchedSniDenied", "wrongTokenDenied"];
  exactKeys(audit, expectedAuditKeys, `${expectedRole} fixture audit`);
  if (expectedRole === "provider") {
    if (!Array.isArray(audit.acceptedSni) || audit.acceptedSni.some((entry) => typeof entry !== "string")) fail("invalid provider SNI audit");
    if (!Array.isArray(audit.acceptedChallenges) || audit.acceptedChallenges.some((entry) => typeof entry !== "string" || !CORRELATION_CHALLENGE.test(entry))) fail("invalid provider challenge audit");
    if (!Array.isArray(audit.sourceAddresses) || audit.sourceAddresses.some((entry) => !isCanonicalIpv4(entry))) fail("invalid provider source audit");
    for (const key of ["connections", "hellos", "mismatchedSni", "unexpectedChallenges"] as const) nonNegativeInteger(audit[key], `provider ${key}`);
  } else if (expectedRole === "mcp") {
    if (!Array.isArray(audit.acceptedChallenges) || audit.acceptedChallenges.some((entry) => typeof entry !== "string" || !CORRELATION_CHALLENGE.test(entry))) fail("invalid MCP challenge audit");
    if (!Array.isArray(audit.sourceAddresses) || audit.sourceAddresses.some((entry) => !isCanonicalIpv4(entry))) fail("invalid MCP source audit");
    for (const key of ["requests", "unexpectedChallenges"] as const) nonNegativeInteger(audit[key], `MCP ${key}`);
  }
  else for (const key of expectedAuditKeys) if (typeof audit[key] !== "boolean") fail(`invalid reviewer ${key} audit`);
  const body = { status: "sealed", schemaVersion: 1, protocol: FIXTURE_PROTOCOL, sealed: true, role: expectedRole, audit };
  const expected = sha256(`${FIXTURE_PROTOCOL}\0${JSON.stringify(body)}`);
  if (expected !== value.sha256) fail("fixture audit digest mismatch");
  return Object.freeze({ ...body, sha256: expected }) as ParsedFixtureAudit;
}

interface ParsedGatewayAudit { events: Array<{ seq: number; kind: string; decision: "allow" | "deny"; reason: string; authorityDigest?: string }>; }
export function parseEgressProbeGatewayAudit(value: unknown): ParsedGatewayAudit {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid egress gateway audit");
  const input = value as Record<string, unknown>;
  exactKeys(input, ["events", "protocol", "sealed", "schemaVersion", "sha256"], "egress gateway audit");
  if (input.schemaVersion !== 1 || input.protocol !== GATEWAY_AUDIT_PROTOCOL || input.sealed !== true || !Array.isArray(input.events) || typeof input.sha256 !== "string" || !HEX_DIGEST.test(input.sha256)) fail("invalid egress gateway audit");
  const events = input.events.map((event, index) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) fail("invalid egress gateway audit event");
    const item = event as Record<string, unknown>;
    const hasAuthority = Object.hasOwn(item, "authorityDigest");
    exactKeys(item, hasAuthority ? ["authorityDigest", "decision", "kind", "reason", "seq"] : ["decision", "kind", "reason", "seq"], "egress gateway audit event");
    if (!Number.isSafeInteger(item.seq) || item.seq !== index + 1 || typeof item.kind !== "string" || item.kind.length === 0 || item.kind.length > 32 || /[\x00-\x1f\x7f]/u.test(item.kind) || typeof item.reason !== "string" || item.reason.length === 0 || item.reason.length > 96 || /[\x00-\x1f\x7f]/u.test(item.reason) || (item.decision !== "allow" && item.decision !== "deny") || (hasAuthority && (typeof item.authorityDigest !== "string" || !HEX_DIGEST.test(item.authorityDigest)))) fail("invalid egress gateway audit event");
    return item as ParsedGatewayAudit["events"][number];
  });
  const body = { schemaVersion: 1, protocol: GATEWAY_AUDIT_PROTOCOL, events };
  if (sha256(`${GATEWAY_AUDIT_PROTOCOL}\0${JSON.stringify(body)}`) !== input.sha256) fail("egress gateway audit digest mismatch");
  return { events };
}

interface ParsedForwarderAudit { events: Array<{ sequence: number; decision: "allow" | "deny"; code: string }>; requests: Record<string, number>; }
export function parseEgressProbeForwarderAudit(value: unknown): ParsedForwarderAudit {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid methodology MCP forwarder audit");
  const input = value as Record<string, unknown>;
  exactKeys(input, ["events", "protocol", "requests", "sealed", "schemaVersion", "snapshotSha256"], "forwarder audit");
  if (input.schemaVersion !== 1 || input.protocol !== FORWARDER_AUDIT_PROTOCOL || input.sealed !== true || !Array.isArray(input.events) || !input.requests || typeof input.requests !== "object" || Array.isArray(input.requests) || typeof input.snapshotSha256 !== "string" || !HEX_DIGEST.test(input.snapshotSha256)) fail("invalid methodology MCP forwarder audit");
  const requests = input.requests as Record<string, unknown>;
  exactKeys(requests, ["allowed", "budgeted", "denied", "forwarded", "observed"], "forwarder audit counts");
  for (const key of ["observed", "allowed", "denied", "forwarded", "budgeted"] as const) nonNegativeInteger(requests[key], `forwarder ${key}`);
  if ((requests.allowed as number) + (requests.denied as number) > (requests.observed as number) || (requests.budgeted as number) > (requests.observed as number)) fail("inconsistent forwarder audit counts");
  const events = input.events.map((event, index) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) fail("invalid forwarder audit event");
    const item = event as Record<string, unknown>;
    exactKeys(item, ["code", "decision", "sequence"], "forwarder audit event");
    if (!Number.isSafeInteger(item.sequence) || item.sequence !== index + 1 || (item.decision !== "allow" && item.decision !== "deny") || typeof item.code !== "string" || !(FORWARDER_DENIAL_CODES.has(item.code) || item.code === "forwarded" || item.code === "accepted")) fail("invalid forwarder audit event");
    return item as ParsedForwarderAudit["events"][number];
  });
  const body = { schemaVersion: 1, protocol: FORWARDER_AUDIT_PROTOCOL, sealed: true, requests, events };
  if (sha256(`${FORWARDER_AUDIT_PROTOCOL}\0${JSON.stringify(body)}`) !== input.snapshotSha256) fail("forwarder audit digest mismatch");
  return { requests: requests as ParsedForwarderAudit["requests"], events };
}

export function buildEgressProbeNetworkCreateArgs(name: string, subnet?: string): string[] {
  validateName(name, "network");
  if (subnet !== undefined && subnet !== TEST_SUBNET) fail("unsupported probe subnet");
  return ["network", "create", "--internal", "--ipv6=false", "--driver", "bridge", ...(subnet ? ["--subnet", subnet] : []), name];
}

export function parseEgressProbeNetworkCreateArgs(args: readonly string[]): { name: string; subnet?: string } {
  if (args[0] !== "network" || args[1] !== "create" || args[2] !== "--internal" || args[3] !== "--ipv6=false" || args[4] !== "--driver" || args[5] !== "bridge") fail("invalid network create Docker argv");
  let cursor = 6;
  let subnet: string | undefined;
  if (args[cursor] === "--subnet") {
    if (args[cursor + 1] !== TEST_SUBNET) fail("invalid probe subnet");
    subnet = args[cursor + 1];
    cursor += 2;
  }
  const name = args[cursor];
  if (name === undefined || cursor + 1 !== args.length) fail("invalid network create Docker argv");
  validateName(name, "network");
  return subnet === undefined ? { name } : { name, subnet };
}

export function buildEgressProbeNetworkConnectArgs(network: string, container: string, alias: string): string[] {
  validateName(network, "network");
  validateName(container, "container");
  if (!HOST.test(alias)) fail("invalid network alias");
  return ["network", "connect", "--alias", alias, network, container];
}

export function parseEgressProbeNetworkConnectArgs(args: readonly string[]): { network: string; container: string; alias: string } {
  if (args.length !== 6 || args[0] !== "network" || args[1] !== "connect" || args[2] !== "--alias") fail("invalid network connect Docker argv");
  const alias = args[3];
  const network = args[4];
  const container = args[5];
  if (alias === undefined || network === undefined || container === undefined || !HOST.test(alias)) fail("invalid network connect Docker argv");
  validateName(network, "network");
  validateName(container, "container");
  return { network, container, alias };
}

export function buildEgressProbeNetworkInspectArgs(reviewerNetwork: string, externalNetwork: string): string[];
export function buildEgressProbeNetworkInspectArgs(networks: readonly [string, string]): string[];
export function buildEgressProbeNetworkInspectArgs(networks: Pick<EgressProbeNames, "reviewerNetwork" | "externalNetwork">): string[];
export function buildEgressProbeNetworkInspectArgs(reviewerNetworkOrNetworks: string | readonly [string, string] | Pick<EgressProbeNames, "reviewerNetwork" | "externalNetwork">, externalNetwork?: string): string[] {
  const [reviewerNetwork, external] = typeof reviewerNetworkOrNetworks === "string"
    ? [reviewerNetworkOrNetworks, externalNetwork]
    : Array.isArray(reviewerNetworkOrNetworks)
      ? reviewerNetworkOrNetworks
      : [(reviewerNetworkOrNetworks as Pick<EgressProbeNames, "reviewerNetwork" | "externalNetwork">).reviewerNetwork, (reviewerNetworkOrNetworks as Pick<EgressProbeNames, "reviewerNetwork" | "externalNetwork">).externalNetwork];
  if (Array.isArray(reviewerNetworkOrNetworks) && reviewerNetworkOrNetworks.length !== 2) fail("both probe networks are required");
  if (external === undefined) fail("both probe networks are required");
  validateName(reviewerNetwork, "network");
  validateName(external, "network");
  if (reviewerNetwork === external) fail("probe networks must be distinct");
  return ["network", "inspect", reviewerNetwork, external];
}

interface NetworkInspectEntry {
  Name: string;
  Internal: true;
  Driver: "bridge";
  EnableIPv6: false;
  IPAM: { Config: Array<{ Subnet: string }> };
  Containers: Record<string, { Name: string; EndpointID: string; MacAddress: string; IPv4Address: string; IPv6Address: string }>;
}

function ipv4Number(value: string): number {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(?:0|[1-9]\d{0,2})$/u.test(part) || Number(part) > 255)) fail("invalid IPv4 address");
  return parts.reduce((result, part) => result * 256 + Number(part), 0);
}

function parseIpv4Cidr(value: unknown, label: string): { start: number; end: number; value: string } {
  if (typeof value !== "string") fail(`invalid ${label} subnet`);
  const match = IPV4_CIDR.exec(value);
  if (!match) fail(`invalid ${label} subnet`);
  const address = ipv4Number(match[1]!);
  const prefix = Number(match[2]);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const start = (address & mask) >>> 0;
  const end = (start | (~mask >>> 0)) >>> 0;
  if (`${[(start >>> 24) & 255, (start >>> 16) & 255, (start >>> 8) & 255, start & 255].join(".")}/${prefix}` !== value) fail(`non-canonical ${label} subnet`);
  return { start, end, value };
}

function parseEndpointIpv4(value: unknown, label: string): { address: string; number: number; prefix: number } {
  if (typeof value !== "string") fail(`invalid ${label} IPv4 endpoint`);
  const parts = value.split("/");
  if (parts.length !== 2 || !isCanonicalIpv4(parts[0]) || !/^(?:0|[1-9]\d{0,2})$/u.test(parts[1]!) || Number(parts[1]) > 32) fail(`invalid ${label} IPv4 endpoint`);
  return { address: parts[0], number: ipv4Number(parts[0]), prefix: Number(parts[1]) };
}

export interface EgressProbeExternalEndpointIps {
  gateway: string;
  forwarder: string;
}

export function assertEgressProbeSourceWitness(value: unknown, expected: string, label: string): void {
  if (!isCanonicalIpv4(expected) || !Array.isArray(value) || value.length !== 1 || value[0] !== expected) fail(`${label} source endpoint is not the pinned sidecar`);
}

/** Validate Docker's topology response independently of any image or sidecar code. */
export function parseEgressProbeNetworkInspect(value: unknown, names: EgressProbeNames): EgressProbeExternalEndpointIps {
  if (!Array.isArray(value) || value.length !== 2) fail("network inspect returned an unexpected shape");
  const byName = new Map<string, NetworkInspectEntry>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("invalid network inspect entry");
    const network = entry as Record<string, unknown>;
    if (typeof network.Name !== "string" || byName.has(network.Name) || network.Internal !== true || network.Driver !== "bridge" || network.EnableIPv6 !== false || !network.IPAM || typeof network.IPAM !== "object" || Array.isArray(network.IPAM) || !Array.isArray((network.IPAM as { Config?: unknown }).Config) || (network.IPAM as { Config: unknown[] }).Config.length !== 1 || !network.Containers || typeof network.Containers !== "object" || Array.isArray(network.Containers)) fail("invalid network topology");
    const ipam = network.IPAM as { Config: unknown[] };
    const config = ipam.Config[0];
    if (!config || typeof config !== "object" || Array.isArray(config) || Object.keys(config).some((key) => /ipv6/iu.test(key))) fail("invalid IPv6 IPAM configuration");
    parseIpv4Cidr((config as { Subnet?: unknown }).Subnet, `${network.Name} network`);
    byName.set(network.Name, network as unknown as NetworkInspectEntry);
  }
  const expected = [
    { name: names.reviewerNetwork, members: new Map([[names.gateway, undefined], [names.forwarder, undefined], [names.reviewer, undefined]]) },
    { name: names.externalNetwork, members: new Map([[names.provider, PROVIDER_IP], [names.mcp, MCP_IP], [names.gateway, undefined], [names.forwarder, undefined]]) },
  ];
  let gatewayExternalIp: string | undefined;
  let forwarderExternalIp: string | undefined;
  for (const { name, members } of expected) {
    const network = byName.get(name);
    if (!network) fail("network inspect omitted a probe network");
    const entries = Object.values(network.Containers);
    if (entries.length !== members.size) {
      const actualNames = entries.map((entry) => entry?.Name).filter((entry): entry is string => typeof entry === "string").sort();
      fail(`network membership is not exact for ${name}: ${actualNames.join(",") || "none"}`);
    }
    const seen = new Set<string>();
    const seenIpv4 = new Set<string>();
    const networkSubnet = parseIpv4Cidr(network.IPAM.Config[0]?.Subnet, `${name} network`);
    const networkPrefix = Number(networkSubnet.value.slice(networkSubnet.value.lastIndexOf("/") + 1));
    for (const container of entries) {
      if (!container || typeof container !== "object" || Array.isArray(container) || typeof container.Name !== "string" || seen.has(container.Name) || !members.has(container.Name) || typeof container.EndpointID !== "string" || !container.EndpointID || typeof container.MacAddress !== "string" || !container.MacAddress || typeof container.IPv4Address !== "string" || container.IPv6Address !== "") fail("invalid network endpoint");
      const endpoint = parseEndpointIpv4(container.IPv4Address, `${name} ${container.Name}`);
      if (endpoint.prefix !== networkPrefix || endpoint.number < networkSubnet.start || endpoint.number > networkSubnet.end) fail("network endpoint IPv4 is outside its network");
      if (seenIpv4.has(endpoint.address)) fail("network endpoint IPv4 addresses are not unique");
      seenIpv4.add(endpoint.address);
      const expectedIp = members.get(container.Name);
      if (expectedIp !== undefined && container.IPv4Address !== `${expectedIp}/24`) fail("fixed fixture IPv4 assignment is not proven");
      if (name === names.externalNetwork && container.Name === names.gateway) gatewayExternalIp = endpoint.address;
      if (name === names.externalNetwork && container.Name === names.forwarder) forwarderExternalIp = endpoint.address;
      seen.add(container.Name);
    }
    if (seen.size !== members.size) fail("network membership is not exact");
  }
  const reviewer = byName.get(names.reviewerNetwork)!;
  const external = byName.get(names.externalNetwork)!;
  const reviewerSubnet = parseIpv4Cidr(reviewer.IPAM.Config[0]?.Subnet, "reviewer network");
  const externalSubnet = parseIpv4Cidr(external.IPAM.Config[0]?.Subnet, "external network");
  if (externalSubnet.value !== `${TEST_SUBNET}` || reviewerSubnet.start <= externalSubnet.end && externalSubnet.start <= reviewerSubnet.end) fail("probe network subnets overlap or external subnet is not exact");
  if (gatewayExternalIp === undefined || forwarderExternalIp === undefined || gatewayExternalIp === forwarderExternalIp) fail("external sidecar source endpoints are not exact and distinct");
  return { gateway: gatewayExternalIp, forwarder: forwarderExternalIp };
}

export function buildEgressProbeNetworkAliasInspectArgs(names: EgressProbeNames): string[] {
  const containers = [names.provider, names.mcp, names.gateway, names.forwarder, names.reviewer];
  return buildEgressProbeInspectArgs(containers);
}

/** Docker exposes endpoint aliases through container inspect's network records. */
export function parseEgressProbeNetworkAliases(value: unknown, names: EgressProbeNames): void {
  if (!Array.isArray(value) || value.length !== 5) fail("container inspect returned an unexpected alias shape");
  const expected = new Map([
    [names.provider, new Map([[names.externalNetwork, [PROVIDER_ALIAS]]])],
    [names.mcp, new Map([[names.externalNetwork, [MCP_ALIAS, "host.docker.internal"]]])],
    [names.gateway, new Map([[names.externalNetwork, [GATEWAY_ALIAS]], [names.reviewerNetwork, [GATEWAY_ALIAS]]])],
    [names.forwarder, new Map([[names.externalNetwork, [FORWARDER_ALIAS]], [names.reviewerNetwork, [FORWARDER_ALIAS]]])],
    [names.reviewer, new Map([[names.reviewerNetwork, ["reviewer"]]])],
  ]);
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof (entry as { Name?: unknown }).Name !== "string") fail("invalid container alias record");
    const container = entry as { Name: string; NetworkSettings?: { Networks?: unknown } };
    const name = container.Name.replace(/^\//u, "");
    const networks = expected.get(name);
    if (seen.has(name)) fail("duplicate probe endpoint");
    seen.add(name);
    if (!networks || !container.NetworkSettings || typeof container.NetworkSettings.Networks !== "object" || !container.NetworkSettings.Networks || Array.isArray(container.NetworkSettings.Networks)) fail("unexpected probe endpoint");
    const actualNetworks = container.NetworkSettings.Networks as Record<string, unknown>;
    if (Object.keys(actualNetworks).length !== networks.size) fail("probe endpoint network membership is not exact");
    for (const [networkName, aliases] of networks) {
      const record = actualNetworks[networkName];
      if (!record || typeof record !== "object" || Array.isArray(record) || !Array.isArray((record as { Aliases?: unknown }).Aliases)) fail("probe endpoint aliases are missing");
      const actual = (record as { Aliases: unknown[] }).Aliases;
      if (actual.length !== aliases.length || actual.some((alias) => typeof alias !== "string") || new Set(actual as string[]).size !== actual.length || aliases.some((alias) => !actual.includes(alias))) fail(`probe endpoint aliases are not exact for ${name} on ${networkName}: ${JSON.stringify(actual)}`);
    }
  }
  if (seen.size !== expected.size) fail("probe endpoint aliases are incomplete");
}

interface ContainerRunSpec {
  role: "provider" | "mcp" | "gateway" | "forwarder" | "reviewer";
  image: string;
  name: string;
  network: string;
  alias: string;
  fixturePath?: string;
  token?: string;
  challenge?: string;
  challenges?: EgressProbeChallenges;
  platform?: EgressProbeOptions["platform"];
}

export interface EgressProbeChallenges {
  allowedProvider: string;
  deniedProvider: string;
  allowedMcp: string;
  deniedMcp: string;
}

function validateChallenge(value: unknown, label: string): string {
  if (typeof value !== "string" || !CORRELATION_CHALLENGE.test(value)) fail(`${label} must be a 32-byte hexadecimal challenge`);
  return value;
}

function validateChallenges(value: EgressProbeChallenges): EgressProbeChallenges {
  const challenges = {
    allowedProvider: validateChallenge(value?.allowedProvider, "allowed provider challenge"),
    deniedProvider: validateChallenge(value?.deniedProvider, "denied provider challenge"),
    allowedMcp: validateChallenge(value?.allowedMcp, "allowed MCP challenge"),
    deniedMcp: validateChallenge(value?.deniedMcp, "denied MCP challenge"),
  };
  if (new Set(Object.values(challenges)).size !== 4) fail("probe correlation challenges must be distinct");
  return challenges;
}

export function buildEgressProbeContainerArgs(spec: ContainerRunSpec): string[] {
  validateName(spec.name, "container");
  validateName(spec.network, "network");
  validateImage(spec.image, spec.platform);
  if ((spec.role === "provider" || spec.role === "mcp" || spec.role === "reviewer") && spec.image !== VERIFIER_IMAGE) fail("fixture containers must use the immutable verifier image");
  if (!HOST.test(spec.alias)) fail("invalid container network alias");
  if (spec.fixturePath !== undefined) validatePath(spec.fixturePath, "fixture");
  if ((spec.role === "provider" || spec.role === "mcp" || spec.role === "reviewer") && spec.fixturePath === undefined) fail("fixture helper is required");
  if ((spec.role === "mcp" || spec.role === "forwarder" || spec.role === "reviewer") && (!spec.token || !/^[a-f0-9]{64}$/u.test(spec.token))) fail("source-read token is required");
  if ((spec.role === "provider" || spec.role === "mcp") && spec.challenge === undefined) fail("fixture correlation challenge is required");
  if (spec.challenge !== undefined) validateChallenge(spec.challenge, "fixture correlation challenge");
  if (spec.role === "reviewer" && spec.challenges === undefined) fail("reviewer correlation challenges are required");
  if (spec.role !== "reviewer" && spec.challenges !== undefined) fail("reviewer correlation challenges are not valid for this role");
  if (spec.role === "reviewer" && spec.challenge !== undefined) fail("fixture correlation challenge is not valid for reviewer");
  if ((spec.role === "gateway" || spec.role === "forwarder") && spec.challenge !== undefined) fail("fixture correlation challenge is not valid for sidecars");
  const challenges = spec.challenges === undefined ? undefined : validateChallenges(spec.challenges);
  const platformArgs = spec.platform ? ["--platform", spec.platform, "--pull", "always"] : [];
  const args = [
    "run", "--detach", "--name", spec.name, ...platformArgs,
    "--network", spec.network, "--network-alias", spec.alias,
    "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--pids-limit", spec.role === "reviewer" ? "64" : "128",
    "--user", spec.role === "provider" ? "0:0" : "1000:1000",
  ];
  if (spec.role === "provider") args.push("--ip", PROVIDER_IP, "--cap-add", "NET_BIND_SERVICE");
  if (spec.role === "mcp") args.push("--ip", MCP_IP, "--network-alias", "host.docker.internal");
  const env = spec.role === "gateway"
    ? [`EGRESS_ALLOWED_AUTHORITIES=${PROVIDER_ALIAS}:443`, "EGRESS_BIND_HOST=0.0.0.0", `EGRESS_BIND_PORT=${GATEWAY_PORT}`, "EGRESS_MAX_CONNECTIONS=4", "EGRESS_MAX_REQUESTS=8", "EGRESS_MAX_HEADER_BYTES=8192", "EGRESS_MAX_TUNNEL_BYTES=1048576", "EGRESS_DEADLINE_MS=3000", "EGRESS_MAX_CLIENT_HELLO_BYTES=16384"]
    : spec.role === "forwarder"
      ? ["MCP_FORWARDER_BIND_HOST=0.0.0.0", `MCP_FORWARDER_BIND_PORT=${FORWARDER_PORT}`, `MCP_FORWARDER_ALLOWED_HOST=${FORWARDER_ALIAS}:${FORWARDER_PORT}`, `MCP_FORWARDER_TOKEN=${spec.token}`, `MCP_FORWARDER_UPSTREAM_PORT=${MCP_UPSTREAM_PORT}`, "MCP_FORWARDER_MAX_REQUEST_BYTES=8192", "MCP_FORWARDER_MAX_RESPONSE_BYTES=8192", "MCP_FORWARDER_MAX_HEADER_BYTES=8192", "MCP_FORWARDER_REQUEST_TIMEOUT_MS=3000", "MCP_FORWARDER_MAX_CONNECTIONS=4", "MCP_FORWARDER_MAX_REQUESTS=8"]
      : [];
  for (const value of env) args.push("--env", value);
  if (spec.fixturePath !== undefined) args.push("--mount", `type=bind,source=${spec.fixturePath},target=/probe-fixture.mjs,readonly`);
  if (spec.role === "gateway") args.push("--entrypoint", GATEWAY_ENTRYPOINT);
  else if (spec.role === "forwarder") args.push("--entrypoint", FORWARDER_ENTRYPOINT);
  args.push(spec.image);
  if (spec.role === "provider") args.push("node", "/probe-fixture.mjs", "--provider", "--host", "0.0.0.0", "--port", "443", "--expected-sni", PROVIDER_ALIAS, "--expected-challenge", spec.challenge!);
  else if (spec.role === "mcp") args.push("node", "/probe-fixture.mjs", "--mcp", "--host", "0.0.0.0", "--port", String(MCP_UPSTREAM_PORT), "--token", spec.token!, "--expected-challenge", spec.challenge!);
  else if (spec.role === "reviewer") args.push("node", "/probe-fixture.mjs", "--reviewer", "--gateway", `${GATEWAY_ALIAS}:${GATEWAY_PORT}`, "--forwarder", `${FORWARDER_ALIAS}:${FORWARDER_PORT}`, "--token", spec.token!, "--provider", PROVIDER_ALIAS, "--mcp", MCP_ALIAS,
    "--allowed-provider-challenge", challenges!.allowedProvider, "--denied-provider-challenge", challenges!.deniedProvider,
    "--allowed-mcp-challenge", challenges!.allowedMcp, "--denied-mcp-challenge", challenges!.deniedMcp);
  return args;
}

export function parseEgressProbeContainerArgs(args: readonly string[]): { name: string; network: string; alias: string; image: string; role: ContainerRunSpec["role"]; platform?: EgressProbeOptions["platform"] } {
  let cursor = 0;
  const take = (expected?: string): string => {
    const value = args[cursor++];
    if (value === undefined || expected !== undefined && value !== expected) fail("invalid container run Docker argv");
    return value;
  };
  take("run"); take("--detach"); take("--name");
  const name = take(); validateName(name, "container");
  let platform: EgressProbeOptions["platform"];
  if (args[cursor] === "--platform") {
    take("--platform");
    const value = take();
    if (value !== "linux/amd64" && value !== "linux/arm64") fail("unsupported probe platform");
    platform = value;
    take("--pull"); take("always");
  }
  take("--network");
  const network = take(); validateName(network, "network");
  if (["bridge", "host", "none"].includes(network)) fail("probe containers must use a named isolated network");
  take("--network-alias");
  const alias = take(); if (!HOST.test(alias)) fail("invalid container network alias");
  take("--read-only"); take("--cap-drop"); take("ALL"); take("--security-opt"); take("no-new-privileges");
  take("--pids-limit"); const pids = take(); if (pids !== "64" && pids !== "128") fail("invalid probe pid bound");
  take("--user"); const user = take(); if (user !== "1000:1000" && user !== "0:0") fail("invalid probe user");
  let ip: string | undefined;
  let secondAlias: string | undefined;
  let capAdd = false;
  if (args[cursor] === "--ip") { take("--ip"); ip = take(); if (!IPV4.test(ip)) fail("invalid fixture IP"); }
  if (args[cursor] === "--cap-add") { take("--cap-add"); if (take() !== "NET_BIND_SERVICE") fail("invalid fixture capability"); capAdd = true; }
  if (args[cursor] === "--network-alias") { take("--network-alias"); secondAlias = take(); if (secondAlias !== "host.docker.internal") fail("invalid upstream alias"); }
  const env: string[] = [];
  while (args[cursor] === "--env") { take("--env"); env.push(take()); }
  let fixtureMount: string | undefined;
  if (args[cursor] === "--mount") {
    take("--mount");
    const value = take();
    const fields = value.split(",");
    if (fields.length !== 4 || fields[0] !== "type=bind" || !fields[1]?.startsWith("source=") || fields[2] !== "target=/probe-fixture.mjs" || fields[3] !== "readonly") fail("invalid fixture mount");
    fixtureMount = fields[1].slice("source=".length); validatePath(fixtureMount, "fixture");
  }
  let entrypoint: string | undefined;
  if (args[cursor] === "--entrypoint") { take("--entrypoint"); entrypoint = take(); }
  const image = take(); validateImage(image, platform);
  let role: ContainerRunSpec["role"];
  if (entrypoint !== undefined) {
    role = entrypoint === GATEWAY_ENTRYPOINT ? "gateway" : entrypoint === FORWARDER_ENTRYPOINT ? "forwarder" : fail("invalid sidecar entrypoint");
    if (cursor !== args.length) fail("sidecar entrypoint must not receive command arguments");
    if (role === "gateway" && entrypoint !== GATEWAY_ENTRYPOINT || role === "forwarder" && entrypoint !== FORWARDER_ENTRYPOINT) fail("invalid sidecar entrypoint");
    // Sidecars are intentionally commandless: Docker must execute this exact
    // absolute path, independent of image metadata or PATH lookup.
  } else {
    const command = take();
    role = (() => {
      if (command !== "node" || take() !== "/probe-fixture.mjs") fail("invalid fixture command");
      const mode = take();
      if (mode === "--provider") { take("--host"); take("0.0.0.0"); take("--port"); if (take() !== "443") fail("invalid provider port"); take("--expected-sni"); if (take() !== PROVIDER_ALIAS) fail("invalid provider SNI"); take("--expected-challenge"); validateChallenge(take(), "provider challenge"); return "provider"; }
      if (mode === "--mcp") { take("--host"); take("0.0.0.0"); take("--port"); if (take() !== String(MCP_UPSTREAM_PORT)) fail("invalid MCP port"); take("--token"); if (!CORRELATION_CHALLENGE.test(take())) fail("invalid MCP token"); take("--expected-challenge"); validateChallenge(take(), "MCP challenge"); return "mcp"; }
      if (mode === "--reviewer") {
        take("--gateway"); if (take() !== `${GATEWAY_ALIAS}:${GATEWAY_PORT}`) fail("invalid reviewer gateway");
        take("--forwarder"); if (take() !== `${FORWARDER_ALIAS}:${FORWARDER_PORT}`) fail("invalid reviewer forwarder");
        take("--token"); if (!CORRELATION_CHALLENGE.test(take())) fail("invalid reviewer token");
        take("--provider"); if (take() !== PROVIDER_ALIAS) fail("invalid reviewer provider");
        take("--mcp"); if (take() !== MCP_ALIAS) fail("invalid reviewer MCP");
        const challenges = ["allowed-provider", "denied-provider", "allowed-mcp", "denied-mcp"].map((label) => {
          take(`--${label}-challenge`);
          return validateChallenge(take(), `${label} challenge`);
        });
        if (new Set(challenges).size !== challenges.length) fail("reviewer correlation challenges must be distinct");
        return "reviewer";
      }
      return fail("unknown fixture mode");
    })();
  }
  if (cursor !== args.length) fail("unexpected trailing container arguments");
  const expectedAlias = role === "provider" ? PROVIDER_ALIAS : role === "mcp" ? MCP_ALIAS : role === "gateway" ? GATEWAY_ALIAS : role === "forwarder" ? FORWARDER_ALIAS : "reviewer";
  const expectedPids = role === "reviewer" ? "64" : "128";
  if (alias !== expectedAlias || pids !== expectedPids) fail("invalid role-specific container policy");
  if (role === "provider" && (user !== "0:0" || ip !== PROVIDER_IP || !capAdd || fixtureMount === undefined || env.length !== 0)) fail("invalid provider container policy");
  if (role === "mcp" && (user !== "1000:1000" || ip !== MCP_IP || secondAlias !== "host.docker.internal" || fixtureMount === undefined || env.length !== 0)) fail("invalid MCP fixture policy");
  if (role === "reviewer" && (user !== "1000:1000" || fixtureMount === undefined || env.length !== 0)) fail("invalid reviewer container policy");
  if ((role === "provider" || role === "mcp" || role === "reviewer") && image !== VERIFIER_IMAGE) fail("fixture containers must use the immutable verifier image");
  if ((role === "gateway" || role === "forwarder") && (user !== "1000:1000" || fixtureMount !== undefined || ip !== undefined || capAdd || secondAlias !== undefined)) fail("invalid sidecar container policy");
  const gatewayEnv = [`EGRESS_ALLOWED_AUTHORITIES=${PROVIDER_ALIAS}:443`, "EGRESS_BIND_HOST=0.0.0.0", `EGRESS_BIND_PORT=${GATEWAY_PORT}`, "EGRESS_MAX_CONNECTIONS=4", "EGRESS_MAX_REQUESTS=8", "EGRESS_MAX_HEADER_BYTES=8192", "EGRESS_MAX_TUNNEL_BYTES=1048576", "EGRESS_DEADLINE_MS=3000", "EGRESS_MAX_CLIENT_HELLO_BYTES=16384"];
  if (role === "gateway" && JSON.stringify(env) !== JSON.stringify(gatewayEnv)) fail("invalid gateway environment");
  if (role === "forwarder") {
    const tokenEntry = env[3] ?? "";
    if (!/^MCP_FORWARDER_TOKEN=[a-f0-9]{64}$/u.test(tokenEntry)) fail("invalid forwarder capability token");
    const forwarderEnv = ["MCP_FORWARDER_BIND_HOST=0.0.0.0", `MCP_FORWARDER_BIND_PORT=${FORWARDER_PORT}`, `MCP_FORWARDER_ALLOWED_HOST=${FORWARDER_ALIAS}:${FORWARDER_PORT}`, tokenEntry, `MCP_FORWARDER_UPSTREAM_PORT=${MCP_UPSTREAM_PORT}`, "MCP_FORWARDER_MAX_REQUEST_BYTES=8192", "MCP_FORWARDER_MAX_RESPONSE_BYTES=8192", "MCP_FORWARDER_MAX_HEADER_BYTES=8192", "MCP_FORWARDER_REQUEST_TIMEOUT_MS=3000", "MCP_FORWARDER_MAX_CONNECTIONS=4", "MCP_FORWARDER_MAX_REQUESTS=8"];
    if (JSON.stringify(env) !== JSON.stringify(forwarderEnv)) fail("invalid forwarder environment");
  }
  if ((role === "provider" || role === "mcp" || role === "reviewer") && env.length !== 0) fail("fixture containers cannot receive environment values");
  return platform === undefined ? { name, network, alias, image, role } : { name, network, alias, image, role, platform };
}

export function buildEgressProbeInspectArgs(names: readonly string[]): string[] {
  if (names.length === 0 || names.some((name) => { validateName(name, "container"); return false; })) fail("invalid inspect targets");
  return ["container", "inspect", ...names];
}

export function parseEgressProbeContainerInspect(value: unknown, names: readonly string[]): void {
  if (!Array.isArray(value) || value.length !== names.length) fail("container inspect returned an unexpected shape");
  const secret = /^(?:ANTHROPIC_API_KEY|OPENAI_API_KEY|CODEX_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|AWS_SECURITY_TOKEN|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_API_KEY|GEMINI_API_KEY|VERTEXAI_API_KEY|HF_TOKEN|HF_API_TOKEN|HUGGINGFACEHUB_API_KEY|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|COHERE_API_KEY|MISTRAL_API_KEY|TOGETHER_API_KEY|PERPLEXITY_API_KEY|XAI_API_KEY|AZURE_OPENAI_API_KEY|.*(?:PASSWORD|CREDENTIAL|SECRET))=/iu;
  const expectedEntrypoints = names.map((_name, index) => index === 0 ? GATEWAY_ENTRYPOINT : index === 1 ? FORWARDER_ENTRYPOINT : fail("unexpected sidecar inspect target"));
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== "object" || !Array.isArray((entry as { Mounts?: unknown }).Mounts) || (entry as { Mounts: unknown[] }).Mounts.length !== 0) fail("sidecar has a mount");
    if ((entry as { Name?: unknown }).Name !== `/${names[index]}`) fail("container inspect returned the wrong sidecar");
    const inspect = entry as { Path?: unknown; Args?: unknown; Config?: { Env?: unknown; Entrypoint?: unknown } };
    const expectedEntrypoint = expectedEntrypoints[index]!;
    if (inspect.Path !== expectedEntrypoint || !Array.isArray(inspect.Args) || inspect.Args.length !== 0 || JSON.stringify(inspect.Config?.Entrypoint) !== JSON.stringify([expectedEntrypoint])) fail("sidecar effective entrypoint is not pinned");
    const env = inspect.Config?.Env;
    if (!Array.isArray(env) || env.some((item) => typeof item !== "string" || secret.test(item))) fail("sidecar has credential environment");
  }
}

export function buildEgressProbeStopArgs(names: readonly string[]): string[] {
  if (names.length === 0 || names.some((name) => { validateName(name, "container"); return false; })) fail("invalid stop targets");
  return ["stop", "--time", "5", ...names];
}
export function buildEgressProbeRemoveArgs(names: readonly string[]): string[] {
  if (names.length === 0 || names.some((name) => { validateName(name, "container"); return false; })) fail("invalid remove targets");
  return ["rm", "--force", ...names];
}
export function buildEgressProbeNetworkRemoveArgs(name: string): string[] { validateName(name, "network"); return ["network", "rm", name]; }
export function buildEgressProbeAbsenceArgs(kind: "container" | "network", name: string): string[] { validateName(name, kind); return [kind, "inspect", name]; }
export function buildEgressProbeImageRemoveArgs(image: string, platform: NonNullable<EgressProbeOptions["platform"]>): string[] {
  validateImage(image, platform);
  return ["image", "rm", "--force", image];
}
export function buildEgressProbeImageAbsenceArgs(image: string): string[] {
  if (!DIGEST_IMAGE.test(image)) fail("image absence checks require an immutable image digest");
  return ["image", "inspect", image];
}

export function parseEgressProbeCliArgs(args: readonly string[]): EgressProbeCliOptions {
  let image: string | undefined;
  let platform: EgressProbeOptions["platform"];
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (value === undefined) fail(`${name ?? "argument"} requires a value`);
    if (name === "--image" && image === undefined) image = value;
    else if (name === "--platform" && platform === undefined && (value === "linux/amd64" || value === "linux/arm64")) platform = value;
    else fail(`unsupported or repeated argument: ${name ?? "unknown"}`);
  }
  if (image === undefined) fail("--image is required");
  validateImage(image, platform);
  return platform === undefined ? { image } : { image, platform };
}

function output(result: ProbeProcessResult, field: "stdout" | "stderr"): string {
  const value = result[field];
  return typeof value === "string" ? value : value?.toString("utf8") ?? "";
}

/** Reparse every topology-mutating argv immediately before it can reach Docker. */
export function validateEgressProbeDockerArgs(args: readonly string[]): void {
  if (args[0] === "network" && args[1] === "create") parseEgressProbeNetworkCreateArgs(args);
  else if (args[0] === "network" && args[1] === "connect") parseEgressProbeNetworkConnectArgs(args);
  else if (args[0] === "run") parseEgressProbeContainerArgs(args);
}

function invoke(runtime: ProbeRuntime, args: readonly string[], label: string): ProbeProcessResult {
  validateEgressProbeDockerArgs(args);
  const result = runtime.spawn("docker", args, { encoding: "utf8" });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label}: Docker exited with status ${result.status ?? "unknown"}: ${output(result, "stderr").slice(0, 300)}`);
  return result;
}
function sleepBriefly(): void { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40); }
function waitReady(runtime: ProbeRuntime, name: string, protocol: string): void {
  let lastOutput = "";
  for (let attempt = 0; attempt < 125; attempt += 1) {
    const result = runtime.spawn("docker", ["logs", name], { encoding: "utf8" });
    lastOutput = `${output(result, "stdout")}\n${output(result, "stderr")}`.trim().slice(-500);
    if (result.status === 0 && output(result, "stdout").split(/\r?\n/u).some((line) => { try { const value = JSON.parse(line); return value?.status === "ready" && value?.protocol === protocol; } catch { return false; } })) return;
    sleepBriefly();
  }
  throw new Error(`${name} did not become ready within the bounded startup window${lastOutput ? `: ${lastOutput}` : ""}`);
}
function sealedLog(runtime: ProbeRuntime, name: string, protocol: string): unknown {
  const result = invoke(runtime, ["logs", name], `read ${name} logs`);
  const lines = output(result, "stdout").trim().split(/\r?\n/u).reverse();
  const line = lines.find((candidate) => { try { const value = JSON.parse(candidate); return value?.status === "sealed" && value?.protocol === protocol; } catch { return false; } });
  if (!line) throw new Error(`${name} did not emit a sealed audit line`);
  return JSON.parse(line);
}
function waitSealed(runtime: ProbeRuntime, name: string, protocol: string): unknown {
  let lastOutput = "";
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const result = runtime.spawn("docker", ["logs", name], { encoding: "utf8" });
    lastOutput = `${output(result, "stdout")}\n${output(result, "stderr")}`.trim().slice(-500);
    if (result.status === 0) {
      const lines = output(result, "stdout").trim().split(/\r?\n/u).reverse();
      const line = lines.find((candidate) => {
        try {
          const value = JSON.parse(candidate);
          return value?.status === "sealed" && value?.protocol === protocol;
        } catch {
          return false;
        }
      });
      if (line) return JSON.parse(line);
    }
    sleepBriefly();
  }
  throw new Error(`${name} did not emit a sealed result within the bounded execution window${lastOutput ? `: ${lastOutput}` : ""}`);
}
function assertAbsent(runtime: ProbeRuntime, kind: "container" | "network", name: string): void {
  const result = runtime.spawn("docker", buildEgressProbeAbsenceArgs(kind, name), { encoding: "utf8" });
  const errorText = output(result, "stderr");
  const absent = /No such (?:object|container|network)/iu.test(errorText) ||
    (kind === "network" && errorText.includes(`network ${name} not found`));
  if (result.error || result.status === 0 || result.status !== 1 || !absent) throw new Error(`${kind} ${name} remains or absence could not be proven`);
}
function assertImageAbsent(runtime: ProbeRuntime, image: string): void {
  const result = runtime.spawn("docker", buildEgressProbeImageAbsenceArgs(image), { encoding: "utf8" });
  const errorText = output(result, "stderr");
  if (result.error || result.status === 0 || result.status !== 1 || !/No such (?:object|image)/iu.test(errorText)) throw new Error("probe image remains or absence could not be proven");
}

export function runEgressProbe(image: string, platform?: EgressProbeOptions["platform"], runtime: ProbeRuntime = systemRuntime, fixturePath = resolve(fileURLToPath(new URL("./eval-egress-probe-fixture.mjs", import.meta.url)))): void {
  validateImage(image, platform);
  validatePath(fixturePath, "fixture");
  if (!existsSync(fixturePath)) throw new Error("fixture helper does not exist");
  const canonicalFixture = resolve(fileURLToPath(new URL("./eval-egress-probe-fixture.mjs", import.meta.url)));
  const fixtureStat = lstatSync(fixturePath);
  if (fixtureStat.isSymbolicLink() || !fixtureStat.isFile() || realpathSync(fixturePath) !== realpathSync(canonicalFixture)) throw new Error("fixture helper must be the canonical regular file");
  if (sha256(readFileSync(fixturePath)) !== VERIFIER_FIXTURE_SHA256) throw new Error("fixture helper does not match the reviewed verifier bytes");
  const suffix = randomUUID().replaceAll("-", "");
  const names: EgressProbeNames = {
    reviewerNetwork: `peregrine-reviewer-${suffix}`,
    externalNetwork: `peregrine-external-${suffix}`,
    provider: `peregrine-fake-provider-${suffix}`,
    mcp: `peregrine-fake-mcp-${suffix}`,
    gateway: `peregrine-egress-gateway-${suffix}`,
    forwarder: `peregrine-mcp-forwarder-${suffix}`,
    reviewer: `peregrine-egress-reviewer-${suffix}`,
  };
  const token = randomBytes(32).toString("hex");
  const challengeValues = randomBytes(32 * 4).toString("hex");
  const challenges: EgressProbeChallenges = {
    allowedProvider: challengeValues.slice(0, 64),
    deniedProvider: challengeValues.slice(64, 128),
    allowedMcp: challengeValues.slice(128, 192),
    deniedMcp: challengeValues.slice(192, 256),
  };
  const started: string[] = [];
  const networks: string[] = [];
  let primaryError: unknown;
  try {
    invoke(runtime, buildEgressProbeNetworkCreateArgs(names.reviewerNetwork), "create reviewer network"); networks.push(names.reviewerNetwork);
    invoke(runtime, buildEgressProbeNetworkCreateArgs(names.externalNetwork, TEST_SUBNET), "create external network"); networks.push(names.externalNetwork);
    const candidate = { image, platform };
    const verifier = { image: VERIFIER_IMAGE, platform };
    invoke(runtime, buildEgressProbeContainerArgs({ ...verifier, role: "provider", name: names.provider, network: names.externalNetwork, alias: PROVIDER_ALIAS, fixturePath, challenge: challenges.allowedProvider }), "start fake provider"); started.push(names.provider);
    invoke(runtime, buildEgressProbeContainerArgs({ ...verifier, role: "mcp", name: names.mcp, network: names.externalNetwork, alias: MCP_ALIAS, fixturePath, token, challenge: challenges.allowedMcp }), "start fake MCP"); started.push(names.mcp);
    invoke(runtime, buildEgressProbeContainerArgs({ ...candidate, role: "gateway", name: names.gateway, network: names.externalNetwork, alias: GATEWAY_ALIAS }), "start egress gateway"); started.push(names.gateway);
    invoke(runtime, buildEgressProbeContainerArgs({ ...candidate, role: "forwarder", name: names.forwarder, network: names.externalNetwork, alias: FORWARDER_ALIAS, token }), "start MCP forwarder"); started.push(names.forwarder);
    invoke(runtime, buildEgressProbeNetworkConnectArgs(names.reviewerNetwork, names.gateway, GATEWAY_ALIAS), "attach gateway to reviewer network");
    invoke(runtime, buildEgressProbeNetworkConnectArgs(names.reviewerNetwork, names.forwarder, FORWARDER_ALIAS), "attach forwarder to reviewer network");
    waitReady(runtime, names.provider, FIXTURE_PROTOCOL); waitReady(runtime, names.mcp, FIXTURE_PROTOCOL); waitReady(runtime, names.gateway, GATEWAY_PROTOCOL); waitReady(runtime, names.forwarder, FORWARDER_PROTOCOL);
    const inspect = invoke(runtime, buildEgressProbeInspectArgs([names.gateway, names.forwarder]), "inspect sidecars");
    parseEgressProbeContainerInspect(JSON.parse(output(inspect, "stdout")), [names.gateway, names.forwarder]);
    invoke(runtime, buildEgressProbeContainerArgs({ ...verifier, role: "reviewer", name: names.reviewer, network: names.reviewerNetwork, alias: "reviewer", fixturePath, token, challenges }), "run reviewer"); started.push(names.reviewer);
    const reviewerLogs = waitSealed(runtime, names.reviewer, FIXTURE_PROTOCOL);
    const topology = invoke(runtime, buildEgressProbeNetworkInspectArgs(names.reviewerNetwork, names.externalNetwork), "inspect probe networks");
    const externalEndpointIps = parseEgressProbeNetworkInspect(JSON.parse(output(topology, "stdout")), names);
    const aliases = invoke(runtime, buildEgressProbeNetworkAliasInspectArgs(names), "inspect probe endpoint aliases");
    parseEgressProbeNetworkAliases(JSON.parse(output(aliases, "stdout")), names);
    invoke(runtime, buildEgressProbeStopArgs([names.reviewer]), "stop reviewer");
    if (!reviewerLogs || typeof reviewerLogs !== "object") throw new Error("reviewer result is missing");
    const reviewerAudit = parseEgressProbeFixtureAuditLine(JSON.stringify(reviewerLogs), "reviewer");
    // direct* fields are bounded connectivity diagnostics and deliberately do
    // not participate in the policy decision.
    if (reviewerAudit.audit.mcpViaSourceRead !== true || reviewerAudit.audit.wrongTokenDenied !== true || reviewerAudit.audit.gatewayProviderReached !== true || reviewerAudit.audit.mismatchedSniDenied !== true) throw new Error("reviewer did not prove the complete egress transaction contract");
    invoke(runtime, buildEgressProbeStopArgs([names.gateway, names.forwarder]), "stop sidecars");
    const gatewayLine = sealedLog(runtime, names.gateway, GATEWAY_PROTOCOL) as { audit?: unknown };
    const forwarderLine = sealedLog(runtime, names.forwarder, FORWARDER_PROTOCOL) as { audit?: unknown };
    const gatewayAudit = parseEgressProbeGatewayAudit(gatewayLine.audit);
    const forwarderAudit = parseEgressProbeForwarderAudit(forwarderLine.audit);
    // Candidate sidecar audits are self-authenticated and intentionally diagnostic
    // only. The policy proof below comes from the pinned verifier fixtures.
    void gatewayAudit;
    void forwarderAudit;
    invoke(runtime, buildEgressProbeStopArgs([names.provider, names.mcp]), "stop fake upstreams");
    const providerLine = parseEgressProbeFixtureAuditLine(JSON.stringify(sealedLog(runtime, names.provider, FIXTURE_PROTOCOL)), "provider");
    if (providerLine.audit.connections !== 1 || providerLine.audit.hellos !== 1 || JSON.stringify(providerLine.audit.acceptedSni) !== JSON.stringify([PROVIDER_ALIAS]) || providerLine.audit.mismatchedSni !== 0 || JSON.stringify(providerLine.audit.acceptedChallenges) !== JSON.stringify([challenges.allowedProvider]) || providerLine.audit.unexpectedChallenges !== 0) throw new Error("fake provider did not prove exact correlation and pre-upstream SNI denial");
    assertEgressProbeSourceWitness(providerLine.audit.sourceAddresses, externalEndpointIps.gateway, "provider");
    const mcpLine = parseEgressProbeFixtureAuditLine(JSON.stringify(sealedLog(runtime, names.mcp, FIXTURE_PROTOCOL)), "mcp");
    if (mcpLine.audit.requests !== 1 || JSON.stringify(mcpLine.audit.acceptedChallenges) !== JSON.stringify([challenges.allowedMcp]) || mcpLine.audit.unexpectedChallenges !== 0) throw new Error("fake MCP did not prove exact source-read correlation");
    assertEgressProbeSourceWitness(mcpLine.audit.sourceAddresses, externalEndpointIps.forwarder, "MCP");
  } catch (error) { primaryError = error; }
  const cleanupErrors: Error[] = [];
  try { if (started.length) invoke(runtime, buildEgressProbeRemoveArgs([...started].reverse()), "remove probe containers"); } catch (error) { cleanupErrors.push(error instanceof Error ? error : new Error("remove probe containers failed")); }
  for (const name of started) { try { assertAbsent(runtime, "container", name); } catch (error) { cleanupErrors.push(error instanceof Error ? error : new Error("container absence failed")); } }
  for (const name of [...networks].reverse()) { try { invoke(runtime, buildEgressProbeNetworkRemoveArgs(name), `remove network ${name}`); } catch (error) { cleanupErrors.push(error instanceof Error ? error : new Error("remove network failed")); } try { assertAbsent(runtime, "network", name); } catch (error) { cleanupErrors.push(error instanceof Error ? error : new Error("network absence failed")); } }
  if (platform !== undefined) {
    for (const probeImage of [...new Set([image, VERIFIER_IMAGE])]) {
      try { invoke(runtime, buildEgressProbeImageRemoveArgs(probeImage, platform), `remove platform probe image ${probeImage}`); } catch (error) { cleanupErrors.push(error instanceof Error ? error : new Error("remove platform probe image failed")); }
      try { assertImageAbsent(runtime, probeImage); } catch (error) { cleanupErrors.push(error instanceof Error ? error : new Error("image absence failed")); }
    }
  }
  if (primaryError !== undefined) { if (cleanupErrors.length) throw new AggregateError([primaryError, ...cleanupErrors], primaryError instanceof Error ? primaryError.message : "egress probe failed"); throw primaryError; }
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, "egress probe cleanup failed");
  process.stdout.write(`egress probe passed for ${platform ?? "native"} ${image}\n`);
}

export const runProbe = runEgressProbe;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const options = parseEgressProbeCliArgs(process.argv.slice(2));
    runEgressProbe(options.image, options.platform);
  } catch (error) {
    process.stderr.write(`eval egress probe failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  }
}
