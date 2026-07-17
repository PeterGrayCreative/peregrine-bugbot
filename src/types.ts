/**
 * Core contracts. The whole point of this file is decoupling:
 * anything that can turn a ReviewContext into an EngineResult is a valid
 * engine — Claude via the bugbot-codex-skills skill today, OpenAI/codex or
 * anything else tomorrow. The orchestrator, GitHub layer, and eval harness
 * only ever speak these types.
 */

export type Severity = "high" | "medium" | "low";

export interface Finding {
  file: string;
  startLine: number;
  endLine: number;
  severity: Severity;
  category: string;
  title: string;
  explanation: string;
  /**
   * The concrete failure path: what input/state triggers the bug.
   * Engines should drop findings they cannot articulate a failure path for —
   * this single rule is the main false-positive filter.
   */
  failurePath: string;
  /** 0..1 — engine's own confidence. Posting threshold applied downstream. */
  confidence: number;
  fingerprint?: string;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface EngineResult {
  engine: string;
  /** e.g. "haiku-4-5->sonnet-5" — whatever identifies the model config */
  modelConfig: string;
  findings: Finding[];
  usage: Usage;
  durationMs: number;
  /** Anything engine-specific worth keeping for debugging. */
  raw?: unknown;
}

export interface ReviewContext {
  /** Absolute path to a checkout of the code under review (head state). */
  repoPath: string;
  /** Absolute path to a unified diff file (base...head). */
  diffPath: string;
  /**
   * When base+head are set and repoPath has git objects, engines should let
   * the skill drive git (merge-base review) instead of embedding the diff.
   */
  baseRef?: string;
  headRef?: string;
  /** PR metadata — feeds the skill's scope contract when available. */
  prTitle?: string;
  prBody?: string;
  /** When true, engines should use their larger "deep dive" budget. */
  deep?: boolean;
  config: PeregrineConfig;
}

export interface ClaudeEngineConfig {
  tier1Model: string;
  tier2Model: string;
  /** Skill directory name as installed under .claude/skills/ in repoPath. */
  skillName: string;
  maxTurns: number;
  timeoutMs: number;
}

export interface PeregrineConfig {
  engine: string;
  engines: {
    claude: ClaudeEngineConfig;
    [name: string]: unknown;
  };
  limits: {
    maxEscalations: number;
    maxDiffLines: number;
    minConfidenceToPost: number;
    maxCommentsPerPr: number;
  };
  filters: {
    ignorePaths: string[];
  };
}

/* ----------------------------- Eval harness ------------------------------ */

export interface GroundTruthBug {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  description: string;
}

export interface GroundTruth {
  /** Empty array for "clean" cases — any finding is a false positive. */
  bugs: GroundTruthBug[];
}

export interface CaseSpec {
  name: string;
  /** "seeded" (injected bug), "historical" (real past bug), or "clean". */
  kind: "seeded" | "historical" | "clean";
  /** Either a bundled fixture directory (relative to the case dir)... */
  fixtureDir?: string;
  /** ...or a repo to clone at a specific commit. */
  repo?: string;
  commit?: string;
  /** Diff file relative to the case dir. */
  diffFile: string;
  notes?: string;
}

export interface MatrixModelConfig {
  name: string;
  engine: string;
  /** Overrides merged into the engine's config (e.g. tier1Model/tier2Model). */
  overrides?: Record<string, unknown>;
}

export interface MatrixConfig {
  repeats: number;
  configs: MatrixModelConfig[];
}

export interface RunRecord {
  caseName: string;
  caseKind: CaseSpec["kind"];
  configName: string;
  repeat: number;
  result: EngineResult;
  startedAt: string;
}

export interface GradedRun extends RunRecord {
  /** ground-truth bug id -> index into findings, or null if missed */
  matches: Record<string, number | null>;
  falsePositiveIndexes: number[];
}
