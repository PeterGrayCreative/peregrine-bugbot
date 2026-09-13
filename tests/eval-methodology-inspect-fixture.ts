import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Independent archived Docker create/inspect defaults, not imported from policy.
// The original probe did not start a container or invoke a provider.
export function sidecarHostFixture(network: string, addHost?: string): any {
  const host = JSON.parse(readFileSync(new URL("./fixtures/methodology-host-inspect.json", import.meta.url), "utf8"));
  // Running successor: both retained V8 helpers use null (not create-only false).
  return { ...host, OomKillDisable: null, NetworkMode: network, ExtraHosts: addHost ? [addHost] : null };
}

export function ipv4EndpointFixture(): any {
  return JSON.parse(readFileSync(new URL("./fixtures/methodology-endpoint-inspect.json", import.meta.url), "utf8"));
}

export const fixtureIdentity = (name: string) => createHash("sha256").update(name).digest("hex");

/** Prospective complete running profile. Only schema/default projection is
 * archival; these identities and lifecycle observations are synthetic. This
 * pure builder is also embedded in the separate-process Docker test stub. */
export function fixtureContainer(input: any, host: any): any {
  const id = (name: string) => createHash("sha256").update(name).digest("hex");
  const container = id(input.name), sandbox = id("sandbox:" + input.name), time = new Date(input.at).toISOString();
  const endpoint = (network: string, subnet: string, internal: boolean) => {
    const endpointId = id(input.name + "@" + network), octets = subnet.split("/")[0]!.split(".");
    octets[3] = String(Number(octets[3]) + input.index + 2);
    const gateway = subnet.split("/")[0]!.split("."); gateway[3] = String(Number(gateway[3]) + 1);
    return { IPAMConfig: null, Links: null, Aliases: internal ? [input.name, input.alias] : [input.name], DriverOpts: null, GwPriority: 0,
      NetworkID: id(network), EndpointID: endpointId, Gateway: gateway.join("."), IPAddress: octets.join("."), MacAddress: "02:" + endpointId.slice(0, 10).match(/../g)!.join(":"),
      IPPrefixLen: 28, IPv6Gateway: "", GlobalIPv6Address: "", GlobalIPv6PrefixLen: 0, DNSNames: [input.name, container.slice(0, 12), ...(internal ? [input.alias] : [])] };
  };
  return { Id: container, Created: time, Name: "/" + input.name, Path: input.entrypoint, Args: [], Image: input.image.includes("@") ? input.image.split("@")[1] : input.image, RestartCount: 0,
    Config: { Hostname: container.slice(0, 12), Domainname: "", User: "65532:65532", AttachStdin: false, AttachStdout: false, AttachStderr: false,
      Tty: false, OpenStdin: false, StdinOnce: false, Env: input.env, Cmd: null, Image: input.image, Volumes: null, WorkingDir: "/workspace", Entrypoint: [input.entrypoint],
      Labels: { "io.peregrine.claude-code.version": "2.1.252", "io.peregrine.codex.version": "0.152.0", "io.peregrine.node.version": "22.22.1",
        "org.opencontainers.image.description": "Provider CLIs for externally contained Peregrine evaluation attempts",
        "org.opencontainers.image.revision": input.image.includes("@") ? "b01d15680705ff7e8d28047f5b529298acbb1c95" : "aa4ca1391d254d6ebfeb785e787b0da5562c8b8b",
        "org.opencontainers.image.source": "https://github.com/PeterGrayCreative/peregrine-bugbot", "org.opencontainers.image.title": "Peregrine evaluation runtime" } },
    State: { Status: "running", Running: true, Paused: false, Restarting: false, OOMKilled: false, Dead: false, Pid: 1000 + input.index, ExitCode: 0, Error: "", StartedAt: time, FinishedAt: "0001-01-01T00:00:00Z" },
    HostConfig: host, Mounts: [], NetworkSettings: { SandboxID: sandbox, SandboxKey: "/var/run/docker/netns/" + sandbox.slice(0, 12), Ports: {},
      Networks: { [input.external]: endpoint(input.external, input.externalSubnet, false), [input.network]: endpoint(input.network, input.subnet, true) } } };
}
export function fixtureNetwork(input: any): any {
  const id = (name: string) => createHash("sha256").update(name).digest("hex");
  const gateway = input.subnet.split("/")[0].split("."); gateway[3] = String(Number(gateway[3]) + 1);
  return { Name: input.name, Id: id(input.name), Created: new Date(input.at).toISOString(), Scope: "local", Driver: "bridge", EnableIPv4: true, EnableIPv6: false,
    IPAM: { Driver: "default", Options: null, Config: [{ Subnet: input.subnet, Gateway: gateway.join(".") }] }, Internal: input.internal, Attachable: false, Ingress: false,
    ConfigFrom: { Network: "" }, ConfigOnly: false, Options: {}, Labels: {}, Containers: Object.fromEntries(input.names.map((name: string, index: number) => {
      const endpoint = id(name + "@" + input.name), address = input.subnet.split("/")[0].split("."); address[3] = String(Number(address[3]) + index + 2);
      return [id(name), { Name: name, EndpointID: endpoint, MacAddress: "02:" + endpoint.slice(0, 10).match(/../g)!.join(":"), IPv4Address: address.join(".") + "/28", IPv6Address: "" }];
    })) };
}
