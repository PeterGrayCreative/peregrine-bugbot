import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateScopeCompleteness,
  scopeRegistrationSha256,
  SCOPE_COMPLETENESS_TRUST_BOUNDARY,
} from "../eval/scope-completeness.js";

const hashes = {
  input: "b".repeat(64),
  tool: "c".repeat(64),
  inputEvidence: "d".repeat(64),
  toolEvidence: "e".repeat(64),
  negativeEvidence: "f".repeat(64),
};

function evidence(): Record<string, unknown> {
  const requiredObservations = [
    { id: "input.diff", kind: "input" as const, requirementSha256: hashes.input },
    { id: "tool.repository-read", kind: "tool" as const, requirementSha256: hashes.tool },
  ];
  return {
    schemaVersion: 1,
    protocol: "historical-efficacy-v1",
    registeredScopeSha256: scopeRegistrationSha256(requiredObservations),
    requiredObservations,
    runnerFacts: [
      {
        observationId: "input.diff",
        requirementSha256: hashes.input,
        status: "available",
        evidenceSha256: hashes.inputEvidence,
      },
      {
        observationId: "tool.repository-read",
        requirementSha256: hashes.tool,
        status: "available",
        evidenceSha256: hashes.toolEvidence,
      },
    ],
    modelLimitations: [],
  };
}

test("all registered runner observations derive complete scope availability only", () => {
  const result = evaluateScopeCompleteness(evidence());
  assert.equal(result.verdict, "complete");
  assert.deepEqual(result.reasons, []);
  assert.equal(result.meaning, "registered-scope-availability-only");
  assert.match(SCOPE_COMPLETENESS_TRUST_BOUNDARY, /authenticate every runner evidence digest/);
  assert.match(SCOPE_COMPLETENESS_TRUST_BOUNDARY, /registration digest to the immutable schedule/);
  assert.match(SCOPE_COMPLETENESS_TRUST_BOUNDARY, /not runner evidence/);
});

test("the registration digest binds the complete normalized requirement set", () => {
  const removed = evidence();
  (removed.requiredObservations as unknown[]).pop();
  (removed.runnerFacts as unknown[]).pop();
  assert.throws(() => evaluateScopeCompleteness(removed), /registeredScopeSha256 does not match/);

  const changed = evidence();
  (changed.requiredObservations as Record<string, unknown>[])[0]!.kind = "required-context";
  assert.throws(() => evaluateScopeCompleteness(changed), /registeredScopeSha256 does not match/);

  const staleHex = evidence();
  staleHex.registeredScopeSha256 = "9".repeat(64);
  assert.throws(() => evaluateScopeCompleteness(staleHex), /registeredScopeSha256 does not match/);

  const shuffled = evidence();
  shuffled.requiredObservations = [...(shuffled.requiredObservations as unknown[])].reverse();
  assert.equal(evaluateScopeCompleteness(shuffled).verdict, "complete");
});

test("derivation is deterministic across requirement, fact, and limitation order", () => {
  const first = evidence();
  first.modelLimitations = [
    { kind: "unable-to-complete", detail: "The review could not finish." },
    { kind: "required-tool-unavailable", observationId: "tool.repository-read", detail: "Reads failed." },
  ];
  const second = structuredClone(first);
  second.requiredObservations = [...(second.requiredObservations as unknown[])].reverse();
  second.runnerFacts = [...(second.runnerFacts as unknown[])].reverse();
  second.modelLimitations = [...(second.modelLimitations as unknown[])].reverse();
  assert.deepEqual(evaluateScopeCompleteness(first), evaluateScopeCompleteness(second));
});

test("missing positive runner evidence is unverified and unknown bindings reject", () => {
  const missing = evidence();
  (missing.runnerFacts as unknown[]).pop();
  const result = evaluateScopeCompleteness(missing);
  assert.equal(result.verdict, "unverified");
  assert.deepEqual(result.reasons, ["missing-runner-availability:tool.repository-read"]);

  const unknown = evidence();
  (unknown.runnerFacts as Record<string, unknown>[])[0]!.observationId = "tool.unregistered";
  assert.throws(() => evaluateScopeCompleteness(unknown), /observationId is not registered/);

  const stale = evidence();
  (stale.runnerFacts as Record<string, unknown>[])[0]!.requirementSha256 = "9".repeat(64);
  assert.throws(() => evaluateScopeCompleteness(stale), /does not match the registered observation/);
});

test("runner unavailability and contradictory runner facts fail closed", () => {
  const unavailable = evidence();
  (unavailable.runnerFacts as Record<string, unknown>[])[0]!.status = "unavailable";
  assert.equal(evaluateScopeCompleteness(unavailable).verdict, "incomplete");

  const contradictory = evidence();
  (contradictory.runnerFacts as unknown[]).push({
    observationId: "input.diff",
    requirementSha256: hashes.input,
    status: "unavailable",
    evidenceSha256: hashes.negativeEvidence,
  });
  const result = evaluateScopeCompleteness(contradictory);
  assert.equal(result.verdict, "incomplete");
  assert.deepEqual(result.reasons, ["runner-contradiction:input.diff"]);
});

test("model-reported limitations may downgrade but cannot establish availability", () => {
  const modelUnavailable = evidence();
  modelUnavailable.modelLimitations = [{
    kind: "required-context-unavailable",
    observationId: "input.diff",
    detail: "The supplied diff was truncated.",
  }];
  assert.equal(evaluateScopeCompleteness(modelUnavailable).verdict, "incomplete");

  const noRunnerFacts = evidence();
  noRunnerFacts.runnerFacts = [];
  noRunnerFacts.modelLimitations = [];
  assert.equal(evaluateScopeCompleteness(noRunnerFacts).verdict, "unverified");
});

test("tool counts and emitted findings cannot override runner evidence", () => {
  const noCalls = evidence();
  noCalls.runnerFacts = [];
  noCalls.nonAuthoritativeActivity = { toolCallCount: 0, findingCount: 4 };
  assert.equal(evaluateScopeCompleteness(noCalls).verdict, "unverified");

  const findingDespiteFailure = evidence();
  (findingDespiteFailure.runnerFacts as Record<string, unknown>[])[0]!.status = "unavailable";
  findingDespiteFailure.nonAuthoritativeActivity = { toolCallCount: 12, findingCount: 3 };
  assert.equal(evaluateScopeCompleteness(findingDespiteFailure).verdict, "incomplete");
});

test("operator-supplied verdicts and malformed facts are rejected", () => {
  const verdict = evidence();
  verdict.verdict = "complete";
  assert.throws(() => evaluateScopeCompleteness(verdict), /unsupported field verdict/);

  const unknownStatus = evidence();
  (unknownStatus.runnerFacts as Record<string, unknown>[])[0]!.status = "unknown";
  assert.throws(() => evaluateScopeCompleteness(unknownStatus), /status is invalid/);

  const duplicateRequirement = evidence();
  (duplicateRequirement.requiredObservations as unknown[]).push(
    (duplicateRequirement.requiredObservations as unknown[])[0],
  );
  assert.throws(() => evaluateScopeCompleteness(duplicateRequirement), /id is duplicated/);
});
