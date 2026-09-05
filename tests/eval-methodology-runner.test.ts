import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import test from "node:test";
import { materializeCase, type LeakagePolicy, type MaterializedCase } from "../eval/case-isolation.js";
import { canonicalJsonSha256 } from "../eval/experiment.js";
import {
  createMethodologyAssetPreparer,
  readMethodologyAssetManifest,
  type MethodologyAssetManifest,
} from "../eval/methodology-assets.js";
import {
  createMethodologyInvocationRecorder,
  readMethodologyInvocation,
  registerMethodologyInvocations,
} from "../eval/methodology-invocations.js";
import { runMethodologyAttempt, type MethodologyAttemptResult } from "../eval/methodology-runner.js";
import {
  readMethodologyAttemptTerminal,
  writeMethodologyAttemptTerminal,
} from "../eval/methodology-terminal.js";
import {
  buildMethodologySchedule,
  methodologyArmConfigIdentitySha256,
  type MethodologyArmId,
  type MethodologyDesign,
  type MethodologySchedule,
} from "../eval/methodology-schedule.js";
import { loadCaseSpec } from "../eval/run-matrix.js";
import { sha256 } from "../src/core/telemetry.js";
import type { PeregrineConfig, ProviderExec, ReviewContext } from "../src/types.js";

const CASE_NAME = "development/case-00000001";
const CASE_DIR = resolve("eval/cases/structural-smoke/case-00000001");
const REVIEW_OUTPUT = JSON.stringify({ status: "completed", limitations: [], findings: [] });
const DISCOVERY_OUTPUT = JSON.stringify({
  status: "completed",
  limitations: [],
  candidates: [{
    file: "src/load.ts",
    startLine: 5,
    endLine: 8,
    hypothesis: "The new error boundary may change behavior.",
    evidenceNeeded: "Trace callers that inspect the original error.",
  }],
});
const BREADTH_OUTPUT = JSON.stringify({
  model: "gpt-5.6-sol",
  candidates: [],
  clear: [],
  escalations: [],
  coverage: { coveredFiles: ["src/load.ts"], unavailable: ["One caller could not be inspected."] },
});
const policy: LeakagePolicy = {
  caseId: "case-00000001",
  corpus: "structural-smoke",
  forbiddenTerms: ["answer canary absent from all inputs"],
  documentedMarkerHashes: new Set(),
};

interface FakeCall {
  args: string[];
  timeoutMs: number | undefined;
  stdin: string | undefined;
}

interface ArmSetup {
  armId: MethodologyArmId;
  materialized: MaterializedCase;
  manifest: MethodologyAssetManifest;
  scope: {
    baseRef: string;
    headRef: string;
    diff: string;
    taskSpecification: string;
    rawChangedPaths: string[];
  };
  context: ReviewContext;
  calls: FakeCall[];
  outputs: Map<string, string>;
}

