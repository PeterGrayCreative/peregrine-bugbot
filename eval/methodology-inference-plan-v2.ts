import { canonicalJson, canonicalJsonSha256 } from "./experiment.js";
import {
  buildMethodologyInferenceArtifact,
  buildMethodologyInferencePlan,
  deriveMethodologyInferenceCaseValues,
  methodologyBootstrapInterval,
  parseMethodologyInferenceArtifact,
  type MethodologyInferenceAnalysisStage,
  type MethodologyInferenceArtifact,
  type MethodologyInferenceComponent,
  type MethodologyInferenceHypothesis,
  type MethodologyInferenceMetric,
  type MethodologyInferenceUpstreamInputs,
} from "./methodology-inference.js";
import {
  parseR2TruthBindingArtifact,
  type R2TruthBindingArtifact,
} from "./methodology-r2-truth-binding.js";
import { parseMethodologySchedule } from "./methodology-schedule.js";

export const METHODOLOGY_INFERENCE_PLAN_V2_PROTOCOL =
  "historical-methodology-inference-plan-v2" as const;
export const METHODOLOGY_INFERENCE_PLAN_V2_INTERVAL_POLICY =
  "r2-bound-maximal-family-cluster-percentile-bootstrap-v1" as const;

const SHA256 = /^[a-f0-9]{64}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CASE_NAME = /^(?:development|validation)\/case-[a-f0-9]{8,32}$/;
const MAX_BOOTSTRAP_SAMPLES = 100_000;

export interface MethodologyInferencePlanV2CaseBinding {
  caseName: string;
  repositoryFamilySha256: string;
  duplicateFamilySha256: string;
  registrationSha256: string;
  curationSha256: string;
  caseBundleSha256: string;
  truthScopeSha256: string;
  canonicalTruthSha256: string;
}

export interface MethodologyInferencePlanV2 {
  schemaVersion: 2;
  protocol: typeof METHODOLOGY_INFERENCE_PLAN_V2_PROTOCOL;
  runId: string;
  scheduleSha256: string;
  invocationRegistrationSha256: string;
  inputPlanSha256: string;
  r2TruthBindingSha256: string;
  r2PartitionArtifactSha256: string;
  analysisStage: Extract<MethodologyInferenceAnalysisStage, "development-screen" | "selection">;
  hypothesis: MethodologyInferenceHypothesis;
  primaryContrast: "D-vs-C";
  intervalPolicy: typeof METHODOLOGY_INFERENCE_PLAN_V2_INTERVAL_POLICY;
  confidenceLevel: 0.95;
  bootstrapSamples: number;
  bootstrapSeed: number;
  minIndependentClusters: number;
  caseBindings: MethodologyInferencePlanV2CaseBinding[];
  components: MethodologyInferenceComponent[];
  componentsSha256: string;
  claims: {
    clusterSource: "authenticated-r2-truth-binding";
    rootSeverityVisibility: "operator-only-not-serialized";
    developmentSevereRegressionSemantics: "descriptive-two-repeat-only";
    selectionEvidence: "exploratory-not-confirmatory";
  };
  planSha256: string;
}

export interface BuildMethodologyInferencePlanV2Input {
  runId: string;
  schedule: unknown;
  invocationRegistrationSha256: string;
  inputPlanSha256: string;
  truthBinding: unknown;
  analysisStage: MethodologyInferencePlanV2["analysisStage"];
  hypothesis: MethodologyInferenceHypothesis;
  bootstrapSamples: number;
  bootstrapSeed: number;
  minIndependentClusters: number;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new Error(`${label} is out of bounds`);
  return Number(value);
}

function exactObject(value: unknown, required: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const root = value as Record<string, unknown>;
  if (Object.keys(root).some((key) => !required.includes(key)) || required.some((key) => !Object.hasOwn(root, key))) throw new Error(`${label} has an invalid shape`);
  return root;
}

function selectedCases(binding: R2TruthBindingArtifact, stage: MethodologyInferencePlanV2["analysisStage"]) {
  const partition = stage === "development-screen" ? "development" : "selection";
  return binding.cases.filter((item) => item.partition === partition);
}

