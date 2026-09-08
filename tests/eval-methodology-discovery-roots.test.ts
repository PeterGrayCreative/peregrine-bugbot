import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalJsonSha256, writeExclusiveJson } from "../eval/experiment.js";
import {
  readMethodologyAdjudicationArtifact,
  writeMethodologyGradeSet,
  writeMethodologyAdjudicationArtifact,
} from "../eval/methodology-analysis-artifacts.js";
import type { MethodologyAdjudicationRecord } from "../eval/methodology-adjudication.js";
import {
  METHODOLOGY_DISCOVERY_ROOT_LEDGER_FILE,
  buildMethodologyDiscoveryCuratorPacket,
  deriveMethodologyDiscoveryRootSummary,
  readMethodologyDiscoveryRootLedger,
  writeMethodologyDiscoveryRootLedger,
  type MethodologyDiscoveryArtifactInputs,
  type MethodologyDiscoveryRootInput,
} from "../eval/methodology-discovery-roots.js";
import {
  gradeMethodologyAttempt,
  methodologyComparisonId,
  methodologyFindingEvidenceSha256,
  methodologyReviewOutputSha256,
  type MethodologyGradingProjection,
} from "../eval/methodology-grading-contract.js";
import type { MethodologySealedJudgeGradeSet } from "../eval/methodology-judge-grading.js";
import {
  METHODOLOGY_SEALED_JUDGE_GRADE_SET_FILE,
} from "../eval/methodology-sealed-grade-artifact.js";
import {
  buildMethodologySchedule,
  methodologyArmConfigIdentitySha256,
  type MethodologyArmId,
  type MethodologyDesign,
} from "../eval/methodology-schedule.js";
import { historicalTruthScopeSha256 } from "../eval/historical-curation.js";
import { historicalPermittedMetrics, parseHistoricalGroundTruth } from "../eval/historical-truth.js";

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const rootId = (value: string): string => `root-${digest(value)}`;
const recordedAt = "2026-09-08T18:00:00.000Z";

interface Fixture {
  root: string;
  schedule: ReturnType<typeof buildMethodologySchedule>;
  sealed: MethodologySealedJudgeGradeSet;
  legacy: ReturnType<typeof writeMethodologyGradeSet>;
  adjudication: ReturnType<typeof writeMethodologyAdjudicationArtifact>;
  source: MethodologyDiscoveryArtifactInputs;
}

