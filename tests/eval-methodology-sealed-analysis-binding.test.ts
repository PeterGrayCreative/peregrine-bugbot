import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import test from "node:test";
import { repositoryFamilyIdentitySha256 } from "../eval/case-isolation.js";
import type { CuratorPolicy } from "../eval/case-curation.js";
import {
  canonicalJsonSha256,
} from "../eval/experiment.js";
import {
  historicalCaseBundleSha256,
  historicalTruthScopeSha256,
  parseHistoricalCuration,
  requiredHistoricalConfirmationChecks,
} from "../eval/historical-curation.js";
import {
  materializeHistoricalMethodologyCase,
  readHistoricalMethodologyCase,
  type MaterializedHistoricalMethodologyCase,
} from "../eval/historical-methodology-case.js";
import { runRegisteredHistoricalMethodologyAttempt } from "../eval/historical-methodology-runner.js";
import {
  writeMethodologyExecutionEvidence,
  type MethodologyLifecycleSealReceipt,
} from "../eval/methodology-execution-evidence.js";
import {
  gradeMethodologyAttempt,
} from "../eval/methodology-grading-contract.js";
import {
  readMethodologyGradingProjections,
} from "../eval/methodology-grading-projection.js";
import {
  writeMethodologyAdjudicationArtifact,
  writeMethodologyGradeSet,
  writeMethodologyReportArtifact,
} from "../eval/methodology-analysis-artifacts.js";
import type { MethodologyAdjudicationRecord } from "../eval/methodology-adjudication.js";
import {
  writeMethodologyAnalysisBinding,
} from "../eval/methodology-analysis-binding.js";
import {
  registerMethodologyInputPlan,
} from "../eval/methodology-input-plan.js";
import {
  registerMethodologyInvocations,
} from "../eval/methodology-invocations.js";
import {
  writeMethodologyRunSeal,
  type MethodologyTerminalReceipt,
} from "../eval/methodology-run-seal.js";
import {
  methodologyJudgeImplementationSha256,
  writeMethodologyJudgeBinding,
} from "../eval/methodology-judge-binding.js";
import {
  runMethodologyJudgeLedger,
} from "../eval/methodology-judge-ledger.js";
import { prepareMethodologyLaneActivation } from "../eval/methodology-lane-activation.js";
import {
  writeMethodologyGradeSetFromSealedJudge,
  writeMethodologySealedJudgeGradeSet,
} from "../eval/methodology-sealed-grade-artifact.js";
import {
  METHODOLOGY_SEALED_ANALYSIS_BINDING_FILE,
  METHODOLOGY_SEALED_ANALYSIS_SOURCE_PATHS,
  readMethodologySealedAnalysisBinding,
  verifyMethodologySealedAnalysisSource,
  writeMethodologySealedAnalysisBinding,
  type MethodologySealedAnalysisBindingReadInputs,
  type MethodologySealedAnalysisBindingWriteInputs,
} from "../eval/methodology-sealed-analysis-binding.js";
import {
  writeMethodologyResourceSet,
} from "../eval/methodology-resource-artifact.js";
import {
  writeMethodologyResourceReport,
} from "../eval/methodology-resource-report.js";
import {
  buildMethodologySchedule,
  methodologyArmConfigIdentitySha256,
  type MethodologyDesign,
} from "../eval/methodology-schedule.js";
import {
  historicalPermittedMetrics,
  parseHistoricalGroundTruth,
} from "../eval/historical-truth.js";
import type {
  HistoricalCaseSpec,
  PeregrineConfig,
  ProviderExec,
  ReviewContext,
} from "../src/types.js";

