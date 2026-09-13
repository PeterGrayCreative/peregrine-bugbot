import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExecResult } from "../src/util/exec.js";
import {
  ACCEPTED_EVAL_RUNTIME_IMAGE,
  METHODOLOGY_EGRESS_RUNTIME_IMAGE,
  buildContainedProviderArgs,
  createContainedOutputReader,
  createContainedProviderExec,
  observeContainedCliVersion,
  parseContainedProviderArgs,
} from "../eval/runtime-containment.js";
import {
  ACCEPTED_METHODOLOGY_EGRESS_IMAGE,
  createStructuralMockMethodologyEgressSupervisor,
  METHODOLOGY_EGRESS_BASE_ENV,
} from "../eval/methodology-egress.js";
import { parseMatrixRunManifest } from "../eval/artifacts.js";
import type { exec } from "../src/util/exec.js";

const image = ACCEPTED_EVAL_RUNTIME_IMAGE;

function roots() {
  const root = mkdtempSync(join(tmpdir(), "peregrine-runtime-test-"));
  const checkoutDir = join(root, "checkout");
  const assetsDir = join(root, "assets");
  const outputDir = join(root, "output");
  for (const path of [checkoutDir, assetsDir]) mkdirSync(path);
  mkdirSync(outputDir, { mode: 0o700 });
  return { root, checkoutDir, assetsDir, outputDir };
}

const codexCommand = (paths: ReturnType<typeof roots>, extra: string[] = []) => [
  "exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config",
  "--config", "project_doc_max_bytes=0", "--config", "project_doc_fallback_filenames=[]",
  "--config", 'projects."/workspace".trust_level="untrusted"',
  "--config", 'model_reasoning_effort="medium"',
  "--sandbox", "read-only", "--color", "never", "--cd", paths.checkoutDir,
  "--json", ...extra, "-",
];

const methodologyCodexCommand = (paths: ReturnType<typeof roots>) => [
  "exec", "--ephemeral", "--ignore-user-config", "--ignore-rules",
  "--config", "project_doc_max_bytes=0", "--config", "project_doc_fallback_filenames=[]",
  "--config", 'projects."/workspace".trust_level="untrusted"',
  "--disable", "shell_tool", "--disable", "unified_exec",
  "--config", 'mcp_servers.source_read.url="http://host.docker.internal:43123/mcp/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
  "--config", 'mcp_servers.source_read.enabled_tools=["list_tree","read_file","search_text"]',
  "--config", "mcp_servers.source_read.required=true",
  "--strict-config", "--sandbox", "read-only", "--model", "gpt-5.6-sol",
  "--config", 'model_reasoning_effort="high"', "--cd", paths.checkoutDir,
  "--output-schema", join(paths.assetsDir, "schemas", "methodology-review.schema.json"),
  "--output-last-message", join(paths.outputDir, "methodology-test", "stage-1.json"),
  "--json", "--color", "never", "-",
];

