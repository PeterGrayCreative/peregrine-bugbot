import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  parseCaseCuration,
  caseBundleSha256,
  diffSizeStratum,
  fixtureSourceIdentitySha256,
  parseHoldoutCommitment,
  requiredConfirmationChecks,
  readBehavioralCaseAdmission,
  verifyCurationProof,
  type ChangeShape,
} from "../eval/case-curation.js";
import { parseBehavioralGroundTruth, parseGroundTruth } from "../eval/case-truth.js";
import { repositoryFamilyIdentitySha256 } from "../eval/case-isolation.js";
import { runMatrix } from "../eval/run-matrix.js";
import {
  assertHistoricalRepositoryIdentity,
  buildCorpusValidationReport,
  validateBehavioralCorpus,
  validateSelectedBehavioralCases,
  type ValidatedBehavioralCase,
} from "../eval/validate-corpus.js";
import type { CoreLaneId } from "../src/core/lanes.js";
import type { CaseSpec, GroundTruth } from "../src/types.js";

const sha = (value: string): string => createHash("sha256").update(value).digest("hex");

const bugTruth: GroundTruth = {
  bugs: [{
    id: "bug-aaaaaaaa",
    rootCauseGroup: "root-bbbbbbbb",
    lane: "persistence",
    expectedDisposition: "fix-in-pr",
    expectedSeverity: "high",
    file: "src/value.ts",
    startLine: 1,
    endLine: 1,
    description: "The write loses the prior value.",
    reachablePreconditions: "A record already exists.",
    observableImpact: "The stored value is corrupted.",
    provenance: "Independently reproduced from the sanitized source change.",
  }, {
    id: "bug-cccccccc",
    rootCauseGroup: "root-bbbbbbbb",
    lane: "persistence",
    expectedDisposition: "fix-in-pr",
    expectedSeverity: "high",
    file: "src/read.ts",
    startLine: 2,
    endLine: 2,
    description: "The read observes the corrupted value.",
    reachablePreconditions: "The lossy write has completed.",
    observableImpact: "Readers receive incomplete state.",
    provenance: "Independently reproduced from the sanitized source change.",
  }],
};

const seededSpec: CaseSpec = {
  id: "case-aaaaaaaa",
  corpus: "development",
  kind: "seeded",
  fixtureDir: "fixture",
  diffFile: "diff.patch",
};

function curation(
  spec: CaseSpec = seededSpec,
  status: "draft" | "admitted" = "admitted",
): Record<string, unknown> {
  const checks = requiredConfirmationChecks(spec.kind);
  return {
    schemaVersion: 1,
    caseId: spec.id,
    status,
    curatorPolicyId: "protected-git-review-v1",
    source: {
      kind: spec.kind,
      repositoryAlias: "fixture-one",
      repositoryIdentitySha256: "1".repeat(64),
      changeIdentitySha256: "2".repeat(64),
      access: "public",
    },
    strata: {
      languageFamily: "typescript",
      architectureFamily: "backend-service",
      size: "small",
      changeShapes: spec.kind === "clean" ? ["direct"] : ["seam", "multi-observation"],
      surfaceLanes: ["persistence"],
    },
    proof: {
      kind: spec.kind === "clean" ? "clean-control-review" : "regression-test",
      artifact: "proof.md",
      sha256: "3".repeat(64),
    },
    confirmations: status === "draft" ? [] : [
      { curatorIdentitySha256: "4".repeat(64), confirmedAt: "2026-09-03T12:00:00Z", caseBundleSha256: "6".repeat(64), checks },
      { curatorIdentitySha256: "5".repeat(64), confirmedAt: "2026-09-03T13:00:00Z", caseBundleSha256: "6".repeat(64), checks },
    ],
  };
}

test("behavioral truth is strict while structural compatibility keeps legacy defaults", () => {
  const legacy = parseGroundTruth({ bugs: [{
    id: "legacy", file: "src/a.ts", startLine: 1, endLine: 1, description: "legacy",
  }] });
  assert.equal(legacy.bugs[0]?.lane, "logic-correctness");
  assert.throws(
    () => parseBehavioralGroundTruth({ bugs: [{ ...bugTruth.bugs[0], id: "legacy" }] }),
    /id must match/,
  );
  assert.throws(
    () => parseBehavioralGroundTruth({ bugs: [{ ...bugTruth.bugs[0], surprise: true }] }),
    /unsupported field surprise/,
  );
  assert.deepEqual(parseBehavioralGroundTruth({ bugs: [] }), { bugs: [] });
});

