import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  parseCaseCuration,
  diffSizeStratum,
  parseHoldoutCommitment,
  requiredConfirmationChecks,
  verifyCurationProof,
  type ChangeShape,
} from "../eval/case-curation.js";
import { parseBehavioralGroundTruth, parseGroundTruth } from "../eval/case-truth.js";
import {
  buildCorpusValidationReport,
  validateBehavioralCorpus,
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
      { curatorIdentitySha256: "4".repeat(64), confirmedAt: "2026-09-03T12:00:00Z", checks },
      { curatorIdentitySha256: "5".repeat(64), confirmedAt: "2026-09-03T13:00:00Z", checks },
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
  const root = mkdtempSync(join(tmpdir(), "peregrine-corpus-"));
  try {
    mkdirSync(join(root, "development"));
    mkdirSync(join(root, "validation"));
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
    const proof = "Independent clean-control review evidence.\n";
    writeFileSync(join(target, "proof.md"), proof);
    const value = curation(caseSpec, "draft");
    const diff = readFileSync(join(target, "diff.patch"));
    const source = value.source as Record<string, unknown>;
    source.changeIdentitySha256 = createHash("sha256").update(diff).digest("hex");
    const proofRecord = value.proof as Record<string, unknown>;
    proofRecord.sha256 = sha(proof);
    writeFileSync(join(target, "curation.json"), `${JSON.stringify(value, null, 2)}\n`);

    const report = await validateBehavioralCorpus(root);
    assert.equal(report.totalCases, 1);
    assert.equal(report.admittedCases, 0);
    assert.equal(report.draftCases, 1);
    assert.equal(report.visibleBaselineReady, false);
    assert.equal(report.finalHoldoutReady, false);
    assert.ok(report.unmetRequirements.includes("every visible behavioral case is admitted"));
    assert.deepEqual(report.holdoutRequirements, ["external sealed holdout commitment metadata exists"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checked-in schemas retain strict parser discriminants", () => {
  const truthSchema = JSON.parse(readFileSync(join(process.cwd(), "schemas/benchmark-case.schema.json"), "utf8"));
  const curationSchema = JSON.parse(readFileSync(join(process.cwd(), "schemas/benchmark-curation.schema.json"), "utf8"));
  const holdoutSchema = JSON.parse(readFileSync(join(process.cwd(), "schemas/holdout-commitment.schema.json"), "utf8"));
  assert.equal(truthSchema.$defs.bug.properties.id.pattern, "^bug-[a-f0-9]{8,32}$");
  assert.deepEqual(curationSchema.required, ["schemaVersion", "caseId", "status", "source", "strata", "proof", "confirmations"]);
  assert.equal(holdoutSchema.properties.status.const, "unopened");
  assert.equal(holdoutSchema.properties.caseIds, undefined);
});

test("size strata freeze the production schema-v1 large-diff boundary", () => {
  assert.equal(diffSizeStratum(250), "small");
  assert.equal(diffSizeStratum(251), "medium");
  assert.equal(diffSizeStratum(1_500), "medium");
  assert.equal(diffSizeStratum(1_501), "large");
});

test("visible baseline readiness is exact and independent from final holdout readiness", () => {
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

  const visible = buildCorpusValidationReport(cases, false);
  assert.equal(visible.admittedCases, 36);
  assert.equal(visible.cleanCases, 12);
  assert.equal(visible.largeDiffCases, 3);
  assert.equal(visible.multiObservationCases, 3);
  assert.equal(visible.visibleBaselineReady, true);
  assert.equal(visible.finalHoldoutReady, false);
  assert.deepEqual(visible.unmetRequirements, []);

  const final = buildCorpusValidationReport(cases, true);
  assert.equal(final.visibleBaselineReady, true);
  assert.equal(final.finalHoldoutReady, true);
  assert.deepEqual(final.holdoutRequirements, []);
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
      source: {
        kind: clean ? "clean" : "seeded",
        repositoryAlias: `repo-${index % 4}`,
        repositoryIdentitySha256: String(index % 4).repeat(64),
        changeIdentitySha256: index.toString(16).padStart(64, "0"),
        access: "public",
      },
      strata: {
        languageFamily: index % 2 === 0 ? "typescript" : "python",
        architectureFamily: index % 2 === 0 ? "web-service" : "worker-service",
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
