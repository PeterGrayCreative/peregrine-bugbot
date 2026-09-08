import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
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
  readMethodologyInputPlan,
  registerMethodologyInputPlan,
  verifyMethodologyInputPlanPreparation,
  verifyMethodologyPlannedInvocation,
} from "../eval/methodology-input-plan.js";
import { registerMethodologyInvocations, type MethodologyInvocationInput } from "../eval/methodology-invocations.js";
import { prepareMethodologyLaneActivation, type MethodologyLaneActivation } from "../eval/methodology-lane-activation.js";
import {
  compileMethodologyDiscoveryPrompt,
  compileMethodologyReviewPrompt,
  type CompiledMethodologyPrompt,
} from "../eval/methodology-prompts.js";
import {
  buildMethodologySchedule,
  methodologyArmConfigIdentitySha256,
  type MethodologyArmId,
  type MethodologyDesign,
  type MethodologySchedule,
} from "../eval/methodology-schedule.js";
import type { HistoricalCaseSpec, PeregrineConfig, ReviewContext } from "../src/types.js";

const CURATOR_ONE = "1".repeat(64);
const CURATOR_TWO = "2".repeat(64);
const TRUSTED_POLICY: CuratorPolicy = {
  schemaVersion: 1,
  policyId: "protected-git-review-v1",
  trustRoot: "protected-git-review",
  minimumIndependentConfirmations: 2,
  curatorIdentitySha256s: [CURATOR_ONE, CURATOR_TWO],
};
const DISCOVERY_HANDOFF = {
  status: "completed" as const,
  limitations: [],
  candidates: [{
    file: "src/retry.ts",
    startLine: 1,
    endLine: 1,
    hypothesis: "The callback may not be invoked.",
    evidenceNeeded: "Trace the caller completion contract.",
  }],
};
const OTHER_DISCOVERY_HANDOFF = {
  status: "completed" as const,
  limitations: [],
  candidates: [],
};
const BREADTH_HANDOFF = {
  model: "gpt-5.6-sol",
  candidates: [],
  clear: [],
  escalations: [],
  coverage: { coveredFiles: ["src/retry.ts"], unavailable: [] },
};

interface Fixture {
  root: string;
  caseRoot: string;
  evidenceRoot: string;
  registrationSha256: string;
  planSha256: string;
  schedule: MethodologySchedule;
  prepared: MaterializedHistoricalMethodologyCase[];
  activation: MethodologyLaneActivation;
}

let template: Fixture;

before(async () => {
  template = await createFixture();
});

after(() => {
  if (template) {
    for (const item of template.prepared) item.cleanup();
    rmSync(template.root, { recursive: true, force: true });
  }
});

test("freezes the historical admission, lane activation, and all six stage contracts", () => {
  const plan = readMethodologyInputPlan(template.evidenceRoot, template.registrationSha256, template.planSha256);
  assert.equal(plan.cases.length, 1);
  assert.equal(plan.cases[0]!.historicalRegistration.registrationSha256,
    template.prepared[0]!.registration.registrationSha256);
  assert.deepEqual(plan.cases[0]!.admissionBinding, template.prepared[0]!.admissionBinding);
  assert.deepEqual(plan.cases[0]!.laneActivation, template.activation);
  assert.equal(plan.stages.length, 6);
  assert.equal(plan.stages.filter((stage) => stage.kind === "static-prompt").length, 4);
  assert.equal(plan.stages.filter((stage) => stage.kind === "canonical-handoff-template").length, 2);
  assert.equal(plan.boundaries.sourceAuthentication,
    "caller-supplied-admission-and-activation-bound-not-rederived");
  assert.equal(plan.boundaries.modelVisibility, "must-remain-outside-reviewer-mounted-assets");
});

