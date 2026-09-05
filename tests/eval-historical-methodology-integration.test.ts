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
import {
  materializeHistoricalMethodologyCase,
  readHistoricalMethodologyCase,
  type MaterializedHistoricalMethodologyCase,
} from "../eval/historical-methodology-case.js";
import { historicalPermittedMetrics, parseHistoricalGroundTruth } from "../eval/historical-truth.js";
import {
  readMethodologyInvocation,
  registerMethodologyInvocations,
} from "../eval/methodology-invocations.js";
import { prepareMethodologyLaneActivation } from "../eval/methodology-lane-activation.js";
import { registerMethodologyInputPlan } from "../eval/methodology-input-plan.js";
import { readMethodologyAttemptLifecycleTerminal } from "../eval/methodology-attempt-lifecycle.js";
import { runRegisteredHistoricalMethodologyAttempt } from "../eval/historical-methodology-runner.js";
import { readMethodologyExecutionEvidence, writeMethodologyExecutionEvidence,
  type MethodologyLifecycleSealReceipt } from "../eval/methodology-execution-evidence.js";
import { readMethodologyRunSeal, writeMethodologyRunSeal,
  type MethodologyTerminalReceipt } from "../eval/methodology-run-seal.js";
import {
  buildMethodologySchedule,
  methodologyArmConfigIdentitySha256,
  type MethodologyDesign,
} from "../eval/methodology-schedule.js";
import { readMethodologyAttemptTerminal } from "../eval/methodology-terminal.js";
import type { HistoricalCaseSpec, PeregrineConfig, ProviderExec, ReviewContext } from "../src/types.js";

const CURATOR_ONE = "1".repeat(64);
const CURATOR_TWO = "2".repeat(64);
const TRUTH_CANARY = "CURATOR_ONLY_TRUTH_CANARY_7f9c2a";
const REVIEW_OUTPUT = JSON.stringify({ status: "completed", limitations: [], findings: [] });
const DISCOVERY_OUTPUT = JSON.stringify({
  status: "completed",
  limitations: [],
  candidates: [{
    file: "src/retry.ts",
    startLine: 1,
    endLine: 1,
    hypothesis: "The changed callback path may no longer notify its caller.",
    evidenceNeeded: "Trace callers that rely on callback completion.",
  }],
});
const BREADTH_OUTPUT = JSON.stringify({
  model: "gpt-5.6-sol",
  candidates: [],
  clear: [],
  escalations: [],
  coverage: { coveredFiles: ["src/retry.ts"], unavailable: [] },
});
const TRUSTED_POLICY: CuratorPolicy = {
  schemaVersion: 1,
  policyId: "protected-git-review-v1",
  trustRoot: "protected-git-review",
  minimumIndependentConfirmations: 2,
  curatorIdentitySha256s: [CURATOR_ONE, CURATOR_TWO],
};

