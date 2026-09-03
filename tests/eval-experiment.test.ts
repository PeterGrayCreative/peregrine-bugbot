import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import {
  acquireExperimentLock,
  buildExperimentSchedule,
  evaluateExperimentCeilings,
  parseExperimentManifest,
  parseExperimentStopRecord,
} from "../eval/experiment.js";
import { gradeRuns } from "../eval/grade.js";
import { buildReport } from "../eval/report.js";
import { runMatrix } from "../eval/run-matrix.js";
import { runSemanticJudge } from "../eval/run-semantic-judge.js";
import { unavailableJudgeUsage } from "../eval/judge-runtime.js";
import { materializeCase } from "../eval/case-isolation.js";
import {
  caseBundleSha256,
  fixtureSourceIdentitySha256,
  parseCaseCuration,
  requiredConfirmationChecks,
} from "../eval/case-curation.js";
import {
  EXPERIMENT_GRADING_SEAL_FILENAME,
  EXPERIMENT_TERMINAL_SEAL_FILENAME,
  parseExperimentTerminalSeal,
} from "../eval/experiment-seals.js";
import { codexUsageFromEvents, combineUsage, mockUsage } from "../src/core/telemetry.js";
import type {
  CaseCorpus,
  EngineResult,
  ExperimentProtocol,
  GroundTruth,
  ReviewContext,
  RunRecord,
  RunnerName,
} from "../src/types.js";
import type { Engine } from "../src/engines/engine.js";

const HEAD = "export const enabled = false;\n";
const PATCH = [
  "diff --git a/src/value.ts b/src/value.ts",
  "index 50ab75ce5404471a2dd5f5c25b6d04e9a1162938..8432b2819c789e32f686d96d82fd1f57fad94ea5 100644",
  "--- a/src/value.ts",
  "+++ b/src/value.ts",
  "@@ -1 +1 @@",
  "-export const enabled = true;",
  "+export const enabled = false;",
  "",
].join("\n");

function validateAgainstSchema(value: unknown, schema: any, root = schema, path = "$"): void {
  if (schema.$ref) {
    const target = schema.$ref.split("/").slice(1).reduce(
      (current: any, key: string) => current[key.replaceAll("~1", "/").replaceAll("~0", "~")],
      root,
    );
    return validateAgainstSchema(value, target, root, path);
  }
  if (schema.const !== undefined) assert.deepEqual(value, schema.const, `${path} const`);
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length > 0) {
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
    assert.ok(types.includes(actual), `${path} type ${actual}`);
  }
  if (typeof value === "string" && schema.pattern) assert.match(value, new RegExp(schema.pattern), `${path} pattern`);
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => validateAgainstSchema(item, schema.items, root, `${path}[${index}]`));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) assert.ok(key in record, `${path}.${key} required`);
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) assert.ok(key in (schema.properties ?? {}), `${path}.${key} allowed`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in record) validateAgainstSchema(record[key], child, root, `${path}.${key}`);
    }
  }
}

const structuralProtocol: ExperimentProtocol = {
  mode: "structural-smoke",
  seed: 20260903,
  cacheCondition: "not-applicable",
  providerCalls: "deny",
  providerAccess: "not-applicable",
  costAccounting: "not-applicable",
  judge: { kind: "exact", version: "exact-v1" },
  limits: {
    maxProviderCostUsd: null,
    maxProviderAttempts: 0,
    maxWallTimeMs: 300_000,
    maxFailureRate: 1,
    minAttemptsForFailureRate: 1,
    maxConsecutiveFailures: 10,
  },
};

const judgeLimits = {
  maxProviderCostUsd: null,
  maxProviderAttempts: 500,
  maxWallTimeMs: 3_600_000,
  maxFailureRate: 0.25,
  minAttemptsForFailureRate: 8,
  maxConsecutiveFailures: 3,
};

const cliSessionProtocol: ExperimentProtocol = {
  mode: "screening",
  seed: 20260903,
  cacheCondition: "uncontrolled",
  providerCalls: "deny",
  providerAccess: "cli-session",
  costAccounting: "best-effort",
  judge: { kind: "codex", model: "gpt-5.6-luna", effort: "medium", version: "semantic-v1", limits: judgeLimits },
  control: "control",
  treatment: "treatment",
  limits: {
    maxProviderCostUsd: null,
    maxProviderAttempts: 1,
    maxWallTimeMs: 300_000,
    maxFailureRate: 1,
    minAttemptsForFailureRate: 1,
    maxConsecutiveFailures: 10,
  },
};

