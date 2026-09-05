import assert from "node:assert/strict";
import { basename, join, resolve } from "node:path";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { materializeCase, type LeakagePolicy, type MaterializedCase } from "../eval/case-isolation.js";
import { canonicalJsonSha256 } from "../eval/experiment.js";
import { createMethodologyAssetPreparer, readMethodologyAssetManifest } from "../eval/methodology-assets.js";
import {
  readMethodologyAttemptLifecycleTerminal,
  readMethodologyAttemptStart,
  readMethodologyDispatchStarted,
  runMethodologyAttemptLifecycle,
} from "../eval/methodology-attempt-lifecycle.js";
import {
  createMethodologyInvocationRecorder,
  readMethodologyInvocation,
  registerMethodologyInvocations,
} from "../eval/methodology-invocations.js";
import {
  buildMethodologySchedule,
  methodologyArmConfigIdentitySha256,
  type MethodologyArmId,
  type MethodologyDesign,
} from "../eval/methodology-schedule.js";
import { readMethodologyAttemptTerminal } from "../eval/methodology-terminal.js";
import { loadCaseSpec } from "../eval/run-matrix.js";
import type { PeregrineConfig, ProviderExec, ReviewContext } from "../src/types.js";

const CASE_NAME = "development/case-00000001";
const CASE_DIR = resolve("eval/cases/structural-smoke/case-00000001");
const REVIEW_OUTPUT = JSON.stringify({ status: "completed", limitations: [], findings: [] });
const DISCOVERY_OUTPUT = JSON.stringify({ status: "completed", limitations: [], candidates: [] });
const POLICY: LeakagePolicy = {
  caseId: "case-00000001",
  corpus: "structural-smoke",
  forbiddenTerms: ["answer canary absent from all inputs"],
  documentedMarkerHashes: new Set(),
};

