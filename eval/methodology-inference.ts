import {
  canonicalJson,
  canonicalJsonSha256,
  seededRandom,
} from "./experiment.js";
import {
  buildMethodologyContrasts,
} from "./methodology-contrasts.js";
import type { MethodologyAdjudicationLedger } from "./methodology-adjudication.js";
import {
  deriveMethodologyEffectiveAdjudication,
  type MethodologyEffectiveAdjudication,
} from "./methodology-adjudication-resolution.js";
import type { MethodologyGradeSetArtifact } from "./methodology-analysis-artifacts.js";
import {
  parseMethodologySchedule,
  type MethodologySchedule,
  type MethodologyScheduledAttempt,
} from "./methodology-schedule.js";
import type { MethodologyResourceSetArtifact } from "./methodology-resource-artifact.js";
import type { MethodologyAttemptGrade } from "./methodology-grading-contract.js";
import {
  parseMethodologyUnmatchedRootLedger,
  rebuildMethodologyUnmatchedRootLedger,
  type MethodologyUnmatchedRootLedger,
} from "./methodology-unmatched-root-ledger.js";

/** The R3 preregistered estimator and its serialized decision contract. */
export const METHODOLOGY_INFERENCE_PLAN_PROTOCOL =
  "historical-methodology-inference-plan-v1" as const;
export const METHODOLOGY_INFERENCE_PROTOCOL =
  "historical-methodology-inference-v1" as const;
export const METHODOLOGY_INFERENCE_INTERVAL_POLICY =
  "maximal-family-cluster-percentile-bootstrap-v1" as const;
export const METHODOLOGY_INFERENCE_PRIMARY_CONTRAST = "D-vs-C" as const;

const SHA256 = /^[a-f0-9]{64}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CASE_NAME = /^(?:development|validation)\/case-[a-f0-9]{8,32}$/;
const MAX_BOOTSTRAP_SAMPLES = 100_000;
const UNAUTHENTICATED_DUPLICATE_FAMILY_BLOCKER =
  "duplicate-family assignments are not bound to an authenticated curation/input artifact";

export type MethodologyInferenceAnalysisStage = "development-screen" | "selection" | "confirmation";
export type MethodologyInferenceHypothesis = "detection" | "noise-reduction" | "efficiency";

export interface MethodologyInferenceCaseCluster {
  caseName: string;
  repositoryFamilySha256: string;
  duplicateFamilySha256: string;
}

export interface MethodologyInferenceComponent {
  componentId: string;
  caseNames: string[];
  repositoryFamilySha256: string[];
  duplicateFamilySha256: string[];
  componentSha256: string;
}

export interface MethodologyInferencePlan {
  schemaVersion: 1;
  protocol: typeof METHODOLOGY_INFERENCE_PLAN_PROTOCOL;
  runId: string;
  scheduleSha256: string;
  primaryContrast: typeof METHODOLOGY_INFERENCE_PRIMARY_CONTRAST;
  analysisStage: MethodologyInferenceAnalysisStage;
  hypothesis: MethodologyInferenceHypothesis;
  intervalPolicy: typeof METHODOLOGY_INFERENCE_INTERVAL_POLICY;
  confidenceLevel: 0.95;
  bootstrapSamples: number;
  bootstrapSeed: number;
  minIndependentClusters: number;
  caseClusters: MethodologyInferenceCaseCluster[];
  components: MethodologyInferenceComponent[];
  componentsSha256: string;
  /** Absent on legacy plans; present when written against a registered run. */
  invocationRegistrationSha256?: string;
  inputPlanSha256?: string;
  planSha256: string;
}

export interface BuildMethodologyInferencePlanInput {
  runId: string;
  /** Required by the sealed writer; omitted for pure legacy plan construction. */
  executionRoot?: string;
  /** Supplying the schedule lets the builder enforce exact case coverage. */
  schedule?: unknown;
  scheduleSha256?: string;
  primaryContrast?: typeof METHODOLOGY_INFERENCE_PRIMARY_CONTRAST;
  analysisStage: MethodologyInferenceAnalysisStage;
  hypothesis: MethodologyInferenceHypothesis;
  intervalPolicy?: typeof METHODOLOGY_INFERENCE_INTERVAL_POLICY;
  confidenceLevel?: 0.95;
  bootstrapSamples: number;
  bootstrapSeed: number;
  minIndependentClusters: number;
  caseClusters: readonly MethodologyInferenceCaseCluster[];
  invocationRegistrationSha256?: string;
  inputPlanSha256?: string;
}

export function methodologyInferencePlanSha256(
  value: Omit<MethodologyInferencePlan, "planSha256">,
): string {
  return canonicalJsonSha256(value);
}
export const hashMethodologyInferencePlan = methodologyInferencePlanSha256;

/** Build the strict, content-addressed plan. No files or measurements are read. */
export function buildMethodologyInferencePlan(
  input: BuildMethodologyInferencePlanInput,
): MethodologyInferencePlan {
  const runId = runIdValue(input.runId, "runId");
  const scheduleSha256 = resolveScheduleSha(input.schedule, input.scheduleSha256);
  const clusters = parseCaseClusters(input.caseClusters, "caseClusters");
  if (input.schedule !== undefined) {
    const schedule = parseMethodologySchedule(input.schedule, "inference plan schedule");
    requireExactCaseCoverage(schedule, clusters);
  }
  const body = planBody({
    runId,
    scheduleSha256,
    primaryContrast: input.primaryContrast,
    analysisStage: input.analysisStage,
    hypothesis: input.hypothesis,
    intervalPolicy: input.intervalPolicy,
    confidenceLevel: input.confidenceLevel,
    bootstrapSamples: input.bootstrapSamples,
    bootstrapSeed: input.bootstrapSeed,
    minIndependentClusters: input.minIndependentClusters,
    caseClusters: clusters,
    ...(input.invocationRegistrationSha256 === undefined ? {} : {
      invocationRegistrationSha256: digest(input.invocationRegistrationSha256, "invocationRegistrationSha256"),
    }),
    ...(input.inputPlanSha256 === undefined ? {} : {
      inputPlanSha256: digest(input.inputPlanSha256, "inputPlanSha256"),
    }),
  });
  return { ...body, planSha256: methodologyInferencePlanSha256(body) };
}

/** Parse and rederive a plan; unknown fields and stale component digests reject. */
export function parseMethodologyInferencePlan(
  value: unknown,
  source = "methodology inference plan",
): MethodologyInferencePlan {
  const root = exactObject(value, [
    "schemaVersion", "protocol", "runId", "scheduleSha256", "primaryContrast", "analysisStage",
    "hypothesis", "intervalPolicy", "confidenceLevel", "bootstrapSamples", "bootstrapSeed",
    "minIndependentClusters", "caseClusters", "components", "componentsSha256", "planSha256",
  ], source, ["invocationRegistrationSha256", "inputPlanSha256"]);
  if (root.schemaVersion !== 1 || root.protocol !== METHODOLOGY_INFERENCE_PLAN_PROTOCOL) {
    throw new Error(`${source} protocol/version is invalid`);
  }
  const invocationRegistrationSha256 = root.invocationRegistrationSha256 === undefined
    ? undefined : digest(root.invocationRegistrationSha256, `${source}.invocationRegistrationSha256`);
  const inputPlanSha256 = root.inputPlanSha256 === undefined
    ? undefined : digest(root.inputPlanSha256, `${source}.inputPlanSha256`);
  const plan = buildMethodologyInferencePlan({
    runId: runIdValue(root.runId, `${source}.runId`),
    scheduleSha256: digest(root.scheduleSha256, `${source}.scheduleSha256`),
    primaryContrast: root.primaryContrast as typeof METHODOLOGY_INFERENCE_PRIMARY_CONTRAST,
    analysisStage: root.analysisStage as MethodologyInferenceAnalysisStage,
    hypothesis: root.hypothesis as MethodologyInferenceHypothesis,
    intervalPolicy: root.intervalPolicy as typeof METHODOLOGY_INFERENCE_INTERVAL_POLICY,
    confidenceLevel: root.confidenceLevel as 0.95,
    bootstrapSamples: boundedInteger(root.bootstrapSamples, `${source}.bootstrapSamples`, 1, MAX_BOOTSTRAP_SAMPLES),
    bootstrapSeed: boundedInteger(root.bootstrapSeed, `${source}.bootstrapSeed`, 0, 0xffff_ffff),
    minIndependentClusters: boundedInteger(root.minIndependentClusters, `${source}.minIndependentClusters`, 2, 1_000_000),
    caseClusters: parseCaseClusters(root.caseClusters, `${source}.caseClusters`),
    ...(invocationRegistrationSha256 === undefined ? {} : { invocationRegistrationSha256 }),
    ...(inputPlanSha256 === undefined ? {} : { inputPlanSha256 }),
  });
  if (canonicalJson(root.caseClusters) !== canonicalJson(plan.caseClusters) ||
      canonicalJson(root.components) !== canonicalJson(plan.components) ||
      root.componentsSha256 !== plan.componentsSha256 || root.planSha256 !== plan.planSha256) {
    throw new Error(`${source} digest or derived components do not match`);
  }
  if (plan.invocationRegistrationSha256 !== invocationRegistrationSha256 ||
      plan.inputPlanSha256 !== inputPlanSha256) {
    throw new Error(`${source} preregistration bindings do not match`);
  }
  return plan;
}

