import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { ACCEPTED_EVAL_RUNTIME_IMAGE } from "./runtime-containment.js";
import { trustedLocalReviewArgs } from "./trusted-local-review-runner.js";
import { exec } from "../src/util/exec.js";
import type { ExecResult } from "../src/util/exec.js";
import { canonicalJson } from "./experiment.js";
import {
  parseTrustedLocalReviewJsonl, TRUSTED_LOCAL_REVIEW_DEADLINE_MS,
  TRUSTED_LOCAL_REVIEW_EFFORT, TRUSTED_LOCAL_REVIEW_MODEL, TRUSTED_LOCAL_REVIEW_OUTPUT_BYTES,
  type TrustedLocalReviewAttempt, type TrustedLocalReviewTerminal,
} from "./trusted-local-review-runner.js";

/** Construction only. This module does not authorize or execute a provider review. */
export interface DevelopmentReviewMounts {
  neutralCheckout: string;
  assets: string;
  output: string;
}

const SCHEMA = "review-output.schema.json";
const NAME = /^peregrine-review-[a-f0-9-]{36}$/;

function directory(path: string, label: string): string {
  if (!isAbsolute(path) || /[,\r\n\0]/.test(path) || lstatSync(normalize(path)).isSymbolicLink()) {
    throw new Error(`${label} must be an absolute, mount-safe directory without a symlink root`);
  }
  const actual = realpathSync(path);
  if (/[,\r\n\0]/.test(actual)) throw new Error(`${label} resolved to an unsafe mount path`);
  if (!lstatSync(actual).isDirectory()) throw new Error(`${label} must be a directory`);
  return actual;
}

function bind(source: string, target: string, readonly: boolean): string {
  return `type=bind,source=${source},target=${target}${readonly ? ",readonly" : ""}`;
}

function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function validate(mounts: DevelopmentReviewMounts) {
  const checkout = directory(mounts.neutralCheckout, "neutral checkout");
  const assets = directory(mounts.assets, "review assets");
  const output = directory(mounts.output, "review output");
  for (const [a, b] of [[checkout, assets], [checkout, output], [assets, output]]) {
    if (contains(a!, b!) || contains(b!, a!)) throw new Error("review mount directories must be disjoint");
  }
  if (!lstatSync(`${checkout}/.git`).isDirectory()) throw new Error("neutral checkout requires a local Git directory");
  const outputStat = lstatSync(output);
  const uid = process.getuid?.();
  if (outputStat.uid !== uid || (outputStat.mode & 0o777) !== 0o700 || readdirSync(output).length !== 0) {
    throw new Error("review output must be a fresh empty evaluator-owned 0700 directory");
  }
  if (JSON.stringify(readdirSync(assets).sort()) !== JSON.stringify([SCHEMA])) {
    throw new Error("review assets must contain only the output schema");
  }
  const schema = `${assets}/${SCHEMA}`;
  const stat = lstatSync(schema);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("review schema must be a regular single-link file");
  return { checkout, assets, output };
}

/** The probe and future live command use this exact filesystem mount constructor. */
function filesystemArgs(mounts: DevelopmentReviewMounts, name: string, mode: "probe" | "review"): string[] {
  if (!NAME.test(name)) throw new Error("invalid development review container name");
  const { checkout, assets, output } = validate(mounts);
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid) || uid! <= 0 || gid! < 0) {
    throw new Error("development review requires a non-root numeric host identity");
  }
  return [
    "run", "--name", name, "--pull", "never",
    ...(mode === "review" ? ["--interactive"] : []),
    "--network", mode === "review" ? "bridge" : "none",
    "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--pids-limit", "256", "--user", `${uid}:${gid}`, "--workdir", "/workspace",
    "--mount", bind(checkout, "/workspace", true),
    "--mount", bind(assets, "/opt/peregrine", true),
    "--mount", bind(output, "/output", false),
    "--tmpfs", `/tmp:rw,noexec,nosuid,nodev,size=64m,uid=${uid},gid=${gid}`,
    "--tmpfs", `/home/peregrine:rw,noexec,nosuid,nodev,size=128m,uid=${uid},gid=${gid}`,
    "--tmpfs", `/home/peregrine/.codex:rw,noexec,nosuid,nodev,size=128m,uid=${uid},gid=${gid}`,
  ];
}

