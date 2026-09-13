import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { exec } from "../src/util/exec.js";
import { sha } from "../eval/prediction-contract.js";
import { registerPredictionCliSession, assessPredictionCliBatch, observePredictionCliTokens, type PredictionCliTerminal } from "../eval/prediction-cli-session.js";
import { createPredictionCliDeadline, createStructuralPredictionCliDeadline } from "../eval/prediction-cli-deadline.js";
import { syntheticRegistration } from "./eval-prediction-fixture.js";

const registration = () => { const bytes = JSON.stringify(syntheticRegistration()); return registerPredictionCliSession(bytes, sha(bytes), sha("predecessor freeze")); };
const events = (input = 100, output = 20) => [{ type: "turn.completed", usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: output } }];
const terminal = (attemptId: string, overrides: Partial<PredictionCliTerminal> = {}): PredictionCliTerminal => ({ attemptId, status: "completed", events: events(), completeEventStream: true, rawOutput: "synthetic output", cleanupProven: true, deadlineExceeded: false, ...overrides });

test("prospective CLI correction preserves original unmet guarantees, exact schedule and hard non-token limits", () => {
  const r = registration();
  assert.equal(r.schedule.length, 64); assert.deepEqual(r.schedule, syntheticRegistration().schedule);
  assert.deepEqual(r.unmetPredecessorGuarantees, { perAttemptAggregateTokens: 120000, perAttemptOutputTokens: 16000, exactServedIdentity: true });
  assert.deepEqual(r.hardLimits, { wallMs: 1200000, readCalls: 100, returnedBytes: 2000000, retries: 0, delegation: false, concurrentAttempts: 1 });
  assert.equal(r.exactServedModel, null); assert.equal(r.exactServedVersion, null); assert.equal(r.providerAuthorized, false);
  assert.equal(r.batchStop.aggregateReportedTokens, 7680000); assert.equal(r.batchStop.outputReportedTokens, 1024000);
  assert.equal(assessPredictionCliBatch(r, []).unstartedAttemptIds.length, 64);
  assert.throws(() => assessPredictionCliBatch(structuredClone(r), []), /trusted original bytes/);
});

test("terminal counters are measurements; missing reasoning stays unknown and missing/partial usage stops the batch", () => {
  const measured = observePredictionCliTokens(events(), true);
  assert.equal(measured.reportedAggregateTokens, 120); assert.equal(measured.reasoningOutputTokens, null);
  assert.equal(observePredictionCliTokens(events(), false).status, "unknown");
  const r = registration(), result = assessPredictionCliBatch(r, [terminal(r.schedule[0]!.id, { status: "partial", completeEventStream: false })]);
  assert.equal(result.stopReason, "terminal-token-usage-unknown"); assert.equal(result.totalsComplete, false);
  assert.equal(result.observed[0]!.tokens.reportedAggregateTokens, null); assert.equal(result.nextAttemptId, null);
  assert.equal(result.unstartedAttemptIds.length, 63); assert.equal(result.observed[0]!.rawOutputSha256, sha("synthetic output"));
});

test("fixed cumulative ceilings stop only between attempts, retain overshoot, and reject skip/retry/post-stop", () => {
  const r = registration(), first = terminal(r.schedule[0]!.id, { events: events(7679990, 5) });
  assert.equal(assessPredictionCliBatch(r, [first]).nextAttemptId, r.schedule[1]!.id);
  const second = terminal(r.schedule[1]!.id), stopped = assessPredictionCliBatch(r, [first, second]);
  assert.equal(stopped.stopReason, "cumulative-reported-token-ceiling"); assert.equal(stopped.knownReportedAggregateTokens, 7680115);
  assert.throws(() => assessPredictionCliBatch(r, [first, second, terminal(r.schedule[2]!.id)]), /stopped batch/);
  assert.throws(() => assessPredictionCliBatch(r, [terminal(r.schedule[1]!.id)]), /exact scheduled/);
  assert.throws(() => assessPredictionCliBatch(r, [terminal(r.schedule[0]!.id), terminal(r.schedule[0]!.id)]), /exact scheduled/);
  assert.equal(assessPredictionCliBatch(r, [terminal(r.schedule[0]!.id, { events: events(0, 1024000) })]).stopReason, "cumulative-reported-token-ceiling");
  assert.equal(assessPredictionCliBatch(r, [terminal(r.schedule[0]!.id, { cleanupProven: false })]).stopReason, "cleanup-unproven");
});