test("an admitted synthetic historical case reaches a terminal-complete four-arm mocked run", async () => {
  const fixture = createHistoricalFixture();
  const evidenceRoot = mkdtempSync(join(tmpdir(), "peregrine-historical-methodology-run-"));
  const prepared: MaterializedHistoricalMethodologyCase[] = [];
  try {
    const registration = readHistoricalMethodologyCase(fixture.caseDir, TRUSTED_POLICY);
    const schedule = buildSchedule(registration.caseName, registration.truth.registeredRootCount);
    for (const armId of ["A", "B", "C", "D"] as const) {
      prepared.push(await materializeHistoricalMethodologyCase(
        registration,
        schedule,
        armId,
        TRUSTED_POLICY,
      ));
    }

    const referenceScope = prepared[0]!.rawScope;
    assert.ok(prepared.every((item) =>
      canonicalJsonSha256(item.rawScope) === canonicalJsonSha256(referenceScope)));
    assert.ok(prepared.every((item) =>
      item.admissionBinding.registrationSha256 === registration.registrationSha256));
    assert.ok(prepared.every((item) => item.registration.activatedLanes === null));

    const registrationSha256 = registerMethodologyInvocations(evidenceRoot, {
      runId: "synthetic-historical-four-arm-zero-provider",
      schedule,
      scopeSha256ByCase: { [registration.caseName]: canonicalJsonSha256(referenceScope) },
      assetsByArm: prepared.map((item) => item.assetsManifest),
    });
    const planContext = reviewContext(prepared.find((item) => item.assetsManifest.armId === "B")!);
    const activation = await prepareMethodologyLaneActivation({
      armId: "B",
      context: planContext,
      rawScope: referenceScope,
    });
    const inputPlanSha256 = await registerMethodologyInputPlan(evidenceRoot, {
      invocationRegistrationSha256: registrationSha256,
      cases: [{
        historicalRegistration: registration,
        admissionBinding: prepared[0]!.admissionBinding,
        rawScope: referenceScope,
        laneActivation: activation,
      }],
    });
    const terminalReceipts: MethodologyTerminalReceipt[] = [];
    const lifecycleReceipts: MethodologyLifecycleSealReceipt[] = [];
    let mockedStages = 0;
    const modelVisibleBytes: string[] = [];

    let skippedAttachCalled = false;
    await assert.rejects(() => runRegisteredHistoricalMethodologyAttempt({
      evidenceRoot,
      invocationRegistrationSha256: registrationSha256,
      inputPlanSha256,
      attemptId: schedule.attempts[1]!.id,
      priorLifecycleReceipts: [],
      trustedCuratorPolicy: TRUSTED_POLICY,
      config: config(),
      attachProvider: () => {
        skippedAttachCalled = true;
        throw new Error("must not attach");
      },
    }), /exact preceding schedule prefix/);
    assert.equal(skippedAttachCalled, false);
    assert.equal(existsSync(join(evidenceRoot,
      `${schedule.attempts[1]!.id}.methodology-start.json`)), false);

    for (const attempt of schedule.attempts) {
      const armId = attempt.armId;
      const scheduleIndex = schedule.attempts.indexOf(attempt);
      if (scheduleIndex === 1) {
        const stalePrefix = structuredClone(lifecycleReceipts);
        stalePrefix[0]!.lifecycleTerminalSha256 = "f".repeat(64);
        await assert.rejects(() => runRegisteredHistoricalMethodologyAttempt({
          evidenceRoot,
          invocationRegistrationSha256: registrationSha256,
          inputPlanSha256,
          attemptId: attempt.id,
          priorLifecycleReceipts: stalePrefix,
          trustedCuratorPolicy: TRUSTED_POLICY,
          config: config(),
          attachProvider: () => { throw new Error("must not attach"); },
        }), /digest mismatch/);
        assert.equal(existsSync(join(evidenceRoot,
          `${attempt.id}.methodology-start.json`)), false);
      }
      if (scheduleIndex === 2) {
        await assert.rejects(() => runRegisteredHistoricalMethodologyAttempt({
          evidenceRoot,
          invocationRegistrationSha256: registrationSha256,
          inputPlanSha256,
          attemptId: attempt.id,
          priorLifecycleReceipts: [...lifecycleReceipts].reverse(),
          trustedCuratorPolicy: TRUSTED_POLICY,
          config: config(),
          attachProvider: () => { throw new Error("must not attach"); },
        }), /reordered or stale/);
        assert.equal(existsSync(join(evidenceRoot,
          `${attempt.id}.methodology-start.json`)), false);
      }
      const calls: string[][] = [];
      const outputs = new Map<string, string>();
      let attachedRepoPath = "";
      const lifecycle = await runRegisteredHistoricalMethodologyAttempt({
        evidenceRoot,
        invocationRegistrationSha256: registrationSha256,
        inputPlanSha256,
        attemptId: attempt.id,
        priorLifecycleReceipts: [...lifecycleReceipts],
        trustedCuratorPolicy: TRUSTED_POLICY,
        config: config(),
        attachProvider: (request) => {
          attachedRepoPath = request.repoPath;
          assert.equal(request.armId, armId);
          assert.doesNotMatch(JSON.stringify(request), new RegExp(escapeRegex(evidenceRoot)));
          assert.doesNotMatch(JSON.stringify(request), new RegExp(escapeRegex(fixture.caseDir)));
          const manifest = prepared.find((item) => item.assetsManifest.armId === armId)!.assetsManifest;
          for (const file of manifest.files) {
            modelVisibleBytes.push(readFileSync(join(request.providerAssetsRoot, ...file.path.split("/")), "utf8"));
          }
          const runProvider: ProviderExec = async (_command, args, options) => {
            calls.push([...args]);
            mockedStages++;
            modelVisibleBytes.push(options?.stdin ?? "");
            const outputPath = argumentAfter(args, "--output-last-message");
            const schema = basename(argumentAfter(args, "--output-schema"));
            outputs.set(outputPath, schema === "methodology-discovery.schema.json"
              ? DISCOVERY_OUTPUT
              : schema === "breadth-result.schema.json" ? BREADTH_OUTPUT : REVIEW_OUTPUT);
            return { stdout: "", stderr: "", code: 0, timedOut: false };
          };
          return { runProvider, readProviderOutput: (path: string) => outputs.get(path)! };
        },
      });
      assert.ok(attachedRepoPath);
      assert.equal(existsSync(attachedRepoPath), false);
      assert.equal(lifecycle.status, "review-terminal");
      assert.equal(calls.length, attempt.expectedStages);
      assert.equal(lifecycle.dispatchReceipts.length, attempt.expectedStages);
      const lifecycleRecord = readMethodologyAttemptLifecycleTerminal(
        evidenceRoot, registrationSha256, attempt.id, lifecycle.lifecycleTerminalSha256,
      );
      const result = readMethodologyAttemptTerminal(
        evidenceRoot, registrationSha256, attempt.id, lifecycle.reviewTerminalSha256!,
      );
      assert.equal(result.outcome.status, "completed");
      for (const receipt of result.intentReceipts) {
        const invocation = readMethodologyInvocation(
          evidenceRoot,
          registrationSha256,
          attempt.id,
          receipt.stageIndex,
          receipt.invocationSha256,
        );
        assert.equal(invocation.input.compiled.rawScopeSha256, canonicalJsonSha256(referenceScope));
        assert.equal(invocation.input.compiled.armId, armId);
      }
      assert.equal(lifecycleRecord.reviewTerminalSha256, lifecycle.reviewTerminalSha256);
      terminalReceipts.push({ attemptId: attempt.id, terminalSha256: lifecycle.reviewTerminalSha256! });
      lifecycleReceipts.push({ attemptId: attempt.id,
        lifecycleTerminalSha256: lifecycle.lifecycleTerminalSha256 });
    }

    assert.deepEqual(lifecycleReceipts.map((receipt) => receipt.attemptId),
      schedule.attempts.map((attempt) => attempt.id));
    assert.equal(mockedStages, 6);
    const sealSha256 = writeMethodologyRunSeal(evidenceRoot, registrationSha256, terminalReceipts);
    const seal = readMethodologyRunSeal(evidenceRoot, registrationSha256, sealSha256);
    assert.deepEqual(seal.attemptAccounting, {
      scheduled: 4,
      terminal: 4,
      executionCompleted: 4,
      executionFailed: 0,
    });
    assert.equal(seal.claims.providerContact, "not-established-by-this-seal");
    assert.equal(seal.claims.efficacy, "not-evaluated-by-this-seal");
    assert.equal(seal.artifactBindings.filter((item) => item.path.endsWith(".input.json")).length, 6);
    const executionEvidenceSha256 = writeMethodologyExecutionEvidence(evidenceRoot, {
      invocationRegistrationSha256: registrationSha256,
      inputPlanSha256,
      terminalRunSealSha256: sealSha256,
      lifecycleReceipts,
    });
    const executionEvidence = readMethodologyExecutionEvidence(evidenceRoot, executionEvidenceSha256);
    assert.deepEqual(executionEvidence.accounting, {
      scheduled: 4,
      reviewTerminal: 4,
      preflightFailed: 0,
      interrupted: 0,
    });
    assert.equal(executionEvidence.claims.providerContact, "not-established");
    assert.throws(() => writeMethodologyExecutionEvidence(evidenceRoot, {
      invocationRegistrationSha256: registrationSha256,
      inputPlanSha256,
      terminalRunSealSha256: sealSha256,
      lifecycleReceipts: lifecycleReceipts.slice(0, -1),
    }), /every scheduled lifecycle/);
    assert.throws(() => readMethodologyExecutionEvidence(evidenceRoot, "f".repeat(64)), /digest mismatch/);
    const lifecyclePath = join(evidenceRoot,
      `${lifecycleReceipts[0]!.attemptId}.methodology-lifecycle-terminal.json`);
    const lifecycleBytes = readFileSync(lifecyclePath);
    try {
      rmSync(lifecyclePath);
      assert.throws(() => readMethodologyExecutionEvidence(evidenceRoot, executionEvidenceSha256),
        /ENOENT|no such file/i);
    } finally {
      writeFileSync(lifecyclePath, lifecycleBytes);
    }
    writeFileSync(join(evidenceRoot, "orphan.json"), "{}\n");
    assert.throws(() => readMethodologyExecutionEvidence(evidenceRoot, executionEvidenceSha256),
      /orphaned artifacts/);
    rmSync(join(evidenceRoot, "orphan.json"));
    writeFileSync(lifecyclePath, Buffer.concat([lifecycleBytes, Buffer.from("\n")]));
    assert.throws(() => readMethodologyExecutionEvidence(evidenceRoot, executionEvidenceSha256),
      /does not derive from its sealed inputs/);
    writeFileSync(lifecyclePath, lifecycleBytes);
    assert.throws(() => writeMethodologyExecutionEvidence(evidenceRoot, {
      invocationRegistrationSha256: registrationSha256,
      inputPlanSha256: "f".repeat(64),
      terminalRunSealSha256: sealSha256,
      lifecycleReceipts,
    }), /input plan digest mismatch|digest mismatch/);
    assert.ok(modelVisibleBytes.length > 6);
    for (const bytes of modelVisibleBytes) {
      assert.doesNotMatch(bytes, new RegExp(TRUTH_CANARY));
      assert.doesNotMatch(bytes, new RegExp(escapeRegex(evidenceRoot)));
      assert.doesNotMatch(bytes, new RegExp(escapeRegex(fixture.caseDir)));
    }
  } finally {
    prepared.forEach((item) => item.cleanup());
    rmSync(evidenceRoot, { recursive: true, force: true });
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

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

function createHistoricalFixture(): { root: string; caseDir: string; spec: HistoricalCaseSpec } {
  const root = mkdtempSync(join(tmpdir(), "peregrine-historical-methodology-integration-"));
  const source = join(root, "source");
  const caseDir = join(root, "cases", "development", "case-abababab");
  mkdirSync(join(source, "src"), { recursive: true });
  git(source, "init", "--quiet", "--initial-branch=main");
  git(source, "config", "user.name", "Structural Test Curator");
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
  const truthValue = {
    schemaVersion: 2,
    scope: {
      protocol: "historical-efficacy-v1",
      truthVersion: "truth-v1",
      status: "known-roots",
      completeness: "partial",
      reviewedScope: "The changed retry callback and its directly observable completion behavior.",
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
      description: `The changed retry path omits callback completion. ${TRUTH_CANARY}`,
      reachablePreconditions: "A caller supplies a completion callback.",
      observableImpact: "The caller remains pending.",
      provenance: "The exact historical head and repair support this declared root.",
    }],
  };
  writeFileSync(join(caseDir, "ground_truth.json"), JSON.stringify(truthValue));
  writeFileSync(join(caseDir, "proof.md"), "Structural static trace fixture; not a real admission claim.\n");
  writeAdmittedCuration(caseDir, spec, diff);
  return { root, caseDir, spec };
}

function writeAdmittedCuration(caseDir: string, spec: HistoricalCaseSpec, diff: string): void {
  const truth = parseHistoricalGroundTruth(JSON.parse(readFileSync(join(caseDir, "ground_truth.json"), "utf8")));
  const proof = readFileSync(join(caseDir, "proof.md"), "utf8");
  const scopeSha256 = historicalTruthScopeSha256(truth);
  const curation: any = {
    schemaVersion: 2,
    protocol: "historical-efficacy-v1",
    caseId: spec.id,
    status: "admitted",
    curatorPolicyId: TRUSTED_POLICY.policyId,
    truth: { truthVersion: truth.scope.truthVersion, status: truth.scope.status,
      completeness: "partial", scopeSha256 },
    source: { kind: "historical", repositoryAlias: "structural-fixture",
      repositoryIdentitySha256: repositoryFamilyIdentitySha256("sha1", [spec.baseCommit]),
      changeIdentitySha256: sha256(diff), access: "public" },
    strata: { languageFamily: "typescript", architectureFamily: "library", size: "small",
      changeShapes: ["direct"], secondarySurfaceLanes: [], mechanismFamilies: ["callback-loss"] },
    proof: { kind: "reasoned-analysis", artifact: "proof.md", sha256: sha256(proof) },
    confirmations: [CURATOR_ONE, CURATOR_TWO].map((curatorIdentitySha256, index) => ({
      curatorIdentitySha256,
      confirmedAt: `2026-09-05T1${index}:00:00.000Z`,
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

function buildSchedule(caseName: string, expectedBugCount: number) {
  const withoutArms: Omit<MethodologyDesign, "arms"> = {
    schemaVersion: 1,
    protocol: "historical-methodology-v1",
    seed: 97,
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
      ...withoutArms,
      arms: (["A", "B", "C", "D"] as const).map((armId) => {
        const configName = `methodology-${armId.toLowerCase()}`;
        return { armId, configName, configIdentitySha256: methodologyArmConfigIdentitySha256({
          design: withoutArms, armId, configName,
        }) };
      }),
    },
    cases: [{ caseName, corpus: "development", expectedBugCount }],
  });
}

function argumentAfter(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1, `${flag} must be present`);
  return args[index + 1]!;
}

function git(cwd: string, ...raw: Array<string | { trim: boolean }>): string {
  const options = typeof raw.at(-1) === "object" ? raw.pop() as { trim: boolean } : { trim: true };
  const output = execFileSync("git", raw as string[], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: join(cwd, ".home"), GIT_CONFIG_NOSYSTEM: "1" },
  });
  return options.trim ? output.trim() : output;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function config(): PeregrineConfig {
  return JSON.parse(readFileSync(resolve("peregrine.config.json"), "utf8")) as PeregrineConfig;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
