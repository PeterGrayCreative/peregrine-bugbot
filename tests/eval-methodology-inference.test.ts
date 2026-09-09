import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildMethodologyInferenceArtifact,
  buildMethodologyInferencePlan,
  parseMethodologyInferenceArtifact,
  parseMethodologyInferencePlan,
} from "../eval/methodology-inference.js";
import {
  buildMethodologyInferenceArtifactV2,
  buildMethodologyInferencePlanV2,
  parseMethodologyInferenceArtifactV2,
} from "../eval/methodology-inference-plan-v2.js";
import type { R2TruthBindingArtifact } from "../eval/methodology-r2-truth-binding.js";
import {
  METHODOLOGY_INFERENCE_V2_SOURCE_PATHS,
  parseMethodologyInferenceSealV2,
} from "../eval/methodology-inference-seal-v2.js";
import { canonicalJsonSha256 } from "../eval/experiment.js";
import { buildMethodologyAdjudicationLedger, type MethodologyAdjudicationClassification } from "../eval/methodology-adjudication.js";
import { deriveMethodologyEffectiveAdjudication } from "../eval/methodology-adjudication-resolution.js";
import { writeMethodologyGradeSet } from "../eval/methodology-analysis-artifacts.js";
import { methodologyAttemptGradeSha256, methodologyFindingEvidenceSha256, methodologyReviewOutputSha256, methodologyComparisonId, gradeMethodologyAttempt, type MethodologyGradingProjection } from "../eval/methodology-grading-contract.js";
import { buildMethodologyResourceSet, readMethodologyResourceSet } from "../eval/methodology-resource-artifact.js";
import { buildMethodologySchedule, methodologyArmConfigIdentitySha256, type MethodologyDesign } from "../eval/methodology-schedule.js";
import { buildMethodologyUnmatchedRootLedger } from "../eval/methodology-unmatched-root-ledger.js";
import { historicalPermittedMetrics, parseHistoricalGroundTruth, type HistoricalGroundTruth } from "../eval/historical-truth.js";
import { historicalTruthScopeSha256 } from "../eval/historical-curation.js";
import { writeExclusiveJson } from "../eval/experiment.js";
import {
  cleanupMethodologySealedAnalysisFixture,
  createMethodologySealedAnalysisFixture,
} from "./helpers/methodology-sealed-analysis-fixture.js";

const sha = (letter: string) => letter.repeat(64);
const clusters = [
  { caseName: "development/case-aaaaaaaa", repositoryFamilySha256: sha("a"), duplicateFamilySha256: sha("b") },
  { caseName: "development/case-bbbbbbbb", repositoryFamilySha256: sha("c"), duplicateFamilySha256: sha("b") },
  { caseName: "development/case-cccccccc", repositoryFamilySha256: sha("c"), duplicateFamilySha256: sha("d") },
];

function plan(overrides: Partial<Parameters<typeof buildMethodologyInferencePlan>[0]> = {}) {
  return buildMethodologyInferencePlan({
    runId: "inference-test-run",
    scheduleSha256: sha("e"),
    analysisStage: "development-screen",
    hypothesis: "detection",
    bootstrapSamples: 101,
    bootstrapSeed: 22,
    minIndependentClusters: 2,
    caseClusters: clusters,
    ...overrides,
  });
}

test("plan derives transitive maximal components and is order-independent", () => {
  const first = plan();
  const reordered = plan({ caseClusters: [...clusters].reverse() });
  assert.deepEqual(first.components, reordered.components);
  assert.equal(first.components.length, 1);
  assert.equal(first.components[0]!.caseNames.length, 3);
  assert.equal(first.componentsSha256, reordered.componentsSha256);
  assert.equal(first.planSha256, reordered.planSha256);
  assert.deepEqual(parseMethodologyInferencePlan(first), first);
});

test("plan rejects malformed, duplicate, and unbounded inputs", () => {
  assert.throws(() => plan({ bootstrapSamples: 0 }), /bootstrapSamples/);
  assert.throws(() => plan({ bootstrapSeed: 0x1_0000_0000 }), /bootstrapSeed/);
  assert.throws(() => plan({ minIndependentClusters: 1 }), /minIndependentClusters/);
  assert.throws(() => plan({ caseClusters: [{ ...clusters[0]!, repositoryFamilySha256: "not-a-digest" }] }), /repositoryFamilySha256/);
  assert.throws(() => plan({ caseClusters: [clusters[0]!, clusters[0]!] }), /duplicate/);
  assert.throws(() => parseMethodologyInferencePlan({ ...plan(), bootstrapSamples: 1, unexpected: true }), /shape/);
});