const CURATORS = ["1".repeat(64), "2".repeat(64)];
const POLICY: CuratorPolicy = {
  schemaVersion: 1,
  policyId: "protected-git-review-v1",
  trustRoot: "protected-git-review",
  minimumIndependentConfirmations: 2,
  curatorIdentitySha256s: CURATORS,
};
const REVIEW = JSON.stringify({
  status: "completed",
  limitations: [],
  findings: [{
    file: "src/retry.ts",
    startLine: 1,
    endLine: 1,
    explanation: "The changed path no longer invokes the completion callback.",
    impact: "The caller remains pending.",
    severity: "high",
  }],
});
const DISCOVERY = JSON.stringify({
  status: "completed",
  limitations: [],
  candidates: [{
    file: "src/retry.ts",
    startLine: 1,
    endLine: 1,
    hypothesis: "The callback may no longer be invoked.",
    evidenceNeeded: "Trace the changed callback path.",
  }],
});
const BREADTH = JSON.stringify({
  model: "gpt-5.6-sol",
  candidates: [],
  clear: [],
  escalations: [],
  coverage: { coveredFiles: ["src/retry.ts"], unavailable: [] },
});
const LIMITS = {
  maxProviderCostUsd: null,
  maxProviderAttempts: 10,
  maxWallTimeMs: 60_000,
  maxFailureRate: 1,
  minAttemptsForFailureRate: 1,
  maxConsecutiveFailures: 2,
} as const;
const JUDGE_USAGE = {
  inputTokens: null,
  cachedInputTokens: null,
  outputTokens: null,
  reasoningTokens: null,
  turns: null,
  toolCalls: null,
};

interface Fixture {
  caseRoot: string;
  executionRoot: string;
  analysisRoot: string;
  judgeRunDirectory: string;
  prepared: MaterializedHistoricalMethodologyCase[];
  writeInput: MethodologySealedAnalysisBindingWriteInputs;
}