export function buildMethodologyInferencePlanV2(input: BuildMethodologyInferencePlanV2Input): MethodologyInferencePlanV2 {
  if (typeof input.runId !== "string" || !RUN_ID.test(input.runId)) throw new Error("inference v2 runId is invalid");
  if (input.analysisStage !== "development-screen" && input.analysisStage !== "selection") throw new Error("inference v2 analysisStage is invalid");
  const binding = parseR2TruthBindingArtifact(input.truthBinding);
  const schedule = parseMethodologySchedule(input.schedule, "inference v2 schedule");
  const expected = selectedCases(binding, input.analysisStage);
  const expectedCases = expected.map((item) => ({
    caseName: item.caseName,
    corpus: item.partition === "development" ? "development" as const : "validation" as const,
    expectedBugCount: item.caseClass === "bug-bearing" ? item.roots.length : null,
  }));
  if (canonicalJson(schedule.cases) !== canonicalJson(expectedCases)) throw new Error("inference v2 schedule does not exactly cover its bound R2 partition");
  const expectedRepeats = input.analysisStage === "development-screen" ? 2 : 3;
  if (schedule.design.repeats !== expectedRepeats) throw new Error(`inference v2 ${input.analysisStage} requires exactly ${expectedRepeats} repeats`);

  const caseBindings = expected.map((item): MethodologyInferencePlanV2CaseBinding => ({
    caseName: item.caseName,
    repositoryFamilySha256: item.repositoryIdentitySha256,
    duplicateFamilySha256: item.duplicateFamilySha256,
    registrationSha256: item.registrationSha256,
    curationSha256: item.curationSha256,
    caseBundleSha256: item.caseBundleSha256,
    truthScopeSha256: item.truthScopeSha256,
    canonicalTruthSha256: item.canonicalTruthSha256,
  }));
  const legacyShape = buildMethodologyInferencePlan({
    runId: input.runId,
    schedule,
    analysisStage: input.analysisStage,
    hypothesis: input.hypothesis,
    bootstrapSamples: input.bootstrapSamples,
    bootstrapSeed: input.bootstrapSeed,
    minIndependentClusters: input.minIndependentClusters,
    caseClusters: caseBindings.map((item) => ({
      caseName: item.caseName,
      repositoryFamilySha256: item.repositoryFamilySha256,
      duplicateFamilySha256: item.duplicateFamilySha256,
    })),
    invocationRegistrationSha256: digest(input.invocationRegistrationSha256, "invocationRegistrationSha256"),
    inputPlanSha256: digest(input.inputPlanSha256, "inputPlanSha256"),
  });
  const body: Omit<MethodologyInferencePlanV2, "planSha256"> = {
    schemaVersion: 2,
    protocol: METHODOLOGY_INFERENCE_PLAN_V2_PROTOCOL,
    runId: input.runId,
    scheduleSha256: legacyShape.scheduleSha256,
    invocationRegistrationSha256: legacyShape.invocationRegistrationSha256!,
    inputPlanSha256: legacyShape.inputPlanSha256!,
    r2TruthBindingSha256: binding.bindingSha256,
    r2PartitionArtifactSha256: binding.partitionArtifactSha256,
    analysisStage: input.analysisStage,
    hypothesis: input.hypothesis,
    primaryContrast: "D-vs-C",
    intervalPolicy: METHODOLOGY_INFERENCE_PLAN_V2_INTERVAL_POLICY,
    confidenceLevel: 0.95,
    bootstrapSamples: legacyShape.bootstrapSamples,
    bootstrapSeed: legacyShape.bootstrapSeed,
    minIndependentClusters: legacyShape.minIndependentClusters,
    caseBindings,
    components: legacyShape.components,
    componentsSha256: legacyShape.componentsSha256,
    claims: {
      clusterSource: "authenticated-r2-truth-binding",
      rootSeverityVisibility: "operator-only-not-serialized",
      developmentSevereRegressionSemantics: "descriptive-two-repeat-only",
      selectionEvidence: "exploratory-not-confirmatory",
    },
  };
  return { ...body, planSha256: canonicalJsonSha256(body) };
}

