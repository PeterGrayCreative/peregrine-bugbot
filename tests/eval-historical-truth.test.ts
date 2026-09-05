import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseGroundTruth, parseBehavioralGroundTruth } from "../eval/case-truth.js";
import {
  historicalPermittedMetrics,
  parseHistoricalGroundTruth,
} from "../eval/historical-truth.js";

function knownRoot(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    scope: {
      protocol: "historical-efficacy-v1",
      truthVersion: "truth-v1",
      status: "known-roots",
      completeness: "partial",
      reviewedScope: "The exact base-to-head review opportunity and registered causal root.",
      permittedMetrics: historicalPermittedMetrics("known-roots"),
    },
    bugs: [{
      id: "bug-aaaaaaaa",
      rootCauseGroup: "root-bbbbbbbb",
      lane: "other-unclassified",
      mechanismFamily: "callback-loss",
      proofLevel: "complete-static-trace",
      expectedDisposition: "fix-in-pr",
      expectedSeverity: "high",
      file: "src/worker.ts",
      startLine: 12,
      endLine: 14,
      description: "The new branch drops the completion callback.",
      reachablePreconditions: "The worker takes the retry branch.",
      observableImpact: "The request remains pending indefinitely.",
      provenance: "The exact historical head and later fix establish this root.",
    }],
  };
}

function comparison(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    scope: {
      protocol: "historical-efficacy-v1",
      truthVersion: "truth-v1",
      status: "reviewed-comparison",
      completeness: "partial",
      reviewedScope: "Retry callback selection only; this is not a global clean claim.",
      permittedMetrics: historicalPermittedMetrics("reviewed-comparison"),
    },
    bugs: [],
  };
}

test("legacy readers cannot erase historical scope or reinterpret a partial comparison as clean", () => {
  for (const truth of [knownRoot(), comparison()]) {
    assert.throws(() => parseGroundTruth(truth), /protocol-specific reader/);
    assert.throws(() => parseBehavioralGroundTruth(truth), /only a bugs array/);
  }
  assert.deepEqual(parseGroundTruth({ bugs: [] }), { bugs: [] });
  assert.deepEqual(parseBehavioralGroundTruth({ bugs: [] }), { bugs: [] });
});

test("historical known-root truth accepts an unclassified mechanism without disguising it as a lane", () => {
  const parsed = parseHistoricalGroundTruth(knownRoot());
  assert.equal(parsed.scope.status, "known-roots");
  assert.equal(parsed.scope.completeness, "partial");
  assert.deepEqual(parsed.scope.permittedMetrics, [
    "known-root-recall",
    "finding-adjudication",
    "novel-discovery",
    "completion",
    "resource-use",
  ]);
  assert.equal(parsed.bugs[0]?.lane, "other-unclassified");
  assert.equal(parsed.bugs[0]?.mechanismFamily, "callback-loss");

  const ungrouped = knownRoot();
  delete ((ungrouped.bugs as Record<string, unknown>[])[0]!).rootCauseGroup;
  assert.equal(parseHistoricalGroundTruth(ungrouped).bugs[0]?.rootCauseGroup, undefined);
});

test("reviewed comparisons are partial, contain no registered bugs, and cannot enter recall", () => {
  const parsed = parseHistoricalGroundTruth(comparison());
  assert.equal(parsed.scope.status, "reviewed-comparison");
  assert.equal(parsed.scope.reviewedScope.includes("not a global clean claim"), true);
  assert.equal(parsed.scope.permittedMetrics.includes("known-root-recall"), false);
  assert.deepEqual(parsed.bugs, []);

  const withBug = comparison();
  withBug.bugs = (knownRoot().bugs as unknown[]);
  assert.throws(() => parseHistoricalGroundTruth(withBug), /cannot register known bugs/);
});

test("known-root truth requires a root and the exact derived metric set", () => {
  const empty = knownRoot();
  empty.bugs = [];
  assert.throws(() => parseHistoricalGroundTruth(empty), /needs at least one registered bug/);

  const missingMetric = knownRoot();
  (missingMetric.scope as Record<string, unknown>).permittedMetrics = ["finding-adjudication"];
  assert.throws(() => parseHistoricalGroundTruth(missingMetric), /derived ordered metric set/);

  const reordered = knownRoot();
  (reordered.scope as Record<string, unknown>).permittedMetrics = [
    "finding-adjudication", "known-root-recall", "novel-discovery", "completion", "resource-use",
  ];
  assert.throws(() => parseHistoricalGroundTruth(reordered), /derived ordered metric set/);
});

test("historical scope rejects unsupported statuses, completeness claims, and unknown fields", () => {
  const clean = comparison();
  (clean.scope as Record<string, unknown>).status = "clean";
  assert.throws(() => parseHistoricalGroundTruth(clean), /status is invalid/);

  const complete = comparison();
  (complete.scope as Record<string, unknown>).completeness = "complete";
  assert.throws(() => parseHistoricalGroundTruth(complete), /must be partial/);

  const unknown = comparison();
  (unknown.scope as Record<string, unknown>).answerCatalog = "hidden";
  assert.throws(() => parseHistoricalGroundTruth(unknown), /unsupported field answerCatalog/);
});

