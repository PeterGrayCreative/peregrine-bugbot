export const RUNNER_NAMES = ["claude", "codex", "mock"] as const;
export type RunnerName = (typeof RUNNER_NAMES)[number];

export const FINDING_CATEGORIES = [
  "authorization",
  "identifiers",
  "data-integrity",
  "persistence",
  "runtime-config",
  "contracts",
  "concurrency",
  "test-quality",
  "logic",
  "error-handling",
  "frontend-state",
  "boundaries",
  "other",
] as const;

export type FindingCategory = (typeof FINDING_CATEGORIES)[number];
export type Severity = "high" | "medium" | "low";
export type FindingDisposition = "fix-in-pr" | "follow-up";
export type ReviewStatus = "completed" | "clean" | "skipped";
export type CodexEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface Finding {
  file: string;
  startLine: number;
  endLine: number;
  severity: Severity;
  disposition: FindingDisposition;
  category: FindingCategory;
  invariant: string;
  title: string;
  explanation: string;
  failurePath: string;
  confidence: number;
  fingerprint?: string;
}

export interface BreadthCandidate {
  id: string;
  lane: string;
  file: string;
  line: number;
  invariant: string;
  counterexample: string;
  evidenceNeeded: string;
}

export interface BreadthResult {
  model: string;
  candidates: BreadthCandidate[];
  clear: Array<{ lane: string; file: string; reason: string }>;
  escalations: Array<{ target: string; reason: string }>;
  coverage: { coveredFiles: string[]; unavailable: string[] };
}

export interface ReviewPayload {
  findings: Finding[];
}

export interface Usage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  costUsd?: number;
}

export interface EngineResult {
  engine: RunnerName;
  status: ReviewStatus;
  modelConfig: string;
  reviewedBaseRef?: string;
  reviewedHeadRef?: string;
  findings: Finding[];
  usage: Usage;
  durationMs: number;
  raw?: unknown;
}

export interface ReviewContext {
  repoPath: string;
  diffPath: string;
  diffText?: string;
  ignoredFiles?: string[];
  baseRef?: string;
  headRef?: string;
  prTitle?: string;
  prBody?: string;
  profilePath?: string;
  deep?: boolean;
  config: PeregrineConfig;
}

export interface ClaudeRunnerConfig {
  breadthModel: string;
  breadthEffort: ClaudeEffort;
  investigationModel: string;
  investigationEffort: ClaudeEffort;
  skillName: string;
  maxTurns: number;
  maxBudgetUsd: number;
  timeoutMs: number;
}

export interface CodexRunnerConfig {
  breadthModel: string;
  investigationModel: string;
  breadthEffort: CodexEffort;
  investigationEffort: CodexEffort;
  skillName: string;
  timeoutMs: number;
}

export interface PeregrineConfig {
  schemaVersion: 1;
  runner: RunnerName;
  runners: {
    claude: ClaudeRunnerConfig;
    codex: CodexRunnerConfig;
    mock: Record<string, never>;
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
  bugs: GroundTruthBug[];
}

export interface CaseSpec {
  name: string;
  kind: "seeded" | "historical" | "clean";
  fixtureDir?: string;
  repo?: string;
  commit?: string;
  diffFile: string;
  notes?: string;
}

export interface MatrixModelConfig {
  name: string;
  runner: RunnerName;
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
  matches: Record<string, number | null>;
  falsePositiveIndexes: number[];
}
