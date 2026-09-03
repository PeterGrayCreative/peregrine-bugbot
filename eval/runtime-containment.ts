import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExecResult } from "../src/util/exec.js";
import { exec } from "../src/util/exec.js";
import type { ExperimentProviderAccess, ProviderExec, RunnerName } from "../src/types.js";

/** Independently accepted multi-arch runtime image; evaluation must use this exact digest. */
export const ACCEPTED_EVAL_RUNTIME_IMAGE =
  "ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:0186100efde64b85913efee1746a0cffd4f19368ce9eae0fa81b3eea6fc7c65c";

const CONTAINER_NAME = /^peregrine-eval-[a-f0-9-]{36}$/;
const PROVIDER_SECRET: Record<Exclude<RunnerName, "mock">, string> = {
  claude: "ANTHROPIC_API_KEY",
  codex: "OPENAI_API_KEY",
};
const SESSION_ENV: Record<Exclude<RunnerName, "mock">, string> = {
  claude: "PEREGRINE_CLAUDE_SESSION_DIR",
  codex: "PEREGRINE_CODEX_SESSION_DIR",
};
const SESSION_FILES: Record<Exclude<RunnerName, "mock">, readonly string[]> = {
  claude: [".credentials.json"],
  codex: ["auth.json"],
};
const SESSION_TARGET: Record<Exclude<RunnerName, "mock">, string> = {
  claude: "/home/peregrine/.claude",
  codex: "/home/peregrine/.codex",
};

export interface ContainedProviderOptions {
  runner: Exclude<RunnerName, "mock">;
  providerAccess: Exclude<ExperimentProviderAccess, "not-applicable">;
  checkoutDir: string;
  assetsDir: string;
  outputDir: string;
  image?: string;
  run?: typeof exec;
}

export interface ParsedContainedLaunch {
  image: string;
  containerName: string;
  network: "bridge";
  checkoutDir: string;
  assetsDir: string;
  outputDir: string;
  uid: number;
  gid: number;
  secretName?: string;
  sessionDir?: string;
  command: string;
  commandArgs: string[];
}

export function buildContainedProviderArgs(
  options: ContainedProviderOptions,
  command: string,
  commandArgs: readonly string[],
  containerName = `peregrine-eval-${randomUUID()}`,
): string[] {
  const image = options.image ?? ACCEPTED_EVAL_RUNTIME_IMAGE;
  assertImmutableImage(image);
  if (command !== options.runner) throw new Error("provider command does not match the selected runner");
  const checkoutDir = safeDirectory(options.checkoutDir, "checkout");
  const assetsDir = safeDirectory(options.assetsDir, "assets");
  const outputDir = safeDirectory(options.outputDir, "output");
  const identity = hostIdentity();
  const outputStat = lstatSync(outputDir);
  if (outputStat.uid !== identity.uid || (outputStat.mode & 0o077) !== 0) {
    throw new Error("attempt-owned output directory must be private and owned by the evaluator");
  }
  if (!CONTAINER_NAME.test(containerName)) throw new Error("invalid opaque evaluation container name");

  const access: string[] = [];
  if (options.providerAccess === "api-key") {
    const name = PROVIDER_SECRET[options.runner];
    if (!process.env[name]) throw new Error(`selected ${options.runner} API credential is unavailable`);
    access.push("--env", name);
  } else {
    const variable = SESSION_ENV[options.runner];
    const configured = process.env[variable];
    if (!configured) throw new Error(`selected ${options.runner} CLI session is unavailable`);
    const sessionDir = safeDirectory(configured, `${options.runner} CLI session`);
    assertSanitizedSessionDirectory(sessionDir, options.runner);
    access.push("--mount", bindMount(sessionDir, SESSION_TARGET[options.runner], true));
  }

  const translated = commandArgs.map((value) => translateArgument(value, checkoutDir, assetsDir, outputDir));
  const args = [
    "run", "--name", containerName, "--pull", "never",
    "--network", "bridge", "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--pids-limit", "256", "--user", `${identity.uid}:${identity.gid}`,
    "--workdir", "/workspace",
    "--mount", bindMount(checkoutDir, "/workspace", true),
    "--mount", bindMount(assetsDir, "/opt/peregrine", true),
    "--mount", bindMount(outputDir, "/output", false),
    "--tmpfs", `/tmp:rw,noexec,nosuid,nodev,size=64m,uid=${identity.uid},gid=${identity.gid}`,
    "--tmpfs", `/home/peregrine:rw,noexec,nosuid,nodev,size=128m,uid=${identity.uid},gid=${identity.gid}`,
    ...access,
    image, command, ...translated,
  ];
  parseContainedProviderArgs(args, options.runner, options.providerAccess, identity);
  return args;
}

