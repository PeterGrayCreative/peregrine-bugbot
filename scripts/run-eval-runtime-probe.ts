import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLATFORM = new Set(["linux/amd64", "linux/arm64"]);
const DIGEST_IMAGE = /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/;
const LOCAL_IMAGE = /^[a-z0-9][a-z0-9./:_-]*$/;
const CONTAINER_NAME = /^[a-z0-9][a-z0-9_.-]{0,127}$/;
const HOST_SENTINEL_ENV = "PEREGRINE_PROBE_HOST_SENTINEL";

export interface ProbeLaunchOptions {
  image: string;
  containerName: string;
  checkoutDir: string;
  assetsDir: string;
  outputDir: string;
  hostSentinel: string;
  platform?: "linux/amd64" | "linux/arm64";
}

export interface ParsedProbeLaunch {
  image: string;
  containerName: string;
  checkoutDir: string;
  assetsDir: string;
  outputDir: string;
  hostSentinel: string;
  platform?: "linux/amd64" | "linux/arm64";
  pull: boolean;
}

export interface ProbeProcessResult {
  error?: Error;
  status: number | null;
  stderr?: string | Buffer | null;
}

export interface ProbeRuntime {
  spawn(command: string, args: readonly string[], options: Record<string, unknown>): ProbeProcessResult;
}

const systemRuntime: ProbeRuntime = {
  spawn(command, args, options) {
    return spawnSync(command, args, options);
  },
};

export function buildProbeDockerArgs(options: ProbeLaunchOptions): string[] {
  validateOptions(options);
  const platformArgs = options.platform
    ? ["--platform", options.platform, "--pull", "always"]
    : [];
  const args = [
    "run",
    "--rm",
    "--name", options.containerName,
    ...platformArgs,
    "--network", "none",
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--pids-limit", "256",
    "--user", "1000:1000",
    "--env", `${HOST_SENTINEL_ENV}=${options.hostSentinel}`,
    "--mount", bindMount(options.checkoutDir, "/workspace", true),
    "--mount", bindMount(options.assetsDir, "/opt/peregrine", true),
    "--mount", bindMount(options.outputDir, "/output", false),
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m,uid=1000,gid=1000",
    "--tmpfs", "/home/peregrine:rw,noexec,nosuid,nodev,size=64m,uid=1000,gid=1000",
    options.image,
  ];
  parseProbeDockerArgs(args);
  return args;
}

/** Remove a platform-specific pull before the next architecture reuses its index digest. */
export function buildProbeImageCleanupArgs(
  image: string,
  platform: ProbeLaunchOptions["platform"],
): string[] {
  if (!platform || !PLATFORM.has(platform)) throw new Error("probe image cleanup requires a supported platform");
  if (!DIGEST_IMAGE.test(image)) throw new Error("probe image cleanup requires an immutable image digest");
  return ["image", "rm", "--force", image];
}

export function buildProbeImageAbsenceArgs(image: string): string[] {
  if (!DIGEST_IMAGE.test(image)) throw new Error("probe image absence check requires an immutable image digest");
  return ["image", "inspect", image];
}

