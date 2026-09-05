import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { repositoryFamilyIdentitySha256 } from "../eval/case-isolation.js";
import { historicalCaseBundleSha256, historicalTruthScopeSha256,
  parseHistoricalCuration, requiredHistoricalConfirmationChecks } from "../eval/historical-curation.js";
import { historicalPermittedMetrics, parseHistoricalGroundTruth } from "../eval/historical-truth.js";
import {
  materializeHistoricalMethodologyCase,
  parseHistoricalMethodologyCaseRegistration,
  readHistoricalMethodologyCase,
} from "../eval/historical-methodology-case.js";
import { buildMethodologySchedule, methodologyArmConfigIdentitySha256,
  type MethodologyDesign } from "../eval/methodology-schedule.js";
import type { CuratorPolicy } from "../eval/case-curation.js";
import type { HistoricalCaseSpec } from "../src/types.js";

const curatorOne = "1".repeat(64);
const curatorTwo = "2".repeat(64);
const policy: CuratorPolicy = {
  schemaVersion: 1,
  policyId: "protected-git-review-v1",
  trustRoot: "protected-git-review",
  minimumIndependentConfirmations: 2,
  curatorIdentitySha256s: [curatorOne, curatorTwo],
};

interface HistoricalFixture {
  root: string;
  source: string;
  caseDir: string;
  spec: HistoricalCaseSpec;
  base: string;
  head: string;
}

