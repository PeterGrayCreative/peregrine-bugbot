import { createHash } from "node:crypto";
import { historicalTruthScopeSha256 } from "./historical-curation.js";
import {
  deriveHistoricalMetricEligibility,
  type HistoricalMetricEligibility,
} from "./historical-metric-eligibility.js";
import {
  parseHistoricalGroundTruth,
  type HistoricalGroundTruth,
  type HistoricalTruthBug,
} from "./historical-truth.js";
import {
  parseMethodologyReviewOutput,
  type MethodologyFinding,
  type MethodologyReviewOutput,
} from "./methodology-output.js";
import { canonicalJson, canonicalJsonSha256 } from "./experiment.js";

export const METHODOLOGY_GRADING_PROTOCOL = "historical-methodology-grading-v1" as const;
export const METHODOLOGY_GRADING_PROJECTION_BOUNDARY =
  "The caller must authenticate and retain the expected projection digest and every referenced execution, input-plan, registration, truth, review, and judge digest. This pure contract checks their internal binding; it does not prove provider contact, source history, curation independence, or global cleanliness.";

const SHA256 = /^[a-f0-9]{64}$/;
const ATTEMPT_ID = /^attempt-[0-9]{6}$/;
const CASE_NAME = /^(?:development|validation)\/case-[a-f0-9]{8,32}$/;
const PROJECTION_KEYS = ["schemaVersion", "kind", "executionEvidenceSha256", "inputPlanSha256",
  "caseRegistrationSha256", "truthSha256", "truthScopeSha256", "attemptId", "caseName", "status",
  "reviewOutputSha256"] as const;
const VERDICT_KEYS = ["comparisonId", "bugId", "findingIndex", "findingEvidenceSha256", "verdict"] as const;

// Same structured namespace as the legacy primitive, expressed over the
// historical type because it intentionally admits the extra unclassified lane.
function historicalRootCauseKey(bug: HistoricalTruthBug): string {
  return JSON.stringify(bug.rootCauseGroup === undefined ? ["bug", bug.id] : ["group", bug.rootCauseGroup]);
}

export type MethodologyAttemptStatus = "completed" | "incomplete" | "failed" | "missing";
export type MethodologyPairVerdict = "same-root-cause" | "different-root-cause" | "failed";

export interface MethodologyGradingProjection {
  schemaVersion: 1;
  kind: "methodology-grading-projection";
  executionEvidenceSha256: string;
  inputPlanSha256: string;
  caseRegistrationSha256: string;
  truthSha256: string;
  truthScopeSha256: string;
  attemptId: string;
  caseName: string;
  status: MethodologyAttemptStatus;
  reviewOutputSha256: string | null;
}

export interface MethodologyPairVerdictInput {
  comparisonId: string;
  bugId: string;
  findingIndex: number;
  findingEvidenceSha256: string;
  verdict: MethodologyPairVerdict;
}

export interface MethodologyAttemptGrade {
  schemaVersion: 1;
  protocol: typeof METHODOLOGY_GRADING_PROTOCOL;
  projection: MethodologyGradingProjection;
  projectionSha256: string;
  judgeConfigSha256: string;
  findings: Array<MethodologyFinding & { findingIndex: number; evidenceSha256: string }>;
  pairVerdicts: MethodologyPairVerdictInput[];
  observationMatches: Record<string, number | null>;
  rootCauseMatches: Record<string, boolean>;
  rootMissAttribution: Record<string, "none" | "unattributed">;
  unmatchedFindings: Array<{ findingIndex: number; findingEvidenceSha256: string; classification: "unresolved" }>;
  completion: { scheduled: 1; completed: 0 | 1; incomplete: 0 | 1; failed: 0 | 1; missing: 0 | 1 };
  metricEligibility: HistoricalMetricEligibility;
  claims: { globalCleanliness: "not-established"; providerContact: "not-established"; independentCuration: "not-established" };
  gradeSha256: string;
}

export function methodologyFindingEvidenceSha256(value: unknown): string {
  const finding = parseMethodologyReviewOutput({ status: "completed", limitations: [], findings: [value] }).findings[0]!;
  return domainSha("peregrine-methodology-neutral-finding-v1", finding);
}

export function methodologyReviewOutputSha256(value: unknown): string {
  return domainSha("peregrine-methodology-neutral-review-v1", parseMethodologyReviewOutput(value));
}