test("accepts exact static prompts and dynamic prompts assembled from the supplied canonical handoff", async () => {
  for (const armId of ["A", "B", "C", "D"] as const) {
    const first = await invocationFor(template, armId, 1);
    assert.doesNotThrow(() => verifyMethodologyPlannedInvocation({
      root: template.evidenceRoot,
      invocationRegistrationSha256: template.registrationSha256,
      inputPlanSha256: template.planSha256,
      invocation: first,
    }));
    if (armId === "C" || armId === "D") {
      const second = await invocationFor(template, armId, 2);
      assert.doesNotThrow(() => verifyMethodologyPlannedInvocation({
        root: template.evidenceRoot,
        invocationRegistrationSha256: template.registrationSha256,
        inputPlanSha256: template.planSha256,
        invocation: second,
      }));
    }
  }
});

test("rebinds fresh materialization and activation evidence to the frozen case", () => {
  const reference = template.prepared[0]!;
  assert.doesNotThrow(() => verifyMethodologyInputPlanPreparation({
    root: template.evidenceRoot,
    invocationRegistrationSha256: template.registrationSha256,
    inputPlanSha256: template.planSha256,
    historicalRegistration: reference.registration,
    admissionBinding: reference.admissionBinding,
    rawScope: reference.rawScope,
    laneActivation: template.activation,
  }));
  const changed = { ...template.activation, manifestSha256: "f".repeat(64) };
  const { activationSha256: _old, ...body } = changed;
  changed.activationSha256 = canonicalJsonSha256(body);
  assert.throws(() => verifyMethodologyInputPlanPreparation({
    root: template.evidenceRoot,
    invocationRegistrationSha256: template.registrationSha256,
    inputPlanSha256: template.planSha256,
    historicalRegistration: reference.registration,
    admissionBinding: reference.admissionBinding,
    rawScope: reference.rawScope,
    laneActivation: changed,
  }), /fresh methodology preparation differs/);
});

test("rejects changed prompt bytes even when the attacker recomputes local prompt hashes", async () => {
  const original = await invocationFor(template, "A", 1);
  const prompt = `${original.compiled.prompt}\nChanged after preregistration.`;
  const changed = { ...original, compiled: { ...original.compiled, prompt, promptSha256: sha256(prompt) } };
  assert.throws(() => verify(changed), /static prompt differs/);

  const b = await invocationFor(template, "B", 1);
  const changedLanes = await compileMethodologyReviewPrompt({ armId: "B",
    scope: template.prepared[0]!.rawScope, activatedLanes: [] });
  assert.notEqual(changedLanes.promptSha256, b.compiled.promptSha256);
  assert.throws(() => verify({ ...b, compiled: changedLanes }), /static prompt differs/);
});

test("rejects a dynamic prompt assembled from output other than its exact previousOutput", async () => {
  const invocation = await invocationFor(template, "C", 2);
  const changedCompiled = await compileMethodologyReviewPrompt({
    armId: "C",
    scope: template.prepared[0]!.rawScope,
    handoff: OTHER_DISCOVERY_HANDOFF,
  });
  assert.throws(
    () => verify({ ...invocation, compiled: changedCompiled }),
    /dynamic prompt differs/,
  );
});

test("caller-held plan digest rejects rewritten plans and cross-registration use", () => {
  const path = join(template.evidenceRoot, "methodology-input-plan.json");
  const original = readFileSync(path, "utf8");
  try {
    const changed = JSON.parse(original);
    changed.cases[0].laneActivation.activatedLanes = [];
    const { activationSha256: _oldActivation, ...activationBody } = changed.cases[0].laneActivation;
    changed.cases[0].laneActivation.activationSha256 = canonicalJsonSha256(activationBody);
    const { recordSha256: _old, ...body } = changed;
    changed.recordSha256 = canonicalJsonSha256(body);
    writeFileSync(path, JSON.stringify(changed));
    assert.throws(
      () => readMethodologyInputPlan(template.evidenceRoot, template.registrationSha256, template.planSha256),
      /digest mismatch/,
    );
  } finally {
    writeFileSync(path, original);
  }
  assert.throws(
    () => readMethodologyInputPlan(template.evidenceRoot, "f".repeat(64), template.planSha256),
    /registration digest mismatch/,
  );
});

