import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CuratorPolicy } from "../eval/case-curation.js";
import {
  historicalCaseBundleSha256,
  historicalTruthScopeSha256,
  parseHistoricalCuration,
  readHistoricalCaseAdmission,
  requiredHistoricalConfirmationChecks,
} from "../eval/historical-curation.js";
import { historicalPermittedMetrics, parseHistoricalGroundTruth } from "../eval/historical-truth.js";
import type { HistoricalCaseSpec } from "../src/types.js";

const sha = (value: string): string => createHash("sha256").update(value).digest("hex");
const curatorOne = "1".repeat(64);
const curatorTwo = "2".repeat(64);

interface CreatedCase {
  root: string;
  caseDir: string;
  spec: HistoricalCaseSpec;
  policy: CuratorPolicy;
}

function groundTruth(status: "known-roots" | "reviewed-comparison"): Record<string, unknown> {
  return {
    schemaVersion: 2,
    scope: {
      protocol: "historical-efficacy-v1",
      truthVersion: "truth-v1",
      status,
      completeness: "partial",
      reviewedScope: status === "known-roots"
        ? "The exact review change and one independently supported callback-loss root."
        : "Only the changed retry-selection behavior; this is not a global clean assertion.",
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
      startLine: 8,
      endLine: 10,
      description: "The new retry path omits the completion callback.",
      reachablePreconditions: "A request takes the retry branch.",
      observableImpact: "The request remains pending.",
      provenance: "The historical head and later repair support this causal root.",
    }] : [],
  };
}

function createCase(
  truthStatus: "known-roots" | "reviewed-comparison",
  status: "draft" | "admitted",
  caseId = "case-aaaaaaaa",
): CreatedCase {
  const root = mkdtempSync(join(tmpdir(), "peregrine-historical-curation-"));
  const caseDir = join(root, "development", caseId);
  mkdirSync(caseDir, { recursive: true });
  const spec: HistoricalCaseSpec = {
    id: caseId,
    corpus: "development",
    kind: "historical",
    evaluationProtocol: "historical-efficacy-v1",
    repoSource: "/curator/authenticated-source.git",
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40),
    diffFile: "diff.patch",
  };
  const truthValue = groundTruth(truthStatus);
  const parsedTruth = parseHistoricalGroundTruth(truthValue);
  const diff = "diff --git a/src/retry.ts b/src/retry.ts\n+retry();\n";
  const proof = truthStatus === "known-roots"
    ? "Complete static trace of the historical callback-loss root.\n"
    : "Independent review of the narrow retry-selection comparison scope.\n";
  writeFileSync(join(caseDir, "case.json"), `${JSON.stringify(spec, null, 2)}\n`);
  writeFileSync(join(caseDir, "ground_truth.json"), `${JSON.stringify(truthValue, null, 2)}\n`);
  writeFileSync(join(caseDir, "diff.patch"), diff);
  writeFileSync(join(caseDir, "proof.md"), proof);
  const checks = requiredHistoricalConfirmationChecks(truthStatus);
  const curation: Record<string, any> = {
    schemaVersion: 2,
    protocol: "historical-efficacy-v1",
    caseId,
    status,
    curatorPolicyId: "protected-git-review-v1",
    truth: {
      truthVersion: "truth-v1",
      status: truthStatus,
      completeness: "partial",
      scopeSha256: historicalTruthScopeSha256(parsedTruth),
    },
    source: {
      kind: "historical",
      repositoryAlias: "public-history",
      repositoryIdentitySha256: sha("repository-family"),
      changeIdentitySha256: sha(diff),
      access: "public",
    },
    strata: {
      languageFamily: "typescript",
      architectureFamily: "library",
      size: "small",
      changeShapes: ["seam"],
      secondarySurfaceLanes: [],
      mechanismFamilies: truthStatus === "known-roots" ? ["callback-loss"] : [],
    },
    proof: {
      kind: truthStatus === "known-roots" ? "reasoned-analysis" : "reviewed-comparison-analysis",
      artifact: "proof.md",
      sha256: sha(proof),
    },
    confirmations: status === "draft" ? [] : [
      {
        curatorIdentitySha256: curatorOne,
        confirmedAt: "2026-09-05T12:00:00Z",
        caseBundleSha256: "0".repeat(64),
        truthScopeSha256: historicalTruthScopeSha256(parsedTruth),
        checks,
      },
      {
        curatorIdentitySha256: curatorTwo,
        confirmedAt: "2026-09-05T13:00:00Z",
        caseBundleSha256: "0".repeat(64),
        truthScopeSha256: historicalTruthScopeSha256(parsedTruth),
        checks,
      },
    ],
  };
  if (status === "admitted") {
    const parsed = parseHistoricalCuration(curation, spec, parsedTruth);
    const bundle = historicalCaseBundleSha256(caseDir, spec, parsed);
    for (const confirmation of curation.confirmations) confirmation.caseBundleSha256 = bundle;
  }
  writeFileSync(join(caseDir, "curation.json"), `${JSON.stringify(curation, null, 2)}\n`);
  return {
    root,
    caseDir,
    spec,
    policy: {
      schemaVersion: 1,
      policyId: "protected-git-review-v1",
      trustRoot: "protected-git-review",
      minimumIndependentConfirmations: 2,
      curatorIdentitySha256s: [curatorOne, curatorTwo],
    },
  };
}