async function fixture(options: { legacyMismatch?: boolean } = {}): Promise<Fixture> {
  const repositoryRoot = resolve(".");
  const historical = createHistoricalCase();
  const executionRoot = mkdtempSync(join(tmpdir(), "methodology-sealed-analysis-execution-"));
  const analysisRoot = mkdtempSync(join(tmpdir(), "methodology-sealed-analysis-store-"));
  const judgeRunDirectory = mkdtempSync(join(tmpdir(), "methodology-sealed-analysis-judge-"));
  const prepared: MaterializedHistoricalMethodologyCase[] = [];
  const registration = readHistoricalMethodologyCase(historical.caseDir, POLICY);
  const schedule = scheduleFor(registration.caseName, registration.truth.registeredRootCount);
  for (const armId of ["A", "B", "C", "D"] as const) {
    prepared.push(await materializeHistoricalMethodologyCase(registration, schedule, armId, POLICY));
  }
  const rawScope = prepared[0]!.rawScope;
  const invocationRegistrationSha256 = registerMethodologyInvocations(executionRoot, {
    runId: "sealed-analysis-fixture-run",
    schedule,
    scopeSha256ByCase: { [registration.caseName]: canonicalJsonSha256(rawScope) },
    assetsByArm: prepared.map((item) => item.assetsManifest),
  });
  const activation = await prepareMethodologyLaneActivation({
    armId: "B",
    context: reviewContext(prepared.find((item) => item.assetsManifest.armId === "B")!),
    rawScope,
  });
  const inputPlanSha256 = await registerMethodologyInputPlan(executionRoot, {
    invocationRegistrationSha256,
    cases: [{
      historicalRegistration: registration,
      admissionBinding: prepared[0]!.admissionBinding,
      rawScope,
      laneActivation: activation,
    }],
  });
  const lifecycleReceipts: MethodologyLifecycleSealReceipt[] = [];
  const terminalReceipts: MethodologyTerminalReceipt[] = [];
  for (const attempt of schedule.attempts) {
    const outputs = new Map<string, string>();
    const lifecycle = await runRegisteredHistoricalMethodologyAttempt({
      evidenceRoot: executionRoot,
      invocationRegistrationSha256,
      inputPlanSha256,
      attemptId: attempt.id,
      priorLifecycleReceipts: [...lifecycleReceipts],
      trustedCuratorPolicy: POLICY,
      config: config(),
      attachProvider: () => {
        const runProvider: ProviderExec = async (_command, args) => {
          const outputPath = argumentAfter(args, "--output-last-message");
          const schema = basename(argumentAfter(args, "--output-schema"));
          outputs.set(outputPath,
            schema === "methodology-discovery.schema.json" ? DISCOVERY :
              schema === "breadth-result.schema.json" ? BREADTH : REVIEW);
          return { stdout: "", stderr: "", code: 0, timedOut: false };
        };
        return {
          runProvider,
          readProviderOutput: (path: string) => outputs.get(path)!,
          neutralReadMcp: {
            protocol: "neutral-read-mcp-v1" as const,
            url: "http://host.docker.internal:43123/mcp/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            serverName: "source_read" as const,
            enabledTools: ["list_tree", "read_file", "search_text"] as const,
          },
        };
      },
    });
    lifecycleReceipts.push({
      attemptId: attempt.id,
      lifecycleTerminalSha256: lifecycle.lifecycleTerminalSha256,
    });
    if (!lifecycle.reviewTerminalSha256) {
      throw new Error("sealed analysis fixture requires a review terminal");
    }
    terminalReceipts.push({
      attemptId: attempt.id,
      terminalSha256: lifecycle.reviewTerminalSha256,
    });
  }
  const terminalRunSealSha256 = writeMethodologyRunSeal(
    executionRoot,
    invocationRegistrationSha256,
    terminalReceipts,
  );
  const executionEvidenceSha256 = writeMethodologyExecutionEvidence(executionRoot, {
    invocationRegistrationSha256,
    inputPlanSha256,
    terminalRunSealSha256,
    lifecycleReceipts,
  });
  const projections = readMethodologyGradingProjections({
    root: executionRoot,
    expectedExecutionEvidenceSha256: executionEvidenceSha256,
    trustedCuratorPolicy: POLICY,
  });
  const judgeImplementationSha256 = methodologyJudgeImplementationSha256(repositoryRoot);
  const judgeResult = await runMethodologyJudgeLedger({
    runDirectory: judgeRunDirectory,
    runId: projections.runId,
    projections,
    providerAccess: "cli-session",
    limits: LIMITS,
    judgeImplementationSha256,
    execute: async () => ({
      verdict: true,
      durationMs: 1,
      providerCostUsd: null,
      usage: JUDGE_USAGE,
    }),
  });
  const judgeTerminalSealSha256 = digest(readFileSync(join(judgeRunDirectory, "judge/terminal-seal.json")));
  const anchors = {
    runId: projections.runId,
    projections,
    providerAccess: "cli-session" as const,
    limits: LIMITS,
    judgeImplementationSha256,
    expectedOccurrenceArtifactSha256: judgeResult.artifact.artifactSha256,
    expectedJudgeManifestSha256: judgeResult.manifest.manifestSha256,
    expectedJudgeTerminalSealSha256: judgeTerminalSealSha256,
    expectedProjectionSetSha256: judgeResult.artifact.projectionSetSha256,
  };
  const judgeBinding = writeMethodologyJudgeBinding(analysisRoot, {
    ...anchors,
    runDirectory: judgeRunDirectory,
    repositoryRoot,
    boundAt: "2026-09-08T12:00:00.000Z",
  });
  const sealed = writeMethodologySealedJudgeGradeSet(analysisRoot, {
    ...anchors,
    runDirectory: judgeRunDirectory,
    repositoryRoot,
    expectedJudgeBindingSha256: judgeBinding.bindingSha256,
  });
  const legacyGrades = sealed.grades.map((grade, index) => index === 0 ? gradeMethodologyAttempt({
      projection: projections.projections[index]!.projection,
      expectedProjectionSha256: projections.projections[index]!.projectionSha256,
      truth: projections.projections[index]!.truth,
      reviewOutput: projections.projections[index]!.reviewOutput,
      judgeConfigSha256: digest("different-judge-config"),
      pairVerdicts: [],
    }) : grade);
  const legacy = options.legacyMismatch
    ? writeMethodologyGradeSet(analysisRoot, {
      runId: projections.runId,
      schedule,
      executionEvidenceSha256,
      inputPlanSha256,
      grades: legacyGrades,
      recordedAt: "2026-09-08T12:01:00.000Z",
    })
    : writeMethodologyGradeSetFromSealedJudge(analysisRoot, {
      ...anchors,
      runDirectory: judgeRunDirectory,
      repositoryRoot,
      expectedJudgeBindingSha256: judgeBinding.bindingSha256,
      expectedSealedGradeSetArtifactSha256: sealed.artifactSha256,
      schedule,
      recordedAt: "2026-09-08T12:01:00.000Z",
    });
  const records = legacy.grades.flatMap((grade) => grade.unmatchedFindings.map(
    (finding): MethodologyAdjudicationRecord => ({
      attemptId: grade.projection.attemptId,
      findingIndex: finding.findingIndex,
      findingEvidenceSha256: finding.findingEvidenceSha256,
      classification: "unresolved",
      rationale: "Synthetic structural output has no independent finding adjudication.",
      evidence: "This fixture authenticates sealed analysis joins only.",
    }),
  ));
  const adjudication = writeMethodologyAdjudicationArtifact(analysisRoot, {
    gradeSet: legacy,
    curatorIdentitySha256: "b".repeat(64),
    records,
    recordedAt: "2026-09-08T12:02:00.000Z",
  });
  const report = writeMethodologyReportArtifact(analysisRoot, {
    schedule,
    gradeSet: legacy,
    adjudication,
  });
  const resources = writeMethodologyResourceSet(analysisRoot, {
    executionRoot,
    runId: projections.runId,
    schedule,
    expectedExecutionEvidenceSha256: executionEvidenceSha256,
    trustedCuratorPolicy: POLICY,
    recordedAt: "2026-09-08T12:03:00.000Z",
  });
  const resourceReport = writeMethodologyResourceReport(analysisRoot, { schedule, resources });
  const baseBinding = writeMethodologyAnalysisBinding(analysisRoot, {
    executionRoot,
    repositoryRoot,
    expectedExecutionEvidenceSha256: executionEvidenceSha256,
    trustedCuratorPolicy: POLICY,
    expectedGradeSetArtifactSha256: legacy.artifactSha256,
    expectedAdjudicationLedgerSha256: adjudication.ledgerSha256,
    expectedReportSha256: report.reportSha256,
    expectedResourceSetArtifactSha256: resources.artifactSha256,
    expectedResourceReportSha256: resourceReport.reportSha256,
    boundAt: "2026-09-08T12:04:00.000Z",
  });
  return {
    caseRoot: historical.root,
    executionRoot,
    analysisRoot,
    judgeRunDirectory,
    prepared,
    writeInput: {
      ...anchors,
      executionRoot,
      judgeRunDirectory,
      repositoryRoot,
      trustedCuratorPolicy: POLICY,
      expectedExecutionEvidenceSha256: executionEvidenceSha256,
      expectedBaseAnalysisBindingSha256: baseBinding.bindingSha256,
      expectedJudgeBindingSha256: judgeBinding.bindingSha256,
      expectedSealedGradeSetArtifactSha256: sealed.artifactSha256,
      boundAt: "2026-09-08T12:05:00.000Z",
    },
  };
}