test("artifact rebuilds contrasts without caller metrics and blocks one-component intervals", async () => {
  const fixture = await createMethodologySealedAnalysisFixture({ runId: "inference-artifact-fixture" });
  try {
    const rawResource = JSON.parse(readFileSync(`${fixture.analysisRoot}/methodology-resource-set.json`, "utf8")) as { artifactSha256: string };
    const resourceSet = readMethodologyResourceSet(fixture.analysisRoot, {
      expectedArtifactSha256: rawResource.artifactSha256,
      schedule: fixture.schedule,
    });
    const caseName = fixture.schedule.cases[0]!.caseName;
    const inferencePlan = buildMethodologyInferencePlan({
      runId: fixture.schedule.design.callerConfig.model === "gpt-5.6-sol" ? "inference-artifact-fixture" : "wrong",
      schedule: fixture.schedule,
      analysisStage: "development-screen",
      hypothesis: "detection",
      bootstrapSamples: 100,
      bootstrapSeed: 7,
      minIndependentClusters: 2,
      caseClusters: [{ caseName, repositoryFamilySha256: sha("a"), duplicateFamilySha256: sha("b") }],
    });
    const effectiveAdjudication = deriveMethodologyEffectiveAdjudication(fixture.adjudication, [], fixture.legacy);
    const artifact = buildMethodologyInferenceArtifact({
      plan: inferencePlan,
      schedule: fixture.schedule,
      gradeSet: fixture.legacy,
      adjudication: fixture.adjudication,
      effectiveAdjudication,
      unmatchedRootLedger: rootLedgerFor(fixture.schedule, fixture.legacy, fixture.adjudication, effectiveAdjudication),
      resourceSet,
      // Deliberately not part of the API: this value cannot affect derived metrics.
      metrics: { completionRateDifference: 999 },
    } as never);
    assert.equal(artifact.status, "blocked");
    assert.equal(artifact.metrics.completionRateDifference.eligibleCaseCount, 1);
    assert.equal(artifact.metrics.completionRateDifference.eligibleIndependentComponentCount, 1);
    assert.equal(artifact.metrics.completionRateDifference.interval95, null);
    assert.match(artifact.blockers.join(" "), /independent component/);
    const { inferenceSha256, ...inferenceBody } = artifact;
    assert.equal(inferenceSha256, canonicalJsonSha256(inferenceBody), "digest is content addressed");
    assert.deepEqual(parseMethodologyInferenceArtifact(artifact), artifact);
  } finally {
    cleanupMethodologySealedAnalysisFixture(fixture);
  }
});

test("multi-component point estimates are deterministic while intervals fail closed", () => {
  const first = syntheticInputs(1);
  const repeated = syntheticInputs(2);
  try {
    const one = buildInference(first, 31);
    const two = buildInference(repeated, 31);
    assert.equal(one.status, "blocked");
    assert.match(one.blockers.join(" "), /duplicate-family.*authenticated curation\/input artifact/);
    assert.match(one.blockers.join(" "), /severe baseline-found\/treatment-missed root surface/);
    assert.equal(one.decisionSurfaces.repeatReliability.status, "defined");
    assert.equal(one.decisionSurfaces.completionOutcomeCategories.status, "defined");
    assert.equal(one.decisionSurfaces.reviewResources.limits.totalDeadlineMs, 60_000);
    assert.equal(one.decisionSurfaces.severeBaselineFoundTreatmentMissedRoots.status, "unknown");
    assert.equal(one.decisionSurfaces.completionOutcomeCategories.byArm.A.unavailable.malformed, "unavailable");
    assert.equal(one.decisionSurfaces.completionOutcomeCategories.byArm.A.unavailable["tool-unavailable"], "unavailable");
    assert.equal(one.decisionSurfaces.completionOutcomeCategories.byArm.A.unavailable["incomplete-scope"], "unavailable");
    for (const metric of Object.values(one.metrics)) {
      assert.equal(metric.interval95, null);
      assert.equal(metric.reason, "unauthenticated-duplicate-families");
    }
    assert.equal(one.metrics.completionRateDifference.eligibleCaseCount, 4);
    assert.equal(one.metrics.completionRateDifference.eligibleIndependentComponentCount, 4);
    assert.equal(two.metrics.completionRateDifference.eligibleCaseCount, 4);
    assert.equal(two.metrics.completionRateDifference.eligibleIndependentComponentCount, 4);
    assert.deepEqual(buildInference(first, 31), one);
    const changedSeed = buildInference(first, 97);
    assert.equal(changedSeed.metrics.pairedWallTimeRatio.interval95, null);
    assert.equal(one.metrics.pairedWallTimeRatio.interval95, null);
    assert.notEqual(changedSeed.inferenceSha256, one.inferenceSha256);
  } finally {
    first.cleanup();
    repeated.cleanup();
  }
});

