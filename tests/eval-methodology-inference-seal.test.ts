import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalJsonSha256 } from "../eval/experiment.js";
import { buildMethodologyInferencePlan } from "../eval/methodology-inference.js";
import { readMethodologyInputPlan } from "../eval/methodology-input-plan.js";
import { readMethodologyAdjudicationResolutionChain, writeMethodologyAdjudicationResolution } from "../eval/methodology-adjudication-resolution.js";
import {
  readMethodologyInferencePlan,
  readMethodologyInferenceSeal,
  writeMethodologyInferencePlan,
  writeMethodologyInferenceSeal,
} from "../eval/methodology-inference-seal.js";
import { CONTRAST_SOURCE_PATHS } from "../eval/methodology-contrast-binding.js";
import { writeMethodologyUnmatchedRootLedger } from "../eval/methodology-unmatched-root-ledger.js";
import { writeMethodologySealedAnalysisBinding } from "../eval/methodology-sealed-analysis-binding.js";
import {
  cleanupMethodologySealedAnalysisFixture,
  createMethodologySealedAnalysisFixture,
  sealedAnalysisReadInput,
} from "./helpers/methodology-sealed-analysis-fixture.js";

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

function planFor(fixture: Awaited<ReturnType<typeof createMethodologySealedAnalysisFixture>>, runId = fixture.writeInput.runId) {
  if (runId !== fixture.writeInput.runId) {
    return buildMethodologyInferencePlan({
      runId,
      schedule: fixture.schedule,
      analysisStage: "development-screen",
      hypothesis: "detection",
      bootstrapSamples: 101,
      bootstrapSeed: 17,
      minIndependentClusters: 2,
      caseClusters: [{
        caseName: fixture.schedule.cases[0]!.caseName,
        repositoryFamilySha256: readMethodologyInputPlan(fixture.executionRoot, fixture.writeInput.projections.invocationRegistrationSha256, fixture.writeInput.projections.inputPlanSha256).cases[0]!.historicalRegistration.source.repositoryIdentitySha256,
        duplicateFamilySha256: digest("b"),
      }],
    });
  }
  return fixture.inferencePlan;
}

function bindAnalysis(fixture: Awaited<ReturnType<typeof createMethodologySealedAnalysisFixture>>) {
  return writeMethodologySealedAnalysisBinding(fixture.analysisRoot, fixture.writeInput);
}

function writeRootLedger(
  fixture: Awaited<ReturnType<typeof createMethodologySealedAnalysisFixture>>,
  expectedHeadResolutionSha256: string | null,
) {
  const resolution = readMethodologyAdjudicationResolutionChain(fixture.analysisRoot, {
    baseLedger: fixture.adjudication,
    gradeSet: fixture.legacy,
    expectedHeadResolutionSha256,
  });
  const attemptById = new Map(fixture.schedule.attempts.map((attempt) => [attempt.id, attempt]));
  const rootIdFor = (record: typeof resolution.effective.records[number]) => canonicalJsonSha256({
    caseName: attemptById.get(record.attemptId)!.caseName,
    findingEvidenceSha256: record.findingEvidenceSha256,
  });
  const rootIds = [...new Set(resolution.effective.records.map(rootIdFor))];
  return writeMethodologyUnmatchedRootLedger(fixture.analysisRoot, {
    runId: fixture.writeInput.runId,
    schedule: fixture.schedule,
    gradeSet: fixture.legacy,
    effectiveAdjudication: resolution.effective,
    assignments: resolution.effective.records.map((record) => ({
      attemptId: record.attemptId,
      findingIndex: record.findingIndex,
      findingEvidenceSha256: record.findingEvidenceSha256,
      rootIdentitySha256: rootIdFor(record),
    })),
    roots: rootIds.map((rootIdentitySha256) => ({
      rootIdentitySha256,
      reviewerIdentitySha256s: [digest("root-reviewer")],
      reviewerIndependence: "not-attested",
      source: "Synthetic curator packet.",
      evidence: "Repeated synthetic findings share evidence and classification.",
      rationale: "Group repeated occurrences of the same synthetic root.",
    })),
    recordedAt: "2026-09-08T12:05:30.000Z",
    baseLedgerSha256: fixture.adjudication.ledgerSha256,
    effectiveAdjudicationSha256: resolution.effective.effectiveSha256,
    headResolutionSha256: resolution.headResolutionSha256,
    gradeSetSha256: fixture.legacy.gradeSetSha256,
    scheduleSha256: canonicalJsonSha256(fixture.schedule),
  });
}