test("all four arms execute six mocked Codex dispatches with Sol-high arguments and authenticated input records", async () => {
  const schedule = scheduleForOneCase();
  const setups = await Promise.all((["A", "B", "C", "D"] as const).map(setupArm));
  const ledger = mkdtempSync(join(tmpdir(), "peregrine-methodology-ledger-"));
  try {
    const registrationSha256 = registerMethodologyInvocations(ledger, {
      runId: "runner-four-arm-test",
      schedule,
      scopeSha256ByCase: { [CASE_NAME]: canonicalJsonSha256(setups[0]!.scope) },
      assetsByArm: setups.map((setup) => setup.manifest),
    });
    const recorder = createMethodologyInvocationRecorder(ledger, registrationSha256);
    const results: MethodologyAttemptResult[] = [];
    for (const setup of setups) {
      results.push(await run(setup, schedule, recorder));
    }

    assert.equal(setups.reduce((total, setup) => total + setup.calls.length, 0), 6);
    assert.deepEqual(results.map((result) => result.stages.length), [1, 1, 2, 2]);
    assert.ok(results.every((result) => result.outcome.status === "completed"));
    assert.ok(results.every((result) => result.scope.status === "unverified"));
    assert.ok(results.every((result) => !("clean" in result) && !("findings" in result)));

    const forgedFailure = structuredClone(results.find((result) => result.attempt.armId === "A")!);
    forgedFailure.outcome = { status: "failed", failureKind: "provider", message: "Invented failure." };
    assert.throws(() => writeMethodologyAttemptTerminal(ledger, registrationSha256, forgedFailure),
      /cannot relabel completed stages as failed/);

    const completedWithFailedStage = structuredClone(results.find((result) => result.attempt.armId === "A")!);
    completedWithFailedStage.stages[0]!.telemetry.completed = false;
    assert.throws(
      () => writeMethodologyAttemptTerminal(ledger, registrationSha256, completedWithFailedStage),
      /completion lacks completed stages/,
    );
    const changedHandoff = structuredClone(results.find((result) => result.attempt.armId === "C")!);
    changedHandoff.stages[0]!.rawOutput = JSON.stringify({
      status: "completed", limitations: [], candidates: [],
    });
    changedHandoff.stages[0]!.rawOutputSha256 = sha256(changedHandoff.stages[0]!.rawOutput);
    assert.throws(
      () => writeMethodologyAttemptTerminal(ledger, registrationSha256, changedHandoff),
      /handoff differs from actual first-stage output/,
    );
    const hiddenLimitation = structuredClone(results.find((result) => result.attempt.armId === "D")!);
    hiddenLimitation.scope.modelLimitations = [];
    assert.throws(
      () => writeMethodologyAttemptTerminal(ledger, registrationSha256, hiddenLimitation),
      /scope limitations differ from outputs/,
    );

    for (const [index, setup] of setups.entries()) {
      const result = results[index]!;
      const attempt = attemptFor(schedule, setup.armId);
      assert.equal(result.intentReceipts.length, attempt.expectedStages);
      for (const [stageOffset, receipt] of result.intentReceipts.entries()) {
        const stageIndex = (stageOffset + 1) as 1 | 2;
        const record = readMethodologyInvocation(
          ledger,
          registrationSha256,
          attempt.id,
          stageIndex,
          receipt.invocationSha256,
        );
        assert.equal(record.input.compiled.prompt, setup.calls[stageOffset]!.stdin);
        assert.equal(record.input.schemaText, readFileSync(
          join(setup.materialized.evaluationIsolation.providerAssetsRoot,
            ...record.input.compiled.schemaPath.split("/")),
          "utf8",
        ));
        assert.equal(record.input.model, "gpt-5.6-sol");
        assert.equal(record.input.effort, "high");
        assert.equal(result.stages[stageOffset]!.invocationSha256, receipt.invocationSha256);
        if (stageIndex === 2) {
          assert.equal(record.input.previousOutput, result.stages[0]!.rawOutput);
        } else {
          assert.equal(record.input.previousOutput, null);
        }
      }
      for (const call of setup.calls) {
        assert.ok(call.args.includes("--ephemeral"));
        assert.equal(argumentAfter(call.args, "--model"), "gpt-5.6-sol");
        assert.ok(call.args.includes("model_reasoning_effort=\"high\""));
      }
      const terminalSha256 = writeMethodologyAttemptTerminal(ledger, registrationSha256, result);
      assert.deepEqual(
        readMethodologyAttemptTerminal(ledger, registrationSha256, attempt.id, terminalSha256),
        result,
      );
    }
  } finally {
    setups.forEach((setup) => setup.materialized.cleanup());
    rmSync(ledger, { recursive: true, force: true });
  }
});

