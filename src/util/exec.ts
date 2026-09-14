import { spawn } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  /** Secondary outer-containment cleanup failures; the provider result remains primary. */
  cleanupErrors?: readonly string[];
  /** Opt-in mechanical observation; unavailable if no child was spawned. */
  processId?: number | null;
  /** Set only by opt-in bounded capture; raw bytes never exceed its memory cap. */
  outputLimitExceeded?: boolean;
}

/** Run a subprocess, capture output, kill on timeout. Never throws on non-zero exit. */
export function exec(
  cmd: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: Record<string, string>;
    inheritEnv?: boolean;
    timeoutMs?: number;
    /** Optional outer whole-attempt deadline; cleanup must use a separate signal. */
    deadlineSignal?: AbortSignal;
    stdin?: string;
    captureProcessId?: boolean;
    maximumOutputBytes?: number;
  } = {},
): Promise<ExecResult> {
  return new Promise((res) => {
    if (opts.maximumOutputBytes !== undefined && (!Number.isSafeInteger(opts.maximumOutputBytes) || opts.maximumOutputBytes < 1 || opts.maximumOutputBytes > 16_777_216)) throw new Error("invalid subprocess capture limit");
    if (opts.deadlineSignal?.aborted) {
      res({ stdout: "", stderr: "whole-attempt deadline elapsed before spawn", code: -1, timedOut: true });
      return;
    }
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.inheritEnv === false ? opts.env : { ...process.env, ...opts.env },
      stdio: [opts.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let capturedBytes = 0, outputLimitExceeded = false;
    const bounded: Record<"stdout" | "stderr", Buffer[]> = { stdout: [], stderr: [] };
    const settle = (result: ExecResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.deadlineSignal?.removeEventListener("abort", abortAtDeadline);
      if (opts.maximumOutputBytes !== undefined) {
        try {
          const decoder = new TextDecoder("utf-8", { fatal: true });
          result.stdout = decoder.decode(Buffer.concat(bounded.stdout));
          result.stderr = decoder.decode(Buffer.concat(bounded.stderr));
        } catch { result.stdout = result.stderr = ""; outputLimitExceeded = true; }
      }
      res({ ...result, ...(opts.captureProcessId ? { processId: child.pid ?? null } : {}),
        ...(opts.maximumOutputBytes !== undefined ? { outputLimitExceeded } : {}) });
    };
    const abortAtDeadline = () => { timedOut = true; child.kill("SIGKILL"); };
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : undefined;
    opts.deadlineSignal?.addEventListener("abort", abortAtDeadline, { once: true });
    if (opts.deadlineSignal?.aborted) abortAtDeadline();

    const capture = (data: Buffer, stream: "stdout" | "stderr") => {
      let bytes = data;
      if (opts.maximumOutputBytes !== undefined) {
        const remaining = Math.max(0, opts.maximumOutputBytes - capturedBytes);
        if (data.length > remaining) { bytes = data.subarray(0, remaining); outputLimitExceeded = true; child.kill("SIGKILL"); }
        capturedBytes += bytes.length;
        if (bytes.length) bounded[stream].push(Buffer.from(bytes));
        return;
      }
      if (stream === "stdout") stdout += bytes; else stderr += bytes;
    };
    child.stdout?.on("data", (d: Buffer) => capture(d, "stdout"));
    child.stderr?.on("data", (d: Buffer) => capture(d, "stderr"));
    if (opts.stdin !== undefined) child.stdin?.end(opts.stdin);
    // Spawn failures (e.g. command not found) emit "error" and may never emit
    // "close" — without this handler the promise would hang forever. code -1
    // signals "process never ran"; callers treat any nonzero code as failure.
    child.on("error", (err) => {
      settle({ stdout, stderr: stderr || String(err), code: -1, timedOut });
    });
    child.on("close", (code) => {
      settle({ stdout, stderr, code, timedOut });
    });
  });
}

/** Extract the last JSON object/array embedded in free text (fenced or bare). */
export function lastJsonBlock(text: string): unknown | undefined {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  for (const candidate of fenced.reverse()) {
    try {
      return JSON.parse(candidate!.trim());
    } catch {
      /* keep looking */
    }
  }
  // Fall back: try to parse the whole thing, then trailing braces.
  try {
    return JSON.parse(text.trim());
  } catch {
    const start = Math.min(
      ...["{", "["].map((c) => {
        const i = text.indexOf(c);
        return i === -1 ? Number.POSITIVE_INFINITY : i;
      }),
    );
    if (!Number.isFinite(start)) return undefined;
    try {
      return JSON.parse(text.slice(start).trim());
    } catch {
      return undefined;
    }
  }
}