test("round-trips the composite inference seal with exact source, run, plan, and binding joins", async () => {
  const fixture = await createMethodologySealedAnalysisFixture({
    runId: "inference-seal-round-trip",
    judgeVerdict: false,
  });
  try {
    const plan = planFor(fixture);
    const baseBindingSha256 = fixture.writeInput.expectedBaseAnalysisBindingSha256;
    const sealedAnalysisBinding = bindAnalysis(fixture);
    const sealedAnalysis = sealedAnalysisReadInput(fixture, sealedAnalysisBinding.bindingSha256);
    const initialRoots = writeRootLedger(fixture, null);
    const initialSeal = writeMethodologyInferenceSeal(fixture.analysisRoot, {
      sealedAnalysis,
      expectedInferencePlanSha256: plan.planSha256,
      expectedAdjudicationResolutionHeadSha256: null,
      expectedUnmatchedRootLedgerSha256: initialRoots.artifactSha256,
      sealedAt: "2026-09-08T12:06:00.000Z",
      expectedPreviousSealSha256: null,
    });
    const unresolved = fixture.adjudication.records[0]!;
    const resolution = writeMethodologyAdjudicationResolution(fixture.analysisRoot, {
      baseLedger: fixture.adjudication,
      gradeSet: fixture.legacy,
      occurrence: {
        attemptId: unresolved.attemptId,
        findingIndex: unresolved.findingIndex,
        findingEvidenceSha256: unresolved.findingEvidenceSha256,
      },
      classification: "unsupported",
      curatorIdentitySha256: digest("curator"),
      reviewerIdentitySha256s: [digest("reviewer")],
      reviewerIndependence: "not-attested",
      recordedAt: "2026-09-08T12:06:30.000Z",
      rationale: "The synthetic finding does not match the registered root.",
      evidence: "The fixture judge rejected the only root/finding comparison.",
      expectedHeadResolutionSha256: null,
    });
    const roots = writeRootLedger(fixture, resolution.resolutionSha256);
    const seal = writeMethodologyInferenceSeal(fixture.analysisRoot, {
      sealedAnalysis,
      expectedInferencePlanSha256: plan.planSha256,
      expectedAdjudicationResolutionHeadSha256: resolution.resolutionSha256,
      expectedUnmatchedRootLedgerSha256: roots.artifactSha256,
      sealedAt: "2026-09-08T12:07:00.000Z",
      expectedPreviousSealSha256: initialSeal.sealSha256,
    });
    const read = readMethodologyInferenceSeal(fixture.analysisRoot, {
      sealedAnalysis,
      expectedInferencePlanSha256: plan.planSha256,
      expectedAdjudicationResolutionHeadSha256: resolution.resolutionSha256,
      expectedUnmatchedRootLedgerSha256: roots.artifactSha256,
      expectedSealSha256: seal.sealSha256,
    });

    assert.deepEqual(read, seal);
    assert.equal(initialSeal.sealVersion, 1);
    assert.equal(seal.sealVersion, 2);
    assert.equal(seal.previousSealSha256, initialSeal.sealSha256);
    assert.equal(initialRoots.roots[0]!.rootIdentitySha256, roots.roots[0]!.rootIdentitySha256);
    assert.deepEqual(readMethodologyInferenceSeal(fixture.analysisRoot, {
      sealedAnalysis,
      expectedInferencePlanSha256: plan.planSha256,
      expectedAdjudicationResolutionHeadSha256: null,
      expectedUnmatchedRootLedgerSha256: initialRoots.artifactSha256,
      expectedSealSha256: initialSeal.sealSha256,
    }), initialSeal);
    assert.equal(seal.runId, fixture.writeInput.runId);
    assert.equal(seal.inferencePlanSha256, plan.planSha256);
    assert.equal(seal.baseAnalysisBindingSha256, baseBindingSha256);
    assert.equal(seal.sealedAnalysisBindingSha256, sealedAnalysisBinding.bindingSha256);
    assert.equal(seal.adjudicationResolutionHeadSha256, resolution.resolutionSha256);
    assert.equal(seal.effectiveAdjudicationSha256, seal.inference.upstream.effectiveAdjudicationSha256);
    assert.equal(seal.unmatchedRootLedgerSha256, roots.artifactSha256);
    assert.equal(seal.inference.runId, fixture.writeInput.runId);
    assert.equal(seal.inference.planSha256, plan.planSha256);
    assert.equal(seal.inference.scheduleSha256, plan.scheduleSha256);
    assert.equal(seal.inference.componentsSha256, plan.componentsSha256);
    assert.equal(seal.inference.status, "blocked");
    assert.match(seal.inference.blockers.join(" "), /independent component/);
    assert.match(seal.inference.blockers.join(" "), /duplicate-family.*authenticated curation\/input artifact/);
    assert.equal(seal.inference.metrics.completionRateDifference.interval95, null);
    assert.deepEqual(seal.claims, {
      sourceClosure: "fixed-explicit-source-list",
      duplicateFamilyBinding: "curator-supplied-not-authenticated",
      providerIdentity: "inherited-not-established",
      efficacy: "not-decided",
    });

    const expectedSourcePaths = [...new Set([
      ...CONTRAST_SOURCE_PATHS,
      "eval/methodology-inference.ts",
      "eval/methodology-inference-seal.ts",
      "eval/methodology-adjudication-resolution.ts",
      "eval/methodology-unmatched-root-ledger.ts",
      "eval/methodology-sealed-analysis-binding.ts",
    ])].sort();
    assert.deepEqual(seal.inferenceSource.map((entry) => entry.path), expectedSourcePaths);
    assert.equal(seal.inferenceSourceTreeSha256, canonicalJsonSha256(seal.inferenceSource));

    assert.throws(
      () => writeMethodologyInferencePlan(fixture.analysisRoot, {
        executionRoot: fixture.executionRoot,
        invocationRegistrationSha256: fixture.writeInput.projections.invocationRegistrationSha256,
        inputPlanSha256: fixture.writeInput.projections.inputPlanSha256,
        runId: fixture.writeInput.runId,
        schedule: fixture.schedule,
        analysisStage: "development-screen",
        hypothesis: "detection",
        bootstrapSamples: 101,
        bootstrapSeed: 17,
        minIndependentClusters: 2,
        caseClusters: [{ caseName: fixture.schedule.cases[0]!.caseName, repositoryFamilySha256: readMethodologyInputPlan(fixture.executionRoot, fixture.writeInput.projections.invocationRegistrationSha256, fixture.writeInput.projections.inputPlanSha256).cases[0]!.historicalRegistration.source.repositoryIdentitySha256, duplicateFamilySha256: digest("b") }],
      }),
      /exist|exclusive|EEXIST/i,
    );
    assert.throws(() => writeMethodologyInferenceSeal(fixture.analysisRoot, {
      sealedAnalysis,
      expectedInferencePlanSha256: plan.planSha256,
      expectedAdjudicationResolutionHeadSha256: resolution.resolutionSha256,
      expectedUnmatchedRootLedgerSha256: roots.artifactSha256,
      sealedAt: "2026-09-08T12:08:00.000Z",
      expectedPreviousSealSha256: initialSeal.sealSha256,
    }), /predecessor.*head/i);
    assert.throws(() => writeMethodologyInferenceSeal(fixture.analysisRoot, {
      sealedAnalysis,
      expectedInferencePlanSha256: plan.planSha256,
      expectedAdjudicationResolutionHeadSha256: resolution.resolutionSha256,
      expectedUnmatchedRootLedgerSha256: roots.artifactSha256,
      sealedAt: seal.sealedAt,
      expectedPreviousSealSha256: seal.sealSha256,
    }), /timestamps must increase/i);
  } finally {
    cleanupMethodologySealedAnalysisFixture(fixture);
  }
});