/** Strictly parse the one supported probe launch shape; extra or reordered flags fail. */
export function parseProbeDockerArgs(args: readonly string[]): ParsedProbeLaunch {
  let cursor = 0;
  const take = (expected?: string): string => {
    const value = args[cursor++];
    if (value === undefined) throw new Error(`missing Docker argument${expected ? ` ${expected}` : ""}`);
    if (expected !== undefined && value !== expected) {
      throw new Error(`expected Docker argument ${expected}, received ${value}`);
    }
    return value;
  };

  take("run");
  take("--rm");
  take("--name");
  const containerName = take();
  if (!CONTAINER_NAME.test(containerName)) throw new Error("invalid opaque container name");

  let platform: ParsedProbeLaunch["platform"];
  let pull = false;
  if (args[cursor] === "--platform") {
    take("--platform");
    const candidate = take();
    if (!PLATFORM.has(candidate)) throw new Error("unsupported probe platform");
    platform = candidate as ParsedProbeLaunch["platform"];
    take("--pull");
    take("always");
    pull = true;
  }

  take("--network");
  take("none");
  take("--read-only");
  take("--cap-drop");
  take("ALL");
  take("--security-opt");
  take("no-new-privileges");
  take("--pids-limit");
  take("256");
  take("--user");
  take("1000:1000");

  take("--env");
  const environment = take();
  const prefix = `${HOST_SENTINEL_ENV}=`;
  if (!environment.startsWith(prefix)) throw new Error("unexpected probe environment variable");
  const hostSentinel = environment.slice(prefix.length);
  validateHostPath(hostSentinel, "host sentinel");

  take("--mount");
  const checkoutDir = parseBindMount(take(), "/workspace", true);
  take("--mount");
  const assetsDir = parseBindMount(take(), "/opt/peregrine", true);
  take("--mount");
  const outputDir = parseBindMount(take(), "/output", false);
  take("--tmpfs");
  take("/tmp:rw,noexec,nosuid,nodev,size=64m,uid=1000,gid=1000");
  take("--tmpfs");
  take("/home/peregrine:rw,noexec,nosuid,nodev,size=64m,uid=1000,gid=1000");

  const image = take();
  if (cursor !== args.length) throw new Error("unexpected trailing Docker arguments");
  if (platform) {
    if (!DIGEST_IMAGE.test(image)) throw new Error("platform probes require an immutable image digest");
  } else if (!LOCAL_IMAGE.test(image)) {
    throw new Error("invalid local image reference");
  }

  return {
    image,
    containerName,
    checkoutDir,
    assetsDir,
    outputDir,
    hostSentinel,
    ...(platform ? { platform } : {}),
    pull,
  };
}

function validateOptions(options: ProbeLaunchOptions): void {
  if (!CONTAINER_NAME.test(options.containerName)) throw new Error("invalid opaque container name");
  for (const [label, path] of [
    ["checkout", options.checkoutDir],
    ["assets", options.assetsDir],
    ["output", options.outputDir],
    ["host sentinel", options.hostSentinel],
  ] as const) {
    validateHostPath(path, label);
  }
  if (options.platform) {
    if (!PLATFORM.has(options.platform)) throw new Error("unsupported probe platform");
    if (!DIGEST_IMAGE.test(options.image)) throw new Error("platform probes require an immutable image digest");
  } else if (!LOCAL_IMAGE.test(options.image)) {
    throw new Error("invalid local image reference");
  }
}

function validateHostPath(path: string, label: string): void {
  if (!isAbsolute(path) || path.includes(",") || /[\r\n\0]/.test(path)) {
    throw new Error(`${label} must be an absolute mount-safe path`);
  }
}

function bindMount(source: string, target: string, readOnly: boolean): string {
  return `type=bind,source=${source},target=${target}${readOnly ? ",readonly" : ""}`;
}

function parseBindMount(value: string, target: string, readOnly: boolean): string {
  const fields = value.split(",");
  const expectedLength = readOnly ? 4 : 3;
  if (fields.length !== expectedLength || fields[0] !== "type=bind") {
    throw new Error(`invalid ${target} bind mount`);
  }
  if (!fields[1]?.startsWith("source=")) throw new Error(`invalid ${target} bind mount source`);
  const source = fields[1].slice("source=".length);
  validateHostPath(source, `${target} source`);
  if (fields[2] !== `target=${target}` || (readOnly && fields[3] !== "readonly")) {
    throw new Error(`invalid ${target} bind mount policy`);
  }
  return source;
}