test("historical bugs reject lane disguises, unsafe locations, invalid lines, and duplicate IDs", () => {
  const disguised = knownRoot();
  ((disguised.bugs as Record<string, unknown>[])[0]!).lane = "generic-logic";
  assert.throws(() => parseHistoricalGroundTruth(disguised), /core lane or other-unclassified/);

  const unsafe = knownRoot();
  ((unsafe.bugs as Record<string, unknown>[])[0]!).file = "../answer.ts";
  assert.throws(() => parseHistoricalGroundTruth(unsafe), /safe repository-relative path/);

  const malformed = knownRoot();
  ((malformed.bugs as Record<string, unknown>[])[0]!).file = "src//answer.ts";
  assert.throws(() => parseHistoricalGroundTruth(malformed), /safe repository-relative path/);

  const lines = knownRoot();
  ((lines.bugs as Record<string, unknown>[])[0]!).startLine = 0;
  assert.throws(() => parseHistoricalGroundTruth(lines), /valid positive line range/);

  const duplicate = knownRoot();
  duplicate.bugs = [
    (duplicate.bugs as Record<string, unknown>[])[0],
    { ...(duplicate.bugs as Record<string, unknown>[])[0] },
  ];
  assert.throws(() => parseHistoricalGroundTruth(duplicate), /duplicated/);
});

test("historical bugs require causal evidence, mechanism family, and supported proof level", () => {
  const missingTrace = knownRoot();
  delete ((missingTrace.bugs as Record<string, unknown>[])[0]!).reachablePreconditions;
  assert.throws(() => parseHistoricalGroundTruth(missingTrace), /missing reachablePreconditions/);

  const blankImpact = knownRoot();
  ((blankImpact.bugs as Record<string, unknown>[])[0]!).observableImpact = "   ";
  assert.throws(() => parseHistoricalGroundTruth(blankImpact), /non-empty bounded string/);

  const mechanism = knownRoot();
  ((mechanism.bugs as Record<string, unknown>[])[0]!).mechanismFamily = "Callback Loss";
  assert.throws(() => parseHistoricalGroundTruth(mechanism), /mechanismFamily is invalid/);

  const unresolved = knownRoot();
  ((unresolved.bugs as Record<string, unknown>[])[0]!).proofLevel = "unresolved";
  assert.throws(() => parseHistoricalGroundTruth(unresolved), /proofLevel is invalid/);

  const unknown = knownRoot();
  ((unknown.bugs as Record<string, unknown>[])[0]!).laterFix = "hidden";
  assert.throws(() => parseHistoricalGroundTruth(unknown), /unsupported field laterFix/);
});

test("the checked-in schema preserves the parser's protocol, status, metric, and lane boundary", () => {
  const schema = JSON.parse(readFileSync(
    join(process.cwd(), "schemas/historical-benchmark-truth.schema.json"),
    "utf8",
  )) as {
    properties: { schemaVersion: { const: number }; scope: { properties: Record<string, unknown> } };
    allOf: Array<{ then: { properties: { scope: { properties: { permittedMetrics: { const: string[] } } } } } }>;
    $defs: { bug: { properties: { lane: { enum: string[] }; proofLevel: { enum: string[] } } } };
  };
  assert.equal(schema.properties.schemaVersion.const, 2);
  assert.deepEqual(schema.properties.scope.properties.protocol, { const: "historical-efficacy-v1" });
  assert.deepEqual(schema.properties.scope.properties.status, {
    enum: ["known-roots", "reviewed-comparison"],
  });
  assert.deepEqual(schema.allOf[0]?.then.properties.scope.properties.permittedMetrics.const,
    historicalPermittedMetrics("known-roots"));
  assert.deepEqual(schema.allOf[1]?.then.properties.scope.properties.permittedMetrics.const,
    historicalPermittedMetrics("reviewed-comparison"));
  assert.equal(schema.$defs.bug.properties.lane.enum.includes("other-unclassified"), true);
  assert.deepEqual(schema.$defs.bug.properties.proofLevel.enum, ["reproduced", "complete-static-trace"]);
});

test("schema location bounds align with the parser and document mandatory cross-field validation", () => {
  const schema = JSON.parse(readFileSync("schemas/historical-benchmark-truth.schema.json", "utf8"));
  const properties = schema.$defs.bug.properties;
  const pattern = new RegExp(properties.file.pattern);
  for (const file of [" src/a.ts", "src/a.ts ", "src/", "src//a.ts", "../a.ts", "/a.ts", "src/./a.ts", "src\\a.ts", "src/\na.ts"]) {
    assert.equal(pattern.test(file), false, file);
    const truth = knownRoot();
    ((truth.bugs as Record<string, unknown>[])[0]!).file = file;
    assert.throws(() => parseHistoricalGroundTruth(truth), /safe repository-relative path/);
  }
  assert.equal(pattern.test("src/valid file.ts"), true);
  assert.equal(properties.startLine.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(properties.endLine.maximum, Number.MAX_SAFE_INTEGER);
  assert.match(schema.$comment, /MUST also run parseHistoricalGroundTruth/);
  const reversed = knownRoot();
  ((reversed.bugs as Record<string, unknown>[])[0]!).endLine = 1;
  assert.throws(() => parseHistoricalGroundTruth(reversed), /valid positive line range/);
});