test("component point estimates reweight unequal component sizes to the case-balanced statistic", () => {
  const data = syntheticInputs(1);
  try {
    const unequalPlan = buildMethodologyInferencePlan({
      runId: data.runId,
      schedule: data.schedule,
      analysisStage: "development-screen",
      hypothesis: "efficiency",
      bootstrapSamples: 101,
      bootstrapSeed: 13,
      minIndependentClusters: 2,
      caseClusters: data.schedule.cases.map((item, index) => ({
        caseName: item.caseName,
        // Three cases share a family; the fourth is independent.
        repositoryFamilySha256: sha(index < 3 ? "a" : "c"),
        duplicateFamilySha256: sha(index < 3 ? "b" : "d"),
      })),
    });
    const artifact = buildMethodologyInferenceArtifact({ plan: unequalPlan, ...data });
    // Ratios are [1, 2, 3] in the three-case component and 4 in the singleton.
    // A component-reweighted median is median(2, 4) = 3, rather than the
    // unweighted case median 2.5 that the old bootstrap silently used.
    assert.equal(artifact.metrics.pairedWallTimeRatio.pointEstimate, 3);
    assert.equal(artifact.metrics.pairedWallTimeRatio.interval95, null);
    assert.equal(artifact.metrics.pairedWallTimeRatio.reason, "unauthenticated-duplicate-families");
  } finally {
    data.cleanup();
  }
});

test("effective component shortage is metric-specific and missing wall time stays unavailable", () => {
  const data = syntheticInputs(1, { includeComparison: true });
  try {
    const planValue = buildMethodologyInferencePlan({
      runId: data.runId,
      schedule: data.schedule,
      analysisStage: "selection",
      hypothesis: "efficiency",
      bootstrapSamples: 101,
      bootstrapSeed: 3,
      minIndependentClusters: 2,
      caseClusters: data.schedule.cases.map((item, index) => ({
        caseName: item.caseName,
        repositoryFamilySha256: sha(familyHex(index, "a")),
        duplicateFamilySha256: sha(familyHex(index, "b")),
      })),
    });
    const artifact = buildMethodologyInferenceArtifact({ plan: planValue, ...data });
    assert.equal(artifact.status, "blocked");
    assert.equal(artifact.metrics.registeredKnownRootRecallDifference.reason, "insufficient-independent-components");
    assert.equal(artifact.metrics.registeredKnownRootRecallDifference.eligibleIndependentComponentCount, 1);
    assert.equal(artifact.metrics.completionRateDifference.interval95, null);
    assert.equal(artifact.metrics.completionRateDifference.reason, "unauthenticated-duplicate-families");
    assert.deepEqual(artifact.claims, {
      unsupportedNoise: "curator-grouped-root-identities",
      providerIdentity: "not-established-by-inference",
      efficacy: "not-decided-by-inference",
    });
    const missing = buildMethodologyResourceSet({
      runId: data.runId,
      schedule: data.schedule,
      executionEvidenceSha256: data.executionEvidenceSha256,
      invocationRegistrationSha256: sha("3"),
      inputPlanSha256: data.inputPlanSha256,
      resources: data.resourceSet.resources.map((resource) => ({ ...resource, wallDurationMs: null })),
      recordedAt: "2026-09-08T00:00:00.000Z",
    });
    const noTime = buildMethodologyInferenceArtifact({ plan: planValue, ...data, resourceSet: missing });
    assert.equal(noTime.metrics.pairedWallTimeRatio.pointEstimate, null);
    assert.equal(noTime.metrics.pairedWallTimeRatio.interval95, null);
    assert.equal(noTime.metrics.pairedWallTimeRatio.reason, "no-usable-paired-time");
  } finally {
    data.cleanup();
  }
});

test("unsupported noise counts one grouped root per review instead of duplicate finding occurrences", () => {
  const data = syntheticInputs(1, { includeComparison: true, duplicateComparisonFindingInTreatment: true });
  try {
    const artifact = buildMethodologyInferenceArtifact({ plan: planForData(data), ...data });
    assert.equal(artifact.metrics.unsupportedRootsPerScheduledReviewDifference.pointEstimate, 0);
    const comparisonRoot = data.unmatchedRootLedger.roots.find((root) =>
      root.caseName === "validation/case-bbbbbbbb")!;
    assert.equal(comparisonRoot.occurrences.length, 5);
    assert.equal(new Set(comparisonRoot.occurrences.map((item) => item.attemptId)).size, 4);
  } finally {
    data.cleanup();
  }
});

test("comparison unsupported-root rates retain one grouped root for every repeated attempt", () => {
  const data = syntheticInputs(2, {
    includeComparison: true,
    duplicateComparisonFindingInTreatment: true,
    comparisonUnsupportedArms: ["D"],
  });
  try {
    const surface = buildMethodologyInferenceArtifact({ plan: planForData(data), ...data })
      .decisionSurfaces.comparisonUnsupportedRootRateCases;
    assert.deepEqual(surface.cases, [{
      caseName: "validation/case-bbbbbbbb",
      controlRootCount: 0,
      treatmentRootCount: 2,
    }]);
    assert.equal(surface.controlRate, 0);
    assert.equal(surface.treatmentRate, 1);
    assert.equal(surface.difference, 1);
    assert.equal(surface.controlCaseProportion, 0);
    assert.equal(surface.treatmentCaseProportion, 1);
    assert.equal(surface.caseProportionDifference, 1);
  } finally {
    data.cleanup();
  }
});