test("a second-stage provider failure retains the completed first stage and failed telemetry", async () => {
  const schedule = scheduleForOneCase();
  const setup = await setupArm("C");
  setup.context.evaluationIsolation!.runProvider = fakeProvider(setup, ({ outputPath, callNumber }) => {
    if (callNumber === 1) {
      setup.outputs.set(outputPath, DISCOVERY_OUTPUT);
      return { stdout: "", stderr: "", code: 0, timedOut: false };
    }
    return { stdout: "", stderr: "provider unavailable", code: 7, timedOut: false };
  });
  try {
    const result = await run(setup, schedule, syntheticReceipt);
    assert.deepEqual(result.intentReceipts.map((receipt) => receipt.stageIndex), [1, 2]);
    assert.equal(result.outcome.status, "failed");
    if (result.outcome.status === "failed") assert.equal(result.outcome.failureKind, "provider");
    assert.equal(result.stages.length, 2);
    assert.equal(result.stages[0]!.telemetry.completed, true);
    assert.equal(result.stages[1]!.telemetry.completed, false);
    assert.equal(result.stages[1]!.rawOutput, null);
    assert.equal(result.stages[1]!.rawOutputSha256, null);
  } finally {
    setup.materialized.cleanup();
  }
});

test("callback latency consumes the total deadline and preserves the sealed intent without provider work", async () => {
  const schedule = scheduleForOneCase();
  const setup = await setupArm("A");
  let clock = 1_000;
  let providerCalls = 0;
  setup.context.evaluationIsolation!.runProvider = async () => {
    providerCalls++;
    return { stdout: "", stderr: "", code: 0, timedOut: false };
  };
  try {
    const result = await run(setup, schedule, () => {
      clock += schedule.design.totalDeadlineMs + 1;
      return "a".repeat(64);
    }, () => clock);
    assert.equal(result.outcome.status, "failed");
    if (result.outcome.status === "failed") assert.equal(result.outcome.failureKind, "timeout");
    assert.equal(providerCalls, 0);
    assert.equal(result.stages.length, 0);
    assert.deepEqual(result.intentReceipts, [{ stageIndex: 1, invocationSha256: "a".repeat(64) }]);
  } finally {
    setup.materialized.cleanup();
  }
});

test("malformed discovery and review outputs fail closed while retaining non-secret evidence", async () => {
  for (const armId of ["A", "C"] as const) {
    const schedule = scheduleForOneCase();
    const setup = await setupArm(armId);
    setup.context.evaluationIsolation!.runProvider = fakeProvider(setup, ({ outputPath }) => {
      setup.outputs.set(outputPath, "{not valid JSON");
      return { stdout: "", stderr: "", code: 0, timedOut: false };
    });
    try {
      const result = await run(setup, schedule, syntheticReceipt);
      assert.equal(result.outcome.status, "failed");
      if (result.outcome.status === "failed") assert.equal(result.outcome.failureKind, "parse");
      assert.equal(result.stages.length, 1);
      assert.equal(result.stages[0]!.telemetry.completed, false);
      assert.equal(result.stages[0]!.rawOutput, "{not valid JSON");
      assert.match(result.stages[0]!.rawOutputSha256!, /^[a-f0-9]{64}$/);
    } finally {
      setup.materialized.cleanup();
    }
  }
});

test("containment cleanup failures and secret-unsafe parse output remain explicit", async () => {
  const schedule = scheduleForOneCase();
  const cleanup = await setupArm("A");
  cleanup.context.evaluationIsolation!.runProvider = fakeProvider(cleanup, () => ({
    stdout: "",
    stderr: "",
    code: 0,
    timedOut: false,
    cleanupErrors: ["container remained active"],
  }));
  try {
    const result = await run(cleanup, schedule, syntheticReceipt);
    assert.equal(result.outcome.status, "failed");
    if (result.outcome.status === "failed") assert.equal(result.outcome.failureKind, "configuration");
    assert.equal(result.stages[0]!.containmentCleanupFailed, true);
    assert.equal(result.stages[0]!.rawOutput, null);
  } finally {
    cleanup.materialized.cleanup();
  }

  const secret = await setupArm("A");
  secret.context.evaluationIsolation!.runProvider = fakeProvider(secret, ({ outputPath }) => {
    secret.outputs.set(outputPath, JSON.stringify({
      status: "unable-to-complete",
      limitations: ["credential sk-abcdefghijklmnopqrstuvwxyz0123456789 was visible"],
      findings: [],
    }));
    return { stdout: "", stderr: "", code: 0, timedOut: false };
  });
  try {
    const result = await run(secret, schedule, syntheticReceipt);
    assert.equal(result.outcome.status, "failed");
    assert.equal(result.stages[0]!.rawOutput, null);
    assert.equal(result.stages[0]!.rawOutputSha256, null);
    assert.equal(result.stages[0]!.rawOutputOmittedReason, "secret-unsafe");
    assert.doesNotMatch(result.outcome.status === "failed" ? result.outcome.message : "", /sk-/);
  } finally {
    secret.materialized.cleanup();
  }
});