test("immutable experiments execute in their recorded order, resume terminal work, and retry interruptions as children", async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "peregrine-experiment-integration-"));
  const casesDir = join(root, "cases");
  createFixtureCase(casesDir, "case-11111111", "structural-smoke");
  const matrixPath = join(root, "matrix.json");
  writeFileSync(matrixPath, JSON.stringify({
    repeats: 2,
    corpora: ["structural-smoke"],
    configs: [{ name: "mock", runner: "mock" }],
    experiment: structuralProtocol,
  }));

  let engineCalls = 0;
  let epoch = Date.parse("2026-09-03T12:00:00.000Z");
  const persistedAttemptIds: string[] = [];
  const engine: Engine = {
    name: "mock",
    async review(ctx) {
      engineCalls++;
      return completed(ctx);
    },
  };

  try {
    const sourceDir = await runMatrix(matrixPath, join(root, "runs"), {
      casesDir,
      engineFor: () => engine,
      manifestPreparer: manifestPreparer,
      runtimeMetadataFor,
      now: () => epoch++,
      afterAttemptPersisted: (attempt) => persistedAttemptIds.push(attempt.id),
    });
    const sourceManifestText = readFileSync(join(sourceDir, "experiment-manifest.json"), "utf8");
    const manifest = parseExperimentManifest(JSON.parse(sourceManifestText));
    assert.equal(engineCalls, 2);
    assert.deepEqual(persistedAttemptIds, manifest.schedule.map((attempt) => attempt.id));
    assert.deepEqual(manifest.schedule.map((attempt) => attempt.sequence), [1, 2]);
    assert.deepEqual(manifest.schedule.map((attempt) => attempt.file), [
      "attempt-000001.json",
      "attempt-000002.json",
    ]);
    for (const attempt of manifest.schedule) {
      assert.equal(existsSync(join(sourceDir, `state/${attempt.id}.started.json`)), true);
      const record = JSON.parse(readFileSync(join(sourceDir, attempt.file), "utf8")) as RunRecord;
      assert.equal(record.attemptId, attempt.id);
      assert.equal(record.caseName, attempt.caseName);
      assert.equal(record.repeat, attempt.repeat);
      assert.equal(record.configName, attempt.configName);
      assert.equal(record.experimentId, manifest.experimentId);
      assert.match(record.experimentManifestSha256 ?? "", /^[a-f0-9]{64}$/);
    }
    assert.equal(existsSync(join(sourceDir, EXPERIMENT_TERMINAL_SEAL_FILENAME)), true);
    const terminalSeal = parseExperimentTerminalSeal(
      JSON.parse(readFileSync(join(sourceDir, EXPERIMENT_TERMINAL_SEAL_FILENAME), "utf8")),
    );
    assert.equal(terminalSeal.terminal, "completed");
    assert.ok(terminalSeal.artifacts.some((item) => item.path === "matrix-manifest.json"));
    assert.ok(terminalSeal.artifacts.some((item) => item.path === "experiment-manifest.json"));
    assert.ok(terminalSeal.artifacts.some((item) => item.path === manifest.schedule[0]!.file));
    assert.equal(terminalSeal.artifacts.some((item) =>
      item.path.includes("graded") || item.path.includes("benchmark") || item.path.includes("seal") || item.path.includes("lock")), false);

    await runMatrix(matrixPath, join(root, "runs"), {
      casesDir,
      resumeDir: sourceDir,
      engineFor: () => engine,
      manifestPreparer,
      runtimeMetadataFor,
      now: () => epoch++,
    });
    assert.equal(engineCalls, 2, "resume must skip every terminal attempt");
    assert.equal(readFileSync(join(sourceDir, "experiment-manifest.json"), "utf8"), sourceManifestText);

    const interrupted = manifest.schedule.at(-1)!;
    rmSync(join(sourceDir, EXPERIMENT_TERMINAL_SEAL_FILENAME));
    rmSync(join(sourceDir, interrupted.file));
    await assert.rejects(
      () => runMatrix(matrixPath, join(root, "runs"), {
        casesDir,
        resumeDir: sourceDir,
        engineFor: () => engine,
        manifestPreparer,
        runtimeMetadataFor,
        now: () => epoch++,
      }),
      new RegExp(`${interrupted.id} was interrupted; use an explicit retry`),
    );
    assert.equal(engineCalls, 2);

    const sourceBeforeRetry = directorySnapshot(sourceDir);
    const releaseSourceLock = acquireExperimentLock(sourceDir);
    try {
      await assert.rejects(
        () => runMatrix(matrixPath, join(root, "runs"), {
          casesDir,
          retry: { runsDir: sourceDir, attemptId: interrupted.id },
          engineFor: () => engine,
          manifestPreparer,
          runtimeMetadataFor,
          now: () => epoch++,
        }),
        /experiment is already locked/,
      );
    } finally {
      releaseSourceLock();
    }
    assert.equal(engineCalls, 2, "a locked retry source must not duplicate provider work");

    const childDir = await runMatrix(matrixPath, join(root, "runs"), {
      casesDir,
      retry: { runsDir: sourceDir, attemptId: interrupted.id },
      engineFor: () => engine,
      manifestPreparer,
      runtimeMetadataFor,
      now: () => epoch++,
    });
    assert.notEqual(childDir, sourceDir);
    assert.equal(engineCalls, 3);
    assert.deepEqual(directorySnapshot(sourceDir), sourceBeforeRetry, "retry must not mutate source evidence");

    const child = parseExperimentManifest(
      JSON.parse(readFileSync(join(childDir, "experiment-manifest.json"), "utf8")),
    );
    assert.equal(child.lineage?.kind, "retry");
    assert.equal(child.lineage?.source.experimentId, manifest.experimentId);
    assert.equal(child.lineage?.source.attemptId, interrupted.id);
    assert.match(child.lineage?.source.evidenceSha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(child.schedule.length, 1);
    assert.deepEqual(child.schedule[0]?.retryOf, child.lineage?.source);
    assert.equal(existsSync(join(childDir, child.schedule[0]!.file)), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("experiment marker writes refuse a state directory replaced by a symlink", async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "peregrine-experiment-state-symlink-"));
  const casesDir = join(root, "cases");
  createFixtureCase(casesDir, "case-66666666", "structural-smoke");
  const matrixPath = join(root, "matrix.json");
  writeFileSync(matrixPath, JSON.stringify({
    repeats: 2,
    corpora: ["structural-smoke"],
    configs: [{ name: "mock", runner: "mock" }],
    experiment: structuralProtocol,
  }));
  const runsRoot = join(root, "runs");
  const externalState = join(root, "external-state");
  mkdirSync(externalState);
  let persisted = 0;

  try {
    await assert.rejects(
      () => runMatrix(matrixPath, runsRoot, {
        casesDir,
        engineFor: () => ({ name: "mock", review: async (ctx) => completed(ctx) }),
        manifestPreparer,
        runtimeMetadataFor,
        now: (() => {
          let epoch = Date.parse("2026-09-03T12:30:00.000Z");
          return () => epoch++;
        })(),
        afterAttemptPersisted: () => {
          persisted++;
          if (persisted !== 1) return;
          const runNames = readdirSync(runsRoot);
          assert.equal(runNames.length, 1);
          const stateDir = join(runsRoot, runNames[0]!, "state");
          rmSync(stateDir, { recursive: true });
          symlinkSync(externalState, stateDir, "dir");
        },
      }),
      /experiment destination parent must be a real directory/,
    );
    assert.equal(persisted, 1);
    assert.deepEqual(readdirSync(externalState), [], "no marker may be written through the symlink");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a denied Codex CLI-session experiment seals its decision before provider or attempt work", async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "peregrine-experiment-provider-stop-"));
  const casesDir = join(root, "cases");
  createFixtureCase(casesDir, "case-22222222", "development");
  const matrixPath = join(root, "matrix.json");
  writeFileSync(matrixPath, JSON.stringify({
    repeats: 2,
    corpora: ["development"],
    configs: [
      { name: "control", runner: "codex" },
      { name: "treatment", runner: "codex" },
    ],
    experiment: {
      ...cliSessionProtocol,
      providerCalls: "deny",
      limits: { ...cliSessionProtocol.limits, maxProviderAttempts: 0 },
    },
  }));
  let calls = 0;

  try {
    const runsDir = await runMatrix(matrixPath, join(root, "runs"), {
      casesDir,
      engineFor: () => ({
        name: "codex",
        async review() {
          calls++;
          throw new Error("provider must not start");
        },
      }),
      runtimeMetadataFor,
      now: () => Date.parse("2026-09-03T13:00:00.000Z"),
    });
    assert.equal(calls, 0);
    const manifest = parseExperimentManifest(
      JSON.parse(readFileSync(join(runsDir, "experiment-manifest.json"), "utf8")),
    );
    assert.equal(manifest.protocol.providerAccess, "cli-session");
    assert.equal(manifest.protocol.costAccounting, "best-effort");
    const stop = parseExperimentStopRecord(
      JSON.parse(readFileSync(join(runsDir, "experiment-stop.json"), "utf8")),
    );
    assert.equal(stop.reason, "provider-calls-denied");
    assert.equal(stop.beforeAttemptId, manifest.schedule[0]?.id);
    const terminalSeal = parseExperimentTerminalSeal(
      JSON.parse(readFileSync(join(runsDir, EXPERIMENT_TERMINAL_SEAL_FILENAME), "utf8")),
    );
    assert.equal(terminalSeal.terminal, "stopped");
    assert.ok(terminalSeal.artifacts.some((item) => item.path === "experiment-stop.json"));
    assert.deepEqual(readdirSync(join(runsDir, "state")), []);
    assert.equal(
      readdirSync(runsDir).some((file) => /^attempt-[0-9]{6}\.json$/.test(file)),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("provider-enabled protocols pass the former global gate and preserve contained preflight failures", async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "peregrine-experiment-live-gate-"));
  const casesDir = join(root, "cases");
  createFixtureCase(casesDir, "case-66666666", "development");
  const matrixPath = join(root, "matrix.json");
  const runsRoot = join(root, "runs");
  writeFileSync(matrixPath, JSON.stringify({
    repeats: 1,
    corpora: ["development"],
    configs: [
      { name: "control", runner: "codex" },
      { name: "treatment", runner: "codex" },
    ],
    experiment: {
      ...cliSessionProtocol,
      providerCalls: "allow",
    },
  }));

  try {
    const runsDir = await runMatrix(matrixPath, runsRoot, {
      casesDir,
      runtimeMetadataFor: availableRuntimeMetadataFor,
      manifestPreparer,
    });
    const attempts = readdirSync(runsDir).filter((path) => /^attempt-[0-9]{6}\.json$/.test(path));
    assert.equal(attempts.length, 2);
    for (const path of attempts) {
      const record = JSON.parse(readFileSync(join(runsDir, path), "utf8"));
      assert.equal(record.outcome.status, "failed");
      assert.equal(record.outcome.failureKind, "configuration");
      assert.match(record.outcome.message, /(?:image|CLI session|containment|isolation|credential)/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fake contained semantic judge completes grading seals and report accounting end to end", async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "peregrine-experiment-semantic-e2e-"));
  const materializationRoot = join(root, "materialized");
  mkdirSync(materializationRoot);
  const casesDir = join(root, "cases");
  const caseDir = createFixtureCase(casesDir, "case-67676767", "development", { bugs: [{
    id: "bug-67676767", lane: "logic-correctness",
    expectedDisposition: "fix-in-pr", expectedSeverity: "high", file: "src/value.ts",
    startLine: 1, endLine: 1, description: "Polarity reversed.",
    reachablePreconditions: "Export is consumed.", observableImpact: "Feature stays off.",
    provenance: "fixture",
  }] });
  const matrixPath = join(root, "matrix.json");
  writeFileSync(matrixPath, JSON.stringify({
    repeats: 1,
    corpora: ["development"],
    configs: [{ name: "control", runner: "codex" }, { name: "treatment", runner: "codex" }],
    experiment: {
      ...cliSessionProtocol,
      providerCalls: "allow",
      limits: { ...cliSessionProtocol.limits, maxProviderAttempts: 10 },
    },
  }));
  const engine: Engine = {
    name: "codex",
    review: async (ctx) => {
      const result = completedWithFinding(ctx);
      const breadthUsage = codexUsageFromEvents([{
        type: "turn.completed",
        usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 },
      }], "fake breadth prompt");
      const investigationUsage = codexUsageFromEvents([{
        type: "turn.completed",
        usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 },
      }], "fake investigation prompt");
      const codex = ctx.config.runners.codex;
      const modelConfig = `${codex.breadthModel}/${codex.breadthEffort}->${codex.investigationModel}/${codex.investigationEffort}`;
      return {
        ...result,
        engine: "codex",
        modelConfig,
        durationMs: 2,
        usage: combineUsage(breadthUsage, investigationUsage),
        raw: {
          manifest: (await manifestPreparer(ctx)).output,
          breadth: {
            output: { model: codex.breadthModel, candidates: [], clear: [], escalations: [], coverage: { coveredFiles: ["src/value.ts"], unavailable: [] } },
            model: codex.breadthModel,
            promptSha256: "a".repeat(64), usage: breadthUsage, durationMs: 1, malformedEventLines: 0,
          },
          investigation: {
            output: { findings: result.findings }, model: codex.investigationModel,
            promptSha256: "b".repeat(64), usage: investigationUsage, durationMs: 1, malformedEventLines: 0,
          },
        },
      };
    },
  };
  try {
    const runsDir = await runMatrix(matrixPath, join(root, "runs"), {
      casesDir,
      engineFor: () => engine,
      runtimeMetadataFor: availableRuntimeMetadataFor,
      manifestPreparer,
      materializeCaseFor: (caseRoot, spec, policy, options) =>
        materializeCase(caseRoot, spec, policy, {
          ...options,
          tempRoot: materializationRoot,
          prepareProviderAssets: false,
        }),
      prepareContainment: async () => ({
        runProvider: async () => ({ stdout: "", stderr: "", code: 0, timedOut: false }),
        readProviderOutput: () => { throw new Error("fake engine must not read provider output"); },
      }),
    });
    const rawAttempts = readdirSync(runsDir)
      .filter((path) => /^attempt-[0-9]{6}\.json$/.test(path))
      .map((path) => JSON.parse(readFileSync(join(runsDir, path), "utf8")) as RunRecord);
    assert.equal(rawAttempts.length, 2);
    assert.ok(rawAttempts.every((attempt) => attempt.outcome.status === "completed"));
    let judgeCalls = 0;
    const judged = await runSemanticJudge(runsDir, casesDir, { execute: async () => {
      judgeCalls += 1;
      return { verdict: true, durationMs: 7, providerCostUsd: null, usage: {
        ...unavailableJudgeUsage(), inputTokens: 12, outputTokens: 2, reasoningTokens: 1, turns: 1, toolCalls: 0,
      } };
    } });
    assert.equal(judged.terminal, "completed");
    assert.equal(judgeCalls, 1, "identical comparisons across variants share one immutable decision");
    await gradeRuns(runsDir, casesDir);
    const stats = await buildReport(runsDir, { casesDir });
    assert.equal(stats.length, 2);
    for (const configName of ["control", "treatment"]) {
      const config = stats.find((item) => item.config === configName);
      assert.ok(config, `${configName} report row exists`);
      assert.equal(config.expectedRuns, 1);
      assert.equal(config.runs, 1);
      assert.equal(config.completedRuns, 1);
      assert.equal(config.failedRuns, 0);
      assert.equal(config.missingRuns, 0);
    }
    assert.ok(existsSync(join(runsDir, EXPERIMENT_GRADING_SEAL_FILENAME)));
    const gradingSeal = JSON.parse(readFileSync(join(runsDir, EXPERIMENT_GRADING_SEAL_FILENAME), "utf8"));
    const gradingSealSchema = JSON.parse(readFileSync(join(process.cwd(), "schemas/experiment-grading-seal.schema.json"), "utf8"));
    validateAgainstSchema(gradingSeal, gradingSealSchema);
    const html = readFileSync(join(runsDir, "benchmark.html"), "utf8");
    assert.match(html, /Semantic judge accounting/);
    assert.match(html, /12 \/ n\/a \/ 2 \/ 1/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("experiment grading and reporting validate immutable metadata and never replace grades", async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "peregrine-experiment-consumer-"));
  const casesDir = join(root, "cases");
  const caseDir = createFixtureCase(casesDir, "case-44444444", "structural-smoke");
  const matrixPath = join(root, "matrix.json");
  writeFileSync(matrixPath, JSON.stringify({
    repeats: 2,
    corpora: ["structural-smoke"],
    configs: [{ name: "mock", runner: "mock" }],
    experiment: structuralProtocol,
  }));

  try {
    let epoch = Date.parse("2026-09-03T15:00:00.000Z");
    const runsDir = await runMatrix(matrixPath, join(root, "runs"), {
      casesDir,
      engineFor: () => ({ name: "mock", review: async (ctx) => completed(ctx) }),
      manifestPreparer,
      runtimeMetadataFor,
      now: () => epoch++,
    });
    const manifestPath = join(runsDir, "experiment-manifest.json");
    const originalManifest = readFileSync(manifestPath, "utf8");
    const experiment = parseExperimentManifest(JSON.parse(originalManifest));
    const firstRawPath = join(runsDir, experiment.schedule[0]!.file);
    const firstRaw = readFileSync(firstRawPath, "utf8");

    writeFileSync(firstRawPath, `${firstRaw}\n`);
    await assert.rejects(
      () => gradeRuns(runsDir, casesDir),
      /does not match its sealed digest/,
    );
    writeFileSync(firstRawPath, firstRaw);

    const otherDir = await runMatrix(matrixPath, join(root, "runs"), {
      casesDir,
      engineFor: () => ({ name: "mock", review: async (ctx) => completed(ctx) }),
      manifestPreparer,
      runtimeMetadataFor,
      now: () => epoch++,
    });
    const otherFirstRawPath = join(otherDir, experiment.schedule[0]!.file);
    const otherFirstRaw = readFileSync(otherFirstRawPath, "utf8");
    writeFileSync(otherFirstRawPath, firstRaw);
    await assert.rejects(
      () => gradeRuns(otherDir, casesDir),
      /terminal record does not match its experiment manifest/,
    );
    writeFileSync(otherFirstRawPath, otherFirstRaw);

    const releaseExperimentLock = acquireExperimentLock(runsDir);
    try {
      await assert.rejects(() => gradeRuns(runsDir, casesDir), /experiment is already locked/);
      await assert.rejects(() => buildReport(runsDir, { casesDir }), /experiment is already locked/);
    } finally {
      releaseExperimentLock();
    }

    writeFileSync(join(runsDir, "unexpected.json"), "{}\n");
    await assert.rejects(
      () => gradeRuns(runsDir, casesDir),
      /undeclared top-level entries: unexpected\.json/,
    );
    rmSync(join(runsDir, "unexpected.json"));

    const tampered = JSON.parse(originalManifest) as Record<string, unknown>;
    tampered.repositoryCommit = "f".repeat(40);
    writeFileSync(manifestPath, JSON.stringify(tampered, null, 2));
    await assert.rejects(
      () => gradeRuns(runsDir, casesDir),
      /does not authenticate its contents/,
    );
    writeFileSync(manifestPath, originalManifest);

    const matrixManifestPath = join(runsDir, "matrix-manifest.json");
    const originalMatrixManifest = readFileSync(matrixManifestPath, "utf8");
    const tamperedMatrix = JSON.parse(originalMatrixManifest) as {
      providerNetworkIsolation: { mock: { mechanism: string } };
    };
    tamperedMatrix.providerNetworkIsolation.mock.mechanism = "forged capability";
    writeFileSync(matrixManifestPath, JSON.stringify(tamperedMatrix, null, 2));
    await assert.rejects(
      () => gradeRuns(runsDir, casesDir),
      /providerNetworkIsolation\.mock does not match the runner capability|matrix manifest does not match its authenticated experiment hash/,
    );
    writeFileSync(matrixManifestPath, originalMatrixManifest);

    const truthPath = join(caseDir, "ground_truth.json");
    const originalTruth = readFileSync(truthPath, "utf8");
    writeFileSync(truthPath, `${originalTruth}\n`);
    await assert.rejects(
      () => gradeRuns(runsDir, casesDir),
      /experiment corpus no longer matches the immutable manifest/,
    );
    writeFileSync(truthPath, originalTruth);

    const priorJudge = process.env.JUDGE;
    process.env.JUDGE = "codex";
    try {
      await assert.rejects(
        () => gradeRuns(runsDir, casesDir),
        /conflicts with immutable experiment judge exact/,
      );
    } finally {
      if (priorJudge === undefined) delete process.env.JUDGE;
      else process.env.JUDGE = priorJudge;
    }

    await gradeRuns(runsDir, casesDir);
    assert.equal(existsSync(join(runsDir, EXPERIMENT_GRADING_SEAL_FILENAME)), true);
    const firstGradePath = join(runsDir, experiment.schedule[0]!.file.replace(/\.json$/, ".graded.json"));
    const secondGradePath = join(runsDir, experiment.schedule[1]!.file.replace(/\.json$/, ".graded.json"));
    const firstGrade = readFileSync(firstGradePath, "utf8");
    rmSync(join(runsDir, EXPERIMENT_GRADING_SEAL_FILENAME));
    rmSync(secondGradePath);
    await gradeRuns(runsDir, casesDir);
    assert.equal(readFileSync(firstGradePath, "utf8"), firstGrade, "resume must not replace a valid grade");
    assert.equal(existsSync(secondGradePath), true, "resume must finish an interrupted partial grade set");
    writeFileSync(firstGradePath, "{}\n");
    await assert.rejects(
      () => gradeRuns(runsDir, casesDir),
      /does not match its sealed digest/,
    );
    writeFileSync(firstGradePath, firstGrade);
    writeFileSync(truthPath, `${originalTruth}\n`);
    await assert.rejects(
      () => buildReport(runsDir, { casesDir }),
      /experiment corpus no longer matches the immutable manifest/,
    );
    writeFileSync(truthPath, originalTruth);
    const report = await buildReport(runsDir, { casesDir });
    assert.equal(report.length, 1);
    assert.equal(report[0]?.benchmarkKind, "structural-only");
    const secondGrade = readFileSync(secondGradePath, "utf8");
    rmSync(secondGradePath);
    await assert.rejects(
      () => buildReport(runsDir, { casesDir }),
      /is missing from sealed evidence/,
    );
    writeFileSync(secondGradePath, secondGrade);
    await gradeRuns(runsDir, casesDir);
    assert.equal(readFileSync(firstGradePath, "utf8"), firstGrade);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("partial exact grading rejects a schema-valid wrong match before sealing", async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "peregrine-experiment-grade-resume-"));
  const casesDir = join(root, "cases");
  const caseDir = createFixtureCase(casesDir, "case-45454545", "structural-smoke");
  const truthPath = join(caseDir, "ground_truth.json");
  writeFileSync(truthPath, JSON.stringify({ bugs: [{
    id: "bug-1",
    file: "src/value.ts",
    startLine: 1,
    endLine: 1,
    description: "the changed value is incorrect",
  }] }));
  const matrixPath = join(root, "matrix.json");
  writeFileSync(matrixPath, JSON.stringify({
    repeats: 1,
    corpora: ["structural-smoke"],
    configs: [{ name: "mock", runner: "mock" }],
    experiment: structuralProtocol,
  }));

  try {
    let epoch = Date.parse("2026-09-03T15:30:00.000Z");
    const runsDir = await runMatrix(matrixPath, join(root, "runs"), {
      casesDir,
      engineFor: () => ({ name: "mock", review: async (ctx) => completedWithFinding(ctx) }),
      manifestPreparer,
      runtimeMetadataFor,
      now: () => epoch++,
    });
    await gradeRuns(runsDir, casesDir);
    const experiment = parseExperimentManifest(
      JSON.parse(readFileSync(join(runsDir, "experiment-manifest.json"), "utf8")),
    );
    const gradePath = join(runsDir, experiment.schedule[0]!.file.replace(/\.json$/, ".graded.json"));
    rmSync(join(runsDir, EXPERIMENT_GRADING_SEAL_FILENAME));
    const wrong = JSON.parse(readFileSync(gradePath, "utf8")) as {
      matches: Record<string, number | null>;
      falsePositiveIndexes: number[];
    };
    wrong.matches["bug-1"] = null;
    wrong.falsePositiveIndexes = [0];
    writeFileSync(gradePath, JSON.stringify(wrong, null, 2));

    await assert.rejects(
      () => gradeRuns(runsDir, casesDir),
      /does not match deterministic exact-v1 grading/,
    );
    assert.equal(existsSync(join(runsDir, EXPERIMENT_GRADING_SEAL_FILENAME)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("grading refuses to seal when the authenticated corpus changes during grading", async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "peregrine-experiment-grade-race-"));
  const casesDir = join(root, "cases");
  const caseDir = createFixtureCase(casesDir, "case-46464646", "structural-smoke");
  const truthPath = join(caseDir, "ground_truth.json");
  const originalTruth = readFileSync(truthPath, "utf8");
  const matrixPath = join(root, "matrix.json");
  writeFileSync(matrixPath, JSON.stringify({
    repeats: 1,
    corpora: ["structural-smoke"],
    configs: [{ name: "mock", runner: "mock" }],
    experiment: structuralProtocol,
  }));

  try {
    let epoch = Date.parse("2026-09-03T15:45:00.000Z");
    const runsDir = await runMatrix(matrixPath, join(root, "runs"), {
      casesDir,
      engineFor: () => ({ name: "mock", review: async (ctx) => completed(ctx) }),
      manifestPreparer,
      runtimeMetadataFor,
      now: () => epoch++,
    });
    await assert.rejects(
      () => gradeRuns(runsDir, casesDir, {
        beforeExperimentSeal: () => writeFileSync(truthPath, `${originalTruth}\n`),
      }),
      /experiment corpus no longer matches the immutable manifest/,
    );
    assert.equal(existsSync(join(runsDir, EXPERIMENT_GRADING_SEAL_FILENAME)), false);

    writeFileSync(truthPath, originalTruth);
    await gradeRuns(runsDir, casesDir);
    assert.equal(existsSync(join(runsDir, EXPERIMENT_GRADING_SEAL_FILENAME)), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("grade, report, resume, and retry reject experiment metadata symlinks without exposing target contents", async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "peregrine-experiment-read-symlink-"));
  const casesDir = join(root, "cases");
  createFixtureCase(casesDir, "case-77777777", "structural-smoke");
  const matrixPath = join(root, "matrix.json");
  writeFileSync(matrixPath, JSON.stringify({
    repeats: 2,
    corpora: ["structural-smoke"],
    configs: [{ name: "mock", runner: "mock" }],
    experiment: structuralProtocol,
  }));

  try {
    let epoch = Date.parse("2026-09-03T17:00:00.000Z");
    const runsDir = await runMatrix(matrixPath, join(root, "runs"), {
      casesDir,
      engineFor: () => ({ name: "mock", review: async (ctx) => completed(ctx) }),
      manifestPreparer,
      runtimeMetadataFor,
      now: () => epoch++,
    });
    const matrixManifestPath = join(runsDir, "matrix-manifest.json");
    const experimentManifestPath = join(runsDir, "experiment-manifest.json");
    const matrixManifest = readFileSync(matrixManifestPath);
    const experimentManifest = readFileSync(experimentManifestPath);
    const external = join(root, "outside.json");
    const secret = "SYMLINK_TARGET_SECRET_MUST_NOT_LEAK";
    writeFileSync(external, `{\"${secret}\":`);

    const rejectWithoutTargetContent = (error: unknown): boolean => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /regular non-symlink file/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    };

    rmSync(matrixManifestPath);
    symlinkSync(external, matrixManifestPath);
    await assert.rejects(() => gradeRuns(runsDir, casesDir), rejectWithoutTargetContent);
    rmSync(matrixManifestPath);
    writeFileSync(matrixManifestPath, matrixManifest);

    await gradeRuns(runsDir, casesDir);
    rmSync(matrixManifestPath);
    symlinkSync(external, matrixManifestPath);
    await assert.rejects(
      () => buildReport(runsDir, { casesDir }),
      rejectWithoutTargetContent,
    );
    rmSync(matrixManifestPath);
    writeFileSync(matrixManifestPath, matrixManifest);

    const stopPath = join(runsDir, "experiment-stop.json");
    symlinkSync(external, stopPath);
    await assert.rejects(
      () => runMatrix(matrixPath, join(root, "runs"), {
        casesDir,
        resumeDir: runsDir,
        engineFor: () => ({ name: "mock", review: async (ctx) => completed(ctx) }),
        manifestPreparer,
        runtimeMetadataFor,
        now: () => epoch++,
      }),
      rejectWithoutTargetContent,
    );
    rmSync(stopPath);

    rmSync(join(runsDir, "attempt-000002.json"));
    rmSync(experimentManifestPath);
    symlinkSync(external, experimentManifestPath);
    await assert.rejects(
      () => runMatrix(matrixPath, join(root, "runs"), {
        casesDir,
        retry: { runsDir, attemptId: "attempt-000002" },
        engineFor: () => ({ name: "mock", review: async (ctx) => completed(ctx) }),
        manifestPreparer,
        runtimeMetadataFor,
        now: () => epoch++,
      }),
      rejectWithoutTargetContent,
    );
    rmSync(experimentManifestPath);
    writeFileSync(experimentManifestPath, experimentManifest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a denied experiment cannot invoke its semantic judge", async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "peregrine-experiment-judge-stop-"));
  const casesDir = join(root, "cases");
  createFixtureCase(casesDir, "case-55555555", "development");
  const matrixPath = join(root, "matrix.json");
  writeFileSync(matrixPath, JSON.stringify({
    repeats: 1,
    corpora: ["development"],
    configs: [
      { name: "control", runner: "codex" },
      { name: "treatment", runner: "codex" },
    ],
    experiment: {
      ...cliSessionProtocol,
      providerCalls: "deny",
      judge: { kind: "codex", model: "gpt-5.6-luna", effort: "medium", version: "semantic-v1", limits: judgeLimits },
      limits: { ...cliSessionProtocol.limits, maxProviderAttempts: 0 },
    },
  }));

  try {
    const runsDir = await runMatrix(matrixPath, join(root, "runs"), {
      casesDir,
      runtimeMetadataFor,
      now: () => Date.parse("2026-09-03T16:00:00.000Z"),
    });
    await assert.rejects(
      () => gradeRuns(runsDir, casesDir),
      /semantic judge execution is not authorized/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("best-effort CLI-session accounting tolerates unknown dollars but enforces provider attempts", () => {
  const schedule = buildExperimentSchedule({
    protocol: cliSessionProtocol,
    cases: [{ caseName: "development/case-33333333", corpus: "development", expectedBugCount: 0 }],
    repeats: 1,
    configs: [
      { name: "control", runner: "codex" },
      { name: "treatment", runner: "codex" },
    ],
  });
  const first = schedule[0]!;
  const record: RunRecord = {
    schemaVersion: 1,
    attemptId: first.id,
    caseName: first.caseName,
    caseCorpus: first.corpus,
    caseKind: "clean",
    configName: first.configName,
    repeat: first.repeat,
    runner: first.runner,
    startedAt: "2026-09-03T14:00:00.000Z",
    finishedAt: "2026-09-03T14:00:01.000Z",
    attemptDurationMs: 1_000,
    outcome: {
      status: "completed",
      result: {
        engine: "codex",
        status: "clean",
        modelConfig: "test",
        findings: [],
        usage: { provider: "openai", unavailable: ["costUsd"] },
        durationMs: 1_000,
      },
    },
  };
  const decision = evaluateExperimentCeilings({
    protocol: { ...cliSessionProtocol, providerCalls: "allow" },
    schedule,
    records: [record],
    providerStartedAttemptIds: [first.id],
  });
  assert.equal(decision.reason, "provider-attempt-ceiling");
  assert.equal(decision.beforeAttemptId, schedule[1]?.id);
  assert.deepEqual(decision.observed.costUnavailableAttemptIds, [first.id]);
  assert.equal(decision.observed.providerAttempts, 1);
});

function createFixtureCase(
  casesDir: string,
  id: string,
  corpus: CaseCorpus,
  truth: GroundTruth = { bugs: [] },
): string {
  const caseDir = join(casesDir, corpus, id);
  mkdirSync(join(caseDir, "fixture", "src"), { recursive: true });
  writeFileSync(join(caseDir, "fixture", "src", "value.ts"), HEAD);
  writeFileSync(join(caseDir, "diff.patch"), PATCH);
  writeFileSync(join(caseDir, "ground_truth.json"), JSON.stringify(truth));
  const spec = {
    id,
    corpus,
    kind: (truth.bugs.length === 0 ? "clean" : "seeded") as "clean" | "seeded",
    fixtureDir: "fixture",
    diffFile: "diff.patch",
  };
  writeFileSync(join(caseDir, "case.json"), JSON.stringify(spec));
  if (corpus !== "structural-smoke") {
    const proof = "Independent clean-control test fixture proof.\n";
    writeFileSync(join(caseDir, "proof.md"), proof);
    const policy = `${JSON.stringify({
      schemaVersion: 1,
      policyId: "protected-git-review-v1",
      trustRoot: "protected-git-review",
      minimumIndependentConfirmations: 2,
      curatorIdentitySha256s: ["1".repeat(64), "2".repeat(64)],
    }, null, 2)}\n`;
    writeFileSync(join(casesDir, "..", "curator-policy.json"), policy);
    const checks = requiredConfirmationChecks(spec.kind);
    const curation = {
      schemaVersion: 1,
      caseId: id,
      status: "admitted",
      curatorPolicyId: "protected-git-review-v1",
      source: {
        kind: spec.kind,
        repositoryAlias: "experiment-fixture",
        repositoryIdentitySha256: fixtureSourceIdentitySha256(caseDir, "fixture"),
        changeIdentitySha256: createHash("sha256").update(PATCH).digest("hex"),
        access: "public",
      },
      strata: {
        languageFamily: "typescript",
        architectureFamily: "library",
        size: "small",
        changeShapes: ["direct"],
        surfaceLanes: ["logic-correctness"],
      },
      proof: {
        kind: spec.kind === "clean" ? "clean-control-review" : "regression-test",
        artifact: "proof.md",
        sha256: createHash("sha256").update(proof).digest("hex"),
      },
      confirmations: [
        { curatorIdentitySha256: "1".repeat(64), confirmedAt: "2026-09-03T10:00:00Z", caseBundleSha256: "0".repeat(64), checks },
        { curatorIdentitySha256: "2".repeat(64), confirmedAt: "2026-09-03T11:00:00Z", caseBundleSha256: "0".repeat(64), checks },
      ],
    };
    const parsed = parseCaseCuration(curation, spec, truth);
    const bundle = caseBundleSha256(caseDir, spec, parsed);
    for (const confirmation of curation.confirmations) confirmation.caseBundleSha256 = bundle;
    writeFileSync(join(caseDir, "curation.json"), JSON.stringify(curation));
  }
  return caseDir;
}

function completed(ctx: ReviewContext): EngineResult {
  return {
    engine: "mock",
    status: "clean",
    modelConfig: "mock",
    reviewedBaseRef: ctx.baseRef,
    reviewedHeadRef: ctx.headRef,
    findings: [],
    usage: mockUsage(),
    durationMs: 1,
  };
}

function completedWithFinding(ctx: ReviewContext): EngineResult {
  return {
    ...completed(ctx),
    status: "completed",
    findings: [{
      file: "src/value.ts",
      startLine: 1,
      endLine: 1,
      severity: "medium",
      disposition: "fix-in-pr",
      category: "logic",
      invariant: "value-remains-enabled",
      title: "Wrong value",
      explanation: "The changed value violates the fixture expectation.",
      failurePath: "The exported value is false.",
      confidence: 0.99,
    }],
  };
}

async function manifestPreparer(ctx: ReviewContext) {
  return {
    available: true,
    output: [
      `base: ${ctx.baseRef} (argument)`,
      `head: ${ctx.headRef}`,
      `merge-base: ${ctx.baseRef}`,
      "Changed files",
      "M\tsrc/value.ts",
      "",
    ].join("\n"),
    typed: {
      schemaVersion: 1 as const,
      available: true as const,
      base: { ref: ctx.baseRef!, commit: ctx.baseRef!, source: "argument" as const },
      head: { ref: ctx.headRef!, commit: ctx.headRef! },
      mergeBase: ctx.baseRef!,
      profile: { source: "none" as const, requestedPath: null, changedAtHead: false },
      changedFiles: [{
        path: "src/value.ts",
        status: "M",
        additions: 1,
        deletions: 1,
        binary: false,
        activatedLanes: [{ id: "logic-correctness", reason: "content" as const }],
      }],
      activatedLanes: ["logic-correctness"],
      customLanes: [],
      largeFiles: [],
      warnings: [],
    },
  };
}

async function runtimeMetadataFor(runners: readonly RunnerName[], observedAt: string) {
  const sorted = [...runners].sort();
  return {
    observedAt,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cliVersions: sorted.map((runner) => runner === "mock"
      ? { runner, status: "not-applicable" as const }
      : { runner, status: "observed" as const, version: "1.0.0" }),
    providerAvailability: sorted.map((runner) => runner === "mock"
      ? { runner, status: "not-applicable" as const }
      : { runner, status: "denied" as const }),
  };
}

async function availableRuntimeMetadataFor(runners: readonly RunnerName[], observedAt: string) {
  const runtime = await runtimeMetadataFor(runners, observedAt);
  return {
    ...runtime,
    providerAvailability: runtime.providerAvailability.map((item) =>
      item.status === "not-applicable" ? item : { ...item, status: "configured" as const }),
  };
}

function directorySnapshot(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else snapshot[relative(root, path)] = readFileSync(path, "utf8");
    }
  };
  visit(root);
  return snapshot;
}