function createFixture(options: { zeroConfirmed?: boolean; seed?: number; runId?: string } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "methodology-discovery-roots-"));
  const executionEvidenceSha256 = digest(`execution-${options.runId ?? "one"}`);
  const inputPlanSha256 = digest(`input-plan-${options.runId ?? "one"}`);
  const judgeConfigSha256 = digest("judge-config");
  const designWithoutArms: Omit<MethodologyDesign, "arms"> = {
    schemaVersion: 1,
    protocol: "historical-methodology-v1",
    seed: options.seed ?? 29,
    repeats: 2,
    callerConfig: {
      runner: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      identitySha256: digest("caller-config"),
    },
    totalDeadlineMs: 60_000,
    twoWorkerStageSplit: { discoveryDeadlineMs: 20_000, reviewerDeadlineMs: 40_000 },
  };
  const design: MethodologyDesign = {
    ...designWithoutArms,
    arms: (["A", "B", "C", "D"] as const).map((armId) => {
      const configName = `arm-${armId.toLowerCase()}`;
      return {
        armId,
        configName,
        configIdentitySha256: methodologyArmConfigIdentitySha256({
          design: designWithoutArms,
          armId,
          configName,
        }),
      };
    }),
  };
  const schedule = buildMethodologySchedule({
    design,
    cases: [{ caseName: "development/case-aaaaaaaa", corpus: "development", expectedBugCount: 1 }],
  });
  const truth = parseHistoricalGroundTruth({
    schemaVersion: 2,
    scope: {
      protocol: "historical-efficacy-v1",
      truthVersion: "fixture-v1",
      status: "known-roots",
      completeness: "partial",
      reviewedScope: "One registered worker lifecycle root.",
      permittedMetrics: historicalPermittedMetrics("known-roots"),
    },
    bugs: [{
      id: "bug-aaaaaaaa",
      lane: "logic-correctness",
      mechanismFamily: "async-lifecycle",
      proofLevel: "complete-static-trace",
      expectedDisposition: "fix-in-pr",
      expectedSeverity: "high",
      file: "src/known.ts",
      startLine: 1,
      endLine: 2,
      description: "The registered lifecycle bug.",
      reachablePreconditions: "The registered branch runs.",
      observableImpact: "The known operation completes early.",
      provenance: "fixture",
    }],
  });
  const grades = schedule.attempts.map((attempt) => {
    const findings = findingsForArm(attempt.armId);
    const review = { status: "completed" as const, limitations: [], findings };
    const projection: MethodologyGradingProjection = {
      schemaVersion: 2,
      kind: "methodology-grading-projection",
      executionEvidenceSha256,
      inputPlanSha256,
      caseRegistrationSha256: digest(`${attempt.id}-case`),
      truthSha256: canonicalJsonSha256(truth),
      truthScopeSha256: historicalTruthScopeSha256(truth),
      attemptId: attempt.id,
      caseName: attempt.caseName,
      status: "completed",
      statusReason: "authenticated-complete",
      lifecycleTerminalSha256: digest(`${attempt.id}-lifecycle`),
      reviewTerminalSha256: digest(`${attempt.id}-terminal`),
      reviewRawOutputSha256: digest(`${attempt.id}-raw`),
      reviewOutputSha256: methodologyReviewOutputSha256(review),
    };
    return gradeMethodologyAttempt({
      projection,
      expectedProjectionSha256: canonicalJsonSha256(projection),
      truth,
      reviewOutput: review,
      judgeConfigSha256,
      pairVerdicts: findings.map((finding, findingIndex) => ({
        comparisonId: methodologyComparisonId({ bug: truth.bugs[0]!, finding, judgeConfigSha256 }),
        bugId: truth.bugs[0]!.id,
        findingIndex,
        findingEvidenceSha256: methodologyFindingEvidenceSha256(finding),
        verdict: "different-root-cause" as const,
      })),
    });
  }).sort((left, right) => left.projection.attemptId.localeCompare(right.projection.attemptId));
  const gradeSetSha256 = canonicalJsonSha256(grades.map((grade) => ({
    attemptId: grade.projection.attemptId,
    gradeSha256: grade.gradeSha256,
  })));
  const sealedBody = {
    schemaVersion: 1 as const,
    protocol: "historical-methodology-sealed-judge-grading-v1" as const,
    runId: options.runId ?? "run-discovery-roots-001",
    executionEvidenceSha256,
    invocationRegistrationSha256: digest("registration"),
    inputPlanSha256,
    projectionSetSha256: digest("projection-set"),
    occurrenceArtifactSha256: digest("judge-occurrences"),
    judgeManifestSha256: digest("judge-manifest"),
    judgeTerminalSealSha256: digest("judge-terminal"),
    judgeConfigSha256,
    grades,
    gradeSetSha256,
    claims: {
      verdictSource: "completed-sealed-semantic-judge-ledger" as const,
      semanticCorrectness: "not-established" as const,
      humanCalibration: "required" as const,
    },
  };
  const sealed: MethodologySealedJudgeGradeSet = {
    ...sealedBody,
    artifactSha256: canonicalJsonSha256(sealedBody),
  };
  writeExclusiveJson(root, join(root, METHODOLOGY_SEALED_JUDGE_GRADE_SET_FILE), sealed);
  const legacy = writeMethodologyGradeSet(root, {
    runId: sealed.runId,
    schedule,
    executionEvidenceSha256: sealed.executionEvidenceSha256,
    inputPlanSha256: sealed.inputPlanSha256,
    grades: sealed.grades,
    recordedAt,
  });
  const records = grades.flatMap((grade): MethodologyAdjudicationRecord[] => {
    const armId = schedule.attempts.find((attempt) => attempt.id === grade.projection.attemptId)!.armId;
    return grade.unmatchedFindings.map((finding) => ({
      attemptId: grade.projection.attemptId,
      findingIndex: finding.findingIndex,
      findingEvidenceSha256: finding.findingEvidenceSha256,
      classification: classificationFor(armId, finding.findingIndex, options.zeroConfirmed === true),
      rationale: "The blind curator classified this occurrence from independent evidence.",
      evidence: "The fixture retains the original occurrence decision.",
    }));
  });
  const adjudication = writeMethodologyAdjudicationArtifact(root, {
    gradeSet: legacy,
    curatorIdentitySha256: digest("occurrence-curator"),
    records,
    recordedAt,
  });
  return {
    root,
    schedule,
    sealed,
    legacy,
    adjudication,
    source: {
      schedule,
      expectedSealedGradeSetArtifactSha256: sealed.artifactSha256,
      expectedLegacyGradeSetArtifactSha256: legacy.artifactSha256,
      expectedAdjudicationLedgerSha256: adjudication.ledgerSha256,
    },
  };
}

