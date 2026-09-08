import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertNoSecrets } from "../src/security/secrets.js";
import type { Finding, GroundTruthBug, SemanticJudgeDecision } from "../src/types.js";
import {
  canonicalJson,
  canonicalJsonSha256,
  writeExclusiveJson,
} from "./experiment.js";
import {
  buildJudgeManifest,
  judgeComparisonId,
  readSealedJudgeLedger,
  runJudgeLedger,
  type JudgeLimits,
  type JudgeManifest,
  type JudgePairInput,
  type JudgeRunResult,
} from "./judge-ledger.js";
import { type SemanticJudgeExecutor } from "./judge-runtime.js";
import {
  buildArmBlindSemanticJudgePrompt,
  neutralHistoricalTruthPayload,
  neutralHistoricalTruthPayloadSha256,
  neutralMethodologyFindingPayload,
  neutralMethodologyFindingPayloadSha256,
} from "./methodology-judge-prompt.js";
import {
  methodologyComparisonId,
  methodologyFindingEvidenceSha256,
  methodologyGradingProjectionSha256,
  methodologyReviewOutputSha256,
} from "./methodology-grading-contract.js";
import {
  type AuthenticatedMethodologyGradingProjection,
  type AuthenticatedMethodologyGradingProjectionSet,
} from "./methodology-grading-projection.js";
import { parseHistoricalGroundTruth, type HistoricalTruthBug } from "./historical-truth.js";
import { historicalTruthScopeSha256 } from "./historical-curation.js";
import { parseMethodologyReviewOutput, type MethodologyFinding, type MethodologyReviewOutput } from "./methodology-output.js";

export const METHODOLOGY_JUDGE_OCCURRENCES_FILE = "methodology-judge-occurrences.json";
export const METHODOLOGY_JUDGE_OCCURRENCES_PROTOCOL = "methodology-judge-occurrences-v1" as const;

const SHA256 = /^[a-f0-9]{64}$/;
const NEUTRAL_BUG_ID = "neutral-historical-bug";
const NEUTRAL_BUG_PROVENANCE = "fixed neutral semantic-judge padding";
const NEUTRAL_FINDING_TEXT = "fixed neutral semantic-judge padding";

/** One emitted finding occurrence, retained even when its generic pair dedupes. */
export interface MethodologyJudgeOccurrence {
  attemptId: string;
  bugId: string;
  findingIndex: number;
  findingEvidenceSha256: string;
  neutralTruthPayloadSha256: string;
  neutralFindingPayloadSha256: string;
  promptSha256: string;
  methodologyComparisonId: string;
  judgeComparisonId: string;
}

export interface MethodologyJudgeOccurrencesArtifact {
  schemaVersion: 1;
  protocol: typeof METHODOLOGY_JUDGE_OCCURRENCES_PROTOCOL;
  runId: string;
  executionEvidenceSha256: string;
  invocationRegistrationSha256: string;
  inputPlanSha256: string;
  projectionSetSha256: string;
  judgeManifestSha256: string;
  occurrences: MethodologyJudgeOccurrence[];
  artifactSha256: string;
}

export interface MethodologyJudgePlan {
  runId: string;
  projectionSetSha256: string;
  manifest: JudgeManifest;
  pairs: JudgePairInput[];
  occurrences: MethodologyJudgeOccurrence[];
  artifact: MethodologyJudgeOccurrencesArtifact;
}

export interface MethodologyJudgeOccurrenceVerdict extends MethodologyJudgeOccurrence {
  decision: SemanticJudgeDecision;
}

export interface MethodologyJudgeRunResult {
  runId: string;
  manifest: JudgeManifest;
  terminal: "completed" | "stopped";
  occurrences: MethodologyJudgeOccurrenceVerdict[];
  artifact: MethodologyJudgeOccurrencesArtifact;
  generic: JudgeRunResult;
}

export interface MethodologyJudgeInputs {
  runId: string;
  projections: AuthenticatedMethodologyGradingProjectionSet;
  providerAccess: "api-key" | "cli-session";
  limits: JudgeLimits;
  judgeImplementationSha256: string;
}

interface PairSource {
  pair: JudgePairInput;
  bug: HistoricalTruthBug;
  finding: MethodologyFinding;
}

