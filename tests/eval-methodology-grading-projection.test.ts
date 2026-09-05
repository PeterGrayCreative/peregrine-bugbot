import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import test from "node:test";
import { repositoryFamilyIdentitySha256 } from "../eval/case-isolation.js";
import type { CuratorPolicy } from "../eval/case-curation.js";
import { canonicalJsonSha256 } from "../eval/experiment.js";
import {
  historicalCaseBundleSha256,
  historicalTruthScopeSha256,
  parseHistoricalCuration,
  requiredHistoricalConfirmationChecks,
} from "../eval/historical-curation.js";
import { materializeHistoricalMethodologyCase, readHistoricalMethodologyCase,
  type MaterializedHistoricalMethodologyCase } from "../eval/historical-methodology-case.js";
import { runRegisteredHistoricalMethodologyAttempt } from "../eval/historical-methodology-runner.js";
import { writeMethodologyExecutionEvidence, type MethodologyLifecycleSealReceipt } from "../eval/methodology-execution-evidence.js";
import { gradeMethodologyAttempt } from "../eval/methodology-grading-contract.js";
import { readMethodologyGradingProjections,
  METHODOLOGY_GRADING_PROJECTION_READER_BOUNDARY } from "../eval/methodology-grading-projection.js";
import { registerMethodologyInputPlan } from "../eval/methodology-input-plan.js";
import { registerMethodologyInvocations } from "../eval/methodology-invocations.js";
import { prepareMethodologyLaneActivation } from "../eval/methodology-lane-activation.js";
import { historicalPermittedMetrics, parseHistoricalGroundTruth } from "../eval/historical-truth.js";
import { buildMethodologySchedule, methodologyArmConfigIdentitySha256,
  type MethodologyDesign } from "../eval/methodology-schedule.js";
import type { HistoricalCaseSpec, PeregrineConfig, ProviderExec, ReviewContext } from "../src/types.js";

const CURATORS = ["1".repeat(64), "2".repeat(64)];
const POLICY: CuratorPolicy = { schemaVersion: 1, policyId: "protected-git-review-v1",
  trustRoot: "protected-git-review", minimumIndependentConfirmations: 2,
  curatorIdentitySha256s: CURATORS };
const REVIEW = JSON.stringify({ status: "completed", limitations: [], findings: [{
  file: "src/retry.ts", startLine: 1, endLine: 1,
  explanation: "The changed path no longer invokes the completion callback.",
  impact: "The caller remains pending.", severity: "high",
}] });
const UNABLE_REVIEW = JSON.stringify({ status: "unable-to-complete",
  limitations: ["A required caller was unavailable in the contained source."], findings: [{
    file: "src/retry.ts", startLine: 1, endLine: 1,
    explanation: "The changed path may omit the completion callback.",
    impact: "The caller may remain pending.", severity: "high",
  }] });
const DISCOVERY = JSON.stringify({ status: "completed", limitations: [], candidates: [{
  file: "src/retry.ts", startLine: 1, endLine: 1,
  hypothesis: "The callback may no longer be invoked.", evidenceNeeded: "Trace the changed callback path.",
}] });
const BREADTH = JSON.stringify({ model: "gpt-5.6-sol", candidates: [], clear: [], escalations: [],
  coverage: { coveredFiles: ["src/retry.ts"], unavailable: [] } });