function assertConfiguredAccess(options: ContainedProviderOptions): void {
  if (options.providerAccess === "api-key") {
    if (!process.env[PROVIDER_SECRET[options.runner]]) throw new Error(`selected ${options.runner} API credential is unavailable`);
    return;
  }
  const configured = process.env[SESSION_ENV[options.runner]];
  if (!configured) throw new Error(`selected ${options.runner} CLI session is unavailable`);
  assertSanitizedSessionDirectory(safeDirectory(configured, `${options.runner} CLI session`), options.runner);
}

/** Strict parser used by tests and immediately before every provider launch. */
export function parseContainedProviderArgs(
  args: readonly string[],
  runner: Exclude<RunnerName, "mock">,
  providerAccess: Exclude<ExperimentProviderAccess, "not-applicable">,
  expectedIdentity = hostIdentity(),
): ParsedContainedLaunch {
  let cursor = 0;
  const take = (expected?: string): string => {
    const value = args[cursor++];
    if (value === undefined || (expected !== undefined && value !== expected)) {
      throw new Error(`invalid contained provider argument${expected ? `; expected ${expected}` : ""}`);
    }
    return value;
  };
  take("run"); take("--name");
  const containerName = take();
  if (!CONTAINER_NAME.test(containerName)) throw new Error("invalid opaque evaluation container name");
  take("--pull"); take("never"); take("--network"); take("bridge");
  take("--read-only"); take("--cap-drop"); take("ALL");
  take("--security-opt"); take("no-new-privileges"); take("--pids-limit"); take("256");
  take("--user"); take(`${expectedIdentity.uid}:${expectedIdentity.gid}`); take("--workdir"); take("/workspace");
  take("--mount"); const checkoutDir = parseBindMount(take(), "/workspace", true);
  take("--mount"); const assetsDir = parseBindMount(take(), "/opt/peregrine", true);
  take("--mount"); const outputDir = parseBindMount(take(), "/output", false);
  take("--tmpfs"); take(`/tmp:rw,noexec,nosuid,nodev,size=64m,uid=${expectedIdentity.uid},gid=${expectedIdentity.gid}`);
  take("--tmpfs"); take(`/home/peregrine:rw,noexec,nosuid,nodev,size=128m,uid=${expectedIdentity.uid},gid=${expectedIdentity.gid}`);
  let secretName: string | undefined;
  let sessionDir: string | undefined;
  if (providerAccess === "api-key") {
    take("--env"); secretName = take();
    if (secretName !== PROVIDER_SECRET[runner]) throw new Error("unexpected provider secret name");
  } else {
    take("--mount");
    sessionDir = parseBindMount(take(), SESSION_TARGET[runner], true);
  }
  const image = take(); assertImmutableImage(image);
  const command = take();
  if (command !== runner) throw new Error("provider command does not match selected runner");
  const commandArgs = args.slice(cursor);
  validateProviderCommand(runner, commandArgs);
  return { image, containerName, network: "bridge", checkoutDir, assetsDir, outputDir,
    uid: expectedIdentity.uid, gid: expectedIdentity.gid,
    ...(secretName ? { secretName } : {}), ...(sessionDir ? { sessionDir } : {}), command, commandArgs };
}