test("known-root admission binds source materialization and exposes no truth-derived lanes", async () => {
  const fixture = createHistoricalFixture("known-roots");
  try {
    const registration = readHistoricalMethodologyCase(fixture.caseDir, policy);
    assert.equal(registration.truth.registeredRootCount, 1);
    assert.equal(registration.activatedLanes, null);
    assert.equal(registration.inputs.taskSpecification,
      "Title: Preserve callback completion\n\nDescription:\nReview the retry change without changing caller contracts.");
    assert.deepEqual(parseHistoricalMethodologyCaseRegistration(structuredClone(registration)), registration);
    const prepared = await materializeHistoricalMethodologyCase(
      registration, schedule(registration.caseName, 1), "A", policy,
    );
    const attemptRoot = dirname(prepared.materialized.repoPath);
    try {
      assert.equal(prepared.admissionBinding.sourceBaseRef, fixture.base);
      assert.equal(prepared.admissionBinding.sourceHeadRef, fixture.head);
      assert.equal(prepared.admissionBinding.sourceMergeBase, fixture.base);
      assert.equal(prepared.admissionBinding.materializedDiffSha256, registration.source.changeIdentitySha256);
      assert.equal(prepared.rawScope.diff, readFileSync(join(fixture.caseDir, "diff.patch"), "utf8"));
      assert.deepEqual(prepared.rawScope.rawChangedPaths, ["src/retry.ts"]);
      assert.deepEqual(prepared.assetsManifest.files.map((entry) => entry.path), [
        "schemas/methodology-review.schema.json",
      ]);
      assert.doesNotMatch(JSON.stringify(prepared.rawScope), /callback-loss|other-unclassified|ground_truth/);
    } finally {
      prepared.cleanup();
    }
    assert.equal(existsSync(attemptRoot), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("reviewed comparison remains partial with zero registered roots and D receives only allowed assets", async () => {
  const fixture = createHistoricalFixture("reviewed-comparison", "case-bbbbbbbb");
  try {
    const registration = readHistoricalMethodologyCase(fixture.caseDir, policy);
    assert.equal(registration.truth.status, "reviewed-comparison");
    assert.equal(registration.truth.registeredRootCount, 0);
    assert.equal(registration.truth.completeness, "partial");
    const prepared = await materializeHistoricalMethodologyCase(
      registration, schedule(registration.caseName, 0), "D", policy,
    );
    try {
      assert.deepEqual(prepared.assetsManifest.files.map((entry) => entry.path), [
        "schemas/breadth-result.schema.json",
        "schemas/methodology-review.schema.json",
        "skills/invariant-first-pr-review/references/breadth-worker-packet.md",
      ]);
      assert.equal(prepared.registration.activatedLanes, null);
    } finally {
      prepared.cleanup();
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("schedule count uses distinct registered causal roots rather than observation rows", () => {
  const fixture = createHistoricalFixture("known-roots", "case-abababab");
  try {
    const truth = JSON.parse(readFileSync(join(fixture.caseDir, "ground_truth.json"), "utf8"));
    truth.bugs[0].rootCauseGroup = "root-abababab";
    truth.bugs.push({ ...truth.bugs[0], id: "bug-bbbbbbbb", startLine: 2, endLine: 2 });
    writeFileSync(join(fixture.caseDir, "ground_truth.json"), JSON.stringify(truth));
    rewriteCurationBundle(fixture.caseDir, fixture.spec, false);
    const registration = readHistoricalMethodologyCase(fixture.caseDir, policy);
    assert.equal(registration.truth.registeredRootCount, 1);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("truth, metadata, and registration path tampering fail before a runnable case is returned", async () => {
  const fixture = createHistoricalFixture("known-roots");
  try {
    const registration = readHistoricalMethodologyCase(fixture.caseDir, policy);
    writeFileSync(join(fixture.caseDir, "metadata.json"), JSON.stringify({ title: "Changed after admission" }));
    await assert.rejects(
      () => materializeHistoricalMethodologyCase(registration, schedule(registration.caseName, 1), "A", policy),
      /stale before materialization/,
    );
    const restored = createHistoricalFixture("known-roots", "case-cccccccc");
    try {
      const registered = readHistoricalMethodologyCase(restored.caseDir, policy);
      const truth = JSON.parse(readFileSync(join(restored.caseDir, "ground_truth.json"), "utf8"));
      truth.scope.reviewedScope = "Mutated truth scope after confirmation.";
      writeFileSync(join(restored.caseDir, "ground_truth.json"), JSON.stringify(truth));
      await assert.rejects(
        () => materializeHistoricalMethodologyCase(registered, schedule(registered.caseName, 1), "A", policy),
        /scopeSha256 is stale|proof digest|bundle|stale before/,
      );
      const pathChanged = structuredClone(registered);
      pathChanged.caseDirectory = fixture.caseDir;
      assert.throws(() => parseHistoricalMethodologyCaseRegistration(pathChanged), /digest is invalid/);
    } finally {
      rmSync(restored.root, { recursive: true, force: true });
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("materialization rejects a curator-declared repository family that differs from actual history", async () => {
  const fixture = createHistoricalFixture("known-roots", "case-dddddddd", { wrongFamily: true });
  try {
    const registration = readHistoricalMethodologyCase(fixture.caseDir, policy);
    await assert.rejects(
      () => materializeHistoricalMethodologyCase(registration, schedule(registration.caseName, 1), "B", policy),
      /materialized historical source does not match its admitted registration/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("schedule case identity and registered-root count are mandatory", async () => {
  const fixture = createHistoricalFixture("known-roots", "case-eeeeeeee");
  try {
    const registration = readHistoricalMethodologyCase(fixture.caseDir, policy);
    await assert.rejects(
      () => materializeHistoricalMethodologyCase(registration, schedule(registration.caseName, 0), "A", policy),
      /does not match its registered schedule descriptor/,
    );
    await assert.rejects(
      () => materializeHistoricalMethodologyCase(registration, schedule("development/case-ffffffff", 1), "A", policy),
      /does not match its registered schedule descriptor/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("shallow curator history remains rejected without invoking a methodology runner", async () => {
  const original = createHistoricalFixture("known-roots", "case-12121212");
  const shallowRoot = mkdtempSync(join(tmpdir(), "peregrine-historical-shallow-"));
  try {
    const shallow = join(shallowRoot, "source");
    git(shallowRoot, "clone", "--quiet", "--depth", "2", `file://${original.source}`, shallow);
    const caseDir = join(shallowRoot, "cases", "development", "case-12121212");
    copyCase(original.caseDir, caseDir);
    const spec = JSON.parse(readFileSync(join(caseDir, "case.json"), "utf8"));
    spec.repoSource = shallow;
    writeFileSync(join(caseDir, "case.json"), JSON.stringify(spec));
    rewriteCurationBundle(caseDir, spec, false);
    const registration = readHistoricalMethodologyCase(caseDir, policy);
    await assert.rejects(
      () => materializeHistoricalMethodologyCase(registration, schedule(registration.caseName, 1), "A", policy),
      /complete, non-shallow ancestry/,
    );
  } finally {
    rmSync(original.root, { recursive: true, force: true });
    rmSync(shallowRoot, { recursive: true, force: true });
  }
});

function createHistoricalFixture(
  status: "known-roots" | "reviewed-comparison",
  caseId = "case-aaaaaaaa",
  options: { wrongFamily?: boolean } = {},
): HistoricalFixture {
  const root = mkdtempSync(join(tmpdir(), "peregrine-historical-methodology-"));
  const source = join(root, "source");
  const caseDir = join(root, "cases", "development", caseId);
  mkdirSync(join(source, "src"), { recursive: true });
  git(source, "init", "--quiet", "--initial-branch=main");
  git(source, "config", "user.name", "Historical Curator");
  git(source, "config", "user.email", "curator@example.invalid");
  writeFileSync(join(source, "src/retry.ts"), "export const retry = (done: () => void) => done();\n");
  git(source, "add", ".");
  git(source, "commit", "--quiet", "-m", "base");
  const base = git(source, "rev-parse", "HEAD");
  writeFileSync(join(source, "src/retry.ts"), "export const retry = (_done: () => void) => undefined;\n");
  git(source, "add", ".");
  git(source, "commit", "--quiet", "-m", "head");
  const head = git(source, "rev-parse", "HEAD");
  const diff = canonicalDiff(source, base, head);
  mkdirSync(caseDir, { recursive: true });
  const spec: HistoricalCaseSpec = {
    id: caseId,
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
    title: "Preserve callback completion",
    body: "Review the retry change without changing caller contracts.",
  }));
  const truthValue = {
    schemaVersion: 2,
    scope: {
      protocol: "historical-efficacy-v1",
      truthVersion: "truth-v1",
      status,
      completeness: "partial",
      reviewedScope: status === "known-roots"
        ? "The changed retry callback path and its observable completion contract."
        : "Only the changed retry callback path; this is not a global clean assertion.",
      permittedMetrics: historicalPermittedMetrics(status),
    },
    bugs: status === "known-roots" ? [{
      id: "bug-aaaaaaaa",
      lane: "other-unclassified",
      mechanismFamily: "callback-loss",
      proofLevel: "complete-static-trace",
      expectedDisposition: "fix-in-pr",
      expectedSeverity: "high",
      file: "src/retry.ts",
      startLine: 1,
      endLine: 1,
      description: "The changed retry path omits completion.",
      reachablePreconditions: "A caller supplies a completion callback.",
      observableImpact: "The caller remains pending.",
      provenance: "The exact historical head and repair support this root.",
    }] : [],
  };
  writeFileSync(join(caseDir, "ground_truth.json"), JSON.stringify(truthValue));
  writeFileSync(join(caseDir, "proof.md"), status === "known-roots"
    ? "Complete static trace of callback loss at the historical head.\n"
    : "Independent review of the narrow callback comparison scope.\n");
  rewriteCurationBundle(caseDir, spec, options.wrongFamily ?? false);
  return { root, source, caseDir, spec, base, head };
}

function rewriteCurationBundle(caseDir: string, spec: HistoricalCaseSpec, wrongFamily: boolean): void {
  const truth = parseHistoricalGroundTruth(JSON.parse(readFileSync(join(caseDir, "ground_truth.json"), "utf8")));
  const diff = readFileSync(join(caseDir, "diff.patch"), "utf8");
  const proof = readFileSync(join(caseDir, "proof.md"), "utf8");
  const checks = requiredHistoricalConfirmationChecks(truth.scope.status);
  const rootLocations = new Map<string, number>();
  for (const bug of truth.bugs) {
    const key = bug.rootCauseGroup ?? bug.id;
    rootLocations.set(key, (rootLocations.get(key) ?? 0) + 1);
  }
  const multiObservation = [...rootLocations.values()].some((count) => count > 1);
  const family = wrongFamily ? sha("wrong-family") : repositoryFamilyIdentitySha256("sha1", [spec.baseCommit]);
  const curation: any = {
    schemaVersion: 2,
    protocol: "historical-efficacy-v1",
    caseId: spec.id,
    status: "admitted",
    curatorPolicyId: "protected-git-review-v1",
    truth: { truthVersion: truth.scope.truthVersion, status: truth.scope.status, completeness: "partial",
      scopeSha256: historicalTruthScopeSha256(truth) },
    source: { kind: "historical", repositoryAlias: "fixture-history", repositoryIdentitySha256: family,
      changeIdentitySha256: sha(diff), access: "public" },
    strata: { languageFamily: "typescript", architectureFamily: "library", size: "small",
      changeShapes: ["direct", ...(multiObservation ? ["multi-observation"] : [])], secondarySurfaceLanes: [],
      mechanismFamilies: truth.scope.status === "known-roots" ? ["callback-loss"] : [] },
    proof: { kind: truth.scope.status === "known-roots" ? "reasoned-analysis" : "reviewed-comparison-analysis",
      artifact: "proof.md", sha256: sha(proof) },
    confirmations: [curatorOne, curatorTwo].map((curatorIdentitySha256, index) => ({
      curatorIdentitySha256,
      confirmedAt: `2026-09-05T1${index}:00:00.000Z`,
      caseBundleSha256: "0".repeat(64),
      truthScopeSha256: historicalTruthScopeSha256(truth),
      checks,
    })),
  };
  const parsed = parseHistoricalCuration(curation, spec, truth);
  const bundle = historicalCaseBundleSha256(caseDir, spec, parsed);
  for (const confirmation of curation.confirmations) confirmation.caseBundleSha256 = bundle;
  writeFileSync(join(caseDir, "curation.json"), JSON.stringify(curation));
}

function schedule(caseName: string, expectedBugCount: number) {
  const withoutArms: Omit<MethodologyDesign, "arms"> = {
    schemaVersion: 1,
    protocol: "historical-methodology-v1",
    seed: 55,
    repeats: 1,
    callerConfig: { runner: "codex", model: "gpt-5.6-sol", effort: "high", identitySha256: "a".repeat(64) },
    totalDeadlineMs: 60_000,
    twoWorkerStageSplit: { discoveryDeadlineMs: 20_000, reviewerDeadlineMs: 40_000 },
  };
  return buildMethodologySchedule({
    design: { ...withoutArms, arms: (["A", "B", "C", "D"] as const).map((armId) => {
      const configName = `methodology-${armId.toLowerCase()}`;
      return { armId, configName, configIdentitySha256: methodologyArmConfigIdentitySha256({
        design: withoutArms, armId, configName,
      }) };
    }) },
    cases: [{ caseName, corpus: "development", expectedBugCount }],
  });
}

function canonicalDiff(repo: string, base: string, head: string): string {
  return git(repo, "diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-color",
    "--find-renames", `${base}...${head}`, "--", { trim: false });
}

function git(cwd: string, ...raw: Array<string | { trim: boolean }>): string {
  const options = typeof raw.at(-1) === "object" ? raw.pop() as { trim: boolean } : { trim: true };
  const output = execFileSync("git", raw as string[], { cwd, encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: join(cwd, ".home"), GIT_CONFIG_NOSYSTEM: "1" } });
  return options.trim ? output.trim() : output;
}

function copyCase(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  for (const file of ["case.json", "diff.patch", "metadata.json", "ground_truth.json", "proof.md", "curation.json"]) {
    writeFileSync(join(target, file), readFileSync(join(source, file)));
  }
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