test("authenticated projection preserves all scheduled outcomes and never upgrades unverified scope", async () => {
  const fixture = createFixture();
  const evidenceRoot = mkdtempSync(join(tmpdir(), "peregrine-methodology-projection-"));
  const prepared: MaterializedHistoricalMethodologyCase[] = [];
  try {
    const caseRegistration = readHistoricalMethodologyCase(fixture.caseDir, POLICY);
    const schedule = scheduleFor(caseRegistration.caseName, caseRegistration.truth.registeredRootCount);
    for (const armId of ["A", "B", "C", "D"] as const) {
      prepared.push(await materializeHistoricalMethodologyCase(caseRegistration, schedule, armId, POLICY));
    }
    const rawScope = prepared[0]!.rawScope;
    const registrationSha256 = registerMethodologyInvocations(evidenceRoot, {
      runId: "projection-reader-mixed-outcomes",
      schedule,
      scopeSha256ByCase: { [caseRegistration.caseName]: canonicalJsonSha256(rawScope) },
      assetsByArm: prepared.map((item) => item.assetsManifest),
    });
    const activation = await prepareMethodologyLaneActivation({ armId: "B",
      context: reviewContext(prepared.find((item) => item.assetsManifest.armId === "B")!), rawScope });
    const inputPlanSha256 = await registerMethodologyInputPlan(evidenceRoot, {
      invocationRegistrationSha256: registrationSha256,
      cases: [{ historicalRegistration: caseRegistration, admissionBinding: prepared[0]!.admissionBinding,
        rawScope, laneActivation: activation }],
    });

    const lifecycleReceipts: MethodologyLifecycleSealReceipt[] = [];
    for (const attempt of schedule.attempts) {
      const outputs = new Map<string, string>();
      const lifecycle = await runRegisteredHistoricalMethodologyAttempt({
        evidenceRoot,
        invocationRegistrationSha256: registrationSha256,
        inputPlanSha256,
        attemptId: attempt.id,
        priorLifecycleReceipts: [...lifecycleReceipts],
        trustedCuratorPolicy: POLICY,
        config: config(),
        attachProvider: () => {
          if (attempt.armId === "B") throw new Error("synthetic preflight failure");
          const runProvider: ProviderExec = async (_command, args) => {
            if (attempt.armId === "D") {
              const blocker = join(evidenceRoot, `${attempt.id}.methodology-terminal.json`);
              if (!existsSync(blocker)) writeFileSync(blocker, "{}\n");
            }
            const outputPath = argumentAfter(args, "--output-last-message");
            const schema = basename(argumentAfter(args, "--output-schema"));
            outputs.set(outputPath, schema === "methodology-discovery.schema.json" ? DISCOVERY :
              schema === "breadth-result.schema.json" ? BREADTH :
                attempt.armId === "C" && attempt.repeat === 1 ? UNABLE_REVIEW : REVIEW);
            return { stdout: "", stderr: "",
              code: attempt.armId === "C" && attempt.repeat === 2 ? 1 : 0, timedOut: false };
          };
          return { runProvider, readProviderOutput: (path: string) => outputs.get(path)! };
        },
      });
      if (attempt.armId === "D") rmSync(join(evidenceRoot, `${attempt.id}.methodology-terminal.json`), { force: true });
      lifecycleReceipts.push({ attemptId: attempt.id,
        lifecycleTerminalSha256: lifecycle.lifecycleTerminalSha256 });
    }

    const executionEvidenceSha256 = writeMethodologyExecutionEvidence(evidenceRoot, {
      invocationRegistrationSha256: registrationSha256,
      inputPlanSha256,
      terminalRunSealSha256: null,
      lifecycleReceipts,
    });
    const result = readMethodologyGradingProjections({ root: evidenceRoot,
      expectedExecutionEvidenceSha256: executionEvidenceSha256, trustedCuratorPolicy: POLICY });

    assert.deepEqual(result.projections.map((item) => item.projection.attemptId),
      schedule.attempts.map((attempt) => attempt.id));
    const byArmRepeat = Object.fromEntries(schedule.attempts.map((attempt, index) =>
      [`${attempt.armId}-${attempt.repeat}`, result.projections[index]!]));
    assert.deepEqual(Object.fromEntries(Object.entries(byArmRepeat).map(([key, item]) =>
      [key, [item.projection.status, item.projection.statusReason]])), {
      "A-1": ["incomplete", "runner-scope-unverified"],
      "A-2": ["incomplete", "runner-scope-unverified"],
      "B-1": ["failed", "preflight-failed"],
      "B-2": ["failed", "preflight-failed"],
      "C-1": ["incomplete", "model-unable-to-complete"],
      "C-2": ["failed", "review-execution-failed"],
      "D-1": ["failed", "interrupted"],
      "D-2": ["failed", "interrupted"],
    });
    assert.equal(byArmRepeat["A-1"]!.reviewOutput?.status, "completed");
    assert.equal(byArmRepeat["A-1"]!.reviewRawOutput, REVIEW);
    assert.equal(byArmRepeat["A-1"]!.projection.reviewRawOutputSha256, sha256(REVIEW));
    assert.equal(byArmRepeat["A-1"]!.projection.reviewTerminalSha256 === null, false);
    assert.equal(byArmRepeat["B-1"]!.projection.reviewTerminalSha256, null);
    assert.equal(byArmRepeat["C-1"]!.projection.reviewTerminalSha256 === null, false);
    assert.equal(byArmRepeat["C-1"]!.reviewRawOutput, UNABLE_REVIEW);
    assert.equal(byArmRepeat["C-1"]!.reviewOutput?.status, "unable-to-complete");
    assert.equal(byArmRepeat["C-2"]!.reviewOutput, null);
    assert.equal(byArmRepeat["C-2"]!.projection.reviewTerminalSha256 === null, false);
    assert.equal(byArmRepeat["D-1"]!.projection.reviewTerminalSha256, null);
    assert.ok(result.projections.every((item) => item.projection.lifecycleTerminalSha256 !== null));
    assert.ok(result.projections.every((item) => item.projection.executionEvidenceSha256 === executionEvidenceSha256));

    const modelCompleted = byArmRepeat["A-1"]!;
    const grade = gradeMethodologyAttempt({ projection: modelCompleted.projection,
      expectedProjectionSha256: modelCompleted.projectionSha256, truth: modelCompleted.truth,
      reviewOutput: modelCompleted.reviewOutput, judgeConfigSha256: "a".repeat(64), pairVerdicts: [] });
    assert.deepEqual(Object.values(grade.rootCauseMatches), [false]);
    assert.deepEqual(Object.values(grade.rootMissAttribution), ["unattributed"]);
    assert.equal(grade.unmatchedFindings[0]?.classification, "unresolved");
    assert.equal(grade.completion.incomplete, 1);
    assert.equal(grade.completion.scheduled, 1);
    assert.equal(grade.claims.globalCleanliness, "not-established");
    assert.match(METHODOLOGY_GRADING_PROJECTION_READER_BOUNDARY, /never inferred from absent files/);

    assert.throws(() => readMethodologyGradingProjections({ root: evidenceRoot,
      expectedExecutionEvidenceSha256: "f".repeat(64), trustedCuratorPolicy: POLICY }), /digest mismatch/);
    const evidencePath = join(evidenceRoot, "methodology-execution-evidence.json");
    const evidenceBytes = readFileSync(evidencePath);
    rmSync(evidencePath);
    assert.throws(() => readMethodologyGradingProjections({ root: evidenceRoot,
      expectedExecutionEvidenceSha256: executionEvidenceSha256, trustedCuratorPolicy: POLICY }), /ENOENT|no such file/i);
    writeFileSync(evidencePath, evidenceBytes);

    const terminalPath = join(evidenceRoot,
      `${byArmRepeat["A-1"]!.projection.attemptId}.methodology-terminal.json`);
    const terminalBytes = readFileSync(terminalPath);
    writeFileSync(terminalPath, Buffer.concat([terminalBytes, Buffer.from("\n")]));
    assert.throws(() => readMethodologyGradingProjections({ root: evidenceRoot,
      expectedExecutionEvidenceSha256: executionEvidenceSha256, trustedCuratorPolicy: POLICY }), /sealed inputs/);
    writeFileSync(terminalPath, terminalBytes);

    const truthPath = join(fixture.caseDir, "ground_truth.json");
    const truthBytes = readFileSync(truthPath);
    const changedTruth = JSON.parse(truthBytes.toString("utf8"));
    changedTruth.bugs[0].description = "A same-scope but unauthenticated replacement root.";
    writeFileSync(truthPath, JSON.stringify(changedTruth));
    assert.throws(() => readMethodologyGradingProjections({ root: evidenceRoot,
      expectedExecutionEvidenceSha256: executionEvidenceSha256, trustedCuratorPolicy: POLICY }),
    /case bundle|authenticate the current historical case bundle/);
    writeFileSync(truthPath, truthBytes);
  } finally {
    prepared.forEach((item) => item.cleanup());
    rmSync(evidenceRoot, { recursive: true, force: true });
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "peregrine-methodology-projection-case-"));
  const source = join(root, "source");
  const caseDir = join(root, "cases", "development", "case-abababab");
  mkdirSync(join(source, "src"), { recursive: true });
  mkdirSync(join(source, ".home"));
  git(source, "init", "--quiet", "--initial-branch=main");
  git(source, "config", "user.name", "Projection Test Curator");
  git(source, "config", "user.email", "curator@example.invalid");
  writeFileSync(join(source, "src/retry.ts"), "export const retry = (done: () => void) => done();\n");
  git(source, "add", ".");
  git(source, "commit", "--quiet", "-m", "base");
  const base = git(source, "rev-parse", "HEAD");
  writeFileSync(join(source, "src/retry.ts"), "export const retry = (_done: () => void) => undefined;\n");
  git(source, "add", ".");
  git(source, "commit", "--quiet", "-m", "head");
  const head = git(source, "rev-parse", "HEAD");
  const diff = git(source, "diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv",
    "--no-color", "--find-renames", `${base}...${head}`, "--", { trim: false });
  mkdirSync(caseDir, { recursive: true });
  const spec: HistoricalCaseSpec = { id: "case-abababab", corpus: "development", kind: "historical",
    evaluationProtocol: "historical-efficacy-v1", repoSource: source, baseCommit: base, headCommit: head,
    diffFile: "diff.patch", metadataFile: "metadata.json" };
  writeFileSync(join(caseDir, "case.json"), JSON.stringify(spec));
  writeFileSync(join(caseDir, "diff.patch"), diff);
  writeFileSync(join(caseDir, "metadata.json"), JSON.stringify({ title: "Preserve retry completion",
    body: "Review the callback behavior introduced by this change." }));
  writeFileSync(join(caseDir, "ground_truth.json"), JSON.stringify({ schemaVersion: 2,
    scope: { protocol: "historical-efficacy-v1", truthVersion: "truth-v1", status: "known-roots",
      completeness: "partial", reviewedScope: "The changed retry callback only.",
      permittedMetrics: historicalPermittedMetrics("known-roots") },
    bugs: [{ id: "bug-abababab", lane: "other-unclassified", mechanismFamily: "callback-loss",
      proofLevel: "complete-static-trace", expectedDisposition: "fix-in-pr", expectedSeverity: "high",
      file: "src/retry.ts", startLine: 1, endLine: 1,
      description: "The changed retry path omits callback completion.",
      reachablePreconditions: "A caller supplies a completion callback.",
      observableImpact: "The caller remains pending.", provenance: "Synthetic static trace evidence." }] }));
  writeFileSync(join(caseDir, "proof.md"), "Synthetic static trace fixture.\n");
  writeCuration(caseDir, spec, diff);
  return { root, caseDir };
}