function fakeMethodologyEgressDocker() {
  let internal = ""; let external = ""; let subnet = ""; let externalSubnet = "";
  let gateway = ""; let forwarder = "";
  const envs = new Map<string, string[]>();
  const stopped = new Set<string>();
  const result = (stdout = "", code = 0): ExecResult => ({ stdout, stderr: "", code, timedOut: false });
  const digest = (protocol: string, body: Record<string, unknown>): string =>
    createHash("sha256").update(`${protocol}\0${JSON.stringify(body)}`).digest("hex");
  return async (_command: string, args: string[]): Promise<ExecResult> => {
    if (args[0] === "network" && args[1] === "create") {
      if (args.includes("--internal")) { internal = args.at(-1)!; subnet = args[7]!; }
      else { external = args.at(-1)!; externalSubnet = args[6]!; }
      return result(`${args.at(-1)!}\n`);
    }
    if (args[0] === "run") {
      const name = args[3]!;
      if (args.includes("/usr/local/bin/peregrine-egress-gateway")) gateway = name;
      else forwarder = name;
      envs.set(name, args.flatMap((value, index) => value === "--env" && args[index + 1] ? [args[index + 1]!] : []));
      return result();
    }
    if (args[0] === "logs") {
      const name = args.at(-1)!;
      if (!stopped.has(name)) return result(JSON.stringify({ status: "ready", protocol: name === gateway ? "egress-gateway-v1" : "methodology-mcp-forwarder-v1", ready: true }) + "\n");
      if (name === gateway) {
        const body = { schemaVersion: 1, protocol: "egress-gateway-audit-v1", events: [] };
        return result(JSON.stringify({ status: "sealed", protocol: "egress-gateway-v1", audit: { ...body, sealed: true, sha256: digest("egress-gateway-audit-v1", body) } }));
      }
      const body = { schemaVersion: 1, protocol: "methodology-mcp-forwarder-audit-v1", sealed: true, requests: { observed: 0, allowed: 0, denied: 0, forwarded: 0, budgeted: 0 }, events: [] };
      return result(JSON.stringify({ status: "sealed", protocol: "methodology-mcp-forwarder-v1", audit: { ...body, snapshotSha256: digest("methodology-mcp-forwarder-audit-v1", body) } }));
    }
    if (args[0] === "stop") { stopped.add(args.at(-1)!); return result(); }
    if (args[0] === "inspect") {
      const homeTmpfs = "rw,noexec,nosuid,nodev,size=16m,uid=65532,gid=65532,mode=0700";
      return result(JSON.stringify([gateway, forwarder].map((name) => ({
        Name: `/${name}`,
        Path: name === gateway ? "/usr/local/bin/peregrine-egress-gateway" : "/usr/local/bin/peregrine-methodology-mcp-forwarder",
        Args: [], State: { Running: true }, Mounts: [{ Type: "tmpfs", Destination: "/tmp" }, { Type: "tmpfs", Destination: "/home/peregrine" }],
        Config: { Image: ACCEPTED_METHODOLOGY_EGRESS_IMAGE, Entrypoint: [name === gateway ? "/usr/local/bin/peregrine-egress-gateway" : "/usr/local/bin/peregrine-methodology-mcp-forwarder"], Env: [...METHODOLOGY_EGRESS_BASE_ENV, ...(envs.get(name) ?? [])] },
        HostConfig: { ReadonlyRootfs: true, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"], PidsLimit: 64, User: "65532:65532", Tmpfs: { "/tmp": "rw,noexec,nosuid,nodev,size=32m,uid=65532,gid=65532,mode=1777", "/home/peregrine": homeTmpfs }, ExtraHosts: name === gateway ? [] : ["host.docker.internal:host-gateway"] },
        NetworkSettings: { Networks: { [external]: { Aliases: [name], IPAddress: `${externalSubnet.replace(".0/28", name === gateway ? ".2" : ".3")}` }, [internal]: { Aliases: [name === gateway ? "egress-gateway" : "mcp-forwarder", name], IPAddress: `${subnet.replace(".0/28", name === gateway ? ".2" : ".3")}` } } },
      }))));
    }
    if (args[0] === "network" && args[1] === "inspect") {
      const name = args[2]!; const isInternal = name === internal; const selected = isInternal ? subnet : externalSubnet;
      return result(JSON.stringify([{ Name: name, Driver: "bridge", Internal: isInternal, EnableIPv6: false, IPAM: { Config: [{ Subnet: selected }] }, Containers: { gateway: { Name: `/${gateway}`, IPv4Address: `${selected.replace(".0/28", ".2")}/28`, IPv6Address: "" }, forwarder: { Name: `/${forwarder}`, IPv4Address: `${selected.replace(".0/28", ".3")}/28`, IPv6Address: "" } } }]));
    }
    return result();
  };
}

test("API-key launch is immutable, no-pull, narrow, and passes only a credential name", () => {
  const paths = roots();
  process.env.OPENAI_API_KEY = "must-not-appear";
  const args = buildContainedProviderArgs(
    { runner: "codex", providerAccess: "api-key", image, ...paths },
    "codex", codexCommand(paths, ["--output-last-message", join(paths.outputDir, "result.json")]),
    "peregrine-eval-00000000-0000-4000-8000-000000000000",
  );
  const parsed = parseContainedProviderArgs(args, "codex", "api-key");
  assert.equal(parsed.secretName, "OPENAI_API_KEY");
  assert.equal(parsed.network, "bridge");
  assert.ok(parsed.commandArgs.includes("/workspace"));
  assert.ok(parsed.commandArgs.includes("/output/result.json"));
  assert.equal(args.includes("must-not-appear"), false);
  assert.equal(args.includes("never"), true);
  assert.equal(args.filter((value) => value === "--interactive").length, 1);
  assert.equal(args.some((value) => value.includes("docker.sock") || value === "/"), false);
});

test("CLI-session launch mounts only the selected provider session and never falls back to a key", () => {
  const paths = roots();
  const session = join(paths.root, "codex-session"); mkdirSync(session, { mode: 0o700 });
  writeFileSync(join(session, "auth.json"), "{}", { mode: 0o600 });
  process.env.PEREGRINE_CODEX_SESSION_DIR = session;
  process.env.OPENAI_API_KEY = "must-not-be-selected";
  const args = buildContainedProviderArgs(
    { runner: "codex", providerAccess: "cli-session", image, ...paths }, "codex", codexCommand(paths),
    "peregrine-eval-00000000-0000-4000-8000-000000000001",
  );
  const parsed = parseContainedProviderArgs(args, "codex", "cli-session");
  const resolvedSession = realpathSync(session);
  assert.equal(parsed.sessionDir, resolvedSession);
  assert.equal(parsed.secretName, undefined);
  assert.equal(args.includes("OPENAI_API_KEY"), false);
  assert.equal(args.some((value) => value === `type=bind,source=${resolvedSession},target=/home/peregrine/.codex,readonly`), false);
  assert.equal(args.some((value) => value === `type=bind,source=${join(resolvedSession, "auth.json")},target=/home/peregrine/.codex/auth.json,readonly`), true);
  assert.equal(args.some((value) => value.startsWith("/home/peregrine/.codex:rw,noexec,nosuid,nodev,")), true);
  assert.throws(() => parseContainedProviderArgs(args, "claude", "cli-session"));

  const directoryMount = [...args];
  directoryMount[directoryMount.findIndex((value) => value.includes("target=/home/peregrine/.codex/auth.json"))] =
    `type=bind,source=${session},target=/home/peregrine/.codex/auth.json,readonly`;
  assert.throws(() => parseContainedProviderArgs(directoryMount, "codex", "cli-session"), /source must be a regular file/);

  const writableAuth = [...args];
  const authIndex = writableAuth.findIndex((value) => value.includes("target=/home/peregrine/.codex/auth.json"));
  writableAuth[authIndex] = writableAuth[authIndex]!.replace(",readonly", "");
  assert.throws(() => parseContainedProviderArgs(writableAuth, "codex", "cli-session"), /invalid \/home\/peregrine\/\.codex\/auth\.json bind mount/);
});

test("mutations that weaken mounts, pull policy, privileges, or image identity are rejected", () => {
  const paths = roots(); process.env.OPENAI_API_KEY = "x";
  const original = buildContainedProviderArgs(
    { runner: "codex", providerAccess: "api-key", image, ...paths }, "codex", codexCommand(paths),
    "peregrine-eval-00000000-0000-4000-8000-000000000002",
  );
  for (const mutate of [
    (args: string[]) => { args[args.indexOf("never")] = "always"; },
    (args: string[]) => { args.splice(args.indexOf("--interactive"), 1); },
    (args: string[]) => {
      const index = args.findIndex((value) => value.startsWith("/home/peregrine/.codex:"));
      args.splice(index - 1, 2);
    },
    (args: string[]) => {
      const index = args.findIndex((value) => value.startsWith("/home/peregrine/.codex:"));
      args[index] = args[index]!.replace("mode=0700", "mode=0777");
    },
    (args: string[]) => { args.splice(args.indexOf("--read-only"), 1); },
    (args: string[]) => { args[args.findIndex((value) => value.includes("target=/workspace"))] = `type=bind,source=${paths.checkoutDir},target=/workspace`; },
    (args: string[]) => { args[args.indexOf(image)] = "peregrine:latest"; },
    (args: string[]) => { args.splice(args.indexOf(image), 0, "--volume", "/:/host"); },
    (args: string[]) => { args[args.indexOf("read-only")] = "danger-full-access"; },
    (args: string[]) => { args.splice(args.indexOf("--ignore-rules"), 0, "--ignore-rules"); },
  ]) {
    const changed = [...original]; mutate(changed);
    assert.throws(() => parseContainedProviderArgs(changed, "codex", "api-key"));
  }
});

test("fake contained launch keeps Docker stdin open and delivers the prompt", async () => {
  const paths = roots(); process.env.OPENAI_API_KEY = "x";
  const prompt = "PEREGRINE_ROLE: breadth-worker\nInspect the changed invariant.";
  let delivered = "";
  const fake: typeof exec = async (_cmd, args, options) => {
    if (args[0] === "run") {
      assert.equal(args.includes("--interactive"), true);
      delivered = options?.stdin ?? "";
    }
    return { stdout: "", stderr: "", code: 0, timedOut: false };
  };
  const run = createContainedProviderExec({ runner: "codex", providerAccess: "api-key", image, ...paths, run: fake });
  const result = await run("codex", codexCommand(paths), { inheritEnv: false, stdin: prompt });
  assert.equal(result.code, 0);
  assert.equal(delivered, prompt);
});

test("a different well-formed runtime digest is rejected before launch", () => {
  const paths = roots(); process.env.OPENAI_API_KEY = "x";
  const differentDigest = `ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:${"a".repeat(64)}`;
  assert.notEqual(differentDigest, ACCEPTED_EVAL_RUNTIME_IMAGE);
  assert.throws(() => buildContainedProviderArgs(
    { runner: "codex", providerAccess: "api-key", image: differentDigest, ...paths }, "codex", codexCommand(paths),
    "peregrine-eval-00000000-0000-4000-8000-000000000005",
  ), /must equal the accepted immutable GHCR digest/);

  const accepted = buildContainedProviderArgs(
    { runner: "codex", providerAccess: "api-key", image, ...paths }, "codex", codexCommand(paths),
    "peregrine-eval-00000000-0000-4000-8000-000000000006",
  );
  accepted[accepted.indexOf(image)] = differentDigest;
  assert.throws(
    () => parseContainedProviderArgs(accepted, "codex", "api-key"),
    /must equal the accepted immutable GHCR digest/,
  );
});

test("strict launch parsing supports a deterministic non-1000 host identity", () => {
  const paths = roots(); process.env.OPENAI_API_KEY = "x";
  const args = buildContainedProviderArgs(
    { runner: "codex", providerAccess: "api-key", image, ...paths }, "codex", codexCommand(paths),
    "peregrine-eval-00000000-0000-4000-8000-000000000003",
  );
  const actual = `${process.getuid!()}:${process.getgid!()}`;
  args[args.indexOf(actual)] = "4242:4343";
  for (let index = 0; index < args.length; index++) {
    args[index] = args[index]!.replace(`uid=${process.getuid!()},gid=${process.getgid!()}`, "uid=4242,gid=4343");
  }
  const parsed = parseContainedProviderArgs(args, "codex", "api-key", { uid: 4242, gid: 4343 });
  assert.equal(parsed.uid, 4242);
  assert.equal(parsed.gid, 4343);
});

test("every Codex isolation flag is unique and value-bound", () => {
  const paths = roots(); process.env.OPENAI_API_KEY = "x";
  const original = buildContainedProviderArgs(
    { runner: "codex", providerAccess: "api-key", image, ...paths }, "codex", codexCommand(paths),
    "peregrine-eval-00000000-0000-4000-8000-000000000004",
  );
  const commandStart = original.indexOf("codex") + 1;
  for (const flag of ["--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config", "--json"]) {
    const changed = [...original]; changed.splice(changed.indexOf(flag, commandStart), 1);
    assert.throws(() => parseContainedProviderArgs(changed, "codex", "api-key"));
  }
  for (const [flag, bad] of [["--sandbox", "danger-full-access"], ["--color", "always"], ["--cd", "/tmp"]] as const) {
    const changed = [...original]; changed[changed.indexOf(flag, commandStart) + 1] = bad;
    assert.throws(() => parseContainedProviderArgs(changed, "codex", "api-key"));
  }
  const duplicateConfig = [...original];
  duplicateConfig.splice(duplicateConfig.indexOf(image), 0, "--config", "project_doc_max_bytes=0");
  assert.throws(() => parseContainedProviderArgs(duplicateConfig, "codex", "api-key"));
});

test("methodology profile admits only Sol-high with neutral MCP reads and no built-in shell", () => {
  const paths = roots(); process.env.OPENAI_API_KEY = "x";
  mkdirSync(join(paths.assetsDir, "schemas"));
  mkdirSync(join(paths.outputDir, "methodology-test"));
  const original = buildContainedProviderArgs(
    { runner: "codex", providerAccess: "api-key", image, ...paths, profile: "methodology-review" },
    "codex", methodologyCodexCommand(paths),
    "peregrine-eval-00000000-0000-4000-8000-000000000007",
  );
  assert.equal(parseContainedProviderArgs(
    original, "codex", "api-key", undefined, "methodology-review",
  ).profile, "methodology-review");
  assert.equal(original[original.indexOf("--add-host") + 1], "host.docker.internal:host-gateway");
  for (const mutate of [
    (args: string[]) => { args[args.indexOf("host.docker.internal:host-gateway")] = "host.docker.internal:1.2.3.4"; },
    (args: string[]) => { args.splice(args.indexOf("--disable"), 2); },
    (args: string[]) => { args[args.indexOf("gpt-5.6-sol")] = "gpt-5.6-luna"; },
    (args: string[]) => {
      const index = args.findIndex((value) => value.startsWith("mcp_servers.source_read.url="));
      args[index] = 'mcp_servers.source_read.url="http://example.com/mcp/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"';
    },
    (args: string[]) => {
      const index = args.findIndex((value) => value.startsWith("mcp_servers.source_read.enabled_tools="));
      args[index] = 'mcp_servers.source_read.enabled_tools=["list_tree","read_file","search_text","shell"]';
    },
  ]) {
    const changed = [...original]; mutate(changed);
    assert.throws(() => parseContainedProviderArgs(
      changed, "codex", "api-key", undefined, "methodology-review",
    ));
  }
});

test("methodology egress accepts only a supervisor-issued launch capability", async () => {
  const paths = roots(); process.env.OPENAI_API_KEY = "x";
  mkdirSync(join(paths.assetsDir, "schemas"));
  mkdirSync(join(paths.outputDir, "methodology-test"));
  const command = methodologyCodexCommand(paths).map((value) => value.replace(
    "http://host.docker.internal:43123/mcp/",
    "http://mcp-forwarder:8082/mcp/",
  ));
  const internalMcpUrl = JSON.parse(command.find((value) => value.startsWith("mcp_servers.source_read.url="))!.split("=", 2)[1]!);
  const plainDescriptor = { network: "attacker-network", proxyUrl: "http://egress-gateway:8081", internalMcpUrl, attestationSha256: "a".repeat(64) } as const;
  assert.throws(() => buildContainedProviderArgs(
    { runner: "codex", providerAccess: "api-key", image: METHODOLOGY_EGRESS_RUNTIME_IMAGE, ...paths, profile: "methodology-review", methodologyEgress: plainDescriptor as never },
    "codex", command,
    "peregrine-eval-00000000-0000-4000-8000-000000000008",
  ), /launch capability/);

  const structuralRun = fakeMethodologyEgressDocker();
  const supervisor = await createStructuralMockMethodologyEgressSupervisor({
    attemptId: "attempt-000001", armId: "A", sourceHeadTree: "a".repeat(40),
    providerAuthorities: ["api.openai.com:443"], hostMcpPort: 43123,
    mcpLimits: { maxRequestBytes: 4096, maxResponseBytes: 8192, maxHeaderBytes: 8192, requestTimeoutMs: 500, maxConnections: 4, maxRequests: 20 },
    run: structuralRun,
  });
  try {
    const capability = supervisor.launchCapability;
    const args = buildContainedProviderArgs(
      { runner: "codex", providerAccess: "api-key", image: METHODOLOGY_EGRESS_RUNTIME_IMAGE, ...paths, profile: "methodology-review", methodologyEgress: capability, run: structuralRun },
      "codex", command.map((value) => value.replace(internalMcpUrl, capability.internalMcpUrl)),
      "peregrine-eval-00000000-0000-4000-8000-000000000008",
    );
    const parsed = parseContainedProviderArgs(args, "codex", "api-key", undefined, "methodology-review", capability);
    assert.equal(parsed.network, capability.network);
    assert.equal(parsed.methodologyEgress, capability);
    assert.equal(args.includes("--add-host"), false);
    assert.equal(args.includes("host.docker.internal:host-gateway"), false);
    assert.equal(args.includes("HTTPS_PROXY=http://egress-gateway:8081"), true);
    assert.equal(args.includes("NO_PROXY=mcp-forwarder:8082"), true);
    assert.equal(args.some((value) => /(?:^|=)(?:HTTP|HTTPS|ALL|NO)_PROXY(?:=|$)/u.test(value) &&
      !["HTTPS_PROXY=http://egress-gateway:8081", "NO_PROXY=mcp-forwarder:8082"].some((allowed) => value.includes(allowed))), false);

    const missingAttestation = { ...plainDescriptor, network: capability.network, internalMcpUrl: capability.internalMcpUrl };
    assert.throws(() => parseContainedProviderArgs(args, "codex", "api-key", undefined, "methodology-review", missingAttestation as never));

    for (const mutate of [
      (changed: string[]) => { changed[changed.indexOf(capability.network)] = "bridge"; },
      (changed: string[]) => { changed[changed.indexOf("HTTPS_PROXY=http://egress-gateway:8081")] = "HTTPS_PROXY=http://user:password@egress-gateway:8081"; },
      (changed: string[]) => { changed[changed.indexOf("NO_PROXY=mcp-forwarder:8082")] = "NO_PROXY=*"; },
      (changed: string[]) => {
        const index = changed.findIndex((value) => value.startsWith('mcp_servers.source_read.url='));
        changed[index] = changed[index]!.replace("mcp-forwarder:8082", "host.docker.internal:43123");
      },
    ]) {
      const changed = [...args]; mutate(changed);
      assert.throws(() => parseContainedProviderArgs(
        changed, "codex", "api-key", undefined, "methodology-review", capability,
      ));
    }
  } finally {
    await supervisor.close();
  }
});

test("timed-out provider containers are force-removed and checked for survivors", async () => {
  const paths = roots(); process.env.OPENAI_API_KEY = "x";
  const calls: string[][] = [];
  const fake = async (_cmd: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "ps") return { stdout: "", stderr: "", code: 0, timedOut: false };
    if (args[0] === "rm") return { stdout: "", stderr: "", code: 0, timedOut: false };
    return { stdout: "", stderr: "", code: null, timedOut: true };
  };
  const run = createContainedProviderExec({ runner: "codex", providerAccess: "api-key", image, ...paths, run: fake });
  const result = await run("codex", codexCommand(paths), { inheritEnv: false, timeoutMs: 1 });
  assert.equal(result.timedOut, true);
  assert.deepEqual(calls.map((args) => args.slice(0, 2)), [["run", "--name"], ["rm", "--force"], ["ps", "--all"]]);
});

