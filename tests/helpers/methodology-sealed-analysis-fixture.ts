import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { repositoryFamilyIdentitySha256 } from "../../eval/case-isolation.js";
import type { CuratorPolicy } from "../../eval/case-curation.js";
import { canonicalJsonSha256 } from "../../eval/experiment.js";
import {
  historicalCaseBundleSha256,
  historicalTruthScopeSha256,
  parseHistoricalCuration,
  requiredHistoricalConfirmationChecks,
} from "../../eval/historical-curation.js";
import {
  materializeHistoricalMethodologyCase,
  readHistoricalMethodologyCase,
  type MaterializedHistoricalMethodologyCase,
} from "../../eval/historical-methodology-case.js";
import { runRegisteredHistoricalMethodologyAttempt } from "../../eval/historical-methodology-runner.js";
import {
  writeMethodologyExecutionEvidence,
  type MethodologyLifecycleSealReceipt,
} from "../../eval/methodology-execution-evidence.js";
import { gradeMethodologyAttempt } from "../../eval/methodology-grading-contract.js";
import { readMethodologyGradingProjections } from "../../eval/methodology-grading-projection.js";
import {
  writeMethodologyAdjudicationArtifact,
  writeMethodologyGradeSet,
  writeMethodologyReportArtifact,
} from "../../eval/methodology-analysis-artifacts.js";
import type {
  MethodologyAdjudicationClassification,
  MethodologyAdjudicationRecord,
} from "../../eval/methodology-adjudication.js";
import { writeMethodologyAnalysisBinding } from "../../eval/methodology-analysis-binding.js";
import { registerMethodologyInputPlan } from "../../eval/methodology-input-plan.js";
import { registerMethodologyInvocations } from "../../eval/methodology-invocations.js";
import {
  writeMethodologyRunSeal,
  type MethodologyTerminalReceipt,
} from "../../eval/methodology-run-seal.js";
import {
  methodologyJudgeImplementationSha256,
  writeMethodologyJudgeBinding,
} from "../../eval/methodology-judge-binding.js";
import { runMethodologyJudgeLedger } from "../../eval/methodology-judge-ledger.js";
import { prepareMethodologyLaneActivation } from "../../eval/methodology-lane-activation.js";
import type { MethodologyFinding } from "../../eval/methodology-output.js";
import {
  writeMethodologyGradeSetFromSealedJudge,
  writeMethodologySealedJudgeGradeSet,
} from "../../eval/methodology-sealed-grade-artifact.js";
import type {
  MethodologySealedAnalysisBindingReadInputs,
  MethodologySealedAnalysisBindingWriteInputs,
} from "../../eval/methodology-sealed-analysis-binding.js";
import { writeMethodologyResourceSet } from "../../eval/methodology-resource-artifact.js";
import { writeMethodologyResourceReport } from "../../eval/methodology-resource-report.js";
import {
  buildMethodologySchedule,
  methodologyArmConfigIdentitySha256,
  type MethodologyArmId,
  type MethodologyDesign,
} from "../../eval/methodology-schedule.js";
import { historicalPermittedMetrics, parseHistoricalGroundTruth } from "../../eval/historical-truth.js";
import type {
  HistoricalCaseSpec,
  PeregrineConfig,
  ReviewContext,
} from "../../src/types.js";
import { createFakeMethodologyProvider } from "./fake-methodology-provider.js";

const CURATORS = ["1".repeat(64), "2".repeat(64)];
const POLICY: CuratorPolicy = {
  schemaVersion: 1,
  policyId: "protected-git-review-v1",
  trustRoot: "protected-git-review",
  minimumIndependentConfirmations: 2,
  curatorIdentitySha256s: CURATORS,
};
const DEFAULT_FINDING: MethodologyFinding = {
  file: "src/retry.ts",
  startLine: 1,
  endLine: 1,
  explanation: "The changed path no longer invokes the completion callback.",
  impact: "The caller remains pending.",
  severity: "high",
};
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

export interface MethodologySealedAnalysisFixtureOptions {
  legacyMismatch?: boolean;
  runId?: string;
  seed?: number;
  repeats?: number;
  judgeVerdict?: boolean;
  findingsForArm?: (armId: MethodologyArmId) => MethodologyFinding[];
  classifyUnmatched?: (input: {
    armId: MethodologyArmId;
    findingIndex: number;
  }) => MethodologyAdjudicationClassification;
}

export interface MethodologySealedAnalysisFixture {
  caseRoot: string;
  executionRoot: string;
  analysisRoot: string;
  judgeRunDirectory: string;
  prepared: MaterializedHistoricalMethodologyCase[];
  schedule: ReturnType<typeof buildMethodologySchedule>;
  sealed: ReturnType<typeof writeMethodologySealedJudgeGradeSet>;
  legacy: ReturnType<typeof writeMethodologyGradeSet>;
  adjudication: ReturnType<typeof writeMethodologyAdjudicationArtifact>;
  writeInput: MethodologySealedAnalysisBindingWriteInputs;
}