function validateProviderCommand(runner: Exclude<RunnerName, "mock">, args: readonly string[]): void {
  const valueFlags = runner === "codex"
    ? new Set(["--config", "--model", "--cd", "--output-schema", "--output-last-message", "--sandbox", "--color"])
    : new Set(["--plugin-dir", "-p", "--output-format", "--json-schema", "--model", "--effort", "--max-turns", "--max-budget-usd", "--permission-mode", "--allowedTools", "--setting-sources"]);
  const switches = runner === "codex"
    ? new Set(["exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config", "--json", "-"])
    : new Set(["--bare", "--disable-slash-commands", "--strict-mcp-config", "--no-chrome", "--no-session-persistence"]);
  for (let index = 0; index < args.length; index++) {
    const value = args[index]!;
    if (switches.has(value)) continue;
    if (!valueFlags.has(value)) throw new Error(`unsupported ${runner} evaluation flag`);
    if (args[++index] === undefined) throw new Error(`missing value for ${runner} evaluation flag`);
  }
  const occurrence = (value: string) => args.filter((item) => item === value).length;
  const requireSwitch = (value: string) => {
    if (occurrence(value) !== 1) throw new Error(`${runner} evaluation requires exactly one ${value}`);
  };
  const requirePair = (flag: string, expected: string) => {
    if (occurrence(flag) !== 1 || args[args.indexOf(flag) + 1] !== expected) {
      throw new Error(`${runner} evaluation requires ${flag} ${expected}`);
    }
  };
  if (runner === "codex") {
    for (const flag of ["exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config", "--json", "-"]) requireSwitch(flag);
    requirePair("--sandbox", "read-only");
    requirePair("--color", "never");
    requirePair("--cd", "/workspace");
    const configs = args.flatMap((value, index) => value === "--config" ? [args[index + 1]!] : []);
    if (configs.length !== 4 || !configs.includes("project_doc_max_bytes=0") ||
      !configs.includes("project_doc_fallback_filenames=[]") ||
      !configs.includes('projects."/workspace".trust_level="untrusted"') ||
      configs.filter((value) => value.startsWith("model_reasoning_effort=")).length !== 1) {
      throw new Error("codex evaluation configuration flags are not the exact allowlisted set");
    }
  } else {
    for (const flag of ["--bare", "--disable-slash-commands", "--strict-mcp-config", "--no-chrome", "--no-session-persistence"]) requireSwitch(flag);
    requirePair("--setting-sources", "");
    requirePair("--permission-mode", "dontAsk");
    requirePair("--allowedTools", "Read,Grep,Glob");
    requirePair("--plugin-dir", "/opt/peregrine");
  }
}

export function createContainedProviderExec(options: ContainedProviderOptions): ProviderExec {
  const run = options.run ?? exec;
  return async (command, commandArgs, execOptions = {}) => {
    if (execOptions.inheritEnv !== false) throw new Error("contained provider execution requires an explicit isolated environment");
    const containerName = `peregrine-eval-${randomUUID()}`;
    const args = buildContainedProviderArgs(options, command, commandArgs, containerName);
    let result: ExecResult | undefined;
    let primary: unknown;
    try {
      assertConfiguredAccess(options);
      result = await run("docker", args, {
        timeoutMs: execOptions.timeoutMs,
        stdin: execOptions.stdin,
        env: dockerClientEnvironment(options, true),
        inheritEnv: false,
      });
    } catch (error) {
      primary = error;
    }
    const cleanup = await removeAndProveContainer(run, containerName, dockerClientEnvironment(options));
    if (primary !== undefined) throwWithCleanup(primary, cleanup);
    if (cleanup.length) return { ...result!, cleanupErrors: cleanup.map((error) => error.message) };
    return result!;
  };
}

