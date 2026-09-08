import { createHash } from "node:crypto";
import { CASE_CORPORA, type CaseCorpus } from "../src/types.js";
import { canonicalJson, seededRandom, shuffle, type ExperimentCase } from "./experiment.js";

export const METHODOLOGY_PROTOCOL = "historical-methodology-v1" as const;
/** Declared model for this protocol; serving identity still needs runtime evidence. */
export const METHODOLOGY_MODEL = "gpt-5.6-sol" as const;
export const METHODOLOGY_ARM_IDS = ["A", "B", "C", "D"] as const;
const MAX_SCHEDULED_ATTEMPTS = 999_999;
export type MethodologyArmId = (typeof METHODOLOGY_ARM_IDS)[number];
export type MethodologyTopology = "single-reviewer" | "two-worker";

const ARM_CONTRACT = {
  A: { topology: "single-reviewer", guidance: "plain" },
  B: { topology: "single-reviewer", guidance: "peregrine" },
  C: { topology: "two-worker", guidance: "generic" },
  D: { topology: "two-worker", guidance: "peregrine" },
} as const satisfies Record<MethodologyArmId, {
  topology: MethodologyTopology;
  guidance: "plain" | "peregrine" | "generic";
}>;

export interface MethodologyArmConfig {
  armId: MethodologyArmId;
  configName: string;
  configIdentitySha256: string;
}

export interface MethodologyDesign {
  schemaVersion: 1;
  protocol: typeof METHODOLOGY_PROTOCOL;
  seed: number;
  repeats: number;
  callerConfig: {
    runner: "codex";
    model: string;
    effort: "high";
    /** Digest of a caller-supplied configuration artifact, not proof of the effective runtime model. */
    identitySha256: string;
  };
  totalDeadlineMs: number;
  twoWorkerStageSplit: {
    discoveryDeadlineMs: number;
    reviewerDeadlineMs: number;
  };
  arms: MethodologyArmConfig[];
}

export interface MethodologyScheduledAttempt {
  id: string;
  blockId: string;
  sequence: number;
  caseName: string;
  corpus: Exclude<CaseCorpus, "structural-smoke">;
  expectedBugCount: number | null;
  repeat: number;
  armId: MethodologyArmId;
  configName: string;
  configIdentitySha256: string;
  position: 1 | 2 | 3 | 4;
  topology: MethodologyTopology;
  expectedStages: 1 | 2;
  stageDeadlineMs: [number] | [number, number];
  file: string;
}

export interface MethodologySchedule {
  schemaVersion: 1;
  protocol: typeof METHODOLOGY_PROTOCOL;
  design: MethodologyDesign;
  cases: ExperimentCase[];
  attempts: MethodologyScheduledAttempt[];
  totals: {
    blocks: number;
    attempts: number;
    reviewModelInvocations: number;
  };
}

const SHA256 = /^[a-f0-9]{64}$/;
const OPAQUE_CASE_ID = /^case-[a-f0-9]{8,32}$/;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const ATTEMPT_ID = /^attempt-[0-9]{6}$/;
const BLOCK_ID = /^block-[0-9]{6}$/;

export function methodologyArmConfigIdentitySha256(input: {
  design: Omit<MethodologyDesign, "arms">;
  armId: MethodologyArmId;
  configName: string;
}): string {
  const contract = ARM_CONTRACT[input.armId];
  return createHash("sha256")
    .update("peregrine-historical-methodology-arm-config-v1\0")
    .update(canonicalJson({
      protocol: METHODOLOGY_PROTOCOL,
      armId: input.armId,
      configName: input.configName,
      topology: contract.topology,
      guidance: contract.guidance,
      callerConfig: input.design.callerConfig,
      totalDeadlineMs: input.design.totalDeadlineMs,
      twoWorkerStageSplit: input.design.twoWorkerStageSplit,
    }))
    .digest("hex");
}