export interface MethodologyInferenceUpstreamInputs {
  schedule: unknown;
  gradeSet: MethodologyGradeSetArtifact;
  adjudication: MethodologyAdjudicationLedger;
  effectiveAdjudication: MethodologyEffectiveAdjudication;
  unmatchedRootLedger: MethodologyUnmatchedRootLedger;
  resourceSet: MethodologyResourceSetArtifact;
}

export interface BuildMethodologyInferenceArtifactInput extends MethodologyInferenceUpstreamInputs {
  plan: unknown;
}

export interface MethodologyInferenceMetric {
  pointEstimate: number | null;
  interval95: { lower: number; upper: number } | null;
  eligibleCaseCount: number;
  eligibleIndependentComponentCount: number;
  reason: "none" | "unresolved-adjudications" | "insufficient-independent-components" |
    "no-eligible-cases" | "no-usable-paired-time" | "unauthenticated-duplicate-families";
}

/**
 * Decision surfaces required by the R3 analysis plan.  These are deliberately
 * separate from the four inferential contrasts: some are audit/count surfaces,
 * and some require evidence which this artifact does not have.  An unavailable
 * surface is represented explicitly instead of being silently omitted.
 */
export interface MethodologyInferenceDecisionSurfaces {
  repeatReliability: {
    status: "defined";
    roots: Array<{
      caseName: string;
      rootCause: string;
      byArm: Array<{ armId: "A" | "B" | "C" | "D"; detectedAttempts: number; scheduledAttempts: number; rate: number }>;
    }>;
  };
  severeBaselineFoundTreatmentMissedRoots: {
    status: "defined" | "unknown";
    roots: Array<{ caseName: string; rootCause: string }> | null;
    reason: "none" | "registered-truth-severity-unavailable";
  };
  comparisonUnsupportedRootRateCases: {
    status: "defined";
    controlRate: number | null;
    treatmentRate: number | null;
    difference: number | null;
    /** Proportion of comparison cases with at least one unsupported root. */
    controlCaseProportion: number | null;
    treatmentCaseProportion: number | null;
    caseProportionDifference: number | null;
    cases: Array<{ caseName: string; controlRootCount: number; treatmentRootCount: number }>;
  };
  confirmedDiscovery: {
    status: "defined";
    byArm: Record<"A" | "B" | "C" | "D", {
      occurrences: number;
      roots: number;
      occurrencesPerScheduledReview: number | null;
      uniqueRootsPerScheduledReview: number | null;
    }>;
  };
  completionOutcomeCategories: {
    status: "defined";
    byArm: Record<"A" | "B" | "C" | "D", Record<MethodologyResourceSetArtifact["resources"][number]["outcome"], number> & {
      /** These categories are not distinguishable in the authenticated resource artifact. */
      unavailable: { malformed: "unavailable"; "tool-unavailable": "unavailable"; "incomplete-scope": "unavailable" };
    }>;
  };
  reviewResources: {
    status: "defined";
    limits: { totalDeadlineMs: number; discoveryDeadlineMs: number; reviewerDeadlineMs: number };
    byArm: Record<"A" | "B" | "C" | "D", {
      scheduledAttempts: number;
      wallDurationMs: { observed: number | null; observedAttempts: number; unknownAttempts: number };
      reviewDurationMs: { observed: number | null; observedAttempts: number; unknownAttempts: number };
      usage: Record<string, { observed: number | null; observedAttempts: number; unknownAttempts: number }>;
    }>;
    unknowns: string[];
  };
}

export interface MethodologyInferenceArtifact {
  schemaVersion: 1;
  protocol: typeof METHODOLOGY_INFERENCE_PROTOCOL;
  runId: string;
  planSha256: string;
  scheduleSha256: string;
  primaryContrast: typeof METHODOLOGY_INFERENCE_PRIMARY_CONTRAST;
  analysisStage: MethodologyInferenceAnalysisStage;
  hypothesis: MethodologyInferenceHypothesis;
  intervalPolicy: typeof METHODOLOGY_INFERENCE_INTERVAL_POLICY;
  confidenceLevel: 0.95;
  bootstrapSamples: number;
  bootstrapSeed: number;
  minIndependentClusters: number;
  upstream: {
    contrastSha256: string;
    gradeSetArtifactSha256: string;
    adjudicationLedgerSha256: string;
    effectiveAdjudicationSha256: string;
    adjudicationResolutionHeadSha256: string | null;
    unmatchedRootLedgerSha256: string;
    resourceSetArtifactSha256: string;
  };
  components: MethodologyInferenceComponent[];
  componentsSha256: string;
  counts: {
    independentRepositoryCount: number;
    duplicateFamilyCount: number;
    componentCount: number;
    caseCount: number;
    rootCount: number;
    attemptCount: number;
  };
  status: "defined" | "blocked";
  blockers: string[];
  metrics: {
    registeredKnownRootRecallDifference: MethodologyInferenceMetric;
    unsupportedRootsPerScheduledReviewDifference: MethodologyInferenceMetric;
    completionRateDifference: MethodologyInferenceMetric;
    pairedWallTimeRatio: MethodologyInferenceMetric;
  };
  decisionSurfaces: MethodologyInferenceDecisionSurfaces;
  claims: {
    unsupportedNoise: "curator-grouped-root-identities";
    providerIdentity: "not-established-by-inference";
    efficacy: "not-decided-by-inference";
  };
  inferenceSha256: string;
}

export function methodologyInferenceArtifactSha256(
  value: Omit<MethodologyInferenceArtifact, "inferenceSha256">,
): string {
  return canonicalJsonSha256(value);
}
export const hashMethodologyInferenceArtifact = methodologyInferenceArtifactSha256;

/**
 * Derive the inferential artifact. The descriptive contrast is rebuilt here so
 * callers cannot inject metrics; only authenticated upstream artifacts are accepted.
 */
