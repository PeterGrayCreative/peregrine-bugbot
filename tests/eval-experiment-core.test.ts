import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  absentInputSha256,
  attemptStartedFile,
  buildExperimentManifest,
  buildExperimentSchedule,
  buildExperimentStopRecord,
  buildRetrySchedule,
  canonicalJson,
  canonicalJsonSha256,
  evaluateExperimentCeilings,
  hashPathTree,
  parseExperimentAttemptStartedRecord,
  parseExperimentManifest,
  parseExperimentProtocol,
  parseExperimentProviderStartedRecord,
  parseExperimentStopRecord,
  providerStartedFile,
  type ExperimentManifest,
  type ExperimentScheduledAttempt,
} from "../eval/experiment.js";
import { assertExperimentRecordModelIdentity } from "../eval/experiment-evidence.js";
import {
  parseExperimentGradingSeal,
  parseExperimentTerminalSeal,
} from "../eval/experiment-seals.js";
import { mockUsage } from "../src/core/telemetry.js";
import type { ExperimentProtocol, RunRecord } from "../src/types.js";

const limits = {
  maxProviderCostUsd: 10,
  maxProviderAttempts: 10,
  maxWallTimeMs: 10_000,
  maxFailureRate: 0.5,
  minAttemptsForFailureRate: 2,
  maxConsecutiveFailures: 2,
};

const smokeProtocol: ExperimentProtocol = {
  mode: "structural-smoke",
  seed: 7,
  cacheCondition: "not-applicable",
  providerCalls: "deny",
  providerAccess: "not-applicable",
  costAccounting: "not-applicable",
  judge: { kind: "exact", version: "exact-v1" },
  limits: { ...limits, maxProviderCostUsd: null, maxProviderAttempts: 0 },
};

const screeningProtocol: ExperimentProtocol = {
  mode: "screening",
  seed: 17,
  cacheCondition: "uncontrolled",
  providerCalls: "deny",
  providerAccess: "api-key",
  costAccounting: "required",
  judge: { kind: "codex", model: "gpt-5.6-luna", effort: "medium", version: "semantic-v1", limits },
  control: "control",
  treatment: "treatment",
  limits,
};

const providerEnabledProtocol: ExperimentProtocol = {
  ...screeningProtocol,
  providerCalls: "allow",
};

test("experiment protocol is explicit and mode-sensitive", () => {
  assert.deepEqual(parseExperimentProtocol(smokeProtocol), smokeProtocol);
  assert.deepEqual(parseExperimentProtocol(screeningProtocol), screeningProtocol);
  assert.deepEqual(parseExperimentProtocol(providerEnabledProtocol), providerEnabledProtocol);
  assert.throws(
    () => parseExperimentProtocol({ ...smokeProtocol, cacheCondition: "cold" }),
    /not-applicable/,
  );
  assert.throws(
    () => parseExperimentProtocol({ ...screeningProtocol, providerCalls: undefined }),
    /providerCalls/,
  );
  assert.throws(
    () => parseExperimentProtocol({ ...screeningProtocol, cacheCondition: "cold" }),
    /cache state must remain uncontrolled/,
  );
  assert.throws(
    () => parseExperimentProtocol({ ...screeningProtocol, costAccounting: "best-effort" }),
    /api-key with required accounting or cli-session with best-effort accounting/,
  );
  assert.throws(
    () => parseExperimentProtocol({
      ...screeningProtocol,
      providerAccess: "cli-session",
      costAccounting: "required",
    }),
    /api-key with required accounting or cli-session with best-effort accounting/,
  );
  assert.throws(
    () => parseExperimentProtocol({
      ...smokeProtocol,
      judge: { kind: "codex", model: "gpt-5.6-luna", effort: "medium", version: "semantic-v1", limits },
    }),
    /structural-smoke must use the exact judge/,
  );
  assert.throws(
    () => parseExperimentProtocol({ ...screeningProtocol, extra: true }),
    /unsupported field/,
  );
  assert.throws(
    () => parseExperimentProtocol({
      ...screeningProtocol,
      judge: { kind: "exact", version: "semantic-v1" },
    }),
    /exact\/semantic-v1 is not supported; expected exact\/exact-v1/,
  );
  assert.throws(
    () => parseExperimentProtocol({
      ...screeningProtocol,
      judge: { kind: "exact", version: "exact-v1" },
    }),
    /screening and checkpoint must preregister a semantic judge/,
  );
  assert.throws(
    () => parseExperimentProtocol({
      ...screeningProtocol,
      judge: { kind: "codex", model: "gpt-5.6-luna", effort: "medium", version: "exact-v1", limits },
    }),
    /codex\/exact-v1 is not supported; expected codex\/semantic-v1/,
  );
});

