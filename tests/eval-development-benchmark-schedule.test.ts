import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJsonSha256 } from "../eval/experiment.js";
import {
  buildDevelopmentBenchmarkSchedule,
  DEVELOPMENT_CORPUS_SHA256,
  parseDevelopmentBenchmarkSchedule,
} from "../eval/development-benchmark-schedule.js";

const caseIds = [
  "visible-07", "linked-family-001", "post-merge-alpha-004", "random-001",
  ...Array.from({ length: 8 }, (_, index) => `synthetic_${index + 1}`),
];

function schedule(seed = "frozen-seed-2026-09-23") {
  return buildDevelopmentBenchmarkSchedule({ caseIds, seed, corpusSha256: DEVELOPMENT_CORPUS_SHA256 });
}

test("48 sequential attempts balance arms and reverse each case pair", () => {
  const result = schedule();
  assert.equal(result.attempts.length, 48);
  assert.equal(new Set(result.attempts.map((item) => item.id)).size, 48);
  assert.equal(result.attempts.filter((item) => item.armId === "A").length, 24);
  assert.equal(result.attempts.filter((item) => item.armId === "B").length, 24);
  assert.equal(result.model, "gpt-5.6-sol");
  assert.equal(result.effort, "high");
  assert.equal(result.attemptDeadlineMs, 1_200_000);
  assert.equal(result.outputLimitBytes, 4_194_304);
  const { scheduleSha256: _hash, ...body } = result;
  assert.equal(result.scheduleSha256, canonicalJsonSha256(body));
  for (const caseId of caseIds) {
    const slots = result.attempts.filter((item) => item.caseId === caseId);
    assert.equal(slots.length, 4);
    assert.deepEqual(slots.map((item) => item.repeat), [1, 1, 2, 2]);
    assert.deepEqual(slots.map((item) => item.position), [1, 2, 1, 2]);
    assert.deepEqual(slots.slice(0, 2).map((item) => item.armId).reverse(),
      slots.slice(2).map((item) => item.armId));
  }
});

test("schedule is deterministic across caller case order and changes with seed", () => {
  const first = schedule();
  const reordered = buildDevelopmentBenchmarkSchedule({
    caseIds: [...caseIds].reverse(), seed: first.seed, corpusSha256: DEVELOPMENT_CORPUS_SHA256,
  });
  assert.deepEqual(first, reordered);
  const changed = schedule("another-retained-seed");
  assert.notDeepEqual(first.attempts.map((item) => item.caseId),
    changed.attempts.map((item) => item.caseId));
  assert.notEqual(first.scheduleSha256, changed.scheduleSha256);
  assert.deepEqual(parseDevelopmentBenchmarkSchedule(first), first);
});

test("parser rejects tampering even when the attacker recomputes a plain JSON hash", () => {
  const baseline = schedule();
  const tampered = structuredClone(baseline);
  tampered.attempts[0]!.armId = tampered.attempts[0]!.armId === "A" ? "B" : "A";
  const { scheduleSha256: _priorHash, ...tamperedBody } = tampered;
  tampered.scheduleSha256 = canonicalJsonSha256(tamperedBody);
  assert.throws(() => parseDevelopmentBenchmarkSchedule(tampered));
  const limit = structuredClone(baseline);
  limit.outputLimitBytes += 1;
  assert.throws(() => parseDevelopmentBenchmarkSchedule(limit));
  const wrongHash = structuredClone(baseline);
  wrongHash.scheduleSha256 = "0".repeat(64);
  assert.throws(() => parseDevelopmentBenchmarkSchedule(wrongHash));
  const duplicate = structuredClone(baseline);
  duplicate.attempts[1]!.id = duplicate.attempts[0]!.id;
  assert.throws(() => parseDevelopmentBenchmarkSchedule(duplicate));
  assert.throws(() => buildDevelopmentBenchmarkSchedule({
    caseIds: [...caseIds.slice(0, 11), caseIds[0]!], seed: "seed", corpusSha256: DEVELOPMENT_CORPUS_SHA256,
  }));
  assert.throws(() => buildDevelopmentBenchmarkSchedule({
    caseIds: [...caseIds.slice(0, 11), "../../private"], seed: "seed", corpusSha256: DEVELOPMENT_CORPUS_SHA256,
  }));
});