export function buildMethodologyInferenceArtifact(input: BuildMethodologyInferenceArtifactInput): MethodologyInferenceArtifact;
export function buildMethodologyInferenceArtifact(planValue: unknown, input: MethodologyInferenceUpstreamInputs): MethodologyInferenceArtifact;
export function buildMethodologyInferenceArtifact(
  planOrInput: unknown | BuildMethodologyInferenceArtifactInput,
  legacyInput?: MethodologyInferenceUpstreamInputs,
): MethodologyInferenceArtifact {
  const planValue = legacyInput === undefined ? (planOrInput as BuildMethodologyInferenceArtifactInput).plan : planOrInput;
  const input = legacyInput ?? (planOrInput as BuildMethodologyInferenceArtifactInput);
  const plan = parseMethodologyInferencePlan(planValue);
  const schedule = parseMethodologySchedule(input.schedule, "methodology inference schedule");
  const scheduleSha256 = canonicalJsonSha256(schedule);
  if (scheduleSha256 !== plan.scheduleSha256) throw new Error("inference schedule does not match plan scheduleSha256");
  requireExactCaseCoverage(schedule, plan.caseClusters);
  const contrast = buildMethodologyContrasts(input);
  if (contrast.runId !== plan.runId || contrast.scheduleSha256 !== scheduleSha256) {
    throw new Error("inference upstream run or schedule binding is invalid");
  }
  const grades = input.gradeSet.grades;
  const gradeByAttempt = new Map(grades.map((grade) => [grade.projection.attemptId, grade]));
  const resourceByAttempt = new Map(input.resourceSet.resources.map((resource) => [resource.attemptId, resource]));
  const effectiveAdjudication = deriveMethodologyEffectiveAdjudication(
    input.adjudication,
    input.effectiveAdjudication.resolutions,
    input.gradeSet,
  );
  if (canonicalJson(effectiveAdjudication) !== canonicalJson(input.effectiveAdjudication)) {
    throw new Error("inference effective adjudication does not rederive from the bound base ledger");
  }
  for (const resolution of effectiveAdjudication.resolutions) {
    const grade = gradeByAttempt.get(resolution.occurrence.attemptId);
    if (!grade || grade.metricEligibility.truthVersion !== resolution.truthVersion) {
      throw new Error("inference adjudication resolution truth version does not match its grade");
    }
  }
  const unmatchedRootLedger = parseMethodologyUnmatchedRootLedger(
    input.unmatchedRootLedger,
    "methodology inference unmatched-root ledger",
  );
  const rebuiltUnmatchedRootLedger = rebuildMethodologyUnmatchedRootLedger({
    runId: plan.runId,
    schedule,
    gradeSet: input.gradeSet,
    effectiveAdjudication,
    assignments: unmatchedRootLedger.roots.flatMap((root) => root.occurrences.map((occurrence) => ({
      attemptId: occurrence.attemptId,
      findingIndex: occurrence.findingIndex,
      findingEvidenceSha256: occurrence.findingEvidenceSha256,
      rootIdentitySha256: root.rootIdentitySha256,
    }))),
    roots: unmatchedRootLedger.roots.map((root) => ({
      rootIdentitySha256: root.rootIdentitySha256,
      reviewerIdentitySha256s: root.reviewerIdentitySha256s,
      reviewerIndependence: root.reviewerIndependence,
      source: root.source,
      evidence: root.evidence,
      rationale: root.rationale,
    })),
    recordedAt: unmatchedRootLedger.recordedAt,
    baseLedgerSha256: input.adjudication.ledgerSha256,
    effectiveAdjudicationSha256: effectiveAdjudication.effectiveSha256,
    headResolutionSha256: effectiveAdjudication.headResolutionSha256,
    gradeSetSha256: input.gradeSet.gradeSetSha256,
    scheduleSha256,
  });
  if (canonicalJson(rebuiltUnmatchedRootLedger) !== canonicalJson(unmatchedRootLedger)) {
    throw new Error("inference unmatched-root ledger does not rederive from bound evidence");
  }
  validateRootRosters(schedule, gradeByAttempt);
  const components = plan.components;
  const caseValues = deriveMethodologyInferenceCaseValues(schedule, gradeByAttempt, resourceByAttempt, unmatchedRootLedger);
  const decisionSurfaces = deriveDecisionSurfaces(
    schedule,
    gradeByAttempt,
    resourceByAttempt,
    effectiveAdjudication,
    unmatchedRootLedger,
  );
  const unresolved = effectiveAdjudication.unresolvedCount;
  const insufficient = components.length < plan.minIndependentClusters;
  const blockers: string[] = [];
  // Plans currently carry only caller-supplied duplicate-family labels. They may
  // describe point estimates, but cannot authorize dependence-aware intervals.
  blockers.push(UNAUTHENTICATED_DUPLICATE_FAMILY_BLOCKER);
  if (unresolved > 0) blockers.push(`${unresolved} unresolved adjudication(s)`);
  if (insufficient) blockers.push(`only ${components.length} independent component(s); ${plan.minIndependentClusters} required`);
  if (decisionSurfaces.severeBaselineFoundTreatmentMissedRoots.status === "unknown") {
    blockers.push("severe baseline-found/treatment-missed root surface is unavailable");
  }
  const blockedReason = unresolved > 0 ? "unresolved-adjudications" : insufficient ? "insufficient-independent-components" : null;
  const metric = (values: ReadonlyMap<string, number>, kind: "mean" | "median", noValues: MethodologyInferenceMetric["reason"] = "no-eligible-cases"): MethodologyInferenceMetric => {
    const available = [...values.entries()].filter(([, value]) => finite(value));
    const eligibleComponents = components.filter((component) =>
      component.caseNames.some((caseName) => values.has(caseName)));
    const pointEstimate = available.length === 0 ? null : methodologyComponentBalancedEstimate(available, eligibleComponents, kind);
    const counts = {
      eligibleCaseCount: available.length,
      eligibleIndependentComponentCount: eligibleComponents.length,
    };
    if (blockedReason) return { pointEstimate, interval95: null, ...counts, reason: blockedReason };
    if (available.length === 0) return { pointEstimate: null, interval95: null, ...counts, reason: noValues };
    if (eligibleComponents.length < plan.minIndependentClusters) {
      return { pointEstimate, interval95: null, ...counts, reason: "insufficient-independent-components" };
    }
    return {
      pointEstimate,
      interval95: null,
      ...counts,
      reason: "unauthenticated-duplicate-families",
    };
  };
  const time = deriveTimeMetric(caseValues, components, plan, blockedReason);
  const metrics = {
    registeredKnownRootRecallDifference: metric(caseValues.recall, "mean"),
    unsupportedRootsPerScheduledReviewDifference: metric(caseValues.unsupported, "mean"),
    completionRateDifference: metric(caseValues.completion, "mean"),
    pairedWallTimeRatio: time,
  };
  for (const [name, value] of Object.entries(metrics)) {
    if (value.reason === "insufficient-independent-components" && !blockedReason) {
      blockers.push(`${name} has only ${value.eligibleIndependentComponentCount} eligible independent component(s); ${plan.minIndependentClusters} required`);
    } else if ((value.reason === "no-eligible-cases" || value.reason === "no-usable-paired-time") && !blockedReason) {
      blockers.push(`${name} is unavailable: ${value.reason}`);
    }
  }
  const counts = countInputs(schedule, plan);
  const body = {
    schemaVersion: 1 as const,
    protocol: METHODOLOGY_INFERENCE_PROTOCOL,
    runId: plan.runId,
    planSha256: plan.planSha256,
    scheduleSha256,
    primaryContrast: METHODOLOGY_INFERENCE_PRIMARY_CONTRAST,
    analysisStage: plan.analysisStage,
    hypothesis: plan.hypothesis,
    intervalPolicy: METHODOLOGY_INFERENCE_INTERVAL_POLICY,
    confidenceLevel: 0.95 as const,
    bootstrapSamples: plan.bootstrapSamples,
    bootstrapSeed: plan.bootstrapSeed,
    minIndependentClusters: plan.minIndependentClusters,
    upstream: {
      contrastSha256: contrast.contrastSha256,
      gradeSetArtifactSha256: input.gradeSet.artifactSha256,
      adjudicationLedgerSha256: input.adjudication.ledgerSha256,
      effectiveAdjudicationSha256: effectiveAdjudication.effectiveSha256,
      adjudicationResolutionHeadSha256: effectiveAdjudication.headResolutionSha256,
      unmatchedRootLedgerSha256: unmatchedRootLedger.artifactSha256,
      resourceSetArtifactSha256: input.resourceSet.artifactSha256,
    },
    components,
    componentsSha256: plan.componentsSha256,
    counts,
    status: blockers.length === 0 ? "defined" as const : "blocked" as const,
    blockers,
    metrics,
    decisionSurfaces,
    claims: {
      unsupportedNoise: "curator-grouped-root-identities" as const,
      providerIdentity: "not-established-by-inference" as const,
      efficacy: "not-decided-by-inference" as const,
    },
  };
  return { ...body, inferenceSha256: methodologyInferenceArtifactSha256(body) };
}

