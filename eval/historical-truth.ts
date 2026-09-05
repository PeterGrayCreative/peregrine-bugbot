import { isCoreLaneId, type CoreLaneId } from "../src/core/lanes.js";
import type { GroundTruthBug } from "../src/types.js";

export const HISTORICAL_EFFICACY_PROTOCOL = "historical-efficacy-v1" as const;
export const HISTORICAL_TRUTH_METRICS = [
  "known-root-recall",
  "finding-adjudication",
  "novel-discovery",
  "completion",
  "resource-use",
] as const;

export type HistoricalTruthMetric = (typeof HISTORICAL_TRUTH_METRICS)[number];
export type HistoricalTruthStatus = "known-roots" | "reviewed-comparison";
export type HistoricalProofLevel = "reproduced" | "complete-static-trace";
export type HistoricalTruthLane = CoreLaneId | "other-unclassified";

export interface HistoricalTruthBug extends Omit<GroundTruthBug, "lane"> {
  lane: HistoricalTruthLane;
  mechanismFamily: string;
  proofLevel: HistoricalProofLevel;
}

export interface HistoricalTruthScope {
  protocol: typeof HISTORICAL_EFFICACY_PROTOCOL;
  truthVersion: string;
  status: HistoricalTruthStatus;
  completeness: "partial";
  reviewedScope: string;
  permittedMetrics: HistoricalTruthMetric[];
}

export interface HistoricalGroundTruth {
  schemaVersion: 2;
  scope: HistoricalTruthScope;
  bugs: HistoricalTruthBug[];
}

const OPAQUE_BUG_ID = /^bug-[a-f0-9]{8,32}$/;
const OPAQUE_ROOT_CAUSE_ID = /^root-[a-f0-9]{8,32}$/;
const TRUTH_VERSION = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MECHANISM_FAMILY = /^[a-z0-9][a-z0-9-]{1,63}$/;
const BUG_KEYS = [
  "id",
  "rootCauseGroup",
  "lane",
  "mechanismFamily",
  "proofLevel",
  "expectedDisposition",
  "expectedSeverity",
  "file",
  "startLine",
  "endLine",
  "description",
  "reachablePreconditions",
  "observableImpact",
  "provenance",
] as const;

export function historicalPermittedMetrics(status: HistoricalTruthStatus): HistoricalTruthMetric[] {
  return status === "known-roots"
    ? [...HISTORICAL_TRUTH_METRICS]
    : HISTORICAL_TRUTH_METRICS.filter((metric) => metric !== "known-root-recall");
}

