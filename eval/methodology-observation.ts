import { exact, hash, integer, same, unique } from "./prediction-contract.js";
import { validateSidecarHostInspect, validateIpv4OnlyEndpoint } from "./methodology-inspect-policy.js";
import { METHODOLOGY_EGRESS_RUNTIME_IMAGE, METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE } from "./methodology-runtime-image.js";

const requireFact = (condition: unknown, label: string): void => { if (!condition) throw new Error(label); };
const ZERO_TIME = "0001-01-01T00:00:00Z";
const STATE_KEYS = ["Status", "Running", "Paused", "Restarting", "OOMKilled", "Dead", "Pid", "ExitCode", "Error", "StartedAt", "FinishedAt"];
const CONFIG_KEYS = ["Hostname", "Domainname", "User", "AttachStdin", "AttachStdout", "AttachStderr", "Tty", "OpenStdin", "StdinOnce", "Env", "Cmd", "Image", "Volumes", "WorkingDir", "Entrypoint", "Labels"];
const ENDPOINT_KEYS = ["IPAMConfig", "Links", "Aliases", "DriverOpts", "GwPriority", "NetworkID", "EndpointID", "Gateway", "IPAddress", "MacAddress", "IPPrefixLen", "IPv6Gateway", "GlobalIPv6Address", "GlobalIPv6PrefixLen", "DNSNames"];
const NETWORK_KEYS = ["Name", "Id", "Created", "Scope", "Driver", "EnableIPv4", "EnableIPv6", "IPAM", "Internal", "Attachable", "Ingress", "ConfigFrom", "ConfigOnly", "Containers", "Options", "Labels"];
const CONTAINER_KEYS = ["Id", "Created", "Name", "Path", "Args", "Image", "RestartCount", "Config", "State", "HostConfig", "NetworkSettings", "Mounts"];
const INERT_CONTAINER_KEYS = ["ResolvConfPath", "HostnamePath", "HostsPath", "LogPath", "Driver", "Platform", "MountLabel", "ProcessLabel", "AppArmorProfile", "ExecIDs", "Storage", "ImageManifestDescriptor"];

/** Exact required running/network profile. Container key names/defaults derive
 * from retained create-only inspect; running/network conformance is prospective,
 * not a claim that archived network output exists. Unknown fields fail closed. */
export const METHODOLOGY_OBSERVATION_PROFILE = "methodology-observation-graph-v1";

export function parseObservationRecords(stdout: string): any[] {
  let value: unknown; try { value = JSON.parse(stdout); } catch { throw new Error("malformed complete inspect JSON"); }
  // JSON.parse silently takes the last duplicate key. Docker's exact profile
  // never emits duplicates; preserve and reject contradictory raw occurrences.
  // Syntax is already validated above; this token walk only tracks object keys.
  const stack: { keys: Set<string> | null; key: boolean }[] = [];
  for (const [token] of stdout.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]/g)) {
    const current = stack.at(-1);
    if (token === "{" || token === "[") stack.push({ keys: token === "{" ? new Set() : null, key: token === "{" });
    else if (token === "}" || token === "]") stack.pop();
    else if (token === "," && current?.keys) current.key = true;
    else if (token === ":" && current) current.key = false;
    else if (token.startsWith('"') && current?.keys && current.key) {
      const key = JSON.parse(token); requireFact(!current.keys.has(key), "duplicate raw inspect object key"); current.keys.add(key);
    }
  }
  const values = Array.isArray(value) ? value : [value];
  requireFact(values.length > 0 && values.every(v => v && typeof v === "object" && !Array.isArray(v)), "invalid inspect record array");
  return values;
}

