import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { digest, sha } from "../eval/prediction-contract.js";
import { registerPredictionCliSession, assessPredictionCliBatch } from "../eval/prediction-cli-session.js";
import { METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE } from "../eval/methodology-runtime-image.js";
import { preparePredictionPreauthorization, verifyPredictionPreauthorization, requirePredictionCanaryDispatch } from "../eval/prediction-preauthorization.js";
import { predictionMountFixture } from "./eval-prediction-mount-fixture.js";

function authority(preparation: ReturnType<typeof predictionMountFixture>["authority"]) {
  const registration = registerPredictionCliSession(preparation.registrationBytes, preparation.registrationSha256, sha("synthetic-predecessor-freeze"));
  const cli = { kind: "prospective-cli-session-registration-freeze-v4", registration, initialLedger: assessPredictionCliBatch(registration, []) };
  const runtime = { kind: "prediction-runtime-acceptance-freeze-v1", acceptance: METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE,
    scientificRegistration: registration, providerAuthorized: false, executionReady: false, cliAgentCanaryProven: false, providerCalls: 0 };
  const trusted = (value: unknown) => { const bytes = JSON.stringify(value); return { bytes, expectedSha256: sha(bytes) }; };
  return { preparation, cliSessionFreeze: trusted(cli), runtimeAcceptanceFreeze: trusted(runtime) };
}

test("R4 reconstructs all 64 unstarted prompt/mount/runtime/route/cap bindings and a separate single canary", async t => {
  const f = predictionMountFixture(t), input = authority(f.authority), result = await preparePredictionPreauthorization(input, f.root);
  const p = result.preauthorization;
  assert.equal(p.attempts.length, 64); assert.equal(p.dryRun.preparation.plan.cases.length, 16);
  assert.equal(p.dryRun.lifecycle.length, 64); assert.equal(p.dryRun.dryRunComplete, true);
  assert.deepEqual([p.providerAuthorized, p.executionReady, p.providerCalls, p.reviewAttemptsStarted], [false, false, 0, 0]);
  assert.equal(p.unstartedReviewAttempts, 64); assert.equal(p.batch.observed.length, 0);
  assert.equal(p.assessorIdentityReceipts, null); assert.equal(p.reviewedBlindingReceipt, null);
  assert.deepEqual(p.route, { model: "gpt-5.6-sol", effort: "high", providerAccess: "cli-session", exactServedModel: null, exactServedVersion: null });
  assert.deepEqual(p.toolBinding.definitions.map(tool => tool.name), ["list_tree", "read_file", "search_text", "read_link"]);
  assert.equal(p.caps.hard.wallMs, 1_200_000); assert.equal(p.caps.hard.readCalls, 100); assert.equal(p.caps.hard.returnedBytes, 2_000_000);
  assert.equal(p.caps.terminalBatchStop.aggregateReportedTokens, 7_680_000);
  for (const slot of p.attempts) {
    assert.equal(slot.status, "unstarted"); assert.equal(slot.output, null);
    const c = p.dryRun.preparation.plan.cases.find(c => c.source.caseId === slot.caseId)!;
    assert.equal(slot.promptSha256, sha(c.prompts[slot.arm].prompt));
    assert.equal(slot.mountSha256, c.source.inventorySha256);
    assert.equal(slot.runtimeSha256, digest(p.runtimeAcceptance));
    assert.equal(slot.toolsSha256, digest(p.toolBinding)); assert.equal(slot.capsSha256, digest(p.caps)); assert.equal(slot.routeSha256, digest(p.route));
  }
  assert.equal(result.canary.preauthorizationSha256, p.sha256);
  assert.equal(result.canary.sourceAttemptId, p.attempts[0]!.id);
  assert.deepEqual([result.canary.maximumAttempts, result.canary.scheduledReviewAttemptsConsumed, result.canary.retries, result.canary.delegation], [1, 0, 0, false]);
  assert.equal(result.canary.promptSha256, sha(result.canary.prompt));
  assert.equal(result.canary.started, false); assert.equal(result.canary.approval, null);
  assert.equal(result.canary.prompt.includes("Synthetic bounded contract"), false);
  assert.equal(result.canary.outputPolicy.maximumBytes, 4_194_304);
  assert.ok(result.canary.prompt.includes("call read_link on review.diff and report the expected refusal"));
  assert.ok(result.canary.requiredEvidence.some(value => value.includes("not an elapsed timeout or forced termination")));
  assert.ok(p.source.files.some(file => file.path === "eval/prediction-preauthorization.ts"));
  await verifyPredictionPreauthorization(result, input, f.root);
});

test("resealed prompt/mount/route/cap/tool/schedule/readiness/canary mutations fail authenticated reconstruction", async t => {
  const f = predictionMountFixture(t), input = authority(f.authority), result = await preparePredictionPreauthorization(input, f.root);
  const mutations = [
    (v: typeof result) => { v.preauthorization.dryRun.preparation.plan.cases[0]!.prompts.A.prompt += " injected method"; },
    (v: typeof result) => { v.preauthorization.attempts[0]!.mountSha256 = sha("other"); },
    (v: typeof result) => { v.preauthorization.route.exactServedVersion = "fabricated" as never; },
    (v: typeof result) => { v.preauthorization.caps.hard.wallMs++; },
    (v: typeof result) => { v.preauthorization.toolBinding.definitions.pop(); },
    (v: typeof result) => { v.preauthorization.attempts.reverse(); },
    (v: typeof result) => { v.preauthorization.executionReady = true; v.preauthorization.providerAuthorized = true; },
    (v: typeof result) => { v.canary.maximumAttempts = 2; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(result); mutate(changed);
    const { sha256: _, ...body } = changed.preauthorization; changed.preauthorization.sha256 = digest(body);
    changed.canary.preauthorizationSha256 = changed.preauthorization.sha256;
    const { sha256: _canary, ...canaryBody } = changed.canary; changed.canary.sha256 = digest(canaryBody);
    changed.sha256 = digest({ preauthorization: changed.preauthorization, canary: changed.canary });
    await assert.rejects(verifyPredictionPreauthorization(changed, input, f.root), /authenticated reconstruction/);
  }
  writeFileSync(join(f.firstRoot, "review.diff"), "tampered source");
  await assert.rejects(preparePredictionPreauthorization(input, f.root), /source changed|bytes drift/);
});

test("trusted predecessors and dispatch remain default-deny even with caller-supplied approval flags", async t => {
  const f = predictionMountFixture(t), input = authority(f.authority);
  await assert.rejects(preparePredictionPreauthorization({ ...input, runtimeAcceptanceFreeze: { ...input.runtimeAcceptanceFreeze, bytes: input.runtimeAcceptanceFreeze.bytes + " " } }, f.root), /trusted byte digest/);
  const promoted = JSON.parse(input.runtimeAcceptanceFreeze.bytes); promoted.cliAgentCanaryProven = true;
  const bytes = JSON.stringify(promoted);
  await assert.rejects(preparePredictionPreauthorization({ ...input, runtimeAcceptanceFreeze: { bytes, expectedSha256: sha(bytes) } }, f.root), /promoted to provider readiness/);
  for (const value of [null, {}, { providerAuthorized: true, executionReady: true, approval: "authorized" }]) assert.throws(() => requirePredictionCanaryDispatch(value), /not dispatch authorization/);
});
