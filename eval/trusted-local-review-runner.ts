import { createHash } from "node:crypto";
import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileMethodologyReviewPrompt, type MethodologyRawScope } from "./methodology-prompts.js";
import { parseMethodologyReviewOutput, type MethodologyReviewOutput } from "./methodology-output.js";
import { canonicalJson } from "./experiment.js";
import { packageRoot } from "../src/core/paths.js";
import { isolatedProviderEnvironment } from "../src/security/provider-env.js";
import { exec, type ExecResult } from "../src/util/exec.js";

export const TRUSTED_LOCAL_REVIEW_MODEL = "gpt-5.6-sol" as const;
export const TRUSTED_LOCAL_REVIEW_EFFORT = "high" as const;
export const TRUSTED_LOCAL_REVIEW_DEADLINE_MS = 20 * 60 * 1000;
export const TRUSTED_LOCAL_REVIEW_OUTPUT_BYTES = 4 * 1024 * 1024;

export interface TrustedLocalReviewPairInput {
  caseId: string;
  checkoutDirectory: string;
  authFile: string;
  attemptRoot: string;
  scope: MethodologyRawScope;
  activatedLanes: string[];
}

export interface TrustedLocalReviewAttempt {
  armId: "A" | "B";
  attemptDirectory: string;
  checkoutDirectory: string;
  prompt: string;
  promptSha256: string;
  rawScopeSha256: string;
  methodSourceSha256: string | null;
  command: string;
  args: string[];
}

export interface TrustedLocalReviewUsage {
  inputTokens: number;
  cachedInputTokens: number | null;
  outputTokens: number;
  reasoningOutputTokens: number | null;
}

export type TrustedLocalReviewStatus =
  | "completed"
  | "timed-out"
  | "process-failed"
  | "output-limit-exceeded"
  | "malformed-output"
  | "cleanup-failed";

export interface TrustedLocalReviewTerminal {
  schemaVersion: 1;
  caseId: string;
  armId: "A" | "B";
  requestedModel: typeof TRUSTED_LOCAL_REVIEW_MODEL;
  requestedEffort: typeof TRUSTED_LOCAL_REVIEW_EFFORT;
  status: TrustedLocalReviewStatus;
  elapsedMs: number;
  exitCode: number | null;
  timedOut: boolean;
  outputLimitExceeded: boolean;
  usage: TrustedLocalReviewUsage | null;
  promptSha256: string;
  argvSha256: string;
  rawJsonlSha256: string;
  stderrSha256: string;
  findingsSha256: string | null;
  cleanupCompleted: boolean;
}

export interface TrustedLocalReviewDependencies {
  run?: typeof exec;
  now?: () => number;
  removeSession?: (path: string) => void;
}

/** Prepare the only first-cycle diagnostic pair: A and B differ by prompt only. */
export async function prepareTrustedLocalReviewPair(
  input: TrustedLocalReviewPairInput,
): Promise<[TrustedLocalReviewAttempt, TrustedLocalReviewAttempt]> {
  const caseId = safeId(input.caseId, "caseId");
  const checkoutDirectory = resolveExistingDirectory(input.checkoutDirectory, "checkoutDirectory");
  const attemptRoot = resolve(input.attemptRoot);
  mkdirSync(attemptRoot, { recursive: true, mode: 0o700 });
  chmodSync(attemptRoot, 0o700);
  const [plain, peregrine] = await Promise.all([
    compileMethodologyReviewPrompt({ armId: "A", scope: input.scope }),
    compileMethodologyReviewPrompt({ armId: "B", scope: input.scope, activatedLanes: input.activatedLanes }),
  ]);
  if (plain.rawScopeSha256 !== peregrine.rawScopeSha256 || plain.schemaPath !== peregrine.schemaPath) {
    throw new Error("trusted local pair does not share identical raw scope and output schema");
  }
  if (plain.prompt === peregrine.prompt || plain.methodSourceSha256 !== null || peregrine.methodSourceSha256 === null) {
    throw new Error("trusted local pair prompt isolation is invalid");
  }
  const schemaFile = join(packageRoot(), plain.schemaPath);
  const args = trustedLocalReviewArgs(checkoutDirectory, schemaFile);
  const common = { caseId, checkoutDirectory, command: "codex", args };
  return [
    {
      armId: "A",
      attemptDirectory: join(attemptRoot, `${caseId}-A`),
      checkoutDirectory,
      prompt: plain.prompt,
      promptSha256: plain.promptSha256,
      rawScopeSha256: plain.rawScopeSha256,
      methodSourceSha256: plain.methodSourceSha256,
      command: common.command,
      args: [...common.args],
    },
    {
      armId: "B",
      attemptDirectory: join(attemptRoot, `${caseId}-B`),
      checkoutDirectory,
      prompt: peregrine.prompt,
      promptSha256: peregrine.promptSha256,
      rawScopeSha256: peregrine.rawScopeSha256,
      methodSourceSha256: peregrine.methodSourceSha256,
      command: common.command,
      args: [...common.args],
    },
  ];
}