/** Treat provider-created output as hostile, including directory-entry replacement races. */
export function createContainedOutputReader(
  outputRoot: string,
  maximumBytes = 4 * 1024 * 1024,
  expectedUid?: number,
): (path: string) => string {
  const root = safeDirectory(outputRoot, "output");
  const ownerUid = expectedUid ?? lstatSync(root).uid;
  const accepted = new Set<string>();
  return (path: string): string => {
    const resolvedParent = realpathSync(resolve(path, ".."));
    if (resolvedParent !== root && !resolvedParent.startsWith(`${root}${sep}`)) throw new Error("provider output escapes its attempt-owned directory");
    const canonicalPath = join(resolvedParent, path.split(sep).at(-1)!);
    const relativePath = relative(root, canonicalPath);
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error("invalid provider output path");
    const permitted = [...accepted, relativePath].sort();
    const observed: string[] = [];
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = join(directory, entry.name);
        const rel = relative(root, full);
        if (entry.isSymbolicLink()) throw new Error("provider output directory contains a symbolic link");
        if (entry.isDirectory()) {
          if (!permitted.some((item) => item.startsWith(`${rel}${sep}`))) throw new Error("provider output directory contains an unexpected directory");
          visit(full);
        } else if (entry.isFile()) observed.push(rel);
        else throw new Error("provider output directory contains a special file");
      }
    };
    visit(root);
    if (JSON.stringify(observed.sort()) !== JSON.stringify(permitted)) throw new Error("provider output directory contains an unexpected entry");
    const fd = openSync(canonicalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = fstatSync(fd);
      if (!before.isFile() || before.nlink !== 1 || before.uid !== ownerUid || (before.mode & 0o022) !== 0 || before.size > maximumBytes) {
        throw new Error("provider output failed regular-file ownership, mode, link-count, or size policy");
      }
      const value = readFileSync(fd, "utf8");
      const after = fstatSync(fd);
      const pathStat = lstatSync(canonicalPath);
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || pathStat.isSymbolicLink() || pathStat.dev !== after.dev || pathStat.ino !== after.ino) {
        throw new Error("provider output changed while it was being read");
      }
      accepted.add(relativePath);
      return value;
    } finally {
      closeSync(fd);
    }
  };
}

export async function probeContainedRuntime(options: ContainedProviderOptions): Promise<void> {
  const run = options.run ?? exec;
  const image = options.image ?? ACCEPTED_EVAL_RUNTIME_IMAGE;
  assertImmutableImage(image);
  if (process.platform !== "linux" && process.platform !== "darwin") {
    throw new Error(`unsupported evaluation host platform: ${process.platform}`);
  }
  const inspect = await run("docker", ["image", "inspect", "--format", "{{json .RepoDigests}}", image], {
    timeoutMs: 15_000, env: dockerClientEnvironment(options), inheritEnv: false,
  });
  if (inspect.code !== 0 || inspect.timedOut) throw new Error("accepted evaluation image is not available locally; automatic pulls are forbidden");
  const expected = image.slice(image.indexOf("@") + 1);
  if (!inspect.stdout.includes(expected)) throw new Error("local evaluation image digest does not match the accepted digest");

  const root = mkdtempSync(join(tmpdir(), "peregrine-containment-preflight-"));
  const checkout = join(root, "checkout"); const assets = join(root, "assets"); const output = join(root, "output");
  const sentinel = join(root, "host-only.txt"); const name = `peregrine-eval-${randomUUID()}`;
  let primary: unknown;
  try {
    for (const directory of [checkout, assets, output]) mkdirSync(directory);
    chmodSync(output, 0o777);
    writeFileSync(join(checkout, ".peregrine-containment-marker"), "checkout\n");
    writeFileSync(join(assets, ".peregrine-containment-marker"), "assets\n");
    writeFileSync(sentinel, "host-only\n");
    const probeArgs = [
      "run", "--name", name, "--pull", "never", "--network", "none", "--read-only",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "256", "--user", "1000:1000",
      "--env", `PEREGRINE_PROBE_HOST_SENTINEL=${sentinel}`,
      "--mount", bindMount(checkout, "/workspace", true), "--mount", bindMount(assets, "/opt/peregrine", true),
      "--mount", bindMount(output, "/output", false),
      "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m,uid=1000,gid=1000",
      "--tmpfs", "/home/peregrine:rw,noexec,nosuid,nodev,size=64m,uid=1000,gid=1000", image,
      "peregrine-containment-probe", "--check",
    ];
    const probe = await run("docker", probeArgs, { timeoutMs: 60_000, env: dockerClientEnvironment(options), inheritEnv: false });
    if (probe.code !== 0 || probe.timedOut) throw new Error("filesystem containment preflight failed");
    const report = JSON.parse(readFileSync(join(output, "containment-probe.json"), "utf8")) as { status?: unknown };
    if (report.status !== "passed") throw new Error("filesystem containment preflight did not attest success");
    if (options.providerAccess === "cli-session") await probeCliSessionMount(options, run, image);
  } catch (error) {
    primary = error;
  } finally {
    const cleanup = await removeAndProveContainer(run, name, dockerClientEnvironment(options));
    rmSync(root, { recursive: true, force: true });
    if (primary !== undefined) throwWithCleanup(primary, cleanup);
    if (cleanup.length) throw new AggregateError(cleanup, "containment preflight cleanup failed");
  }
}