function cleanup(value: Fixture): void {
  value.prepared.forEach((item) => item.cleanup());
  rmSync(value.caseRoot, { recursive: true, force: true });
  rmSync(value.executionRoot, { recursive: true, force: true });
  rmSync(value.analysisRoot, { recursive: true, force: true });
  rmSync(value.judgeRunDirectory, { recursive: true, force: true });
}

function readInput(value: Fixture, bindingSha256: string): MethodologySealedAnalysisBindingReadInputs {
  const { boundAt: _boundAt, ...shared } = value.writeInput;
  return { ...shared, expectedBindingSha256: bindingSha256 };
}

test("round-trips the source-bound sealed analysis join and preserves v1 claims", async () => {
  const value = await fixture();
  try {
    const binding = writeMethodologySealedAnalysisBinding(value.analysisRoot, value.writeInput);
    const read = readMethodologySealedAnalysisBinding(
      value.analysisRoot,
      readInput(value, binding.bindingSha256),
    );
    assert.deepEqual(read, binding);
    assert.equal(binding.protocol, "historical-methodology-sealed-analysis-binding-v1");
    assert.deepEqual(binding.claims, {
      sourceClosure: "fixed-explicit-source-list",
      providerIdentity: "not-established",
      semanticCorrectness: "not-established",
      humanCalibration: "required",
      efficacy: "not-decided",
    });
    assert.deepEqual(
      binding.analysisSource.map((entry) => entry.path),
      METHODOLOGY_SEALED_ANALYSIS_SOURCE_PATHS,
    );
    verifyMethodologySealedAnalysisSource(binding, value.writeInput.repositoryRoot);
    assert.throws(
      () => writeMethodologySealedAnalysisBinding(value.analysisRoot, value.writeInput),
      /exist|exclusive|EEXIST/i,
    );
  } finally { cleanup(value); }
});

