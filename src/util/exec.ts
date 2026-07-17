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
  opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<ExecResult> {
  return new Promise((res) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : undefined;

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      res({ stdout, stderr, code, timedOut });
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