/** Structural parser for append-only persistence readers. Upstream rederivation is the builder's job. */
export function parseMethodologyInferenceArtifact(
  value: unknown,
  source = "methodology inference artifact",
): MethodologyInferenceArtifact {
  const root = exactObject(value, [
    "schemaVersion", "protocol", "runId", "planSha256", "scheduleSha256", "primaryContrast", "analysisStage",
    "hypothesis", "intervalPolicy", "confidenceLevel", "bootstrapSamples", "bootstrapSeed", "minIndependentClusters",
    "upstream", "components", "componentsSha256", "counts", "status", "blockers", "metrics", "decisionSurfaces", "claims", "inferenceSha256",
  ], source);
  if (root.schemaVersion !== 1 || root.protocol !== METHODOLOGY_INFERENCE_PROTOCOL) throw new Error(`${source} protocol/version is invalid`);
  const body = { ...root } as Record<string, unknown>;
  delete body.inferenceSha256;
  if (typeof root.inferenceSha256 !== "string" || !SHA256.test(root.inferenceSha256) || root.inferenceSha256 !== canonicalJsonSha256(body)) {
    throw new Error(`${source}.inferenceSha256 does not authenticate its contents`);
  }
  runIdValue(root.runId, `${source}.runId`);
  digest(root.planSha256, `${source}.planSha256`);
  digest(root.scheduleSha256, `${source}.scheduleSha256`);
  if (root.primaryContrast !== METHODOLOGY_INFERENCE_PRIMARY_CONTRAST || root.intervalPolicy !== METHODOLOGY_INFERENCE_INTERVAL_POLICY || root.confidenceLevel !== 0.95) throw new Error(`${source} frozen policy is invalid`);
  if (!["development-screen", "selection", "confirmation"].includes(String(root.analysisStage)) || !["detection", "noise-reduction", "efficiency"].includes(String(root.hypothesis))) throw new Error(`${source} stage or hypothesis is invalid`);
  boundedInteger(root.bootstrapSamples, `${source}.bootstrapSamples`, 1, MAX_BOOTSTRAP_SAMPLES);
  boundedInteger(root.bootstrapSeed, `${source}.bootstrapSeed`, 0, 0xffff_ffff);
  boundedInteger(root.minIndependentClusters, `${source}.minIndependentClusters`, 2, 1_000_000);
  const components = parseComponents(root.components, `${source}.components`);
  if (!Array.isArray(root.blockers) || (root.status !== "defined" && root.status !== "blocked")) throw new Error(`${source} has an invalid status/component shape`);
  if (root.status === "defined" && root.blockers.length !== 0) throw new Error(`${source}.defined artifact cannot have blockers`);
  if (root.status === "blocked" && root.blockers.length === 0) throw new Error(`${source}.blocked artifact needs blockers`);
  if (root.componentsSha256 !== canonicalJsonSha256(components)) throw new Error(`${source}.componentsSha256 is invalid`);
  if (canonicalJson(root.components) !== canonicalJson(components)) throw new Error(`${source}.components are not in canonical order`);
  digest(root.componentsSha256, `${source}.componentsSha256`);
  const upstream = exactObject(root.upstream, ["contrastSha256", "gradeSetArtifactSha256", "adjudicationLedgerSha256", "effectiveAdjudicationSha256", "adjudicationResolutionHeadSha256", "unmatchedRootLedgerSha256", "resourceSetArtifactSha256"], `${source}.upstream`);
  for (const key of ["contrastSha256", "gradeSetArtifactSha256", "adjudicationLedgerSha256", "effectiveAdjudicationSha256", "unmatchedRootLedgerSha256", "resourceSetArtifactSha256"]) {
    digest(upstream[key], `${source}.upstream.${key}`);
  }
  if (upstream.adjudicationResolutionHeadSha256 !== null) {
    digest(upstream.adjudicationResolutionHeadSha256, `${source}.upstream.adjudicationResolutionHeadSha256`);
  }
  const counts = exactObject(root.counts, ["independentRepositoryCount", "duplicateFamilyCount", "componentCount", "caseCount", "rootCount", "attemptCount"], `${source}.counts`);
  for (const [key, value] of Object.entries(counts)) boundedInteger(value, `${source}.counts.${key}`, 0, 1_000_000_000);
  if (counts.componentCount !== components.length) throw new Error(`${source}.counts.componentCount is invalid`);
  root.blockers.forEach((item, index) => text(item, `${source}.blockers[${index}]`));
  validateMetricShape(root.metrics, `${source}.metrics`);
  validateDecisionSurfaces(root.decisionSurfaces, `${source}.decisionSurfaces`);
  const metrics = root.metrics as Record<string, MethodologyInferenceMetric>;
  if (Object.values(metrics).some((metric) => metric.interval95 !== null)) {
    throw new Error(`${source} intervals require an authenticated duplicate-family curation/input artifact`);
  }
  if (!root.blockers.some((item) => item.includes(UNAUTHENTICATED_DUPLICATE_FAMILY_BLOCKER))) {
    throw new Error(`${source} is missing the unauthenticated duplicate-family blocker`);
  }
  if (root.status === "defined") {
    if (Object.values(metrics).some((metric) => metric.reason !== "none" || metric.pointEstimate === null || metric.interval95 === null)) {
      throw new Error(`${source}.defined artifact requires every metric to have a finite estimate and interval`);
    }
    const surfaces = root.decisionSurfaces as MethodologyInferenceDecisionSurfaces;
    if (Object.values(surfaces).some((surface) => surface.status !== "defined")) {
      throw new Error(`${source}.defined artifact requires every decision surface to be defined`);
    }
  }
  const claims = exactObject(root.claims, ["unsupportedNoise", "providerIdentity", "efficacy"], `${source}.claims`);
  if (claims.unsupportedNoise !== "curator-grouped-root-identities" ||
      claims.providerIdentity !== "not-established-by-inference" ||
      claims.efficacy !== "not-decided-by-inference") {
    throw new Error(`${source}.claims are invalid`);
  }
  return value as MethodologyInferenceArtifact;
}

function parseComponents(value: unknown, source: string): MethodologyInferenceComponent[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${source} must be a non-empty array`);
  const parsed = value.map((raw, index) => {
    const item = exactObject(raw, ["componentId", "caseNames", "repositoryFamilySha256", "duplicateFamilySha256", "componentSha256"], `${source}[${index}]`);
    if (!Array.isArray(item.caseNames) || item.caseNames.length === 0 || item.caseNames.some((name) => typeof name !== "string" || !CASE_NAME.test(name))) throw new Error(`${source}[${index}].caseNames is invalid`);
    const caseNames = [...item.caseNames].sort();
    if (new Set(caseNames).size !== caseNames.length) throw new Error(`${source}[${index}].caseNames contains duplicates`);
    const repositoryFamilySha256 = parseDigestArray(item.repositoryFamilySha256, `${source}[${index}].repositoryFamilySha256`);
    const duplicateFamilySha256 = parseDigestArray(item.duplicateFamilySha256, `${source}[${index}].duplicateFamilySha256`);
    const componentSha256 = canonicalJsonSha256({ caseNames, repositoryFamilySha256, duplicateFamilySha256 });
    if (item.componentSha256 !== componentSha256 || item.componentId !== `component-${componentSha256.slice(0, 24)}`) throw new Error(`${source}[${index}] derived identity is invalid`);
    return { componentId: item.componentId, caseNames, repositoryFamilySha256, duplicateFamilySha256, componentSha256 };
  }).sort((left, right) => left.componentId.localeCompare(right.componentId));
  if (new Set(parsed.flatMap((item) => item.caseNames)).size !== parsed.flatMap((item) => item.caseNames).length) throw new Error(`${source} has overlapping cases`);
  return parsed;
}

function parseDigestArray(value: unknown, source: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${source} must be a non-empty array`);
  const parsed = value.map((item, index) => digest(item, `${source}[${index}]`)).sort();
  if (new Set(parsed).size !== parsed.length) throw new Error(`${source} contains duplicates`);
  return parsed;
}

export type MethodologyInferenceCaseValues = {
  recall: Map<string, number>;
  unsupported: Map<string, number>;
  completion: Map<string, number>;
  wall: Map<string, number>;
};

export function deriveMethodologyInferenceCaseValues(
  schedule: MethodologySchedule,
  grades: ReadonlyMap<string, MethodologyAttemptGrade>,
  resources: ReadonlyMap<string, MethodologyResourceSetArtifact["resources"][number]>,
  unmatchedRootLedger: MethodologyUnmatchedRootLedger,
): MethodologyInferenceCaseValues {
  const output: MethodologyInferenceCaseValues = { recall: new Map(), unsupported: new Map(), completion: new Map(), wall: new Map() };
  const unsupportedRootsByAttempt = new Map<string, Set<string>>();
  for (const root of unmatchedRootLedger.roots) {
    if (root.classification !== "unsupported") continue;
    for (const occurrence of root.occurrences) {
      const roots = unsupportedRootsByAttempt.get(occurrence.attemptId) ?? new Set<string>();
      roots.add(root.rootIdentitySha256);
      unsupportedRootsByAttempt.set(occurrence.attemptId, roots);
    }
  }
  for (const caseItem of schedule.cases) {
    const attempts = schedule.attempts.filter((attempt) => attempt.caseName === caseItem.caseName);
    const byArm = (armId: "C" | "D") => attempts.filter((attempt) => attempt.armId === armId);
    const armSummary = (armId: "C" | "D") => {
      const armAttempts = byArm(armId);
      const rootCount = caseItem.expectedBugCount ?? 0;
      const matched = armAttempts.reduce((total, attempt) => total + Object.values(grades.get(attempt.id)?.rootCauseMatches ?? {}).filter(Boolean).length, 0);
      const unsupported = armAttempts.reduce((total, attempt) =>
        total + (unsupportedRootsByAttempt.get(attempt.id)?.size ?? 0), 0);
      const completed = armAttempts.reduce((total, attempt) => total + (grades.get(attempt.id)?.completion.completed ?? 0), 0);
      const recallEligible = rootCount > 0 && armAttempts.length > 0 && armAttempts.every((attempt) =>
        hasRegisteredRecall(grades.get(attempt.id)!));
      return { attempts: armAttempts.length, recall: recallEligible ? matched / (rootCount * armAttempts.length) : null, unsupported: armAttempts.length === 0 ? null : unsupported / armAttempts.length, completion: armAttempts.length === 0 ? null : completed / armAttempts.length };
    };
    const control = armSummary("C");
    const treatment = armSummary("D");
    if (control.recall !== null && treatment.recall !== null) output.recall.set(caseItem.caseName, treatment.recall - control.recall);
    if (control.unsupported !== null && treatment.unsupported !== null) output.unsupported.set(caseItem.caseName, treatment.unsupported - control.unsupported);
    if (control.completion !== null && treatment.completion !== null) output.completion.set(caseItem.caseName, treatment.completion - control.completion);
    const ratiosByBlock: number[] = [];
    const blocks = new Map<string, MethodologyScheduledAttempt[]>();
    for (const attempt of attempts) blocks.set(attempt.blockId, [...(blocks.get(attempt.blockId) ?? []), attempt]);
    for (const blockAttempts of blocks.values()) {
      const cAttempt = blockAttempts.find((attempt) => attempt.armId === "C");
      const dAttempt = blockAttempts.find((attempt) => attempt.armId === "D");
      const c = cAttempt ? resources.get(cAttempt.id) : undefined;
      const d = dAttempt ? resources.get(dAttempt.id) : undefined;
      if (!c || !d || grades.get(cAttempt?.id ?? "")?.completion.completed !== 1 || grades.get(dAttempt?.id ?? "")?.completion.completed !== 1 || c.outcome !== "completed" || d.outcome !== "completed" || c.wallDurationMs === null || d.wallDurationMs === null || c.wallDurationMs <= 0 || d.wallDurationMs <= 0) continue;
      ratiosByBlock.push(d.wallDurationMs / c.wallDurationMs);
    }
    if (ratiosByBlock.length > 0) output.wall.set(caseItem.caseName, median(ratiosByBlock));
  }
  return output;
}

