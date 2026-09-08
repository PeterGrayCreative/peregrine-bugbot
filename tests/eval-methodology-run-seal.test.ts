import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import test, { after, before } from "node:test";
import { materializeCase, type LeakagePolicy } from "../eval/case-isolation.js";
import { canonicalJsonSha256 } from "../eval/experiment.js";
import {
  createMethodologyAssetPreparer,
  readMethodologyAssetManifest,
} from "../eval/methodology-assets.js";
import {
  createMethodologyInvocationRecorder,
  registerMethodologyInvocations,
} from "../eval/methodology-invocations.js";
import { runMethodologyAttempt } from "../eval/methodology-runner.js";
import {
  readMethodologyRunSeal,
  writeMethodologyRunSeal,
  type MethodologyTerminalReceipt,
} from "../eval/methodology-run-seal.js";
import {
  buildMethodologySchedule,
  methodologyArmConfigIdentitySha256,
  type MethodologyArmId,
  type MethodologyDesign,
} from "../eval/methodology-schedule.js";
import { writeMethodologyAttemptTerminal } from "../eval/methodology-terminal.js";
import { loadCaseSpec } from "../eval/run-matrix.js";
import type { PeregrineConfig, ProviderExec, ReviewContext } from "../src/types.js";

const CASE_NAME = "development/case-00000001";
const CASE_DIR = resolve("eval/cases/structural-smoke/case-00000001");
const REVIEW_OUTPUT = JSON.stringify({ status: "completed", limitations: [], findings: [] });
const DISCOVERY_OUTPUT = JSON.stringify({ status: "completed", limitations: [], candidates: [] });
const BREADTH_OUTPUT = JSON.stringify({
  model: "gpt-5.6-sol",
  candidates: [],
  clear: [],
  escalations: [],
  coverage: { coveredFiles: ["src/load.ts"], unavailable: [] },
});
const policy: LeakagePolicy = {
  caseId: "case-00000001",
  corpus: "structural-smoke",
  forbiddenTerms: ["answer canary absent from all inputs"],
  documentedMarkerHashes: new Set(),
};

interface EvidenceTemplate {
  root: string;
  registrationSha256: string;
  receipts: MethodologyTerminalReceipt[];
}

let firstTemplate: EvidenceTemplate;
let secondTemplate: EvidenceTemplate;

before(async () => {
  firstTemplate = await createEvidence("outer-seal-first");
  secondTemplate = await createEvidence("outer-seal-second");
});

after(() => {
  rmSync(firstTemplate.root, { recursive: true, force: true });
  rmSync(secondTemplate.root, { recursive: true, force: true });
});

test("seals exactly all four terminal attempts while preserving an execution failure", () => {
  const evidence = cloneEvidence(firstTemplate);
  try {
    const sealSha256 = writeMethodologyRunSeal(
      evidence.root,
      evidence.registrationSha256,
      evidence.receipts,
    );
    const seal = readMethodologyRunSeal(evidence.root, evidence.registrationSha256, sealSha256);
    assert.deepEqual(seal.attemptAccounting, {
      scheduled: 4,
      terminal: 4,
      executionCompleted: 3,
      executionFailed: 1,
    });
    assert.equal(seal.status, "terminal-complete");
    assert.equal(seal.claims.providerContact, "not-established-by-this-seal");
    assert.equal(seal.claims.efficacy, "not-evaluated-by-this-seal");
    assert.ok(seal.artifactBindings.some((binding) =>
      binding.path === "methodology-invocation-registration.json"));
    assert.equal(seal.artifactBindings.filter((binding) => binding.path.endsWith(".input.json")).length, 5);
    assert.equal(seal.artifactBindings.filter((binding) =>
      binding.path.endsWith(".methodology-terminal.json")).length, 4);
  } finally {
    evidence.cleanup();
  }
});

test("missing terminal receipts or terminal files cannot produce a complete seal", () => {
  const evidence = cloneEvidence(firstTemplate);
  try {
    assert.throws(
      () => writeMethodologyRunSeal(
        evidence.root,
        evidence.registrationSha256,
        evidence.receipts.slice(0, -1),
      ),
      /exactly one terminal receipt per scheduled attempt/,
    );
    const missing = evidence.receipts.at(-1)!;
    rmSync(join(evidence.root, `${missing.attemptId}.methodology-terminal.json`));
    assert.throws(
      () => writeMethodologyRunSeal(evidence.root, evidence.registrationSha256, evidence.receipts),
      /ENOENT|no such file/i,
    );
  } finally {
    evidence.cleanup();
  }
});