test("rejects missing or wrong caller-held base, judge, sealed, and judge-ledger anchors", async () => {
  const value = await fixture();
  try {
    const binding = writeMethodologySealedAnalysisBinding(value.analysisRoot, value.writeInput);
    const input = readInput(value, binding.bindingSha256);
    const wrong = digest("wrong-anchor");
    const fields: Array<keyof MethodologySealedAnalysisBindingReadInputs> = [
      "expectedBaseAnalysisBindingSha256",
      "expectedJudgeBindingSha256",
      "expectedSealedGradeSetArtifactSha256",
      "expectedExecutionEvidenceSha256",
      "expectedOccurrenceArtifactSha256",
      "expectedJudgeManifestSha256",
      "expectedJudgeTerminalSealSha256",
      "expectedProjectionSetSha256",
      "judgeImplementationSha256",
    ];
    for (const field of fields) {
      assert.throws(
        () => readMethodologySealedAnalysisBinding(value.analysisRoot, { ...input, [field]: wrong }),
        /digest|implementation|artifact|evidence|binding|anchor|mismatch/i,
      );
    }
    for (const field of [
      "expectedBaseAnalysisBindingSha256",
      "expectedJudgeBindingSha256",
      "expectedSealedGradeSetArtifactSha256",
    ] as const) {
      assert.throws(
        () => readMethodologySealedAnalysisBinding(value.analysisRoot,
          { ...input, [field]: undefined } as unknown as MethodologySealedAnalysisBindingReadInputs),
        /digest/i,
      );
    }
  } finally { cleanup(value); }
});

test("rejects downstream, stored-binding, and source-manifest tampering", async () => {
  const value = await fixture();
  try {
    const reportPath = join(value.analysisRoot, "methodology-report.json");
    const reportBytes = readFileSync(reportPath);
    const tamperedReport = JSON.parse(reportBytes.toString("utf8")) as Record<string, any>;
    tamperedReport.claims.efficacy = "forged-positive-result";
    writeFileSync(reportPath, `${JSON.stringify(tamperedReport)}\n`);
    assert.throws(
      () => writeMethodologySealedAnalysisBinding(value.analysisRoot, value.writeInput),
      /report artifact digest mismatch|report.*invalid/i,
    );
    writeFileSync(reportPath, reportBytes);

    const binding = writeMethodologySealedAnalysisBinding(value.analysisRoot, value.writeInput);
    writeFileSync(reportPath, `${JSON.stringify(tamperedReport)}\n`);
    assert.throws(
      () => readMethodologySealedAnalysisBinding(
        value.analysisRoot,
        readInput(value, binding.bindingSha256),
      ),
      /report artifact digest mismatch|report.*invalid/i,
    );
    writeFileSync(reportPath, reportBytes);

    const path = join(value.analysisRoot, METHODOLOGY_SEALED_ANALYSIS_BINDING_FILE);
    const original = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
    writeFileSync(path, `${JSON.stringify({ ...original, extra: true })}\n`);
    assert.throws(
      () => readMethodologySealedAnalysisBinding(
        value.analysisRoot,
        readInput(value, binding.bindingSha256),
      ),
      /structure|shape|digest/i,
    );

    const sourceTamper = structuredClone(original);
    sourceTamper.analysisSource[0].bytes += 1;
    sourceTamper.analysisSourceTreeSha256 = canonicalJsonSha256(sourceTamper.analysisSource);
    const { bindingSha256: _digest, ...body } = sourceTamper;
    sourceTamper.bindingSha256 = canonicalJsonSha256(body);
    writeFileSync(path, `${JSON.stringify(sourceTamper)}\n`);
    assert.throws(
      () => readMethodologySealedAnalysisBinding(
        value.analysisRoot,
        readInput(value, sourceTamper.bindingSha256),
      ),
      /source|caller-held artifacts/i,
    );
  } finally { cleanup(value); }
});