const RESOURCE_USAGE_FIELDS = [
  "inputTokens", "baseInputTokens", "uncachedInputTokens", "cachedInputTokens",
  "cacheWriteInputTokens", "cacheReadInputTokens", "outputTokens",
  "reasoningOutputTokens", "turns", "toolCalls", "toolOutputBytes", "promptBytes", "costUsd",
] as const;
type ResourceUsageField = (typeof RESOURCE_USAGE_FIELDS)[number];
type AttemptResource = MethodologyResourceSetArtifact["resources"][number];

function deriveDecisionSurfaces(
  schedule: MethodologySchedule,
  gradeByAttempt: ReadonlyMap<string, MethodologyAttemptGrade>,
  resources: ReadonlyMap<string, AttemptResource>,
  effectiveAdjudication: MethodologyEffectiveAdjudication,
  unmatchedRootLedger: MethodologyUnmatchedRootLedger,
): MethodologyInferenceDecisionSurfaces {
  const arms = ["A", "B", "C", "D"] as const;
  const repeatRoots: MethodologyInferenceDecisionSurfaces["repeatReliability"]["roots"] = [];
  for (const caseItem of schedule.cases) {
    if ((caseItem.expectedBugCount ?? 0) === 0) continue;
    const attempts = schedule.attempts.filter((attempt) => attempt.caseName === caseItem.caseName);
    const rootNames = [...new Set(attempts.flatMap((attempt) =>
      Object.keys(gradeByAttempt.get(attempt.id)?.rootCauseMatches ?? {})))].sort();
    for (const rootCause of rootNames) {
      repeatRoots.push({
        caseName: caseItem.caseName,
        rootCause,
        byArm: arms.map((armId) => {
          const armAttempts = attempts.filter((attempt) => attempt.armId === armId);
          const detectedAttempts = armAttempts.filter((attempt) =>
            gradeByAttempt.get(attempt.id)?.rootCauseMatches[rootCause] === true).length;
          return {
            armId,
            detectedAttempts,
            scheduledAttempts: armAttempts.length,
            rate: armAttempts.length === 0 ? 0 : detectedAttempts / armAttempts.length,
          };
        }),
      });
    }
  }

  const comparisonCases = schedule.cases.filter((item) => item.expectedBugCount === null)
    .map((item) => item.caseName);
  const unsupportedFor = (caseName: string, armId: "C" | "D"): number => {
    const attempts = schedule.attempts.filter((attempt) => attempt.caseName === caseName && attempt.armId === armId);
    const attemptIds = new Set(attempts.map((attempt) => attempt.id));
    // Count each grouped root once per scheduled attempt. A root repeated on
    // multiple repeats is intentionally retained in the denominator-facing
    // count; duplicate findings within one attempt remain one root occurrence.
    return unmatchedRootLedger.roots
      .filter((root) => root.classification === "unsupported" && root.caseName === caseName)
      .reduce((total, root) => total + new Set(root.occurrences
        .filter((occurrence) => occurrence.classification === "unsupported" && attemptIds.has(occurrence.attemptId))
        .map((occurrence) => occurrence.attemptId)).size, 0);
  };
  const unsupportedRootsByArm = (armId: "C" | "D") => {
    const attemptCount = schedule.attempts.filter((attempt) => comparisonCases.includes(attempt.caseName) && attempt.armId === armId).length;
    const count = comparisonCases.reduce((total, caseName) => total + unsupportedFor(caseName, armId), 0);
    const casesWithUnsupportedRoot = comparisonCases.filter((caseName) => unsupportedFor(caseName, armId) > 0).length;
    return {
      count,
      rate: attemptCount === 0 ? null : count / attemptCount,
      caseProportion: comparisonCases.length === 0 ? null : casesWithUnsupportedRoot / comparisonCases.length,
    };
  };
  const controlUnsupported = unsupportedRootsByArm("C");
  const treatmentUnsupported = unsupportedRootsByArm("D");

  const discoveryByArm = Object.fromEntries(arms.map((armId) => {
    const armAttempts = schedule.attempts.filter((attempt) => attempt.armId === armId);
    const occurrences = effectiveAdjudication.records.filter((record) => {
      const attempt = schedule.attempts.find((candidate) => candidate.id === record.attemptId);
      return attempt?.armId === armId && record.classification === "confirmed-new";
    });
    const rootIds = new Set(unmatchedRootLedger.roots
      .filter((root) => root.occurrences.some((occurrence) => occurrence.classification === "confirmed-new" && occurrence.armId === armId))
      .map((root) => root.rootIdentitySha256));
    return [armId, {
      occurrences: occurrences.length,
      roots: rootIds.size,
      occurrencesPerScheduledReview: armAttempts.length === 0 ? null : occurrences.length / armAttempts.length,
      uniqueRootsPerScheduledReview: armAttempts.length === 0 ? null : rootIds.size / armAttempts.length,
    }];
  })) as MethodologyInferenceDecisionSurfaces["confirmedDiscovery"]["byArm"];

  const completionByArm = Object.fromEntries(arms.map((armId) => {
    const result: Record<AttemptResource["outcome"], number> = {
      completed: 0, "review-failed": 0, "preflight-failed": 0, interrupted: 0, missing: 0,
    };
    for (const attempt of schedule.attempts.filter((candidate) => candidate.armId === armId)) {
      const resource = resources.get(attempt.id);
      if (resource) result[resource.outcome] += 1;
    }
    return [armId, {
      ...result,
      // The authenticated resource contract has no separate categories for
      // malformed output, unavailable tools, or incomplete runner scope.
      unavailable: {
        malformed: "unavailable" as const,
        "tool-unavailable": "unavailable" as const,
        "incomplete-scope": "unavailable" as const,
      },
    }];
  })) as MethodologyInferenceDecisionSurfaces["completionOutcomeCategories"]["byArm"];

  const unknowns: string[] = [];
  const byArm = Object.fromEntries(arms.map((armId) => {
    const armAttempts = schedule.attempts.filter((attempt) => attempt.armId === armId);
    const aggregateDuration = (field: "wallDurationMs" | "reviewDurationMs") => {
      const observed = armAttempts.map((attempt) => resources.get(attempt.id)?.[field]).filter((value): value is number => value !== undefined && value !== null);
      const unknownAttempts = armAttempts.length - observed.length;
      if (unknownAttempts > 0) unknowns.push(`arm ${armId} ${field} unknown for ${unknownAttempts} attempt(s)`);
      return { observed: observed.length === 0 ? null : observed.reduce((sum, value) => sum + value, 0), observedAttempts: observed.length, unknownAttempts };
    };
    const usage = Object.fromEntries(RESOURCE_USAGE_FIELDS.map((field: ResourceUsageField) => {
      const observed = armAttempts.map((attempt) => resources.get(attempt.id)?.usage?.[field])
        .filter((value): value is number => value !== undefined);
      const unknownAttempts = armAttempts.length - observed.length;
      if (unknownAttempts > 0) unknowns.push(`arm ${armId} usage.${field} unknown for ${unknownAttempts} attempt(s)`);
      return [field, { observed: observed.length === 0 ? null : observed.reduce((sum, value) => sum + value, 0), observedAttempts: observed.length, unknownAttempts }];
    }));
    return [armId, {
      scheduledAttempts: armAttempts.length,
      wallDurationMs: aggregateDuration("wallDurationMs"),
      reviewDurationMs: aggregateDuration("reviewDurationMs"),
      usage,
    }];
  })) as MethodologyInferenceDecisionSurfaces["reviewResources"]["byArm"];

  return {
    repeatReliability: { status: "defined", roots: repeatRoots },
    severeBaselineFoundTreatmentMissedRoots: {
      status: "unknown",
      roots: null,
      reason: "registered-truth-severity-unavailable",
    },
    comparisonUnsupportedRootRateCases: {
      status: "defined",
      controlRate: controlUnsupported.rate,
      treatmentRate: treatmentUnsupported.rate,
      difference: treatmentUnsupported.rate === null || controlUnsupported.rate === null ? null : treatmentUnsupported.rate - controlUnsupported.rate,
      controlCaseProportion: controlUnsupported.caseProportion,
      treatmentCaseProportion: treatmentUnsupported.caseProportion,
      caseProportionDifference: treatmentUnsupported.caseProportion === null || controlUnsupported.caseProportion === null ? null : treatmentUnsupported.caseProportion - controlUnsupported.caseProportion,
      cases: comparisonCases.map((caseName) => ({
        caseName,
        controlRootCount: unsupportedFor(caseName, "C"),
        treatmentRootCount: unsupportedFor(caseName, "D"),
      })),
    },
    confirmedDiscovery: { status: "defined", byArm: discoveryByArm },
    completionOutcomeCategories: { status: "defined", byArm: completionByArm },
    reviewResources: {
      status: "defined",
      limits: {
        totalDeadlineMs: schedule.design.totalDeadlineMs,
        discoveryDeadlineMs: schedule.design.twoWorkerStageSplit.discoveryDeadlineMs,
        reviewerDeadlineMs: schedule.design.twoWorkerStageSplit.reviewerDeadlineMs,
      },
      byArm,
      unknowns,
    },
  };
}