export function parseMethodologyInferencePlanV2(value: unknown, source = "methodology inference plan v2"): MethodologyInferencePlanV2 {
  const keys = ["schemaVersion", "protocol", "runId", "scheduleSha256", "invocationRegistrationSha256", "inputPlanSha256", "r2TruthBindingSha256", "r2PartitionArtifactSha256", "analysisStage", "hypothesis", "primaryContrast", "intervalPolicy", "confidenceLevel", "bootstrapSamples", "bootstrapSeed", "minIndependentClusters", "caseBindings", "components", "componentsSha256", "claims", "planSha256"] as const;
  const root = exactObject(value, keys, source);
  if (root.schemaVersion !== 2 || root.protocol !== METHODOLOGY_INFERENCE_PLAN_V2_PROTOCOL) throw new Error(`${source} protocol/version is invalid`);
  if (typeof root.runId !== "string" || !RUN_ID.test(root.runId)) throw new Error(`${source}.runId is invalid`);
  if (root.analysisStage !== "development-screen" && root.analysisStage !== "selection") throw new Error(`${source}.analysisStage is invalid`);
  if (root.hypothesis !== "detection" && root.hypothesis !== "noise-reduction" && root.hypothesis !== "efficiency") throw new Error(`${source}.hypothesis is invalid`);
  if (root.primaryContrast !== "D-vs-C" || root.intervalPolicy !== METHODOLOGY_INFERENCE_PLAN_V2_INTERVAL_POLICY || root.confidenceLevel !== 0.95) throw new Error(`${source} frozen policy is invalid`);
  if (!Array.isArray(root.caseBindings) || root.caseBindings.length === 0) throw new Error(`${source}.caseBindings is invalid`);
  const caseBindings = root.caseBindings.map((value, index): MethodologyInferencePlanV2CaseBinding => {
    const item = exactObject(value, ["caseName", "repositoryFamilySha256", "duplicateFamilySha256", "registrationSha256", "curationSha256", "caseBundleSha256", "truthScopeSha256", "canonicalTruthSha256"], `${source}.caseBindings[${index}]`);
    if (typeof item.caseName !== "string" || !CASE_NAME.test(item.caseName)) throw new Error(`${source}.caseBindings[${index}].caseName is invalid`);
    return {
      caseName: item.caseName,
      repositoryFamilySha256: digest(item.repositoryFamilySha256, "repositoryFamilySha256"),
      duplicateFamilySha256: digest(item.duplicateFamilySha256, "duplicateFamilySha256"),
      registrationSha256: digest(item.registrationSha256, "registrationSha256"),
      curationSha256: digest(item.curationSha256, "curationSha256"),
      caseBundleSha256: digest(item.caseBundleSha256, "caseBundleSha256"),
      truthScopeSha256: digest(item.truthScopeSha256, "truthScopeSha256"),
      canonicalTruthSha256: digest(item.canonicalTruthSha256, "canonicalTruthSha256"),
    };
  });
  if (new Set(caseBindings.map((item) => item.caseName)).size !== caseBindings.length || canonicalJson(caseBindings) !== canonicalJson([...caseBindings].sort((a, b) => a.caseName.localeCompare(b.caseName)))) throw new Error(`${source}.caseBindings are not unique and canonical`);
  const claims = exactObject(root.claims, ["clusterSource", "rootSeverityVisibility", "developmentSevereRegressionSemantics", "selectionEvidence"], `${source}.claims`);
  if (claims.clusterSource !== "authenticated-r2-truth-binding" || claims.rootSeverityVisibility !== "operator-only-not-serialized" || claims.developmentSevereRegressionSemantics !== "descriptive-two-repeat-only" || claims.selectionEvidence !== "exploratory-not-confirmatory") throw new Error(`${source}.claims are invalid`);
  const legacyShape = buildMethodologyInferencePlan({
    runId: root.runId,
    scheduleSha256: digest(root.scheduleSha256, `${source}.scheduleSha256`),
    analysisStage: root.analysisStage,
    hypothesis: root.hypothesis,
    bootstrapSamples: integer(root.bootstrapSamples, `${source}.bootstrapSamples`, 1, MAX_BOOTSTRAP_SAMPLES),
    bootstrapSeed: integer(root.bootstrapSeed, `${source}.bootstrapSeed`, 0, 0xffff_ffff),
    minIndependentClusters: integer(root.minIndependentClusters, `${source}.minIndependentClusters`, 2, 1_000_000),
    caseClusters: caseBindings.map((item) => ({ caseName: item.caseName, repositoryFamilySha256: item.repositoryFamilySha256, duplicateFamilySha256: item.duplicateFamilySha256 })),
    invocationRegistrationSha256: digest(root.invocationRegistrationSha256, `${source}.invocationRegistrationSha256`),
    inputPlanSha256: digest(root.inputPlanSha256, `${source}.inputPlanSha256`),
  });
  if (canonicalJson(root.components) !== canonicalJson(legacyShape.components) || root.componentsSha256 !== legacyShape.componentsSha256) throw new Error(`${source} components do not rederive from bound cases`);
  digest(root.r2TruthBindingSha256, `${source}.r2TruthBindingSha256`);
  digest(root.r2PartitionArtifactSha256, `${source}.r2PartitionArtifactSha256`);
  const body = { ...root } as Record<string, unknown>;
  delete body.planSha256;
  if (root.planSha256 !== canonicalJsonSha256(body)) throw new Error(`${source}.planSha256 is invalid`);
  return value as MethodologyInferencePlanV2;
}