export function buildDevelopmentReviewProbeArgs(
  mounts: DevelopmentReviewMounts,
  deniedHostPaths: { privateSentinel: string; siblingEvidence: string; hostHome: string },
  name = `peregrine-review-${randomUUID()}`,
): string[] {
  const roots = [deniedHostPaths.privateSentinel, deniedHostPaths.siblingEvidence, deniedHostPaths.hostHome];
  if (roots.some((p) => !isAbsolute(p) || /[\r\n\0]/.test(p))) throw new Error("denied host paths must be absolute");
const script = `const fs=require('node:fs'); const p=JSON.parse(process.argv[1]);
const exists=(x)=>{try{fs.statSync(x);return true}catch{return false}};
const positive=fs.readFileSync('/workspace/.git/HEAD','utf8').length>0&&fs.readFileSync('/opt/peregrine/${SCHEMA}','utf8').length>0;
const denied=[...p,'/var/run/docker.sock','/workspace/../host-only.txt','/workspace/escape-to-host'];
if(!positive||denied.some(exists))process.exit(42);
fs.writeFileSync('/output/read-isolation-probe.json',JSON.stringify({status:'passed',positive:2,denied:denied.length})+'\\n');`;
  return [...filesystemArgs(mounts, name, "probe"), ACCEPTED_EVAL_RUNTIME_IMAGE, "node", "-e", script, JSON.stringify(roots)];
}

/** Returns launch bytes only. A separate authorization and supervised executor are required. */
export function buildDevelopmentReviewLaunchArgs(
  mounts: DevelopmentReviewMounts,
  credentialFile: string,
  name = `peregrine-review-${randomUUID()}`,
): string[] {
  const credential = directoryFile(credentialFile);
  const { checkout, assets, output } = validate(mounts);
  if ([checkout, assets, output].some((root) => contains(root, credential))) {
    throw new Error("credential file must be outside review mounts");
  }
  const command = trustedLocalReviewArgs("/workspace", `/opt/peregrine/${SCHEMA}`);
  return [
    ...filesystemArgs(mounts, name, "review"),
    "--mount", bind(credential, "/home/peregrine/.codex/auth.json", true),
    ACCEPTED_EVAL_RUNTIME_IMAGE, "codex", ...command,
  ];
}

function directoryFile(path: string): string {
  if (!isAbsolute(path) || /[,\r\n\0]/.test(path) || lstatSync(normalize(path)).isSymbolicLink()) throw new Error("credential must be an absolute regular file");
  const actual = realpathSync(path);
  const stat = lstatSync(actual);
  if (/[,\r\n\0]/.test(actual) || !stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
    throw new Error("credential must be a private, evaluator-owned single-link regular file");
  }
  return actual;
}

/** The private authorization decision and frozen package/source/schedule hashes are caller assertions. */
export interface DevelopmentReviewAuthorization {
  decision: "authorized";
  packageSha256: string;
  sourceSha256: string;
  schemaSha256: string;
  rawScopeSha256: string;
  scheduleSha256: string;
  attemptId: string;
  caseId: string;
  armId: "A" | "B";
}

export interface DevelopmentReviewSlot {
  caseId: string;
  attemptId: string;
  armId: "A" | "B";
  packageSha256: string;
  sourceSha256: string;
  schemaSha256: string;
  scheduleSha256: string;
  mounts: DevelopmentReviewMounts;
  credentialFile: string;
  attempt: TrustedLocalReviewAttempt;
}

const SHA256 = /^[a-f0-9]{64}$/;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