function deriveTimeMetric(caseValues: MethodologyInferenceCaseValues, components: readonly MethodologyInferenceComponent[], plan: MethodologyInferencePlan, blockedReason: MethodologyInferenceMetric["reason"] | null): MethodologyInferenceMetric {
  const available = [...caseValues.wall.entries()].filter(([, value]) => finite(value));
  const eligibleComponents = components.filter((component) =>
    component.caseNames.some((caseName) => caseValues.wall.has(caseName)));
  const pointEstimate = available.length === 0 ? null : methodologyComponentBalancedEstimate(available, eligibleComponents, "median");
  const counts = {
    eligibleCaseCount: available.length,
    eligibleIndependentComponentCount: eligibleComponents.length,
  };
  if (blockedReason) return { pointEstimate, interval95: null, ...counts, reason: blockedReason };
  if (available.length === 0) return { pointEstimate: null, interval95: null, ...counts, reason: "no-usable-paired-time" };
  if (eligibleComponents.length < plan.minIndependentClusters) {
    return { pointEstimate, interval95: null, ...counts, reason: "insufficient-independent-components" };
  }
  // The plan's duplicate-family labels are not authenticated by an independent
  // curation/input artifact, so even usable paired-time point estimates cannot
  // receive dependence-aware intervals at this builder boundary.
  return { pointEstimate, interval95: null, ...counts, reason: "unauthenticated-duplicate-families" };
}

export function methodologyComponentBalancedEstimate(
  values: readonly [string, number][],
  components: readonly MethodologyInferenceComponent[],
  kind: "mean" | "median",
): number {
  const byCase = new Map(values);
  const componentEstimates = components
    .map((component) => component.caseNames
      .map((caseName) => byCase.get(caseName))
      .filter((value): value is number => value !== undefined))
    .filter((componentValues) => componentValues.length > 0)
    .map((componentValues) => summarize(componentValues, kind));
  return summarize(componentEstimates, kind);
}

/** Resample independent components while giving each component one vote. */
export function methodologyBootstrapInterval(values: readonly [string, number][], components: readonly MethodologyInferenceComponent[], samples: number, seed: number, kind: "mean" | "median"): { lower: number; upper: number } | null {
  const byCase = new Map(values);
  const random = seededRandom(seed);
  const estimates: number[] = [];
  for (let sample = 0; sample < samples; sample++) {
    const selected: number[] = [];
    for (let index = 0; index < components.length; index++) {
      const component = components[Math.floor(random() * components.length)]!;
      const componentValues = component.caseNames
        .map((caseName) => byCase.get(caseName))
        .filter((value): value is number => value !== undefined);
      if (componentValues.length > 0) selected.push(summarize(componentValues, kind));
    }
    if (selected.length > 0) estimates.push(summarize(selected, kind));
  }
  if (estimates.length === 0) return null;
  estimates.sort((left, right) => left - right);
  return { lower: quantile(estimates, 0.025), upper: quantile(estimates, 0.975) };
}

function planBody(input: Omit<BuildMethodologyInferencePlanInput, "schedule" | "scheduleSha256" | "primaryContrast" | "intervalPolicy" | "confidenceLevel" | "caseClusters"> & { scheduleSha256: string; primaryContrast?: string; intervalPolicy?: string; confidenceLevel?: number; caseClusters: readonly MethodologyInferenceCaseCluster[] }): Omit<MethodologyInferencePlan, "planSha256"> {
  if (input.primaryContrast !== undefined && input.primaryContrast !== METHODOLOGY_INFERENCE_PRIMARY_CONTRAST) throw new Error("inference plan primaryContrast must be D-vs-C");
  if (input.intervalPolicy !== undefined && input.intervalPolicy !== METHODOLOGY_INFERENCE_INTERVAL_POLICY) throw new Error("inference plan intervalPolicy is frozen");
  if (input.confidenceLevel !== undefined && input.confidenceLevel !== 0.95) throw new Error("inference plan confidenceLevel must be 0.95");
  const analysisStage = input.analysisStage;
  if (!["development-screen", "selection", "confirmation"].includes(analysisStage)) throw new Error("inference plan analysisStage is invalid");
  if (!["detection", "noise-reduction", "efficiency"].includes(input.hypothesis)) throw new Error("inference plan hypothesis is invalid");
  const bootstrapSamples = boundedInteger(input.bootstrapSamples, "bootstrapSamples", 1, MAX_BOOTSTRAP_SAMPLES);
  const bootstrapSeed = boundedInteger(input.bootstrapSeed, "bootstrapSeed", 0, 0xffff_ffff);
  const minIndependentClusters = boundedInteger(input.minIndependentClusters, "minIndependentClusters", 2, 1_000_000);
  const components = deriveComponents(input.caseClusters);
  const componentsSha256 = canonicalJsonSha256(components);
  return {
    schemaVersion: 1,
    protocol: METHODOLOGY_INFERENCE_PLAN_PROTOCOL,
    runId: runIdValue(input.runId, "runId"),
    scheduleSha256: digest(input.scheduleSha256, "scheduleSha256"),
    primaryContrast: METHODOLOGY_INFERENCE_PRIMARY_CONTRAST,
    analysisStage,
    hypothesis: input.hypothesis,
    intervalPolicy: METHODOLOGY_INFERENCE_INTERVAL_POLICY,
    confidenceLevel: 0.95,
    bootstrapSamples,
    bootstrapSeed,
    minIndependentClusters,
    caseClusters: input.caseClusters.map((item) => ({ ...item })),
    components,
    componentsSha256,
    ...(input.invocationRegistrationSha256 === undefined ? {} : {
      invocationRegistrationSha256: digest(input.invocationRegistrationSha256, "invocationRegistrationSha256"),
    }),
    ...(input.inputPlanSha256 === undefined ? {} : {
      inputPlanSha256: digest(input.inputPlanSha256, "inputPlanSha256"),
    }),
  };
}

function resolveScheduleSha(schedule: unknown, scheduleSha256: string | undefined): string {
  const derived = schedule === undefined ? undefined : canonicalJsonSha256(parseMethodologySchedule(schedule, "inference plan schedule"));
  if (scheduleSha256 !== undefined) digest(scheduleSha256, "scheduleSha256");
  if (derived !== undefined && scheduleSha256 !== undefined && derived !== scheduleSha256) throw new Error("scheduleSha256 does not match schedule");
  if (derived === undefined && scheduleSha256 === undefined) throw new Error("inference plan requires schedule or scheduleSha256");
  return derived ?? scheduleSha256!;
}

