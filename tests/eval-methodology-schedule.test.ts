import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMethodologySchedule,
  methodologyArmConfigIdentitySha256,
  parseMethodologyDesign,
  parseMethodologySchedule,
  type MethodologyDesign,
} from "../eval/methodology-schedule.js";
import type { ExperimentCase } from "../eval/experiment.js";

function design(): MethodologyDesign {
  const withoutArms: Omit<MethodologyDesign, "arms"> = {
    schemaVersion: 1,
    protocol: "historical-methodology-v1",
    seed: 90210,
    repeats: 2,
    callerConfig: {
      runner: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      identitySha256: "a".repeat(64),
    },
    totalDeadlineMs: 600_000,
    twoWorkerStageSplit: {
      discoveryDeadlineMs: 210_000,
      reviewerDeadlineMs: 390_000,
    },
  };
  return {
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
  };
}

function cases(count = 12): ExperimentCase[] {
  return Array.from({ length: count }, (_, index) => ({
    caseName: `${index % 2 === 0 ? "development" : "validation"}/case-${(index + 1).toString(16).padStart(8, "0")}`,
    corpus: index % 2 === 0 ? "development" as const : "validation" as const,
    expectedBugCount: index % 3 === 0 ? 0 : 1,
  }));
}

test("twelve cases and two repeats derive 24 balanced four-arm blocks and 144 invocations", () => {
  const schedule = buildMethodologySchedule({ design: design(), cases: cases() });
  assert.deepEqual(schedule.totals, {
    blocks: 24,
    attempts: 96,
    reviewModelInvocations: 144,
  });
  const blocks = new Map<string, typeof schedule.attempts>();
  for (const attempt of schedule.attempts) {
    const block = blocks.get(attempt.blockId) ?? [];
    block.push(attempt);
    blocks.set(attempt.blockId, block);
  }
  assert.equal(blocks.size, 24);
  for (const block of blocks.values()) {
    assert.deepEqual([...block].sort((a, b) => a.armId.localeCompare(b.armId)).map((item) => item.armId),
      ["A", "B", "C", "D"]);
    assert.deepEqual([...block].sort((a, b) => a.position - b.position).map((item) => item.position),
      [1, 2, 3, 4]);
  }
  for (const armId of ["A", "B", "C", "D"] as const) {
    assert.deepEqual([1, 2, 3, 4].map((position) =>
      schedule.attempts.filter((attempt) => attempt.armId === armId && attempt.position === position).length),
    [6, 6, 6, 6]);
  }
  assert.equal(schedule.attempts.filter((attempt) => attempt.expectedStages === 1).length, 48);
  assert.equal(schedule.attempts.filter((attempt) => attempt.expectedStages === 2).length, 48);
  assert.ok(schedule.attempts
    .filter((attempt) => attempt.armId === "A" || attempt.armId === "B")
    .every((attempt) => attempt.topology === "single-reviewer" &&
      JSON.stringify(attempt.stageDeadlineMs) === "[600000]"));
  assert.ok(schedule.attempts
    .filter((attempt) => attempt.armId === "C" || attempt.armId === "D")
    .every((attempt) => attempt.topology === "two-worker" &&
      JSON.stringify(attempt.stageDeadlineMs) === "[210000,390000]"));
});

test("the schedule round-trips by rederivation and is deterministic", () => {
  const input = { design: design(), cases: cases() };
  const first = buildMethodologySchedule(input);
  const second = buildMethodologySchedule({ design: structuredClone(input.design), cases: [...input.cases].reverse() });
  assert.deepEqual(first, second);
  assert.deepEqual(parseMethodologySchedule(JSON.parse(JSON.stringify(first))), first);

  const changedSeed = design();
  changedSeed.seed++;
  changedSeed.arms = designWithReboundArms(changedSeed).arms;
  assert.notDeepEqual(
    buildMethodologySchedule({ design: changedSeed, cases: cases() }).attempts.map((attempt) => attempt.caseName),
    first.attempts.map((attempt) => attempt.caseName),
  );
});

test("arbitrary corpus size stays balanced without a hard-coded panel size", () => {
  const value = design();
  value.repeats = 1;
  value.arms = designWithReboundArms(value).arms;
  const schedule = buildMethodologySchedule({ design: value, cases: cases(3) });
  assert.deepEqual(schedule.totals, { blocks: 3, attempts: 12, reviewModelInvocations: 18 });
  for (const armId of ["A", "B", "C", "D"] as const) {
    const counts = [1, 2, 3, 4].map((position) =>
      schedule.attempts.filter((attempt) => attempt.armId === armId && attempt.position === position).length);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  }
});