/** Deterministic digest of the caller-authenticated projection set. */
export function methodologyProjectionSetSha256(
  projections: AuthenticatedMethodologyGradingProjectionSet,
): string {
  const validated = validateProjectionSet(projections);
  return canonicalJsonSha256({
    protocol: METHODOLOGY_JUDGE_OCCURRENCES_PROTOCOL,
    runId: validated.runId,
    executionEvidenceSha256: validated.executionEvidenceSha256,
    invocationRegistrationSha256: validated.invocationRegistrationSha256,
    inputPlanSha256: validated.inputPlanSha256,
    projections: validated.projections
      .map(({ projection, projectionSha256 }) => ({ attemptId: projection.attemptId, projectionSha256 }))
      .sort((left, right) => left.attemptId.localeCompare(right.attemptId)),
  });
}

/** Compile all completed projection pairs and the occurrence-preserving artifact. */
export function buildMethodologyJudgePlan(input: MethodologyJudgeInputs): MethodologyJudgePlan {
  validateRunId(input.runId);
  requireHash(input.judgeImplementationSha256, "judgeImplementationSha256");
  const projections = validateProjectionSet(input.projections);
  if (input.runId !== projections.runId) {
    throw new Error("methodology judge runId does not match the authenticated projection set");
  }
  const projectionSetSha256 = methodologyProjectionSetSha256(projections);
  const pairSources: PairSource[] = [];

  for (const item of projections.projections) {
    if (item.projection.status !== "completed") continue;
    const truth = item.truth;
    const review = item.reviewOutput!;
    // A reviewed-comparison case can intentionally have no known bugs. It is
    // still a valid completed projection, but there is no semantic pair.
    if (truth.bugs.length === 0) continue;
    for (const bug of truth.bugs) {
      for (const [findingIndex, finding] of review.findings.entries()) {
        const pair: JudgePairInput = {
          runAttemptId: item.projection.attemptId,
          bug: neutralLegacyBug(bug),
          finding: neutralLegacyFinding(finding),
          findingIndex,
          prompt: buildArmBlindSemanticJudgePrompt({ bug, finding }),
        };
        pairSources.push({ pair, bug, finding });
      }
    }
  }

  const manifest = buildJudgeManifest({
    experimentId: input.runId,
    experimentManifestSha256: projections.invocationRegistrationSha256,
    experimentTerminalSealSha256: projections.executionEvidenceSha256,
    corpusSha256: projectionSetSha256,
    judgeImplementationSha256: input.judgeImplementationSha256,
    providerAccess: input.providerAccess,
    limits: input.limits,
    pairs: pairSources.map(({ pair }) => pair),
  });
  const pairs = pairSources.map(({ pair }) => pair);
  const occurrences = occurrenceRecords(pairSources, manifest);
  const artifactBody = {
    schemaVersion: 1 as const,
    protocol: METHODOLOGY_JUDGE_OCCURRENCES_PROTOCOL,
    runId: input.runId,
    executionEvidenceSha256: projections.executionEvidenceSha256,
    invocationRegistrationSha256: projections.invocationRegistrationSha256,
    inputPlanSha256: projections.inputPlanSha256,
    projectionSetSha256,
    judgeManifestSha256: manifest.manifestSha256,
    occurrences,
  };
  const artifact: MethodologyJudgeOccurrencesArtifact = {
    ...artifactBody,
    artifactSha256: canonicalJsonSha256(artifactBody),
  };
  assertNoSecrets(artifact, "methodology judge occurrences");
  return { runId: input.runId, projectionSetSha256, manifest, pairs, occurrences, artifact };
}

/** Persist occurrences before starting (or resuming) any generic judge call. */
export async function runMethodologyJudgeLedger(input: MethodologyJudgeInputs & {
  runDirectory: string;
  execute: SemanticJudgeExecutor;
  now?: () => string;
}): Promise<MethodologyJudgeRunResult> {
  const plan = buildMethodologyJudgePlan(input);
  const root = resolve(input.runDirectory);
  const path = join(root, METHODOLOGY_JUDGE_OCCURRENCES_FILE);
  if (existsSync(path)) {
    const stored = readMethodologyJudgeOccurrences(path);
    assertArtifactMatchesPlan(stored, plan);
  } else if (existsSync(join(root, "judge", "terminal-seal.json")) || existsSync(join(root, "judge", "manifest.json"))) {
    throw new Error("methodology judge occurrence artifact is missing from an existing generic ledger");
  } else {
    writeExclusiveJson(root, path, plan.artifact);
  }
  const generic = await runJudgeLedger({
    runDirectory: root,
    manifest: plan.manifest,
    pairs: plan.pairs,
    execute: input.execute,
    now: input.now,
  });
  return mapRunResult(plan, generic);
}