export async function runTrustedLocalReviewPair(
  input: TrustedLocalReviewPairInput,
  dependencies: TrustedLocalReviewDependencies = {},
): Promise<[TrustedLocalReviewTerminal, TrustedLocalReviewTerminal]> {
  const attempts = await prepareTrustedLocalReviewPair(input);
  const first = await runTrustedLocalReviewAttempt(input, attempts[0], dependencies);
  const second = await runTrustedLocalReviewAttempt(input, attempts[1], dependencies);
  return [first, second];
}

export async function runTrustedLocalReviewAttempt(
  input: TrustedLocalReviewPairInput,
  attempt: TrustedLocalReviewAttempt,
  dependencies: TrustedLocalReviewDependencies = {},
): Promise<TrustedLocalReviewTerminal> {
  const now = dependencies.now ?? Date.now;
  const run = dependencies.run ?? exec;
  const removeSession = dependencies.removeSession ?? ((path: string) => rmSync(path, { recursive: true, force: true }));
  const started = now();
  mkdirSync(attempt.attemptDirectory, { mode: 0o700 });
  writeExclusive(join(attempt.attemptDirectory, "prompt.txt"), attempt.prompt);
  const argv = { command: attempt.command, args: attempt.args };
  const argvBytes = `${canonicalJson(argv)}\n`;
  writeExclusive(join(attempt.attemptDirectory, "argv.json"), argvBytes);

  let sessionDirectory: string | null = null;
  let execution: ExecResult = { stdout: "", stderr: "", code: -1, timedOut: false };
  let status: TrustedLocalReviewStatus = "process-failed";
  let usage: TrustedLocalReviewUsage | null = null;
  let findings: MethodologyReviewOutput | null = null;
  let cleanupCompleted = true;
  try {
    sessionDirectory = mkdtempSync(join(tmpdir(), "peregrine-trusted-review-"));
    cleanupCompleted = false;
    chmodSync(sessionDirectory, 0o700);
    mkdirSync(join(sessionDirectory, "tmp"), { mode: 0o700 });
    copyFileSync(resolve(input.authFile), join(sessionDirectory, "auth.json"), constants.COPYFILE_EXCL);
    chmodSync(join(sessionDirectory, "auth.json"), 0o600);
    const environment = isolatedProviderEnvironment("codex", sessionDirectory);
    delete environment.OPENAI_API_KEY;
    environment.CODEX_HOME = sessionDirectory;
    execution = await run(attempt.command, [...attempt.args], {
      cwd: attempt.checkoutDirectory,
      env: environment,
      inheritEnv: false,
      timeoutMs: TRUSTED_LOCAL_REVIEW_DEADLINE_MS,
      maximumOutputBytes: TRUSTED_LOCAL_REVIEW_OUTPUT_BYTES,
      stdin: attempt.prompt,
    });
    if (execution.timedOut) status = "timed-out";
    else if (execution.outputLimitExceeded) status = "output-limit-exceeded";
    else if (execution.code !== 0) status = "process-failed";
    else {
      try {
        const parsed = parseTrustedLocalReviewJsonl(execution.stdout);
        usage = parsed.usage;
        findings = parsed.findings;
        status = "completed";
      } catch {
        status = "malformed-output";
      }
    }
  } catch {
    status = "process-failed";
  } finally {
    if (sessionDirectory !== null) {
      try {
        removeSession(sessionDirectory);
        cleanupCompleted = !existsSync(sessionDirectory);
      } catch {
        cleanupCompleted = false;
      }
    }
  }
  if (!cleanupCompleted) status = "cleanup-failed";

  const rawJsonl = execution.stdout;
  writeExclusive(join(attempt.attemptDirectory, "raw.jsonl"), rawJsonl);
  writeExclusive(join(attempt.attemptDirectory, "stderr.txt"), execution.stderr);
  writeExclusive(join(attempt.attemptDirectory, "usage.json"), `${canonicalJson(usage)}\n`);
  let findingsSha256: string | null = null;
  if (findings !== null) {
    const bytes = `${canonicalJson(findings)}\n`;
    findingsSha256 = sha256(bytes);
    writeExclusive(join(attempt.attemptDirectory, "final-findings.json"), bytes);
  }
  const terminal: TrustedLocalReviewTerminal = {
    schemaVersion: 1,
    caseId: safeId(input.caseId, "caseId"),
    armId: attempt.armId,
    requestedModel: TRUSTED_LOCAL_REVIEW_MODEL,
    requestedEffort: TRUSTED_LOCAL_REVIEW_EFFORT,
    status,
    elapsedMs: Math.max(0, now() - started),
    exitCode: execution.code,
    timedOut: execution.timedOut,
    outputLimitExceeded: execution.outputLimitExceeded === true,
    usage,
    promptSha256: attempt.promptSha256,
    argvSha256: sha256(argvBytes),
    rawJsonlSha256: sha256(rawJsonl),
    stderrSha256: sha256(execution.stderr),
    findingsSha256,
    cleanupCompleted,
  };
  writeExclusive(join(attempt.attemptDirectory, "terminal.json"), `${canonicalJson(terminal)}\n`);
  return terminal;
}