export function buildMethodologySchedule(input: {
  design: MethodologyDesign;
  cases: readonly ExperimentCase[];
}): MethodologySchedule {
  const design = parseMethodologyDesign(input.design);
  const cases = parseCases(input.cases);
  validateScheduleSize(cases.length, design.repeats);
  const random = seededRandom(design.seed);
  const blocks = cases.flatMap((caseItem) =>
    Array.from({ length: design.repeats }, (_, index) => ({ caseItem, repeat: index + 1 })),
  );
  shuffle(blocks, random);
  const baseOrder = [...METHODOLOGY_ARM_IDS];
  shuffle(baseOrder, random);

  const attempts: MethodologyScheduledAttempt[] = [];
  for (const [blockIndex, block] of blocks.entries()) {
    if (!block) throw new Error("internal error: methodology block is absent");
    const blockId = `block-${String(blockIndex + 1).padStart(6, "0")}`;
    const order = baseOrder.map((_, index) => baseOrder[(index + blockIndex) % baseOrder.length]!);
    for (const [positionIndex, armId] of order.entries()) {
      const arm = design.arms.find((candidate) => candidate.armId === armId)!;
      const contract = ARM_CONTRACT[armId];
      const twoWorker = contract.topology === "two-worker";
      const sequence = attempts.length + 1;
      attempts.push({
        id: `attempt-${String(sequence).padStart(6, "0")}`,
        blockId,
        sequence,
        caseName: block.caseItem.caseName,
        corpus: block.caseItem.corpus as Exclude<CaseCorpus, "structural-smoke">,
        expectedBugCount: block.caseItem.expectedBugCount,
        repeat: block.repeat,
        armId,
        configName: arm.configName,
        configIdentitySha256: arm.configIdentitySha256,
        position: (positionIndex + 1) as 1 | 2 | 3 | 4,
        topology: contract.topology,
        expectedStages: twoWorker ? 2 : 1,
        stageDeadlineMs: twoWorker
          ? [design.twoWorkerStageSplit.discoveryDeadlineMs, design.twoWorkerStageSplit.reviewerDeadlineMs]
          : [design.totalDeadlineMs],
        file: `attempt-${String(sequence).padStart(6, "0")}.json`,
      });
    }
  }
  const schedule: MethodologySchedule = {
    schemaVersion: 1,
    protocol: METHODOLOGY_PROTOCOL,
    design,
    cases,
    attempts,
    totals: {
      blocks: blocks.length,
      attempts: attempts.length,
      reviewModelInvocations: attempts.reduce((total, attempt) => total + attempt.expectedStages, 0),
    },
  };
  validateDerivedSchedule(schedule);
  return schedule;
}

/**
 * Re-derivation detects internal schedule tampering. A consumer must still bind the
 * declared caller-config digest and this schedule to external immutable seals, and
 * verify that the effective runtime model is the preregistered Sol identifier.
 */

