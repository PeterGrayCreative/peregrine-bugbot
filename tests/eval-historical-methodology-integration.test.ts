import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import test from "node:test";
import { leakagePolicyForCase, repositoryFamilyIdentitySha256 } from "../eval/case-isolation.js";
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
  createMethodologyInvocationRecorder,
  readMethodologyInvocation,
  registerMethodologyInvocations,
} from "../eval/methodology-invocations.js";
import { prepareMethodologyLaneActivation } from "../eval/methodology-lane-activation.js";
import { readMethodologyRunSeal, writeMethodologyRunSeal,
  type MethodologyTerminalReceipt } from "../eval/methodology-run-seal.js";
import { runMethodologyAttempt } from "../eval/methodology-runner.js";
import {
  buildMethodologySchedule,
  methodologyArmConfigIdentitySha256,
  type MethodologyDesign,
} from "../eval/methodology-schedule.js";
import { readMethodologyAttemptTerminal, writeMethodologyAttemptTerminal } from "../eval/methodology-terminal.js";
import type { HistoricalCaseSpec, PeregrineConfig, ProviderExec, ReviewContext } from "../src/types.js";

const CURATOR_ONE = "1".repeat(64);
const CURATOR_TWO = "2".repeat(64);
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
    const leakagePolicy = leakagePolicyForCase(fixture.caseDir, fixture.spec);
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
    const recordInvocation = createMethodologyInvocationRecorder(evidenceRoot, registrationSha256);
    const terminalReceipts: MethodologyTerminalReceipt[] = [];
    let mockedStages = 0;

    for (const item of prepared) {
      const armId = item.assetsManifest.armId;
      const attempt = schedule.attempts.find((candidate) =>
        candidate.caseName === registration.caseName && candidate.armId === armId)!;
      const outputs = new Map<string, string>();
      const calls: string[][] = [];
      const runProvider: ProviderExec = async (_command, args) => {
        calls.push([...args]);
        mockedStages++;
        const outputPath = argumentAfter(args, "--output-last-message");
        const schema = basename(argumentAfter(args, "--output-schema"));
        outputs.set(outputPath, schema === "methodology-discovery.schema.json"
          ? DISCOVERY_OUTPUT
          : schema === "breadth-result.schema.json" ? BREADTH_OUTPUT : REVIEW_OUTPUT);
        return { stdout: "", stderr: "", code: 0, timedOut: false };
      };
      const context = reviewContext(item, runProvider, outputs);
      const activation = armId === "B" || armId === "D"
        ? await prepareMethodologyLaneActivation({ armId, context, rawScope: item.rawScope })
        : null;
      if (activation) {
        assert.equal(activation.rawScopeSha256, canonicalJsonSha256(item.rawScope));
        assert.equal(activation.profilePolicy, "no-profile-or-custom-lanes");
      }
      const result = await runMethodologyAttempt({
        schedule,
        attemptId: attempt.id,
        assetManifest: item.assetsManifest,
        rawScope: item.rawScope,
        ...(activation ? { activatedLanes: activation.activatedLanes } : {}),
        leakagePolicy,
        context,
        beforeInvocation: recordInvocation,
      });
      assert.equal(result.outcome.status, "completed");
      assert.equal(calls.length, attempt.expectedStages);
      assert.equal(result.intentReceipts.length, attempt.expectedStages);
      for (const receipt of result.intentReceipts) {
        const invocation = readMethodologyInvocation(
          evidenceRoot,
          registrationSha256,
          attempt.id,
          receipt.stageIndex,
          receipt.invocationSha256,
        );
        assert.equal(invocation.input.compiled.rawScopeSha256, canonicalJsonSha256(item.rawScope));
        assert.equal(invocation.input.compiled.armId, armId);
      }
      const terminalSha256 = writeMethodologyAttemptTerminal(evidenceRoot, registrationSha256, result);
      assert.equal(
        readMethodologyAttemptTerminal(evidenceRoot, registrationSha256, attempt.id, terminalSha256).outcome.status,
        "completed",
      );
      terminalReceipts.push({ attemptId: attempt.id, terminalSha256 });
    }

    terminalReceipts.sort((left, right) =>
      schedule.attempts.findIndex((attempt) => attempt.id === left.attemptId) -
      schedule.attempts.findIndex((attempt) => attempt.id === right.attemptId));
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
  } finally {
    prepared.forEach((item) => item.cleanup());
    rmSync(evidenceRoot, { recursive: true, force: true });
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

function reviewContext(
  item: MaterializedHistoricalMethodologyCase,
  runProvider: ProviderExec,
  outputs: Map<string, string>,
): ReviewContext {
  const value = item.materialized;
  return {
    repoPath: value.repoPath,
    diffPath: value.diffPath,
    diffText: value.diffText,
    baseRef: value.baseRef,
    headRef: value.headRef,
    config: JSON.parse(readFileSync(resolve("peregrine.config.json"), "utf8")) as PeregrineConfig,
    evaluationIsolation: {
      ...value.evaluationIsolation,
      runProvider,
      readProviderOutput: (path) => outputs.get(path)!,
    },
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
      description: "The changed retry path omits callback completion.",
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
