import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadCaseSpec, runMatrix } from "../eval/run-matrix.js";

function writeCase(
  root: string,
  corpus: "structural-smoke" | "development" | "validation",
  id: string,
  value: Record<string, unknown>,
): string {
  const caseDir = join(root, corpus, id);
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(join(caseDir, "case.json"), `${JSON.stringify({ id, corpus, ...value }, null, 2)}\n`);
  return caseDir;
}

function historical(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "historical",
    repoSource: "/tmp/authenticated-source.git",
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40),
    diffFile: "diff.patch",
    ...overrides,
  };
}

test("legacy and neutral historical case specs load without hidden defaults", () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-historical-spec-"));
  try {
    const legacyDir = writeCase(root, "development", "case-11111111", historical());
    const neutralDir = writeCase(root, "validation", "case-22222222", historical({
      evaluationProtocol: "historical-efficacy-v1",
    }));

    const legacy = loadCaseSpec(legacyDir);
    assert.equal(legacy.kind, "historical");
    assert.equal("evaluationProtocol" in legacy, false);
    assert.equal(legacy.repoSource, "/tmp/authenticated-source.git");

    const neutral = loadCaseSpec(neutralDir);
    assert.equal(neutral.kind, "historical");
    assert.equal(neutral.evaluationProtocol, "historical-efficacy-v1");
    assert.equal(neutral.baseCommit, "a".repeat(40));
    assert.equal(neutral.headCommit, "b".repeat(40));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the neutral protocol is historical-only and rejects unknown protocol values", () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-historical-spec-reject-"));
  try {
    const fixtureDir = writeCase(root, "development", "case-33333333", {
      kind: "seeded",
      fixtureDir: "fixture",
      diffFile: "diff.patch",
      evaluationProtocol: "historical-efficacy-v1",
    });
    assert.throws(() => loadCaseSpec(fixtureDir), /contains unsupported fields/);

    const unknownDir = writeCase(root, "validation", "case-44444444", historical({
      evaluationProtocol: "historical-efficacy-v2",
    }));
    assert.throws(() => loadCaseSpec(unknownDir), /historical evaluationProtocol is invalid/);

    const legacyStructuralDir = writeCase(root, "structural-smoke", "case-55555555", historical());
    assert.equal(loadCaseSpec(legacyStructuralDir).kind, "historical");

    const structuralDir = writeCase(root, "structural-smoke", "case-55555556", historical({
      evaluationProtocol: "historical-efficacy-v1",
    }));
    assert.throws(() => loadCaseSpec(structuralDir), /cannot use the structural-smoke corpus/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("malformed legacy cases remain scheduled configuration failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-historical-legacy-failure-"));
  try {
    const casesDir = join(root, "cases");
    writeCase(casesDir, "development", "case-77777777", historical({ repoSource: 42 }));
    const matrixPath = join(root, "matrix.json");
    writeFileSync(matrixPath, JSON.stringify({
      repeats: 1,
      corpora: ["development"],
      configs: [{ name: "mock", runner: "mock" }],
    }));

    const runsDir = await runMatrix(matrixPath, join(root, "runs"), {
      casesDir,
      allowLegacyTestConfig: true,
    });
    const attempt = JSON.parse(readFileSync(join(runsDir, "attempt-000001.json"), "utf8"));
    assert.equal(attempt.outcome.status, "failed");
    assert.equal(attempt.outcome.failureKind, "configuration");
    assert.match(attempt.outcome.message, /historical cases need repoSource, baseCommit, and headCommit/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("neutral historical scheduling fails before creating a run directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-historical-schedule-"));
  try {
    const casesDir = join(root, "cases");
    writeCase(casesDir, "development", "case-66666666", historical({
      evaluationProtocol: "historical-efficacy-v1",
    }));
    const matrixPath = join(root, "matrix.json");
    writeFileSync(matrixPath, JSON.stringify({
      repeats: 1,
      corpora: ["development"],
      configs: [{ name: "mock", runner: "mock" }],
    }));
    const runsRoot = join(root, "runs");

    await assert.rejects(
      () => runMatrix(matrixPath, runsRoot, { casesDir, allowLegacyTestConfig: true }),
      /cannot be scheduled until versioned curation and metric eligibility are integrated/,
    );
    assert.equal(existsSync(runsRoot), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