test("duplicate identities and mismatched caller-held terminal receipts reject", () => {
  const evidence = cloneEvidence(firstTemplate);
  try {
    const duplicate = structuredClone(evidence.receipts);
    duplicate[1] = structuredClone(duplicate[0]!);
    assert.throws(
      () => writeMethodologyRunSeal(evidence.root, evidence.registrationSha256, duplicate),
      /duplicate attempt/,
    );
    const mismatched = structuredClone(evidence.receipts);
    mismatched[0]!.terminalSha256 = "f".repeat(64);
    assert.throws(
      () => writeMethodologyRunSeal(evidence.root, evidence.registrationSha256, mismatched),
      /terminal digest mismatch/,
    );
  } finally {
    evidence.cleanup();
  }
});

test("rewriting a seal body and its local hash cannot replace the caller-held seal", () => {
  const evidence = cloneEvidence(firstTemplate);
  try {
    const originalSha256 = writeMethodologyRunSeal(
      evidence.root,
      evidence.registrationSha256,
      evidence.receipts,
    );
    const path = join(evidence.root, "methodology-run-terminal-seal.json");
    const changed = JSON.parse(readFileSync(path, "utf8"));
    changed.attemptAccounting.executionCompleted--;
    changed.attemptAccounting.executionFailed++;
    const { recordSha256: _old, ...body } = changed;
    changed.recordSha256 = canonicalJsonSha256(body);
    writeFileSync(path, `${JSON.stringify(changed, null, 2)}\n`);
    assert.throws(
      () => readMethodologyRunSeal(evidence.root, evidence.registrationSha256, originalSha256),
      /seal digest mismatch/,
    );
    assert.throws(
      () => readMethodologyRunSeal(evidence.root, evidence.registrationSha256, changed.recordSha256),
      /does not match authenticated terminal evidence/,
    );
  } finally {
    evidence.cleanup();
  }
});

test("raw-byte changes to an otherwise valid intent invalidate the outer seal", () => {
  const evidence = cloneEvidence(firstTemplate);
  try {
    const sealSha256 = writeMethodologyRunSeal(
      evidence.root,
      evidence.registrationSha256,
      evidence.receipts,
    );
    const intent = `${evidence.receipts[0]!.attemptId}.stage-1.input.json`;
    const path = join(evidence.root, intent);
    writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from("\n")]));
    assert.throws(
      () => readMethodologyRunSeal(evidence.root, evidence.registrationSha256, sealSha256),
      /does not match authenticated terminal evidence/,
    );
  } finally {
    evidence.cleanup();
  }
});

test("wrong registrations and cross-run terminal receipts reject", () => {
  const evidence = cloneEvidence(firstTemplate);
  try {
    assert.throws(
      () => writeMethodologyRunSeal(evidence.root, "f".repeat(64), evidence.receipts),
      /registration digest mismatch/,
    );
    const crossRun = structuredClone(evidence.receipts);
    crossRun[0]!.terminalSha256 = secondTemplate.receipts[0]!.terminalSha256;
    assert.throws(
      () => writeMethodologyRunSeal(evidence.root, evidence.registrationSha256, crossRun),
      /terminal digest mismatch/,
    );
  } finally {
    evidence.cleanup();
  }
});

test("an orphaned invocation-intent artifact blocks terminal-complete sealing", () => {
  const evidence = cloneEvidence(firstTemplate);
  try {
    const source = readFileSync(join(evidence.root,
      `${evidence.receipts[0]!.attemptId}.stage-1.input.json`));
    writeFileSync(join(evidence.root, "attempt-999999.stage-1.input.json"), source);
    assert.throws(
      () => writeMethodologyRunSeal(evidence.root, evidence.registrationSha256, evidence.receipts),
      /orphaned, missing, or unexpected invocation intent/,
    );
    rmSync(join(evidence.root, "attempt-999999.stage-1.input.json"));
    mkdirSync(join(evidence.root, "hidden"));
    writeFileSync(join(evidence.root, "hidden", "attempt-999999.stage-1.input.json"), source);
    assert.throws(
      () => writeMethodologyRunSeal(evidence.root, evidence.registrationSha256, evidence.receipts),
      /orphaned, missing, or unexpected invocation intent/,
    );
  } finally {
    evidence.cleanup();
  }
});

test("a symlinked evidence root cannot be used to read an otherwise valid seal", () => {
  const evidence = cloneEvidence(firstTemplate);
  const aliasParent = mkdtempSync(join(tmpdir(), "peregrine-methodology-run-seal-alias-"));
  try {
    const sealSha256 = writeMethodologyRunSeal(
      evidence.root,
      evidence.registrationSha256,
      evidence.receipts,
    );
    const alias = join(aliasParent, "evidence-alias");
    symlinkSync(evidence.root, alias, "dir");
    assert.throws(
      () => readMethodologyRunSeal(alias, evidence.registrationSha256, sealSha256),
      /root must be a real non-symlink directory/,
    );
  } finally {
    evidence.cleanup();
    rmSync(aliasParent, { recursive: true, force: true });
  }
});