function findingsForArm(armId: MethodologyArmId) {
  if (armId === "A" || armId === "B") return [{
    file: "src/shared.ts", startLine: 10, endLine: 12,
    explanation: "Shared discovery: retry acknowledgement races persistence.",
    impact: "A retry can acknowledge data that is not durable.", severity: "high" as const,
  }];
  if (armId === "C") return [{
    file: "src/arm-c.ts", startLine: 20, endLine: 21,
    explanation: "Arm-C discovery: a stale completion overwrites newer state.",
    impact: "The interface can show stale state.", severity: "medium" as const,
  }];
  return [{
    file: "src/noise.ts", startLine: 30, endLine: 30,
    explanation: "Unsupported speculation about a configured timeout.",
    impact: "No demonstrated impact.", severity: "low" as const,
  }, {
    file: "src/unresolved.ts", startLine: 40, endLine: 42,
    explanation: "Unresolved claim about a shutdown edge.",
    impact: "Shutdown might omit cleanup.", severity: "medium" as const,
  }];
}

function classificationFor(
  armId: MethodologyArmId,
  findingIndex: number,
  zeroConfirmed: boolean,
): "confirmed-new" | "unsupported" | "unresolved" {
  if (!zeroConfirmed && armId !== "D") return "confirmed-new";
  return findingIndex === 0 ? "unsupported" : "unresolved";
}

function curatorRoots(packet: ReturnType<typeof buildMethodologyDiscoveryCuratorPacket>): MethodologyDiscoveryRootInput[] {
  const shared = packet.items.filter((item) => item.file === "src/shared.ts").map((item) => item.occurrenceId);
  const armOnly = packet.items.filter((item) => item.file === "src/arm-c.ts").map((item) => item.occurrenceId);
  return [{
    rootId: rootId("shared"),
    occurrenceIds: shared,
    causalMechanism: "Retry acknowledgement can precede durable persistence.",
    evidence: "All occurrences identify the same ordering boundary and consequence.",
  }, {
    rootId: rootId("arm-c"),
    occurrenceIds: armOnly,
    causalMechanism: "An older completion can overwrite newer state.",
    evidence: "Both repeat occurrences identify the same stale-completion path.",
  }];
}