test("rejects wrong caller-held plan, seal, and sealed-analysis binding digests", async () => {
  const fixture = await createMethodologySealedAnalysisFixture({ runId: "inference-seal-digest-checks" });
  try {
    const plan = planFor(fixture);
    const sealedAnalysisBinding = bindAnalysis(fixture);
    const sealedAnalysis = sealedAnalysisReadInput(fixture, sealedAnalysisBinding.bindingSha256);
    const wrong = digest("z");

    assert.throws(
      () => readMethodologyInferencePlan(fixture.analysisRoot, wrong),
      /plan digest mismatch/i,
    );
    assert.throws(
      () => writeMethodologyInferenceSeal(fixture.analysisRoot, {
        sealedAnalysis,
        expectedInferencePlanSha256: wrong,
        expectedAdjudicationResolutionHeadSha256: null,
        expectedUnmatchedRootLedgerSha256: wrong,
        sealedAt: "2026-09-08T12:06:00.000Z",
        expectedPreviousSealSha256: null,
      }),
      /plan digest mismatch/i,
    );

    const roots = writeRootLedger(fixture, null);
    const seal = writeMethodologyInferenceSeal(fixture.analysisRoot, {
      sealedAnalysis,
      expectedInferencePlanSha256: plan.planSha256,
      expectedAdjudicationResolutionHeadSha256: null,
      expectedUnmatchedRootLedgerSha256: roots.artifactSha256,
      sealedAt: "2026-09-08T12:06:00.000Z",
      expectedPreviousSealSha256: null,
    });
    assert.throws(
      () => readMethodologyInferenceSeal(fixture.analysisRoot, {
        sealedAnalysis,
        expectedInferencePlanSha256: plan.planSha256,
        expectedAdjudicationResolutionHeadSha256: null,
        expectedUnmatchedRootLedgerSha256: roots.artifactSha256,
        expectedSealSha256: wrong,
      }),
      /seal digest mismatch/i,
    );
    assert.throws(
      () => readMethodologyInferenceSeal(fixture.analysisRoot, {
        sealedAnalysis: { ...sealedAnalysis, expectedBindingSha256: wrong },
        expectedInferencePlanSha256: plan.planSha256,
        expectedAdjudicationResolutionHeadSha256: null,
        expectedUnmatchedRootLedgerSha256: roots.artifactSha256,
        expectedSealSha256: seal.sealSha256,
      }),
      /binding digest mismatch|one authenticated analysis binding/i,
    );
  } finally {
    cleanupMethodologySealedAnalysisFixture(fixture);
  }
});