test("outer attempt deadline reaches provider exec but cannot cancel containment cleanup", async () => {
  const paths = roots(); process.env.OPENAI_API_KEY = "synthetic-only";
  const deadline = new AbortController(), signals: (AbortSignal | undefined)[] = [];
  const fake: typeof exec = async (_cmd, args, options = {}) => {
    signals.push(options.deadlineSignal);
    if (args[0] === "run") { deadline.abort(); return { stdout: "retained partial", stderr: "", code: null, timedOut: true }; }
    return { stdout: "", stderr: "", code: 0, timedOut: false };
  };
  const run = createContainedProviderExec({ runner: "codex", providerAccess: "api-key", image, ...paths, run: fake });
  const result = await run("codex", codexCommand(paths), { inheritEnv: false, deadlineSignal: deadline.signal });
  assert.equal(result.stdout, "retained partial"); assert.equal(result.timedOut, true);
  assert.deepEqual(signals, [deadline.signal, undefined, undefined]);
  assert.equal(result.cleanupErrors, undefined);
});

test("provider and version probes preserve primary failures while proving cleanup", async () => {
  const paths = roots(); process.env.OPENAI_API_KEY = "x";
  const fake = async (_cmd: string, args: string[]) => {
    if (args[0] === "run") throw new Error("primary sentinel");
    if (args[0] === "rm") return { stdout: "", stderr: "rm failed", code: 1, timedOut: false };
    return { stdout: "container-id\n", stderr: "", code: 0, timedOut: false };
  };
  const provider = createContainedProviderExec({ runner: "codex", providerAccess: "api-key", image, ...paths, run: fake });
  await assert.rejects(() => provider("codex", codexCommand(paths), { inheritEnv: false }), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.match(String(error.errors[0]), /primary sentinel/);
    assert.equal(error.errors.length, 3);
    return true;
  });
  await assert.rejects(() => observeContainedCliVersion("codex", fake, image), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.match(String(error.errors[0]), /primary sentinel/);
    assert.equal(error.errors.length, 3);
    return true;
  });
});