test("asset drift after discovery blocks the second invocation", async () => {
  const schedule = scheduleForOneCase();
  const setup = await setupArm("C");
  setup.context.evaluationIsolation!.runProvider = fakeProvider(setup, ({ outputPath }) => {
    setup.outputs.set(outputPath, DISCOVERY_OUTPUT);
    writeFileSync(
      join(setup.materialized.evaluationIsolation.providerAssetsRoot, "schemas/methodology-review.schema.json"),
      "{}\n",
    );
    return { stdout: "", stderr: "", code: 0, timedOut: false };
  });
  try {
    const result = await run(setup, schedule, syntheticReceipt);
    assert.equal(result.outcome.status, "failed");
    if (result.outcome.status === "failed") assert.equal(result.outcome.failureKind, "configuration");
    assert.equal(setup.calls.length, 1);
    assert.equal(result.stages.length, 1);
    assert.deepEqual(result.intentReceipts.map((receipt) => receipt.stageIndex), [1]);
  } finally {
    setup.materialized.cleanup();
  }
});

test("callback failure, malformed receipt, missing containment hooks, and scope mismatch stop before dispatch", async () => {
  const schedule = scheduleForOneCase();
  for (const callback of [
    () => { throw new Error("ledger unavailable"); },
    () => "not-a-digest",
  ]) {
    const setup = await setupArm("A");
    try {
      const result = await run(setup, schedule, callback);
      assert.equal(result.outcome.status, "failed");
      if (result.outcome.status === "failed") assert.equal(result.outcome.failureKind, "configuration");
      assert.equal(setup.calls.length, 0);
      assert.equal(result.intentReceipts.length, 0);
    } finally {
      setup.materialized.cleanup();
    }
  }

  const missing = await setupArm("A");
  try {
    delete missing.context.evaluationIsolation!.runProvider;
    await assert.rejects(() => run(missing, schedule, syntheticReceipt), /requires runProvider/);
  } finally {
    missing.materialized.cleanup();
  }

  const mismatch = await setupArm("A");
  try {
    await assert.rejects(
      () => runMethodologyAttempt({
        schedule,
        attemptId: attemptFor(schedule, "A").id,
        assetManifest: mismatch.manifest,
        rawScope: { ...mismatch.scope, rawChangedPaths: ["src/unrelated.ts"] },
        leakagePolicy: policy,
        context: mismatch.context,
        beforeInvocation: syntheticReceipt,
      }),
      /changed paths do not match/,
    );
    assert.equal(mismatch.calls.length, 0);
  } finally {
    mismatch.materialized.cleanup();
  }
});

test("scope authentication ignores hostile ambient Git control variables", async () => {
  const schedule = scheduleForOneCase();
  const setup = await setupArm("A");
  const overrides = {
    GIT_DIR: join(tmpdir(), "not-the-materialized-git-dir"),
    GIT_WORK_TREE: join(tmpdir(), "not-the-materialized-worktree"),
    GIT_INDEX_FILE: join(tmpdir(), "not-the-materialized-index"),
    GIT_OBJECT_DIRECTORY: join(tmpdir(), "not-the-materialized-objects"),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: join(tmpdir(), "not-the-materialized-alternates"),
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.worktree",
    GIT_CONFIG_VALUE_0: join(tmpdir(), "injected-worktree"),
  };
  const original = new Map(Object.keys(overrides).map((name) => [name, process.env[name]]));
  try {
    Object.assign(process.env, overrides);
    const result = await run(setup, schedule, syntheticReceipt);
    assert.equal(result.outcome.status, "completed");
    assert.equal(setup.calls.length, 1);
  } finally {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    setup.materialized.cleanup();
  }
});