test("an admitted historical root authenticates exact files and caller-trusted confirmations", () => {
  const created = createCase("known-roots", "admitted");
  try {
    const admission = readHistoricalCaseAdmission(created.caseDir, created.spec, created.policy);
    assert.equal(admission.curation.status, "admitted");
    assert.equal(admission.truth.scope.status, "known-roots");
    assert.equal(admission.curation.strata.secondarySurfaceLanes.length, 0);
    assert.deepEqual(admission.curation.strata.mechanismFamilies, ["callback-loss"]);
    assert.equal(admission.verificationBoundary, "declared-bundle-and-policy-only");
    assert.equal(admission.diffLines, 2);
  } finally {
    rmSync(created.root, { recursive: true, force: true });
  }
});

test("drafts remain readable only when explicitly requested and cannot masquerade as admitted", () => {
  const created = createCase("known-roots", "draft");
  try {
    assert.throws(
      () => readHistoricalCaseAdmission(created.caseDir, created.spec, created.policy),
      /not admitted to the historical efficacy corpus/,
    );
    const draft = readHistoricalCaseAdmission(
      created.caseDir, created.spec, created.policy, { requireAdmitted: false },
    );
    assert.equal(draft.curation.status, "draft");
    assert.deepEqual(draft.curation.confirmations, []);
  } finally {
    rmSync(created.root, { recursive: true, force: true });
  }
});

test("reviewed comparisons preserve historical provenance and a narrow partial scope", () => {
  const created = createCase("reviewed-comparison", "admitted");
  try {
    const admission = readHistoricalCaseAdmission(created.caseDir, created.spec, created.policy);
    assert.equal(admission.curation.source.kind, "historical");
    assert.equal(admission.truth.scope.status, "reviewed-comparison");
    assert.equal(admission.truth.scope.completeness, "partial");
    assert.match(admission.truth.scope.reviewedScope, /not a global clean assertion/);
    assert.deepEqual(admission.curation.strata.mechanismFamilies, []);
    assert.deepEqual(admission.curation.strata.secondarySurfaceLanes, []);
    assert.equal(admission.truth.scope.permittedMetrics.includes("known-root-recall"), false);
  } finally {
    rmSync(created.root, { recursive: true, force: true });
  }
});

test("proof, diff, and truth drift invalidate an admitted bundle", () => {
  for (const mutate of [
    (created: CreatedCase) => writeFileSync(join(created.caseDir, "proof.md"), "tampered proof\n"),
    (created: CreatedCase) => writeFileSync(join(created.caseDir, "diff.patch"), "tampered diff\n"),
    (created: CreatedCase) => {
      const truth = JSON.parse(readFileSync(join(created.caseDir, "ground_truth.json"), "utf8"));
      truth.scope.reviewedScope += " Changed after confirmation.";
      writeFileSync(join(created.caseDir, "ground_truth.json"), JSON.stringify(truth));
    },
  ]) {
    const created = createCase("known-roots", "admitted");
    try {
      mutate(created);
      assert.throws(() => readHistoricalCaseAdmission(created.caseDir, created.spec, created.policy));
    } finally {
      rmSync(created.root, { recursive: true, force: true });
    }
  }
});

