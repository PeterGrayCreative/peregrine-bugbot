import { readFileSync } from "node:fs";
import type { EngineResult, Finding, ReviewContext } from "../types.js";
import type { Engine } from "./engine.js";

/**
 * Deterministic fake engine so the pipeline (matrix -> grade -> report) can be
 * exercised end-to-end with zero API cost. It "finds" a bug on any added line
 * containing the marker comment `// BUG:` and reports nothing else.
 */
export const mockEngine: Engine = {
  name: "mock",
  async review(ctx: ReviewContext): Promise<EngineResult> {
    const started = Date.now();
    const diff = readFileSync(ctx.diffPath, "utf8");
    const findings: Finding[] = [];

    let currentFile = "";
    let newLine = 0;
    for (const line of diff.split("\n")) {
      const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
      if (fileMatch) {
        currentFile = fileMatch[1]!;
        continue;
      }
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if (hunkMatch) {
        newLine = Number(hunkMatch[1]);
        continue;
      }
      if (line.startsWith("+") && !line.startsWith("+++")) {
        if (line.includes("// BUG:")) {
          findings.push({
            file: currentFile,
            startLine: newLine,
            endLine: newLine,
            severity: "high",
            category: "seeded",
            title: `Suspicious change in ${currentFile}`,
            explanation: line.replace(/^\+\s*/, ""),
            failurePath: "Marker-based mock detection.",
            confidence: 0.95,
          });
        }
        newLine++;
      } else if (!line.startsWith("-")) {
        newLine++;
      }
    }

    return {
      engine: "mock",
      modelConfig: "mock",
      findings,
      usage: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
      durationMs: Date.now() - started,
    };
  },
};