/**
 * Rebuild and authenticate the occurrence plan, then map authenticated generic
 * decisions to every retained occurrence. No caller-supplied decision is read.
 */
export function readMethodologyJudgeLedger(input: MethodologyJudgeInputs & {
  runDirectory: string;
  expectedOccurrenceArtifactSha256: string;
  expectedJudgeManifestSha256: string;
  expectedJudgeTerminalSealSha256: string;
  expectedProjectionSetSha256: string;
}): MethodologyJudgeRunResult {
  const plan = buildMethodologyJudgePlan(input);
  requireHash(input.expectedOccurrenceArtifactSha256, "expectedOccurrenceArtifactSha256");
  requireHash(input.expectedJudgeManifestSha256, "expectedJudgeManifestSha256");
  requireHash(input.expectedJudgeTerminalSealSha256, "expectedJudgeTerminalSealSha256");
  requireHash(input.expectedProjectionSetSha256, "expectedProjectionSetSha256");
  if (input.expectedProjectionSetSha256 !== plan.projectionSetSha256) {
    throw new Error("caller-held methodology projection-set digest does not match the authenticated projections");
  }
  const root = resolve(input.runDirectory);
  const artifactPath = join(root, METHODOLOGY_JUDGE_OCCURRENCES_FILE);
  const artifact = readMethodologyJudgeOccurrences(artifactPath);
  if (artifact.artifactSha256 !== input.expectedOccurrenceArtifactSha256) {
    throw new Error("caller-held methodology occurrence digest does not match the artifact");
  }
  assertArtifactMatchesPlan(artifact, plan);
  if (plan.manifest.manifestSha256 !== input.expectedJudgeManifestSha256) {
    throw new Error("caller-held methodology judge manifest digest does not match the plan");
  }
  const sealPath = join(root, "judge", "terminal-seal.json");
  if (sha256(readRegularFile(sealPath, "judge terminal seal")) !== input.expectedJudgeTerminalSealSha256) {
    throw new Error("caller-held methodology judge terminal-seal digest does not match the sealed ledger");
  }
  const generic = readSealedJudgeLedger(root, plan.manifest, plan.pairs);
  if (generic.terminal !== "completed" || generic.decisions.length !== plan.manifest.schedule.length ||
      generic.decisions.some(({ decision }) => decision.verdict === "failed")) {
    throw new Error("definitive methodology judge results require a completed successful judge ledger");
  }
  return mapRunResult(plan, generic);
}

/** Read and authenticate one occurrence artifact independently of the ledger. */
export function readMethodologyJudgeOccurrences(path: string): MethodologyJudgeOccurrencesArtifact {
  const artifactPath = (() => {
    try { return lstatSync(path).isDirectory() ? join(path, METHODOLOGY_JUDGE_OCCURRENCES_FILE) : path; }
    catch { return path; }
  })();
  const bytes = readRegularFile(artifactPath, "methodology judge occurrence artifact");
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("methodology judge occurrence artifact is invalid JSON"); }
  const artifact = parseOccurrenceArtifact(value);
  const { artifactSha256, ...body } = artifact;
  if (artifactSha256 !== canonicalJsonSha256(body)) throw new Error("methodology judge occurrence artifact digest is invalid");
  // writeExclusiveJson has a stable representation; reject a reserialized or
  // byte-edited artifact even when its semantic JSON remains unchanged.
  if (bytes.toString("utf8") !== `${JSON.stringify(artifact, null, 2)}\n`) {
    throw new Error("methodology judge occurrence artifact bytes are not canonical");
  }
  assertNoSecrets(artifact, "methodology judge occurrences");
  return artifact;
}