function writeCuration(caseDir: string, spec: HistoricalCaseSpec, diff: string): void {
  const truth = parseHistoricalGroundTruth(JSON.parse(readFileSync(join(caseDir, "ground_truth.json"), "utf8")));
  const scopeSha256 = historicalTruthScopeSha256(truth);
  const curation: any = { schemaVersion: 2, protocol: "historical-efficacy-v1", caseId: spec.id,
    status: "admitted", curatorPolicyId: POLICY.policyId,
    truth: { truthVersion: truth.scope.truthVersion, status: truth.scope.status, completeness: "partial", scopeSha256 },
    source: { kind: "historical", repositoryAlias: "projection-fixture",
      repositoryIdentitySha256: repositoryFamilyIdentitySha256("sha1", [spec.baseCommit]),
      changeIdentitySha256: sha256(diff), access: "public" },
    strata: { languageFamily: "typescript", architectureFamily: "library", size: "small",
      changeShapes: ["direct"], secondarySurfaceLanes: [], mechanismFamilies: ["callback-loss"] },
    proof: { kind: "reasoned-analysis", artifact: "proof.md",
      sha256: sha256(readFileSync(join(caseDir, "proof.md"), "utf8")) },
    confirmations: CURATORS.map((curatorIdentitySha256, index) => ({ curatorIdentitySha256,
      confirmedAt: `2026-09-05T1${index}:00:00.000Z`, caseBundleSha256: "0".repeat(64), truthScopeSha256: scopeSha256,
      checks: requiredHistoricalConfirmationChecks("known-roots") })) };
  const parsed = parseHistoricalCuration(curation, spec, truth);
  const bundle = historicalCaseBundleSha256(caseDir, spec, parsed);
  for (const confirmation of curation.confirmations) confirmation.caseBundleSha256 = bundle;
  writeFileSync(join(caseDir, "curation.json"), JSON.stringify(curation));
}