test("returned provider timeouts retain their result when cleanup also fails", async () => {
  const paths = roots(); process.env.OPENAI_API_KEY = "x";
  const fake = async (_cmd: string, args: string[]) => {
    if (args[0] === "run") return { stdout: '{"type":"turn.completed","usage":{"input_tokens":7,"output_tokens":2}}\n', stderr: "", code: null, timedOut: true };
    if (args[0] === "rm") return { stdout: "", stderr: "rm failed", code: 1, timedOut: false };
    return { stdout: "container-id\n", stderr: "", code: 0, timedOut: false };
  };
  const provider = createContainedProviderExec({ runner: "codex", providerAccess: "api-key", image, ...paths, run: fake });
  const result = await provider("codex", codexCommand(paths), { inheritEnv: false });
  assert.equal(result.timedOut, true);
  assert.equal(result.stdout.includes("input_tokens"), true);
  assert.deepEqual(result.cleanupErrors, [
    "force-removing evaluation container failed",
    "evaluation container survived force-removal",
  ]);
});

test("CLI-session inputs must remain private, owned, single-link files", () => {
  const paths = roots();
  const session = join(paths.root, "session"); mkdirSync(session, { mode: 0o755 });
  writeFileSync(join(session, "auth.json"), "{}", { mode: 0o600 });
  process.env.PEREGRINE_CODEX_SESSION_DIR = session;
  assert.throws(() => buildContainedProviderArgs(
    { runner: "codex", providerAccess: "cli-session", image, ...paths }, "codex", codexCommand(paths),
  ), /session directory must be private/);
  chmodSync(session, 0o700);
  chmodSync(join(session, "auth.json"), 0o644);
  assert.throws(() => buildContainedProviderArgs(
    { runner: "codex", providerAccess: "cli-session", image, ...paths }, "codex", codexCommand(paths),
  ), /session file must be a private/);
});