async function createEvidence(runId: string): Promise<EvidenceTemplate> {
  const root = mkdtempSync(join(tmpdir(), "peregrine-methodology-run-seal-template-"));
  const schedule = scheduleForOneCase();
  const spec = loadCaseSpec(CASE_DIR);
  const materialized = [];
  try {
    for (const armId of ["A", "B", "C", "D"] as const) {
      materialized.push({
        armId,
        value: await materializeCase(CASE_DIR, spec, policy, {
          assetPreparer: createMethodologyAssetPreparer(armId),
        }),
      });
    }
    const first = materialized[0]!.value;
    const scope = {
      baseRef: first.baseRef,
      headRef: first.headRef,
      diff: first.diffText,
      taskSpecification: "Review the change for consequential correctness defects.",
      rawChangedPaths: ["src/load.ts"],
    };
    const registrationSha256 = registerMethodologyInvocations(root, {
      runId,
      schedule,
      scopeSha256ByCase: { [CASE_NAME]: canonicalJsonSha256(scope) },
      assetsByArm: materialized.map(({ armId, value }) =>
        readMethodologyAssetManifest(value.evaluationIsolation.providerAssetsRoot, armId)),
    });
    const recorder = createMethodologyInvocationRecorder(root, registrationSha256);
    const receipts: MethodologyTerminalReceipt[] = [];
    for (const { armId, value } of materialized) {
      const outputs = new Map<string, string>();
      let calls = 0;
      const runProvider: ProviderExec = async (_cmd, args) => {
        calls++;
        if (armId === "D") {
          return { stdout: "", stderr: "simulated provider failure", code: 9, timedOut: false };
        }
        const outputPath = argumentAfter(args, "--output-last-message");
        const schemaName = basename(argumentAfter(args, "--output-schema"));
        outputs.set(outputPath, schemaName === "methodology-discovery.schema.json"
          ? DISCOVERY_OUTPUT
          : schemaName === "breadth-result.schema.json" ? BREADTH_OUTPUT : REVIEW_OUTPUT);
        return { stdout: "", stderr: "", code: 0, timedOut: false };
      };
      const context: ReviewContext = {
        repoPath: value.repoPath,
        diffPath: value.diffPath,
        diffText: value.diffText,
        baseRef: value.baseRef,
        headRef: value.headRef,
        config: config(),
        evaluationIsolation: {
          ...value.evaluationIsolation,
          runProvider,
          readProviderOutput: (path) => outputs.get(path)!,
        },
      };
      const attempt = schedule.attempts.find((candidate) => candidate.armId === armId)!;
      const result = await runMethodologyAttempt({
        schedule,
        attemptId: attempt.id,
        assetManifest: readMethodologyAssetManifest(value.evaluationIsolation.providerAssetsRoot, armId),
        rawScope: scope,
        ...(armId === "B" || armId === "D" ? { activatedLanes: ["contracts"] } : {}),
        leakagePolicy: policy,
        context,
        beforeInvocation: recorder,
      });
      assert.equal(calls, armId === "C" ? 2 : 1);
      const terminalSha256 = writeMethodologyAttemptTerminal(root, registrationSha256, result);
      receipts.push({ attemptId: attempt.id, terminalSha256 });
    }
    receipts.sort((left, right) =>
      schedule.attempts.findIndex((attempt) => attempt.id === left.attemptId) -
      schedule.attempts.findIndex((attempt) => attempt.id === right.attemptId));
    return { root, registrationSha256, receipts };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  } finally {
    materialized.forEach(({ value }) => value.cleanup());
  }
}

function cloneEvidence(template: EvidenceTemplate): EvidenceTemplate & { cleanup(): void } {
  const parent = mkdtempSync(join(tmpdir(), "peregrine-methodology-run-seal-test-"));
  const root = join(parent, "evidence");
  cpSync(template.root, root, { recursive: true });
  return {
    root,
    registrationSha256: template.registrationSha256,
    receipts: structuredClone(template.receipts),
    cleanup: () => rmSync(parent, { recursive: true, force: true }),
  };
}

function scheduleForOneCase() {
  const withoutArms: Omit<MethodologyDesign, "arms"> = {
    schemaVersion: 1,
    protocol: "historical-methodology-v1",
    seed: 83,
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

function argumentAfter(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1);
  return args[index + 1]!;
}

function config(): PeregrineConfig {
  return JSON.parse(readFileSync(resolve("peregrine.config.json"), "utf8")) as PeregrineConfig;
}