test("start, dispatch, existing review terminal, and lifecycle terminal are authenticated", async () => {
  const fixture = await setup("A");
  try {
    let preparationSawStart = false;
    const receipt = await runMethodologyAttemptLifecycle({
      ...fixture.lifecycleInput,
      prepare: () => {
        preparationSawStart = existsSync(join(fixture.root, `${fixture.attemptId}.methodology-start.json`));
        return fixture.preparation;
      },
    });
    assert.equal(preparationSawStart, true);
    assert.equal(receipt.status, "review-terminal");
    assert.equal(receipt.dispatchReceipts.length, 1);
    const start = readMethodologyAttemptStart(
      fixture.root, fixture.registrationSha256, fixture.attemptId, receipt.startSha256,
    );
    const dispatch = readMethodologyDispatchStarted(
      fixture.root, fixture.registrationSha256, fixture.attemptId, 1,
      receipt.dispatchReceipts[0]!.dispatchSha256,
    );
    assert.equal(dispatch.startSha256, start.recordSha256);
    assert.equal(dispatch.providerContact, "not-established-by-dispatch-start");
    const lifecycle = readMethodologyAttemptLifecycleTerminal(
      fixture.root, fixture.registrationSha256, fixture.attemptId, receipt.lifecycleTerminalSha256,
    );
    assert.equal(lifecycle.providerContact, "not-established-by-lifecycle");
    assert.equal(readMethodologyAttemptTerminal(
      fixture.root, fixture.registrationSha256, fixture.attemptId, lifecycle.reviewTerminalSha256!,
    ).outcome.status, "completed");
    await assert.rejects(
      () => runMethodologyAttemptLifecycle({ ...fixture.lifecycleInput, prepare: () => fixture.preparation }),
      /EEXIST|file exists/i,
    );
    rewriteLifecycleDispatches(fixture.root, fixture.attemptId, []);
    const changed = JSON.parse(readFileSync(
      join(fixture.root, `${fixture.attemptId}.methodology-lifecycle-terminal.json`), "utf8"));
    assert.throws(
      () => readMethodologyAttemptLifecycleTerminal(
        fixture.root, fixture.registrationSha256, fixture.attemptId, changed.recordSha256,
      ),
      /dispatches do not match terminal invocation intents/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("a completed two-stage lifecycle cannot omit either authenticated dispatch", async () => {
  const fixture = await setup("C");
  try {
    const receipt = await runMethodologyAttemptLifecycle({
      ...fixture.lifecycleInput,
      prepare: () => fixture.preparation,
    });
    assert.equal(receipt.status, "review-terminal");
    assert.equal(receipt.dispatchReceipts.length, 2);
    rewriteLifecycleDispatches(fixture.root, fixture.attemptId, receipt.dispatchReceipts.slice(0, 1));
    const changed = JSON.parse(readFileSync(
      join(fixture.root, `${fixture.attemptId}.methodology-lifecycle-terminal.json`), "utf8"));
    assert.throws(
      () => readMethodologyAttemptLifecycleTerminal(
        fixture.root, fixture.registrationSha256, fixture.attemptId, changed.recordSha256,
      ),
      /dispatches do not match terminal invocation intents/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("a secret-bearing preparation failure is retained safely as zero-dispatch preflight failure", async () => {
  const fixture = await setup("A");
  try {
    const receipt = await runMethodologyAttemptLifecycle({
      ...fixture.lifecycleInput,
      prepare: () => { throw new Error("token=Credential123456789"); },
    });
    assert.equal(receipt.status, "preflight-failed");
    assert.deepEqual(receipt.dispatchReceipts, []);
    assert.equal(receipt.reviewTerminalSha256, null);
    const terminal = readMethodologyAttemptLifecycleTerminal(
      fixture.root, fixture.registrationSha256, fixture.attemptId, receipt.lifecycleTerminalSha256,
    );
    assert.equal(terminal.failure?.kind, "unknown");
    assert.match(terminal.failure?.message ?? "", /omitted because it matched a secret pattern/);
    assert.throws(
      () => readMethodologyAttemptLifecycleTerminal(
        fixture.root, "f".repeat(64), fixture.attemptId, receipt.lifecycleTerminalSha256,
      ),
      /registration digest mismatch|terminal identity is invalid/,
    );
    const path = join(fixture.root, `${fixture.attemptId}.methodology-lifecycle-terminal.json`);
    const tampered = JSON.parse(readFileSync(path, "utf8"));
    tampered.finishedAt = "2026-09-05T00:00:00.000Z";
    writeFileSync(path, JSON.stringify(tampered));
    assert.throws(
      () => readMethodologyAttemptLifecycleTerminal(
        fixture.root, fixture.registrationSha256, fixture.attemptId, receipt.lifecycleTerminalSha256,
      ),
      /digest mismatch|precedes attempt start/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("invalid initial assets become a zero-dispatch preflight record", async () => {
  const fixture = await setup("A");
  try {
    const invalidPreparation = {
      ...fixture.preparation,
      assetManifest: { ...fixture.preparation.assetManifest, treeSha256: "f".repeat(64) },
    };
    const receipt = await runMethodologyAttemptLifecycle({
      ...fixture.lifecycleInput,
      prepare: () => invalidPreparation,
    });
    assert.equal(receipt.status, "preflight-failed");
    assert.deepEqual(receipt.dispatchReceipts, []);
    const terminal = readMethodologyAttemptLifecycleTerminal(
      fixture.root, fixture.registrationSha256, fixture.attemptId, receipt.lifecycleTerminalSha256,
    );
    assert.match(terminal.failure?.message ?? "", /manifest|asset/i);
  } finally {
    fixture.cleanup();
  }
});

test("a two-stage provider failure remains an existing failed review terminal with both dispatches", async () => {
  const fixture = await setup("C", ({ schema, call }) => {
    if (call === 2) return { stdout: "", stderr: "mock provider failure", code: 7, timedOut: false };
    return { stdout: "", stderr: "", code: 0, timedOut: false, output: schema === "methodology-discovery.schema.json"
      ? DISCOVERY_OUTPUT : REVIEW_OUTPUT };
  });
  try {
    const receipt = await runMethodologyAttemptLifecycle({
      ...fixture.lifecycleInput,
      prepare: () => fixture.preparation,
    });
    assert.equal(receipt.status, "review-terminal");
    assert.equal(receipt.dispatchReceipts.length, 2);
    const terminal = readMethodologyAttemptTerminal(
      fixture.root, fixture.registrationSha256, fixture.attemptId, receipt.reviewTerminalSha256!,
    );
    assert.equal(terminal.outcome.status, "failed");
    assert.deepEqual(terminal.stages.map((stage) => stage.telemetry.completed), [true, false]);
    readMethodologyAttemptLifecycleTerminal(
      fixture.root, fixture.registrationSha256, fixture.attemptId, receipt.lifecycleTerminalSha256,
    );
  } finally {
    fixture.cleanup();
  }
});

test("a stage-one post-intent failure retains the intent without inventing dispatch evidence", async () => {
  const fixture = await setup("A");
  const recordInvocation = fixture.lifecycleInput.beforeInvocation;
  try {
    const receipt = await runMethodologyAttemptLifecycle({
      ...fixture.lifecycleInput,
      prepare: () => fixture.preparation,
      beforeInvocation: async (input) => {
        const invocationSha256 = await recordInvocation(input);
        writeFileSync(join(
          fixture.preparation.context.evaluationIsolation!.providerAssetsRoot,
          input.compiled.schemaPath,
        ), "{}\n");
        return invocationSha256;
      },
    });
    assert.equal(receipt.status, "review-terminal");
    assert.equal(receipt.dispatchReceipts.length, 0);
    assert.equal(fixture.providerCalls(), 0);
    const terminal = readMethodologyAttemptTerminal(
      fixture.root, fixture.registrationSha256, fixture.attemptId, receipt.reviewTerminalSha256!,
    );
    assert.equal(terminal.outcome.status, "failed");
    assert.equal(terminal.intentReceipts.length, 1);
    assert.equal(terminal.stages.length, 0);
    const intent = readMethodologyInvocation(
      fixture.root,
      fixture.registrationSha256,
      fixture.attemptId,
      1,
      terminal.intentReceipts[0]!.invocationSha256,
    );
    assert.equal(intent.input.previousOutput, null);
    assert.doesNotThrow(() => readMethodologyAttemptLifecycleTerminal(
      fixture.root, fixture.registrationSha256, fixture.attemptId, receipt.lifecycleTerminalSha256,
    ));
  } finally {
    fixture.cleanup();
  }
});

test("a stage-two post-intent failure preserves stage one and the exact undispatched handoff", async () => {
  const fixture = await setup("C");
  const recordInvocation = fixture.lifecycleInput.beforeInvocation;
  try {
    const receipt = await runMethodologyAttemptLifecycle({
      ...fixture.lifecycleInput,
      prepare: () => fixture.preparation,
      beforeInvocation: async (input) => {
        const invocationSha256 = await recordInvocation(input);
        if (input.stageIndex === 2) {
          writeFileSync(join(
            fixture.preparation.context.evaluationIsolation!.providerAssetsRoot,
            input.compiled.schemaPath,
          ), "{}\n");
        }
        return invocationSha256;
      },
    });
    assert.equal(receipt.status, "review-terminal");
    assert.deepEqual(receipt.dispatchReceipts.map((item) => item.stageIndex), [1]);
    assert.equal(fixture.providerCalls(), 1);
    const terminal = readMethodologyAttemptTerminal(
      fixture.root, fixture.registrationSha256, fixture.attemptId, receipt.reviewTerminalSha256!,
    );
    assert.equal(terminal.outcome.status, "failed");
    assert.equal(terminal.intentReceipts.length, 2);
    assert.equal(terminal.stages.length, 1);
    assert.equal(terminal.stages[0]!.rawOutput, DISCOVERY_OUTPUT);
    const secondIntent = readMethodologyInvocation(
      fixture.root,
      fixture.registrationSha256,
      fixture.attemptId,
      2,
      terminal.intentReceipts[1]!.invocationSha256,
    );
    assert.equal(secondIntent.input.previousOutput, DISCOVERY_OUTPUT);
    assert.doesNotThrow(() => readMethodologyAttemptLifecycleTerminal(
      fixture.root, fixture.registrationSha256, fixture.attemptId, receipt.lifecycleTerminalSha256,
    ));
  } finally {
    fixture.cleanup();
  }
});

test("an unexpected persistence failure after dispatch is interrupted, never preflight-failed", async () => {
  const fixture = await setup("A");
  try {
    writeFileSync(join(fixture.root, `${fixture.attemptId}.methodology-terminal.json`), "occupied\n");
    const receipt = await runMethodologyAttemptLifecycle({
      ...fixture.lifecycleInput,
      prepare: () => fixture.preparation,
    });
    assert.equal(receipt.status, "interrupted");
    assert.equal(receipt.dispatchReceipts.length, 1);
    assert.equal(receipt.reviewTerminalSha256, null);
    const terminal = readMethodologyAttemptLifecycleTerminal(
      fixture.root, fixture.registrationSha256, fixture.attemptId, receipt.lifecycleTerminalSha256,
    );
    assert.equal(terminal.status, "interrupted");
    assert.match(terminal.failure?.message ?? "", /EEXIST|file exists/i);
  } finally {
    fixture.cleanup();
  }
});

async function setup(
  armId: MethodologyArmId,
  response?: (input: { schema: string; call: number }) =>
    Awaited<ReturnType<ProviderExec>> & { output?: string },
) {
  const root = mkdtempSync(join(tmpdir(), "peregrine-methodology-lifecycle-"));
  const schedule = scheduleForOneCase();
  const spec = loadCaseSpec(CASE_DIR);
  const materialized = await Promise.all((["A", "B", "C", "D"] as const).map(async (candidate) => ({
    armId: candidate,
    value: await materializeCase(CASE_DIR, spec, POLICY, {
      assetPreparer: createMethodologyAssetPreparer(candidate),
    }),
  })));
  const selected = materialized.find((item) => item.armId === armId)!.value;
  const scope = {
    baseRef: selected.baseRef,
    headRef: selected.headRef,
    diff: selected.diffText,
    taskSpecification: "Review this change for consequential correctness defects.",
    rawChangedPaths: ["src/load.ts"],
  };
  const registrationSha256 = registerMethodologyInvocations(root, {
    runId: `lifecycle-${armId.toLowerCase()}`,
    schedule,
    scopeSha256ByCase: { [CASE_NAME]: canonicalJsonSha256(scope) },
    assetsByArm: materialized.map(({ armId: candidate, value }) =>
      readMethodologyAssetManifest(value.evaluationIsolation.providerAssetsRoot, candidate)),
  });
  const outputs = new Map<string, string>();
  let calls = 0;
  const runProvider: ProviderExec = async (_command, args) => {
    calls++;
    const outputPath = argumentAfter(args, "--output-last-message");
    const schema = basename(argumentAfter(args, "--output-schema"));
    const result = response?.({ schema, call: calls }) ?? {
      stdout: "", stderr: "", code: 0, timedOut: false,
      output: schema === "methodology-discovery.schema.json" ? DISCOVERY_OUTPUT : REVIEW_OUTPUT,
    };
    if (result.output !== undefined) outputs.set(outputPath, result.output);
    const { output: _output, ...providerResult } = result;
    return providerResult;
  };
  const context: ReviewContext = {
    repoPath: selected.repoPath,
    diffPath: selected.diffPath,
    diffText: selected.diffText,
    baseRef: selected.baseRef,
    headRef: selected.headRef,
    config: JSON.parse(readFileSync(resolve("peregrine.config.json"), "utf8")) as PeregrineConfig,
    evaluationIsolation: {
      ...selected.evaluationIsolation,
      runProvider,
      readProviderOutput: (path) => outputs.get(path)!,
    },
  };
  const attemptId = schedule.attempts.find((attempt) => attempt.armId === armId)!.id;
  return {
    root,
    attemptId,
    registrationSha256,
    preparation: {
      assetManifest: readMethodologyAssetManifest(selected.evaluationIsolation.providerAssetsRoot, armId),
      rawScope: scope,
      ...(armId === "B" || armId === "D" ? { activatedLanes: ["contracts"] } : {}),
      leakagePolicy: POLICY,
      context,
    },
    lifecycleInput: {
      evidenceRoot: root,
      registrationSha256,
      attemptId,
      beforeInvocation: createMethodologyInvocationRecorder(root, registrationSha256),
    },
    providerCalls: () => calls,
    cleanup: () => {
      materialized.forEach((item) => item.value.cleanup());
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function scheduleForOneCase() {
  const withoutArms: Omit<MethodologyDesign, "arms"> = {
    schemaVersion: 1,
    protocol: "historical-methodology-v1",
    seed: 101,
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
    cases: [{ caseName: CASE_NAME, corpus: "development", expectedBugCount: 0 }],
  });
}

function argumentAfter(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1, `${flag} must be present`);
  return args[index + 1]!;
}

function rewriteLifecycleDispatches(
  root: string,
  attemptId: string,
  dispatchReceipts: Array<{ stageIndex: 1 | 2; dispatchSha256: string }>,
): void {
  const path = join(root, `${attemptId}.methodology-lifecycle-terminal.json`);
  const record = JSON.parse(readFileSync(path, "utf8"));
  record.dispatchReceipts = dispatchReceipts;
  const { recordSha256: _old, ...body } = record;
  record.recordSha256 = canonicalJsonSha256(body);
  writeFileSync(path, JSON.stringify(record));
}