export function methodologyComparisonId(input: {
  bug: HistoricalTruthBug;
  finding: MethodologyFinding;
  judgeConfigSha256: string;
}): string {
  hash(input.judgeConfigSha256, "judgeConfigSha256");
  return domainSha("peregrine-methodology-neutral-comparison-v1", {
    judgeConfigSha256: input.judgeConfigSha256,
    truth: {
      file: input.bug.file,
      startLine: input.bug.startLine,
      endLine: input.bug.endLine,
      description: input.bug.description,
      reachablePreconditions: input.bug.reachablePreconditions,
      observableImpact: input.bug.observableImpact,
    },
    findingEvidenceSha256: methodologyFindingEvidenceSha256(input.finding),
  });
}

export function methodologyGradingProjectionSha256(value: unknown): string {
  return canonicalJsonSha256(parseProjection(value));
}

export function gradeMethodologyAttempt(input: {
  projection: unknown;
  expectedProjectionSha256: string;
  truth: unknown;
  reviewOutput: unknown | null;
  judgeConfigSha256: string;
  pairVerdicts: unknown;
}): MethodologyAttemptGrade {
  const projection = parseProjection(input.projection);
  hash(input.expectedProjectionSha256, "expectedProjectionSha256");
  hash(input.judgeConfigSha256, "judgeConfigSha256");
  const projectionSha256 = canonicalJsonSha256(projection);
  if (projectionSha256 !== input.expectedProjectionSha256) throw new Error("grading projection does not match its caller-held digest");
  const truth = parseHistoricalGroundTruth(input.truth, "methodology grading truth");
  if (projection.truthSha256 !== canonicalJsonSha256(truth)) throw new Error("grading projection truth artifact digest mismatch");
  if (projection.truthScopeSha256 !== historicalTruthScopeSha256(truth)) throw new Error("grading projection truth scope digest mismatch");

  const review = parseReviewForStatus(projection, input.reviewOutput);
  const findings = (review?.findings ?? []).map((finding, findingIndex) => ({
    ...finding, findingIndex, evidenceSha256: methodologyFindingEvidenceSha256(finding),
  }));
  const verdicts = projection.status === "completed"
    ? parseCompleteVerdicts(input.pairVerdicts, truth, findings, input.judgeConfigSha256)
    : parseNoVerdicts(input.pairVerdicts);

  const rootsByFinding = new Map<number, Set<string>>();
  for (const verdict of verdicts) {
    if (verdict.verdict !== "same-root-cause") continue;
    const bug = truth.bugs.find((candidate) => candidate.id === verdict.bugId)!;
    const roots = rootsByFinding.get(verdict.findingIndex) ?? new Set<string>();
    roots.add(historicalRootCauseKey(bug));
    rootsByFinding.set(verdict.findingIndex, roots);
  }
  for (const [findingIndex, roots] of rootsByFinding) {
    if (roots.size > 1) throw new Error(`finding ${findingIndex} has positive verdicts across root-cause groups`);
  }

  const observationMatches = Object.fromEntries(truth.bugs.map((bug) => {
    const match = verdicts.find((verdict) => verdict.bugId === bug.id && verdict.verdict === "same-root-cause");
    return [bug.id, match?.findingIndex ?? null];
  })) as Record<string, number | null>;
  const rootCauseMatches: Record<string, boolean> = {};
  for (const bug of truth.bugs) {
    const root = historicalRootCauseKey(bug);
    rootCauseMatches[root] = rootCauseMatches[root] === true || observationMatches[bug.id] !== null;
  }
  const rootMissAttribution = Object.fromEntries(Object.entries(rootCauseMatches).map(([root, matched]) =>
    [root, matched ? "none" : "unattributed"])) as Record<string, "none" | "unattributed">;
  const used = new Set(Object.values(observationMatches).filter((value): value is number => value !== null));
  const unmatchedFindings = findings.filter(({ findingIndex }) => !used.has(findingIndex)).map(({ findingIndex, evidenceSha256 }) => ({
    findingIndex, findingEvidenceSha256: evidenceSha256, classification: "unresolved" as const,
  }));
  const completion = completionFor(projection.status);
  const body = {
    schemaVersion: 1 as const,
    protocol: METHODOLOGY_GRADING_PROTOCOL,
    projection,
    projectionSha256,
    judgeConfigSha256: input.judgeConfigSha256,
    findings,
    pairVerdicts: verdicts,
    observationMatches,
    rootCauseMatches,
    rootMissAttribution,
    unmatchedFindings,
    completion,
    metricEligibility: deriveHistoricalMetricEligibility(truth, { emittedFindings: findings.length, scheduledReviews: 1 }),
    claims: { globalCleanliness: "not-established" as const, providerContact: "not-established" as const,
      independentCuration: "not-established" as const },
  };
  return { ...body, gradeSha256: domainSha("peregrine-methodology-neutral-grade-v1", body) };
}