async function probeCliSessionMount(
  options: ContainedProviderOptions,
  run: typeof exec,
  image: string,
): Promise<void> {
  assertConfiguredAccess(options);
  const identity = hostIdentity();
  const sessionDir = safeDirectory(process.env[SESSION_ENV[options.runner]]!, `${options.runner} CLI session`);
  const name = `peregrine-eval-${randomUUID()}`;
  let primary: unknown;
  try {
    const result = await run("docker", [
      "run", "--name", name, "--pull", "never", "--network", "none", "--read-only",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "32",
      "--user", `${identity.uid}:${identity.gid}`,
      "--tmpfs", `/tmp:rw,noexec,nosuid,nodev,size=16m,uid=${identity.uid},gid=${identity.gid}`,
      "--tmpfs", `/home/peregrine:rw,noexec,nosuid,nodev,size=16m,uid=${identity.uid},gid=${identity.gid}`,
      "--mount", bindMount(sessionDir, SESSION_TARGET[options.runner], true),
      image, options.runner, "--version",
    ], { timeoutMs: 15_000, env: dockerClientEnvironment(options), inheritEnv: false });
    if (result.code !== 0 || result.timedOut) throw new Error(`${options.runner} CLI-session nested mount probe failed`);
  } catch (error) {
    primary = error;
  }
  const cleanup = await removeAndProveContainer(run, name, dockerClientEnvironment(options));
  if (primary !== undefined) throwWithCleanup(primary, cleanup);
  if (cleanup.length) throw new AggregateError(cleanup, "CLI-session mount probe cleanup failed");
}

export function containedNetworkCapability() {
  return {
    status: "limited" as const,
    mechanism: "OCI mount isolation is attested; provider egress uses the Docker bridge without an independently attested destination allowlist.",
  };
}

export async function observeContainedCliVersion(
  runner: Exclude<RunnerName, "mock">,
  run: typeof exec = exec,
  image = ACCEPTED_EVAL_RUNTIME_IMAGE,
): Promise<ExecResult> {
  assertImmutableImage(image);
  const name = `peregrine-eval-${randomUUID()}`;
  let result: ExecResult | undefined;
  let primary: unknown;
  try {
    result = await run("docker", [
      "run", "--name", name, "--pull", "never", "--network", "none", "--read-only",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "32",
      "--user", "1000:1000", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m,uid=1000,gid=1000",
      "--tmpfs", "/home/peregrine:rw,noexec,nosuid,nodev,size=16m,uid=1000,gid=1000",
      image, runner, "--version",
    ], { timeoutMs: 15_000, env: { PATH: process.env.PATH ?? "" }, inheritEnv: false });
  } catch (error) {
    primary = error;
  }
  const cleanup = await removeAndProveContainer(run, name, { PATH: process.env.PATH ?? "" });
  if (primary !== undefined) throwWithCleanup(primary, cleanup);
  if (cleanup.length) throw new AggregateError(cleanup, "CLI version probe cleanup failed");
  return result!;
}

