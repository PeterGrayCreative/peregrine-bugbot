import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assessPredictionCanary, persistPredictionCanaryAssessment, requirePredictionBatchAuthorization } from "../eval/prediction-canary-assessment.js";
import { predictionCanaryAssessmentFixture, trustedFixture, sealFixture } from "./eval-prediction-canary-assessment-fixture.js";

test("synthetic complete refusal and literal-link observations can recommend eligibility without authorizing anything", async t => {
  for (const native of [false, true]) {
    const f = await predictionCanaryAssessmentFixture(t, native), value = assessPredictionCanary(f.input);
    assert.equal(value.recommendation, "eligible-for-separate-batch-authorization", JSON.stringify(value.failure));
    assert.equal(value.batchAuthorized, false); assert.equal(value.executionReady, false); assert.equal(value.providerAuthorized, false); assert.equal(value.providerCalls, 0);
    assert.ok(value.limitations.some(v => v.includes("Exact served model/version"))); assert.ok(Object.isFrozen(value));
    for (const candidate of [null, value, { ...value, batchAuthorized: true, providerAuthorized: true }, JSON.parse(JSON.stringify(value))]) assert.throws(() => requirePredictionBatchAuthorization(candidate), /not batch authorization/);
    const directory = join(f.root, "assessment"); assert.deepEqual(persistPredictionCanaryAssessment(directory, f.input), value);
    assert.throws(() => persistPredictionCanaryAssessment(directory, f.input), /EEXIST/);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, "assessment.json"), "utf8")), value);
  }
});

test("missing, malformed, tampered, cross-run, stale and resealed evidence fails closed", async t => {
  const f = await predictionCanaryAssessmentFixture(t);
  const mutations = [
    (v: any) => { v.observer = null; },
    (v: any) => { v.observer.bytes = "{"; },
    (v: any) => { v.artifacts.pop(); },
    (v: any) => { v.artifacts[0].bytes += " "; },
    (v: any) => { v.runId += "-other"; },
    (v: any) => { const b = JSON.parse(v.bridgeFreeze.bytes); b.source.sourceSha256 = "a".repeat(64); v.bridgeFreeze = trustedFixture(b); },
    (v: any) => { const r = JSON.parse(v.r4Freeze.bytes); r.package.canary.maximumAttempts = 2; sealFixture(r.package.canary); v.r4Freeze = trustedFixture(r); },
    (v: any) => { v.artifacts.push(v.artifacts[0]); },
    (v: any) => { v.mountManifest.bytes += " "; },
  ];
  for (const mutate of mutations) { const v = structuredClone(f.input); mutate(v); assert.equal(assessPredictionCanary(v).recommendation, "not-eligible"); }
});

test("independently repinned failures still cannot satisfy capability, identity, lifecycle, token or review-slot requirements", async t => {
  const f = await predictionCanaryAssessmentFixture(t), original = structuredClone(f.files);
  const mutations: [string, (v: any) => void][] = [
    ["observer/catalog.json", v => { v.complete = null; }],
    ["observer/catalog.json", v => { v.repositoryTools.push({ name: "shell" }); }],
    ["observer/catalog.json", v => { v.bookkeeping.push({ name: "plan", effects: ["read-history"], identicalAcrossArms: true }); }],
    ["observer/catalog.json", v => { v.bookkeeping.push({ name: "command_execution", effects: [], identicalAcrossArms: true }); }],
    ["observer/identity.json", v => { v.servedModel = "gpt-6-astra"; }],
    ["observer/identity.json", v => { v.servedVersion = "fabricated"; v.provenance = "model-self-report"; }],
    ["observer/identity.json", v => { v.observedRequest.effort = "medium"; }],
    ["observer/lifecycle.json", v => { v.deadlineSignalAttached = false; }],
    ["observer/lifecycle.json", v => { v.elapsedTimeoutObserved = true; }],
    ["observer/absence.json", v => { v.resources.pop(); }],
    ["observer/absence.json", v => { v.resources[0].queryResult.stdout = "still-running"; }],
    ["observer/batch-after.json", v => { v.unstartedAttemptIds.shift(); }],
    ["observer/runtime.json", v => { v.configurationSupported = null; }],
    ["canary/execution.json", v => { v.stdout += "\n{"; }],
    ["canary/execution.json", v => { v.stdout = v.stdout.replace('"output_tokens":5', '"output_tokens":null'); }],
    ["canary/execution.json", v => { v.code = 1; }],
    ["canary/execution.json", v => { v.timedOut = true; }],
    ["canary/terminal.json", v => { v.failure = { primaryError: "failed" }; }],
    ["canary/cleanup.json", v => { v.sidecars[1].sealed = false; }],
    ["observer/gateway-audit.json", v => { v.events[0].authorityDigest = "a".repeat(64); }],
    ["observer/forwarder-audit.json", v => { v.requests.forwarded = 0; }],
    ["canary/cleanup.json", v => { v.reader.transcript[1].response = '{}'; }],
    ["observer/tool-calls.json", v => { v.calls[0].source = "curator"; }],
    ["canary/invocation.json", v => { v.assets.push("SKILL.md"); }],
  ];
  for (const [path, mutate] of mutations) {
    for (const key of Object.keys(f.files)) f.files[key] = structuredClone(original[key]);
    mutate(f.files[path]); assert.equal(assessPredictionCanary(f.repin()).recommendation, "not-eligible", path);
  }
  for (const key of Object.keys(f.files)) f.files[key] = structuredClone(original[key]); f.repin();
  f.observer.review.leakageAbsent = false; f.input.observer = trustedFixture(f.observer);
  assert.equal(assessPredictionCanary(f.input).recommendation, "not-eligible");
});

test("consistently resealed tool records cannot hide missing required operations or changed source bytes", async t => {
  const f = await predictionCanaryAssessmentFixture(t), original = structuredClone(f.files);
  for (const [missing, replacement, expected] of [[0, 1, "root listing"], [1, 0, "diff read"], [2, 0, "diff search"], [3, 1, "read_link refusal"]] as const) {
    for (const key of Object.keys(f.files)) f.files[key] = structuredClone(original[key]);
    const transcript = f.files["canary/cleanup.json"].reader.transcript;
    transcript[missing] = { ...structuredClone(transcript[replacement]), ticket: missing + 1 };
    const result = assessPredictionCanary(f.syncReads()); assert.equal(result.recommendation, "not-eligible"); assert.match(JSON.stringify(result.failure), new RegExp(expected));
  }
  for (const key of Object.keys(f.files)) f.files[key] = structuredClone(original[key]);
  const transcript = f.files["canary/cleanup.json"].reader.transcript, value = JSON.parse(transcript[1].response); value.text += "injected secret"; transcript[1].response = JSON.stringify(value);
  assert.match(JSON.stringify(assessPredictionCanary(f.syncReads()).failure), /mounted source/);
});
