import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildReport, createReportReader } from "../eval/report.js";
import { readCaseGroundTruth } from "../eval/case-truth.js";
import { networkIsolationCapability } from "../eval/case-isolation.js";
import { readExperimentJson } from "../eval/experiment.js";
import { mockUsage, sha256 } from "../src/core/telemetry.js";

test("report reader caches successful artifact and ground-truth reads by canonical key", () => {
  const artifactCalls: string[] = [];
  const truthCalls: string[] = [];
  const reader = createReportReader({
    readExperimentJson(path) {
      artifactCalls.push(path);
      return { nested: { value: 1 } };
    },
    readCaseGroundTruth(casesDir, caseName) {
      truthCalls.push(`${casesDir}\0${caseName}`);
      return {
        bugs: [{
          id: "bug-aaaa0001",
          file: "src/value.ts",
          startLine: 1,
          endLine: 1,
          description: "source value",
          lane: "logic-correctness",
          expectedDisposition: "fix-in-pr",
          expectedSeverity: "medium",
          reachablePreconditions: "always",
          observableImpact: "bad value",
          provenance: "fixture",
        }],
      };
    },
  });
  const artifact = reader.readExperimentJson("/tmp/report-cache/dir/../artifact.json") as {
    nested: { value: number };
  };
  artifact.nested.value = 99;
  const sameArtifact = reader.readExperimentJson("/tmp/report-cache/artifact.json") as {
    nested: { value: number };
  };
  assert.equal(sameArtifact.nested.value, 1, "cached artifacts are isolated from caller mutation");
  assert.equal(artifactCalls.length, 1);

  const truth = reader.readCaseGroundTruth("/tmp/report-cache/cases", "development/case-aaaa0001");
  truth.bugs[0]!.description = "caller mutation";
  const sameTruth = reader.readCaseGroundTruth(
    "/tmp/report-cache/cases/../cases",
    "development/case-aaaa0001",
  );
  assert.equal(sameTruth.bugs[0]?.description, "source value");
  assert.equal(truthCalls.length, 1);
});

test("report reader retries failed reads and keeps distinct keys separate", () => {
  const artifactCalls: string[] = [];
  let failArtifact = true;
  const truthCalls: string[] = [];
  let failTruth = true;
  const reader = createReportReader({
    readExperimentJson(path) {
      artifactCalls.push(path);
      if (failArtifact) {
        failArtifact = false;
        throw new Error("transient artifact read failure");
      }
      return { path };
    },
    readCaseGroundTruth(casesDir, caseName) {
      truthCalls.push(`${casesDir}\0${caseName}`);
      if (failTruth) {
        failTruth = false;
        throw new Error("transient truth read failure");
      }
      return { bugs: [] };
    },
  });

  assert.throws(() => reader.readExperimentJson("/tmp/report-cache/retry.json"), /transient artifact/);
  assert.deepEqual(reader.readExperimentJson("/tmp/report-cache/retry.json"), {
    path: "/tmp/report-cache/retry.json",
  });
  assert.equal(artifactCalls.length, 2, "failed artifact reads are not cached");

  assert.throws(
    () => reader.readCaseGroundTruth("/tmp/report-cache/cases", "development/case-bbbb0002"),
    /transient truth/,
  );
  reader.readCaseGroundTruth("/tmp/report-cache/cases", "development/case-bbbb0002");
  assert.equal(truthCalls.length, 2, "failed truth reads are not cached");

  reader.readExperimentJson("/tmp/report-cache/first.json");
  reader.readExperimentJson("/tmp/report-cache/second.json");
  assert.equal(artifactCalls.length, 4, "distinct artifact keys are not conflated");
});

test("report reader preserves validated reader path arguments on cache misses", () => {
  const artifactPath = resolve("/tmp/report-cache/validated.json");
  const casesDir = resolve("/tmp/report-cache/cases");
  const calls: Array<[string, string] | string> = [];
  const reader = createReportReader({
    readExperimentJson(path) {
      calls.push(path);
      return { ok: true };
    },
    readCaseGroundTruth(root, caseName) {
      calls.push([root, caseName]);
      return { bugs: [] };
    },
  });
  reader.readExperimentJson(artifactPath);
  reader.readCaseGroundTruth(casesDir, join("development", "case-cccc0003"));
  assert.deepEqual(calls, [artifactPath, [casesDir, "development/case-cccc0003"]]);
});

test("ordinary and experiment JSON caches remain separate", () => {
  let ordinaryCalls = 0;
  let experimentCalls = 0;
  const reader = createReportReader({
    readJson() {
      ordinaryCalls++;
      return { source: "ordinary" };
    },
    readExperimentJson() {
      experimentCalls++;
      return { source: "experiment" };
    },
  });
  const path = "/tmp/report-cache/shared.json";
  assert.deepEqual(reader.readJson(path), { source: "ordinary" });
  assert.deepEqual(reader.readJson(path), { source: "ordinary" });
  assert.deepEqual(reader.readExperimentJson(path), { source: "experiment" });
  assert.deepEqual(reader.readExperimentJson(path), { source: "experiment" });
  assert.equal(ordinaryCalls, 1);
  assert.equal(experimentCalls, 1);
});

