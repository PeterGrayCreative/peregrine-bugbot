import { createHash } from "node:crypto";
import { canonicalJson, canonicalJsonSha256 } from "./experiment.js";
import {
  TRUSTED_LOCAL_REVIEW_DEADLINE_MS,
  TRUSTED_LOCAL_REVIEW_EFFORT,
  TRUSTED_LOCAL_REVIEW_MODEL,
  TRUSTED_LOCAL_REVIEW_OUTPUT_BYTES,
} from "./trusted-local-review-runner.js";

export const DEVELOPMENT_BENCHMARK_PROTOCOL = "historical-development-ab-v1" as const;
export const DEVELOPMENT_CORPUS_SHA256 =
  "a152cb95fe9130b6da7af864bbb7847d3c4ac6b50d72d290c6a3671833d3b1a9" as const;

export interface DevelopmentBenchmarkAttempt {
  id: string;
  sequence: number;
  caseId: string;
  repeat: 1 | 2;
  armId: "A" | "B";
  position: 1 | 2;
}

export interface DevelopmentBenchmarkScheduleBody {
  schemaVersion: 1;
  protocol: typeof DEVELOPMENT_BENCHMARK_PROTOCOL;
  corpusSha256: typeof DEVELOPMENT_CORPUS_SHA256;
  seed: string;
  caseIds: string[];
  model: typeof TRUSTED_LOCAL_REVIEW_MODEL;
  effort: typeof TRUSTED_LOCAL_REVIEW_EFFORT;
  attemptDeadlineMs: number;
  outputLimitBytes: number;
  attempts: DevelopmentBenchmarkAttempt[];
}

export interface DevelopmentBenchmarkSchedule extends DevelopmentBenchmarkScheduleBody {
  scheduleSha256: string;
}

const CASE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SEED = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function strictObject(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const object = value as Record<string, unknown>;
  if (Object.keys(object).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new Error(`${label} has missing or unexpected fields`);
  }
  return object;
}

function parseCaseIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length !== 12 ||
      !value.every((item) => typeof item === "string" && CASE_ID.test(item)) ||
      new Set(value).size !== 12) {
    throw new Error("caseIds must contain exactly 12 unique opaque case IDs");
  }
  return [...value].sort();
}

/** Pure schedule construction. Only opaque IDs may cross this interface. */
export function buildDevelopmentBenchmarkSchedule(input: {
  caseIds: readonly string[];
  seed: string;
  corpusSha256: string;
}): DevelopmentBenchmarkSchedule {
  const caseIds = parseCaseIds(input.caseIds);
  if (typeof input.seed !== "string" || !SEED.test(input.seed)) {
    throw new Error("seed must be a nonempty stable identifier of at most 128 characters");
  }
  if (!SHA256.test(input.corpusSha256) || input.corpusSha256 !== DEVELOPMENT_CORPUS_SHA256) {
    throw new Error("corpusSha256 must match the frozen development corpus digest");
  }
  const ranked = caseIds.map((caseId) => ({
    caseId,
    rank: sha256(`peregrine-development-ab-case-rank-v1\0${input.seed}\0${caseId}`),
  })).sort((a, b) => a.rank.localeCompare(b.rank) || a.caseId.localeCompare(b.caseId));
  const attempts: DevelopmentBenchmarkAttempt[] = [];
  for (const { caseId, rank } of ranked) {
    const firstArm: "A" | "B" = Number.parseInt(rank.slice(-1), 16) % 2 === 0 ? "A" : "B";
    for (const repeat of [1, 2] as const) {
      const order: ["A" | "B", "A" | "B"] =
        (repeat === 1) === (firstArm === "A") ? ["A", "B"] : ["B", "A"];
      for (const [index, armId] of order.entries()) {
        const sequence = attempts.length + 1;
        attempts.push({
          id: `attempt-${String(sequence).padStart(6, "0")}`,
          sequence,
          caseId,
          repeat,
          armId,
          position: (index + 1) as 1 | 2,
        });
      }
    }
  }
  const body: DevelopmentBenchmarkScheduleBody = {
    schemaVersion: 1,
    protocol: DEVELOPMENT_BENCHMARK_PROTOCOL,
    corpusSha256: DEVELOPMENT_CORPUS_SHA256,
    seed: input.seed,
    caseIds,
    model: TRUSTED_LOCAL_REVIEW_MODEL,
    effort: TRUSTED_LOCAL_REVIEW_EFFORT,
    attemptDeadlineMs: TRUSTED_LOCAL_REVIEW_DEADLINE_MS,
    outputLimitBytes: TRUSTED_LOCAL_REVIEW_OUTPUT_BYTES,
    attempts,
  };
  return { ...body, scheduleSha256: canonicalJsonSha256(body) };
}

/** Re-derives every field; callers must bind the digest to an external freeze. */
export function parseDevelopmentBenchmarkSchedule(
  value: unknown,
  source = "development benchmark schedule",
): DevelopmentBenchmarkSchedule {
  const root = strictObject(value, source, [
    "schemaVersion", "protocol", "corpusSha256", "seed", "caseIds", "model", "effort",
    "attemptDeadlineMs", "outputLimitBytes", "attempts", "scheduleSha256",
  ]);
  if (root.schemaVersion !== 1 || root.protocol !== DEVELOPMENT_BENCHMARK_PROTOCOL ||
      root.model !== TRUSTED_LOCAL_REVIEW_MODEL || root.effort !== TRUSTED_LOCAL_REVIEW_EFFORT ||
      root.attemptDeadlineMs !== TRUSTED_LOCAL_REVIEW_DEADLINE_MS ||
      root.outputLimitBytes !== TRUSTED_LOCAL_REVIEW_OUTPUT_BYTES) {
    throw new Error(`${source} has an invalid protocol or runner setting`);
  }
  const expected = buildDevelopmentBenchmarkSchedule({
    caseIds: parseCaseIds(root.caseIds),
    seed: root.seed as string,
    corpusSha256: root.corpusSha256 as string,
  });
  if (canonicalJson(root) !== canonicalJson(expected)) {
    throw new Error(`${source} does not match its derived order, attempts, or SHA256`);
  }
  return expected;
}