function scheduleFor(caseName: string, expectedBugCount: number) {
  const base: Omit<MethodologyDesign, "arms"> = { schemaVersion: 1, protocol: "historical-methodology-v1",
    seed: 97, repeats: 2, callerConfig: { runner: "codex", model: "gpt-5.6-sol", effort: "high",
      identitySha256: "a".repeat(64) }, totalDeadlineMs: 60_000,
    twoWorkerStageSplit: { discoveryDeadlineMs: 20_000, reviewerDeadlineMs: 40_000 } };
  return buildMethodologySchedule({ design: { ...base, arms: (["A", "B", "C", "D"] as const).map((armId) => {
    const configName = `methodology-${armId.toLowerCase()}`;
    return { armId, configName, configIdentitySha256: methodologyArmConfigIdentitySha256({
      design: base, armId, configName }) };
  }) }, cases: [{ caseName, corpus: "development", expectedBugCount }] });
}

function reviewContext(item: MaterializedHistoricalMethodologyCase): ReviewContext {
  const value = item.materialized;
  return { repoPath: value.repoPath, diffPath: value.diffPath, diffText: value.diffText,
    baseRef: value.baseRef, headRef: value.headRef, config: config(),
    evaluationIsolation: value.evaluationIsolation };
}
function argumentAfter(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1);
  return args[index + 1]!;
}
function git(cwd: string, ...raw: Array<string | { trim: boolean }>): string {
  const options = typeof raw.at(-1) === "object" ? raw.pop() as { trim: boolean } : { trim: true };
  const output = execFileSync("git", raw as string[], { cwd, encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: join(cwd, ".home"), GIT_CONFIG_NOSYSTEM: "1" } });
  return options.trim ? output.trim() : output;
}
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function config(): PeregrineConfig {
  return JSON.parse(readFileSync(resolve("peregrine.config.json"), "utf8")) as PeregrineConfig;
}