test("rejects tampered stored plans and seals", async () => {
  const fixture = await createMethodologySealedAnalysisFixture({ runId: "inference-seal-tamper-checks" });
  try {
    const plan = planFor(fixture);
    const planPath = join(fixture.analysisRoot, "methodology-inference-plan.json");
    const planBytes = readFileSync(planPath);
    const tamperedPlan = JSON.parse(planBytes.toString("utf8")) as Record<string, any>;
    tamperedPlan.bootstrapSeed = 18;
    writeFileSync(planPath, `${JSON.stringify(tamperedPlan)}\n`);
    assert.throws(
      () => readMethodologyInferencePlan(fixture.analysisRoot, plan.planSha256),
      /digest|derived|plan/i,
    );
    writeFileSync(planPath, planBytes);

    const sealedAnalysisBinding = bindAnalysis(fixture);
    const sealedAnalysis = sealedAnalysisReadInput(fixture, sealedAnalysisBinding.bindingSha256);
    const roots = writeRootLedger(fixture, null);
    const seal = writeMethodologyInferenceSeal(fixture.analysisRoot, {
      sealedAnalysis,
      expectedInferencePlanSha256: plan.planSha256,
      expectedAdjudicationResolutionHeadSha256: null,
      expectedUnmatchedRootLedgerSha256: roots.artifactSha256,
      sealedAt: "2026-09-08T12:06:00.000Z",
      expectedPreviousSealSha256: null,
    });
    const sealPath = join(fixture.analysisRoot, "methodology-inference-seals", "methodology-inference-seal.v000001.json");
    const tamperedSeal = JSON.parse(readFileSync(sealPath, "utf8")) as Record<string, any>;
    tamperedSeal.inference.status = "defined";
    writeFileSync(sealPath, `${JSON.stringify(tamperedSeal)}\n`);
    assert.throws(
      () => readMethodologyInferenceSeal(fixture.analysisRoot, {
        sealedAnalysis,
        expectedInferencePlanSha256: plan.planSha256,
        expectedAdjudicationResolutionHeadSha256: null,
        expectedUnmatchedRootLedgerSha256: roots.artifactSha256,
        expectedSealSha256: seal.sealSha256,
      }),
      /digest|rederived|seal/i,
    );
  } finally {
    cleanupMethodologySealedAnalysisFixture(fixture);
  }
});