test("packet is deterministic, complete, arm-blind, and excludes non-confirmed occurrence decisions", () => {
  const data = createFixture();
  try {
    const packet = buildMethodologyDiscoveryCuratorPacket(data.root, data.source);
    assert.deepEqual(packet, buildMethodologyDiscoveryCuratorPacket(data.root, data.source));
    assert.equal(packet.items.length, 6);
    assert.equal(new Set(packet.items.map((item) => item.occurrenceId)).size, 6);
    const serialized = JSON.stringify(packet);
    for (const forbidden of ["attemptId", "armId", "repeat", "route", "timing", "model", "configName", "resourceUse"]) {
      assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked into packet`);
    }
    assert.equal(serialized.includes("Unsupported speculation"), false);
    assert.equal(serialized.includes("Unresolved claim"), false);
    assert.equal(data.adjudication.counts.unsupported, 2);
    assert.equal(data.adjudication.counts.unresolved, 2);
  } finally { rmSync(data.root, { recursive: true, force: true }); }
});

test("groups duplicate occurrences into roots and derives shared, arm-only, and repeat attribution", () => {
  const data = createFixture();
  try {
    const packet = buildMethodologyDiscoveryCuratorPacket(data.root, data.source);
    const ledger = writeMethodologyDiscoveryRootLedger(data.root, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      curatorIdentitySha256: digest("root-curator"),
      reviewProtocol: "blind-to-arm-route-timing-v1",
      recordedAt,
      roots: curatorRoots(packet),
    });
    const reread = readMethodologyDiscoveryRootLedger(data.root, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      expectedLedgerSha256: ledger.ledgerSha256,
    });
    assert.deepEqual(reread, ledger);
    assert.deepEqual(ledger.counts, { confirmedNewOccurrences: 6, discoveryRoots: 2 });

    const summary = deriveMethodologyDiscoveryRootSummary(data.root, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      expectedLedgerSha256: ledger.ledgerSha256,
    });
    const shared = summary.roots.find((root) => root.rootId === rootId("shared"))!;
    assert.deepEqual({
      occurrences: shared.occurrenceCount,
      attempts: shared.attemptCount,
      cases: shared.caseCount,
      arms: shared.armIds,
      coverage: shared.armCoverage,
    }, { occurrences: 4, attempts: 4, cases: 1, arms: ["A", "B"], coverage: "shared" });
    assert.deepEqual(shared.repeatReliability, [
      { armId: "A", detectingAttempts: 2, scheduledAttempts: 2 },
      { armId: "B", detectingAttempts: 2, scheduledAttempts: 2 },
      { armId: "C", detectingAttempts: 0, scheduledAttempts: 2 },
      { armId: "D", detectingAttempts: 0, scheduledAttempts: 2 },
    ]);
    const armOnly = summary.roots.find((root) => root.rootId === rootId("arm-c"))!;
    assert.deepEqual(armOnly.armIds, ["C"]);
    assert.equal(armOnly.armCoverage, "arm-only");
    assert.equal(armOnly.occurrenceCount, 2);
    assert.deepEqual(summary.claims, {
      frozenKnownRootRecall: "unchanged",
      discoveryAnalysis: "post-hoc-separate",
      totalRecall: "not-established",
      independentCuration: "not-established",
    });

    const original = readMethodologyAdjudicationArtifact(data.root, {
      expectedLedgerSha256: data.adjudication.ledgerSha256,
      gradeSet: data.legacy,
    });
    assert.deepEqual(original.counts, { "confirmed-new": 6, unsupported: 2, unresolved: 2 });
    assert.equal(original.records.length, 10);
  } finally { rmSync(data.root, { recursive: true, force: true }); }
});

test("requires exact complete root coverage and append-only persistence", () => {
  const data = createFixture();
  try {
    const packet = buildMethodologyDiscoveryCuratorPacket(data.root, data.source);
    const roots = curatorRoots(packet);
    assert.throws(() => writeMethodologyDiscoveryRootLedger(data.root, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      curatorIdentitySha256: digest("root-curator"),
      reviewProtocol: "blind-to-arm-route-timing-v1",
      recordedAt,
      roots: roots.slice(0, 1),
    }), /every and only/);
    assert.throws(() => writeMethodologyDiscoveryRootLedger(data.root, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      curatorIdentitySha256: digest("root-curator"),
      reviewProtocol: "blind-to-arm-route-timing-v1",
      recordedAt,
      roots: [...roots, { ...roots[0]!, rootId: rootId("extra") }],
    }), /more than one root/);
    assert.throws(() => writeMethodologyDiscoveryRootLedger(data.root, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      curatorIdentitySha256: digest("root-curator"),
      reviewProtocol: "blind-to-arm-route-timing-v1",
      recordedAt,
      roots: [{ ...roots[0]!, occurrenceIds: [...roots[0]!.occurrenceIds, roots[0]!.occurrenceIds[0]!] }, roots[1]!],
    }), /duplicate/);
    assert.throws(() => writeMethodologyDiscoveryRootLedger(data.root, {
      source: data.source,
      expectedPacketSha256: digest("stale-packet"),
      curatorIdentitySha256: digest("root-curator"),
      reviewProtocol: "blind-to-arm-route-timing-v1",
      recordedAt,
      roots,
    }), /caller-held digest/);
    assert.throws(() => writeMethodologyDiscoveryRootLedger(data.root, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      curatorIdentitySha256: digest("root-curator"),
      reviewProtocol: "not-blind" as never,
      recordedAt,
      roots,
    }), /must remain blind/);

    const ledger = writeMethodologyDiscoveryRootLedger(data.root, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      curatorIdentitySha256: digest("root-curator"),
      reviewProtocol: "blind-to-arm-route-timing-v1",
      recordedAt,
      roots,
    });
    assert.throws(() => writeMethodologyDiscoveryRootLedger(data.root, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      curatorIdentitySha256: digest("root-curator"),
      reviewProtocol: "blind-to-arm-route-timing-v1",
      recordedAt,
      roots,
    }), /exist|EEXIST/i);

    const path = join(data.root, METHODOLOGY_DISCOVERY_ROOT_LEDGER_FILE);
    const tampered = JSON.parse(readFileSync(path, "utf8")) as { roots: Array<{ evidence: string }> };
    tampered.roots[0]!.evidence = "Tampered evidence.";
    writeFileSync(path, `${JSON.stringify(tampered)}\n`);
    assert.throws(() => readMethodologyDiscoveryRootLedger(data.root, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      expectedLedgerSha256: ledger.ledgerSha256,
    }), /digest mismatch/);
  } finally { rmSync(data.root, { recursive: true, force: true }); }
});

test("rejects stale and cross-run source bindings", () => {
  const data = createFixture();
  const other = createFixture({ seed: 31, runId: "run-discovery-roots-002" });
  try {
    assert.throws(() => buildMethodologyDiscoveryCuratorPacket(data.root, {
      ...data.source,
      schedule: other.schedule,
    }), /different schedule or run/);
    assert.throws(() => buildMethodologyDiscoveryCuratorPacket(data.root, {
      ...data.source,
      expectedSealedGradeSetArtifactSha256: other.sealed.artifactSha256,
    }), /caller digest|artifact digest/i);
  } finally {
    rmSync(data.root, { recursive: true, force: true });
    rmSync(other.root, { recursive: true, force: true });
  }
});

test("retains an authenticated zero-root result", () => {
  const data = createFixture({ zeroConfirmed: true });
  try {
    const packet = buildMethodologyDiscoveryCuratorPacket(data.root, data.source);
    assert.deepEqual(packet.items, []);
    const ledger = writeMethodologyDiscoveryRootLedger(data.root, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      curatorIdentitySha256: digest("root-curator"),
      reviewProtocol: "blind-to-arm-route-timing-v1",
      recordedAt,
      roots: [],
    });
    const summary = deriveMethodologyDiscoveryRootSummary(data.root, {
      source: data.source,
      expectedPacketSha256: packet.packetSha256,
      expectedLedgerSha256: ledger.ledgerSha256,
    });
    assert.deepEqual(ledger.counts, { confirmedNewOccurrences: 0, discoveryRoots: 0 });
    assert.deepEqual(summary.roots, []);
    assert.deepEqual(summary.counts, { confirmedNewOccurrences: 0, discoveryRoots: 0 });
  } finally { rmSync(data.root, { recursive: true, force: true }); }
});