/** No default executor exists here. The caller must supply both authorization and execution. */
export async function runAuthorizedDevelopmentReviewAttempt(
  slot: DevelopmentReviewSlot,
  authorization: DevelopmentReviewAuthorization | undefined,
  run: typeof exec,
  now: () => number = Date.now,
): Promise<TrustedLocalReviewTerminal> {
  const attempt = slot.attempt;
  const expected = [slot.packageSha256, slot.sourceSha256, slot.schemaSha256, slot.scheduleSha256, attempt.rawScopeSha256];
  const validId = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
  if (!authorization || authorization.decision !== "authorized" || expected.some((value) => !SHA256.test(value)) ||
      !validId(slot.caseId) || !validId(slot.attemptId) ||
      authorization.packageSha256 !== slot.packageSha256 || authorization.sourceSha256 !== slot.sourceSha256 ||
      authorization.schemaSha256 !== slot.schemaSha256 || authorization.scheduleSha256 !== slot.scheduleSha256 ||
      authorization.rawScopeSha256 !== attempt.rawScopeSha256 || authorization.attemptId !== slot.attemptId ||
      authorization.caseId !== slot.caseId || authorization.armId !== slot.armId) {
    throw new Error("development review authorization binding is missing or mismatched");
  }
  if (typeof run !== "function") throw new Error("development review requires an injected executor");
  if (attempt.armId !== slot.armId || attempt.promptSha256 !== hash(attempt.prompt) ||
      (slot.armId === "A" ? attempt.methodSourceSha256 !== null : !attempt.methodSourceSha256) ||
      attempt.command !== "codex") {
    throw new Error("development review slot provenance is invalid");
  }
  const mounts = validate(slot.mounts);
  const receipt = isAbsolute(attempt.attemptDirectory)
    ? join(realpathSync(dirname(attempt.attemptDirectory)), basename(attempt.attemptDirectory)) : "";
  if (!receipt || existsSync(receipt) || [mounts.checkout, mounts.assets, mounts.output].some((root) =>
    contains(root, receipt) || contains(receipt, root))) {
    throw new Error("review receipt directory must be absolute and disjoint from reviewer mounts");
  }
  if (mounts.checkout !== realpathSync(attempt.checkoutDirectory)) throw new Error("review source provenance checkout mismatch");
  if (lstatSync(join(mounts.assets, SCHEMA)).size > 1024 * 1024) {
    throw new Error("review output schema exceeds size bound");
  }
  if (hash(readFileSync(join(mounts.assets, SCHEMA))) !== slot.schemaSha256) {
    throw new Error("review output schema provenance mismatch");
  }
  const name = `peregrine-review-${randomUUID()}`;
  // Credential metadata is first touched here, after the complete binding check.
  const args = buildDevelopmentReviewLaunchArgs(slot.mounts, slot.credentialFile, name);
  if (canonicalJson(args.slice(args.indexOf("codex") + 1)) !==
      canonicalJson(trustedLocalReviewArgs("/workspace", `/opt/peregrine/${SCHEMA}`))) {
    throw new Error("review command differs from trusted local review arguments");
  }
  return runContainedAttempt(slot.caseId, attempt, args, name, run, now);
}

