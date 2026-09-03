import type { RunFailureKind } from "./core/run-failure.js";

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
  /** Eval-only process isolation. Production review callers leave this unset. */
  evaluationIsolation?: EvaluationIsolation;
  config: PeregrineConfig;
}

export interface EvaluationIsolation {
  providerHome: string;
  providerAssetsRoot: string;
  validatePrompt(input: {
    prompt: string;
    stage: "breadth" | "investigation";
    /** Exact provider output embedded into the investigation prompt. */
    untrustedModelText?: string;
  }): void;
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

export const CASE_CORPORA = ["structural-smoke", "development", "validation"] as const;
export type CaseCorpus = (typeof CASE_CORPORA)[number];

interface CaseSpecBase {
  /** Opaque identifier; must also be the case directory basename. */
  id: string;
  corpus: CaseCorpus;
  diffFile: string;
  /** Optional sanitized title/body JSON. Curator notes do not belong here. */
  metadataFile?: string;
  /** Curator-only, content-addressed exceptions for legitimate source markers. */
  leakageExceptionsFile?: string;
}

export interface FixtureCaseSpec extends CaseSpecBase {
  kind: "seeded" | "clean";
  fixtureDir: string;
}

export interface HistoricalCaseSpec extends CaseSpecBase {
  kind: "historical";
  repoSource: string;
  baseCommit: string;
  headCommit: string;
}

export type CaseSpec = FixtureCaseSpec | HistoricalCaseSpec;

export interface MatrixModelConfig {
  name: string;
  runner: RunnerName;
  overrides?: Record<string, unknown>;
}

export interface MatrixConfig {
  repeats: number;
  configs: MatrixModelConfig[];
  corpora?: CaseCorpus[];
}

export interface RunAttempt {
  id: string;
  caseName: string;
  corpus: CaseCorpus | "unknown";
  /** Immutable count used by reporting when curator truth later moves or is invalid. */
  expectedBugCount: number | null;
  configName: string;
  repeat: number;
  file: string;
}

export interface MatrixRunManifest {
  schemaVersion: 1;
  createdAt: string;
  expectedAttempts: RunAttempt[];
  providerNetworkIsolation: Partial<Record<RunnerName, NetworkIsolationCapability>>;
}

export interface NetworkIsolationCapability {
  status: "enforced" | "limited" | "unavailable" | "not-applicable";
  mechanism: string;
}

export type EvaluationDiffNormalization = "identity-v1";

export interface EvaluationHistoryProvenance {
  schemaVersion: 1;
  materialization: "fixture-patch" | "historical-sanitized-export";
  objectFormat: "sha1" | "sha256";
  baseRef: string;
  headRef: string;
  mergeBase: string;
  baseTree: string;
  headTree: string;
  commitCount: 2;
  baseIsMergeBase: true;
  checkedOutTreeMatchesHead: true;
  treeReproductionVerified: true;
  historicalSource?: {
    sourceIdentitySha256: string;
    sourceBaseRef: string;
    sourceHeadRef: string;
    sourceMergeBase: string;
    sourceBaseTree: string;
    sourceHeadTree: string;
    baseCommitIsMergeBase: true;
    baseTreeMatches: true;
    headTreeMatches: true;
  };
  diffNormalization: EvaluationDiffNormalization;
  diffSha256: string;
}

export interface EvaluationManifestProvenance {
  entryPoint: "prepareReviewManifest";
  skillName: string;
  baseRef: string;
  headRef: string;
  mergeBase: string;
  outputSha256: string;
  /** Exact bounded text returned by the production manifest entry point. */
  output: string;
  profileSource:
    | "none"
    | "merge-base snapshot"
    | "ignored; absent at merge base";
  headProfileChanged: boolean;
}

export interface EvaluationAttemptProvenance {
  history: EvaluationHistoryProvenance;
  /** Absent only when production-manifest preflight failed closed. */
  manifest?: EvaluationManifestProvenance;
}

export type RunOutcome =
  | { status: "completed"; result: EngineResult }
  | {
      status: "failed";
      failureKind: RunFailureKind;
      message: string;
      durationMs: number;
    };

export interface RunRecord {
  schemaVersion: 1;
  attemptId: string;
  caseName: string;
  caseCorpus: CaseCorpus | "unknown";
  caseKind: CaseSpec["kind"] | "unknown";
  configName: string;
  repeat: number;
  startedAt: string;
  finishedAt: string;
  /** Present after history materialization; manifest is added only after its preflight passes. */
  evaluationProvenance?: EvaluationAttemptProvenance;
  outcome: RunOutcome;
}

export interface GradedRun extends Omit<RunRecord, "outcome"> {
  outcome: Extract<RunOutcome, { status: "completed" }>;
  matches: Record<string, number | null>;
  falsePositiveIndexes: number[];
}