test("rejects symlinked stored plans and seals", async () => {
  const fixture = await createMethodologySealedAnalysisFixture({ runId: "inference-seal-symlink-checks" });
  try {
    const plan = planFor(fixture);
    const planPath = join(fixture.analysisRoot, "methodology-inference-plan.json");
    const planTarget = `${planPath}.real`;
    renameSync(planPath, planTarget);
    symlinkSync(planTarget, planPath);
    assert.throws(
      () => readMethodologyInferencePlan(fixture.analysisRoot, plan.planSha256),
      /regular non-symlink file|non-regular entry/i,
    );
    unlinkSync(planPath);
    renameSync(planTarget, planPath);

    const sealedAnalysisBinding = bindAnalysis(fixture);
    const sealedAnalysis = sealedAnalysisReadInput(fixture, sealedAnalysisBinding.bindingSha256);
    const roots = writeRootLedger(fixture, null);
    const seal = writeMethodologyInferenceSeal(fixture.analysisRoot, {
      sealedAnalysis,
      expectedInferencePlanSha256: plan.planSha256,
      expectedAdjudicationResolutionHeadSha256: null,
      expectedUnmatchedRootLedgerSha256: roots.artifactSha256,
      sealedAt: "2026-09-08T12:06:00.000Z",
      expectedPreviousSealSha256: null,
    });
    const sealPath = join(fixture.analysisRoot, "methodology-inference-seals", "methodology-inference-seal.v000001.json");
    const sealTarget = `${sealPath}.real`;
    renameSync(sealPath, sealTarget);
    symlinkSync(sealTarget, sealPath);
    assert.throws(
      () => readMethodologyInferenceSeal(fixture.analysisRoot, {
        sealedAnalysis,
        expectedInferencePlanSha256: plan.planSha256,
        expectedAdjudicationResolutionHeadSha256: null,
        expectedUnmatchedRootLedgerSha256: roots.artifactSha256,
        expectedSealSha256: seal.sealSha256,
      }),
      /regular non-symlink file|non-regular entry/i,
    );
  } finally {
    cleanupMethodologySealedAnalysisFixture(fixture);
  }
});