/** Rebuild the stored plan from the exact schedule and operator-only binding. */
export function verifyMethodologyInferencePlanV2(
  planValue: unknown,
  input: BuildMethodologyInferencePlanV2Input,
  expectedPlanSha256: string,
): MethodologyInferencePlanV2 {
  const supplied = parseMethodologyInferencePlanV2(planValue);
  const rebuilt = buildMethodologyInferencePlanV2(input);
  if (rebuilt.planSha256 !== digest(expectedPlanSha256, "expectedPlanSha256") || canonicalJson(supplied) !== canonicalJson(rebuilt)) throw new Error("methodology inference plan v2 differs from its authenticated sources");
  return rebuilt;
}

export const METHODOLOGY_INFERENCE_V2_PROTOCOL =
  "historical-methodology-inference-v2" as const;

export interface MethodologyInferenceV2SevereRoot {
  caseName: string;
  rootCause: string;
  expectedSeverity: "high";
  controlDetectedAttempts: number;
  treatmentDetectedAttempts: number;
  scheduledAttemptsPerArm: number;
  formalRegression: null;
}

export interface MethodologyInferenceArtifactV2 {
  schemaVersion: 2;
  protocol: typeof METHODOLOGY_INFERENCE_V2_PROTOCOL;
  runId: string;
  planSha256: string;
  r2TruthBindingSha256: string;
  baseInference: MethodologyInferenceArtifact;
  metrics: MethodologyInferenceArtifact["metrics"];
  severeRegressionSurface: {
    status: "defined";
    interpretation: "descriptive-two-repeat-only" | "exploratory-three-repeat-only";
    roots: MethodologyInferenceV2SevereRoot[];
    formalRegressions: null;
    reason: "confirmation-only-threshold-not-applicable";
  };
  status: "defined" | "blocked";
  blockers: string[];
  claims: {
    duplicateFamilyBinding: "authenticated-r2-truth-binding";
    rootSeverityBinding: "authenticated-r2-truth-binding";
    providerIdentity: "not-established-by-inference";
    efficacy: "not-decided-by-inference";
  };
  inferenceSha256: string;
}

export interface BuildMethodologyInferenceArtifactV2Input extends MethodologyInferenceUpstreamInputs {
  plan: unknown;
  truthBinding: unknown;
}

function legacyPlanForV2(plan: MethodologyInferencePlanV2, schedule: unknown) {
  return buildMethodologyInferencePlan({
    runId: plan.runId,
    schedule,
    analysisStage: plan.analysisStage,
    hypothesis: plan.hypothesis,
    bootstrapSamples: plan.bootstrapSamples,
    bootstrapSeed: plan.bootstrapSeed,
    minIndependentClusters: plan.minIndependentClusters,
    caseClusters: plan.caseBindings.map((item) => ({ caseName: item.caseName, repositoryFamilySha256: item.repositoryFamilySha256, duplicateFamilySha256: item.duplicateFamilySha256 })),
    invocationRegistrationSha256: plan.invocationRegistrationSha256,
    inputPlanSha256: plan.inputPlanSha256,
  });
}