test("parser permits root-rate values above one when an attempt has multiple grouped roots", () => {
  const data = syntheticInputs(1, { includeComparison: true });
  try {
    const artifact = buildMethodologyInferenceArtifact({ plan: planForData(data), ...data });
    const { inferenceSha256: _digest, ...body } = artifact;
    const forged = {
      ...body,
      decisionSurfaces: {
        ...body.decisionSurfaces,
        comparisonUnsupportedRootRateCases: {
          ...body.decisionSurfaces.comparisonUnsupportedRootRateCases,
          controlRate: 2,
        },
      },
    };
    const parsed = parseMethodologyInferenceArtifact({
      ...forged,
      inferenceSha256: canonicalJsonSha256(forged),
    });
    assert.equal(parsed.decisionSurfaces.comparisonUnsupportedRootRateCases.controlRate, 2);
  } finally {
    data.cleanup();
  }
});

test("discovery rates distinguish finding occurrences from unique roots", () => {
  const data = syntheticInputs(1, { adjudication: "confirmed-new", includeComparison: true, duplicateComparisonFindingInTreatment: true });
  try {
    const discovery = buildMethodologyInferenceArtifact({ plan: planForData(data), ...data })
      .decisionSurfaces.confirmedDiscovery.byArm.D;
    assert.equal(discovery.occurrences, 2);
    assert.equal(discovery.roots, 1);
    assert.equal(discovery.occurrencesPerScheduledReview, 1);
    assert.equal(discovery.uniqueRootsPerScheduledReview, 0.5);
  } finally {
    data.cleanup();
  }
});

test("unresolved findings block every interval and parser rejects tampered shapes", () => {
  const data = syntheticInputs(1, { adjudication: "unresolved" });
  try {
    const planValue = planForData(data);
    const artifact = buildMethodologyInferenceArtifact({ plan: planValue, ...data });
    assert.equal(artifact.status, "blocked");
    for (const metric of Object.values(artifact.metrics)) assert.equal(metric.interval95, null);
    assert.throws(() => parseMethodologyInferenceArtifact({ ...artifact, counts: { ...artifact.counts, caseCount: 999 } }), /digest|count|inference/i);
    assert.throws(() => parseMethodologyInferenceArtifact({ ...artifact, metrics: { ...artifact.metrics, completionRateDifference: { ...artifact.metrics.completionRateDifference, eligibleCaseCount: -1 } } }), /digest|integer|metric|inference/i);
  } finally {
    data.cleanup();
  }
});

test("parser rejects a defined artifact with any unavailable required metric", () => {
  const data = syntheticInputs(1);
  try {
    const artifact = buildMethodologyInferenceArtifact({ plan: planForData(data), ...data });
    const { inferenceSha256: _digest, ...body } = artifact;
    const forged = {
      ...body,
      status: "defined" as const,
      blockers: [],
      metrics: {
        ...body.metrics,
        completionRateDifference: {
          ...body.metrics.completionRateDifference,
          pointEstimate: null,
          interval95: null,
          reason: "no-eligible-cases" as const,
        },
      },
    };
    assert.throws(() => parseMethodologyInferenceArtifact({
      ...forged,
      inferenceSha256: canonicalJsonSha256(forged),
    }), /defined artifact requires every metric|missing the unauthenticated duplicate-family blocker/);

    const intervalForged = {
      ...body,
      metrics: {
        ...body.metrics,
        completionRateDifference: {
          ...body.metrics.completionRateDifference,
          pointEstimate: 0,
          interval95: { lower: -1, upper: 1 },
          reason: "none" as const,
        },
      },
    };
    assert.throws(() => parseMethodologyInferenceArtifact({
      ...intervalForged,
      inferenceSha256: canonicalJsonSha256(intervalForged),
    }), /intervals require an authenticated duplicate-family/);
  } finally {
    data.cleanup();
  }
});

test("registered-root inference rejects an authenticated grade with ineligible truth", () => {
  const data = syntheticInputs(1);
  const replacementRoot = mkdtempSync(join(tmpdir(), "methodology-inference-eligibility-test-"));
  try {
    const grades = data.gradeSet.grades.map((grade, index) => {
      if (index !== 0) return grade;
      const { gradeSha256: _oldDigest, ...body } = grade;
      const selection = body.metricEligibility.selections.find((item) =>
        item.metric === "registered-known-root-recall")!;
      const changed = {
        ...body,
        metricEligibility: {
          ...body.metricEligibility,
          selections: body.metricEligibility.selections.map((item) => item === selection ? {
            ...item,
            disposition: "excluded" as const,
            denominator: null,
            reason: "reviewed-comparison-has-no-registered-roots" as const,
          } : item),
        },
      };
      return { ...changed, gradeSha256: methodologyAttemptGradeSha256(changed) };
    });
    const gradeSet = writeMethodologyGradeSet(replacementRoot, {
      runId: data.runId,
      schedule: data.schedule,
      executionEvidenceSha256: data.executionEvidenceSha256,
      inputPlanSha256: data.inputPlanSha256,
      grades,
      recordedAt: "2026-09-08T00:00:01.000Z",
    });
    const adjudication = buildMethodologyAdjudicationLedger({
      runId: data.runId,
      executionEvidenceSha256: data.executionEvidenceSha256,
      inputPlanSha256: data.inputPlanSha256,
      expectedAttemptIds: data.schedule.attempts.map((attempt) => attempt.id),
      grades,
      curatorIdentitySha256: sha("7"),
      reviewProtocol: "blind-to-arm-route-timing-v1",
      records: data.adjudication.records,
      recordedAt: "2026-09-08T00:00:01.000Z",
    });
    const effectiveAdjudication = deriveMethodologyEffectiveAdjudication(adjudication, [], gradeSet);
    assert.throws(() => buildMethodologyInferenceArtifact({
      plan: planForData(data),
      schedule: data.schedule,
      gradeSet,
      adjudication,
      effectiveAdjudication,
      unmatchedRootLedger: rootLedgerFor(data.schedule, gradeSet, adjudication, effectiveAdjudication),
      resourceSet: data.resourceSet,
    }), /registered-root eligibility/i);
  } finally {
    data.cleanup();
    rmSync(replacementRoot, { recursive: true, force: true });
  }
});