function occurrenceRecords(
  sources: readonly PairSource[],
  manifest: JudgeManifest,
): MethodologyJudgeOccurrence[] {
  const occurrences = sources.map(({ pair, bug: historicalBug, finding }): MethodologyJudgeOccurrence => {
    const promptSha256 = sha256(pair.prompt);
    const result: MethodologyJudgeOccurrence = {
      attemptId: pair.runAttemptId,
      bugId: historicalBug.id,
      findingIndex: pair.findingIndex,
      findingEvidenceSha256: methodologyFindingEvidenceSha256(finding),
      neutralTruthPayloadSha256: neutralHistoricalTruthPayloadSha256(historicalBug),
      neutralFindingPayloadSha256: neutralMethodologyFindingPayloadSha256(finding),
      promptSha256,
      methodologyComparisonId: methodologyComparisonId({ bug: historicalBug, finding, judgeConfigSha256: manifest.judgeConfigSha256 }),
      judgeComparisonId: judgeComparisonId(pair, manifest.judgeConfigSha256),
    };
    return result;
  }).sort(compareOccurrences);
  const identities = new Set<string>();
  for (const occurrence of occurrences) {
    const identity = occurrenceIdentity(occurrence);
    if (identities.has(identity)) throw new Error("duplicate methodology judge occurrence identity");
    identities.add(identity);
  }
  return occurrences;
}

function neutralLegacyBug(bug: HistoricalTruthBug): GroundTruthBug {
  const payload = neutralHistoricalTruthPayload(bug);
  return {
    id: NEUTRAL_BUG_ID,
    lane: "logic-correctness",
    expectedDisposition: "fix-in-pr",
    expectedSeverity: "medium",
    ...payload,
    provenance: NEUTRAL_BUG_PROVENANCE,
  };
}

function neutralLegacyFinding(finding: MethodologyFinding): Finding {
  const payload = neutralMethodologyFindingPayload(finding);
  return {
    ...payload,
    disposition: "fix-in-pr",
    category: "logic",
    invariant: NEUTRAL_FINDING_TEXT,
    title: NEUTRAL_FINDING_TEXT,
    failurePath: NEUTRAL_FINDING_TEXT,
    confidence: 0.5,
  };
}

function mapRunResult(plan: MethodologyJudgePlan, generic: JudgeRunResult): MethodologyJudgeRunResult {
  const decisions = new Map(generic.decisions.map((item) => [item.comparisonId, item.decision]));
  const occurrences = plan.occurrences.filter((occurrence) => decisions.has(occurrence.judgeComparisonId)).map((occurrence) => {
    const decision = decisions.get(occurrence.judgeComparisonId);
    if (!decision) throw new Error("generic judge ledger is missing a methodology occurrence pair");
    return { ...occurrence, decision };
  });
  return { runId: plan.runId, manifest: generic.manifest, terminal: generic.terminal, occurrences, artifact: plan.artifact, generic };
}

function validateProjectionSet(value: AuthenticatedMethodologyGradingProjectionSet): AuthenticatedMethodologyGradingProjectionSet {
  if (!value || !Array.isArray(value.projections)) throw new Error("methodology grading projection set is invalid");
  validateRunId(value.runId);
  for (const [label, hash] of [["executionEvidenceSha256", value.executionEvidenceSha256], ["invocationRegistrationSha256", value.invocationRegistrationSha256], ["inputPlanSha256", value.inputPlanSha256]] as const) {
    requireHash(hash, label);
  }
  const attempts = new Set<string>();
  for (const item of value.projections) {
    validateProjection(item, value);
    if (attempts.has(item.projection.attemptId)) throw new Error("methodology grading projection set contains duplicate attempt identities");
    attempts.add(item.projection.attemptId);
  }
  return value;
}