export function buildMethodologyInferenceArtifactV2(input: BuildMethodologyInferenceArtifactV2Input): MethodologyInferenceArtifactV2 {
  const plan = parseMethodologyInferencePlanV2(input.plan);
  const binding = parseR2TruthBindingArtifact(input.truthBinding);
  const rebuiltPlan = buildMethodologyInferencePlanV2({
    runId: plan.runId,
    schedule: input.schedule,
    invocationRegistrationSha256: plan.invocationRegistrationSha256,
    inputPlanSha256: plan.inputPlanSha256,
    truthBinding: binding,
    analysisStage: plan.analysisStage,
    hypothesis: plan.hypothesis,
    bootstrapSamples: plan.bootstrapSamples,
    bootstrapSeed: plan.bootstrapSeed,
    minIndependentClusters: plan.minIndependentClusters,
  });
  if (canonicalJson(rebuiltPlan) !== canonicalJson(plan)) throw new Error("inference v2 plan differs from its exact schedule or R2 truth binding");
  const schedule = parseMethodologySchedule(input.schedule, "inference v2 schedule");
  const legacyPlan = legacyPlanForV2(plan, schedule);
  const baseInference = buildMethodologyInferenceArtifact({ ...input, plan: legacyPlan });
  const bindingCases = new Map(selectedCases(binding, plan.analysisStage).map((item) => [item.caseName, item]));
  for (const grade of input.gradeSet.grades) {
    const caseBinding = bindingCases.get(grade.projection.caseName);
    if (!caseBinding || grade.projection.caseRegistrationSha256 !== caseBinding.registrationSha256 || grade.projection.truthSha256 !== caseBinding.canonicalTruthSha256 || grade.projection.truthScopeSha256 !== caseBinding.truthScopeSha256) throw new Error("inference v2 grade does not match its operator truth binding");
  }

  const gradeByAttempt = new Map(input.gradeSet.grades.map((grade) => [grade.projection.attemptId, grade]));
  const resourceByAttempt = new Map(input.resourceSet.resources.map((resource) => [resource.attemptId, resource]));
  const caseValues = deriveMethodologyInferenceCaseValues(schedule, gradeByAttempt, resourceByAttempt, input.unmatchedRootLedger);
  const unresolved = input.effectiveAdjudication.unresolvedCount;
  const metric = (values: ReadonlyMap<string, number>, kind: "mean" | "median", noValues: MethodologyInferenceMetric["reason"], pointEstimate: number | null): MethodologyInferenceMetric => {
    const available = [...values.entries()].filter(([, value]) => Number.isFinite(value));
    const components = plan.components.filter((component) => component.caseNames.some((caseName) => values.has(caseName)));
    const counts = { eligibleCaseCount: available.length, eligibleIndependentComponentCount: components.length };
    if (unresolved > 0) return { pointEstimate, interval95: null, ...counts, reason: "unresolved-adjudications" };
    if (available.length === 0) return { pointEstimate: null, interval95: null, ...counts, reason: noValues };
    if (components.length < plan.minIndependentClusters) return { pointEstimate, interval95: null, ...counts, reason: "insufficient-independent-components" };
    const interval95 = methodologyBootstrapInterval(available, components, plan.bootstrapSamples, plan.bootstrapSeed, kind);
    if (interval95 === null || pointEstimate === null) throw new Error("inference v2 could not derive its registered interval");
    return { pointEstimate, interval95, ...counts, reason: "none" };
  };
  const metrics = {
    registeredKnownRootRecallDifference: metric(caseValues.recall, "mean", "no-eligible-cases", baseInference.metrics.registeredKnownRootRecallDifference.pointEstimate),
    unsupportedRootsPerScheduledReviewDifference: metric(caseValues.unsupported, "mean", "no-eligible-cases", baseInference.metrics.unsupportedRootsPerScheduledReviewDifference.pointEstimate),
    completionRateDifference: metric(caseValues.completion, "mean", "no-eligible-cases", baseInference.metrics.completionRateDifference.pointEstimate),
    pairedWallTimeRatio: metric(caseValues.wall, "median", "no-usable-paired-time", baseInference.metrics.pairedWallTimeRatio.pointEstimate),
  };

  const reliability = new Map(baseInference.decisionSurfaces.repeatReliability.roots.map((item) => [`${item.caseName}\0${item.rootCause}`, item]));
  const severeRoots: MethodologyInferenceV2SevereRoot[] = selectedCases(binding, plan.analysisStage).flatMap((item) =>
    item.roots.filter((root) => root.expectedSeverity === "high").map((root) => {
      const observed = reliability.get(`${item.caseName}\0${root.rootCause}`);
      if (!observed) throw new Error(`inference v2 is missing registered reliability for ${item.caseName} ${root.rootCause}`);
      const control = observed.byArm.find((arm) => arm.armId === "C")!;
      const treatment = observed.byArm.find((arm) => arm.armId === "D")!;
      if (control.scheduledAttempts !== schedule.design.repeats || treatment.scheduledAttempts !== schedule.design.repeats) throw new Error("inference v2 severe-root repeat roster is incomplete");
      return { caseName: item.caseName, rootCause: root.rootCause, expectedSeverity: "high" as const, controlDetectedAttempts: control.detectedAttempts, treatmentDetectedAttempts: treatment.detectedAttempts, scheduledAttemptsPerArm: schedule.design.repeats, formalRegression: null };
    }),
  ).sort((left, right) => left.caseName.localeCompare(right.caseName) || left.rootCause.localeCompare(right.rootCause));
  const blockers = Object.entries(metrics).filter(([, value]) => value.reason !== "none").map(([name, value]) => `${name}: ${value.reason}`);
  const body: Omit<MethodologyInferenceArtifactV2, "inferenceSha256"> = {
    schemaVersion: 2,
    protocol: METHODOLOGY_INFERENCE_V2_PROTOCOL,
    runId: plan.runId,
    planSha256: plan.planSha256,
    r2TruthBindingSha256: binding.bindingSha256,
    baseInference,
    metrics,
    severeRegressionSurface: {
      status: "defined",
      interpretation: plan.analysisStage === "development-screen" ? "descriptive-two-repeat-only" : "exploratory-three-repeat-only",
      roots: severeRoots,
      formalRegressions: null,
      reason: "confirmation-only-threshold-not-applicable",
    },
    status: blockers.length === 0 ? "defined" : "blocked",
    blockers,
    claims: {
      duplicateFamilyBinding: "authenticated-r2-truth-binding",
      rootSeverityBinding: "authenticated-r2-truth-binding",
      providerIdentity: "not-established-by-inference",
      efficacy: "not-decided-by-inference",
    },
  };
  return { ...body, inferenceSha256: canonicalJsonSha256(body) };
}

