import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveHistoricalMetricEligibility,
  historicalMetricSelection,
  HISTORICAL_METRIC_ELIGIBILITY_TRUST_BOUNDARY,
  HISTORICAL_REPORT_METRICS,
} from "../eval/historical-metric-eligibility.js";
import { historicalPermittedMetrics } from "../eval/historical-truth.js";

function bug(
  id = "bug-1234abcd",
  rootCauseGroup: string | undefined = "root-1234abcd",
) {
  return {
    id,
    ...(rootCauseGroup === undefined ? {} : { rootCauseGroup }),
    lane: "other-unclassified",
    mechanismFamily: "async-lifecycle",
    proofLevel: "complete-static-trace",
    expectedDisposition: "fix-in-pr",
    expectedSeverity: "high",
    file: "src/service.ts",
    startLine: 12,
    endLine: 13,
    description: "A registered historical root.",
    reachablePreconditions: "The public operation reaches this branch.",
    observableImpact: "The operation reports success before completion.",
    provenance: "Historical review and direct repair evidence.",
  };
}

function truth(status: "known-roots" | "reviewed-comparison") {
  return {
    schemaVersion: 2,
    scope: {
      protocol: "historical-efficacy-v1",
      truthVersion: "truth-v1",
      status,
      completeness: "partial",
      reviewedScope: "The changed service boundary.",
      permittedMetrics: historicalPermittedMetrics(status),
    },
    bugs: status === "known-roots" ? [bug()] : [],
  };
}

const observed = { emittedFindings: 3, scheduledReviews: 4 };

test("known-root truth includes only registered recall and partial-truth-safe metrics", () => {
  const historicalTruth = truth("known-roots");
  const result = deriveHistoricalMetricEligibility(historicalTruth, observed);
  assert.deepEqual(result.selections.map((selection) => selection.metric), HISTORICAL_REPORT_METRICS);
  assert.deepEqual(historicalMetricSelection(historicalTruth, observed, "registered-known-root-recall"), {
    metric: "registered-known-root-recall",
    disposition: "included",
    denominator: { source: "registered-known-roots", count: 1 },
    reason: "registered-roots-only",
  });
  assert.equal(historicalMetricSelection(historicalTruth, observed, "total-recall").disposition, "excluded");
  assert.equal(historicalMetricSelection(historicalTruth, observed, "global-clean-specificity").disposition, "excluded");
  assert.equal(historicalMetricSelection(historicalTruth, observed, "emitted-finding-adjudication").disposition, "included");
  assert.equal(historicalMetricSelection(historicalTruth, observed, "novel-discovery").disposition, "included");
  assert.equal(historicalMetricSelection(historicalTruth, observed, "completion").disposition, "included");
  assert.equal(historicalMetricSelection(historicalTruth, observed, "resource-use").disposition, "included");
  assert.match(HISTORICAL_METRIC_ELIGIBILITY_TRUST_BOUNDARY, /authenticate the truth artifact/);
  assert.match(HISTORICAL_METRIC_ELIGIBILITY_TRUST_BOUNDARY, /does not establish provenance/);
});

test("reviewed comparisons enter adjudication and accounting but not recall or global-clean specificity", () => {
  const historicalTruth = truth("reviewed-comparison");
  assert.deepEqual(historicalMetricSelection(historicalTruth, observed, "registered-known-root-recall"), {
    metric: "registered-known-root-recall",
    disposition: "excluded",
    denominator: null,
    reason: "reviewed-comparison-has-no-registered-roots",
  });
  assert.equal(historicalMetricSelection(historicalTruth, observed, "total-recall").disposition, "excluded");
  assert.equal(historicalMetricSelection(historicalTruth, observed, "global-clean-specificity").disposition, "excluded");
  assert.equal(historicalMetricSelection(historicalTruth, observed, "emitted-finding-adjudication").disposition, "included");
  assert.equal(historicalMetricSelection(historicalTruth, observed, "novel-discovery").disposition, "included");
});

test("partial truth does not by itself disable all-emitted finding adjudication", () => {
  const selection = historicalMetricSelection(
    truth("known-roots"),
    observed,
    "emitted-finding-adjudication",
  );
  assert.equal(selection.disposition, "included");
  assert.equal(selection.reason, "all-emitted-findings-require-adjudication");
  assert.deepEqual(selection.denominator, { source: "emitted-findings", count: 3 });
});

test("eligible ratios with empty denominators are unavailable rather than zero", () => {
  const historicalTruth = truth("known-roots");
  const empty = {
    emittedFindings: 0,
    scheduledReviews: 0,
  };
  for (const metric of [
    "emitted-finding-adjudication",
    "novel-discovery",
    "completion",
    "resource-use",
  ] as const) {
    const selection = historicalMetricSelection(historicalTruth, empty, metric);
    assert.equal(selection.disposition, "unavailable");
    assert.equal(selection.reason, "empty-denominator");
    assert.equal(selection.denominator?.count, 0);
  }
  const recall = historicalMetricSelection(historicalTruth, empty, "registered-known-root-recall");
  assert.equal(recall.disposition, "unavailable");
  assert.equal(recall.reason, "no-scheduled-reviews");
  assert.deepEqual(recall.denominator, { source: "registered-known-roots", count: 1 });
});

test("registered recall counts unique causal roots rather than bug observations", () => {
  const shared = truth("known-roots");
  shared.bugs = [
    bug("bug-1111aaaa", "root-aaaa1111"),
    bug("bug-2222bbbb", "root-aaaa1111"),
  ];
  assert.deepEqual(
    historicalMetricSelection(shared, observed, "registered-known-root-recall").denominator,
    { source: "registered-known-roots", count: 1 },
  );

  const distinct = truth("known-roots");
  distinct.bugs = [
    bug("bug-1111aaaa", "root-aaaa1111"),
    bug("bug-2222bbbb", "root-bbbb2222"),
  ];
  assert.deepEqual(
    historicalMetricSelection(distinct, observed, "registered-known-root-recall").denominator,
    { source: "registered-known-roots", count: 2 },
  );
});

test("spoofed truth eligibility and malformed denominator facts reject", () => {
  const spoofed = truth("known-roots");
  spoofed.scope.permittedMetrics = [...spoofed.scope.permittedMetrics, "total-recall" as never];
  assert.throws(
    () => deriveHistoricalMetricEligibility(spoofed, observed),
    /permittedMetrics must equal the derived ordered metric set/,
  );

  assert.throws(
    () => deriveHistoricalMetricEligibility(truth("known-roots"), { ...observed, verdict: "included" }),
    /unsupported field verdict/,
  );
  assert.throws(
    () => deriveHistoricalMetricEligibility(truth("known-roots"), { ...observed, scheduledReviews: -1 }),
    /scheduledReviews must be a nonnegative integer/,
  );
});

test("unknown metrics cannot be selected or injected through parsed truth", () => {
  assert.throws(
    () => historicalMetricSelection(truth("known-roots"), observed, "precision"),
    /historical metric is unknown/,
  );

  const unknown = truth("known-roots");
  unknown.scope.permittedMetrics = ["precision" as never];
  assert.throws(
    () => deriveHistoricalMetricEligibility(unknown, observed),
    /permittedMetrics must equal the derived ordered metric set/,
  );
});