test("seeded paired scheduling is deterministic, interleaved, and position-balanced", () => {
  const cases = Array.from({ length: 5 }, (_, index) => ({
    caseName: `development/case-${String(index + 1).padStart(8, "0")}`,
    corpus: "development" as const,
    expectedBugCount: index,
  }));
  const configs = [
    { name: "control", runner: "claude" as const },
    { name: "treatment", runner: "claude" as const },
  ];
  const first = buildExperimentSchedule({ protocol: screeningProtocol, cases, repeats: 3, configs });
  const second = buildExperimentSchedule({
    protocol: screeningProtocol,
    cases: [...cases].reverse(),
    repeats: 3,
    configs,
  });
  assert.deepEqual(first, second);
  assert.equal(first.length, 30);
  for (let index = 0; index < first.length; index += 2) {
    const pair = first.slice(index, index + 2);
    assert.equal(pair[0]?.blockId, pair[1]?.blockId);
    assert.deepEqual(new Set(pair.map((item) => item.variant)), new Set(["control", "treatment"]));
    assert.deepEqual(pair.map((item) => item.position), [1, 2]);
  }
  const firstVariants = first.filter((item) => item.position === 1).map((item) => item.variant);
  assert.ok(Math.abs(
    firstVariants.filter((variant) => variant === "control").length -
    firstVariants.filter((variant) => variant === "treatment").length,
  ) <= 1);

  const changed = buildExperimentSchedule({
    protocol: { ...screeningProtocol, seed: 18 },
    cases,
    repeats: 3,
    configs,
  });
  assert.notDeepEqual(first.map(blockIdentity), changed.map(blockIdentity));
});

test("structural scheduling and retry lineage stay distinct", () => {
  const structural = buildExperimentSchedule({
    protocol: smokeProtocol,
    cases: [{ caseName: "structural-smoke/case-00000001", corpus: "structural-smoke", expectedBugCount: 0 }],
    repeats: 1,
    configs: [{ name: "mock", runner: "mock" }],
  });
  assert.equal(structural[0]?.variant, "structural");
  const source = pairedSchedule()[0]!;
  const reference = {
    experimentId: "a".repeat(64),
    manifestSha256: "b".repeat(64),
    attemptId: source.id,
    evidenceSha256: "c".repeat(64),
  };
  const retry = buildRetrySchedule(source, reference);
  assert.equal(retry.length, 1);
  assert.deepEqual(retry[0]?.retryOf, reference);
  assert.equal(retry[0]?.file, "attempt-000001.json");
});

