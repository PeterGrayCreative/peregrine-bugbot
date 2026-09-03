#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";

const CONTRACT = Object.freeze({
  schemaVersion: 1,
  user: { uid: 1000, gid: 1000 },
  rootFilesystem: "read-only",
  network: {
    requiredInterface: "lo",
    permittedInertTunnelInterfaces: ["erspan0", "gre0", "gretap0", "ip6gre0", "ip6tnl0", "ip6_vti0", "ip_vti0", "sit0", "tunl0"],
    nonLoopbackAddresses: false,
    nonLoopbackRoutes: false,
    defaultRoutes: false,
  },
  mounts: {
    checkout: { path: "/workspace", access: "read-only", marker: "checkout" },
    assets: { path: "/opt/peregrine", access: "read-only", marker: "assets" },
    output: { path: "/output", access: "read-write" },
    home: { path: "/home/peregrine", type: "tmpfs" },
    scratch: { path: "/tmp", type: "tmpfs" },
  },
  providerVersions: {
    claude: "2.1.252",
    codex: "0.152.0",
  },
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = process.argv[2] ?? "--check";
  if (mode === "--describe") {
    process.stdout.write(`${JSON.stringify(CONTRACT)}\n`);
  } else if (mode === "--assess-network-fixture") {
    process.stdout.write(`${JSON.stringify(assessNetworkNamespace(JSON.parse(readFileSync(0, "utf8"))))}\n`);
  } else if (mode === "--filter-network-entry-fixture") {
    const entries = JSON.parse(readFileSync(0, "utf8"));
    process.stdout.write(`${JSON.stringify(networkInterfaceNames(entries.map(({ name, kind }) => ({
      name,
      isDirectory: () => kind === "directory",
      isSymbolicLink: () => kind === "symlink",
    }))))}\n`);
  } else if (mode === "--check") {
    runChecks();
  } else {
    fail(`unsupported argument: ${mode}`);
  }
}

function runChecks() {
  const checks = [];
  check(process.platform === "linux", "runtime platform is Linux", checks);
  check(process.getuid?.() === CONTRACT.user.uid, "runtime UID is the non-root image UID", checks);
  check(process.getgid?.() === CONTRACT.user.gid, "runtime GID is the non-root image GID", checks);

  const mounts = readMounts();
  assertMount(mounts, "/", "ro", undefined, checks);
  assertMount(mounts, CONTRACT.mounts.checkout.path, "ro", undefined, checks);
  assertMount(mounts, CONTRACT.mounts.assets.path, "ro", undefined, checks);
  assertMount(mounts, CONTRACT.mounts.output.path, "rw", undefined, checks);
  assertMount(mounts, CONTRACT.mounts.home.path, "rw", "tmpfs", checks);
  assertMount(mounts, CONTRACT.mounts.scratch.path, "rw", "tmpfs", checks);

  assertReadOnlyMarker(CONTRACT.mounts.checkout.path, CONTRACT.mounts.checkout.marker, checks);
  assertReadOnlyMarker(CONTRACT.mounts.assets.path, CONTRACT.mounts.assets.marker, checks);
  assertWritable(CONTRACT.mounts.output.path, checks);
  assertWritable(CONTRACT.mounts.home.path, checks);
  assertWritable(CONTRACT.mounts.scratch.path, checks);
  assertDeniedWrite(`/peregrine-root-write-${process.pid}`, checks);
  assertNetworkNamespace(checks);

  const hostSentinel = process.env.PEREGRINE_PROBE_HOST_SENTINEL;
  check(typeof hostSentinel === "string" && hostSentinel.startsWith("/"), "host sentinel path is declared", checks);
  if (hostSentinel) assertDeniedRead(hostSentinel, "host sibling sentinel", checks);
  assertDeniedRead("/var/run/docker.sock", "Docker socket", checks);
  assertDeniedRead("/run/docker.sock", "Docker socket", checks);

  for (const name of [
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "OPENAI_API_KEY",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "SSH_AUTH_SOCK",
    "DOCKER_HOST",
    "NODE_AUTH_TOKEN",
    "NPM_TOKEN",
  ]) {
    check(process.env[name] === undefined, `${name} is absent from the zero-credential smoke environment`, checks);
  }

  assertProviderVersion("claude", CONTRACT.providerVersions.claude, checks);
  assertProviderVersion("codex", CONTRACT.providerVersions.codex, checks);

  const report = {
    schemaVersion: CONTRACT.schemaVersion,
    status: "passed",
    checks,
  };
  writeFileSync(join(CONTRACT.mounts.output.path, "containment-probe.json"), `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o644,
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

function assertNetworkNamespace(checks) {
  const interfaces = networkInterfaceNames(readdirSync("/sys/class/net", { withFileTypes: true }));
  const ipv4Routes = readFileSync("/proc/net/route", "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/));
  check(ipv4Routes.every((route) => route[0] === "lo"), "IPv4 routes are loopback-only", checks);
  check(ipv4Routes.every((route) => route[1] !== "00000000"), "no default IPv4 route exists", checks);

  const ipv6Routes = readFileSync("/proc/net/ipv6_route", "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/));
  const counters = Object.fromEntries(interfaces.filter((name) => name !== "lo").map((name) => [name, {
    rx: Number(readFileSync(`/sys/class/net/${name}/statistics/rx_bytes`, "utf8").trim()),
    tx: Number(readFileSync(`/sys/class/net/${name}/statistics/tx_bytes`, "utf8").trim()),
  }]));
  const errors = assessNetworkNamespace({ interfaces, addresses: networkInterfaces(), ipv4Routes, ipv6Routes, counters });
  for (const error of errors) fail(error);
  checks.push("network namespace has no assigned non-loopback addresses");
  checks.push("network namespace has no non-loopback or default routes");
  checks.push("only the explicit inert tunnel-device set may accompany loopback");
}

function networkInterfaceNames(entries) {
  return entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
}

export function assessNetworkNamespace({ interfaces, addresses, ipv4Routes, ipv6Routes, counters }) {
  const errors = [];
  const allowed = new Set([CONTRACT.network.requiredInterface, ...CONTRACT.network.permittedInertTunnelInterfaces]);
  if (!interfaces.includes("lo")) errors.push("network namespace is missing loopback");
  if (interfaces.some((name) => !allowed.has(name))) errors.push("network namespace exposes an unexpected interface");
  for (const [name, entries] of Object.entries(addresses)) {
    if (name !== "lo" && (entries?.length ?? 0) > 0) errors.push("network namespace exposes a non-loopback address");
  }
  for (const name of interfaces.filter((item) => item !== "lo")) {
    const counter = counters[name];
    if (!counter || counter.rx !== 0 || counter.tx !== 0) errors.push("permitted tunnel interface is not inert");
  }
  if (ipv4Routes.some((route) => route[0] !== "lo")) errors.push("IPv4 route escapes loopback");
  if (ipv4Routes.some((route) => route[1] === "00000000")) errors.push("default IPv4 route exists");
  if (ipv6Routes.some((route) => route.at(-1) !== "lo")) errors.push("IPv6 route escapes loopback");
  if (ipv6Routes.some((route) => isUsableIpv6DefaultRoute(route))) errors.push("usable default IPv6 route exists");
  return errors;
}

function isUsableIpv6DefaultRoute(route) {
  if (route[0] !== "00000000000000000000000000000000" || route[1] !== "00") return false;
  const flags = Number.parseInt(route[8] ?? "", 16);
  const rejectRoute = Number.isFinite(flags) && (flags & 0x0200) !== 0;
  return route.at(-1) !== "lo" || !rejectRoute;
}

function readMounts() {
  return readFileSync("/proc/self/mountinfo", "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const fields = line.split(" ");
      const separator = fields.indexOf("-");
      if (separator < 0 || fields.length <= separator + 2) fail("malformed /proc/self/mountinfo entry");
      return {
        path: decodeMountPath(fields[4] ?? ""),
        options: new Set((fields[5] ?? "").split(",")),
        type: fields[separator + 1] ?? "",
      };
    });
}

function decodeMountPath(value) {
  return value.replace(/\\(040|011|012|134)/g, (encoded) => ({
    "\\040": " ",
    "\\011": "\t",
    "\\012": "\n",
    "\\134": "\\",
  })[encoded] ?? encoded);
}

function assertMount(mounts, path, access, type, checks) {
  const mount = mounts.find((candidate) => candidate.path === path);
  check(Boolean(mount), `${path} is a distinct mount`, checks);
  if (!mount) return;
  check(mount.options.has(access), `${path} mount is ${access}`, checks);
  if (type) check(mount.type === type, `${path} mount type is ${type}`, checks);
}

function assertReadOnlyMarker(root, expected, checks) {
  const marker = join(root, ".peregrine-containment-marker");
  check(readFileSync(marker, "utf8").trim() === expected, `${root} marker is readable`, checks);
  assertDeniedWrite(join(root, `.peregrine-write-probe-${process.pid}`), checks);
}

function assertWritable(root, checks) {
  const target = join(root, `.peregrine-write-probe-${process.pid}`);
  try {
    writeFileSync(target, "probe\n", { encoding: "utf8", mode: 0o600 });
    check(readFileSync(target, "utf8") === "probe\n", `${root} is writable`, checks);
  } finally {
    rmSync(target, { force: true });
  }
}

function assertDeniedWrite(path, checks) {
  try {
    writeFileSync(path, "must not persist\n", { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    if (isDenied(error)) {
      checks.push(`${path} rejects writes`);
      return;
    }
    throw error;
  }
  rmSync(path, { force: true });
  fail(`${path} unexpectedly accepted a write`);
}

function assertDeniedRead(path, label, checks) {
  try {
    readFileSync(path);
  } catch (error) {
    if (isDenied(error)) {
      checks.push(`${label} is inaccessible`);
      return;
    }
    throw error;
  }
  fail(`${label} unexpectedly became readable`);
}

function isDenied(error) {
  return error instanceof Error && "code" in error && ["EACCES", "ENOENT", "ENOTDIR", "EROFS"].includes(error.code);
}

function assertProviderVersion(command, expected, checks) {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    env: {
      HOME: process.env.HOME ?? CONTRACT.mounts.home.path,
      PATH: process.env.PATH ?? "",
      TMPDIR: process.env.TMPDIR ?? CONTRACT.mounts.scratch.path,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? join(CONTRACT.mounts.home.path, "xdg-config"),
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? join(CONTRACT.mounts.home.path, "xdg-cache"),
      XDG_DATA_HOME: process.env.XDG_DATA_HOME ?? join(CONTRACT.mounts.home.path, "xdg-data"),
      DISABLE_AUTOUPDATER: "1",
      DISABLE_UPDATES: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    },
    timeout: 15_000,
  });
  check(result.status === 0, `${command} --version exits successfully`, checks);
  check(`${result.stdout}${result.stderr}`.includes(expected), `${command} version is ${expected}`, checks);
}

function check(condition, message, checks) {
  if (!condition) fail(message);
  checks.push(message);
}

function fail(message) {
  process.stderr.write(`containment probe failed: ${message}\n`);
  process.exit(1);
}