test("rejects a legacy grade set that is not the exact sealed-judge projection", async () => {
  const value = await fixture({ legacyMismatch: true });
  try {
    assert.throws(
      () => writeMethodologySealedAnalysisBinding(value.analysisRoot, value.writeInput),
      /legacy methodology grade set does not exactly match sealed judge grades/i,
    );
  } finally { cleanup(value); }
});

test("rejects a cross-run projection set", async () => {
  const value = await fixture();
  try {
    const crossRun = structuredClone(value.writeInput);
    crossRun.projections.runId = "different-run";
    assert.throws(
      () => writeMethodologySealedAnalysisBinding(value.analysisRoot, crossRun),
      /stale|cross-run|runId/i,
    );
  } finally { cleanup(value); }
});

function createHistoricalCase(): { root: string; caseDir: string } {
  const root = mkdtempSync(join(tmpdir(), "methodology-sealed-analysis-case-"));
  const source = join(root, "source");
  const caseDir = join(root, "cases", "development", "case-abababab");
  mkdirSync(join(source, "src"), { recursive: true });
  mkdirSync(join(source, ".home"));
  git(source, "init", "--quiet", "--initial-branch=main");
  git(source, "config", "user.name", "Sealed Analysis Test Curator");
  git(source, "config", "user.email", "curator@example.invalid");
  writeFileSync(join(source, "src/retry.ts"),
    "export const retry = (done: () => void) => done();\n");
  git(source, "add", ".");
  git(source, "commit", "--quiet", "-m", "base");
  const base = git(source, "rev-parse", "HEAD");
  writeFileSync(join(source, "src/retry.ts"),
    "export const retry = (_done: () => void) => undefined;\n");
  git(source, "add", ".");
  git(source, "commit", "--quiet", "-m", "head");
  const head = git(source, "rev-parse", "HEAD");
  const diff = git(source, "diff", "--binary", "--full-index", "--no-ext-diff",
    "--no-textconv", "--no-color", "--find-renames", `${base}...${head}`, "--",
    { trim: false });
  mkdirSync(caseDir, { recursive: true });
  const spec: HistoricalCaseSpec = {
    id: "case-abababab",
    corpus: "development",
    kind: "historical",
    evaluationProtocol: "historical-efficacy-v1",
    repoSource: source,
    baseCommit: base,
    headCommit: head,
    diffFile: "diff.patch",
    metadataFile: "metadata.json",
  };
  writeFileSync(join(caseDir, "case.json"), JSON.stringify(spec));
  writeFileSync(join(caseDir, "diff.patch"), diff);
  writeFileSync(join(caseDir, "metadata.json"), JSON.stringify({
    title: "Preserve retry completion",
    body: "Review the callback behavior introduced by this change.",
  }));
  writeFileSync(join(caseDir, "ground_truth.json"), JSON.stringify({
    schemaVersion: 2,
    scope: {
      protocol: "historical-efficacy-v1",
      truthVersion: "truth-v1",
      status: "known-roots",
      completeness: "partial",
      reviewedScope: "The changed retry callback only.",
      permittedMetrics: historicalPermittedMetrics("known-roots"),
    },
    bugs: [{
      id: "bug-abababab",
      lane: "other-unclassified",
      mechanismFamily: "callback-loss",
      proofLevel: "complete-static-trace",
      expectedDisposition: "fix-in-pr",
      expectedSeverity: "high",
      file: "src/retry.ts",
      startLine: 1,
      endLine: 1,
      description: "The changed retry path omits callback completion.",
      reachablePreconditions: "A caller supplies a completion callback.",
      observableImpact: "The caller remains pending.",
      provenance: "Synthetic static trace evidence.",
    }],
  }));
  writeFileSync(join(caseDir, "proof.md"), "Synthetic static trace fixture.\n");
  writeCuration(caseDir, spec, diff);
  return { root, caseDir };
}