test("secret-bearing callback failures are sanitized and remain terminal-sealable", async () => {
  const schedule = scheduleForOneCase();
  const setup = await setupArm("A");
  const ledger = mkdtempSync(join(tmpdir(), "peregrine-methodology-secret-failure-"));
  const extraAssets = mkdtempSync(join(tmpdir(), "peregrine-methodology-extra-assets-"));
  try {
    const assetsByArm: MethodologyAssetManifest[] = [setup.manifest];
    for (const armId of ["B", "C", "D"] as const) {
      const target = join(extraAssets, armId);
      createMethodologyAssetPreparer(armId)(target, policy);
      assetsByArm.push(readMethodologyAssetManifest(target, armId));
    }
    const registrationSha256 = registerMethodologyInvocations(ledger, {
      runId: "secret-callback-failure",
      schedule,
      scopeSha256ByCase: { [CASE_NAME]: canonicalJsonSha256(setup.scope) },
      assetsByArm,
    });
    const result = await run(setup, schedule, () => {
      throw new Error("callback failed with sk-abcdefghijklmnopqrstuvwxyz0123456789");
    });
    assert.equal(result.outcome.status, "failed");
    if (result.outcome.status === "failed") {
      assert.equal(result.outcome.failureKind, "configuration");
      assert.equal(result.outcome.message, "methodology invocation sealing failed");
      assert.doesNotMatch(result.outcome.message, /sk-/);
    }
    assert.deepEqual(result.intentReceipts, []);
    const terminalSha256 = writeMethodologyAttemptTerminal(ledger, registrationSha256, result);
    assert.deepEqual(
      readMethodologyAttemptTerminal(
        ledger,
        registrationSha256,
        result.attempt.id,
        terminalSha256,
      ),
      result,
    );
  } finally {
    setup.materialized.cleanup();
    rmSync(ledger, { recursive: true, force: true });
    rmSync(extraAssets, { recursive: true, force: true });
  }
});

test("direct secret-bearing provider exceptions cannot leak through the failure result", async () => {
  const schedule = scheduleForOneCase();
  const setup = await setupArm("A");
  setup.context.evaluationIsolation!.runProvider = fakeProvider(setup, () => {
    throw new Error("provider failed with sk-abcdefghijklmnopqrstuvwxyz0123456789");
  });
  try {
    const result = await run(setup, schedule, syntheticReceipt);
    assert.equal(result.outcome.status, "failed");
    if (result.outcome.status === "failed") {
      assert.equal(result.outcome.failureKind, "unknown");
      assert.equal(result.outcome.message, "provider diagnostic omitted because it matched a secret pattern");
      assert.doesNotMatch(result.outcome.message, /sk-/);
    }
    assert.equal(result.stages.length, 0);
    assert.equal(result.intentReceipts.length, 1);
  } finally {
    setup.materialized.cleanup();
  }
});

