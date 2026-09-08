import {
  HISTORICAL_EFFICACY_PROTOCOL,
  parseHistoricalGroundTruth,
  type HistoricalGroundTruth,
  type HistoricalTruthStatus,
} from "./historical-truth.js";

export const HISTORICAL_REPORT_METRICS = [
  "registered-known-root-recall",
  "total-recall",
  "emitted-finding-adjudication",
  "novel-discovery",
  "completion",
  "resource-use",
  "global-clean-specificity",
] as const;

export type HistoricalReportMetric = (typeof HISTORICAL_REPORT_METRICS)[number];
export type HistoricalMetricDisposition = "included" | "excluded" | "unavailable";
export type HistoricalMetricDenominatorSource =
  | "registered-known-roots"
  | "emitted-findings"
  | "scheduled-reviews";

export interface HistoricalMetricDenominators {
  emittedFindings: number;
  scheduledReviews: number;
}

export interface HistoricalMetricSelection {
  metric: HistoricalReportMetric;
  disposition: HistoricalMetricDisposition;
  denominator: {
    source: HistoricalMetricDenominatorSource;
    count: number;
  } | null;
  reason:
    | "registered-roots-only"
    | "partial-truth-blocks-total-recall"
    | "reviewed-comparison-has-no-registered-roots"
    | "all-emitted-findings-require-adjudication"
    | "discovery-is-separate-from-frozen-known-roots"
    | "scheduled-review-accounting"
    | "partial-truth-is-not-global-cleanliness"
    | "empty-denominator"
    | "no-scheduled-reviews";
}

export interface HistoricalMetricEligibility {
  protocol: typeof HISTORICAL_EFFICACY_PROTOCOL;
  truthVersion: string;
  truthStatus: HistoricalTruthStatus;
  truthCompleteness: "partial";
  selections: HistoricalMetricSelection[];
}

export const HISTORICAL_METRIC_ELIGIBILITY_TRUST_BOUNDARY =
  "This primitive derives metric policy from parsed historical truth. Its consumer must authenticate the truth artifact and observed denominator counts; it does not establish provenance, adjudication completeness, or statistical validity.";

/**
 * Derive reporting eligibility without changing legacy report or funnel policy.
 *
 * Partial historical truth can measure recall only over its frozen registered
 * roots. It does not prevent precision-like analysis when every emitted
 * finding is independently adjudicated; unresolved findings remain the
 * consumer's responsibility and must be represented through bounds.
 */
export function deriveHistoricalMetricEligibility(
  value: unknown,
  denominatorValue: unknown,
  label = "historical metric eligibility",
): HistoricalMetricEligibility {
  const truth = parseHistoricalGroundTruth(value, `${label}.truth`);
  const denominators = parseDenominators(denominatorValue, `${label}.denominators`);

  return {
    protocol: HISTORICAL_EFFICACY_PROTOCOL,
    truthVersion: truth.scope.truthVersion,
    truthStatus: truth.scope.status,
    truthCompleteness: "partial",
    selections: HISTORICAL_REPORT_METRICS.map((metric) =>
      selectMetric(truth, denominators, metric)),
  };
}

/** Re-derive policy and reject unknown metric names before selecting one row. */
export function historicalMetricSelection(
  value: unknown,
  denominatorValue: unknown,
  metricValue: unknown,
): HistoricalMetricSelection {
  if (typeof metricValue !== "string" ||
    !(HISTORICAL_REPORT_METRICS as readonly string[]).includes(metricValue)) {
    throw new Error(`historical metric is unknown: ${String(metricValue)}`);
  }
  const metric = metricValue as HistoricalReportMetric;
  const eligibility = deriveHistoricalMetricEligibility(value, denominatorValue);
  const selection = eligibility.selections.find((candidate) => candidate.metric === metric);
  if (!selection) {
    throw new Error(`historical metric eligibility is missing ${metric}`);
  }
  return selection;
}

function selectMetric(
  truth: HistoricalGroundTruth,
  denominators: HistoricalMetricDenominators,
  metric: HistoricalReportMetric,
): HistoricalMetricSelection {
  switch (metric) {
    case "registered-known-root-recall":
      if (truth.scope.status === "reviewed-comparison") {
        return excluded(metric, "reviewed-comparison-has-no-registered-roots");
      }
      if (denominators.scheduledReviews === 0) {
        return unavailable(
          metric,
          "registered-known-roots",
          registeredRootCount(truth),
          "no-scheduled-reviews",
        );
      }
      return withDenominator(
        metric,
        "registered-known-roots",
        registeredRootCount(truth),
        "registered-roots-only",
      );
    case "total-recall":
      return excluded(metric, "partial-truth-blocks-total-recall");
    case "emitted-finding-adjudication":
      return withDenominator(
        metric,
        "emitted-findings",
        denominators.emittedFindings,
        "all-emitted-findings-require-adjudication",
      );
    case "novel-discovery":
      return withDenominator(
        metric,
        "scheduled-reviews",
        denominators.scheduledReviews,
        "discovery-is-separate-from-frozen-known-roots",
      );
    case "completion":
    case "resource-use":
      return withDenominator(
        metric,
        "scheduled-reviews",
        denominators.scheduledReviews,
        "scheduled-review-accounting",
      );
    case "global-clean-specificity":
      return excluded(metric, "partial-truth-is-not-global-cleanliness");
  }
}

function withDenominator(
  metric: HistoricalReportMetric,
  source: HistoricalMetricDenominatorSource,
  count: number,
  reason: HistoricalMetricSelection["reason"],
): HistoricalMetricSelection {
  if (count === 0) {
    return {
      metric,
      disposition: "unavailable",
      denominator: { source, count },
      reason: "empty-denominator",
    };
  }
  return {
    metric,
    disposition: "included",
    denominator: { source, count },
    reason,
  };
}

function unavailable(
  metric: HistoricalReportMetric,
  source: HistoricalMetricDenominatorSource,
  count: number,
  reason: HistoricalMetricSelection["reason"],
): HistoricalMetricSelection {
  return {
    metric,
    disposition: "unavailable",
    denominator: { source, count },
    reason,
  };
}

/**
 * Count causal roots within one registered case review. This intentionally
 * does not multiply roots by scheduled repeats. A future estimator must score
 * every scheduled repeat failure-inclusively, then aggregate those outcomes.
 */
function registeredRootCount(truth: HistoricalGroundTruth): number {
  return new Set(truth.bugs.map((bug) => bug.rootCauseGroup ?? bug.id)).size;
}

function excluded(
  metric: HistoricalReportMetric,
  reason: HistoricalMetricSelection["reason"],
): HistoricalMetricSelection {
  return { metric, disposition: "excluded", denominator: null, reason };
}

function parseDenominators(value: unknown, label: string): HistoricalMetricDenominators {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const object = value as Record<string, unknown>;
  const allowed = new Set(["emittedFindings", "scheduledReviews"]);
  const unexpected = Object.keys(object).find((key) => !allowed.has(key));
  if (unexpected !== undefined) throw new Error(`${label} contains unsupported field ${unexpected}`);
  for (const key of allowed) {
    if (!Object.hasOwn(object, key)) throw new Error(`${label} is missing ${key}`);
  }
  return {
    emittedFindings: nonnegativeInteger(object.emittedFindings, `${label}.emittedFindings`),
    scheduledReviews: nonnegativeInteger(object.scheduledReviews, `${label}.scheduledReviews`),
  };
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a nonnegative integer`);
  }
  return Number(value);
}