function writeCuration(caseDir: string, spec: HistoricalCaseSpec, diff: string): void {
  const truth = parseHistoricalGroundTruth(
    JSON.parse(readFileSync(join(caseDir, "ground_truth.json"), "utf8")),
  );
  const scopeSha256 = historicalTruthScopeSha256(truth);
  const curation: any = {
    schemaVersion: 2,
    protocol: "historical-efficacy-v1",
    caseId: spec.id,
    status: "admitted",
    curatorPolicyId: POLICY.policyId,
    truth: {
      truthVersion: truth.scope.truthVersion,
      status: truth.scope.status,
      completeness: "partial",
      scopeSha256,
    },
    source: {
      kind: "historical",
      repositoryAlias: "sealed-analysis-fixture",
      repositoryIdentitySha256: repositoryFamilyIdentitySha256("sha1", [spec.baseCommit]),
      changeIdentitySha256: digest(diff),
      access: "public",
    },
    strata: {
      languageFamily: "typescript",
      architectureFamily: "library",
      size: "small",
      changeShapes: ["direct"],
      secondarySurfaceLanes: [],
      mechanismFamilies: ["callback-loss"],
    },
    proof: {
      kind: "reasoned-analysis",
      artifact: "proof.md",
      sha256: digest(readFileSync(join(caseDir, "proof.md"))),
    },
    confirmations: CURATORS.map((curatorIdentitySha256, index) => ({
      curatorIdentitySha256,
      confirmedAt: `2026-09-08T1${index}:00:00.000Z`,
      caseBundleSha256: "0".repeat(64),
      truthScopeSha256: scopeSha256,
      checks: requiredHistoricalConfirmationChecks("known-roots"),
    })),
  };
  const parsed = parseHistoricalCuration(curation, spec, truth);
  const bundle = historicalCaseBundleSha256(caseDir, spec, parsed);
  for (const confirmation of curation.confirmations) confirmation.caseBundleSha256 = bundle;
  writeFileSync(join(caseDir, "curation.json"), JSON.stringify(curation));
}

function scheduleFor(caseName: string, expectedBugCount: number) {
  const base: Omit<MethodologyDesign, "arms"> = {
    schemaVersion: 1,
    protocol: "historical-methodology-v1",
    seed: 101,
    repeats: 1,
    callerConfig: {
      runner: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      identitySha256: "a".repeat(64),
    },
    totalDeadlineMs: 60_000,
    twoWorkerStageSplit: { discoveryDeadlineMs: 20_000, reviewerDeadlineMs: 40_000 },
  };
  return buildMethodologySchedule({
    design: {
      ...base,
      arms: (["A", "B", "C", "D"] as const).map((armId) => {
        const configName = `methodology-${armId.toLowerCase()}`;
        return {
          armId,
          configName,
          configIdentitySha256: methodologyArmConfigIdentitySha256({
            design: base,
            armId,
            configName,
          }),
        };
      }),
    },
    cases: [{ caseName, corpus: "development", expectedBugCount }],
  });
}

function reviewContext(item: MaterializedHistoricalMethodologyCase): ReviewContext {
  const value = item.materialized;
  return {
    repoPath: value.repoPath,
    diffPath: value.diffPath,
    diffText: value.diffText,
    baseRef: value.baseRef,
    headRef: value.headRef,
    config: config(),
    evaluationIsolation: value.evaluationIsolation,
  };
}

function argumentAfter(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1);
  return args[index + 1]!;
}

function git(cwd: string, ...raw: Array<string | { trim: boolean }>): string {
  const options = typeof raw.at(-1) === "object"
    ? raw.pop() as { trim: boolean }
    : { trim: true };
  const output = execFileSync("git", raw as string[], {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: join(cwd, ".home"),
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
  return options.trim ? output.trim() : output;
}

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function config(): PeregrineConfig {
  return JSON.parse(readFileSync(resolve("peregrine.config.json"), "utf8")) as PeregrineConfig;
}