export function runProbe(
  image: string,
  platform?: ProbeLaunchOptions["platform"],
  runtime: ProbeRuntime = systemRuntime,
): void {
  const smokeRoot = mkdtempSync(join(tmpdir(), "peregrine-image-smoke-"));
  const containerName = `peregrine-image-smoke-${randomUUID()}`;
  const checkoutDir = join(smokeRoot, "checkout");
  const assetsDir = join(smokeRoot, "assets");
  const outputDir = join(smokeRoot, "output");
  const hostSentinel = join(smokeRoot, "host-only.txt");
  let primaryError: unknown;
  try {
    mkdirSync(checkoutDir);
    mkdirSync(assetsDir);
    mkdirSync(outputDir);
    writeFileSync(join(checkoutDir, ".peregrine-containment-marker"), "checkout\n");
    writeFileSync(join(assetsDir, ".peregrine-containment-marker"), "assets\n");
    writeFileSync(hostSentinel, "must remain on the host\n");
    chmodSync(checkoutDir, 0o555);
    chmodSync(assetsDir, 0o555);
    chmodSync(outputDir, 0o777);

    const args = buildProbeDockerArgs({
      image,
      containerName,
      checkoutDir,
      assetsDir,
      outputDir,
      hostSentinel,
      ...(platform ? { platform } : {}),
    });
    const result = runtime.spawn("docker", args, { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`containment probe container exited with status ${result.status ?? "unknown"}`);
    const report = JSON.parse(readFileSync(join(outputDir, "containment-probe.json"), "utf8")) as {
      schemaVersion?: unknown;
      status?: unknown;
    };
    if (report.schemaVersion !== 1 || report.status !== "passed") {
      throw new Error("containment probe did not produce a passing version-1 report");
    }
    process.stdout.write(`containment probe passed for ${platform ?? "native"} ${image}\n`);
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupErrors: Error[] = [];
    runtime.spawn("docker", ["rm", "--force", containerName], { stdio: "ignore" });
    // Docker's classic image store cannot retain two platform manifests under
    // the same multi-platform index digest. Each workflow probe is a separate
    // process, so remove the exact digest after its container has stopped.
    // A cleanup miss remains fail-closed: the next --pull=always probe errors
    // instead of silently running the previously cached architecture.
    if (platform) {
      const removal = runtime.spawn("docker", buildProbeImageCleanupArgs(image, platform), {
        encoding: "utf8",
      });
      if (removal.error) cleanupErrors.push(new Error(`failed to launch probe image cleanup: ${removal.error.message}`));
      else if (removal.status !== 0) cleanupErrors.push(new Error(`probe image cleanup exited with status ${removal.status ?? "unknown"}`));

      const inspection = runtime.spawn("docker", buildProbeImageAbsenceArgs(image), {
        encoding: "utf8",
      });
      const inspectionError = typeof inspection.stderr === "string"
        ? inspection.stderr
        : inspection.stderr?.toString("utf8") ?? "";
      if (inspection.error) {
        cleanupErrors.push(new Error(`failed to verify probe image absence: ${inspection.error.message}`));
      } else if (inspection.status === 0) {
        cleanupErrors.push(new Error("probe image cleanup left the exact digest in the local image store"));
      } else if (inspection.status !== 1 || !/No such (?:image|object)/i.test(inspectionError)) {
        cleanupErrors.push(new Error(`probe image absence check failed with status ${inspection.status ?? "unknown"}`));
      }
    }
    for (const directory of [checkoutDir, assetsDir]) {
      try {
        chmodSync(directory, 0o700);
      } catch {
        // Setup may have failed before the directory was created.
      }
    }
    rmSync(smokeRoot, { recursive: true, force: true });

    if (primaryError !== undefined) {
      if (cleanupErrors.length > 0) {
        throw new AggregateError([primaryError, ...cleanupErrors], errorMessage(primaryError));
      }
      throw primaryError;
    }
    if (cleanupErrors.length === 1) throw cleanupErrors[0];
    if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, "probe image cleanup failed");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "containment probe failed";
}

function main(argv: readonly string[]): void {
  let image: string | undefined;
  let platform: ProbeLaunchOptions["platform"];
  for (let index = 2; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${name ?? "argument"} requires a value`);
    if (name === "--image" && image === undefined) image = value;
    else if (name === "--platform" && platform === undefined && PLATFORM.has(value)) {
      platform = value as ProbeLaunchOptions["platform"];
    } else {
      throw new Error(`unsupported or repeated argument: ${name ?? "unknown"}`);
    }
  }
  if (!image) throw new Error("--image is required");
  runProbe(image, platform);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv);
  } catch (error) {
    process.stderr.write(`eval runtime probe failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  }
}