test("admission binds case kind, full independent confirmations, and multi-observation truth", () => {
  const parsed = parseCaseCuration(curation(), seededSpec, bugTruth);
  assert.equal(parsed.confirmations.length, 2);
  assert.deepEqual(parsed.strata.surfaceLanes, ["persistence"]);

  const oneConfirmation = curation();
  (oneConfirmation.confirmations as unknown[]).pop();
  assert.throws(() => parseCaseCuration(oneConfirmation, seededSpec, bugTruth), /two independent/);

  const singleton = { bugs: [bugTruth.bugs[0]!] };
  assert.throws(() => parseCaseCuration(curation(), seededSpec, singleton), /at least two distinct observations/);
});

test("curation derives structural shapes from truth and rejects ambiguous declarations", () => {
  const bothBoundaryKinds = curation();
  ((bothBoundaryKinds.strata as Record<string, unknown>).changeShapes) = ["direct", "seam", "multi-observation"];
  assert.throws(
    () => parseCaseCuration(bothBoundaryKinds, seededSpec, bugTruth),
    /exactly one of direct or seam/,
  );

  const repeatedRange: GroundTruth = { bugs: [
    bugTruth.bugs[0]!,
    { ...bugTruth.bugs[0]!, id: "bug-dddddddd", observableImpact: "Different prose cannot create another observation." },
  ] };
  assert.throws(
    () => parseCaseCuration(curation(), seededSpec, repeatedRange),
    /repeats a root-cause observation/,
  );

  const cleanSpec: CaseSpec = {
    id: "case-bbbbbbbb", corpus: "development", kind: "clean", fixtureDir: "fixture", diffFile: "diff.patch",
  };
  const broadClean = curation(cleanSpec);
  ((broadClean.strata as Record<string, unknown>).surfaceLanes) = ["persistence", "contracts"];
  assert.throws(
    () => parseCaseCuration(broadClean, cleanSpec, { bugs: [] }),
    /exactly one comparable surface lane/,
  );

  const openArchitecture = curation();
  ((openArchitecture.strata as Record<string, unknown>).architectureFamily) = "bespoke-monolith";
  assert.throws(() => parseCaseCuration(openArchitecture, seededSpec, bugTruth), /architectureFamily is invalid/);
});

