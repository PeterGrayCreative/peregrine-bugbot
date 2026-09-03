import type { RunFailureKind } from "./core/run-failure.js";
import type { CoreLaneId } from "./core/review-lanes.js";

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

export const USAGE_METRICS = [
  "inputTokens",
  "baseInputTokens",
  "uncachedInputTokens",
  "cachedInputTokens",
  "cacheWriteInputTokens",
  "cacheReadInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "turns",
  "toolCalls",
  "toolCallsByType",
  "toolOutputBytes",
  "promptBytes",
  "costUsd",
] as const;

export type UsageMetric = (typeof USAGE_METRICS)[number];
export type UsageProvider = "anthropic" | "openai" | "mock";
export type CostSource = "provider" | "estimated" | "mixed";
export type UsageAggregation = "single-envelope" | "single-snapshot" | "ambiguous" | "stage-sum";
export type MalformedUsageField = "serviceTier" | "costUsd";

export interface PricingReference {
  catalogVersion: string;
  pricingAsOf: string;
  contractModel: string;
  serviceTier?: string;
  tier: string;
  assumptions: string[];
}

export interface Usage {
  provider?: UsageProvider;
  serviceTier?: string;
  aggregation?: UsageAggregation;
  /** Normalized total provider input when every input component is known. */
  inputTokens?: number;
  /** Provider-reported base input, distinct from cache writes and reads. */
  baseInputTokens?: number;
  /** Uncached input, reported or safely derived from a provider total. */
  uncachedInputTokens?: number;
  /** Compatibility aggregate; provider-specific cache fields remain authoritative. */
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  cacheReadInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  turns?: number;
  toolCalls?: number;
  toolCallsByType?: Record<string, number>;
  toolOutputBytes?: number;
  promptBytes?: number;
  costUsd?: number;
  costSource?: CostSource;
  pricing?: PricingReference;
  /** Provider fields that were present but invalid; never eligible for estimation fallback. */
  malformed?: MalformedUsageField[];
  /** Metrics the provider did not expose or whose semantics were ambiguous. */
  unavailable?: UsageMetric[];
}

export interface PricingRates {
  baseInputPerMillionUsd?: number;
  uncachedInputPerMillionUsd?: number;
  cacheWriteInputPerMillionUsd?: number;
  cacheReadInputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
  reasoningOutputPerMillionUsd?: number;
}

export interface PricingTier extends PricingRates {
  id: string;
  /** Inclusive threshold. Omit on the final catch-all tier. */
  upToInputTokens?: number;
}

export interface ProviderPriceContract {
  provider: Exclude<UsageProvider, "mock">;
  model: string;
  serviceTier?: string;
  reasoningOutputBilling: "included-in-output" | "separate";
  tiers: PricingTier[];
  assumptions: string[];
}

export interface PricingCatalog {
  schemaVersion: 1;
  version: string;
  pricingAsOf: string;
  currency: "USD";
  contracts: ProviderPriceContract[];
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

export interface StageTelemetry {
  stage: "breadth" | "investigation";
  model: string;
  promptSha256: string;
  usage: Usage;
  durationMs: number;
  completed: boolean;
}

export interface RunFailureTelemetry {
  engine: RunnerName;
  modelConfig: string;
  usage: Usage;
  durationMs: number;
  stages: StageTelemetry[];
}

export type FailureTelemetryUnavailableReason = "not-observed" | "secret-redacted";

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
  pricing?: PricingCatalog;
}

/* ----------------------------- Eval harness ------------------------------ */