test("provider output reader rejects symlinks, hardlinks, writable files, oversize files, and extras", () => {
  const paths = roots();
  const uid = process.getuid!();
  const target = join(paths.outputDir, "result.json");
  writeFileSync(target, "{}", { mode: 0o600 });
  assert.equal(createContainedOutputReader(paths.outputDir, 16, uid)(target), "{}");

  const symlinkRoot = roots(); writeFileSync(join(symlinkRoot.root, "outside"), "secret");
  symlinkSync(join(symlinkRoot.root, "outside"), join(symlinkRoot.outputDir, "result.json"));
  assert.throws(() => createContainedOutputReader(symlinkRoot.outputDir, 16, uid)(join(symlinkRoot.outputDir, "result.json")));

  const hardRoot = roots(); writeFileSync(join(hardRoot.outputDir, "result.json"), "{}");
  linkSync(join(hardRoot.outputDir, "result.json"), join(hardRoot.root, "linked"));
  assert.throws(() => createContainedOutputReader(hardRoot.outputDir, 16, uid)(join(hardRoot.outputDir, "result.json")));

  const modeRoot = roots(); writeFileSync(join(modeRoot.outputDir, "result.json"), "{}"); chmodSync(join(modeRoot.outputDir, "result.json"), 0o622);
  assert.throws(() => createContainedOutputReader(modeRoot.outputDir, 16, uid)(join(modeRoot.outputDir, "result.json")));

  const sizeRoot = roots(); writeFileSync(join(sizeRoot.outputDir, "result.json"), "too large");
  assert.throws(() => createContainedOutputReader(sizeRoot.outputDir, 2, uid)(join(sizeRoot.outputDir, "result.json")));

  const extraRoot = roots(); writeFileSync(join(extraRoot.outputDir, "result.json"), "{}"); writeFileSync(join(extraRoot.outputDir, "extra"), "x");
  assert.throws(() => createContainedOutputReader(extraRoot.outputDir, 16, uid)(join(extraRoot.outputDir, "result.json")));
});