async function setupArm(armId: MethodologyArmId): Promise<ArmSetup> {
  const spec = loadCaseSpec(CASE_DIR);
  const materialized = await materializeCase(CASE_DIR, spec, policy, {
    assetPreparer: createMethodologyAssetPreparer(armId),
  });
  const calls: FakeCall[] = [];
  const outputs = new Map<string, string>();
  const scope = {
    baseRef: materialized.baseRef,
    headRef: materialized.headRef,
    diff: materialized.diffText,
    taskSpecification: "Review the change for consequential correctness defects.",
    rawChangedPaths: ["src/load.ts"],
  };
  const context: ReviewContext = {
    repoPath: materialized.repoPath,
    diffPath: materialized.diffPath,
    diffText: materialized.diffText,
    baseRef: materialized.baseRef,
    headRef: materialized.headRef,
    config: config(),
    evaluationIsolation: {
      ...materialized.evaluationIsolation,
      runProvider: async () => ({ stdout: "", stderr: "", code: 0, timedOut: false }),
      readProviderOutput: (path) => outputs.get(path)!,
    },
  };
  const setup = {
    armId,
    materialized,
    manifest: readMethodologyAssetManifest(materialized.evaluationIsolation.providerAssetsRoot, armId),
    scope,
    context,
    calls,
    outputs,
  };
  context.evaluationIsolation!.runProvider = fakeProvider(setup, ({ outputPath, schemaName }) => {
    outputs.set(outputPath, schemaName === "methodology-discovery.schema.json"
      ? DISCOVERY_OUTPUT
      : schemaName === "breadth-result.schema.json" ? BREADTH_OUTPUT : REVIEW_OUTPUT);
    return { stdout: "", stderr: "", code: 0, timedOut: false };
  });
  return setup;
}

function fakeProvider(
  setup: Pick<ArmSetup, "calls" | "outputs">,
  respond: (input: { outputPath: string; schemaName: string; callNumber: number }) =>
    Awaited<ReturnType<ProviderExec>>,
): ProviderExec {
  return async (_cmd, args, options) => {
    setup.calls.push({ args: [...args], timeoutMs: options?.timeoutMs, stdin: options?.stdin });
    const outputPath = argumentAfter(args, "--output-last-message");
    const schemaName = basename(argumentAfter(args, "--output-schema"));
    return respond({ outputPath, schemaName, callNumber: setup.calls.length });
  };
}

function run(
  setup: ArmSetup,
  schedule: MethodologySchedule,
  beforeInvocation: (input: any) => string | Promise<string>,
  now?: () => number,
) {
  return runMethodologyAttempt({
    schedule,
    attemptId: attemptFor(schedule, setup.armId).id,
    assetManifest: setup.manifest,
    rawScope: setup.scope,
    activatedLanes: setup.armId === "B" || setup.armId === "D" ? ["contracts"] : undefined,
    leakagePolicy: policy,
    context: setup.context,
    beforeInvocation,
    ...(now ? { now } : {}),
  });
}

function syntheticReceipt(input: unknown): string {
  return canonicalJsonSha256(input);
}

function attemptFor(schedule: MethodologySchedule, armId: MethodologyArmId) {
  return schedule.attempts.find((attempt) => attempt.armId === armId)!;
}

function argumentAfter(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1, `${flag} must be present`);
  return args[index + 1]!;
}

function scheduleForOneCase(): MethodologySchedule {
  const withoutArms: Omit<MethodologyDesign, "arms"> = {
    schemaVersion: 1,
    protocol: "historical-methodology-v1",
    seed: 41,
    repeats: 1,
    callerConfig: {
      runner: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      identitySha256: "a".repeat(64),
    },
    totalDeadlineMs: 60_000,
    twoWorkerStageSplit: { discoveryDeadlineMs: 20_000, reviewerDeadlineMs: 40_000 },
  };
  return buildMethodologySchedule({
    design: {
      ...withoutArms,
      arms: (["A", "B", "C", "D"] as const).map((armId) => {
        const configName = `methodology-${armId.toLowerCase()}`;
        return {
          armId,
          configName,
          configIdentitySha256: methodologyArmConfigIdentitySha256({
            design: withoutArms,
            armId,
            configName,
          }),
        };
      }),
    },
    cases: [{ caseName: CASE_NAME, corpus: "development", expectedBugCount: 0 }],
  });
}

function config(): PeregrineConfig {
  return JSON.parse(readFileSync(resolve("peregrine.config.json"), "utf8")) as PeregrineConfig;
}
