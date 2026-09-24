import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildDevelopmentBenchmarkSchedule,
  DEVELOPMENT_CORPUS_SHA256,
} from "../eval/development-benchmark-schedule.js";
import {
  prepareTrustedLocalReviewPair,
  runSyntheticTrustedLocalReviewAttempt,
  type TrustedLocalReviewPairInput,
  type TrustedLocalReviewTerminal,
} from "../eval/trusted-local-review-runner.js";
import type { ExecResult } from "../src/util/exec.js";

const CASE_IDS = Array.from({ length: 12 }, (_, index) => `opaque-case-${String(index + 1).padStart(2, "0")}`);
const EMPTY_REVIEW = { status: "completed", limitations: [], findings: [] };

test("synthetic development schedule preserves all 48 receipts without credentials or execution", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-development-synthetic-test-"));
  const checkout = join(root, "synthetic-checkout");
  mkdirSync(checkout, { recursive: true });
  writeFileSync(join(checkout, "README.md"), "Synthetic checkout only.\n");
  const schedule = buildDevelopmentBenchmarkSchedule({
    caseIds: CASE_IDS,
    seed: "synthetic-receipt-seed-2026-09-23",
    corpusSha256: DEVELOPMENT_CORPUS_SHA256,
  });
  const calls: Array<{ command: string; cwd: string | undefined; stdin: string | undefined; env: Record<string, string> | undefined }> = [];
  const observedIds: string[] = [];
  const attemptRoots: string[] = [];
  const terminals: TrustedLocalReviewTerminal[] = [];

  const fakeRun: typeof import("../src/util/exec.js").exec = async (command, _args, options) => {
    calls.push({
      command,
      cwd: options?.cwd,
      stdin: options?.stdin,
      env: options?.env,
    });
    const callNumber = calls.length;
    if (callNumber === 11) {
      return {
        stdout: "synthetic process-failure output\n",
        stderr: "synthetic process-failure stderr\n",
        code: 17,
        timedOut: false,
      } satisfies ExecResult;
    }
    if (callNumber === 37) {
      return {
        stdout: "synthetic timed-out output\n",
        stderr: "synthetic timed-out stderr\n",
        code: null,
        timedOut: true,
      } satisfies ExecResult;
    }
    return successfulEmptyReview();
  };

  try {
    for (const slot of schedule.attempts) {
      observedIds.push(slot.id);
      const attemptRoot = join(root, "attempts", slot.id);
      attemptRoots.push(attemptRoot);
      const prepareInput = syntheticPrepareInput(slot.caseId, checkout, attemptRoot);
      const [plain, peregrine] = await prepareTrustedLocalReviewPair(prepareInput);
      const attempt = slot.armId === "A" ? plain : peregrine;
      const syntheticInput = {
        caseId: prepareInput.caseId,
        checkoutDirectory: prepareInput.checkoutDirectory,
        attemptRoot: prepareInput.attemptRoot,
        scope: prepareInput.scope,
        activatedLanes: prepareInput.activatedLanes,
      };
      terminals.push(await runSyntheticTrustedLocalReviewAttempt(syntheticInput, attempt, fakeRun));
    }

    assert.equal(calls.length, 48);
    assert.deepEqual(observedIds, schedule.attempts.map((slot) => slot.id));
    assert.equal(new Set(attemptRoots).size, 48);
    assert.equal(new Set(calls.map((call) => call.cwd)).size, 1);
    assert.equal(calls[0]?.cwd, checkout);
    assert.ok(calls.every((call) => call.command === "__peregrine_synthetic_no_binary__"));
    assert.ok(calls.every((call) => call.env !== undefined && Object.keys(call.env).length === 0));
    assert.ok(calls.every((call) => typeof call.stdin === "string" && call.stdin.length > 0));
    assert.equal(existsSync(join(root, "auth.json")), false);
    assert.ok(terminals.every((terminal) => terminal.synthetic === true));
    assert.equal(terminals.filter((terminal) => terminal.status === "process-failed").length, 1);
    assert.equal(terminals.filter((terminal) => terminal.status === "timed-out").length, 1);
    assert.equal(terminals.filter((terminal) => terminal.status === "completed").length, 46);

    for (const [index, slot] of schedule.attempts.entries()) {
      const terminal = terminals[index]!;
      const attemptDirectory = join(attemptRoots[index]!, `${slot.caseId}-${slot.armId}`);
      assert.equal(terminal.caseId, slot.caseId);
      assert.equal(terminal.armId, slot.armId);
      assert.equal(readFileSync(join(attemptDirectory, "terminal.json"), "utf8").includes('"synthetic":true'), true);
      const raw = readFileSync(join(attemptDirectory, "raw.jsonl"), "utf8");
      if (terminal.status === "process-failed") assert.equal(raw, "synthetic process-failure output\n");
      if (terminal.status === "timed-out") assert.equal(raw, "synthetic timed-out output\n");
      if (terminal.status === "completed") assert.match(raw, /thread\.started/);
      assert.equal(existsSync(join(attemptDirectory, "auth.json")), false);
      assert.ok(!readdirSync(attemptDirectory).includes("auth.json"));
      if (terminal.status === "completed") {
        const findings = JSON.parse(readFileSync(join(attemptDirectory, "final-findings.json"), "utf8")) as typeof EMPTY_REVIEW;
        assert.deepEqual(findings, EMPTY_REVIEW);
      } else {
        assert.equal(terminal.findingsSha256, null);
        assert.equal(existsSync(join(attemptDirectory, "final-findings.json")), false);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function syntheticPrepareInput(caseId: string, checkoutDirectory: string, attemptRoot: string): TrustedLocalReviewPairInput {
  const input = {
    caseId,
    checkoutDirectory,
    authFile: join(attemptRoot, "auth-never-created.json"),
    attemptRoot,
    activatedLanes: ["contracts"],
    scope: {
      baseRef: "a".repeat(40),
      headRef: "b".repeat(40),
      diff: "diff --git a/README.md b/README.md\n+Synthetic checkout only.\n",
      taskSpecification: "Review this synthetic change for consequential correctness bugs.",
      rawChangedPaths: ["README.md"],
    },
  } satisfies TrustedLocalReviewPairInput;
  Object.defineProperty(input, "authFile", {
    configurable: true,
    enumerable: true,
    get: () => { throw new Error("synthetic test accessed authFile"); },
  });
  return input;
}

function successfulEmptyReview(): ExecResult {
  const events = [
    { type: "thread.started", thread_id: "synthetic-thread" },
    { type: "turn.started" },
    { type: "item.completed", item: { type: "agent_message", text: JSON.stringify(EMPTY_REVIEW) } },
    { type: "turn.completed" },
  ];
  return {
    stdout: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    stderr: "",
    code: 0,
    timedOut: false,
  };
}