test("curation proof is a content-addressed non-symlink file", () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-curation-proof-"));
  try {
    const proof = "curator-only proof\n";
    writeFileSync(join(root, "proof.md"), proof);
    const value = curation();
    ((value.proof as Record<string, unknown>).sha256) = sha(proof);
    const parsed = parseCaseCuration(value, seededSpec, bugTruth);
    verifyCurationProof(root, parsed);
    writeFileSync(join(root, "proof.md"), "changed\n");
    assert.throws(() => verifyCurationProof(root, parsed), /digest does not match/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("holdout commitment exposes no case identities or truth", () => {
  const parsed = parseHoldoutCommitment({
    schemaVersion: 1,
    kind: "sealed-holdout-commitment",
    status: "unopened",
    stewardIdentitySha256: "6".repeat(64),
    storageBoundary: "external-access-controlled",
    corpusCommitmentSha256: "7".repeat(64),
    caseCount: 8,
    committedAt: "2026-09-03T14:00:00Z",
  });
  assert.equal(parsed.status, "unopened");
  assert.throws(() => parseHoldoutCommitment({ ...parsed, caseIds: ["case-secret"] }), /unsupported field caseIds/);
});

test("zero-provider validator authenticates a draft case and reports readiness separately", async () => {
  const outer = mkdtempSync(join(tmpdir(), "peregrine-corpus-"));
  const root = join(outer, "cases");
  try {
    mkdirSync(join(root, "development"), { recursive: true });
    mkdirSync(join(root, "validation"), { recursive: true });
    const caseId = "case-aaaaaaaa";
    const target = join(root, "development", caseId);
    cpSync(join(process.cwd(), "eval/cases/structural-smoke/case-00000001"), target, { recursive: true });
    const caseSpec: CaseSpec = {
      id: caseId,
      corpus: "development",
      kind: "clean",
      fixtureDir: "fixture",
      diffFile: "diff.patch",
    };
    writeFileSync(join(target, "case.json"), `${JSON.stringify(caseSpec, null, 2)}\n`);
    writeCuratorPolicyForCasesRoot(root);
    const proof = "Independent clean-control review evidence.\n";
    writeFileSync(join(target, "proof.md"), proof);
    const value = curation(caseSpec, "draft");
    const diff = readFileSync(join(target, "diff.patch"));
    const source = value.source as Record<string, unknown>;
    source.repositoryIdentitySha256 = fixtureSourceIdentitySha256(target, caseSpec.fixtureDir);
    source.changeIdentitySha256 = createHash("sha256").update(diff).digest("hex");
    const proofRecord = value.proof as Record<string, unknown>;
    proofRecord.sha256 = sha(proof);
    writeFileSync(join(target, "curation.json"), `${JSON.stringify(value, null, 2)}\n`);

    const report = await validateBehavioralCorpus(root);
    assert.equal(report.totalCases, 1);
    assert.equal(report.admittedCases, 0);
    assert.equal(report.draftCases, 1);
    assert.equal(report.visibleSeededBenchmarkReady, false);
    assert.equal(report.goldSetReady, false);
    assert.equal(report.finalHoldoutReady, false);
    assert.ok(report.seededBenchmarkRequirements.includes("every visible behavioral case is admitted"));
    assert.deepEqual(report.holdoutRequirements, ["external sealed holdout commitment metadata exists"]);
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

test("checked-in schemas retain strict parser discriminants", () => {
  const truthSchema = JSON.parse(readFileSync(join(process.cwd(), "schemas/benchmark-case.schema.json"), "utf8"));
  const curationSchema = JSON.parse(readFileSync(join(process.cwd(), "schemas/benchmark-curation.schema.json"), "utf8"));
  const curatorPolicySchema = JSON.parse(readFileSync(join(process.cwd(), "schemas/curator-policy.schema.json"), "utf8"));
  const holdoutSchema = JSON.parse(readFileSync(join(process.cwd(), "schemas/holdout-commitment.schema.json"), "utf8"));
  assert.equal(truthSchema.$defs.bug.properties.id.pattern, "^bug-[a-f0-9]{8,32}$");
  assert.deepEqual(curationSchema.required, [
    "schemaVersion", "caseId", "status", "curatorPolicyId", "source", "strata", "proof", "confirmations",
  ]);
  assert.ok(curationSchema.properties.confirmations.items.required.includes("caseBundleSha256"));
  assert.equal(curatorPolicySchema.properties.trustRoot.const, "protected-git-review");
  assert.equal(curatorPolicySchema.properties.minimumIndependentConfirmations.const, 2);
  assert.equal(holdoutSchema.properties.status.const, "unopened");
  assert.equal(holdoutSchema.properties.caseIds, undefined);
});

test("case bundle confirmations reject normalized curation drift", () => {
  const outer = mkdtempSync(join(tmpdir(), "peregrine-corpus-bundle-"));
  const root = join(outer, "cases");
  try {
    const caseDir = createCleanBehavioralCase(root, "development", "case-aaaabbbb", "admitted");
    assert.equal(readBehavioralCaseAdmission(caseDir, JSON.parse(readFileSync(join(caseDir, "case.json"), "utf8"))).curation.status, "admitted");
    const value = JSON.parse(readFileSync(join(caseDir, "curation.json"), "utf8"));
    value.strata.architectureFamily = "cli-tool";
    writeFileSync(join(caseDir, "curation.json"), JSON.stringify(value));
    assert.throws(
      () => readBehavioralCaseAdmission(caseDir, JSON.parse(readFileSync(join(caseDir, "case.json"), "utf8"))),
      /does not authenticate the current case bundle/,
    );
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

test("case bundles authenticate every fixture file and reject unreviewed context drift", () => {
  const outer = mkdtempSync(join(tmpdir(), "peregrine-corpus-fixture-bundle-"));
  const casesRoot = join(outer, "cases");
  try {
    const caseDir = createCleanBehavioralCase(casesRoot, "development", "case-aaaabbbc", "admitted");
    const spec = JSON.parse(readFileSync(join(caseDir, "case.json"), "utf8")) as CaseSpec;
    const admitted = readBehavioralCaseAdmission(caseDir, spec);
    const before = caseBundleSha256(caseDir, spec, admitted.curation);
    writeFileSync(join(caseDir, "fixture", "src", "unreviewed-context.ts"), "export const hidden = true;\n");
    const after = caseBundleSha256(caseDir, spec, admitted.curation);
    assert.notEqual(after, before);
    assert.throws(
      () => readBehavioralCaseAdmission(caseDir, spec),
      /fixture source identity does not match its authenticated fixture tree/,
    );
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

test("admission trusts only identities registered by the bound protected-review policy", async () => {
  const outer = mkdtempSync(join(tmpdir(), "peregrine-corpus-curator-policy-"));
  const casesRoot = join(outer, "cases");
  try {
    const caseDir = createCleanBehavioralCase(casesRoot, "development", "case-aaaabbbd", "admitted");
    await assert.doesNotReject(() => validateSelectedBehavioralCases([caseDir], casesRoot));

    const policyPath = join(outer, "curator-policy.json");
    const policy = JSON.parse(readFileSync(policyPath, "utf8"));
    policy.curatorIdentitySha256s.push("6".repeat(64));
    writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
    await assert.doesNotReject(
      () => validateSelectedBehavioralCases([caseDir], casesRoot),
      "registry additions do not invalidate unrelated case bundles",
    );
    policy.curatorIdentitySha256s = ["4".repeat(64)];
    writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
    await assert.rejects(
      () => validateSelectedBehavioralCases([caseDir], casesRoot),
      /confirmation is not registered by the curator policy/,
    );
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

test("curator policy rejects symlink substitution", async () => {
  const outer = mkdtempSync(join(tmpdir(), "peregrine-corpus-policy-symlink-"));
  const casesRoot = join(outer, "cases");
  try {
    const caseDir = createCleanBehavioralCase(casesRoot, "development", "case-aaaabbbe", "admitted");
    const externalPolicy = join(outer, "external-policy.json");
    renameSync(join(outer, "curator-policy.json"), externalPolicy);
    symlinkSync(externalPolicy, join(outer, "curator-policy.json"));
    await assert.rejects(
      () => validateSelectedBehavioralCases([caseDir], casesRoot),
      /curator policy must be a direct regular non-symlink file/,
    );
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

test("curation and holdout metadata reject symlinks", async () => {
  const outer = mkdtempSync(join(tmpdir(), "peregrine-corpus-symlink-"));
  const casesRoot = join(outer, "cases");
  try {
    const caseDir = createCleanBehavioralCase(casesRoot, "development", "case-aaaacccc", "draft");
    mkdirSync(join(casesRoot, "validation"), { recursive: true });
    const externalCuration = join(outer, "external-curation.json");
    renameSync(join(caseDir, "curation.json"), externalCuration);
    symlinkSync(externalCuration, join(caseDir, "curation.json"));
    await assert.rejects(() => validateBehavioralCorpus(casesRoot), /curation\.json must be a direct regular non-symlink file/);

    rmSync(caseDir, { recursive: true, force: true });
    const holdout = join(outer, "external-holdout.json");
    writeFileSync(holdout, JSON.stringify(validHoldoutCommitment()));
    symlinkSync(holdout, join(outer, "holdout-commitment.json"));
    await assert.rejects(() => validateBehavioralCorpus(casesRoot), /holdout commitment must be a direct regular non-symlink/);
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

test("validator rejects duplicate opaque IDs across visible corpora", async () => {
  const outer = mkdtempSync(join(tmpdir(), "peregrine-corpus-duplicate-"));
  const root = join(outer, "cases");
  try {
    createCleanBehavioralCase(root, "development", "case-ddddaaaa", "draft");
    createCleanBehavioralCase(root, "validation", "case-ddddaaaa", "draft");
    await assert.rejects(() => validateBehavioralCorpus(root), /duplicate opaque case id case-ddddaaaa/);
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

test("historical source identity is authenticated by materialized provenance", () => {
  assert.doesNotThrow(() => assertHistoricalRepositoryIdentity("case-aaaadddd", "a".repeat(64), "a".repeat(64)));
  assert.throws(
    () => assertHistoricalRepositoryIdentity("case-aaaadddd", "a".repeat(64), "b".repeat(64)),
    /does not match materialized source provenance/,
  );
  assert.throws(
    () => assertHistoricalRepositoryIdentity("case-aaaadddd", "a".repeat(64), undefined),
    /does not match materialized source provenance/,
  );
});

test("historical repository family identity is canonical over complete root commits", () => {
  const first = "a".repeat(40);
  const second = "b".repeat(40);
  assert.equal(
    repositoryFamilyIdentitySha256("sha1", [second, first]),
    repositoryFamilyIdentitySha256("sha1", [first, second, first]),
  );
  assert.throws(() => repositoryFamilyIdentitySha256("sha1", []), /complete root commit object IDs/);
  assert.throws(() => repositoryFamilyIdentitySha256("sha1", ["c".repeat(64)]), /complete root commit object IDs/);
});

test("selected admission derives language from the authenticated fixture", async () => {
  const outer = mkdtempSync(join(tmpdir(), "peregrine-corpus-derived-strata-"));
  const root = join(outer, "cases");
  try {
    const languageCase = createCleanBehavioralCase(root, "development", "case-eeeecccc", "admitted");
    rewriteAndSignCuration(languageCase, (value) => {
      (value.strata as Record<string, unknown>).languageFamily = "python";
    });
    await assert.rejects(
      () => validateSelectedBehavioralCases([languageCase]),
      /language family python does not match derived typescript/,
    );

  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

test("distinct authenticated fixture trees may share one curator alias", async () => {
  const outer = mkdtempSync(join(tmpdir(), "peregrine-corpus-fixture-alias-"));
  const casesRoot = join(outer, "cases");
  try {
    const first = createCleanBehavioralCase(
      casesRoot, "development", "case-eeeecccd", "admitted", "case-00000001",
    );
    const second = createCleanBehavioralCase(
      casesRoot, "validation", "case-eeeeccce", "admitted", "case-00000002",
    );
    const firstCuration = JSON.parse(readFileSync(join(first, "curation.json"), "utf8"));
    const secondCuration = JSON.parse(readFileSync(join(second, "curation.json"), "utf8"));
    assert.equal(firstCuration.source.repositoryAlias, secondCuration.source.repositoryAlias);
    assert.notEqual(firstCuration.source.repositoryIdentitySha256, secondCuration.source.repositoryIdentitySha256);
    await assert.doesNotReject(() => validateSelectedBehavioralCases([first, second], casesRoot));
    await assert.doesNotReject(() => validateBehavioralCorpus(casesRoot));
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

test("screening rejects an unadmitted selected case before provider or run artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-screening-admission-"));
  const casesRoot = join(root, "cases");
  const runsRoot = join(root, "runs");
  try {
    const caseDir = createCleanBehavioralCase(casesRoot, "development", "case-eeeeaaaa", "draft");
    mkdirSync(join(casesRoot, "validation"), { recursive: true });
    const matrix = join(root, "matrix.json");
    writeFileSync(matrix, JSON.stringify(behavioralMatrix("screening", ["development"])));
    await assert.rejects(() => runMatrix(matrix, runsRoot, { casesDir: casesRoot }), /not admitted to the behavioral corpus/);
    assert.equal(existsSync(runsRoot), false);
    assert.ok(existsSync(caseDir));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("screening rejects an empty behavioral selection before creating run artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-screening-empty-"));
  const casesRoot = join(root, "cases");
  const runsRoot = join(root, "runs");
  try {
    mkdirSync(join(casesRoot, "development"), { recursive: true });
    mkdirSync(join(casesRoot, "validation"), { recursive: true });
    mkdirSync(join(casesRoot, "structural-smoke"), { recursive: true });
    const matrix = join(root, "matrix.json");
    writeFileSync(matrix, JSON.stringify(behavioralMatrix("screening", ["development"])));
    await assert.rejects(() => runMatrix(matrix, runsRoot, { casesDir: casesRoot }), /at least one selected behavioral case/);
    assert.equal(existsSync(runsRoot), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("screening rejects duplicate IDs across selected and unselected behavioral corpora", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-screening-duplicate-"));
  const casesRoot = join(root, "cases");
  const runsRoot = join(root, "runs");
  try {
    createCleanBehavioralCase(casesRoot, "development", "case-eeeeaaab", "admitted");
    createCleanBehavioralCase(casesRoot, "validation", "case-eeeeaaab", "draft");
    const matrix = join(root, "matrix.json");
    writeFileSync(matrix, JSON.stringify(behavioralMatrix("screening", ["development"])));
    await assert.rejects(() => runMatrix(matrix, runsRoot, { casesDir: casesRoot }), /duplicate opaque case id/);
    assert.equal(existsSync(runsRoot), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkpoint requires both behavioral corpora before provider or run artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-checkpoint-gold-"));
  const casesRoot = join(root, "cases");
  const runsRoot = join(root, "runs");
  try {
    mkdirSync(join(casesRoot, "development"), { recursive: true });
    mkdirSync(join(casesRoot, "validation"), { recursive: true });
    createCleanBehavioralCase(casesRoot, "development", "case-eeeeaaac", "admitted");
    const matrix = join(root, "matrix.json");
    writeFileSync(matrix, JSON.stringify(behavioralMatrix("checkpoint", ["development"])));
    await assert.rejects(
      () => runMatrix(matrix, runsRoot, { casesDir: casesRoot }),
      /must contain development and validation cases and no structural-smoke/,
    );
    assert.equal(existsSync(runsRoot), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checkpoint rejects structural-smoke cases before provider or run artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-checkpoint-structural-"));
  const casesRoot = join(root, "cases");
  const runsRoot = join(root, "runs");
  try {
    mkdirSync(join(casesRoot, "development"), { recursive: true });
    mkdirSync(join(casesRoot, "validation"), { recursive: true });
    mkdirSync(join(casesRoot, "structural-smoke"), { recursive: true });
    cpSync(
      join(process.cwd(), "eval/cases/structural-smoke/case-00000001"),
      join(casesRoot, "structural-smoke", "case-00000001"),
      { recursive: true },
    );
    const matrix = join(root, "matrix.json");
    writeFileSync(matrix, JSON.stringify(behavioralMatrix("checkpoint", ["structural-smoke"])));
    await assert.rejects(
      () => runMatrix(matrix, runsRoot, { casesDir: casesRoot }),
      /must contain development and validation cases and no structural-smoke/,
    );
    assert.equal(existsSync(runsRoot), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("size strata freeze the production schema-v1 large-diff boundary", () => {
  assert.equal(diffSizeStratum(250), "small");
  assert.equal(diffSizeStratum(251), "medium");
  assert.equal(diffSizeStratum(1_500), "medium");
  assert.equal(diffSizeStratum(1_501), "large");
});

test("seeded, historical gold, and final holdout readiness remain distinct", () => {
  const lanes = [
    "authorization", "identifiers", "data-integrity", "persistence", "runtime-config", "contracts",
    "concurrency", "test-quality", "logic-correctness", "error-handling", "frontend-state", "boundaries-pagination",
  ] as const;
  const cases: ValidatedBehavioralCase[] = [];
  let index = 0;
  for (const corpus of ["development", "validation"] as const) {
    for (const lane of lanes) cases.push(summaryCase(index++, corpus, lane, false));
  }
  for (const lane of lanes.slice(0, 8)) cases.push(summaryCase(index++, "development", lane, true));
  for (const lane of lanes.slice(8)) cases.push(summaryCase(index++, "validation", lane, true));

  const seeded = buildCorpusValidationReport(cases, true);
  assert.equal(seeded.admittedCases, 36);
  assert.equal(seeded.cleanCases, 12);
  assert.equal(seeded.largeDiffCases, 3);
  assert.equal(seeded.multiObservationCases, 3);
  assert.equal(seeded.authenticatedFixtureSources, 4);
  assert.equal(seeded.provenHistoricalRepositories, 0);
  assert.equal(seeded.visibleSeededBenchmarkReady, true);
  assert.equal(seeded.goldSetReady, false);
  assert.equal(seeded.finalHoldoutReady, false);
  assert.deepEqual(seeded.seededBenchmarkRequirements, []);

  const goldCases = cases.map((item, itemIndex): ValidatedBehavioralCase => itemIndex >= 3 ? item : ({
    ...item,
    spec: {
      id: item.spec.id,
      corpus: item.spec.corpus,
      kind: "historical",
      repoSource: "/curator/source",
      baseCommit: "a".repeat(40),
      headCommit: "b".repeat(40),
      diffFile: item.spec.diffFile,
    },
    curation: { ...item.curation, source: { ...item.curation.source, kind: "historical" } },
  }));
  const gold = buildCorpusValidationReport(goldCases, false);
  assert.equal(gold.goldSetReady, true);
  assert.equal(gold.finalHoldoutReady, false);
  const final = buildCorpusValidationReport(goldCases, true);
  assert.equal(final.visibleSeededBenchmarkReady, true);
  assert.equal(final.goldSetReady, true);
  assert.equal(final.finalHoldoutReady, true);
});

function summaryCase(
  index: number,
  corpus: "development" | "validation",
  lane: CoreLaneId,
  clean: boolean,
): ValidatedBehavioralCase {
  const id = `case-${index.toString(16).padStart(8, "0")}`;
  const large = index < 3;
  const multi = index >= 3 && index < 6;
  const shapes: ChangeShape[] = [
    index === 6 ? "seam" : "direct",
    ...(large ? ["large-diff" as const] : []),
    ...(multi ? ["multi-observation" as const] : []),
  ];
  return {
    corpus,
    spec: clean
      ? { id, corpus, kind: "clean", fixtureDir: "fixture", diffFile: "diff.patch" }
      : { id, corpus, kind: "seeded", fixtureDir: "fixture", diffFile: "diff.patch" },
    truth: clean ? { bugs: [] } : { bugs: [{
      id: `bug-${index.toString(16).padStart(8, "0")}`,
      lane,
      expectedDisposition: "fix-in-pr",
      expectedSeverity: "medium",
      file: "src/example.ts",
      startLine: 1,
      endLine: 1,
      description: "Confirmed defect.",
      reachablePreconditions: "The changed path executes.",
      observableImpact: "The result is incorrect.",
      provenance: "Independently confirmed source.",
    }] },
    curation: {
      schemaVersion: 1,
      caseId: id,
      status: "admitted",
      curatorPolicyId: "protected-git-review-v1",
      source: {
        kind: clean ? "clean" : "seeded",
        repositoryAlias: `repo-${index % 4}`,
        repositoryIdentitySha256: String(index % 4).repeat(64),
        changeIdentitySha256: index.toString(16).padStart(64, "0"),
        access: "public",
      },
      strata: {
        languageFamily: index % 2 === 0 ? "typescript" : "python",
        architectureFamily: index % 2 === 0 ? "backend-service" : "worker-service",
        size: large ? "large" : "small",
        changeShapes: shapes,
        surfaceLanes: [lane],
      },
      proof: {
        kind: clean ? "clean-control-review" : "regression-test",
        artifact: "proof.md",
        sha256: "a".repeat(64),
      },
      confirmations: [],
    },
  };
}

function createCleanBehavioralCase(
  casesRoot: string,
  corpus: "development" | "validation",
  id: string,
  status: "draft" | "admitted",
  templateCaseId = "case-00000001",
): string {
  const target = join(casesRoot, corpus, id);
  cpSync(join(process.cwd(), "eval/cases/structural-smoke", templateCaseId), target, { recursive: true });
  const spec: CaseSpec = { id, corpus, kind: "clean", fixtureDir: "fixture", diffFile: "diff.patch" };
  const truth = { bugs: [] };
  writeFileSync(join(target, "case.json"), JSON.stringify(spec));
  writeFileSync(join(target, "ground_truth.json"), JSON.stringify(truth));
  const proof = "Independent clean-control review evidence.\n";
  writeFileSync(join(target, "proof.md"), proof);
  const value = curation(spec, status);
  writeCuratorPolicyForCasesRoot(casesRoot);
  (value.source as Record<string, unknown>).repositoryIdentitySha256 = fixtureSourceIdentitySha256(target, spec.fixtureDir);
  (value.source as Record<string, unknown>).changeIdentitySha256 = sha(readFileSync(join(target, "diff.patch"), "utf8"));
  (value.proof as Record<string, unknown>).sha256 = sha(proof);
  if (status === "admitted") {
    const parsed = parseCaseCuration(value, spec, truth);
    const bundle = caseBundleSha256(target, spec, parsed);
    for (const confirmation of value.confirmations as Array<Record<string, unknown>>) confirmation.caseBundleSha256 = bundle;
  }
  writeFileSync(join(target, "curation.json"), JSON.stringify(value));
  return target;
}

function writeCuratorPolicyForCasesRoot(casesRoot: string): void {
  const bytes = `${JSON.stringify({
    schemaVersion: 1,
    policyId: "protected-git-review-v1",
    trustRoot: "protected-git-review",
    minimumIndependentConfirmations: 2,
    curatorIdentitySha256s: ["4".repeat(64), "5".repeat(64)],
  }, null, 2)}\n`;
  mkdirSync(join(casesRoot, ".."), { recursive: true });
  writeFileSync(join(casesRoot, "..", "curator-policy.json"), bytes);
}

function rewriteAndSignCuration(caseDir: string, mutate: (value: Record<string, unknown>) => void): void {
  const spec = JSON.parse(readFileSync(join(caseDir, "case.json"), "utf8")) as CaseSpec;
  const truth = JSON.parse(readFileSync(join(caseDir, "ground_truth.json"), "utf8")) as GroundTruth;
  const value = JSON.parse(readFileSync(join(caseDir, "curation.json"), "utf8")) as Record<string, unknown>;
  mutate(value);
  const source = value.source as Record<string, unknown>;
  source.changeIdentitySha256 = createHash("sha256").update(readFileSync(join(caseDir, spec.diffFile))).digest("hex");
  const withoutAuthenticators = value.confirmations as Array<Record<string, unknown>>;
  for (const confirmation of withoutAuthenticators) confirmation.caseBundleSha256 = "0".repeat(64);
  const parsed = parseCaseCuration(value, spec, truth);
  const bundle = caseBundleSha256(caseDir, spec, parsed);
  for (const confirmation of withoutAuthenticators) confirmation.caseBundleSha256 = bundle;
  writeFileSync(join(caseDir, "curation.json"), JSON.stringify(value));
}

function validHoldoutCommitment(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: "sealed-holdout-commitment",
    status: "unopened",
    stewardIdentitySha256: "6".repeat(64),
    storageBoundary: "external-access-controlled",
    corpusCommitmentSha256: "7".repeat(64),
    caseCount: 8,
    committedAt: "2026-09-03T14:00:00Z",
  };
}

function behavioralMatrix(
  mode: "screening" | "checkpoint",
  corpora: Array<"development" | "validation" | "structural-smoke">,
): Record<string, unknown> {
  return {
    repeats: 1,
    corpora,
    configs: [
      { name: "control", runner: "codex" },
      { name: "treatment", runner: "codex" },
    ],
    experiment: {
      mode,
      seed: 20260903,
      cacheCondition: "uncontrolled",
      providerCalls: "deny",
      providerAccess: "cli-session",
      costAccounting: "best-effort",
      control: "control",
      treatment: "treatment",
      judge: { kind: "codex", model: "gpt-5.6-luna", version: "semantic-v1" },
      limits: {
        maxProviderCostUsd: null,
        maxProviderAttempts: 0,
        maxWallTimeMs: 0,
        maxFailureRate: 0,
        minAttemptsForFailureRate: 1,
        maxConsecutiveFailures: 1,
      },
    },
  };
}