export interface GroundTruthBug {
  id: string;
  rootCauseGroup?: string;
  lane: CoreLaneId;
  expectedDisposition: FindingDisposition;
  expectedSeverity: Severity;
  file: string;
  startLine: number;
  endLine: number;
  description: string;
  reachablePreconditions: string;
  observableImpact: string;
  provenance: string;
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

export const EXPERIMENT_MODES = ["structural-smoke", "screening", "checkpoint"] as const;
export type ExperimentMode = (typeof EXPERIMENT_MODES)[number];
export type ExperimentCacheCondition = "cold" | "warm" | "uncontrolled" | "not-applicable";
export type ExperimentJudge = "exact" | "claude" | "codex";
export type ExperimentProviderAccess = "api-key" | "cli-session" | "not-applicable";
export type ExperimentCostAccounting = "required" | "best-effort" | "not-applicable";

export interface ExperimentLimits {
  /** Observed spend ceiling checked before every scheduled provider invocation. */
  maxProviderCostUsd: number | null;
  /** Hard cap for provider-started attempts, including interrupted attempts. */
  maxProviderAttempts: number;
  /** Sum of persisted attempt durations; idle time between resume invocations is excluded. */
  maxWallTimeMs: number;
  maxFailureRate: number;
  /** Completed attempt count required before checking failure rate at a block boundary. */
  minAttemptsForFailureRate: number;
  maxConsecutiveFailures: number;
}

export interface ExperimentProtocol {
  mode: ExperimentMode;
  seed: number;
  cacheCondition: ExperimentCacheCondition;
  /** Explicit authorization gate; `deny` still permits the zero-cost mock runner. */
  providerCalls: "allow" | "deny";
  providerAccess: ExperimentProviderAccess;
  costAccounting: ExperimentCostAccounting;
  judge: {
    kind: ExperimentJudge;
    /** Required for provider-backed semantic judges; absent for exact grading. */
    model?: string;
    version: string;
  };
  /** Required together for screening and checkpoint comparisons. */
  control?: string;
  treatment?: string;
  limits: ExperimentLimits;
}

export interface MatrixConfig {
  repeats: number;
  configs: MatrixModelConfig[];
  corpora?: CaseCorpus[];
  experiment: ExperimentProtocol;
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
  runner: RunnerName;
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
      telemetry?: RunFailureTelemetry;
      /** Why provider work metadata is absent even though the attempt failed. */
      telemetryUnavailableReason?: FailureTelemetryUnavailableReason;
    };

export interface RunRecord {
  schemaVersion: 1;
  /** Required for immutable experiments; absent only on pre-experiment compatibility artifacts. */
  experimentId?: string;
  /** Raw SHA-256 of the exact immutable experiment-manifest.json bytes. */
  experimentManifestSha256?: string;
  attemptId: string;
  caseName: string;
  caseCorpus: CaseCorpus | "unknown";
  caseKind: CaseSpec["kind"] | "unknown";
  configName: string;
  repeat: number;
  runner: RunnerName;
  startedAt: string;
  finishedAt: string;
  /** Terminal wall time for materialization, provider work, and isolated cleanup. */
  attemptDurationMs: number;
  /** Present after history materialization; manifest is added only after its preflight passes. */
  evaluationProvenance?: EvaluationAttemptProvenance;
  outcome: RunOutcome;
}

export interface GradedRun extends Omit<RunRecord, "outcome"> {
  outcome: Extract<RunOutcome, { status: "completed" }>;
  matches: Record<string, number | null>;
  falsePositiveIndexes: number[];
  grading?: GradingEvidence;
}

export type MissStage = "none" | "routing" | "breadth" | "investigation" | "budget" | "presentation" | "infrastructure";
export type UnmatchedFindingClassification = "confirmed-new" | "unsupported" | "unresolved";

export interface SemanticJudgeDecision {
  decisionId: string;
  judgeVersion: "semantic-v1";
  bugId: string;
  findingEvidenceSha256: string;
  verdict: "same-root-cause" | "different-root-cause" | "failed";
  failureKind?: "timeout" | "provider" | "parse" | "configuration" | "unknown";
}

export interface UnmatchedFindingAdjudication {
  findingIndex: number;
  findingEvidenceSha256: string;
  classification: UnmatchedFindingClassification;
}

export interface GradingEvidence {
  version: "root-cause-v1";
  judge: { kind: ExperimentJudge; version: string };
  decisions: SemanticJudgeDecision[];
  rootCauseMatches: Record<string, boolean>;
  missStages: Record<string, MissStage>;
  unmatchedFindings: UnmatchedFindingAdjudication[];
}
