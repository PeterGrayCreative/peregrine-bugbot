import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gradeRuns } from "../eval/grade.js";
import { buildReport } from "../eval/report.js";
import { runMatrix } from "../eval/run-matrix.js";
import { RunFailureError } from "../src/core/run-failure.js";
import type { Engine } from "../src/engines/engine.js";
import type { MatrixModelConfig, MatrixRunManifest, RunRecord } from "../src/types.js";

test("matrix accounting preserves failures, missing attempts, recall, and unknown cost", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-accounting-test-"));
  const casesDir = join(root, "cases");
  const caseName = "case-a11ce001";
  const caseDir = join(casesDir, caseName);
  const fixtureDir = join(caseDir, "fixture", "src");
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(join(fixtureDir, "value.ts"), "export const value = false;\n");
  writeFileSync(
    join(caseDir, "diff.patch"),
    "diff --git a/src/value.ts b/src/value.ts\n--- a/src/value.ts\n+++ b/src/value.ts\n@@ -1 +1 @@\n-export const value = true;\n+export const value = false;\n",
  );
  writeFileSync(
    join(caseDir, "case.json"),
    JSON.stringify({ id: caseName, corpus: "development", kind: "seeded", fixtureDir: "fixture", diffFile: "diff.patch" }),
  );
  writeFileSync(
    join(caseDir, "ground_truth.json"),
    JSON.stringify({ bugs: [{ id: "bug-1", file: "src/value.ts", startLine: 1, endLine: 1, description: "wrong value" }] }),
  );

  const configs: MatrixModelConfig[] = ["completed", "mixed", "timeout", "provider", "parse", "unknown", "missing"].map(
    (name) => ({ name, runner: "mock", overrides: { scenario: name } }),
  );
  configs.push({ name: "completed", runner: "mock", overrides: { scenario: "completed" } });
  configs.push({ name: "configuration", runner: "codex", overrides: { timeoutMs: 0 } });
  const matrixPath = join(root, "matrix.json");
  writeFileSync(matrixPath, JSON.stringify({ repeats: 2, configs }));

  let mixedCalls = 0;
  const engine: Engine = {
    name: "mock",
    async review(ctx) {
      const scenario = (ctx.config.runners.mock as Record<string, unknown>).scenario;
      if (scenario === "mixed" && ++mixedCalls === 2) {
        throw new RunFailureError("timeout", "timed out");
      }
      if (scenario === "timeout") throw new RunFailureError("timeout", "timed out");
      if (scenario === "provider") throw new RunFailureError("provider", "provider unavailable");
      if (scenario === "parse") throw new RunFailureError("parse", "invalid output");
      if (scenario === "unknown") throw new Error("token=abc123456789SECRET");
      return {
        engine: "mock",
        status: "completed",
        modelConfig: "mock",
        findings: [{
          file: "src/value.ts",
          startLine: 1,
          endLine: 1,
          severity: "high",
          disposition: "fix-in-pr",
          category: "logic",
          invariant: "value-remains-true",
          title: "Value changed",
          explanation: "The value no longer satisfies the invariant.",
          failurePath: "A caller observes false.",
          confidence: 0.99,
        }],
        usage: {},
        durationMs: 10,
      };
    },
  };

  try {
    const runsDir = await runMatrix(matrixPath, join(root, "runs"), {
      casesDir,
      engineFor: () => engine,
    });
    const manifest = JSON.parse(
      readFileSync(join(runsDir, "matrix-manifest.json"), "utf8"),
    ) as MatrixRunManifest;
    assert.equal(manifest.expectedAttempts.length, 18);
    assert.equal(new Set(manifest.expectedAttempts.map((attempt) => attempt.id)).size, 18);
    assert.equal(new Set(manifest.expectedAttempts.map((attempt) => attempt.file)).size, 18);
    assert.equal(manifest.providerNetworkIsolation.mock?.status, "not-applicable");

    const records = readdirSync(runsDir)
      .filter((file) => file.endsWith(".json") && file !== "matrix-manifest.json")
      .map((file) => JSON.parse(readFileSync(join(runsDir, file), "utf8")) as RunRecord);
    assert.equal(records.length, 18);
    const failures = records.filter(
      (record): record is RunRecord & { outcome: Extract<RunRecord["outcome"], { status: "failed" }> } =>
        record.outcome.status === "failed",
    );
    assert.deepEqual(
      [...new Set(failures.map((record) => record.outcome.failureKind))].sort(),
      ["configuration", "parse", "provider", "timeout", "unknown"],
    );
    for (const unknown of failures.filter((record) => record.outcome.failureKind === "unknown")) {
      assert.doesNotMatch(unknown.outcome.message, /abc123456789SECRET/);
    }

    const missingAttempt = manifest.expectedAttempts.find(
      (attempt) => attempt.configName === "missing" && attempt.repeat === 2,
    );
    assert.ok(missingAttempt);
    rmSync(join(runsDir, missingAttempt.file));

    await gradeRuns(runsDir, casesDir);
    const stats = await buildReport(runsDir, { casesDir });
    const completed = stats.find((item) => item.config === "completed");
    assert.equal(completed?.completionRate, 1);
    assert.equal(completed?.expectedRuns, 4);
    assert.equal(completed?.completedRuns, 4);
    assert.equal(completed?.recallMean, 1);
    assert.equal(completed?.failureInclusiveRecallMean, 1);
    assert.equal(completed?.costPerCaseMean, null);
    const mixed = stats.find((item) => item.config === "mixed");
    assert.equal(mixed?.expectedRuns, 2);
    assert.equal(mixed?.completedRuns, 1);
    assert.equal(mixed?.failedRuns, 1);
    assert.equal(mixed?.completionRate, 0.5);
    assert.equal(mixed?.recallMean, 1);
    assert.equal(mixed?.failureInclusiveRecallMean, 0.5);
    assert.equal(stats.find((item) => item.config === "timeout")?.completionRate, 0);
    assert.equal(stats.find((item) => item.config === "timeout")?.recallMean, null);
    assert.equal(stats.find((item) => item.config === "timeout")?.failureInclusiveRecallMean, 0);
    assert.equal(stats.find((item) => item.config === "missing")?.missingRuns, 1);
    assert.equal(stats.find((item) => item.config === "configuration")?.failuresByKind.configuration, 2);
    assert.equal(stats.find((item) => item.config === "configuration")?.failureRatesByKind.configuration, 1);

    const legacyDir = join(root, "legacy");
    mkdirSync(legacyDir);
    const gradedFile = readdirSync(runsDir).find((file) => {
      if (!file.endsWith(".graded.json")) return false;
      return (JSON.parse(readFileSync(join(runsDir, file), "utf8")) as RunRecord).configName === "completed";
    });
    assert.ok(gradedFile);
    const graded = JSON.parse(readFileSync(join(runsDir, gradedFile), "utf8")) as Record<string, unknown>;
    writeFileSync(join(legacyDir, "new-shape.graded.json"), JSON.stringify(graded));
    const outcome = graded.outcome as { result: unknown };
    const { schemaVersion: _schema, attemptId: _attempt, finishedAt: _finished, outcome: _outcome, ...legacy } = graded;
    writeFileSync(join(legacyDir, "legacy.graded.json"), JSON.stringify({ ...legacy, result: outcome.result }));
    const legacyStats = await buildReport(legacyDir, { casesDir });
    assert.equal(legacyStats[0]?.completeness, "legacy-incomplete");
    assert.equal(legacyStats[0]?.expectedRuns, null);
    assert.equal(legacyStats[0]?.completionRate, null);
    assert.equal(legacyStats[0]?.failureInclusiveRecallMean, null);
    assert.equal(legacyStats[0]?.costPerCaseMean, null);
    assert.equal(legacyStats[0]?.completedRuns, 2);

    const cleanCaseDir = join(casesDir, "clean-case");
    mkdirSync(cleanCaseDir);
    writeFileSync(join(cleanCaseDir, "ground_truth.json"), JSON.stringify({ bugs: [] }));
    const cleanRunsDir = join(root, "clean-runs");
    mkdirSync(cleanRunsDir);
    const cleanAttempt = {
      id: "attempt-000001",
      caseName: "clean-case",
      configName: "clean-only",
      repeat: 1,
      file: "attempt-000001.json",
    };
    writeFileSync(
      join(cleanRunsDir, "matrix-manifest.json"),
      JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(), expectedAttempts: [cleanAttempt] }),
    );
    const completedRun = records.find((record) => record.outcome.status === "completed");
    assert.ok(completedRun && completedRun.outcome.status === "completed");
    const cleanRun: RunRecord = {
      ...completedRun,
      attemptId: cleanAttempt.id,
      caseName: cleanAttempt.caseName,
      configName: cleanAttempt.configName,
      outcome: { ...completedRun.outcome, result: { ...completedRun.outcome.result, findings: [] } },
    };
    writeFileSync(join(cleanRunsDir, cleanAttempt.file), JSON.stringify(cleanRun));
    writeFileSync(
      join(cleanRunsDir, "attempt-000001.graded.json"),
      JSON.stringify({ ...cleanRun, matches: {}, falsePositiveIndexes: [] }),
    );
    const cleanStats = await buildReport(cleanRunsDir, { casesDir });
    assert.equal(cleanStats[0]?.recallMean, null);
    assert.equal(cleanStats[0]?.failureInclusiveRecallMean, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid case definitions are persisted as configuration failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-invalid-case-test-"));
  const caseDir = join(root, "cases", "case-badbad00");
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(
    join(caseDir, "case.json"),
    JSON.stringify({ id: "case-badbad00", corpus: "development", kind: "seeded", diffFile: "diff.patch" }),
  );
  const matrixPath = join(root, "matrix.json");
  writeFileSync(
    matrixPath,
    JSON.stringify({ repeats: 1, configs: [{ name: "mock", runner: "mock" }] }),
  );
  try {
    const runsDir = await runMatrix(matrixPath, join(root, "runs"), {
      casesDir: join(root, "cases"),
      engineFor: () => {
        throw new Error("engine should not be selected for an invalid case");
      },
    });
    const recordFile = readdirSync(runsDir).find((file) => file.startsWith("attempt-") && file.endsWith(".json"));
    assert.ok(recordFile);
    const record = JSON.parse(readFileSync(join(runsDir, recordFile), "utf8")) as RunRecord;
    assert.equal(record.outcome.status, "failed");
    if (record.outcome.status === "failed") {
      assert.equal(record.outcome.failureKind, "configuration");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