export function parseHistoricalGroundTruth(
  value: unknown,
  label = "historical ground truth",
): HistoricalGroundTruth {
  const root = strictObject(value, label, ["schemaVersion", "scope", "bugs"]);
  if (root.schemaVersion !== 2) throw new Error(`${label}.schemaVersion must be 2`);

  const rawScope = strictObject(root.scope, `${label}.scope`, [
    "protocol",
    "truthVersion",
    "status",
    "completeness",
    "reviewedScope",
    "permittedMetrics",
  ]);
  if (rawScope.protocol !== HISTORICAL_EFFICACY_PROTOCOL) {
    throw new Error(`${label}.scope.protocol must be ${HISTORICAL_EFFICACY_PROTOCOL}`);
  }
  if (typeof rawScope.truthVersion !== "string" || !TRUTH_VERSION.test(rawScope.truthVersion)) {
    throw new Error(`${label}.scope.truthVersion is invalid`);
  }
  if (rawScope.status !== "known-roots" && rawScope.status !== "reviewed-comparison") {
    throw new Error(`${label}.scope.status is invalid`);
  }
  if (rawScope.completeness !== "partial") {
    throw new Error(`${label}.scope.completeness must be partial`);
  }
  const reviewedScope = boundedText(rawScope.reviewedScope, 1, 4_000, `${label}.scope.reviewedScope`);
  const expectedMetrics = historicalPermittedMetrics(rawScope.status);
  if (!Array.isArray(rawScope.permittedMetrics) ||
    rawScope.permittedMetrics.length !== expectedMetrics.length ||
    rawScope.permittedMetrics.some((metric, index) => metric !== expectedMetrics[index])) {
    throw new Error(`${label}.scope.permittedMetrics must equal the derived ordered metric set`);
  }

  if (!Array.isArray(root.bugs)) throw new Error(`${label}.bugs must be an array`);
  if (rawScope.status === "known-roots" && root.bugs.length === 0) {
    throw new Error(`${label} known-roots truth needs at least one registered bug`);
  }
  if (rawScope.status === "reviewed-comparison" && root.bugs.length !== 0) {
    throw new Error(`${label} reviewed-comparison truth cannot register known bugs`);
  }

  const ids = new Set<string>();
  const bugs = root.bugs.map((rawBug, index) => {
    const bug = strictObject(
      rawBug,
      `${label}.bugs[${index}]`,
      BUG_KEYS.filter((key) => key !== "rootCauseGroup"),
      ["rootCauseGroup"],
    );
    if (typeof bug.id !== "string" || !OPAQUE_BUG_ID.test(bug.id)) {
      throw new Error(`${label}.bugs[${index}].id must match ${OPAQUE_BUG_ID.source}`);
    }
    if (ids.has(bug.id)) throw new Error(`${label}.bugs[${index}].id is duplicated`);
    ids.add(bug.id);
    if (bug.rootCauseGroup !== undefined &&
      (typeof bug.rootCauseGroup !== "string" || !OPAQUE_ROOT_CAUSE_ID.test(bug.rootCauseGroup))) {
      throw new Error(`${label}.bugs[${index}].rootCauseGroup must match ${OPAQUE_ROOT_CAUSE_ID.source}`);
    }
    if (bug.lane !== "other-unclassified" && !isCoreLaneId(bug.lane)) {
      throw new Error(`${label}.bugs[${index}].lane must be a core lane or other-unclassified`);
    }
    if (typeof bug.mechanismFamily !== "string" || !MECHANISM_FAMILY.test(bug.mechanismFamily)) {
      throw new Error(`${label}.bugs[${index}].mechanismFamily is invalid`);
    }
    if (bug.proofLevel !== "reproduced" && bug.proofLevel !== "complete-static-trace") {
      throw new Error(`${label}.bugs[${index}].proofLevel is invalid`);
    }
    if (bug.expectedDisposition !== "fix-in-pr" && bug.expectedDisposition !== "follow-up") {
      throw new Error(`${label}.bugs[${index}].expectedDisposition is invalid`);
    }
    if (bug.expectedSeverity !== "high" && bug.expectedSeverity !== "medium" && bug.expectedSeverity !== "low") {
      throw new Error(`${label}.bugs[${index}].expectedSeverity is invalid`);
    }
    if (typeof bug.file !== "string" || !safeRelativePath(bug.file)) {
      throw new Error(`${label}.bugs[${index}].file must be a safe repository-relative path`);
    }
    if (!Number.isSafeInteger(bug.startLine) || !Number.isSafeInteger(bug.endLine) ||
      Number(bug.startLine) < 1 || Number(bug.endLine) < Number(bug.startLine)) {
      throw new Error(`${label}.bugs[${index}] needs a valid positive line range`);
    }
    const description = boundedText(bug.description, 1, 8_000, `${label}.bugs[${index}].description`);
    const reachablePreconditions = boundedText(
      bug.reachablePreconditions,
      1,
      8_000,
      `${label}.bugs[${index}].reachablePreconditions`,
    );
    const observableImpact = boundedText(
      bug.observableImpact,
      1,
      8_000,
      `${label}.bugs[${index}].observableImpact`,
    );
    const provenance = boundedText(bug.provenance, 1, 8_000, `${label}.bugs[${index}].provenance`);

    return {
      id: bug.id,
      ...(bug.rootCauseGroup === undefined ? {} : { rootCauseGroup: bug.rootCauseGroup }),
      lane: bug.lane as HistoricalTruthLane,
      mechanismFamily: bug.mechanismFamily,
      proofLevel: bug.proofLevel,
      expectedDisposition: bug.expectedDisposition,
      expectedSeverity: bug.expectedSeverity,
      file: bug.file,
      startLine: Number(bug.startLine),
      endLine: Number(bug.endLine),
      description,
      reachablePreconditions,
      observableImpact,
      provenance,
    } satisfies HistoricalTruthBug;
  });

  return {
    schemaVersion: 2,
    scope: {
      protocol: HISTORICAL_EFFICACY_PROTOCOL,
      truthVersion: rawScope.truthVersion,
      status: rawScope.status,
      completeness: "partial",
      reviewedScope,
      permittedMetrics: expectedMetrics,
    },
    bugs,
  };
}

function strictObject(
  value: unknown,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const root = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  const unexpected = Object.keys(root).find((key) => !allowed.has(key));
  if (unexpected !== undefined) throw new Error(`${label} contains unsupported field ${unexpected}`);
  const missing = required.find((key) => !Object.hasOwn(root, key));
  if (missing !== undefined) throw new Error(`${label} is missing ${missing}`);
  return root;
}

function boundedText(value: unknown, minimum: number, maximum: number, label: string): string {
  if (typeof value !== "string" || value.trim().length < minimum || value.length > maximum) {
    throw new Error(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function safeRelativePath(value: string): boolean {
  return value.length > 0 && value.length <= 512 && value === value.trim() &&
    !value.startsWith("/") && !value.startsWith("\\") && !value.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !value.split("/").some((part) => part === "" || part === "." || part === "..");
}