async function runContainedAttempt(
  caseId: string, attempt: TrustedLocalReviewAttempt, args: string[], name: string, run: typeof exec, now: () => number,
): Promise<TrustedLocalReviewTerminal> {
  const started = now();
  mkdirSync(attempt.attemptDirectory, { mode: 0o700 });
  writeFileSync(join(attempt.attemptDirectory, "prompt.txt"), attempt.prompt, { flag: "wx", mode: 0o600 });
  const argvBytes = `${canonicalJson({ command: "docker", args })}\n`;
  writeFileSync(join(attempt.attemptDirectory, "argv.json"), argvBytes, { flag: "wx", mode: 0o600 });
  let result: ExecResult = { stdout: "", stderr: "", code: -1, timedOut: false };
  let launchError: string | null = null;
  let cleanupFailed = false;
  const cleanup: Record<string, unknown> = {};
  try {
    result = await run("docker", args, { stdin: attempt.prompt, timeoutMs: TRUSTED_LOCAL_REVIEW_DEADLINE_MS,
      maximumOutputBytes: TRUSTED_LOCAL_REVIEW_OUTPUT_BYTES, inheritEnv: false, env: { PATH: process.env.PATH ?? "" } });
  } catch (error) { launchError = String(error); }
  // A thrown executor may have spawned the container. Always attempt both cleanup calls.
  for (const [step, commandArgs, timeoutMs] of [
    ["remove", ["rm", "--force", name], 15_000],
    ["survivor", ["ps", "--all", "--quiet", "--filter", `name=^/${name}$`], 10_000],
  ] as const) {
    try {
      const response = await run("docker", [...commandArgs], { timeoutMs, inheritEnv: false, env: { PATH: process.env.PATH ?? "" }, maximumOutputBytes: 4096 });
      cleanup[step] = response;
      if (response.code !== 0 || response.timedOut || response.outputLimitExceeded || (step === "survivor" && response.stdout.trim())) cleanupFailed = true;
    } catch (error) { cleanup[step] = { error: String(error) }; cleanupFailed = true; }
  }
  writeFileSync(join(attempt.attemptDirectory, "cleanup.json"), `${canonicalJson(cleanup)}\n`, { flag: "wx", mode: 0o600 });
  writeFileSync(join(attempt.attemptDirectory, "raw.jsonl"), result.stdout, { flag: "wx", mode: 0o600 });
  writeFileSync(join(attempt.attemptDirectory, "stderr.txt"), result.stderr, { flag: "wx", mode: 0o600 });
  if (launchError !== null) writeFileSync(join(attempt.attemptDirectory, "launch-error.txt"), launchError, { flag: "wx", mode: 0o600 });
  let status: TrustedLocalReviewTerminal["status"] = "process-failed";
  let usage: TrustedLocalReviewTerminal["usage"] = null;
  let findingsSha256: string | null = null;
  if (result.timedOut) status = "timed-out";
  else if (result.outputLimitExceeded) status = "output-limit-exceeded";
  else if (result.code === 0 && launchError === null) {
    try {
      const parsed = parseTrustedLocalReviewJsonl(result.stdout);
      usage = parsed.usage;
      const bytes = `${canonicalJson(parsed.findings)}\n`;
      findingsSha256 = hash(bytes);
      writeFileSync(join(attempt.attemptDirectory, "final-findings.json"), bytes, { flag: "wx", mode: 0o600 });
      status = "completed";
    } catch { status = "malformed-output"; }
  }
  if (cleanupFailed) status = "cleanup-failed";
  writeFileSync(join(attempt.attemptDirectory, "usage.json"), `${canonicalJson(usage)}\n`, { flag: "wx", mode: 0o600 });
  const terminal: TrustedLocalReviewTerminal = {
    schemaVersion: 1, caseId,
    armId: attempt.armId, requestedModel: TRUSTED_LOCAL_REVIEW_MODEL, requestedEffort: TRUSTED_LOCAL_REVIEW_EFFORT,
    status, elapsedMs: Math.max(0, now() - started), exitCode: result.code, timedOut: result.timedOut,
    outputLimitExceeded: result.outputLimitExceeded === true, usage, promptSha256: attempt.promptSha256,
    argvSha256: hash(argvBytes), rawJsonlSha256: hash(result.stdout), stderrSha256: hash(result.stderr),
    findingsSha256, cleanupCompleted: !cleanupFailed,
  };
  writeFileSync(join(attempt.attemptDirectory, "terminal.json"), `${canonicalJson(terminal)}\n`, { flag: "wx", mode: 0o600 });
  return terminal;
}