test("stale truth versions and cross-case curation reject", () => {
  const stale = createCase("known-roots", "draft");
  try {
    const truth = JSON.parse(readFileSync(join(stale.caseDir, "ground_truth.json"), "utf8"));
    truth.scope.truthVersion = "truth-v2";
    writeFileSync(join(stale.caseDir, "ground_truth.json"), JSON.stringify(truth));
    assert.throws(
      () => readHistoricalCaseAdmission(stale.caseDir, stale.spec, stale.policy, { requireAdmitted: false }),
      /truthVersion is stale/,
    );
  } finally {
    rmSync(stale.root, { recursive: true, force: true });
  }

  const crossCase = createCase("known-roots", "draft", "case-bbbbbbbb");
  try {
    const curation = JSON.parse(readFileSync(join(crossCase.caseDir, "curation.json"), "utf8"));
    curation.caseId = "case-aaaaaaaa";
    writeFileSync(join(crossCase.caseDir, "curation.json"), JSON.stringify(curation));
    assert.throws(
      () => readHistoricalCaseAdmission(crossCase.caseDir, crossCase.spec, crossCase.policy, { requireAdmitted: false }),
      /caseId must match case.json/,
    );
  } finally {
    rmSync(crossCase.root, { recursive: true, force: true });
  }
});

test("duplicate or untrusted curator identities cannot satisfy admission", () => {
  const duplicate = createCase("known-roots", "admitted");
  try {
    const value = JSON.parse(readFileSync(join(duplicate.caseDir, "curation.json"), "utf8"));
    value.confirmations[1].curatorIdentitySha256 = value.confirmations[0].curatorIdentitySha256;
    const truth = parseHistoricalGroundTruth(JSON.parse(
      readFileSync(join(duplicate.caseDir, "ground_truth.json"), "utf8"),
    ));
    assert.throws(
      () => parseHistoricalCuration(value, duplicate.spec, truth),
      /duplicate curator/,
    );
  } finally {
    rmSync(duplicate.root, { recursive: true, force: true });
  }

  const untrusted = createCase("known-roots", "admitted");
  try {
    const policy = { ...untrusted.policy, curatorIdentitySha256s: [curatorOne, "3".repeat(64)] };
    assert.throws(
      () => readHistoricalCaseAdmission(untrusted.caseDir, untrusted.spec, policy),
      /not registered by the caller-supplied curator policy/,
    );
  } finally {
    rmSync(untrusted.root, { recursive: true, force: true });
  }
});

