import { spawn } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
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
    stdin?: string;
  } = {},
): Promise<ExecResult> {
  return new Promise((res) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.inheritEnv === false ? opts.env : { ...process.env, ...opts.env },
      stdio: [opts.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const settle = (result: ExecResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      res(result);
    };
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : undefined;

    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
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