test("rejects mixed legacy and versioned seal storage in either read direction and before writes", async () => {
  const root = mkdtempSync(join(tmpdir(), "methodology-inference-seal-mixed-storage-"));
  try {
    const legacyPath = join(root, "methodology-inference-seal.json");
    const versionedDirectory = join(root, "methodology-inference-seals");
    const sealInput = {} as Parameters<typeof writeMethodologyInferenceSeal>[1];
    const readInput = {} as Parameters<typeof readMethodologyInferenceSeal>[1];
    writeFileSync(legacyPath, "{}\n");
    mkdirSync(versionedDirectory);

    assert.throws(
      () => readMethodologyInferenceSeal(root, {
        ...readInput,
        expectedSealSha256: digest("versioned-history"),
      }),
      /cannot mix legacy seal file and versioned seal directory/i,
    );
    assert.throws(
      () => readMethodologyInferenceSeal(root, {
        ...readInput,
        expectedSealSha256: digest("legacy-history"),
      }),
      /cannot mix legacy seal file and versioned seal directory/i,
    );

    assert.throws(
      () => writeMethodologyInferenceSeal(root, sealInput),
      /cannot mix legacy seal file and versioned seal directory/i,
    );

    // A legacy file blocks creation even when no versioned directory exists;
    // the writer must not migrate it or create a new chain beside it.
    rmSync(versionedDirectory, { recursive: true });
    assert.throws(
      () => writeMethodologyInferenceSeal(root, sealInput),
      /cannot create a versioned .* while legacy seal storage exists/i,
    );
    assert.equal(existsSync(versionedDirectory), false);

    // Even an empty versioned directory is storage state, so it cannot be
    // paired with a legacy file as an alternate history.
    mkdirSync(versionedDirectory);
    assert.throws(
      () => readMethodologyInferenceSeal(root, {
        ...readInput,
        expectedSealSha256: digest("empty-versioned-storage"),
      }),
      /cannot mix legacy seal file and versioned seal directory/i,
    );

    // Neither storage location may be reached through a symlink.
    unlinkSync(legacyPath);
    const versionedTarget = `${versionedDirectory}.real`;
    renameSync(versionedDirectory, versionedTarget);
    symlinkSync(versionedTarget, versionedDirectory);
    assert.throws(
      () => readMethodologyInferenceSeal(root, {
        ...readInput,
        expectedSealSha256: digest("symlinked-versioned-storage"),
      }),
      /regular non-symlink directory/i,
    );
    unlinkSync(versionedDirectory);
    renameSync(versionedTarget, versionedDirectory);

    const legacyTarget = `${legacyPath}.real`;
    writeFileSync(legacyTarget, "{}\n");
    symlinkSync(legacyTarget, legacyPath);
    assert.throws(
      () => readMethodologyInferenceSeal(root, {
        ...readInput,
        expectedSealSha256: digest("symlinked-legacy-storage"),
      }),
      /regular non-symlink file/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects a valid plan from a different run before writing a seal", async () => {
  const fixture = await createMethodologySealedAnalysisFixture({ runId: "inference-seal-cross-run" });
  try {
    const plan = planFor(fixture, "different-inference-run");
    const sealedAnalysisBinding = bindAnalysis(fixture);
    const sealedAnalysis = sealedAnalysisReadInput(fixture, sealedAnalysisBinding.bindingSha256);
    const roots = writeRootLedger(fixture, null);
    assert.throws(
      () => writeMethodologyInferenceSeal(fixture.analysisRoot, {
        sealedAnalysis,
        expectedInferencePlanSha256: plan.planSha256,
        expectedAdjudicationResolutionHeadSha256: null,
        expectedUnmatchedRootLedgerSha256: roots.artifactSha256,
        sealedAt: "2026-09-08T12:06:00.000Z",
        expectedPreviousSealSha256: null,
      }),
      /plan digest mismatch|one bound run|run|source artifacts/i,
    );
    unlinkSync(join(fixture.analysisRoot, "methodology-inference-plan.json"));
    const inputPlan = readMethodologyInputPlan(
      fixture.executionRoot,
      fixture.writeInput.projections.invocationRegistrationSha256,
      fixture.writeInput.projections.inputPlanSha256,
    );
    assert.throws(() => writeMethodologyInferencePlan(fixture.analysisRoot, {
      executionRoot: fixture.executionRoot,
      invocationRegistrationSha256: fixture.writeInput.projections.invocationRegistrationSha256,
      inputPlanSha256: fixture.writeInput.projections.inputPlanSha256,
      runId: fixture.writeInput.runId,
      schedule: fixture.schedule,
      analysisStage: "development-screen",
      hypothesis: "detection",
      bootstrapSamples: 101,
      bootstrapSeed: 17,
      minIndependentClusters: 2,
      caseClusters: [{
        caseName: fixture.schedule.cases[0]!.caseName,
        repositoryFamilySha256: inputPlan.cases[0]!.historicalRegistration.source.repositoryIdentitySha256,
        duplicateFamilySha256: digest("b"),
      }],
    }), /cannot be registered after methodology work has begun/i);
  } finally {
    cleanupMethodologySealedAnalysisFixture(fixture);
  }
});

test("rejects a resolution whose truth version does not match its authenticated grade", async () => {
  const fixture = await createMethodologySealedAnalysisFixture({
    runId: "inference-seal-resolution-truth",
    judgeVerdict: false,
  });
  try {
    const plan = planFor(fixture);
    const sealedAnalysisBinding = bindAnalysis(fixture);
    const sealedAnalysis = sealedAnalysisReadInput(fixture, sealedAnalysisBinding.bindingSha256);
    const unresolved = fixture.adjudication.records[0]!;
    const forgedGradeSet = structuredClone(fixture.legacy);
    forgedGradeSet.grades[0]!.metricEligibility.truthVersion = "stale-truth-v0";
    assert.throws(() => writeMethodologyAdjudicationResolution(fixture.analysisRoot, {
      baseLedger: fixture.adjudication,
      gradeSet: forgedGradeSet,
      occurrence: {
        attemptId: unresolved.attemptId,
        findingIndex: unresolved.findingIndex,
        findingEvidenceSha256: unresolved.findingEvidenceSha256,
      },
      classification: "unsupported",
      curatorIdentitySha256: digest("curator"),
      reviewerIdentitySha256s: [digest("reviewer")],
      reviewerIndependence: "not-attested",
      recordedAt: "2026-09-08T12:05:00.000Z",
      rationale: "Synthetic stale decision.",
      evidence: "Synthetic stale evidence.",
      expectedHeadResolutionSha256: null,
    }), /grade-set artifact|digest|canonical/i);
  } finally {
    cleanupMethodologySealedAnalysisFixture(fixture);
  }
});