function validateProjection(item: AuthenticatedMethodologyGradingProjection, set: AuthenticatedMethodologyGradingProjectionSet): void {
  if (!item || !item.projection || !item.truth || !item.resource) throw new Error("methodology grading projection is invalid");
  requireHash(item.projectionSha256, "methodology projection digest");
  if (item.projectionSha256 !== methodologyGradingProjectionSha256(item.projection)) throw new Error("methodology projection digest is stale");
  const projection = item.projection;
  if (projection.executionEvidenceSha256 !== set.executionEvidenceSha256 || projection.inputPlanSha256 !== set.inputPlanSha256) {
    throw new Error("methodology projection belongs to a different execution or input plan");
  }
  const truth = item.truth;
  const parsedTruth = parseHistoricalGroundTruth(truth, "methodology judge projection truth");
  if (canonicalJson(parsedTruth) !== canonicalJson(truth)) throw new Error("methodology projection truth is not canonical");
  if (projection.truthSha256 !== canonicalJsonSha256(truth) || projection.truthScopeSha256 !== historicalTruthScopeSha256(truth)) {
    throw new Error("methodology projection truth digest is stale");
  }
  if (item.resource.attemptId !== projection.attemptId || item.resource.caseName !== projection.caseName) {
    throw new Error("methodology projection resource identity is stale");
  }
  if (!["A", "B", "C", "D"].includes(item.resource.armId) ||
      !Number.isSafeInteger(item.resource.expectedStages) || item.resource.expectedStages < 1 || item.resource.expectedStages > 2 ||
      !Number.isSafeInteger(item.resource.observedStages) || item.resource.observedStages < 0 || item.resource.observedStages > item.resource.expectedStages) {
    throw new Error("methodology projection resource stage identity is invalid");
  }
  if (item.resource.lifecycleTerminalSha256 !== projection.lifecycleTerminalSha256 ||
      item.resource.reviewTerminalSha256 !== projection.reviewTerminalSha256) {
    throw new Error("methodology projection resource terminal hashes are stale");
  }
  const completedResource = item.resource.outcome === "completed";
  const duration = (value: number | null, label: string): void => {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new Error(`methodology projection resource ${label} is invalid`);
  };
  duration(item.resource.wallDurationMs, "wallDurationMs");
  duration(item.resource.reviewDurationMs, "reviewDurationMs");
  if (projection.status === "completed" || projection.status === "incomplete") {
    if (item.reviewOutput === null) throw new Error("methodology projection requires review output");
    const review = parseMethodologyReviewOutput(item.reviewOutput);
    if (projection.reviewOutputSha256 !== hashMethodologyReview(review)) throw new Error("methodology projection review output digest is stale");
    if (projection.status === "completed" && (projection.statusReason !== "authenticated-complete" || review.status !== "completed")) {
      throw new Error("completed methodology projection has inconsistent completion status");
    }
    if (projection.status === "incomplete" &&
        ((projection.statusReason === "model-unable-to-complete" && review.status !== "unable-to-complete") ||
         (projection.statusReason === "runner-scope-unverified" && review.status !== "completed"))) {
      throw new Error("incomplete methodology projection has inconsistent model completion status");
    }
    if (!completedResource || item.resource.observedStages !== item.resource.expectedStages ||
        item.resource.wallDurationMs === null || item.resource.reviewDurationMs === null || item.resource.usage === null) {
      throw new Error("completed methodology projection has inconsistent resource evidence");
    }
    if (item.reviewRawOutput === null || projection.reviewRawOutputSha256 !== sha256(item.reviewRawOutput)) throw new Error("methodology projection raw review digest is stale");
  } else {
    const expectedOutcome = projection.status === "missing" ? "missing" : projection.statusReason === "review-execution-failed" ? "review-failed" : projection.statusReason;
    if (item.resource.outcome !== expectedOutcome) throw new Error("non-completed methodology projection resource outcome is inconsistent");
    if (projection.status === "missing" || projection.statusReason === "preflight-failed" || projection.statusReason === "interrupted") {
      if (item.resource.reviewDurationMs !== null || item.resource.usage !== null) throw new Error("pre-review methodology projection has review evidence");
    }
    if (projection.statusReason === "review-execution-failed" &&
        (item.resource.reviewDurationMs === null || item.resource.usage === null)) {
      throw new Error("failed methodology projection has incomplete review evidence");
    }
    if (item.reviewOutput !== null || item.reviewRawOutput !== null || projection.reviewOutputSha256 !== null || projection.reviewRawOutputSha256 !== null) {
      throw new Error("failed or missing methodology projection cannot carry review output");
    }
  }
}

function hashMethodologyReview(review: MethodologyReviewOutput): string {
  return methodologyReviewOutputSha256(review);
}