test("R2-bound inference v2 produces authenticated intervals and descriptive severe-root counts", () => {
  const data = syntheticInputs(2, { r2Shape: true });
  try {
    const binding = r2BindingFor(data);
    const plan = buildMethodologyInferencePlanV2({
      runId: data.runId,
      schedule: data.schedule,
      invocationRegistrationSha256: data.resourceSet.invocationRegistrationSha256,
      inputPlanSha256: data.inputPlanSha256,
      truthBinding: binding,
      analysisStage: "development-screen",
      hypothesis: "detection",
      bootstrapSamples: 101,
      bootstrapSeed: 77,
      minIndependentClusters: 2,
    });
    const artifact = buildMethodologyInferenceArtifactV2({ plan, truthBinding: binding, ...data });
    assert.equal(artifact.status, "defined");
    assert.deepEqual(artifact.blockers, []);
    for (const metric of Object.values(artifact.metrics)) {
      assert.equal(metric.reason, "none");
      assert.notEqual(metric.interval95, null);
    }
    assert.equal(artifact.severeRegressionSurface.interpretation, "descriptive-two-repeat-only");
    assert.equal(artifact.severeRegressionSurface.formalRegressions, null);
    assert.equal(artifact.severeRegressionSurface.roots.length, 8);
    assert.ok(artifact.severeRegressionSurface.roots.every((root) => root.scheduledAttemptsPerArm === 2 && root.formalRegression === null));
    assert.equal(artifact.claims.duplicateFamilyBinding, "authenticated-r2-truth-binding");
    assert.deepEqual(parseMethodologyInferenceArtifactV2(artifact), artifact);

    const inferenceSource = METHODOLOGY_INFERENCE_V2_SOURCE_PATHS.map((path, index) => ({
      path,
      bytes: index + 1,
      sha256: sha(((index + 1) % 10).toString()),
    }));
    const sealBody = {
      schemaVersion: 2 as const,
      protocol: "historical-methodology-inference-seal-v2" as const,
      version: 1,
      previousSealSha256: null,
      runId: data.runId,
      inferencePlanSha256: plan.planSha256,
      r2TruthBindingSha256: binding.bindingSha256,
      r2PartitionArtifactSha256: binding.partitionArtifactSha256,
      sealedAnalysisBindingSha256: sha("1"),
      baseAnalysisBindingSha256: sha("2"),
      effectiveAdjudicationSha256: sha("3"),
      adjudicationResolutionHeadSha256: null,
      unmatchedRootLedgerSha256: sha("4"),
      inference: artifact,
      inferenceSource,
      inferenceSourceTreeSha256: canonicalJsonSha256(inferenceSource),
      sealedAt: "2026-09-09T12:00:00.000Z",
      claims: {
        sourceClosure: "fixed-explicit-source-list" as const,
        duplicateFamilyBinding: "authenticated-r2-truth-binding" as const,
        rootSeverityBinding: "authenticated-r2-truth-binding" as const,
        reviewerAnswerExposure: "none-from-operator-binding" as const,
        providerIdentity: "inherited-not-established" as const,
        efficacy: "not-decided" as const,
      },
    };
    const seal = { ...sealBody, sealSha256: canonicalJsonSha256(sealBody) };
    assert.deepEqual(parseMethodologyInferenceSealV2(seal), seal);
    assert.throws(() => parseMethodologyInferenceSealV2({ ...seal, version: 2 }), /sealSha256/);

    const wrongBinding = structuredClone(binding);
    wrongBinding.cases[0]!.canonicalTruthSha256 = sha("f");
    const { bindingSha256: _oldBindingSha256, ...wrongBody } = wrongBinding;
    wrongBinding.bindingSha256 = canonicalJsonSha256(wrongBody);
    assert.throws(() => buildMethodologyInferenceArtifactV2({ plan, truthBinding: wrongBinding, ...data }), /plan differs|truth binding|grade/i);
  } finally { data.cleanup(); }
});