async function removeAndProveContainer(
  run: typeof exec,
  name: string,
  environment: Record<string, string>,
): Promise<Error[]> {
  const errors: Error[] = [];
  try {
    const removed = await run("docker", ["rm", "--force", name], {
      timeoutMs: 15_000, env: environment, inheritEnv: false,
    });
    if (removed.code !== 0 || removed.timedOut) errors.push(new Error("force-removing evaluation container failed"));
  } catch {
    errors.push(new Error("force-removing evaluation container failed"));
  }
  try {
    const survivor = await run("docker", ["ps", "--all", "--quiet", "--filter", `name=^/${name}$`], {
      timeoutMs: 10_000, env: environment, inheritEnv: false,
    });
    if (survivor.code !== 0 || survivor.timedOut) errors.push(new Error("could not prove evaluation container cleanup"));
    else if (survivor.stdout.trim()) errors.push(new Error("evaluation container survived force-removal"));
  } catch {
    errors.push(new Error("could not prove evaluation container cleanup"));
  }
  return errors;
}

function throwWithCleanup(primary: unknown, cleanup: Error[]): never {
  if (cleanup.length === 0) throw primary;
  throw new AggregateError([primary, ...cleanup], "evaluation operation and cleanup both failed");
}

function dockerClientEnvironment(options: ContainedProviderOptions, includeProviderSecret = false): Record<string, string> {
  const environment: Record<string, string> = { PATH: process.env.PATH ?? "" };
  if (includeProviderSecret && options.providerAccess === "api-key") {
    environment[PROVIDER_SECRET[options.runner]] = process.env[PROVIDER_SECRET[options.runner]]!;
  }
  return environment;
}

function translateArgument(value: string, checkout: string, assets: string, output: string): string {
  if (!isAbsolute(value)) return value;
  let absolute: string;
  try {
    absolute = realpathSync(value);
  } catch {
    absolute = join(realpathSync(resolve(value, "..")), value.split(sep).at(-1)!);
  }
  for (const [host, container] of [[checkout, "/workspace"], [assets, "/opt/peregrine"], [output, "/output"]] as const) {
    if (absolute === host || absolute.startsWith(`${host}${sep}`)) return join(container, relative(host, absolute));
  }
  throw new Error("provider argument references an undeclared host path");
}

function safeDirectory(value: string, label: string): string {
  if (!isAbsolute(value) || /[,\r\n\0]/.test(value)) throw new Error(`${label} must be an absolute mount-safe path`);
  const resolved = realpathSync(value);
  if (!lstatSync(resolved).isDirectory()) throw new Error(`${label} must be a regular directory`);
  return resolved;
}

function hostIdentity(): { uid: number; gid: number } {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid) || uid! <= 0 || gid! < 0) {
    throw new Error("evaluation containment requires a non-root numeric host identity");
  }
  return { uid: uid!, gid: gid! };
}

function assertSanitizedSessionDirectory(directory: string, runner: Exclude<RunnerName, "mock">): void {
  const identity = hostIdentity();
  const directoryStat = lstatSync(directory);
  if (directoryStat.uid !== identity.uid || (directoryStat.mode & 0o077) !== 0) {
    throw new Error(`${runner} CLI session directory must be private and owned by the evaluator`);
  }
  const expected = SESSION_FILES[runner];
  const entries = readdirSync(directory).sort();
  if (JSON.stringify(entries) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${runner} CLI session directory must contain only ${expected.join(", ")}`);
  }
  for (const entry of expected) {
    const stat = lstatSync(join(directory, entry));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== identity.uid || (stat.mode & 0o077) !== 0) {
      throw new Error(`${runner} CLI session file must be a private, single-link regular file`);
    }
  }
}

function assertImmutableImage(image: string): void {
  if (image !== ACCEPTED_EVAL_RUNTIME_IMAGE) {
    throw new Error("evaluation runtime image must equal the accepted immutable GHCR digest");
  }
}

function bindMount(source: string, target: string, readOnly: boolean): string {
  return `type=bind,source=${source},target=${target}${readOnly ? ",readonly" : ""}`;
}

function parseBindMount(value: string, target: string, readOnly: boolean): string {
  const fields = value.split(",");
  if (fields.length !== (readOnly ? 4 : 3) || fields[0] !== "type=bind" || !fields[1]?.startsWith("source=") || fields[2] !== `target=${target}` || (readOnly && fields[3] !== "readonly")) {
    throw new Error(`invalid ${target} bind mount`);
  }
  return safeDirectory(fields[1].slice("source=".length), `${target} source`);
}
