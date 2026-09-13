import { readFileSync } from "node:fs";

// Independent archived Docker create/inspect defaults, not imported from policy.
// The original probe did not start a container or invoke a provider.
export function sidecarHostFixture(network: string, addHost?: string): any {
  const host = JSON.parse(readFileSync(new URL("./fixtures/methodology-host-inspect.json", import.meta.url), "utf8"));
  return { ...host, NetworkMode: network, ExtraHosts: addHost ? [addHost] : null };
}

export function ipv4EndpointFixture(): any {
  return JSON.parse(readFileSync(new URL("./fixtures/methodology-endpoint-inspect.json", import.meta.url), "utf8"));
}
