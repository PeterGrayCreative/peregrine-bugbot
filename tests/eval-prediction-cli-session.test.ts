import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