export function trustedLocalReviewArgs(checkoutDirectory: string, schemaFile: string): string[] {
  return [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "--disable",
    "multi_agent",
    "--sandbox",
    "read-only",
    "--model",
    TRUSTED_LOCAL_REVIEW_MODEL,
    "--config",
    `model_reasoning_effort=${JSON.stringify(TRUSTED_LOCAL_REVIEW_EFFORT)}`,
    "--config",
    'web_search="disabled"',
    "--config",
    "project_doc_max_bytes=0",
    "--config",
    "project_doc_fallback_filenames=[]",
    "--cd",
    checkoutDirectory,
    "--output-schema",
    schemaFile,
    "--json",
    "--color",
    "never",
    "-",
  ];
}

export function parseTrustedLocalReviewJsonl(raw: string): {
  findings: MethodologyReviewOutput;
  usage: TrustedLocalReviewUsage | null;
} {
  if (Buffer.byteLength(raw) > TRUSTED_LOCAL_REVIEW_OUTPUT_BYTES) throw new Error("review JSONL exceeds bound");
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 4) throw new Error("review JSONL is incomplete");
  const events = lines.map((line) => {
    const value = JSON.parse(line) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as { type?: unknown }).type !== "string") {
      throw new Error("review JSONL event is malformed");
    }
    return value as Record<string, unknown>;
  });
  if (events[0]?.type !== "thread.started" || events[1]?.type !== "turn.started" || events.at(-1)?.type !== "turn.completed") {
    throw new Error("review JSONL lifecycle is incomplete");
  }
  if (events.filter((event) => event.type === "thread.started").length !== 1 ||
      events.filter((event) => event.type === "turn.started").length !== 1 ||
      events.filter((event) => event.type === "turn.completed").length !== 1) {
    throw new Error("review JSONL lifecycle is ambiguous");
  }
  const messages = events.filter((event) => {
    const item = event.item;
    return event.type === "item.completed" && item !== null && typeof item === "object" &&
      !Array.isArray(item) && (item as { type?: unknown }).type === "agent_message";
  });
  const message = messages.at(-1)?.item as Record<string, unknown> | undefined;
  if (typeof message?.text !== "string") throw new Error("review JSONL has no completed agent message");
  const findings = parseMethodologyReviewOutput(JSON.parse(message.text));
  return { findings, usage: parseUsage(events.at(-1)?.usage) };
}

function parseUsage(value: unknown): TrustedLocalReviewUsage | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("review usage is malformed");
  const usage = value as Record<string, unknown>;
  return {
    inputTokens: nonnegativeInteger(usage.input_tokens, "input_tokens"),
    cachedInputTokens: optionalNonnegativeInteger(usage.cached_input_tokens, "cached_input_tokens"),
    outputTokens: nonnegativeInteger(usage.output_tokens, "output_tokens"),
    reasoningOutputTokens: optionalNonnegativeInteger(usage.reasoning_output_tokens, "reasoning_output_tokens"),
  };
}

function optionalNonnegativeInteger(value: unknown, field: string): number | null {
  return value === undefined ? null : nonnegativeInteger(value, field);
}

function nonnegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`review usage ${field} is invalid`);
  return Number(value);
}

function resolveExistingDirectory(path: string, field: string): string {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new Error(`${field} does not exist`);
  return resolved;
}

function safeId(value: string, field: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error(`${field} is invalid`);
  return value;
}

function writeExclusive(path: string, value: string): void {
  writeFileSync(path, value, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