test("report output remains identical across repeated builds", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-report-cache-output-"));
  writeFileSync(join(root, "attempt.graded.json"), JSON.stringify({
    caseName: "case-00000001",
    caseKind: "clean",
    configName: "mock",
    repeat: 1,
    startedAt: "2026-09-02T00:00:00.000Z",
    result: {
      engine: "mock",
      status: "clean",
      modelConfig: "mock",
      findings: [],
      usage: mockUsage(),
      durationMs: 0,
    },
    matches: {},
    falsePositiveIndexes: [],
  }));
  try {
    const ordinaryReads: string[] = [];
    const firstStats = await buildReport(root, {
      readerSources: {
        readJson(path) {
          ordinaryReads.push(path);
          return JSON.parse(readFileSync(path, "utf8"));
        },
      },
    });
    assert.equal(ordinaryReads.length, 1, "legacy reports use the ordinary JSON reader");
    const firstJson = readFileSync(join(root, "benchmark.json"), "utf8");
    const firstHtml = readFileSync(join(root, "benchmark.html"), "utf8");
    const secondStats = await buildReport(root, {
      readerSources: {
        readJson(path) {
          ordinaryReads.push(path);
          return JSON.parse(readFileSync(path, "utf8"));
        },
      },
    });
    assert.deepEqual(secondStats, firstStats);
    assert.equal(ordinaryReads.length, 2, "each build gets a fresh operation-scoped ordinary cache");
    assert.equal(readFileSync(join(root, "benchmark.json"), "utf8"), firstJson);
    assert.equal(readFileSync(join(root, "benchmark.html"), "utf8"), firstHtml);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tracked report reuses raw, graded, and truth reads across validation phases", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-report-cache-tracked-"));
  const runsDir = join(root, "runs");
  const casesDir = join(root, "cases");
  const caseName = "development/case-dddd0004";
  const attempt = {
    id: "attempt-000001",
    caseName,
    corpus: "development" as const,
    expectedBugCount: 0,
    configName: "mock",
    repeat: 1,
    file: "attempt-000001.json",
    runner: "mock" as const,
  };
  const baseRef = "1".repeat(40);
  const headRef = "2".repeat(40);
  const manifestOutput = [
    `base: ${baseRef} (argument)`,
    `head: ${headRef}`,
    `merge-base: ${baseRef}`,
    "Changed files",
    "(none)",
    "",
  ].join("\n");
  const provenance = {
    history: {
      schemaVersion: 1,
      materialization: "fixture-patch",
      objectFormat: "sha1",
      baseRef,
      headRef,
      mergeBase: baseRef,
      baseTree: "3".repeat(40),
      headTree: "4".repeat(40),
      commitCount: 2,
      baseIsMergeBase: true,
      checkedOutTreeMatchesHead: true,
      treeReproductionVerified: true,
      diffNormalization: "identity-v1",
      diffSha256: "5".repeat(64),
    },
    manifest: {
      entryPoint: "prepareReviewManifest",
      skillName: "invariant-first-pr-review",
      baseRef,
      headRef,
      mergeBase: baseRef,
      outputSha256: sha256(manifestOutput),
      output: manifestOutput,
      profileSource: "none",
      headProfileChanged: false,
    },
  };
  const raw = {
    schemaVersion: 1,
    attemptId: attempt.id,
    caseName,
    caseKind: "clean",
    configName: attempt.configName,
    repeat: attempt.repeat,
    caseCorpus: attempt.corpus,
    runner: attempt.runner,
    startedAt: "2026-09-02T00:00:00.000Z",
    finishedAt: "2026-09-02T00:00:01.000Z",
    attemptDurationMs: 1000,
    evaluationProvenance: provenance,
    outcome: {
      status: "completed",
      result: {
        engine: "mock",
        status: "clean",
        modelConfig: "mock",
        reviewedBaseRef: baseRef,
        reviewedHeadRef: headRef,
        findings: [],
        usage: mockUsage(),
        durationMs: 0,
      },
    },
  };
  try {
    mkdirSync(join(casesDir, caseName), { recursive: true });
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(casesDir, caseName, "ground_truth.json"), JSON.stringify({ bugs: [] }));
    writeFileSync(join(runsDir, "matrix-manifest.json"), JSON.stringify({
      schemaVersion: 1,
      createdAt: "2026-09-02T00:00:00.000Z",
      expectedAttempts: [attempt],
      providerNetworkIsolation: { mock: networkIsolationCapability("mock") },
    }));
    writeFileSync(join(runsDir, attempt.file), JSON.stringify(raw));
    writeFileSync(join(runsDir, attempt.file.replace(/\.json$/, ".graded.json")), JSON.stringify({
      ...raw,
      matches: {},
      falsePositiveIndexes: [],
    }));

    const artifactCalls: string[] = [];
    const ordinaryCalls: string[] = [];
    const truthCalls: string[] = [];
    const stats = await buildReport(runsDir, {
      casesDir,
      readerSources: {
        readJson(path) {
          ordinaryCalls.push(resolve(path));
          return JSON.parse(readFileSync(path, "utf8"));
        },
        readExperimentJson(path) {
          artifactCalls.push(resolve(path));
          return readExperimentJson(path);
        },
        readCaseGroundTruth(rootDir, name) {
          truthCalls.push(`${resolve(rootDir)}\0${name}`);
          return readCaseGroundTruth(rootDir, name);
        },
      },
    });
    assert.equal(stats[0]?.completedRuns, 1);
    assert.equal(stats[0]?.completionRate, 1);
    assert.equal(stats[0]?.benchmarkKind, "structural-only");
    assert.equal(ordinaryCalls.length, 0, "tracked reports use the experiment JSON reader");
    assert.equal(artifactCalls.length, 3, "manifest, raw, and graded artifacts each read once");
    assert.equal(artifactCalls.filter((path) => path.endsWith("matrix-manifest.json")).length, 1);
    assert.equal(artifactCalls.filter((path) => path.endsWith("attempt-000001.json")).length, 1);
    assert.equal(artifactCalls.filter((path) => path.endsWith("attempt-000001.graded.json")).length, 1);
    assert.equal(truthCalls.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