test("registration rejects stale admission and cross-scope lane activation before writing a plan", async () => {
  const registration = template.prepared[0]!.registration;
  await assert.rejects(() => registerMethodologyInputPlan(template.evidenceRoot, {
    invocationRegistrationSha256: template.registrationSha256,
    cases: [{ historicalRegistration: registration,
      admissionBinding: { ...template.prepared[0]!.admissionBinding, sourceHeadRef: registration.source.baseCommit },
      rawScope: template.prepared[0]!.rawScope, laneActivation: template.activation }],
  }), /historical registration/);
  const activation = { ...template.activation, rawScopeSha256: "f".repeat(64) };
  const { activationSha256: _old, ...body } = activation;
  activation.activationSha256 = canonicalJsonSha256(body);
  await assert.rejects(() => registerMethodologyInputPlan(template.evidenceRoot, {
    invocationRegistrationSha256: template.registrationSha256,
    cases: [{ historicalRegistration: registration,
      admissionBinding: template.prepared[0]!.admissionBinding,
      rawScope: template.prepared[0]!.rawScope, laneActivation: activation }],
  }), /activation identity/);
  const changedScope = { ...template.prepared[0]!.rawScope, taskSpecification: "A changed task." };
  const changedScopeActivation = { ...template.activation, rawScopeSha256: canonicalJsonSha256(changedScope) };
  const { activationSha256: _prior, ...changedScopeActivationBody } = changedScopeActivation;
  changedScopeActivation.activationSha256 = canonicalJsonSha256(changedScopeActivationBody);
  await assert.rejects(() => registerMethodologyInputPlan(template.evidenceRoot, {
    invocationRegistrationSha256: template.registrationSha256,
    cases: [{ historicalRegistration: registration,
      admissionBinding: template.prepared[0]!.admissionBinding,
      rawScope: changedScope, laneActivation: changedScopeActivation }],
  }), /raw scope differs/);
});

