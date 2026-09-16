import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { parseEgressProbeCliArgs, type ProbeProcessResult, type ProbeRuntime } from "./run-eval-egress-probe.js";

export const PRIVATE_CONTAINMENT_MAX_BYTES = 1024;
const PASS = '{"schemaVersion":1,"protocol":"private-stream-containment-v1","status":"passed"}';

/** The wire format has no producer-controlled fields. Check bytes before even
 * decoding; exact comparison avoids accepting duplicate keys or extra reports. */
export function validatePrivateContainmentResult(result: ProbeProcessResult): void {
  const bytes = (value: ProbeProcessResult["stdout"]): number => {
    if (value == null) return 0;
    if (typeof value !== "string" && !Buffer.isBuffer(value)) throw new Error("invalid containment stream");
    return Buffer.byteLength(value);
  };
  if (bytes(result.stdout) + bytes(result.stderr) > PRIVATE_CONTAINMENT_MAX_BYTES) throw new Error("containment metadata byte limit exceeded");
  if (result.error || result.status !== 0 || bytes(result.stderr) !== 0) throw new Error("private containment failed");
  const stdout = result.stdout?.toString() ?? "";
  if (stdout !== PASS && stdout !== PASS + "\n") throw new Error("invalid containment metadata");
}

/** Additive publication-only profile: host mounts are input-only, Docker does
 * not retain logs, and the only result is a bounded attached pipe. */
export function runPrivateContainmentProbe(image: string, platform: "linux/amd64" | "linux/arm64" | undefined, runtime: ProbeRuntime): void {
  parseEgressProbeCliArgs(["--image", image, ...(platform ? ["--platform", platform] : [])]);
  const root = mkdtempSync(join(tmpdir(), "peregrine-private-containment-"));
  const name = `peregrine-image-smoke-${randomUUID()}`;
  const checkout = join(root, "checkout"), assets = join(root, "assets"), sentinel = join(root, "host-only.txt");
  const errors: unknown[] = [];
  const invoke = (args: string[]) => runtime.spawn("docker", args, { encoding: "utf8", stdio: "pipe", timeout: 120000,
    ...(args[0] === "run" ? { maxBuffer: PRIVATE_CONTAINMENT_MAX_BYTES } : {}) });
  const absent = (result: ProbeProcessResult, messages: string[]) => !result.error && result.status === 1 && messages.includes(result.stderr?.toString().trim() ?? "");
  try {
    if (!isAbsolute(root) || /[,\r\n\0]/.test(root)) throw new Error("invalid containment fixture path");
    mkdirSync(checkout); mkdirSync(assets);
    writeFileSync(join(checkout, ".peregrine-containment-marker"), "checkout\n", { flag: "wx", mode: 0o444 });
    writeFileSync(join(assets, ".peregrine-containment-marker"), "assets\n", { flag: "wx", mode: 0o444 });
    writeFileSync(join(assets, "private-containment-probe-v1.mjs"), readFileSync(new URL("../container/eval-runtime/private-containment-probe-v1.mjs", import.meta.url)), { flag: "wx", mode: 0o444 });
    writeFileSync(sentinel, "must remain on the host\n", { flag: "wx", mode: 0o600 });
    chmodSync(checkout, 0o555); chmodSync(assets, 0o555);
    validatePrivateContainmentResult(invoke([
      "run", "--rm", "--quiet", "--name", name,
      ...(platform ? ["--platform", platform, "--pull", "always"] : []),
      "--log-driver", "none", "--network", "none", "--read-only", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges", "--pids-limit", "256", "--user", "1000:1000",
      "--env", `PEREGRINE_PROBE_HOST_SENTINEL=${sentinel}`,
      "--mount", `type=bind,source=${checkout},target=/workspace,readonly`,
      "--mount", `type=bind,source=${assets},target=/opt/peregrine,readonly`,
      "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m,uid=1000,gid=1000",
      "--tmpfs", "/home/peregrine:rw,noexec,nosuid,nodev,size=64m,uid=1000,gid=1000",
      "--entrypoint", "node", image, "/opt/peregrine/private-containment-probe-v1.mjs", "--check",
    ]));
  } catch (error) { errors.push(error); }
  finally {
    const attempt = (work: () => void) => { try { work(); } catch (error) { errors.push(error); } };
    attempt(() => {
      const removal = invoke(["rm", "--force", name]);
      if (removal.error || removal.status !== 0 && !absent(removal, [`Error response from daemon: No such container: ${name}`, `Error: No such object: ${name}`])) throw new Error("private containment removal failed");
    });
    attempt(() => {
      if (!absent(invoke(["container", "inspect", name]), [`Error: No such object: ${name}`, `Error response from daemon: No such container: ${name}`])) throw new Error("private containment absence unproven");
    });
    if (platform) {
      attempt(() => { const removal = invoke(["image", "rm", "--force", image]); if (removal.error || removal.status !== 0) throw new Error("private containment image removal failed"); });
      attempt(() => {
        if (!absent(invoke(["image", "inspect", image]), [`Error: No such image: ${image}`, `Error: No such object: ${image}`, `Error response from daemon: No such image: ${image}`])) throw new Error("private containment image absence unproven");
      });
    }
    for (const directory of [checkout, assets]) attempt(() => { chmodSync(directory, 0o700); });
    attempt(() => { rmSync(root, { recursive: true, force: true }); });
  }
  if (errors.length) throw new AggregateError(errors, "private containment or cleanup failed");
}