/** Credential-free probe. The caller supplies a new durable receipt directory. */
export async function probeDevelopmentReviewReadIsolation(attemptDirectory: string, run: typeof exec = exec): Promise<void> {
  if (!isAbsolute(attemptDirectory) || existsSync(attemptDirectory)) throw new Error("probe attempt directory must be new and absolute");
  mkdirSync(attemptDirectory, { mode: 0o700 });
  chmodSync(attemptDirectory, 0o700);
  const checkout = join(attemptDirectory, "checkout");
  const assets = join(attemptDirectory, "assets");
  const output = join(attemptDirectory, "output");
  const sentinel = join(attemptDirectory, "host-only.txt");
  const sibling = join(attemptDirectory, "sibling-evidence.txt");
  const name = `peregrine-review-${randomUUID()}`;
  const environment = { PATH: process.env.PATH ?? "" };
  const record = async (step: string, args: string[], timeoutMs: number) => {
    const receipt: Record<string, unknown> = { command: "docker", args };
    try {
      const result = await run("docker", args, { timeoutMs, env: environment, inheritEnv: false });
      Object.assign(receipt, { code: result.code, timedOut: result.timedOut, stdout: result.stdout, stderr: result.stderr });
      return result;
    } catch (error) {
      receipt.error = String(error);
      throw error;
    } finally {
      writeFileSync(join(attemptDirectory, `${step}.json`), `${JSON.stringify(receipt)}\n`, { flag: "wx", mode: 0o600 });
    }
  };
  let failure: unknown;
  let launched = false;
  let cleanupFailed = false;
  try {
    for (const path of [checkout, assets, output, join(checkout, ".git")]) mkdirSync(path, { mode: 0o700 });
    writeFileSync(join(checkout, ".git", "HEAD"), "ref: refs/heads/probe\n");
    writeFileSync(join(assets, SCHEMA), "{}\n");
    writeFileSync(sentinel, "inert sentinel\n");
    writeFileSync(sibling, "inert sibling\n");
    symlinkSync(sentinel, join(checkout, "escape-to-host"));
    const image = await record("inspect", ["image", "inspect", "--format", "{{json .RepoDigests}}", ACCEPTED_EVAL_RUNTIME_IMAGE], 15_000);
    if (image.code !== 0 || image.timedOut || !image.stdout.includes(ACCEPTED_EVAL_RUNTIME_IMAGE.split("@")[1]!)) {
      throw new Error("accepted runtime image is unavailable locally; probe did not run");
    }
    const args = buildDevelopmentReviewProbeArgs(
      { neutralCheckout: checkout, assets, output },
      { privateSentinel: sentinel, siblingEvidence: sibling, hostHome: homedir() },
      name,
    );
    launched = true;
    const result = await record("run", args, 60_000);
    if (result.code !== 0 || result.timedOut) throw new Error("development review read isolation probe failed");
    const reportPath = join(output, "read-isolation-probe.json");
    const reportStat = lstatSync(reportPath);
    if (!reportStat.isFile() || reportStat.isSymbolicLink() || reportStat.nlink !== 1 || reportStat.uid !== process.getuid?.() || reportStat.size > 4096) {
      throw new Error("development review attestation metadata is invalid");
    }
    const raw = readFileSync(reportPath, "utf8");
    writeFileSync(join(attemptDirectory, "attestation.json"), raw, { flag: "wx", mode: 0o600 });
    const report = JSON.parse(raw) as { status?: unknown; positive?: unknown; denied?: unknown };
    if (report.status !== "passed" || report.positive !== 2 || report.denied !== 6) {
      throw new Error("development review read isolation attestation is invalid");
    }
  } catch (error) {
    failure = error;
  }
  if (launched) {
    try {
      const removed = await record("remove", ["rm", "--force", name], 15_000);
      cleanupFailed = removed.code !== 0 || removed.timedOut;
    } catch { cleanupFailed = true; }
    try {
      const remaining = await record("survivor", ["ps", "--all", "--quiet", "--filter", `name=^/${name}$`], 10_000);
      cleanupFailed ||= remaining.code !== 0 || remaining.timedOut || Boolean(remaining.stdout.trim());
    } catch { cleanupFailed = true; }
  }
  const terminal = { status: failure === undefined && !cleanupFailed ? "passed" : "failed", error: failure === undefined ? null : String(failure), cleanupFailed, launched };
  writeFileSync(join(attemptDirectory, "terminal.json"), `${JSON.stringify(terminal)}\n`, { flag: "wx", mode: 0o600 });
  if (cleanupFailed) throw new Error("development review probe container cleanup could not be proved");
  if (failure !== undefined) throw failure;
}
