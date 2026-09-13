import { createHash } from "node:crypto";
import { request } from "node:http";
import type { ProviderExec } from "../src/types.js";
import { METHODOLOGY_EGRESS_BASE_ENV, ACCEPTED_METHODOLOGY_EGRESS_IMAGE } from "../eval/methodology-egress.js";

/** Same strict sidecar observations as the existing egress supervisor fixture.
 * Every Docker call is injected; HTTP reaches only the local real reader. */
export function predictionDockerFixture(agent: (args: string[], options: Parameters<ProviderExec>[2], endpoint: string) => ReturnType<ProviderExec>) {
  const calls: { args: string[]; signal?: AbortSignal }[] = [], envs = new Map<string, string[]>();
  let network = "", external = "", subnet = "", externalSubnet = "", gateway = "", forwarder = "", stopped = false, endpoint = "";
  const result = (stdout = "") => ({ stdout, stderr: "", code: 0, timedOut: false });
  const digest = (protocol: string, body: unknown) => createHash("sha256").update(`${protocol}\0${JSON.stringify(body)}`).digest("hex");
  const run: ProviderExec = async (command, args, options) => {
    if (command !== "docker") throw new Error("fixture accepts Docker only");
    calls.push({ args: [...args], signal: options?.deadlineSignal });
    if (args[0] === "network" && args[1] === "create") {
      if (args.includes("--internal")) { network = args.at(-1)!; subnet = args[7]!; stopped = false; }
      else { external = args.at(-1)!; externalSubnet = args[6]!; }
      return result();
    }
    if (args[0] === "run" && args.includes("codex")) return agent(args, options, endpoint);
    if (args[0] === "run") {
      const name = args[3]!, env = args.flatMap((v, i) => v === "--env" ? [args[i + 1]!] : []);
      envs.set(name, [...METHODOLOGY_EGRESS_BASE_ENV, ...env]);
      if (name.includes("gateway")) gateway = name;
      else {
        forwarder = name; const values = Object.fromEntries(env.map(v => [v.slice(0, v.indexOf("=")), v.slice(v.indexOf("=") + 1)]));
        endpoint = `http://host.docker.internal:${values.MCP_FORWARDER_UPSTREAM_PORT}/mcp/${values.MCP_FORWARDER_TOKEN}`;
      }
    }
    if (args[0] === "logs") {
      const isGateway = args.at(-1) === gateway, protocol = isGateway ? "egress-gateway-v1" : "methodology-mcp-forwarder-v1";
      if (!stopped) return result(JSON.stringify({ status: "ready", protocol, ...(isGateway ? {} : { ready: true }), host: "0.0.0.0", port: isGateway ? 8081 : 8082 }));
      if (isGateway) { const body = { schemaVersion: 1, protocol: "egress-gateway-audit-v1", events: [] }; return result(JSON.stringify({ status: "sealed", protocol, audit: { ...body, sealed: true, sha256: digest(body.protocol, body) } })); }
      const body = { schemaVersion: 1, protocol: "methodology-mcp-forwarder-audit-v1", sealed: true, requests: { observed: 0, allowed: 0, denied: 0, forwarded: 0, budgeted: 0 }, events: [] };
      return result(JSON.stringify({ status: "sealed", protocol, audit: { ...body, snapshotSha256: digest(body.protocol, body) } }));
    }
    if (args[0] === "inspect") return result(JSON.stringify([gateway, forwarder].map(name => {
      const gatewayRole = name === gateway, entrypoint = gatewayRole ? "/usr/local/bin/peregrine-egress-gateway" : "/usr/local/bin/peregrine-methodology-mcp-forwarder";
      return { Name: `/${name}`, Path: entrypoint, Args: [], State: { Running: true }, Mounts: [{ Type: "tmpfs", Destination: "/tmp" }, { Type: "tmpfs", Destination: "/home/peregrine" }],
        Config: { User: "65532:65532", Image: ACCEPTED_METHODOLOGY_EGRESS_IMAGE, Entrypoint: [entrypoint], Env: envs.get(name) },
        HostConfig: { ReadonlyRootfs: true, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"], PidsLimit: 64, Tmpfs: { "/tmp": "rw,noexec,nosuid,nodev,size=32m,uid=65532,gid=65532,mode=1777", "/home/peregrine": "rw,noexec,nosuid,nodev,size=16m,uid=65532,gid=65532,mode=0700" }, ExtraHosts: gatewayRole ? [] : ["host.docker.internal:host-gateway"] },
        NetworkSettings: { Networks: { [external]: { Aliases: [name], IPAddress: externalSubnet.replace(".0/28", gatewayRole ? ".2" : ".3") }, [network]: { Aliases: [gatewayRole ? "egress-gateway" : "mcp-forwarder", name], IPAddress: subnet.replace(".0/28", gatewayRole ? ".2" : ".3") } } } };
    })));
    if (args[0] === "network" && args[1] === "inspect") {
      const internal = args[2] === network, selected = internal ? subnet : externalSubnet;
      return result(JSON.stringify([{ Name: args[2], Driver: "bridge", Internal: internal, EnableIPv6: false, IPAM: { Config: [{ Subnet: selected }] }, Containers: {
        a: { Name: gateway, IPv4Address: selected.replace(".0/28", ".2/28"), IPv6Address: "" }, b: { Name: forwarder, IPv4Address: selected.replace(".0/28", ".3/28"), IPv6Address: "" } } }]));
    }
    if (args[0] === "stop") stopped = true;
    return result();
  };
  return { run, calls };
}
export function predictionHttpCall(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ body: any; headers: Record<string, string | string[] | undefined>; status: number }> {
  const endpoint = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: endpoint.port, path: endpoint.pathname, method: "POST", headers: { Host: endpoint.host, Accept: "application/json, text/event-stream", "Content-Type": "application/json", ...headers } }, response => {
      let text = ""; response.on("data", chunk => { text += chunk; }); response.on("end", () => resolve({ body: text ? JSON.parse(text) : null, headers: response.headers, status: response.statusCode! }));
    });
    req.setTimeout(3000, () => req.destroy(new Error("fixture HTTP timeout"))); req.on("error", reject); req.end(JSON.stringify(body));
  });
}