export function parseStrictIpv4(value: unknown): { address: string; value: number } {
  requireFact(typeof value === "string" && /^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/.test(value), "noncanonical IPv4 address");
  const octets = (value as string).split(".").map(Number);
  requireFact(octets.every(v => v <= 255), "invalid IPv4 octet");
  return { address: value as string, value: octets.reduce((n, v) => n * 256 + v, 0) };
}
export function parseStrictIpv4Cidr(value: unknown): { address: string; value: number; prefix: number } {
  requireFact(typeof value === "string" && /^[^/]+\/(?:0|[1-9][0-9]?)$/.test(value), "noncanonical IPv4 CIDR");
  const [address, prefix] = (value as string).split("/");
  const parsed = parseStrictIpv4(address), bits = Number(prefix);
  requireFact(bits <= 32, "invalid IPv4 prefix"); return { ...parsed, prefix: bits };
}
export function observationSubnet(value: string) {
  const parsed = parseStrictIpv4Cidr(value);
  requireFact(parsed.prefix === 28 && parsed.value % 16 === 0, "registered subnet must be canonical /28");
  const at = (offset: number) => { const n = parsed.value + offset; return [24, 16, 8, 0].map(shift => (n >>> shift) & 255).join("."); };
  return { ...parsed, gateway: at(1), helper: (index: number) => at(index + 2) };
}
export function observationTimestamp(value: unknown): number {
  requireFact(typeof value === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/.test(value), "invalid observation timestamp");
  const ms = Date.parse(value as string);
  requireFact(Number.isFinite(ms) && ms > 0 && new Date(ms).toISOString().slice(0, 19) === (value as string).slice(0, 19), "invalid observation time");
  return ms;
}
function mac(value: unknown): string {
  requireFact(typeof value === "string" && /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(value) && value !== "00:00:00:00:00:00" && (parseInt(value.slice(0, 2), 16) & 1) === 0, "invalid endpoint MAC");
  return value as string;
}
function names(value: unknown, variants: string[][], label: string): void {
  requireFact(Array.isArray(value) && value.every(v => typeof v === "string") && new Set(value).size === value.length, label);
  requireFact(variants.some(v => JSON.stringify([...value as string[]].sort()) === JSON.stringify([...v].sort())), label);
}
function imageProfile(image: string) {
  if (image === METHODOLOGY_EGRESS_RUNTIME_IMAGE) return {
    revision: METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE.sourceCommit,
    ids: [image.split("@")[1]!, "sha256:62865aa83e5c9dcaf99e9a3a4689b5ec6ce2425faec19a34e1de15765834bc20", "sha256:dbc568e7993b88d86cfcb64a95e5806b46197b0cffafdcaf1fcd71eec0b33c97"],
    manifests: Object.values(METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE.platforms), size: 2951,
  };
  if (image === "sha256:c7296f363efb44c6d48357e6c65dfcb9fac5c550e83b2c917ca7753adddbfa55") return {
    revision: "aa4ca1391d254d6ebfeb785e787b0da5562c8b8b",
    ids: [image], manifests: ["sha256:9315d040f6c806a0922848e3a83ece7c6c1745fc4e052d767323703cd83b218b"], size: 3140,
  };
  throw new Error("unregistered observed image profile");
}
export interface ContainerExpectation {
  name: string; network: string; externalNetwork: string; subnet: string; externalSubnet: string;
  image: string; entrypoint: string; alias: string; env: Record<string, string>; addHost?: string; baseEnv: readonly string[];
}
export function validateObservedContainer(raw: unknown, expected: ContainerExpectation): any {
  requireFact(raw && typeof raw === "object" && !Array.isArray(raw), "missing container inspect");
  const value = exact(raw, [...CONTAINER_KEYS, ...INERT_CONTAINER_KEYS.filter(k => Object.hasOwn(raw as object, k))], "container inspect containment policy") as any;
  hash(value.Id); const created = observationTimestamp(value.Created), profile = imageProfile(expected.image);
  same([value.Name, value.Path, value.Args, value.RestartCount], ["/" + expected.name, expected.entrypoint, [], 0], "container identity or entrypoint drift");
  requireFact(profile.ids.includes(value.Image), "container image identity drift");
  const config = exact(value.Config, [...CONFIG_KEYS, ...(Object.hasOwn(value.Config ?? {}, "ArgsEscaped") ? ["ArgsEscaped"] : [])], "container config containment policy") as any;
  same({ ...config, Env: [...(Array.isArray(config.Env) ? config.Env : [])].sort(), Cmd: config.Cmd === null ? [] : config.Cmd },
    { Hostname: value.Id.slice(0, 12), Domainname: "", User: "65532:65532", AttachStdin: false, AttachStdout: false, AttachStderr: false, Tty: false, OpenStdin: false, StdinOnce: false,
      Env: [...expected.baseEnv, ...Object.entries(expected.env).map(([k, v]) => k + "=" + v)].sort(), Cmd: [], Image: expected.image, Volumes: null, WorkingDir: "/workspace", Entrypoint: [expected.entrypoint],
      Labels: { "io.peregrine.claude-code.version": "2.1.252", "io.peregrine.codex.version": "0.152.0", "io.peregrine.node.version": "22.22.1",
        "org.opencontainers.image.description": "Provider CLIs for externally contained Peregrine evaluation attempts", "org.opencontainers.image.revision": profile.revision,
        "org.opencontainers.image.source": "https://github.com/PeterGrayCreative/peregrine-bugbot", "org.opencontainers.image.title": "Peregrine evaluation runtime" },
      ...(Object.hasOwn(config, "ArgsEscaped") ? { ArgsEscaped: true } : {}) }, "container config/environment/containment policy drift");
  unique(config.Env); validateSidecarHostInspect(value.HostConfig, expected.externalNetwork, expected.addHost); same(value.Mounts, [], "container must not have host mounts");
  const state = exact(value.State, STATE_KEYS, "container state") as any;
  const started = observationTimestamp(state.StartedAt); requireFact(started >= created && integer(state.Pid) > 0, "invalid running lifecycle identity/time");
  same({ ...state, Pid: 1, StartedAt: "validated" }, { Status: "running", Running: true, Paused: false, Restarting: false, OOMKilled: false, Dead: false, Pid: 1, ExitCode: 0, Error: "", StartedAt: "validated", FinishedAt: ZERO_TIME }, "container is not in the exact healthy running state");
  const settings = exact(value.NetworkSettings, ["SandboxID", "SandboxKey", "Ports", "Networks"], "container network settings") as any;
  hash(settings.SandboxID); same(settings.SandboxKey, "/var/run/docker/netns/" + settings.SandboxID.slice(0, 12), "network namespace identity drift");
  same(settings.Ports, {}, "published ports contradict containment"); exact(settings.Networks, [expected.network, expected.externalNetwork], "container networks");
  for (const [network, subnet, internal] of [[expected.network, expected.subnet, true], [expected.externalNetwork, expected.externalSubnet, false]] as const) {
    const endpoint = exact(settings.Networks[network], ENDPOINT_KEYS, "container endpoint") as any, range = observationSubnet(subnet);
    validateIpv4OnlyEndpoint(endpoint);
    same([endpoint.Links, endpoint.DriverOpts, endpoint.GwPriority, endpoint.IPPrefixLen, endpoint.Gateway], [null, null, 0, 28, range.gateway], "endpoint prefix/gateway/options drift");
    hash(endpoint.NetworkID); hash(endpoint.EndpointID); mac(endpoint.MacAddress);
    const address = parseStrictIpv4(endpoint.IPAddress); requireFact(address.value > range.value && address.value < range.value + 15, "endpoint IPv4 outside subnet");
    const aliases = internal ? [[expected.alias], [expected.alias, expected.name], [expected.alias, expected.name, value.Id.slice(0, 12)]] : [[], [expected.name], [expected.name, value.Id.slice(0, 12)]];
    names(endpoint.Aliases === null && !internal ? [] : endpoint.Aliases, aliases, "endpoint alias drift");
    names(endpoint.DNSNames, [[expected.name, value.Id.slice(0, 12), ...(internal ? [expected.alias] : [])]], "endpoint DNS identity drift");
  }
  for (const [key, filename] of [["ResolvConfPath", "resolv.conf"], ["HostnamePath", "hostname"], ["HostsPath", "hosts"], ["LogPath", value.Id + "-json.log"]])
    if (Object.hasOwn(value, key!)) same(value[key!], "/var/lib/docker/containers/" + value.Id + "/" + filename, "container metadata path identity drift");
  for (const [key, permitted] of [["Driver", "overlayfs"], ["Platform", "linux"], ["MountLabel", ""], ["ProcessLabel", ""], ["AppArmorProfile", ""], ["ExecIDs", null], ["Storage", { RootFS: { Snapshot: { Name: "overlayfs" } } }]])
    if (Object.hasOwn(value, key as string)) same(value[key as string], permitted, "container metadata profile drift");
  if (Object.hasOwn(value, "ImageManifestDescriptor")) {
    const descriptor = exact(value.ImageManifestDescriptor, ["mediaType", "digest", "size", "platform"], "image descriptor") as any;
    const platform = exact(descriptor.platform, ["architecture", "os"], "image platform");
    requireFact(["arm64", "amd64"].includes(String(platform.architecture)) && platform.os === "linux", "image platform drift");
    same([descriptor.mediaType, descriptor.size], ["application/vnd.oci.image.manifest.v1+json", profile.size], "image descriptor drift");
    requireFact((profile.manifests as readonly string[]).includes(descriptor.digest), "image descriptor identity drift");
    if (expected.image === METHODOLOGY_EGRESS_RUNTIME_IMAGE) same(descriptor.digest, METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE.platforms[("linux/" + platform.architecture) as "linux/arm64"], "image platform/digest mismatch");
    else same(platform.architecture, "arm64", "local candidate platform drift");
    if (expected.image === METHODOLOGY_EGRESS_RUNTIME_IMAGE && value.Image !== profile.ids[0])
      same(value.Image, profile.ids[platform.architecture === "amd64" ? 1 : 2], "image config/platform mismatch");
  }
  return value;
}
export interface NetworkExpectation { network: string; subnet: string; sidecars: readonly string[]; internal?: boolean }
export function validateObservedNetwork(raw: unknown, expected: NetworkExpectation): any {
  const value = exact(raw, NETWORK_KEYS, "network inspect") as any, subnet = observationSubnet(expected.subnet);
  hash(value.Id); observationTimestamp(value.Created);
  same([value.Name, value.Scope, value.Driver, value.EnableIPv4, value.EnableIPv6, value.Internal, value.Attachable, value.Ingress, value.ConfigOnly, value.ConfigFrom, value.Options, value.Labels],
    [expected.network, "local", "bridge", true, false, expected.internal ?? true, false, false, false, { Network: "" }, {}, {}], "network exact profile drift");
  same(value.IPAM, { Driver: "default", Options: null, Config: [{ Subnet: expected.subnet, Gateway: subnet.gateway }] }, "network IPAM/gateway drift");
  requireFact(value.Containers && typeof value.Containers === "object" && !Array.isArray(value.Containers) && Object.keys(value.Containers).length === 2 && expected.sidecars.length === 2, "network member closure missing");
  const observed: string[] = [], endpointIds: string[] = [], addresses: string[] = [], macs: string[] = [];
  for (const [id, rawMember] of Object.entries(value.Containers)) {
    hash(id); const member = exact(rawMember, ["Name", "EndpointID", "MacAddress", "IPv4Address", "IPv6Address"], "network member IPv4-only") as any;
    requireFact(typeof member.Name === "string", "network member identity missing"); observed.push(member.Name); hash(member.EndpointID); endpointIds.push(member.EndpointID); macs.push(mac(member.MacAddress));
    const address = parseStrictIpv4Cidr(member.IPv4Address); same([address.prefix, member.IPv6Address], [28, ""], "network member is not exact IPv4-only /28");
    requireFact(address.value > subnet.value && address.value < subnet.value + 15, "member address outside network"); addresses.push(address.address);
  }
  same(observed.slice().sort(), [...expected.sidecars].sort(), "network helper identities differ"); unique(endpointIds); unique(addresses); unique(macs);
  return value;
}
export interface ObservationReceipt { startedAt: number; closedAt: number; stdout: string }
export interface ObservationGraph {
  containers: unknown[]; networks: unknown[]; helpers: [ContainerExpectation, ContainerExpectation];
  // Internal then external network, and gateway then forwarder container.
  networkCreates: [ObservationReceipt, ObservationReceipt]; launches: [ObservationReceipt, ObservationReceipt];
  containerInspect: ObservationReceipt; networkInspects: [ObservationReceipt, ObservationReceipt];
}
export function validateMethodologyObservationGraph(input: ObservationGraph): void {
  requireFact(input.containers.length === 2 && input.networks.length === 2, "exact observed graph required");
  const containers = input.containers.map((v, i) => validateObservedContainer(v, input.helpers[i]!));
  const first = input.helpers[0], second = input.helpers[1];
  same([second.network, second.externalNetwork, second.subnet, second.externalSubnet, second.image], [first.network, first.externalNetwork, first.subnet, first.externalSubnet, first.image], "helper graph context drift");
  requireFact(first.network !== first.externalNetwork && first.subnet !== first.externalSubnet, "network graph collision");
  const names = input.helpers.map(h => h.name);
  const networks = input.networks.map((v, i) => validateObservedNetwork(v, { network: i ? first.externalNetwork : first.network, subnet: i ? first.externalSubnet : first.subnet, internal: !i, sidecars: names }));
  const receipt = (r: ObservationReceipt) => { requireFact(integer(r.closedAt) >= integer(r.startedAt), "invalid observation receipt interval"); };
  const resourceId = (r: ObservationReceipt): string => { receipt(r); requireFact(/^[a-f0-9]{64}\n$/.test(r.stdout), "resource creation identity receipt missing"); return r.stdout.trim(); };
  input.networkInspects.forEach(receipt); receipt(input.containerInspect);
  same(parseObservationRecords(input.containerInspect.stdout), input.containers, "container inspect receipt/body mismatch");
  input.networkInspects.forEach((r, i) => same(parseObservationRecords(r.stdout), [input.networks[i]], "network inspect receipt/body mismatch"));
  requireFact(input.networkCreates[1].closedAt <= input.networkCreates[0].startedAt && input.launches[0].closedAt <= input.launches[1].startedAt &&
    input.networkInspects[0].closedAt <= input.networkInspects[1].startedAt, "resource operation chronology contradiction");
  same(containers[0].Image, containers[1].Image, "helper image identity disagreement");
  same(containers[0].ImageManifestDescriptor ?? null, containers[1].ImageManifestDescriptor ?? null, "helper image descriptor disagreement");
  unique([...containers.map(c => c.Id), ...networks.map(n => n.Id), ...containers.map(c => c.NetworkSettings.SandboxID)]);
  unique(containers.map(c => String(c.State.Pid)));
  const endpoints: string[] = [], macs: string[] = [];
  for (const [i, c] of containers.entries()) {
    const launch = input.launches[i]!; same(c.Id, resourceId(launch), "container differs from launched identity");
    const created = observationTimestamp(c.Created), started = observationTimestamp(c.State.StartedAt);
    requireFact(created >= launch.startedAt && started <= launch.closedAt && launch.closedAt <= input.containerInspect.startedAt, "container creation/start/inspect chronology contradiction");
    for (const [j, n] of networks.entries()) {
      const create = input.networkCreates[j]!, inspect = input.networkInspects[j]!;
      same(n.Id, resourceId(create), "network differs from created identity");
      const networkCreated = observationTimestamp(n.Created);
      requireFact(networkCreated >= create.startedAt && networkCreated <= create.closedAt && create.closedAt <= launch.startedAt &&
        input.containerInspect.closedAt <= inspect.startedAt, "network creation/launch/inspect chronology contradiction");
      const endpoint = c.NetworkSettings.Networks[n.Name], member = n.Containers[c.Id];
      requireFact(member, "container missing from its inspected network");
      const subnet = observationSubnet(j ? first.externalSubnet : first.subnet);
      same([endpoint.NetworkID, endpoint.IPAddress, endpoint.IPPrefixLen, endpoint.Gateway], [n.Id, subnet.helper(i), 28, subnet.gateway], "endpoint static network binding drift");
      same([member.Name, member.EndpointID, member.MacAddress, member.IPv4Address, member.IPv6Address],
        [names[i], endpoint.EndpointID, endpoint.MacAddress, endpoint.IPAddress + "/28", ""], "container/member endpoint identity disagreement");
      endpoints.push(endpoint.EndpointID); macs.push(endpoint.MacAddress);
    }
  }
  unique([...endpoints, ...containers.map(c => c.Id), ...networks.map(n => n.Id), ...containers.map(c => c.NetworkSettings.SandboxID)]); unique(macs);
}