test("rejects an oversized schedule before allocating case-repeat blocks", () => {
  const value = design();
  value.repeats = 250_000;
  value.arms = designWithReboundArms(value).arms;
  assert.throws(
    () => buildMethodologySchedule({ design: value, cases: cases(1) }),
    /must contain at most 999999 attempts/,
  );
});

test("design rejects missing, duplicate, stale, heterogeneous, and cross-protocol arms", () => {
  const missing = design();
  missing.arms.pop();
  assert.throws(() => parseMethodologyDesign(missing), /exactly A, B, C, and D/);

  const duplicate = design();
  duplicate.arms[3] = structuredClone(duplicate.arms[0]!);
  assert.throws(() => parseMethodologyDesign(duplicate), /armId must not contain duplicates/);

  const stale = design();
  stale.totalDeadlineMs++;
  assert.throws(() => parseMethodologyDesign(stale), /twoWorkerStageSplit must sum|configIdentitySha256 is stale/);

  const changedCaller = design();
  changedCaller.callerConfig.identitySha256 = "b".repeat(64);
  assert.throws(() => parseMethodologyDesign(changedCaller), /configIdentitySha256 is stale/);

  const pollutedModel = design();
  pollutedModel.callerConfig.model = " gpt-5.6-sol";
  assert.throws(() => parseMethodologyDesign(pollutedModel), /callerConfig.model is invalid/);

  const pollutedConfig = design();
  pollutedConfig.arms[0]!.configName = "methodology-a\nforged";
  assert.throws(() => parseMethodologyDesign(pollutedConfig), /configName is invalid/);

  const effort = design() as unknown as Record<string, any>;
  effort.callerConfig.effort = "medium";
  assert.throws(() => parseMethodologyDesign(effort), /effort must be high/);

  const substitutedModel = design();
  substitutedModel.callerConfig.model = "gpt-5.6-luna";
  substitutedModel.arms = designWithReboundArms(substitutedModel).arms;
  assert.throws(() => parseMethodologyDesign(substitutedModel), /model must be gpt-5.6-sol/);

  const protocol = design() as unknown as Record<string, unknown>;
  protocol.protocol = "historical-efficacy-v1";
  assert.throws(() => parseMethodologyDesign(protocol), /protocol must be historical-methodology-v1/);
});

test("round-trip validation rejects attempt and total tampering", () => {
  const position = structuredClone(buildMethodologySchedule({ design: design(), cases: cases(2) }));
  position.attempts[0]!.position = 4;
  assert.throws(() => parseMethodologySchedule(position), /derived from its frozen design and cases/);

  const identity = structuredClone(buildMethodologySchedule({ design: design(), cases: cases(2) }));
  identity.attempts[0]!.configIdentitySha256 = "f".repeat(64);
  assert.throws(() => parseMethodologySchedule(identity), /derived from its frozen design and cases/);

  const total = structuredClone(buildMethodologySchedule({ design: design(), cases: cases(2) }));
  total.totals.reviewModelInvocations--;
  assert.throws(() => parseMethodologySchedule(total), /derived from its frozen design and cases/);

  const protocol = structuredClone(buildMethodologySchedule({ design: design(), cases: cases(2) })) as
    unknown as Record<string, unknown>;
  protocol.protocol = "historical-efficacy-v1";
  assert.throws(() => parseMethodologySchedule(protocol), /protocol must be historical-methodology-v1/);
});

test("case descriptors reject duplicates, structural cases, and corpus mismatches", () => {
  const duplicate = cases(2);
  duplicate.push(structuredClone(duplicate[0]!));
  assert.throws(
    () => buildMethodologySchedule({ design: design(), cases: duplicate }),
    /caseName must not contain duplicates/,
  );
  assert.throws(() => buildMethodologySchedule({
    design: design(),
    cases: [
      { caseName: "development/case-aaaaaaaa", corpus: "development", expectedBugCount: 1 },
      { caseName: "validation/case-aaaaaaaa", corpus: "validation", expectedBugCount: 1 },
    ],
  }), /opaque case id must not contain duplicates/);
  assert.throws(() => buildMethodologySchedule({
    design: design(),
    cases: [{ caseName: "structural-smoke/case-aaaaaaaa", corpus: "structural-smoke", expectedBugCount: null }],
  }), /corpus must be development or validation/);
  assert.throws(() => buildMethodologySchedule({
    design: design(),
    cases: [{ caseName: "validation/case-aaaaaaaa", corpus: "development", expectedBugCount: 1 }],
  }), /caseName must be an opaque case directly under its corpus/);
});

function designWithReboundArms(value: MethodologyDesign): MethodologyDesign {
  const { arms: _ignored, ...withoutArms } = value;
  return {
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
  };
}