interface SyntheticData {
  runId: string;
  schedule: ReturnType<typeof buildMethodologySchedule>;
  gradeSet: ReturnType<typeof writeMethodologyGradeSet>;
  adjudication: ReturnType<typeof buildMethodologyAdjudicationLedger>;
  effectiveAdjudication: ReturnType<typeof deriveMethodologyEffectiveAdjudication>;
  unmatchedRootLedger: ReturnType<typeof buildMethodologyUnmatchedRootLedger>;
  resourceSet: ReturnType<typeof buildMethodologyResourceSet>;
  executionEvidenceSha256: string;
  inputPlanSha256: string;
  root: string;
  cleanup: () => void;
}

function buildInference(data: SyntheticData, seed: number) {
  const planValue = planForData(data, seed);
  return buildMethodologyInferenceArtifact({ plan: planValue, ...data });
}

function planForData(data: SyntheticData, seed = 31) {
  return buildMethodologyInferencePlan({
    runId: data.runId,
    schedule: data.schedule,
    analysisStage: "development-screen",
    hypothesis: "detection",
    bootstrapSamples: 7,
    bootstrapSeed: seed,
    minIndependentClusters: 2,
    caseClusters: data.schedule.cases.map((item, index) => ({
      caseName: item.caseName,
      repositoryFamilySha256: sha(familyHex(index, "a")),
      duplicateFamilySha256: sha(familyHex(index, "b")),
    })),
  });
}