test("registration refuses a late input plan after any attempt evidence exists", async () => {
  const root = mkdtempSync(join(tmpdir(), "methodology-input-plan-late-"));
  try {
    cpSync(join(template.evidenceRoot, "methodology-invocation-registration.json"),
      join(root, "methodology-invocation-registration.json"));
    writeFileSync(join(root, "attempt-000001.stage-1.input.json"), "{}\n");
    const reference = template.prepared[0]!;
    await assert.rejects(() => registerMethodologyInputPlan(root, {
      invocationRegistrationSha256: template.registrationSha256,
      cases: [{ historicalRegistration: reference.registration,
        admissionBinding: reference.admissionBinding, rawScope: reference.rawScope,
        laneActivation: template.activation }],
    }), /after attempt work has begun/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function verify(invocation: MethodologyInvocationInput): void {
  verifyMethodologyPlannedInvocation({
    root: template.evidenceRoot,
    invocationRegistrationSha256: template.registrationSha256,
    inputPlanSha256: template.planSha256,
    invocation,
  });
}

async function invocationFor(fixture: Fixture, armId: MethodologyArmId, stageIndex: 1 | 2) {
  const attempt = fixture.schedule.attempts.find((candidate) => candidate.armId === armId)!;
  const prepared = fixture.prepared.find((candidate) => candidate.assetsManifest.armId === armId)!;
  let compiled: CompiledMethodologyPrompt;
  let previousOutput: string | null = null;
  if (stageIndex === 1 && (armId === "C" || armId === "D")) {
    compiled = await compileMethodologyDiscoveryPrompt({ armId, scope: prepared.rawScope,
      ...(armId === "D" ? { activatedLanes: fixture.activation.activatedLanes } : {}) });
  } else {
    const handoff = armId === "C" ? DISCOVERY_HANDOFF : armId === "D" ? BREADTH_HANDOFF : undefined;
    previousOutput = handoff === undefined ? null : JSON.stringify(handoff, null, 2);
    compiled = await compileMethodologyReviewPrompt({ armId, scope: prepared.rawScope,
      ...(armId === "B" || armId === "D" ? { activatedLanes: fixture.activation.activatedLanes } : {}),
      ...(handoff === undefined ? {} : { handoff }) });
  }
  const schema = prepared.assetsManifest.files.find((candidate) => candidate.path === compiled.schemaPath)!;
  return {
    attemptId: attempt.id,
    stageIndex,
    compiled,
    assets: prepared.assetsManifest,
    schemaText: readFileSync(join(prepared.materialized.evaluationIsolation.providerAssetsRoot, schema.path), "utf8"),
    model: "gpt-5.6-sol" as const,
    effort: "high" as const,
    stageMaximumMs: attempt.stageDeadlineMs[stageIndex - 1]!,
    attemptDeadlineAt: "2026-09-05T12:01:00.000Z",
    previousOutput,
    requestedAt: `2026-09-05T12:00:0${stageIndex}.000Z`,
  };
}

async function createFixture(): Promise<Fixture> {
  const historical = createHistoricalFixture();
  const registration = readHistoricalMethodologyCase(historical.caseDir, TRUSTED_POLICY);
  const schedule = buildSchedule(registration.caseName, registration.truth.registeredRootCount);
  const prepared: MaterializedHistoricalMethodologyCase[] = [];
  const evidenceRoot = join(historical.root, "evidence");
  mkdirSync(evidenceRoot);
  try {
    for (const armId of ["A", "B", "C", "D"] as const) {
      prepared.push(await materializeHistoricalMethodologyCase(registration, schedule, armId, TRUSTED_POLICY));
    }
    const reference = prepared[0]!;
    const activationContext: ReviewContext = {
      repoPath: reference.materialized.repoPath,
      diffPath: reference.materialized.diffPath,
      diffText: reference.materialized.diffText,
      baseRef: reference.materialized.baseRef,
      headRef: reference.materialized.headRef,
      config: JSON.parse(readFileSync("peregrine.config.json", "utf8")) as PeregrineConfig,
      evaluationIsolation: reference.materialized.evaluationIsolation,
    };
    const activation = await prepareMethodologyLaneActivation({
      armId: "B",
      context: activationContext,
      rawScope: reference.rawScope,
    });
    const registrationSha256 = registerMethodologyInvocations(evidenceRoot, {
      runId: "input-plan-structural-fixture",
      schedule,
      scopeSha256ByCase: { [registration.caseName]: canonicalJsonSha256(reference.rawScope) },
      assetsByArm: prepared.map((item) => item.assetsManifest),
    });
    const planSha256 = await registerMethodologyInputPlan(evidenceRoot, {
      invocationRegistrationSha256: registrationSha256,
      cases: [{ historicalRegistration: registration, admissionBinding: reference.admissionBinding,
        rawScope: reference.rawScope, laneActivation: activation }],
    });
    return { root: historical.root, caseRoot: historical.caseDir, evidenceRoot,
      registrationSha256, planSha256, schedule, prepared, activation };
  } catch (error) {
    for (const item of prepared) item.cleanup();
    rmSync(historical.root, { recursive: true, force: true });
    throw error;
  }
}

function createHistoricalFixture(): { root: string; caseDir: string } {
  const root = mkdtempSync(join(tmpdir(), "peregrine-methodology-input-plan-"));
  const source = join(root, "source");
  const caseDir = join(root, "cases", "development", "case-cacacaca");
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
  const spec: HistoricalCaseSpec = { id: "case-cacacaca", corpus: "development", kind: "historical",
    evaluationProtocol: "historical-efficacy-v1", repoSource: source, baseCommit: base, headCommit: head,
    diffFile: "diff.patch", metadataFile: "metadata.json" };
  writeFileSync(join(caseDir, "case.json"), JSON.stringify(spec));
  writeFileSync(join(caseDir, "diff.patch"), diff);
  writeFileSync(join(caseDir, "metadata.json"), JSON.stringify({ title: "Preserve retry completion",
    body: "Review the callback behavior introduced by this change." }));
  writeFileSync(join(caseDir, "ground_truth.json"), JSON.stringify({ schemaVersion: 2, scope: {
    protocol: "historical-efficacy-v1", truthVersion: "truth-v1", status: "known-roots",
    completeness: "partial", reviewedScope: "The changed retry callback.",
    permittedMetrics: historicalPermittedMetrics("known-roots") }, bugs: [{ id: "bug-cacacaca",
    lane: "other-unclassified", mechanismFamily: "callback-loss", proofLevel: "complete-static-trace",
    expectedDisposition: "fix-in-pr", expectedSeverity: "high", file: "src/retry.ts", startLine: 1,
    endLine: 1, description: "The changed retry path omits callback completion.",
    reachablePreconditions: "A caller supplies a completion callback.", observableImpact: "The caller remains pending.",
    provenance: "The exact historical head and repair support this declared root." }] }));
  writeFileSync(join(caseDir, "proof.md"), "Structural static trace fixture; not a real admission claim.\n");
  writeAdmittedCuration(caseDir, spec, diff);
  return { root, caseDir };
}

function writeAdmittedCuration(caseDir: string, spec: HistoricalCaseSpec, diff: string): void {
  const truth = parseHistoricalGroundTruth(JSON.parse(readFileSync(join(caseDir, "ground_truth.json"), "utf8")));
  const proof = readFileSync(join(caseDir, "proof.md"), "utf8");
  const scopeSha256 = historicalTruthScopeSha256(truth);
  const curation: any = { schemaVersion: 2, protocol: "historical-efficacy-v1", caseId: spec.id,
    status: "admitted", curatorPolicyId: TRUSTED_POLICY.policyId,
    truth: { truthVersion: truth.scope.truthVersion, status: truth.scope.status,
      completeness: "partial", scopeSha256 },
    source: { kind: "historical", repositoryAlias: "structural-fixture",
      repositoryIdentitySha256: repositoryFamilyIdentitySha256("sha1", [spec.baseCommit]),
      changeIdentitySha256: sha256(diff), access: "public" },
    strata: { languageFamily: "typescript", architectureFamily: "library", size: "small",
      changeShapes: ["direct"], secondarySurfaceLanes: [], mechanismFamilies: ["callback-loss"] },
    proof: { kind: "reasoned-analysis", artifact: "proof.md", sha256: sha256(proof) },
    confirmations: [CURATOR_ONE, CURATOR_TWO].map((curatorIdentitySha256, index) => ({ curatorIdentitySha256,
      confirmedAt: `2026-09-05T1${index}:00:00.000Z`, caseBundleSha256: "0".repeat(64), truthScopeSha256: scopeSha256,
      checks: requiredHistoricalConfirmationChecks("known-roots") })) };
  const parsed = parseHistoricalCuration(curation, spec, truth);
  const bundle = historicalCaseBundleSha256(caseDir, spec, parsed);
  for (const confirmation of curation.confirmations) confirmation.caseBundleSha256 = bundle;
  writeFileSync(join(caseDir, "curation.json"), JSON.stringify(curation));
}

function buildSchedule(caseName: string, expectedBugCount: number): MethodologySchedule {
  const withoutArms: Omit<MethodologyDesign, "arms"> = { schemaVersion: 1, protocol: "historical-methodology-v1",
    seed: 101, repeats: 1, callerConfig: { runner: "codex", model: "gpt-5.6-sol", effort: "high",
      identitySha256: "a".repeat(64) }, totalDeadlineMs: 60_000,
    twoWorkerStageSplit: { discoveryDeadlineMs: 20_000, reviewerDeadlineMs: 40_000 } };
  return buildMethodologySchedule({ design: { ...withoutArms,
    arms: (["A", "B", "C", "D"] as const).map((armId) => { const configName = `methodology-${armId.toLowerCase()}`;
      return { armId, configName, configIdentitySha256: methodologyArmConfigIdentitySha256({
        design: withoutArms, armId, configName }) }; }) },
    cases: [{ caseName, corpus: "development", expectedBugCount }] });
}

function git(cwd: string, ...values: unknown[]): string {
  const options = typeof values.at(-1) === "object" ? values.pop() as { trim: false } : undefined;
  const output = execFileSync("git", values as string[], { cwd, encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: cwd, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z" } });
  return options?.trim === false ? output : output.trim();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