function assertArtifactMatchesPlan(artifact: MethodologyJudgeOccurrencesArtifact, plan: MethodologyJudgePlan): void {
  if (artifact.runId !== plan.runId || artifact.executionEvidenceSha256 !== plan.artifact.executionEvidenceSha256 ||
      artifact.invocationRegistrationSha256 !== plan.artifact.invocationRegistrationSha256 || artifact.inputPlanSha256 !== plan.artifact.inputPlanSha256 ||
      artifact.projectionSetSha256 !== plan.projectionSetSha256 || artifact.judgeManifestSha256 !== plan.manifest.manifestSha256 ||
      canonicalJson(artifact.occurrences) !== canonicalJson(plan.occurrences)) {
    throw new Error("methodology judge occurrence artifact does not match the rederived plan");
  }
  const { artifactSha256: ignored, ...body } = artifact;
  if (artifact.artifactSha256 !== canonicalJsonSha256(body)) throw new Error("methodology judge occurrence artifact digest is invalid");
}

function parseOccurrenceArtifact(value: unknown): MethodologyJudgeOccurrencesArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("methodology judge occurrence artifact must be an object");
  const artifact = value as MethodologyJudgeOccurrencesArtifact;
  const expected = ["schemaVersion", "protocol", "runId", "executionEvidenceSha256", "invocationRegistrationSha256", "inputPlanSha256", "projectionSetSha256", "judgeManifestSha256", "occurrences", "artifactSha256"];
  const keys = Object.keys(value as object);
  if (keys.length !== expected.length || expected.some((key) => !keys.includes(key))) throw new Error("methodology judge occurrence artifact has an unsupported shape");
  if (artifact.schemaVersion !== 1 || artifact.protocol !== METHODOLOGY_JUDGE_OCCURRENCES_PROTOCOL || typeof artifact.runId !== "string" || !Array.isArray(artifact.occurrences)) throw new Error("methodology judge occurrence artifact is invalid");
  for (const field of ["executionEvidenceSha256", "invocationRegistrationSha256", "inputPlanSha256", "projectionSetSha256", "judgeManifestSha256", "artifactSha256"] as const) requireHash(artifact[field], `occurrence artifact ${field}`);
  const identities = new Set<string>();
  for (const occurrence of artifact.occurrences) {
    const keys = Object.keys(occurrence);
    const expectedOccurrence = ["attemptId", "bugId", "findingIndex", "findingEvidenceSha256", "neutralTruthPayloadSha256", "neutralFindingPayloadSha256", "promptSha256", "methodologyComparisonId", "judgeComparisonId"];
    if (keys.length !== expectedOccurrence.length || expectedOccurrence.some((key) => !keys.includes(key))) throw new Error("methodology judge occurrence has an unsupported shape");
    if (typeof occurrence.attemptId !== "string" || typeof occurrence.bugId !== "string" || !Number.isSafeInteger(occurrence.findingIndex) || occurrence.findingIndex < 0) throw new Error("methodology judge occurrence identity is invalid");
    for (const field of ["findingEvidenceSha256", "neutralTruthPayloadSha256", "neutralFindingPayloadSha256", "promptSha256", "methodologyComparisonId", "judgeComparisonId"] as const) requireHash(occurrence[field], `occurrence ${field}`);
    const identity = occurrenceIdentity(occurrence);
    if (identities.has(identity)) throw new Error("duplicate methodology judge occurrence identity");
    identities.add(identity);
  }
  for (let index = 1; index < artifact.occurrences.length; index += 1) if (compareOccurrences(artifact.occurrences[index - 1]!, artifact.occurrences[index]!) > 0) throw new Error("methodology judge occurrences are not deterministically sorted");
  return artifact;
}

function occurrenceIdentity(value: MethodologyJudgeOccurrence): string {
  return canonicalJson({ attemptId: value.attemptId, bugId: value.bugId, findingIndex: value.findingIndex });
}

function compareOccurrences(left: MethodologyJudgeOccurrence, right: MethodologyJudgeOccurrence): number {
  return left.attemptId.localeCompare(right.attemptId) || left.bugId.localeCompare(right.bugId) || left.findingIndex - right.findingIndex;
}

function readRegularFile(path: string, label: string): Buffer {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error(`${label} must be a bounded regular non-symlink file`);
  return readFileSync(path);
}

function requireHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
}

function validateRunId(value: string): void {
  if (typeof value !== "string" || !value || value.length > 512 || value.includes("\0")) throw new Error("runId is invalid");
}

function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