function syntheticInputs(repeats: number, options: { includeComparison?: boolean; r2Shape?: boolean; adjudication?: MethodologyAdjudicationClassification; duplicateComparisonFindingInTreatment?: boolean; comparisonUnsupportedArms?: readonly ("C" | "D")[] } = {}): SyntheticData {
  const runId = `synthetic-inference-${repeats}-${options.r2Shape ? "r2" : options.includeComparison ? "comparison" : "bug"}`;
  const executionEvidenceSha256 = sha("e");
  const inputPlanSha256 = sha("f");
  const base: Omit<MethodologyDesign, "arms"> = {
    schemaVersion: 1,
    protocol: "historical-methodology-v1",
    seed: 23,
    repeats,
    callerConfig: { runner: "codex", model: "gpt-5.6-sol", effort: "high", identitySha256: sha("1") },
    totalDeadlineMs: 60_000,
    twoWorkerStageSplit: { discoveryDeadlineMs: 20_000, reviewerDeadlineMs: 40_000 },
  };
  const design: MethodologyDesign = {
    ...base,
    arms: (['A', 'B', 'C', 'D'] as const).map((armId) => {
      const configName = `arm-${armId.toLowerCase()}`;
      return { armId, configName, configIdentitySha256: methodologyArmConfigIdentitySha256({ design: base, armId, configName }) };
    }),
  };
  const cases = options.r2Shape
    ? Array.from({ length: 12 }, (_, index) => ({
      caseName: `development/case-${(index + 1).toString(16).padStart(8, "0")}`,
      corpus: "development" as const,
      expectedBugCount: (index + 1) % 3 === 0 ? null : 1,
    }))
    : options.includeComparison
    ? [
      { caseName: "development/case-aaaaaaaa", corpus: "development" as const, expectedBugCount: 1 },
      { caseName: "validation/case-bbbbbbbb", corpus: "validation" as const, expectedBugCount: null },
    ]
    : ["aaaaaaaa", "bbbbbbbb", "cccccccc", "dddddddd"].map((id) => ({
      caseName: `development/case-${id}`, corpus: "development" as const, expectedBugCount: 1,
    }));
  const schedule = buildMethodologySchedule({ design, cases });
  const truths = new Map(cases.map((item, index) => [item.caseName, truthFor(item, index)]));
  const grades = schedule.attempts.map((attempt) => {
    const truth = truths.get(attempt.caseName)!;
    const isBug = truth.bugs.length > 0;
    const finding = { file: "src/worker.ts", startLine: 1, endLine: 2, explanation: "A callback is dropped.", impact: "The request remains pending.", severity: "high" as const };
    const comparisonFindingCount = options.comparisonUnsupportedArms !== undefined
      ? (options.comparisonUnsupportedArms.includes(attempt.armId as "C" | "D")
        ? (options.duplicateComparisonFindingInTreatment && attempt.armId === "D" ? 2 : 1)
        : 0)
      : options.duplicateComparisonFindingInTreatment
        ? (attempt.armId === "D" ? 2 : 1)
        : 0;
    const review = { status: "completed" as const, limitations: [], findings: isBug ? [finding] : Array.from({ length: comparisonFindingCount }, () => finding) };
    const projection: MethodologyGradingProjection = { schemaVersion: 2, kind: "methodology-grading-projection", executionEvidenceSha256, inputPlanSha256, caseRegistrationSha256: sha("2"), caseName: attempt.caseName, attemptId: attempt.id, truthSha256: canonicalJsonSha256(truth), truthScopeSha256: historicalTruthScopeSha256(truth), status: "completed", statusReason: "authenticated-complete", lifecycleTerminalSha256: sha("3"), reviewTerminalSha256: sha("4"), reviewRawOutputSha256: sha("5"), reviewOutputSha256: methodologyReviewOutputSha256(review) };
    const matched = attempt.armId === "D" || (attempt.armId === "C" && cases.findIndex((item) => item.caseName === attempt.caseName) % 2 === 0);
    const pairVerdicts = isBug ? [{ comparisonId: methodologyComparisonId({ bug: truth.bugs[0]!, finding, judgeConfigSha256: sha("6") }), bugId: truth.bugs[0]!.id, findingIndex: 0, findingEvidenceSha256: methodologyFindingEvidenceSha256(finding), verdict: matched ? "same-root-cause" as const : "different-root-cause" as const }] : [];
    return gradeMethodologyAttempt({ projection, expectedProjectionSha256: canonicalJsonSha256(projection), truth, reviewOutput: review, judgeConfigSha256: sha("6"), pairVerdicts });
  });
  const root = mkdtempSync(join(tmpdir(), "methodology-inference-test-"));
  const gradeSet = writeMethodologyGradeSet(root, { runId, schedule, executionEvidenceSha256, inputPlanSha256, grades, recordedAt: "2026-09-08T00:00:00.000Z" });
  const adjudication = buildMethodologyAdjudicationLedger({ runId, executionEvidenceSha256, inputPlanSha256, expectedAttemptIds: schedule.attempts.map((attempt) => attempt.id), grades, curatorIdentitySha256: sha("7"), reviewProtocol: "blind-to-arm-route-timing-v1", records: grades.flatMap((grade) => grade.unmatchedFindings.map((finding) => ({ attemptId: grade.projection.attemptId, findingIndex: finding.findingIndex, findingEvidenceSha256: finding.findingEvidenceSha256, classification: options.adjudication ?? "unsupported", rationale: "Synthetic decision.", evidence: "Synthetic evidence." }))), recordedAt: "2026-09-08T00:00:00.000Z" });
  const effectiveAdjudication = deriveMethodologyEffectiveAdjudication(adjudication, [], gradeSet);
  const unmatchedRootLedger = rootLedgerFor(schedule, gradeSet, adjudication, effectiveAdjudication);
  const resourceSet = buildMethodologyResourceSet({ runId, schedule, executionEvidenceSha256, invocationRegistrationSha256: sha("8"), inputPlanSha256, resources: schedule.attempts.map((attempt) => {
    const caseIndex = cases.findIndex((item) => item.caseName === attempt.caseName);
    return { attemptId: attempt.id, caseName: attempt.caseName, armId: attempt.armId, expectedStages: attempt.expectedStages, observedStages: attempt.expectedStages, outcome: "completed" as const, wallDurationMs: attempt.armId === "D" ? (caseIndex + 1) * 100 : 100, reviewDurationMs: 10, usage: { provider: "mock" as const }, lifecycleTerminalSha256: sha("3"), reviewTerminalSha256: sha("4") };
  }), recordedAt: "2026-09-08T00:00:00.000Z" });
  writeExclusiveJson(root, join(root, "methodology-adjudication.json"), adjudication);
  writeExclusiveJson(root, join(root, "methodology-resource-set.json"), resourceSet);
  return { runId, schedule, gradeSet, adjudication, effectiveAdjudication, unmatchedRootLedger, resourceSet, executionEvidenceSha256, inputPlanSha256, root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function rootLedgerFor(
  schedule: ReturnType<typeof buildMethodologySchedule>,
  gradeSet: ReturnType<typeof writeMethodologyGradeSet>,
  adjudication: ReturnType<typeof buildMethodologyAdjudicationLedger>,
  effectiveAdjudication: ReturnType<typeof deriveMethodologyEffectiveAdjudication>,
) {
  const rootIdFor = (record: typeof effectiveAdjudication.records[number]) => canonicalJsonSha256({
    caseName: schedule.attempts.find((attempt) => attempt.id === record.attemptId)!.caseName,
    findingEvidenceSha256: record.findingEvidenceSha256,
    classification: record.classification,
  });
  const rootIds = [...new Set(effectiveAdjudication.records.map(rootIdFor))];
  return buildMethodologyUnmatchedRootLedger({
    runId: adjudication.runId,
    schedule,
    gradeSet,
    effectiveAdjudication,
    assignments: effectiveAdjudication.records.map((record) => ({
      attemptId: record.attemptId,
      findingIndex: record.findingIndex,
      findingEvidenceSha256: record.findingEvidenceSha256,
      rootIdentitySha256: rootIdFor(record),
    })),
    roots: rootIds.map((rootIdentitySha256) => ({
      rootIdentitySha256,
      reviewerIdentitySha256s: [sha("9")],
      reviewerIndependence: "not-attested" as const,
      source: "Synthetic curator grouping.",
      evidence: "Occurrences share exact synthetic evidence and classification.",
      rationale: "Group repeated reports of one synthetic causal root.",
    })),
    recordedAt: "2026-09-08T00:00:00.000Z",
    baseLedgerSha256: adjudication.ledgerSha256,
    effectiveAdjudicationSha256: effectiveAdjudication.effectiveSha256,
    headResolutionSha256: effectiveAdjudication.headResolutionSha256,
    gradeSetSha256: gradeSet.gradeSetSha256,
    scheduleSha256: canonicalJsonSha256(schedule),
  });
}

function familyHex(index: number, fallback: string): string {
  return ["a", "c", "e", "1", "3", "5", "7", "9"][index] ?? fallback;
}

function truthFor(item: { caseName: string; expectedBugCount: number | null }, index: number): HistoricalGroundTruth {
  return parseHistoricalGroundTruth({ schemaVersion: 2, scope: { protocol: "historical-efficacy-v1", truthVersion: "test-v1", status: item.expectedBugCount === null ? "reviewed-comparison" : "known-roots", completeness: "partial", reviewedScope: "Synthetic test case.", permittedMetrics: historicalPermittedMetrics(item.expectedBugCount === null ? "reviewed-comparison" : "known-roots") }, bugs: item.expectedBugCount === null ? [] : [{ id: `bug-${"a".repeat(7)}${String(index + 1).padStart(1, "0")}`, rootCauseGroup: `root-${"b".repeat(7)}${String(index + 1).padStart(1, "0")}`, lane: "other-unclassified", mechanismFamily: "callback-loss", proofLevel: "complete-static-trace", expectedDisposition: "fix-in-pr", expectedSeverity: "high", file: "src/worker.ts", startLine: 1, endLine: 2, description: "A callback is dropped.", reachablePreconditions: "The retry branch runs.", observableImpact: "The request remains pending.", provenance: "Synthetic fixture." }] });
}

function r2BindingFor(data: SyntheticData): R2TruthBindingArtifact {
  const development = data.schedule.cases.map((item, index) => {
    const grade = data.gradeSet.grades.find((candidate) => candidate.projection.caseName === item.caseName)!;
    const roots = Object.keys(grade.rootCauseMatches).map((rootCause) => ({ rootCause, expectedSeverity: "high" as const }));
    return {
      caseName: item.caseName,
      partition: "development" as const,
      caseClass: item.expectedBugCount === null ? "reviewed-comparison" as const : "bug-bearing" as const,
      repositoryIdentitySha256: sha(["a", "b", "c", "d"][index % 4]!),
      duplicateFamilySha256: canonicalJsonSha256(["development", index]),
      registrationSha256: grade.projection.caseRegistrationSha256,
      curationSha256: canonicalJsonSha256(["curation", index]),
      caseBundleSha256: canonicalJsonSha256(["bundle", index]),
      truthScopeSha256: grade.projection.truthScopeSha256,
      canonicalTruthSha256: grade.projection.truthSha256,
      truthVersion: grade.metricEligibility.truthVersion!,
      roots,
    };
  });
  const selection = Array.from({ length: 24 }, (_, offset) => {
    const index = offset + 12;
    const bugBearing = (offset + 1) % 3 !== 0;
    return {
      caseName: `validation/case-${(index + 1).toString(16).padStart(8, "0")}`,
      partition: "selection" as const,
      caseClass: bugBearing ? "bug-bearing" as const : "reviewed-comparison" as const,
      repositoryIdentitySha256: sha(["a", "b", "c", "d"][index % 4]!),
      duplicateFamilySha256: canonicalJsonSha256(["selection", index]),
      registrationSha256: canonicalJsonSha256(["registration", index]),
      curationSha256: canonicalJsonSha256(["curation", index]),
      caseBundleSha256: canonicalJsonSha256(["bundle", index]),
      truthScopeSha256: canonicalJsonSha256(["scope", index]),
      canonicalTruthSha256: canonicalJsonSha256(["truth", index]),
      truthVersion: "test-v1",
      roots: bugBearing ? [{ rootCause: JSON.stringify(["bug", `bug-${(index + 1).toString(16).padStart(8, "0")}`]), expectedSeverity: "high" as const }] : [],
    };
  });
  const cases = [...development, ...selection].sort((left, right) => left.caseName.localeCompare(right.caseName));
  const roots = cases.flatMap((item) => item.roots);
  const body = {
    schemaVersion: 1 as const,
    protocol: "r2-operator-truth-binding-v1" as const,
    version: 1,
    previousBindingSha256: null,
    partitionArtifactSha256: sha("8"),
    packetSha256: sha("9"),
    responseSha256: sha("a"),
    partitionAttestationSelfSha256: sha("b"),
    humanReviewerIdentitySha256: sha("c"),
    claims: { operatorOnly: true as const, reviewerVisible: false as const, truthDerived: true as const, independentVerificationClaimed: false as const },
    cases,
    counts: { cases: 36, bugBearing: 24, reviewedComparison: 12, registeredRoots: roots.length, highSeverityRoots: roots.length },
    recordedAt: "2026-09-07T18:00:00.000Z",
  };
  return { ...body, bindingSha256: canonicalJsonSha256(body) };
}