test("canonical JSON and path-tree hashes are stable and reject unsafe inputs", () => {
  assert.equal(canonicalJson({ z: 1, a: [true, null] }), '{"a":[true,null],"z":1}');
  assert.equal(canonicalJsonSha256({ a: 1, b: 2 }), canonicalJsonSha256({ b: 2, a: 1 }));
  assert.throws(() => canonicalJson({ value: undefined }), /non-JSON/);
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic), /cycle/);
  assert.equal(absentInputSha256("profile"), absentInputSha256("profile"));

  const root = mkdtempSync(join(realpathSync(tmpdir()), "peregrine-experiment-hash-"));
  try {
    mkdirSync(join(root, "nested"));
    writeFileSync(join(root, "a.txt"), "alpha\n");
    writeFileSync(join(root, "nested", "b.txt"), "beta\n");
    const first = hashPathTree(root);
    assert.equal(first, hashPathTree(root));
    assert.equal(
      hashPathTree(root, { excludeRelativePaths: ["nested"] }),
      hashPathTree(root, { excludeRelativePaths: ["nested/"] }),
    );
    writeFileSync(join(root, "nested", "b.txt"), "changed\n");
    assert.notEqual(first, hashPathTree(root));
    const beforeMode = hashPathTree(root);
    chmodSync(join(root, "a.txt"), 0o755);
    assert.notEqual(beforeMode, hashPathTree(root));
    symlinkSync(join(root, "a.txt"), join(root, "link"));
    assert.throws(() => hashPathTree(root), /symbolic link/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("experiment manifests authenticate normalized immutable provenance", () => {
  const manifest = buildManifest();
  assert.equal(manifest.experimentId.length, 64);
  assert.ok(Object.isFrozen(manifest));
  assert.ok(Object.isFrozen(manifest.protocol));
  assert.deepEqual(parseExperimentManifest(JSON.parse(JSON.stringify(manifest))), manifest);

  const tampered = JSON.parse(JSON.stringify(manifest)) as ExperimentManifest;
  tampered.repositoryCommit = "2".repeat(40);
  assert.throws(() => parseExperimentManifest(tampered), /does not authenticate/);
});

test("ceiling decisions deny providers, distinguish pre-provider failures, and stop on unknown spend", () => {
  const schedule = pairedSchedule();
  const denied = evaluateExperimentCeilings({
    protocol: { ...screeningProtocol, providerCalls: "deny" },
    schedule,
    records: [],
    providerStartedAttemptIds: [],
  });
  assert.equal(denied.reason, "provider-calls-denied");
  assert.equal(denied.beforeAttemptId, schedule[0]?.id);

  const preProviderFailure = failedRecord(schedule[0]!, 100);
  const afterPreflight = evaluateExperimentCeilings({
    protocol: providerEnabledProtocol,
    schedule,
    records: [preProviderFailure],
    providerStartedAttemptIds: [],
  });
  assert.equal(afterPreflight.stop, false);
  assert.deepEqual(afterPreflight.observed.costUnavailableAttemptIds, []);

  const providerFailure = failedRecord(schedule[0]!, 100);
  const unknown = evaluateExperimentCeilings({
    protocol: providerEnabledProtocol,
    schedule,
    records: [providerFailure],
    providerStartedAttemptIds: [schedule[0]!.id],
  });
  assert.equal(unknown.reason, "provider-cost-unavailable");

  assert.throws(
    () => evaluateExperimentCeilings({
      protocol: providerEnabledProtocol,
      schedule,
      records: [],
      providerStartedAttemptIds: [schedule[0]!.id],
    }),
    /no terminal record/,
  );
});

test("cli-session experiments tolerate unavailable cost but obey the provider-attempt ceiling", () => {
  const schedule = pairedSchedule();
  const first = completedRecord(schedule[0]!, 100, 0.01);
  if (first.outcome.status !== "completed") throw new Error("test fixture must be completed");
  const costUnknown = {
    ...first,
    outcome: {
      status: "completed" as const,
      result: {
        ...first.outcome.result,
        usage: {
          ...first.outcome.result.usage,
          costUsd: undefined,
        },
      },
    },
  } satisfies RunRecord;
  const protocol = {
    ...providerEnabledProtocol,
    providerAccess: "cli-session" as const,
    costAccounting: "best-effort" as const,
    limits: {
      ...limits,
      maxProviderCostUsd: null,
      maxProviderAttempts: 1,
    },
  };

  const decision = evaluateExperimentCeilings({
    protocol,
    schedule,
    records: [costUnknown],
    providerStartedAttemptIds: [costUnknown.attemptId],
  });

  assert.equal(decision.reason, "provider-attempt-ceiling");
  assert.equal(decision.observed.providerAttempts, 1);
  assert.deepEqual(decision.observed.costUnavailableAttemptIds, [costUnknown.attemptId]);
  assert.equal(decision.observed.providerCostUsd, 0);

  const bestEffortWithDollarCeiling = evaluateExperimentCeilings({
    protocol: {
      ...protocol,
      limits: {
        ...protocol.limits,
        maxProviderCostUsd: 1,
        maxProviderAttempts: 2,
      },
    },
    schedule,
    records: [costUnknown],
    providerStartedAttemptIds: [costUnknown.attemptId],
  });
  assert.equal(bestEffortWithDollarCeiling.reason, "provider-cost-unavailable");
});

test("terminal provider records must match the immutable experiment model identity", () => {
  const manifest = {
    models: [{
      configName: "control",
      runner: "claude",
      effectiveConfigSha256: "a".repeat(64),
      breadthModel: "claude-breadth",
      breadthEffort: "high",
      investigationModel: "claude-investigation",
      investigationEffort: "high",
    }],
  } satisfies Pick<ExperimentManifest, "models">;
  const attempt = {
    id: "attempt-000001",
    blockId: "block-000001",
    sequence: 1,
    caseName: "development/case-00000001",
    corpus: "development",
    expectedBugCount: 1,
    configName: "control",
    repeat: 1,
    runner: "claude",
    variant: "control",
    position: 1,
    file: "attempt-000001.json",
  } satisfies ExperimentScheduledAttempt;
  const mismatched = completedRecord(attempt, 100, 0.01);

  assert.throws(
    () => assertExperimentRecordModelIdentity(manifest, mismatched),
    /modelConfig does not match its immutable experiment model identity/,
  );

  if (mismatched.outcome.status !== "completed") throw new Error("expected completed fixture");
  const matching = structuredClone(mismatched);
  if (matching.outcome.status !== "completed") throw new Error("expected completed fixture");
  matching.outcome.result.modelConfig =
    "claude-breadth/high->claude-investigation/high";
  assert.doesNotThrow(() => assertExperimentRecordModelIdentity(manifest, matching));

  const failed = failedRecord(attempt, 100);
  failed.outcome = {
    status: "failed",
    failureKind: "provider",
    message: "provider failed",
    durationMs: 100,
    telemetry: {
      engine: "claude",
      modelConfig: "other-breadth/high->other-investigation/high",
      usage: { ...mockUsage(), provider: "anthropic" },
      durationMs: 100,
      stages: [],
    },
  };
  assert.throws(
    () => assertExperimentRecordModelIdentity(manifest, failed),
    /modelConfig does not match its immutable experiment model identity/,
  );
});

test("terminal provider records bind the configured breadth ledger mode", () => {
  const manifest = {
    models: [{
      configName: "control",
      runner: "claude",
      effectiveConfigSha256: "a".repeat(64),
      breadthModel: "claude-breadth",
      breadthEffort: "high",
      investigationModel: "claude-investigation",
      investigationEffort: "high",
      breadthLedgerMode: "structural-compact",
    }],
  } satisfies Pick<ExperimentManifest, "models">;
  const attempt = pairedSchedule(1)[0]!;
  const record = completedRecord(attempt, 100, 0.01);
  if (record.outcome.status !== "completed") throw new Error("expected completed fixture");
  record.outcome.result.modelConfig = "claude-breadth/high->claude-investigation/high";
  record.outcome.result.raw = {
    breadth: { breadthLedger: { mode: "structural-compact" } },
  };

  assert.doesNotThrow(() => assertExperimentRecordModelIdentity(manifest, record));
  const mismatched = structuredClone(record);
  if (mismatched.outcome.status !== "completed") throw new Error("expected completed fixture");
  ((mismatched.outcome.result.raw as { breadth: { breadthLedger: { mode: string } } })
    .breadth.breadthLedger).mode = "full";
  assert.throws(
    () => assertExperimentRecordModelIdentity(manifest, mismatched),
    /breadth ledger mode does not match its immutable experiment model identity/,
  );

  const missing = structuredClone(record);
  if (missing.outcome.status !== "completed") throw new Error("expected completed fixture");
  delete (missing.outcome.result.raw as { breadth: { breadthLedger?: unknown } })
    .breadth.breadthLedger;
  assert.throws(
    () => assertExperimentRecordModelIdentity(manifest, missing),
    /completed breadth stage does not bind its breadth ledger mode/,
  );

  const failedWithoutLedger = failedRecord(attempt, 100);
  failedWithoutLedger.outcome = {
    status: "failed",
    failureKind: "timeout",
    message: "investigation timed out",
    durationMs: 100,
    telemetry: {
      engine: "claude",
      modelConfig: "claude-breadth/high->claude-investigation/high",
      usage: { ...mockUsage(), provider: "anthropic" },
      durationMs: 100,
      stages: [{
        stage: "breadth",
        model: "claude-breadth",
        promptSha256: "b".repeat(64),
        usage: { ...mockUsage(), provider: "anthropic" },
        durationMs: 100,
        completed: true,
      }],
    },
  };
  assert.throws(
    () => assertExperimentRecordModelIdentity(manifest, failedWithoutLedger),
    /completed breadth stage does not bind its breadth ledger mode/,
  );
});

test("observed cost, wall time, failure rate, and consecutive failures stop before the next attempt", () => {
  const schedule = pairedSchedule(4);
  const costly = completedRecord(schedule[0]!, 100, 10);
  assert.equal(evaluateExperimentCeilings({
    protocol: providerEnabledProtocol,
    schedule,
    records: [costly],
    providerStartedAttemptIds: [costly.attemptId],
  }).reason, "provider-cost-ceiling");

  const slow = failedRecord(schedule[0]!, 10_000);
  assert.equal(evaluateExperimentCeilings({
    protocol: providerEnabledProtocol,
    schedule,
    records: [slow],
    providerStartedAttemptIds: [],
  }).reason, "wall-time-ceiling");

  const immediateConsecutive = evaluateExperimentCeilings({
    protocol: {
      ...providerEnabledProtocol,
      limits: { ...limits, maxFailureRate: 1, maxConsecutiveFailures: 1 },
    },
    schedule,
    records: [failedRecord(schedule[0]!, 1)],
    providerStartedAttemptIds: [],
  });
  assert.equal(immediateConsecutive.reason, "consecutive-failure-ceiling");
  assert.equal(immediateConsecutive.beforeAttemptId, schedule[1]?.id);

  const failures = [failedRecord(schedule[0]!, 1), failedRecord(schedule[1]!, 1)];
  const consecutive = evaluateExperimentCeilings({
    protocol: providerEnabledProtocol,
    schedule,
    records: failures,
    providerStartedAttemptIds: [],
  });
  assert.equal(consecutive.reason, "consecutive-failure-ceiling");

  const failureRate = evaluateExperimentCeilings({
    protocol: {
      ...providerEnabledProtocol,
      limits: { ...limits, maxConsecutiveFailures: 5 },
    },
    schedule,
    records: failures,
    providerStartedAttemptIds: [],
  });
  assert.equal(failureRate.reason, "failure-rate-ceiling");
});

test("failure-rate stopping completes the paired block before stopping the next block", () => {
  const schedule = pairedSchedule(2);
  const protocol = {
    ...providerEnabledProtocol,
    limits: {
      ...limits,
      maxFailureRate: 0,
      minAttemptsForFailureRate: 1,
      maxConsecutiveFailures: 5,
    },
  };
  const firstFailure = failedRecord(schedule[0]!, 1);

  const withinPair = evaluateExperimentCeilings({
    protocol,
    schedule,
    records: [firstFailure],
    providerStartedAttemptIds: [],
  });
  assert.equal(withinPair.stop, false);
  assert.equal(withinPair.beforeAttemptId, schedule[1]?.id);
  assert.equal(withinPair.observed.failureRate, 1);

  const afterPair = evaluateExperimentCeilings({
    protocol,
    schedule,
    records: [firstFailure, completedRecord(schedule[1]!, 1, 0)],
    providerStartedAttemptIds: [schedule[1]!.id],
  });
  assert.equal(afterPair.reason, "failure-rate-ceiling");
  assert.equal(afterPair.beforeAttemptId, schedule[2]?.id);
  assert.equal(afterPair.observed.attempts, 2);
  assert.equal(afterPair.observed.failureRate, 0.5);
});

test("checked-in experiment schema tracks parser enums, required hashes, and emitted manifests", () => {
  const schema = JSON.parse(
    readFileSync(join(process.cwd(), "schemas", "experiment-manifest.schema.json"), "utf8"),
  ) as Record<string, any>;
  const defs = schema.$defs as Record<string, any>;
  const protocol = defs.protocol as Record<string, any>;
  const judge = defs.judge as Record<string, any>;
  const hashes = defs.hashes as Record<string, any>;

  assert.deepEqual(judge.properties.kind.enum, ["exact", "claude", "codex"]);
  assert.deepEqual(protocol.properties.providerCalls.enum, ["allow", "deny"]);
  assert.deepEqual(protocol.properties.providerAccess.enum, ["api-key", "cli-session", "not-applicable"]);
  assert.deepEqual(protocol.properties.costAccounting.enum, ["required", "best-effort", "not-applicable"]);
  const liveProtocol = protocol.allOf[0].else as Record<string, any>;
  assert.deepEqual(liveProtocol.oneOf, [
    {
      properties: {
        providerAccess: { const: "api-key" },
        costAccounting: { const: "required" },
      },
      required: ["providerAccess", "costAccounting"],
    },
    {
      properties: {
        providerAccess: { const: "cli-session" },
        costAccounting: { const: "best-effort" },
      },
      required: ["providerAccess", "costAccounting"],
    },
  ]);
  assert.ok(JSON.stringify(judge.allOf).includes("exact-v1"));
  assert.ok(JSON.stringify(judge.allOf).includes("semantic-v1"));

  const expectedHashes = [
    "repositorySha256",
    "corpusSha256",
    "promptSha256",
    "methodSha256",
    "schemaSha256",
    "profileSha256",
    "judgeSha256",
    "matrixManifestSha256",
    "matrixConfigSha256",
    "peregrineConfigSha256",
    "configurationSha256",
  ];
  assert.deepEqual([...hashes.required].sort(), [...expectedHashes].sort());

  const manifest = buildManifest() as unknown as Record<string, unknown>;
  for (const field of schema.required as string[]) {
    assert.ok(Object.hasOwn(manifest, field), `emitted manifest is missing schema-required ${field}`);
  }
  const emittedHashes = manifest.hashes as Record<string, unknown>;
  assert.deepEqual(Object.keys(emittedHashes).sort(), [...expectedHashes].sort());
  assert.ok(defs.attemptReference.required.includes("evidenceSha256"));

  for (const file of ["experiment-terminal-seal.schema.json", "experiment-grading-seal.schema.json"]) {
    const sealSchema = JSON.parse(readFileSync(join(process.cwd(), "schemas", file), "utf8")) as {
      additionalProperties: boolean;
      required: string[];
    };
    assert.equal(sealSchema.additionalProperties, false);
    assert.ok(sealSchema.required.includes("sealSha256"));
    assert.ok(sealSchema.required.includes("experimentManifestSha256"));
  }

  for (const configFile of ["matrix.config.json", "matrix.codex.config.json"]) {
    const config = JSON.parse(
      readFileSync(join(process.cwd(), "eval", configFile), "utf8"),
    ) as { experiment: unknown };
    const checkedInProtocol = parseExperimentProtocol(config.experiment, configFile);
    assert.equal(checkedInProtocol.providerCalls, "deny");
    assert.equal(checkedInProtocol.judge.version, "semantic-v1");
    assert.notEqual(checkedInProtocol.judge.kind, "exact");
  }
});

test("terminal and grading seals parse strictly and self-authenticate", () => {
  const terminalBody = {
    schemaVersion: 1 as const,
    kind: "experiment-terminal" as const,
    experimentId: "a".repeat(64),
    experimentManifestSha256: "b".repeat(64),
    terminal: "completed" as const,
    sealedAt: "2026-09-03T18:00:00.000Z",
    artifacts: [
      { path: "experiment-manifest.json", sha256: "c".repeat(64) },
      { path: "matrix-manifest.json", sha256: "d".repeat(64) },
    ],
  };
  const terminal = { ...terminalBody, sealSha256: canonicalJsonSha256(terminalBody) };
  assert.deepEqual(parseExperimentTerminalSeal(terminal), terminal);
  assert.throws(
    () => parseExperimentTerminalSeal({ ...terminal, terminal: "stopped" }),
    /does not authenticate/,
  );
  assert.throws(
    () => parseExperimentTerminalSeal({ ...terminal, extra: true }),
    /unknown fields/,
  );

  const gradingBody = {
    schemaVersion: 1 as const,
    kind: "experiment-grading" as const,
    experimentId: terminal.experimentId,
    experimentManifestSha256: terminal.experimentManifestSha256,
    terminalSealSha256: "e".repeat(64),
    sealedAt: "2026-09-03T18:01:00.000Z",
    artifacts: [{ path: "attempt-000001.graded.json", sha256: "f".repeat(64) }],
  };
  const grading = { ...gradingBody, sealSha256: canonicalJsonSha256(gradingBody) };
  assert.deepEqual(parseExperimentGradingSeal(grading), grading);
  assert.throws(
    () => parseExperimentGradingSeal({ ...grading, artifacts: [] }),
    /does not authenticate/,
  );
});

test("the Stage 2 baseline preregistration freezes a bounded repeated screening", () => {
  const config = JSON.parse(
    readFileSync(join(process.cwd(), "eval", "matrix.codex.stage2-baseline.json"), "utf8"),
  ) as {
    repeats: number;
    corpora: string[];
    caseIds: string[];
    configs: Array<{ name: string; runner: string }>;
    experiment: unknown;
  };
  const protocol = parseExperimentProtocol(config.experiment, "matrix.codex.stage2-baseline.json");

  assert.equal(protocol.mode, "screening");
  assert.equal(protocol.providerCalls, "allow");
  assert.equal(protocol.providerAccess, "cli-session");
  assert.equal(protocol.costAccounting, "best-effort");
  assert.equal(protocol.limits.maxProviderAttempts, 72);
  assert.equal(protocol.judge.limits?.maxProviderAttempts, 100);
  assert.equal(config.repeats, 3);
  assert.deepEqual(config.corpora, ["development"]);
  assert.equal(config.caseIds.length, 12);
  assert.equal(new Set(config.caseIds).size, config.caseIds.length);
  assert.ok(config.caseIds.every((id) => /^case-[0-9a-f]{8}$/.test(id)));
  assert.deepEqual(
    config.configs.map(({ name, runner }) => ({ name, runner })),
    [
      { name: "production-luna-high-to-sol-high", runner: "codex" },
      { name: "luna-medium-only", runner: "codex" },
    ],
  );
  assert.equal(config.repeats * config.caseIds.length * config.configs.length, 72);
});

test("the Stage 2 PR 8 preregistration isolates the method-packet intervention", () => {
  const config = JSON.parse(
    readFileSync(join(process.cwd(), "eval", "matrix.codex.stage2-pr8.json"), "utf8"),
  ) as {
    repeats: number;
    corpora: string[];
    caseIds: string[];
    configs: Array<{
      name: string;
      runner: string;
      overrides: Record<string, unknown>;
    }>;
    experiment: unknown;
  };
  const protocol = parseExperimentProtocol(config.experiment, "matrix.codex.stage2-pr8.json");

  assert.equal(protocol.mode, "screening");
  assert.equal(protocol.control, "legacy-investigator-prompt");
  assert.equal(protocol.treatment, "stable-method-packet");
  assert.equal(protocol.providerAccess, "cli-session");
  assert.equal(protocol.cacheCondition, "uncontrolled");
  assert.equal(protocol.limits.maxProviderAttempts, 48);
  assert.equal(config.repeats, 3);
  assert.deepEqual(config.corpora, ["development"]);
  assert.equal(config.caseIds.length, 8);
  assert.equal(new Set(config.caseIds).size, config.caseIds.length);
  assert.ok(config.caseIds.every((id) => /^case-[0-9a-f]{8}$/.test(id)));
  assert.deepEqual(
    config.configs.map(({ name, runner, overrides }) => ({
      name,
      runner,
      promptMode: overrides.investigationPromptMode,
      breadthModel: overrides.breadthModel,
      breadthEffort: overrides.breadthEffort,
      investigationModel: overrides.investigationModel,
      investigationEffort: overrides.investigationEffort,
    })),
    [
      {
        name: "legacy-investigator-prompt",
        runner: "codex",
        promptMode: "legacy",
        breadthModel: "gpt-5.6-luna",
        breadthEffort: "high",
        investigationModel: "gpt-5.6-sol",
        investigationEffort: "high",
      },
      {
        name: "stable-method-packet",
        runner: "codex",
        promptMode: "method-packet",
        breadthModel: "gpt-5.6-luna",
        breadthEffort: "high",
        investigationModel: "gpt-5.6-sol",
        investigationEffort: "high",
      },
    ],
  );
  assert.equal(config.repeats * config.caseIds.length * config.configs.length, 48);
});

test("the Stage 2 PR 9 preregistration isolates structural breadth compaction", () => {
  const config = JSON.parse(
    readFileSync(join(process.cwd(), "eval", "matrix.codex.stage2-pr9.json"), "utf8"),
  ) as {
    repeats: number;
    corpora: string[];
    caseIds: string[];
    configs: Array<{
      name: string;
      runner: string;
      overrides: Record<string, unknown>;
    }>;
    experiment: unknown;
  };
  const protocol = parseExperimentProtocol(config.experiment, "matrix.codex.stage2-pr9.json");

  assert.equal(protocol.mode, "screening");
  assert.equal(protocol.control, "method-packet-full-ledger");
  assert.equal(protocol.treatment, "method-packet-structural-compact");
  assert.equal(protocol.providerAccess, "cli-session");
  assert.equal(protocol.cacheCondition, "uncontrolled");
  assert.equal(protocol.limits.maxProviderAttempts, 72);
  assert.equal(config.repeats, 3);
  assert.deepEqual(config.corpora, ["development"]);
  assert.equal(config.caseIds.length, 10);
  assert.equal(new Set(config.caseIds).size, config.caseIds.length);
  assert.ok(config.caseIds.every((id) => /^case-[0-9a-f]{8}$/.test(id)));
  assert.deepEqual(
    config.configs.map(({ name, runner, overrides }) => ({
      name,
      runner,
      breadthLedgerMode: overrides.breadthLedgerMode,
      promptMode: overrides.investigationPromptMode,
      breadthModel: overrides.breadthModel,
      breadthEffort: overrides.breadthEffort,
      investigationModel: overrides.investigationModel,
      investigationEffort: overrides.investigationEffort,
    })),
    [
      {
        name: "method-packet-full-ledger",
        runner: "codex",
        breadthLedgerMode: "full",
        promptMode: "method-packet",
        breadthModel: "gpt-5.6-luna",
        breadthEffort: "high",
        investigationModel: "gpt-5.6-sol",
        investigationEffort: "high",
      },
      {
        name: "method-packet-structural-compact",
        runner: "codex",
        breadthLedgerMode: "structural-compact",
        promptMode: "method-packet",
        breadthModel: "gpt-5.6-luna",
        breadthEffort: "high",
        investigationModel: "gpt-5.6-sol",
        investigationEffort: "high",
      },
    ],
  );
  assert.equal(config.repeats * config.caseIds.length * config.configs.length, 60);
});

test("stop records and write-once marker records parse strictly", () => {
  const schedule = pairedSchedule();
  const decision = evaluateExperimentCeilings({
    protocol: { ...screeningProtocol, providerCalls: "deny" },
    schedule,
    records: [],
    providerStartedAttemptIds: [],
  });
  const stop = buildExperimentStopRecord({
    experimentId: "a".repeat(64),
    recordedAt: "2026-09-03T12:00:00.000Z",
    decision,
    limits,
  });
  assert.deepEqual(parseExperimentStopRecord(JSON.parse(JSON.stringify(stop))), stop);
  assert.throws(
    () => parseExperimentStopRecord({ ...stop, extra: true }),
    /unsupported field/,
  );

  assert.equal(attemptStartedFile("attempt-000001"), "state/attempt-000001.started.json");
  assert.equal(providerStartedFile("attempt-000001"), "state/attempt-000001.provider-started.json");
  assert.equal(parseExperimentAttemptStartedRecord({
    schemaVersion: 1,
    experimentId: "a".repeat(64),
    attemptId: "attempt-000001",
    startedAt: "2026-09-03T12:00:00.000Z",
  }).attemptId, "attempt-000001");
  assert.equal(parseExperimentProviderStartedRecord({
    schemaVersion: 1,
    experimentId: "a".repeat(64),
    attemptId: "attempt-000001",
    providerStartedAt: "2026-09-03T12:00:01.000Z",
  }).attemptId, "attempt-000001");
});

function pairedSchedule(blocks = 2): ExperimentScheduledAttempt[] {
  return buildExperimentSchedule({
    protocol: screeningProtocol,
    cases: Array.from({ length: blocks }, (_, index) => ({
      caseName: `development/case-${String(index + 1).padStart(8, "0")}`,
      corpus: "development" as const,
      expectedBugCount: 1,
    })),
    repeats: 1,
    configs: [
      { name: "control", runner: "claude" },
      { name: "treatment", runner: "claude" },
    ],
  });
}

function completedRecord(attempt: ExperimentScheduledAttempt, duration: number, cost: number): RunRecord {
  return {
    schemaVersion: 1,
    attemptId: attempt.id,
    caseName: attempt.caseName,
    caseCorpus: attempt.corpus,
    caseKind: "seeded",
    configName: attempt.configName,
    repeat: attempt.repeat,
    runner: attempt.runner,
    startedAt: "2026-09-03T12:00:00.000Z",
    finishedAt: "2026-09-03T12:00:00.100Z",
    attemptDurationMs: duration,
    outcome: {
      status: "completed",
      result: {
        engine: attempt.runner,
        status: "clean",
        modelConfig: attempt.configName,
        findings: [],
        usage: { ...mockUsage(), provider: "anthropic", costUsd: cost },
        durationMs: duration,
      },
    },
  };
}

function failedRecord(attempt: ExperimentScheduledAttempt, duration: number): RunRecord {
  return {
    schemaVersion: 1,
    attemptId: attempt.id,
    caseName: attempt.caseName,
    caseCorpus: attempt.corpus,
    caseKind: "seeded",
    configName: attempt.configName,
    repeat: attempt.repeat,
    runner: attempt.runner,
    startedAt: "2026-09-03T12:00:00.000Z",
    finishedAt: "2026-09-03T12:00:00.100Z",
    attemptDurationMs: duration,
    outcome: {
      status: "failed",
      failureKind: "configuration",
      message: "preflight failed",
      durationMs: duration,
    },
  };
}

function buildManifest(): ExperimentManifest {
  const schedule = pairedSchedule();
  return buildExperimentManifest({
    createdAt: "2026-09-03T12:00:00.000Z",
    repositoryCommit: "1".repeat(40),
    protocol: screeningProtocol,
    hashes: {
      repositorySha256: "1".repeat(64),
      corpusSha256: "2".repeat(64),
      promptSha256: "3".repeat(64),
      methodSha256: "4".repeat(64),
      schemaSha256: "5".repeat(64),
      profileSha256: "6".repeat(64),
      judgeSha256: "7".repeat(64),
      matrixManifestSha256: "9".repeat(64),
      matrixConfigSha256: "c".repeat(64),
      peregrineConfigSha256: "d".repeat(64),
      configurationSha256: "8".repeat(64),
    },
    models: [
      {
        configName: "treatment",
        runner: "claude",
        effectiveConfigSha256: "a".repeat(64),
        breadthModel: "claude-breadth",
        breadthEffort: "high",
        investigationModel: "claude-investigation",
        investigationEffort: "high",
      },
      {
        configName: "control",
        runner: "claude",
        effectiveConfigSha256: "b".repeat(64),
        breadthModel: "claude-breadth",
        breadthEffort: "high",
        investigationModel: "claude-investigation",
        investigationEffort: "high",
      },
    ],
    runtime: {
      observedAt: "2026-09-03T11:59:59.000Z",
      nodeVersion: "v22.22.1",
      platform: "darwin",
      arch: "arm64",
      cliVersions: [
        { runner: "claude", status: "observed", version: "2.0.0" },
        { runner: "codex", status: "observed", version: "1.0.0" },
      ],
      providerAvailability: [
        { runner: "claude", status: "denied" },
        { runner: "codex", status: "denied" },
      ],
    },
    schedule,
  });
}

function blockIdentity(attempt: ExperimentScheduledAttempt): string {
  return `${attempt.caseName}:${attempt.repeat}:${attempt.variant}`;
}
