import { canonicalJsonSha256 } from "./experiment.js";

/**
 * Supported Docker inspect profile, taken from the archived credential-free
 * create/inspect probe (forwarder-startup-v1/inspect-tmpfs.json). This is a
 * producer-shape constraint. The consumed V8 running inspect supplies the
 * successor's null OomKillDisable representation; false is create-only history.
 * Unknown/default drift fails closed; do not silently expand this allowlist.
 */
const HOST_DEFAULTS = {
  "Binds": null,
  "ContainerIDFile": "",
  "LogConfig": {
    "Type": "json-file",
    "Config": {}
  },
  "NetworkMode": "none",
  "PortBindings": {},
  "RestartPolicy": {
    "Name": "no",
    "MaximumRetryCount": 0
  },
  "AutoRemove": false,
  "VolumeDriver": "",
  "VolumesFrom": null,
  "ConsoleSize": [
    0,
    0
  ],
  "CapAdd": null,
  "CapDrop": [
    "ALL"
  ],
  "CgroupnsMode": "private",
  "Dns": null,
  "DnsOptions": [],
  "DnsSearch": [],
  "ExtraHosts": null,
  "GroupAdd": null,
  "IpcMode": "private",
  "Cgroup": "",
  "Links": null,
  "OomScoreAdj": 0,
  "PidMode": "",
  "Privileged": false,
  "PublishAllPorts": false,
  "ReadonlyRootfs": true,
  "SecurityOpt": [
    "no-new-privileges"
  ],
  "Tmpfs": {
    "/home/peregrine": "rw,noexec,nosuid,nodev,size=16m,uid=65532,gid=65532,mode=0700",
    "/tmp": "rw,noexec,nosuid,nodev,size=32m,uid=65532,gid=65532,mode=1777"
  },
  "UTSMode": "",
  "UsernsMode": "",
  "ShmSize": 67108864,
  "Runtime": "runc",
  "Isolation": "",
  "CpuShares": 0,
  "Memory": 0,
  "NanoCpus": 0,
  "CgroupParent": "",
  "BlkioWeight": 0,
  "BlkioWeightDevice": [],
  "BlkioDeviceReadBps": [],
  "BlkioDeviceWriteBps": [],
  "BlkioDeviceReadIOps": [],
  "BlkioDeviceWriteIOps": [],
  "CpuPeriod": 0,
  "CpuQuota": 0,
  "CpuRealtimePeriod": 0,
  "CpuRealtimeRuntime": 0,
  "CpusetCpus": "",
  "CpusetMems": "",
  "Devices": [],
  "DeviceCgroupRules": null,
  "DeviceRequests": null,
  "MemoryReservation": 0,
  "MemorySwap": 0,
  "MemorySwappiness": null,
  "OomKillDisable": null,
  "PidsLimit": 64,
  "Ulimits": [],
  "CpuCount": 0,
  "CpuPercent": 0,
  "IOMaximumIOps": 0,
  "IOMaximumBandwidth": 0,
  "MaskedPaths": [
    "/proc/acpi",
    "/proc/asound",
    "/proc/interrupts",
    "/proc/kcore",
    "/proc/keys",
    "/proc/latency_stats",
    "/proc/sched_debug",
    "/proc/scsi",
    "/proc/timer_list",
    "/proc/timer_stats",
    "/sys/devices/virtual/powercap",
    "/sys/firmware"
  ],
  "ReadonlyPaths": [
    "/proc/bus",
    "/proc/fs",
    "/proc/irq",
    "/proc/sys",
    "/proc/sysrq-trigger"
  ]
} as const;

export function validateSidecarHostInspect(host: unknown, network: string, addHost?: string): void {
  if (!host || typeof host !== "object" || Array.isArray(host)) throw new Error("missing sidecar containment policy");
  const actual = { ...(host as Record<string, unknown>) };
  // Docker emits null or [] for unused list fields; neither grants access.
  for (const key of ["Binds", "VolumesFrom", "CapAdd", "Dns", "ExtraHosts", "GroupAdd", "Links", "DeviceCgroupRules", "DeviceRequests"])
    if (Array.isArray(actual[key]) && (actual[key] as unknown[]).length === 0) actual[key] = null;
  const expected = { ...HOST_DEFAULTS, NetworkMode: network, ExtraHosts: addHost ? [addHost] : null };
  if (canonicalJsonSha256(actual) !== canonicalJsonSha256(expected))
    throw new Error("sidecar inspect does not attest the exact containment policy");
}

/** The archived endpoint schema represents disabled IPv6 as "", 0, "" and
 * no explicit IPAM override. Missing evidence is not an empty address. */
export function validateIpv4OnlyEndpoint(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("missing IPv4-only endpoint evidence");
  const endpoint = value as Record<string, unknown>;
  if (endpoint.GlobalIPv6Address !== "" || endpoint.GlobalIPv6PrefixLen !== 0 ||
      endpoint.IPv6Gateway !== "" || endpoint.IPAMConfig !== null ||
      Object.keys(endpoint).some(key => /ipv6|linklocal/iu.test(key) && !["GlobalIPv6Address", "GlobalIPv6PrefixLen", "IPv6Gateway"].includes(key)))
    throw new Error("container endpoint contradicts the IPv4-only network policy");
}