test("expired outer deadline prevents even spawning an executable", async () => {
  const controller = new AbortController(); controller.abort();
  const result = await exec("this-program-must-not-be-spawned", [], { deadlineSignal: controller.signal });
  assert.equal(result.timedOut, true); assert.match(result.stderr, /before spawn/);
});

test("whole-attempt timer kills a real subprocess, closes reads, awaits teardown and retains partial output", async t => {
  const root = mkdtempSync(join(tmpdir(), "prediction-cli-deadline-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const pidPath = join(root, "pid"); let readsClosed = false, teardownProven = false;
  const guard = createStructuralPredictionCliDeadline({ directory: join(root, "evidence"), attemptId: "structural-only",
    closeReads: () => { readsClosed = true; }, teardown: async () => {
      const pid = Number(readFileSync(pidPath, "utf8"));
      assert.throws(() => process.kill(pid, 0), (error: NodeJS.ErrnoException) => error.code === "ESRCH"); teardownProven = true;
    } }, 1000);
  // Preparation consumes this same timer; no per-stage reset is possible.
  await new Promise(resolve => setTimeout(resolve, 100));
  const result = await guard.run(exec, process.execPath, ["-e", `require('fs').writeFileSync(${JSON.stringify(pidPath)},String(process.pid));process.stdout.write('retained partial');setInterval(()=>{},1000)`], { inheritEnv: false, env: {} });
  assert.equal(result.timedOut, true); assert.equal(result.stdout, "retained partial");
  assert.throws(() => guard.read(() => "late source"), /closed/);
  const closed = await guard.finish();
  assert.equal(readsClosed, true); assert.equal(teardownProven, true); assert.equal(closed.teardownCompleted, true);
  assert.equal(closed.deadlineExceeded, true); assert.equal(closed.providerContainmentProven, false);
  assert.equal(existsSync(join(root, "evidence", "terminal.json")), true);
  assert.ok(closed.events.some(event => event.kind === "exec-closed"));
  assert.throws(() => guard.run(exec, process.execPath, ["--version"]), /closed/);
});

test("default timer stays 20 minutes, one attempt cannot invoke twice, and cleanup failure remains visible", async t => {
  const root = mkdtempSync(join(tmpdir(), "prediction-cli-default-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const guard = createPredictionCliDeadline({ directory: join(root, "evidence"), attemptId: "structural-success", closeReads() {}, teardown: async () => { throw new Error("teardown not proved"); } });
  await guard.run(exec, process.execPath, ["--version"], { inheritEnv: false, env: {} });
  assert.throws(() => guard.run(exec, process.execPath, ["--version"]), /cannot retry or delegate/);
  const closed = await guard.finish(); assert.equal(closed.wallMs, 1200000); assert.equal(closed.teardownCompleted, false); assert.match(closed.cleanupError!, /not proved/);
});

test("finish closes reads and rejects a new run synchronously while teardown is pending", async t => {
  const root = mkdtempSync(join(tmpdir(), "prediction-cli-close-race-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  let release!: () => void, invoked = 0, readsClosed = false;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const guard = createPredictionCliDeadline({ directory: join(root, "evidence"), attemptId: "finish-run-race",
    closeReads: () => { readsClosed = true; }, teardown: () => pending });
  const finishing = guard.finish();
  try {
    assert.equal(readsClosed, true);
    assert.throws(() => guard.run(async () => { invoked++; return { stdout: "", stderr: "", code: 0, timedOut: false }; }, "must-not-run", []), /closed|closing/);
    assert.throws(() => guard.read(() => "late source"), /closed|closing/);
    await Promise.resolve(); assert.equal(invoked, 0);
  } finally { release(); await finishing; }
});

test("concurrent and repeated finish calls share one terminal promise and one teardown", async t => {
  const root = mkdtempSync(join(tmpdir(), "prediction-cli-finish-once-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  let release!: () => void, cleanups = 0, closes = 0;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const directory = join(root, "evidence");
  const guard = createPredictionCliDeadline({ directory, attemptId: "concurrent-finish", closeReads: () => { closes++; }, teardown: async () => { cleanups++; await pending; } });
  const first = guard.finish(), second = guard.finish();
  try { assert.strictEqual(first, second); } finally { release(); await Promise.allSettled([first, second]); }
  assert.strictEqual(await first, await second); assert.strictEqual(guard.finish(), first);
  assert.equal(cleanups, 1); assert.equal(closes, 1);
  assert.equal(readdirSync(directory).filter(path => path === "terminal.json").length, 1);
});

test("exec-start record collision cancels and tears down with zero runner invocations", async t => {
  const root = mkdtempSync(join(tmpdir(), "prediction-cli-start-collision-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, "evidence"); let invoked = 0, cleanups = 0, readsClosed = false;
  const guard = createPredictionCliDeadline({ directory, attemptId: "start-collision", closeReads: () => { readsClosed = true; }, teardown: async () => { cleanups++; } });
  writeFileSync(join(directory, "000001.json"), "preserved conflicting start record\n", { flag: "wx" });
  try {
    assert.throws(() => guard.run(async () => { invoked++; return { stdout: "must never exist", stderr: "", code: 0, timedOut: false }; }, "must-not-run", []), /evidence/);
  } finally { await guard.finish(); }
  assert.equal(invoked, 0); assert.equal(cleanups, 1); assert.equal(readsClosed, true); assert.equal(guard.signal.aborted, true);
  const terminal = JSON.parse(readFileSync(join(directory, "terminal.json"), "utf8"));
  assert.match(terminal.evidenceError, /EEXIST/); assert.equal(terminal.deadlineExceeded, false);
  assert.equal(terminal.teardownCompleted, true); assert.ok(terminal.events.some((event: { kind: string }) => event.kind === "evidence-cancellation"));
  assert.equal(readFileSync(join(directory, "000001.json"), "utf8"), "preserved conflicting start record\n");
});

test("a blocked event loop past the 25ms deadline cancels before the deferred runner can start", async t => {
  const root = mkdtempSync(join(tmpdir(), "prediction-cli-deferred-deadline-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, "evidence"); let invoked = 0, cleanups = 0, closes = 0;
  const guard = createStructuralPredictionCliDeadline({ directory, attemptId: "deferred-deadline",
    closeReads: () => { closes++; }, teardown: async () => { cleanups++; } }, 25);
  const running = guard.run(async () => { invoked++; return { stdout: "must never exist", stderr: "", code: 0, timedOut: false }; }, "must-not-run", []);
  // Hold this turn beyond the absolute deadline, before either the queued
  // invocation or the timer callback has an opportunity to run.
  const blockedAt = performance.now(); while (performance.now() - blockedAt < 60) { /* intentional event-loop block */ }
  const first = guard.finish(), second = guard.finish();
  try { await assert.rejects(running, /deadline|cancelled/); } finally { await first; }
  assert.strictEqual(first, second); assert.strictEqual(guard.finish(), first);
  const terminal = await first;
  assert.equal(invoked, 0); assert.equal(cleanups, 1); assert.equal(closes, 1);
  assert.equal(guard.signal.aborted, true); assert.equal(terminal.deadlineExceeded, true);
  assert.equal(terminal.cancellationReason, "whole-attempt-deadline"); assert.equal(terminal.teardownCompleted, true);
  assert.equal(terminal.events.filter(event => event.kind === "deadline-cancellation").length, 1);
  assert.equal(terminal.events.filter(event => event.kind === "teardown-complete").length, 1);
  assert.equal(terminal.events.some(event => event.kind === "exec-closed"), false);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, "terminal.json"), "utf8")), terminal);
});