test("schema-v2 evidence records filesystem and network capability separately", () => {
  const manifest = {
    schemaVersion: 2,
    createdAt: "2026-09-03T00:00:00.000Z",
    expectedAttempts: [{
      id: "attempt-000001", caseName: "development/case-aabbccdd", corpus: "development",
      expectedBugCount: 1, configName: "luna-medium", repeat: 1,
      file: "attempt-000001.json", runner: "codex",
    }],
    providerNetworkIsolation: { codex: { status: "limited", mechanism: "bridge egress; no destination allowlist" } },
    providerFilesystemIsolation: { codex: { status: "enforced", mechanism: "digest-pinned OCI mounts" } },
    runtimeImage: { reference: image, pullPolicy: "never" },
  };
  assert.doesNotThrow(() => parseMatrixRunManifest(manifest));
  assert.throws(() => parseMatrixRunManifest({ ...manifest, runtimeImage: { reference: `ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:${"a".repeat(64)}`, pullPolicy: "never" } }), /must equal the accepted/);
  assert.throws(() => parseMatrixRunManifest({ ...manifest, providerFilesystemIsolation: { codex: { status: "limited", mechanism: "weak" } } }), /must be enforced/);
  assert.throws(() => parseMatrixRunManifest({ ...manifest, providerNetworkIsolation: { codex: { status: "enforced", mechanism: "overclaim" } } }), /must be limited/);
});
