import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSidecarHostInspect } from "../eval/methodology-inspect-policy.js";
import { observePredictionExec } from "../eval/prediction-mechanical-evidence.js";
import { predictionEvidenceRedactor } from "../eval/prediction-evidence-redaction.js";
import { predictionFailureEvidence } from "../eval/prediction-cli-deadline.js";
import { sha } from "../eval/prediction-contract.js";

test("retained sanitized running producer uses null OomKillDisable", () => {
  const actual = JSON.parse(readFileSync(new URL("./fixtures/methodology-running-inspect-redacted.json", import.meta.url), "utf8"));
  assert.equal(actual.length, 2);
  for (const container of actual) {
    const h = container.HostConfig; assert.equal(h.OomKillDisable, null);
    validateSidecarHostInspect(h, h.NetworkMode, h.ExtraHosts?.[0]);
    for (const value of [false, true, undefined, "null", 0, {}, []]) {
      const altered = { ...h, OomKillDisable: value }; if (value === undefined) delete altered.OomKillDisable;
      assert.throws(() => validateSidecarHostInspect(altered, h.NetworkMode, h.ExtraHosts?.[0]));
    }
  }
});
test("mechanical durable records never retain the raw forwarding capability", async () => {
  const directory = join(mkdtempSync(join(tmpdir(), "peregrine-token-test-")), "receipts"), token = "a".repeat(64);
  const args = ["run", "--env", "MCP_FORWARDER_TOKEN=" + token]; let calls = 0;
  const observe = observePredictionExec(directory, { runId: "test", attemptId: "test", scopeSha256: "b".repeat(64), sourceSha256: "c".repeat(64), channel: "sidecars" }, async (_command, received) => {
    calls++; assert.deepEqual(received, args);
    return { code: 0, stdout: JSON.stringify([{ Config: { Env: ["MCP_FORWARDER_TOKEN=" + token] } }]), stderr: token, timedOut: false, processId: 123 };
  }, token);
  await observe("docker", args, { timeoutMs: 1000, deadlineSignal: new AbortController().signal });
  assert.equal(calls, 1);
  for (const path of readdirSync(directory)) assert.equal(readFileSync(join(directory, path), "utf8").includes(token), false, path);
  const start = JSON.parse(readFileSync(join(directory, "000001-start.json"), "utf8")), terminal = JSON.parse(readFileSync(join(directory, "000001-terminal.json"), "utf8"));
  assert.deepEqual(start.forwarderCapability, { kind: "forwarding-capability-sha256-v1", sha256: sha(token) });
  assert.deepEqual(terminal.forwarderCapability, start.forwarderCapability);
  assert.equal(start.args.at(-1), "MCP_FORWARDER_TOKEN=" + sha(token));
  assert.equal(terminal.result.stdout.sha256, sha(terminal.result.stdout.bytes));
});

test("live capability mismatch or missing redaction context fails before execution without value disclosure", async () => {
  for (const supplied of [undefined, "a".repeat(64)]) for (const embedded of ["b".repeat(64), "bad", "a".repeat(65)]) {
    const directory = join(mkdtempSync(join(tmpdir(), "peregrine-token-test-")), "receipts"); let calls = 0;
    const observe = observePredictionExec(directory, { runId: "test", attemptId: "test", scopeSha256: "c".repeat(64), sourceSha256: "d".repeat(64), channel: "sidecars" }, async () => { calls++; throw new Error("must not execute"); }, supplied);
    await assert.rejects(observe("docker", ["run", "--env", "MCP_FORWARDER_TOKEN=" + embedded]), error => !String(error).includes(embedded));
    assert.equal(calls, 0); assert.deepEqual(readdirSync(directory), []);
  }
});
test("nested execution/cleanup failures retain classification and only redacted diagnostics", async () => {
  const token = "a".repeat(64), directory = join(mkdtempSync(join(tmpdir(), "peregrine-token-test-")), "receipts"), r = predictionEvidenceRedactor(token);
  assert.throws(() => r.validate({ stdout: JSON.stringify({ Config: { Env: ["MCP_FORWARDER_TOKEN=" + "b".repeat(64)] } }) }), /differs/);
  const observe = observePredictionExec(directory, { runId: "test", attemptId: "test", scopeSha256: "b".repeat(64), sourceSha256: "c".repeat(64), channel: "client" }, async () => {
    throw new AggregateError([new Error("execution " + token), new Error("cleanup " + token)], "evaluation operation and cleanup both failed");
  }, token);
  await assert.rejects(observe("docker", ["run"], { timeoutMs: 1000 }), error => {
    const evidence = predictionFailureEvidence(error); assert.equal(evidence.cleanupUnproven, true); assert.equal(JSON.stringify(evidence).includes(token), false); return true;
  });
  const failed = JSON.parse(readFileSync(join(directory, "000001-failure.json"), "utf8"));
  assert.equal(failed.failure.cleanupUnproven, true);
  for (const path of readdirSync(directory)) assert.equal(readFileSync(join(directory, path), "utf8").includes(token), false);
  const cycle = new Error(token); cycle.cause = cycle;
  const cyclicEvidence = predictionFailureEvidence(r.error(cycle));
  assert.equal(cyclicEvidence.cleanupUnproven, true); assert.equal(JSON.stringify(cyclicEvidence).includes(token), false);
  const malformed = new AggregateError([], token); malformed.errors = null as any;
  assert.equal(predictionFailureEvidence(r.error(malformed)).cleanupUnproven, true);
});