function parseCaseClusters(value: unknown, source: string): MethodologyInferenceCaseCluster[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${source} must be a non-empty array`);
  const result = value.map((raw, index) => {
    const item = exactObject(raw, ["caseName", "repositoryFamilySha256", "duplicateFamilySha256"], `${source}[${index}]`);
    if (typeof item.caseName !== "string" || !CASE_NAME.test(item.caseName)) throw new Error(`${source}[${index}].caseName is invalid`);
    return { caseName: item.caseName, repositoryFamilySha256: digest(item.repositoryFamilySha256, `${source}[${index}].repositoryFamilySha256`), duplicateFamilySha256: digest(item.duplicateFamilySha256, `${source}[${index}].duplicateFamilySha256`) };
  }).sort((left, right) => left.caseName.localeCompare(right.caseName));
  if (new Set(result.map((item) => item.caseName)).size !== result.length) throw new Error(`${source} contains duplicate caseName`);
  return result;
}

function deriveComponents(clusters: readonly MethodologyInferenceCaseCluster[]): MethodologyInferenceComponent[] {
  const parent = clusters.map((_, index) => index);
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]!));
  const union = (left: number, right: number) => { const a = find(left); const b = find(right); if (a !== b) parent[b] = a; };
  const repositories = new Map<string, number>();
  const duplicates = new Map<string, number>();
  clusters.forEach((cluster, index) => { const priorRepo = repositories.get(cluster.repositoryFamilySha256); if (priorRepo !== undefined) union(index, priorRepo); else repositories.set(cluster.repositoryFamilySha256, index); const priorDuplicate = duplicates.get(cluster.duplicateFamilySha256); if (priorDuplicate !== undefined) union(index, priorDuplicate); else duplicates.set(cluster.duplicateFamilySha256, index); });
  const grouped = new Map<number, MethodologyInferenceCaseCluster[]>();
  clusters.forEach((cluster, index) => { const root = find(index); grouped.set(root, [...(grouped.get(root) ?? []), cluster]); });
  return [...grouped.values()].map((members) => {
    const caseNames = members.map((member) => member.caseName).sort();
    const repositoryFamilySha256 = [...new Set(members.map((member) => member.repositoryFamilySha256))].sort();
    const duplicateFamilySha256 = [...new Set(members.map((member) => member.duplicateFamilySha256))].sort();
    const componentSha256 = canonicalJsonSha256({ caseNames, repositoryFamilySha256, duplicateFamilySha256 });
    return { componentId: `component-${componentSha256.slice(0, 24)}`, caseNames, repositoryFamilySha256, duplicateFamilySha256, componentSha256 };
  }).sort((left, right) => left.componentId.localeCompare(right.componentId));
}

function requireExactCaseCoverage(schedule: MethodologySchedule, clusters: readonly MethodologyInferenceCaseCluster[]): void {
  const expected = schedule.cases.map((item) => item.caseName).sort();
  const actual = clusters.map((item) => item.caseName).sort();
  if (canonicalJson(expected) !== canonicalJson(actual)) throw new Error("inference plan caseClusters must cover exactly every schedule case");
}

function validateRootRosters(schedule: MethodologySchedule, grades: ReadonlyMap<string, MethodologyAttemptGrade>): void {
  for (const caseItem of schedule.cases) {
    const expected = caseItem.expectedBugCount ?? 0;
    const attempts = schedule.attempts.filter((attempt) => attempt.caseName === caseItem.caseName);
    let roster: string[] | undefined;
    for (const attempt of attempts) {
      const grade = grades.get(attempt.id);
      if (!grade) throw new Error(`inference is missing grade for ${attempt.id}`);
      const recallSelections = grade.metricEligibility.selections.filter((selection) =>
        selection.metric === "registered-known-root-recall");
      if (recallSelections.length !== 1) {
        throw new Error(`inference requires one registered-root eligibility selection for ${attempt.id}`);
      }
      const recallSelection = recallSelections[0]!;
      if (expected > 0) {
        if (recallSelection.disposition !== "included" ||
            recallSelection.denominator?.source !== "registered-known-roots" ||
            recallSelection.denominator.count !== expected) {
          throw new Error(`inference registered-root eligibility does not match ${caseItem.caseName}`);
        }
      } else if (recallSelection.disposition === "included") {
        throw new Error(`inference comparison case cannot enter registered-root recall: ${caseItem.caseName}`);
      }
      const keys = Object.keys(grade.rootCauseMatches).sort();
      if (keys.length !== expected || keys.some((key) => typeof grade.rootCauseMatches[key] !== "boolean")) throw new Error(`inference root roster does not match expectedBugCount for ${caseItem.caseName}`);
      if (roster && canonicalJson(roster) !== canonicalJson(keys)) throw new Error(`inference root roster differs across repeats for ${caseItem.caseName}`);
      roster = keys;
    }
  }
}

function hasRegisteredRecall(grade: MethodologyAttemptGrade): boolean {
  return grade.metricEligibility.selections.some((selection) =>
    selection.metric === "registered-known-root-recall" && selection.disposition === "included");
}

function countInputs(schedule: MethodologySchedule, plan: MethodologyInferencePlan) {
  const roots = schedule.cases.reduce((total, item) => total + (item.expectedBugCount ?? 0), 0);
  return { independentRepositoryCount: new Set(plan.caseClusters.map((item) => item.repositoryFamilySha256)).size, duplicateFamilyCount: new Set(plan.caseClusters.map((item) => item.duplicateFamilySha256)).size, componentCount: plan.components.length, caseCount: schedule.cases.length, rootCount: roots, attemptCount: schedule.attempts.length };
}

function validateMetricShape(value: unknown, source: string): void {
  const root = exactObject(value, ["registeredKnownRootRecallDifference", "unsupportedRootsPerScheduledReviewDifference", "completionRateDifference", "pairedWallTimeRatio"], source);
  for (const [key, metric] of Object.entries(root)) {
    const item = exactObject(metric, ["pointEstimate", "interval95", "eligibleCaseCount", "eligibleIndependentComponentCount", "reason"], `${source}.${key}`);
    if (item.pointEstimate !== null && !finite(item.pointEstimate)) throw new Error(`${source}.${key}.pointEstimate must be finite or null`);
    boundedInteger(item.eligibleCaseCount, `${source}.${key}.eligibleCaseCount`, 0, 1_000_000_000);
    boundedInteger(item.eligibleIndependentComponentCount, `${source}.${key}.eligibleIndependentComponentCount`, 0, 1_000_000_000);
    if (item.interval95 !== null) { const interval = exactObject(item.interval95, ["lower", "upper"], `${source}.${key}.interval95`); if (!finite(interval.lower) || !finite(interval.upper) || Number(interval.lower) > Number(interval.upper)) throw new Error(`${source}.${key}.interval95 is invalid`); }
    if (!["none", "unresolved-adjudications", "insufficient-independent-components", "no-eligible-cases", "no-usable-paired-time", "unauthenticated-duplicate-families"].includes(String(item.reason))) throw new Error(`${source}.${key}.reason is invalid`);
    if (item.reason === "none" && (item.pointEstimate === null || item.interval95 === null)) throw new Error(`${source}.${key} must include a finite estimate and interval when defined`);
    if (item.reason !== "none" && item.interval95 !== null) throw new Error(`${source}.${key} interval must be null when unavailable or blocked`);
  }
}

function validateDecisionSurfaces(value: unknown, source: string): void {
  const root = exactObject(value, [
    "repeatReliability", "severeBaselineFoundTreatmentMissedRoots", "comparisonUnsupportedRootRateCases",
    "confirmedDiscovery", "completionOutcomeCategories", "reviewResources",
  ], source);
  const repeat = exactObject(root.repeatReliability, ["status", "roots"], `${source}.repeatReliability`);
  if (repeat.status !== "defined" || !Array.isArray(repeat.roots)) throw new Error(`${source}.repeatReliability is unavailable or malformed`);
  repeat.roots.forEach((value, index) => {
    const item = exactObject(value, ["caseName", "rootCause", "byArm"], `${source}.repeatReliability.roots[${index}]`);
    if (typeof item.caseName !== "string" || !CASE_NAME.test(item.caseName) || typeof item.rootCause !== "string" || item.rootCause.length === 0) throw new Error(`${source}.repeatReliability root identity is invalid`);
    if (!Array.isArray(item.byArm) || item.byArm.length !== 4) throw new Error(`${source}.repeatReliability.byArm is invalid`);
    const seen = new Set<string>();
    item.byArm.forEach((value, armIndex) => {
      const arm = exactObject(value, ["armId", "detectedAttempts", "scheduledAttempts", "rate"], `${source}.repeatReliability.roots[${index}].byArm[${armIndex}]`);
      if (!["A", "B", "C", "D"].includes(String(arm.armId)) || seen.has(String(arm.armId))) throw new Error(`${source}.repeatReliability arm roster is invalid`);
      seen.add(String(arm.armId));
      const scheduled = boundedInteger(arm.scheduledAttempts, `${source}.repeatReliability.scheduledAttempts`, 0, 1_000_000_000);
      const detected = boundedInteger(arm.detectedAttempts, `${source}.repeatReliability.detectedAttempts`, 0, scheduled);
      if (!finite(arm.rate) || Number(arm.rate) < 0 || Number(arm.rate) > 1 || (scheduled === 0 ? Number(arm.rate) !== 0 : Number(arm.rate) !== detected / scheduled)) throw new Error(`${source}.repeatReliability rate is invalid`);
    });
  });

  const severe = exactObject(root.severeBaselineFoundTreatmentMissedRoots, ["status", "roots", "reason"], `${source}.severeBaselineFoundTreatmentMissedRoots`);
  if (severe.status === "unknown") {
    if (severe.roots !== null || severe.reason !== "registered-truth-severity-unavailable") throw new Error(`${source}.severeBaselineFoundTreatmentMissedRoots is invalid`);
  } else {
    if (severe.reason !== "none" || !Array.isArray(severe.roots)) throw new Error(`${source}.severeBaselineFoundTreatmentMissedRoots is invalid`);
    severe.roots.forEach((value, index) => {
      const item = exactObject(value, ["caseName", "rootCause"], `${source}.severeBaselineFoundTreatmentMissedRoots.roots[${index}]`);
      if (typeof item.caseName !== "string" || !CASE_NAME.test(item.caseName) || typeof item.rootCause !== "string" || item.rootCause.length === 0) throw new Error(`${source}.severeBaselineFoundTreatmentMissedRoots root identity is invalid`);
    });
  }

  const comparison = exactObject(root.comparisonUnsupportedRootRateCases, ["status", "controlRate", "treatmentRate", "difference", "controlCaseProportion", "treatmentCaseProportion", "caseProportionDifference", "cases"], `${source}.comparisonUnsupportedRootRateCases`);
  if (comparison.status !== "defined" || !Array.isArray(comparison.cases)) throw new Error(`${source}.comparisonUnsupportedRootRateCases is unavailable or malformed`);
  for (const key of ["controlRate", "treatmentRate"]) if (comparison[key] !== null && (!finite(comparison[key]) || Number(comparison[key]) < 0)) throw new Error(`${source}.comparisonUnsupportedRootRateCases.${key} is invalid`);
  for (const key of ["controlCaseProportion", "treatmentCaseProportion"]) if (comparison[key] !== null && (!finite(comparison[key]) || Number(comparison[key]) < 0 || Number(comparison[key]) > 1)) throw new Error(`${source}.comparisonUnsupportedRootRateCases.${key} is invalid`);
  for (const key of ["difference", "caseProportionDifference"]) if (comparison[key] !== null && !finite(comparison[key])) throw new Error(`${source}.comparisonUnsupportedRootRateCases.${key} is invalid`);
  comparison.cases.forEach((value, index) => {
    const item = exactObject(value, ["caseName", "controlRootCount", "treatmentRootCount"], `${source}.comparisonUnsupportedRootRateCases.cases[${index}]`);
    if (typeof item.caseName !== "string" || !CASE_NAME.test(item.caseName)) throw new Error(`${source}.comparisonUnsupportedRootRateCases case is invalid`);
    boundedInteger(item.controlRootCount, `${source}.comparisonUnsupportedRootRateCases.controlRootCount`, 0, 1_000_000_000);
    boundedInteger(item.treatmentRootCount, `${source}.comparisonUnsupportedRootRateCases.treatmentRootCount`, 0, 1_000_000_000);
  });

  const discovery = exactObject(root.confirmedDiscovery, ["status", "byArm"], `${source}.confirmedDiscovery`);
  if (discovery.status !== "defined") throw new Error(`${source}.confirmedDiscovery is unavailable`);
  validateArmObject(discovery.byArm, `${source}.confirmedDiscovery.byArm`, (item, label) => {
    exactObject(item, ["occurrences", "roots", "occurrencesPerScheduledReview", "uniqueRootsPerScheduledReview"], label);
    boundedInteger(item.occurrences, `${label}.occurrences`, 0, 1_000_000_000);
    boundedInteger(item.roots, `${label}.roots`, 0, 1_000_000_000);
    for (const key of ["occurrencesPerScheduledReview", "uniqueRootsPerScheduledReview"]) {
      if (item[key] !== null && (!finite(item[key]) || Number(item[key]) < 0)) throw new Error(`${label}.${key} is invalid`);
    }
  });

  const completion = exactObject(root.completionOutcomeCategories, ["status", "byArm"], `${source}.completionOutcomeCategories`);
  if (completion.status !== "defined") throw new Error(`${source}.completionOutcomeCategories is unavailable`);
  validateArmObject(completion.byArm, `${source}.completionOutcomeCategories.byArm`, (item, label) => {
    const categories = exactObject(item, ["completed", "review-failed", "preflight-failed", "interrupted", "missing", "unavailable"], label);
    for (const key of ["completed", "review-failed", "preflight-failed", "interrupted", "missing"]) {
      boundedInteger(categories[key], `${label}.${key}`, 0, 1_000_000_000);
    }
    const unavailable = exactObject(categories.unavailable, ["malformed", "tool-unavailable", "incomplete-scope"], `${label}.unavailable`);
    for (const key of ["malformed", "tool-unavailable", "incomplete-scope"]) {
      if (unavailable[key] !== "unavailable") throw new Error(`${label}.unavailable.${key} must be explicitly unavailable`);
    }
  });

  const resources = exactObject(root.reviewResources, ["status", "limits", "byArm", "unknowns"], `${source}.reviewResources`);
  if (resources.status !== "defined" || !Array.isArray(resources.unknowns)) throw new Error(`${source}.reviewResources is unavailable or malformed`);
  const limits = exactObject(resources.limits, ["totalDeadlineMs", "discoveryDeadlineMs", "reviewerDeadlineMs"], `${source}.reviewResources.limits`);
  for (const [key, value] of Object.entries(limits)) boundedInteger(value, `${source}.reviewResources.limits.${key}`, 1, 1_000_000_000);
  resources.unknowns.forEach((item, index) => text(item, `${source}.reviewResources.unknowns[${index}]`));
  validateArmObject(resources.byArm, `${source}.reviewResources.byArm`, (item, label) => {
    const arm = exactObject(item, ["scheduledAttempts", "wallDurationMs", "reviewDurationMs", "usage"], label);
    boundedInteger(arm.scheduledAttempts, `${label}.scheduledAttempts`, 0, 1_000_000_000);
    for (const duration of ["wallDurationMs", "reviewDurationMs"]) {
      const metric = exactObject(arm[duration], ["observed", "observedAttempts", "unknownAttempts"], `${label}.${duration}`);
      if (metric.observed !== null && (!finite(metric.observed) || Number(metric.observed) < 0)) throw new Error(`${label}.${duration}.observed is invalid`);
      boundedInteger(metric.observedAttempts, `${label}.${duration}.observedAttempts`, 0, 1_000_000_000);
      boundedInteger(metric.unknownAttempts, `${label}.${duration}.unknownAttempts`, 0, 1_000_000_000);
    }
    const usage = exactObject(arm.usage, RESOURCE_USAGE_FIELDS, `${label}.usage`);
    for (const field of RESOURCE_USAGE_FIELDS) {
      const metric = exactObject(usage[field], ["observed", "observedAttempts", "unknownAttempts"], `${label}.usage.${field}`);
      if (metric.observed !== null && (!finite(metric.observed) || Number(metric.observed) < 0)) throw new Error(`${label}.usage.${field}.observed is invalid`);
      boundedInteger(metric.observedAttempts, `${label}.usage.${field}.observedAttempts`, 0, 1_000_000_000);
      boundedInteger(metric.unknownAttempts, `${label}.usage.${field}.unknownAttempts`, 0, 1_000_000_000);
    }
  });
}

function validateArmObject(
  value: unknown,
  source: string,
  validate: (item: Record<string, any>, label: string) => void,
): void {
  const root = exactObject(value, ["A", "B", "C", "D"], source);
  for (const arm of ["A", "B", "C", "D"] as const) validate(root[arm], `${source}.${arm}`);
}

function summarize(values: readonly number[], kind: "mean" | "median"): number { return kind === "mean" ? values.reduce((total, value) => total + value, 0) / values.length : median(values); }
function median(values: readonly number[]): number { const sorted = [...values].sort((left, right) => left - right); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2; }
function quantile(values: readonly number[], probability: number): number { const position = (values.length - 1) * probability; const lower = Math.floor(position); const fraction = position - lower; return values[lower]! + fraction * ((values[lower + 1] ?? values[lower]!) - values[lower]!); }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number { if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`); return Number(value); }
function runIdValue(value: unknown, label: string): string { if (typeof value !== "string" || !RUN_ID.test(value)) throw new Error(`${label} is invalid`); return value; }
function digest(value: unknown, label: string): string { if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`); return value; }
function text(value: unknown, label: string): string { if (typeof value !== "string" || value.length === 0 || value.length > 1_000) throw new Error(`${label} must be a bounded string`); return value; }
function exactObject(value: unknown, keys: readonly string[], source: string, optional: readonly string[] = []): Record<string, any> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be an object`); const object = value as Record<string, any>; const actual = Object.keys(object).sort(); const expected = [...keys, ...actual.filter((key) => optional.includes(key))].sort(); if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`${source} has an invalid shape`); return object; }