export function parseMethodologyInferenceArtifactV2(value: unknown, source = "methodology inference artifact v2"): MethodologyInferenceArtifactV2 {
  const root = exactObject(value, ["schemaVersion", "protocol", "runId", "planSha256", "r2TruthBindingSha256", "baseInference", "metrics", "severeRegressionSurface", "status", "blockers", "claims", "inferenceSha256"], source);
  if (root.schemaVersion !== 2 || root.protocol !== METHODOLOGY_INFERENCE_V2_PROTOCOL) throw new Error(`${source} protocol/version is invalid`);
  const base = parseMethodologyInferenceArtifact(root.baseInference, `${source}.baseInference`);
  if (root.runId !== base.runId || typeof root.runId !== "string" || !RUN_ID.test(root.runId)) throw new Error(`${source}.runId is invalid`);
  digest(root.planSha256, `${source}.planSha256`);
  digest(root.r2TruthBindingSha256, `${source}.r2TruthBindingSha256`);
  const parsedMetrics = root.metrics as MethodologyInferenceArtifact["metrics"];
  for (const [name, metric] of Object.entries(parsedMetrics ?? {})) {
    if (!metric || typeof metric !== "object" || metric.pointEstimate !== null && !Number.isFinite(metric.pointEstimate) || metric.interval95 !== null && (!Number.isFinite(metric.interval95?.lower) || !Number.isFinite(metric.interval95?.upper) || metric.interval95.lower > metric.interval95.upper) || !Number.isSafeInteger(metric.eligibleCaseCount) || metric.eligibleCaseCount < 0 || !Number.isSafeInteger(metric.eligibleIndependentComponentCount) || metric.eligibleIndependentComponentCount < 0 || !["none", "unresolved-adjudications", "insufficient-independent-components", "no-eligible-cases", "no-usable-paired-time"].includes(metric.reason) || (metric.reason === "none") !== (metric.pointEstimate !== null && metric.interval95 !== null)) throw new Error(`${source}.metrics.${name} is invalid`);
  }
  if (Object.keys(parsedMetrics ?? {}).sort().join(",") !== "completionRateDifference,pairedWallTimeRatio,registeredKnownRootRecallDifference,unsupportedRootsPerScheduledReviewDifference") throw new Error(`${source}.metrics shape is invalid`);
  const severe = exactObject(root.severeRegressionSurface, ["status", "interpretation", "roots", "formalRegressions", "reason"], `${source}.severeRegressionSurface`);
  if (severe.status !== "defined" || (severe.interpretation !== "descriptive-two-repeat-only" && severe.interpretation !== "exploratory-three-repeat-only") || severe.formalRegressions !== null || severe.reason !== "confirmation-only-threshold-not-applicable" || !Array.isArray(severe.roots)) throw new Error(`${source}.severeRegressionSurface is invalid`);
  const severeRoots = severe.roots.map((value, index) => {
    const item = exactObject(value, ["caseName", "rootCause", "expectedSeverity", "controlDetectedAttempts", "treatmentDetectedAttempts", "scheduledAttemptsPerArm", "formalRegression"], `${source}.severeRegressionSurface.roots[${index}]`);
    const expectedRepeats = severe.interpretation === "descriptive-two-repeat-only" ? 2 : 3;
    if (typeof item.caseName !== "string" || !CASE_NAME.test(item.caseName) || typeof item.rootCause !== "string" || item.rootCause.length === 0 || item.expectedSeverity !== "high" || item.formalRegression !== null || item.scheduledAttemptsPerArm !== expectedRepeats || !Number.isSafeInteger(item.controlDetectedAttempts) || !Number.isSafeInteger(item.treatmentDetectedAttempts) || Number(item.controlDetectedAttempts) < 0 || Number(item.treatmentDetectedAttempts) < 0 || Number(item.controlDetectedAttempts) > expectedRepeats || Number(item.treatmentDetectedAttempts) > expectedRepeats) throw new Error(`${source}.severeRegressionSurface.roots[${index}] is invalid`);
    return item;
  });
  const severeKeys = severeRoots.map((item) => `${item.caseName}\0${item.rootCause}`);
  if (new Set(severeKeys).size !== severeKeys.length || canonicalJson(severeKeys) !== canonicalJson([...severeKeys].sort())) throw new Error(`${source}.severeRegressionSurface.roots are not canonical`);
  const expectedBlockers = Object.entries(parsedMetrics).filter(([, metric]) => metric.reason !== "none").map(([name, metric]) => `${name}: ${metric.reason}`);
  if (!Array.isArray(root.blockers) || canonicalJson(root.blockers) !== canonicalJson(expectedBlockers) || (root.status !== "defined" && root.status !== "blocked") || (root.status === "defined") !== (root.blockers.length === 0)) throw new Error(`${source}.status is invalid`);
  const claims = exactObject(root.claims, ["duplicateFamilyBinding", "rootSeverityBinding", "providerIdentity", "efficacy"], `${source}.claims`);
  if (claims.duplicateFamilyBinding !== "authenticated-r2-truth-binding" || claims.rootSeverityBinding !== "authenticated-r2-truth-binding" || claims.providerIdentity !== "not-established-by-inference" || claims.efficacy !== "not-decided-by-inference") throw new Error(`${source}.claims are invalid`);
  const body = { ...root } as Record<string, unknown>;
  delete body.inferenceSha256;
  if (root.inferenceSha256 !== canonicalJsonSha256(body)) throw new Error(`${source}.inferenceSha256 is invalid`);
  return value as MethodologyInferenceArtifactV2;
}