test("change-shape declarations derive from root observations and actual diff size", () => {
  for (const changeShapes of [
    ["direct", "seam"],
    ["seam", "multi-observation"],
    ["seam", "large-diff"],
  ]) {
    const created = createCase("known-roots", "draft");
    try {
      const value = JSON.parse(readFileSync(join(created.caseDir, "curation.json"), "utf8"));
      value.strata.changeShapes = changeShapes;
      writeFileSync(join(created.caseDir, "curation.json"), JSON.stringify(value));
      assert.throws(
        () => readHistoricalCaseAdmission(created.caseDir, created.spec, created.policy, { requireAdmitted: false }),
        changeShapes.includes("large-diff") ? /large-diff shape does not match/ : /changeShapes|multi-observation/,
      );
    } finally {
      rmSync(created.root, { recursive: true, force: true });
    }
  }

  const singletonGroup = createCase("known-roots", "draft");
  try {
    const truth = JSON.parse(readFileSync(join(singletonGroup.caseDir, "ground_truth.json"), "utf8"));
    truth.bugs[0].rootCauseGroup = "root-aaaaaaaa";
    writeFileSync(join(singletonGroup.caseDir, "ground_truth.json"), JSON.stringify(truth));
    assert.doesNotThrow(
      () => readHistoricalCaseAdmission(
        singletonGroup.caseDir, singletonGroup.spec, singletonGroup.policy, { requireAdmitted: false },
      ),
      "an explicit singleton root label is not a multi-observation root",
    );
  } finally {
    rmSync(singletonGroup.root, { recursive: true, force: true });
  }

  const actualMulti = createCase("known-roots", "draft");
  try {
    const truth = JSON.parse(readFileSync(join(actualMulti.caseDir, "ground_truth.json"), "utf8"));
    truth.bugs[0].rootCauseGroup = "root-aaaaaaaa";
    truth.bugs.push({
      ...truth.bugs[0],
      id: "bug-bbbbbbbb",
      file: "src/caller.ts",
      startLine: 20,
      endLine: 20,
    });
    writeFileSync(join(actualMulti.caseDir, "ground_truth.json"), JSON.stringify(truth));
    assert.throws(
      () => readHistoricalCaseAdmission(actualMulti.caseDir, actualMulti.spec, actualMulti.policy, {
        requireAdmitted: false,
      }),
      /multi-observation shape must exactly match/,
    );
    const value = JSON.parse(readFileSync(join(actualMulti.caseDir, "curation.json"), "utf8"));
    value.strata.changeShapes = ["seam", "multi-observation"];
    writeFileSync(join(actualMulti.caseDir, "curation.json"), JSON.stringify(value));
    assert.doesNotThrow(() => readHistoricalCaseAdmission(
      actualMulti.caseDir, actualMulti.spec, actualMulti.policy, { requireAdmitted: false },
    ));
  } finally {
    rmSync(actualMulti.root, { recursive: true, force: true });
  }
});

test("proof paths cannot alias a diff or another reserved runner input", () => {
  const diffAlias = createCase("known-roots", "draft");
  try {
    mkdirSync(join(diffAlias.caseDir, "inputs"));
    const diff = readFileSync(join(diffAlias.caseDir, "diff.patch"), "utf8");
    writeFileSync(join(diffAlias.caseDir, "inputs", "diff.patch"), diff);
    diffAlias.spec.diffFile = "inputs/diff.patch";
    writeFileSync(join(diffAlias.caseDir, "case.json"), JSON.stringify(diffAlias.spec));
    const value = JSON.parse(readFileSync(join(diffAlias.caseDir, "curation.json"), "utf8"));
    value.proof.artifact = "inputs//diff.patch";
    value.proof.sha256 = sha(diff);
    writeFileSync(join(diffAlias.caseDir, "curation.json"), JSON.stringify(value));
    assert.throws(
      () => readHistoricalCaseAdmission(diffAlias.caseDir, diffAlias.spec, diffAlias.policy, {
        requireAdmitted: false,
      }),
      /safe case-relative path/,
    );
  } finally {
    rmSync(diffAlias.root, { recursive: true, force: true });
  }

  const metadataAlias = createCase("known-roots", "draft");
  try {
    mkdirSync(join(metadataAlias.caseDir, "inputs"));
    metadataAlias.spec.metadataFile = "inputs/../proof.md";
    writeFileSync(join(metadataAlias.caseDir, "case.json"), JSON.stringify(metadataAlias.spec));
    assert.throws(
      () => readHistoricalCaseAdmission(metadataAlias.caseDir, metadataAlias.spec, metadataAlias.policy, {
        requireAdmitted: false,
      }),
      /curation proof resolves to a reserved runner input/,
    );
  } finally {
    rmSync(metadataAlias.root, { recursive: true, force: true });
  }
});

test("the checked-in schema keeps v2 historical and partial-truth boundaries explicit", () => {
  const schema = JSON.parse(readFileSync("schemas/historical-curation.schema.json", "utf8"));
  assert.equal(schema.properties.schemaVersion.const, 2);
  assert.equal(schema.properties.protocol.const, "historical-efficacy-v1");
  assert.equal(schema.properties.source.properties.kind.const, "historical");
  assert.equal(schema.properties.truth.properties.completeness.const, "partial");
  assert.equal(schema.properties.strata.properties.secondarySurfaceLanes.minItems, undefined);
  assert.match(schema.properties.proof.properties.artifact.pattern, /\.\*\/\//);
  assert.equal(schema.allOf[1].oneOf.length, 2);
  assert.match(schema.$comment, /external trusted curator policy/);
});