function parseReviewForStatus(projection: MethodologyGradingProjection, value: unknown | null): MethodologyReviewOutput | null {
  if (projection.status === "failed" || projection.status === "missing") {
    if (value !== null || projection.reviewOutputSha256 !== null) throw new Error(`${projection.status} attempt cannot supply review output`);
    return null;
  }
  if (value === null || projection.reviewOutputSha256 === null) throw new Error(`${projection.status} attempt requires review output`);
  const review = parseMethodologyReviewOutput(value);
  const expected = projection.status === "completed" ? "completed" : "unable-to-complete";
  if (review.status !== expected) throw new Error(`${projection.status} attempt has inconsistent model completion status`);
  if (projection.reviewOutputSha256 !== methodologyReviewOutputSha256(review)) throw new Error("grading projection review output digest mismatch");
  return review;
}

function parseCompleteVerdicts(value: unknown, truth: HistoricalGroundTruth,
  findings: readonly (MethodologyFinding & { findingIndex: number; evidenceSha256: string })[], judgeSha: string) {
  const expected = truth.bugs.flatMap((bug) => findings.map((finding) => ({ bug, finding })));
  if (!Array.isArray(value)) throw new Error("methodology grading pairVerdicts must be an array");
  const values = value as unknown[];
  if (values.length !== expected.length) throw new Error("methodology grading requires one external verdict for every truth/finding pair");
  return values.map((value, index): MethodologyPairVerdictInput => {
    const item = strict(value, VERDICT_KEYS, `pairVerdicts[${index}]`);
    const { bug, finding } = expected[index]!;
    if (item.bugId !== bug.id || item.findingIndex !== finding.findingIndex || item.findingEvidenceSha256 !== finding.evidenceSha256 ||
      item.comparisonId !== methodologyComparisonId({ bug, finding: neutralFinding(finding), judgeConfigSha256: judgeSha })) {
      throw new Error(`pairVerdicts[${index}] does not match the canonical truth/finding pair`);
    }
    if (item.verdict !== "same-root-cause" && item.verdict !== "different-root-cause" && item.verdict !== "failed") {
      throw new Error(`pairVerdicts[${index}].verdict is invalid`);
    }
    return item as unknown as MethodologyPairVerdictInput;
  });
}

function parseNoVerdicts(value: unknown): MethodologyPairVerdictInput[] {
  if (!Array.isArray(value)) throw new Error("methodology grading pairVerdicts must be an array");
  const values = value as unknown[];
  if (values.length !== 0) throw new Error("non-completed attempts cannot receive pair verdicts or root credit");
  return [];
}

function parseProjection(value: unknown): MethodologyGradingProjection {
  const item = strict(value, PROJECTION_KEYS, "grading projection");
  if (item.schemaVersion !== 1 || item.kind !== "methodology-grading-projection") throw new Error("grading projection kind/version is invalid");
  for (const key of ["executionEvidenceSha256", "inputPlanSha256", "caseRegistrationSha256", "truthSha256", "truthScopeSha256"] as const) hash(item[key], `grading projection.${key}`);
  if (typeof item.attemptId !== "string" || !ATTEMPT_ID.test(item.attemptId)) throw new Error("grading projection.attemptId is invalid");
  if (typeof item.caseName !== "string" || !CASE_NAME.test(item.caseName)) throw new Error("grading projection.caseName is invalid");
  if (item.status !== "completed" && item.status !== "incomplete" && item.status !== "failed" && item.status !== "missing") throw new Error("grading projection.status is invalid");
  if (item.reviewOutputSha256 !== null) hash(item.reviewOutputSha256, "grading projection.reviewOutputSha256");
  return item as unknown as MethodologyGradingProjection;
}

function strict(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => !keys.includes(key))) throw new Error(`${label} has an unsupported field`);
  const missing = keys.find((key) => !Object.hasOwn(item, key));
  if (missing) throw new Error(`${label} is missing ${missing}`);
  return item;
}

function hash(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be a SHA-256 digest`);
}

function completionFor(status: MethodologyAttemptStatus): MethodologyAttemptGrade["completion"] {
  return { scheduled: 1, completed: status === "completed" ? 1 : 0, incomplete: status === "incomplete" ? 1 : 0,
    failed: status === "failed" ? 1 : 0, missing: status === "missing" ? 1 : 0 };
}

function neutralFinding(finding: MethodologyFinding): MethodologyFinding {
  return { file: finding.file, startLine: finding.startLine, endLine: finding.endLine,
    explanation: finding.explanation, impact: finding.impact, severity: finding.severity };
}

function domainSha(domain: string, value: unknown): string {
  return createHash("sha256").update(`${domain}\0`).update(canonicalJson(value)).digest("hex");
}