export async function createMethodologySealedAnalysisFixture(
  options: MethodologySealedAnalysisFixtureOptions = {},
): Promise<MethodologySealedAnalysisFixture> {
  const repositoryRoot = resolve(".");
  const historical = createHistoricalCase();
  const executionRoot = mkdtempSync(join(tmpdir(), "methodology-sealed-analysis-execution-"));
  const analysisRoot = mkdtempSync(join(tmpdir(), "methodology-sealed-analysis-store-"));
  const judgeRunDirectory = mkdtempSync(join(tmpdir(), "methodology-sealed-analysis-judge-"));
  const prepared: MaterializedHistoricalMethodologyCase[] = [];
  const registration = readHistoricalMethodologyCase(historical.caseDir, POLICY);
  const schedule = scheduleFor(
    registration.caseName,
    registration.truth.registeredRootCount,
    options.seed ?? 101,
    options.repeats ?? 1,
  );
  for (const armId of ["A", "B", "C", "D"] as const) {
    prepared.push(await materializeHistoricalMethodologyCase(registration, schedule, armId, POLICY));
  }
  const rawScope = prepared[0]!.rawScope;
  const runId = options.runId ?? "sealed-analysis-fixture-run";
  const invocationRegistrationSha256 = registerMethodologyInvocations(executionRoot, {
    runId,
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
    const findings = options.findingsForArm?.(attempt.armId) ?? [DEFAULT_FINDING];
    const review = JSON.stringify({ status: "completed", limitations: [], findings });
    const provider = createFakeMethodologyProvider({
      response: ({ schema }) => schema === "methodology-discovery.schema.json" ? DISCOVERY :
        schema === "breadth-result.schema.json" ? BREADTH : review,
    });
    const lifecycle = await runRegisteredHistoricalMethodologyAttempt({
      evidenceRoot: executionRoot,
      invocationRegistrationSha256,
      inputPlanSha256,
      attemptId: attempt.id,
      priorLifecycleReceipts: [...lifecycleReceipts],
      trustedCuratorPolicy: POLICY,
      config: config(),
      attachProvider: provider.attachProvider,
    });
    lifecycleReceipts.push({
      attemptId: attempt.id,
      lifecycleTerminalSha256: lifecycle.lifecycleTerminalSha256,
    });
    if (!lifecycle.reviewTerminalSha256) {
      throw new Error("sealed analysis fixture requires a review terminal");
    }
    terminalReceipts.push({ attemptId: attempt.id, terminalSha256: lifecycle.reviewTerminalSha256 });
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
      verdict: options.judgeVerdict ?? true,
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
  const attemptById = new Map(schedule.attempts.map((attempt) => [attempt.id, attempt]));
  const records = legacy.grades.flatMap((grade) => grade.unmatchedFindings.map(
    (finding): MethodologyAdjudicationRecord => ({
      attemptId: grade.projection.attemptId,
      findingIndex: finding.findingIndex,
      findingEvidenceSha256: finding.findingEvidenceSha256,
      classification: options.classifyUnmatched?.({
        armId: attemptById.get(grade.projection.attemptId)!.armId,
        findingIndex: finding.findingIndex,
      }) ?? "unresolved",
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
  const report = writeMethodologyReportArtifact(analysisRoot, { schedule, gradeSet: legacy, adjudication });
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
    schedule,
    sealed,
    legacy,
    adjudication,
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

export function cleanupMethodologySealedAnalysisFixture(
  value: MethodologySealedAnalysisFixture,
): void {
  value.prepared.forEach((item) => item.cleanup());
  rmSync(value.caseRoot, { recursive: true, force: true });
  rmSync(value.executionRoot, { recursive: true, force: true });
  rmSync(value.analysisRoot, { recursive: true, force: true });
  rmSync(value.judgeRunDirectory, { recursive: true, force: true });
}

export function sealedAnalysisReadInput(
  value: MethodologySealedAnalysisFixture,
  bindingSha256: string,
): MethodologySealedAnalysisBindingReadInputs {
  const { boundAt: _boundAt, ...shared } = value.writeInput;
  return { ...shared, expectedBindingSha256: bindingSha256 };
}

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

function scheduleFor(caseName: string, expectedBugCount: number, seed: number, repeats: number) {
  const base: Omit<MethodologyDesign, "arms"> = {
    schemaVersion: 1,
    protocol: "historical-methodology-v1",
    seed,
    repeats,
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
          configIdentitySha256: methodologyArmConfigIdentitySha256({ design: base, armId, configName }),
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

function git(cwd: string, ...raw: Array<string | { trim: boolean }>): string {
  const options = typeof raw.at(-1) === "object"
    ? raw.pop() as { trim: boolean }
    : { trim: true };
  const output = execFileSync("git", raw as string[], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: join(cwd, ".home"), GIT_CONFIG_NOSYSTEM: "1" },
  });
  return options.trim ? output.trim() : output;
}

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function config(): PeregrineConfig {
  return JSON.parse(readFileSync(resolve("peregrine.config.json"), "utf8")) as PeregrineConfig;
}