export function parseMethodologySchedule(
  value: unknown,
  source = "methodology schedule",
): MethodologySchedule {
  const root = strictObject(value, source, ["schemaVersion", "protocol", "design", "cases", "attempts", "totals"]);
  if (root.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  if (root.protocol !== METHODOLOGY_PROTOCOL) throw new Error(`${source}.protocol must be ${METHODOLOGY_PROTOCOL}`);
  const design = parseMethodologyDesign(root.design, `${source}.design`);
  const cases = parseCases(root.cases, `${source}.cases`);
  if (!Array.isArray(root.attempts)) throw new Error(`${source}.attempts must be an array`);
  const attempts = root.attempts.map((attempt, index) => parseAttempt(attempt, `${source}.attempts[${index}]`));
  const totalsRoot = strictObject(root.totals, `${source}.totals`, [
    "blocks", "attempts", "reviewModelInvocations",
  ]);
  const parsed: MethodologySchedule = {
    schemaVersion: 1,
    protocol: METHODOLOGY_PROTOCOL,
    design,
    cases,
    attempts,
    totals: {
      blocks: positiveInteger(totalsRoot.blocks, `${source}.totals.blocks`),
      attempts: positiveInteger(totalsRoot.attempts, `${source}.totals.attempts`),
      reviewModelInvocations: positiveInteger(
        totalsRoot.reviewModelInvocations,
        `${source}.totals.reviewModelInvocations`,
      ),
    },
  };
  const expected = buildMethodologySchedule({ design, cases });
  if (canonicalJson(parsed) !== canonicalJson(expected)) {
    throw new Error(`${source} does not match the schedule derived from its frozen design and cases`);
  }
  return parsed;
}

export function parseMethodologyDesign(
  value: unknown,
  source = "methodology design",
): MethodologyDesign {
  const root = strictObject(value, source, [
    "schemaVersion", "protocol", "seed", "repeats", "callerConfig",
    "totalDeadlineMs", "twoWorkerStageSplit", "arms",
  ]);
  if (root.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  if (root.protocol !== METHODOLOGY_PROTOCOL) throw new Error(`${source}.protocol must be ${METHODOLOGY_PROTOCOL}`);
  const seed = integer(root.seed, `${source}.seed`, 0, 0xffff_ffff);
  const repeats = positiveInteger(root.repeats, `${source}.repeats`);
  const caller = strictObject(root.callerConfig, `${source}.callerConfig`, [
    "runner", "model", "effort", "identitySha256",
  ]);
  if (caller.runner !== "codex") throw new Error(`${source}.callerConfig.runner must be codex`);
  const model = identifier(caller.model, `${source}.callerConfig.model`);
  if (model !== METHODOLOGY_MODEL) throw new Error(`${source}.callerConfig.model must be ${METHODOLOGY_MODEL}`);
  if (caller.effort !== "high") throw new Error(`${source}.callerConfig.effort must be high`);
  const identitySha256 = hash(caller.identitySha256, `${source}.callerConfig.identitySha256`);
  const totalDeadlineMs = positiveInteger(root.totalDeadlineMs, `${source}.totalDeadlineMs`);
  const split = strictObject(root.twoWorkerStageSplit, `${source}.twoWorkerStageSplit`, [
    "discoveryDeadlineMs", "reviewerDeadlineMs",
  ]);
  const discoveryDeadlineMs = positiveInteger(split.discoveryDeadlineMs, `${source}.twoWorkerStageSplit.discoveryDeadlineMs`);
  const reviewerDeadlineMs = positiveInteger(split.reviewerDeadlineMs, `${source}.twoWorkerStageSplit.reviewerDeadlineMs`);
  if (discoveryDeadlineMs + reviewerDeadlineMs !== totalDeadlineMs) {
    throw new Error(`${source}.twoWorkerStageSplit must sum to totalDeadlineMs`);
  }
  const withoutArms: Omit<MethodologyDesign, "arms"> = {
    schemaVersion: 1,
    protocol: METHODOLOGY_PROTOCOL,
    seed,
    repeats,
    callerConfig: { runner: "codex", model, effort: "high", identitySha256 },
    totalDeadlineMs,
    twoWorkerStageSplit: { discoveryDeadlineMs, reviewerDeadlineMs },
  };
  if (!Array.isArray(root.arms) || root.arms.length !== METHODOLOGY_ARM_IDS.length) {
    throw new Error(`${source}.arms must contain exactly A, B, C, and D`);
  }
  const arms = root.arms.map((value, index) => {
    const armSource = `${source}.arms[${index}]`;
    const item = strictObject(value, armSource, ["armId", "configName", "configIdentitySha256"]);
    if (!METHODOLOGY_ARM_IDS.includes(item.armId as MethodologyArmId)) {
      throw new Error(`${armSource}.armId is invalid`);
    }
    const armId = item.armId as MethodologyArmId;
    const configName = identifier(item.configName, `${armSource}.configName`);
    const configIdentitySha256 = hash(item.configIdentitySha256, `${armSource}.configIdentitySha256`);
    const expected = methodologyArmConfigIdentitySha256({ design: withoutArms, armId, configName });
    if (configIdentitySha256 !== expected) throw new Error(`${armSource}.configIdentitySha256 is stale`);
    return { armId, configName, configIdentitySha256 };
  });
  unique(arms.map((arm) => arm.armId), `${source}.arms armId`);
  unique(arms.map((arm) => arm.configName), `${source}.arms configName`);
  arms.sort((left, right) => compareText(left.armId, right.armId));
  return { ...withoutArms, arms };
}

function parseCases(value: unknown, source = "methodology cases"): ExperimentCase[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${source} must be a non-empty array`);
  const cases = value.map((item, index) => {
    const itemSource = `${source}[${index}]`;
    const root = strictObject(item, itemSource, ["caseName", "corpus", "expectedBugCount"]);
    if (!CASE_CORPORA.includes(root.corpus as CaseCorpus) || root.corpus === "structural-smoke") {
      throw new Error(`${itemSource}.corpus must be development or validation`);
    }
    const corpus = root.corpus as Exclude<CaseCorpus, "structural-smoke">;
    const caseName = boundedString(root.caseName, `${itemSource}.caseName`);
    const prefix = `${corpus}/`;
    if (!caseName.startsWith(prefix) || !OPAQUE_CASE_ID.test(caseName.slice(prefix.length))) {
      throw new Error(`${itemSource}.caseName must be an opaque case directly under its corpus`);
    }
    const expectedBugCount = root.expectedBugCount === null
      ? null
      : integer(root.expectedBugCount, `${itemSource}.expectedBugCount`, 0, Number.MAX_SAFE_INTEGER);
    return { caseName, corpus, expectedBugCount };
  });
  unique(cases.map((item) => item.caseName), `${source} caseName`);
  unique(cases.map((item) => item.caseName.slice(item.corpus.length + 1)), `${source} opaque case id`);
  return cases.sort((left, right) => compareText(left.caseName, right.caseName));
}

function parseAttempt(value: unknown, source: string): MethodologyScheduledAttempt {
  const root = strictObject(value, source, [
    "id", "blockId", "sequence", "caseName", "corpus", "expectedBugCount", "repeat",
    "armId", "configName", "configIdentitySha256", "position", "topology",
    "expectedStages", "stageDeadlineMs", "file",
  ]);
  const id = boundedString(root.id, `${source}.id`);
  if (!ATTEMPT_ID.test(id)) throw new Error(`${source}.id is invalid`);
  const blockId = boundedString(root.blockId, `${source}.blockId`);
  if (!BLOCK_ID.test(blockId)) throw new Error(`${source}.blockId is invalid`);
  const corpus = member(root.corpus, ["development", "validation"] as const, `${source}.corpus`);
  const caseName = boundedString(root.caseName, `${source}.caseName`);
  if (!caseName.startsWith(`${corpus}/`) || !OPAQUE_CASE_ID.test(caseName.slice(corpus.length + 1))) {
    throw new Error(`${source}.caseName does not match its corpus`);
  }
  const armId = root.armId as MethodologyArmId;
  if (!METHODOLOGY_ARM_IDS.includes(armId)) throw new Error(`${source}.armId is invalid`);
  if (!Array.isArray(root.stageDeadlineMs) || root.stageDeadlineMs.length < 1 || root.stageDeadlineMs.length > 2) {
    throw new Error(`${source}.stageDeadlineMs is invalid`);
  }
  const stageDeadlineMs = root.stageDeadlineMs.map((item, index) =>
    positiveInteger(item, `${source}.stageDeadlineMs[${index}]`)) as [number] | [number, number];
  return {
    id,
    blockId,
    sequence: positiveInteger(root.sequence, `${source}.sequence`),
    caseName,
    corpus,
    expectedBugCount: root.expectedBugCount === null
      ? null
      : integer(root.expectedBugCount, `${source}.expectedBugCount`, 0, Number.MAX_SAFE_INTEGER),
    repeat: positiveInteger(root.repeat, `${source}.repeat`),
    armId,
    configName: identifier(root.configName, `${source}.configName`),
    configIdentitySha256: hash(root.configIdentitySha256, `${source}.configIdentitySha256`),
    position: integer(root.position, `${source}.position`, 1, 4) as 1 | 2 | 3 | 4,
    topology: member(root.topology, ["single-reviewer", "two-worker"] as const, `${source}.topology`),
    expectedStages: integer(root.expectedStages, `${source}.expectedStages`, 1, 2) as 1 | 2,
    stageDeadlineMs,
    file: boundedString(root.file, `${source}.file`),
  };
}

function validateDerivedSchedule(schedule: MethodologySchedule): void {
  unique(schedule.attempts.map((attempt) => attempt.id), "methodology attempt id");
  unique(schedule.attempts.map((attempt) => attempt.file), "methodology attempt file");
  const blocks = new Map<string, MethodologyScheduledAttempt[]>();
  for (const [index, attempt] of schedule.attempts.entries()) {
    if (attempt.sequence !== index + 1 || attempt.id !== `attempt-${String(index + 1).padStart(6, "0")}` ||
      attempt.file !== `${attempt.id}.json`) throw new Error("methodology attempt sequence is not contiguous");
    const block = blocks.get(attempt.blockId) ?? [];
    block.push(attempt);
    blocks.set(attempt.blockId, block);
  }
  const positions = new Map<string, number>();
  for (const block of blocks.values()) {
    if (block.length !== 4 || new Set(block.map((attempt) => attempt.armId)).size !== 4 ||
      new Set(block.map((attempt) => attempt.position)).size !== 4) {
      throw new Error("each methodology block must contain A, B, C, and D exactly once in distinct positions");
    }
    const identities = new Set(block.map((attempt) => JSON.stringify([
      attempt.caseName, attempt.corpus, attempt.expectedBugCount, attempt.repeat,
    ])));
    if (identities.size !== 1) throw new Error("methodology block attempts must share one case and repeat");
    for (const attempt of block) {
      const key = `${attempt.armId}:${attempt.position}`;
      positions.set(key, (positions.get(key) ?? 0) + 1);
    }
  }
  for (const armId of METHODOLOGY_ARM_IDS) {
    const counts = [1, 2, 3, 4].map((position) => positions.get(`${armId}:${position}`) ?? 0);
    if (Math.max(...counts) - Math.min(...counts) > 1) {
      throw new Error(`methodology arm ${armId} positions are not balanced`);
    }
  }
}

function validateScheduleSize(caseCount: number, repeats: number): void {
  const maximumRepeats = Math.floor(MAX_SCHEDULED_ATTEMPTS / (caseCount * METHODOLOGY_ARM_IDS.length));
  if (repeats > maximumRepeats) {
    throw new Error(`methodology schedule must contain at most ${MAX_SCHEDULED_ATTEMPTS} attempts`);
  }
}

function strictObject(
  value: unknown,
  source: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be an object`);
  const root = value as Record<string, unknown>;
  const expected = new Set(keys);
  const unexpected = Object.keys(root).find((key) => !expected.has(key));
  if (unexpected !== undefined) throw new Error(`${source} contains unsupported fields`);
  const missing = keys.find((key) => !Object.hasOwn(root, key));
  if (missing !== undefined) throw new Error(`${source} is missing ${missing}`);
  return root;
}

function boundedString(value: unknown, source: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 500) throw new Error(`${source} is invalid`);
  return value;
}

function identifier(value: unknown, source: string): string {
  if (typeof value !== "string" || !SAFE_IDENTIFIER.test(value)) throw new Error(`${source} is invalid`);
  return value;
}

function hash(value: unknown, source: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${source} must be a lowercase SHA-256`);
  return value;
}

function integer(value: unknown, source: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${source} must be an integer from ${minimum} through ${maximum}`);
  }
  return Number(value);
}

function positiveInteger(value: unknown, source: string): number {
  return integer(value, source, 1, Number.MAX_SAFE_INTEGER);
}

function member<T extends string>(value: unknown, values: readonly T[], source: string): T {
  if (!values.includes(value as T)) throw new Error(`${source} is invalid`);
  return value as T;
}

function unique(values: readonly string[], source: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${source} must not contain duplicates`);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
