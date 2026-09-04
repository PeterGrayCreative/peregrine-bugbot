import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MAX_BREADTH_LEDGER_CHARS,
  MAX_CLEAR_EXPLANATION_SAMPLES,
  MAX_COMPACT_CLEAR_ITEMS,
  MAX_COMPACT_CLEAR_REASON_CHARS,
  breadthSchemaName,
  parseBreadthArtifactOutput,
  parseBreadthLedgerEvidence,
  parseBreadthResult,
  parseCompactedBreadthLedger,
  serializeBreadthLedger,
} from "../src/core/breadth-result.js";
import type { BreadthResult, CompactedBreadthLedger } from "../src/types.js";

function candidate(index: number, text = "specific invariant"): BreadthResult["candidates"][number] {
  return {
    id: `candidate-${index}`,
    lane: "logic-correctness",
    file: `src/file-${index}.ts`,
    line: index + 1,
    invariant: text,
    counterexample: text,
    evidenceNeeded: text,
  };
}

function result(clearCount = 12): BreadthResult {
  return {
    model: "breadth-worker",
    candidates: [candidate(1), candidate(2)],
    clear: Array.from({ length: clearCount }, (_, index) => ({
      lane: index % 2 === 0 ? "contracts" : "logic-correctness",
      file: index % 2 === 0 ? "src/api.ts" : "src/value.ts",
      reason: `specific clear explanation ${index} ${"x".repeat(300)}`,
    })),
    escalations: [
      { target: "candidate-1", reason: "published contract needs investigation" },
      { target: "candidate-1", reason: "duplicate escalation remains visible" },
    ],
    coverage: {
      coveredFiles: ["src/api.ts", "src/value.ts", "src/api.ts"],
      unavailable: ["generated contract unavailable", "generated contract unavailable"],
    },
  };
}

test("structural compaction preserves every high-value entry and exact clear counts", () => {
  const input = result();
  const before = structuredClone(input);
  const serialized = serializeBreadthLedger(input, "structural-compact");
  const compacted = serialized.output as CompactedBreadthLedger;

  assert.equal(compacted.kind, "structural-compact");
  assert.deepEqual(compacted.candidates, input.candidates);
  assert.deepEqual(compacted.escalations, input.escalations);
  assert.deepEqual(compacted.coverage, input.coverage);
  assert.deepEqual(compacted.clearCounts, [
    { lane: "contracts", file: "src/api.ts", count: 6 },
    { lane: "logic-correctness", file: "src/value.ts", count: 6 },
  ]);
  assert.deepEqual(compacted.clearExamples, input.clear.slice(0, MAX_CLEAR_EXPLANATION_SAMPLES));
  assert.equal(compacted.compaction.omittedCounts.clearExplanations, 4);
  assert.equal(compacted.compaction.omittedCounts.candidates, 0);
  assert.equal(compacted.compaction.omittedCounts.escalations, 0);
  assert.equal(compacted.compaction.omittedCounts.coveredFiles, 0);
  assert.equal(compacted.compaction.omittedCounts.unavailable, 0);
  assert.equal(compacted.compaction.transmittedCharacters, serialized.text.length);
  assert.ok(serialized.text.length <= MAX_BREADTH_LEDGER_CHARS);
  assert.deepEqual(input, before);
  assert.deepEqual(parseCompactedBreadthLedger(JSON.parse(serialized.text)), compacted);
  assert.deepEqual(parseBreadthArtifactOutput(JSON.parse(serialized.text)), compacted);
});

test("clear-heavy output compacts but preserved high-value overflow fails closed", () => {
  const clearHeavy = result(100);
  clearHeavy.clear = clearHeavy.clear.map((entry) => ({ ...entry, reason: "y".repeat(2000) }));
  const compacted = serializeBreadthLedger(clearHeavy, "structural-compact");
  assert.ok(compacted.text.length <= MAX_BREADTH_LEDGER_CHARS);
  assert.equal((compacted.output as CompactedBreadthLedger).compaction.omittedCounts.clearExplanations, 92);

  const highValue = result(0);
  highValue.candidates = Array.from({ length: 5 }, (_, index) => candidate(index, "z".repeat(2000)));
  assert.throws(
    () => serializeBreadthLedger(highValue, "structural-compact"),
    /preserved high-value content exceeds 24000 characters/,
  );
  assert.throws(
    () => serializeBreadthLedger(clearHeavy, "full"),
    /exceeds 24000 characters; refusing silent truncation/,
  );

  let zeroSample: ReturnType<typeof serializeBreadthLedger> | undefined;
  for (let length = 1200; length <= 2000 && zeroSample === undefined; length += 25) {
    const nearBoundary = result(1);
    nearBoundary.clear[0]!.reason = "r".repeat(2000);
    nearBoundary.candidates = Array.from(
      { length: 4 },
      (_, index) => candidate(index, "v".repeat(length)),
    );
    try {
      const candidateResult = serializeBreadthLedger(nearBoundary, "structural-compact");
      if ((candidateResult.output as CompactedBreadthLedger).clearExamples.length === 0) {
        zeroSample = candidateResult;
      }
    } catch {
      // Search the narrow boundary where high-value content fits only without a sample.
    }
  }
  assert.ok(zeroSample, "low-value clear prose must not force an otherwise avoidable overflow");
  assert.equal((zeroSample.output as CompactedBreadthLedger).clearExamples.length, 0);
});

test("adaptive compaction keeps small ledgers full and compacts only for a strict size win", () => {
  const small = result(1);
  const adaptiveSmall = serializeBreadthLedger(small, "adaptive-structural-compact");
  assert.equal(breadthSchemaName("adaptive-structural-compact"), "breadth-result");
  assert.equal(adaptiveSmall.text, JSON.stringify(small));
  assert.deepEqual(adaptiveSmall.output, small);
  assert.equal(adaptiveSmall.telemetry.mode, "adaptive-structural-compact");
  assert.equal(adaptiveSmall.telemetry.applied, false);
  assert.deepEqual(
    parseBreadthLedgerEvidence({
      providerOutput: small,
      transmittedLedger: adaptiveSmall.output,
      telemetry: adaptiveSmall.telemetry,
    }),
    {
      providerOutput: small,
      transmittedLedger: small,
      telemetry: adaptiveSmall.telemetry,
    },
  );

  const sampleBoundary: BreadthResult = {
    model: "m",
    candidates: [],
    clear: Array.from({ length: 3 }, (_, index) => ({
      lane: "l",
      file: "f",
      reason: `${"x".repeat(286)}${index}`,
    })),
    escalations: [],
    coverage: { coveredFiles: ["f"], unavailable: [] },
  };
  const historicalBoundary = serializeBreadthLedger(
    sampleBoundary,
    "structural-compact",
  );
  assert.ok(historicalBoundary.text.length >= JSON.stringify(sampleBoundary).length);
  const adaptiveBoundary = serializeBreadthLedger(
    sampleBoundary,
    "adaptive-structural-compact",
  );
  assert.equal(
    (adaptiveBoundary.output as CompactedBreadthLedger).clearExamples.length,
    1,
  );
  assert.ok(adaptiveBoundary.text.length < JSON.stringify(sampleBoundary).length);

  const compressible = result(40);
  const adaptiveCompact = serializeBreadthLedger(
    compressible,
    "adaptive-structural-compact",
  );
  assert.equal(
    (adaptiveCompact.output as CompactedBreadthLedger).kind,
    "structural-compact",
  );
  assert.ok(adaptiveCompact.text.length < JSON.stringify(compressible).length);
  assert.equal(adaptiveCompact.telemetry.mode, "adaptive-structural-compact");
  assert.ok(adaptiveCompact.telemetry.omittedCounts.clearExplanations > 0);
  assert.deepEqual(
    parseBreadthLedgerEvidence({
      providerOutput: compressible,
      transmittedLedger: adaptiveCompact.output,
      telemetry: adaptiveCompact.telemetry,
    }).transmittedLedger,
    adaptiveCompact.output,
  );

  const overLimit = result(MAX_COMPACT_CLEAR_ITEMS);
  overLimit.clear = overLimit.clear.map((entry) => ({
    ...entry,
    reason: "o".repeat(MAX_COMPACT_CLEAR_REASON_CHARS),
  }));
  assert.ok(JSON.stringify(overLimit).length > MAX_BREADTH_LEDGER_CHARS);
  const requiredCompact = serializeBreadthLedger(
    overLimit,
    "adaptive-structural-compact",
  );
  assert.ok(requiredCompact.text.length <= MAX_BREADTH_LEDGER_CHARS);
  assert.equal(requiredCompact.telemetry.originalCounts.candidates, 2);
  assert.equal(requiredCompact.telemetry.omittedCounts.candidates, 0);

  const historicalSmall = serializeBreadthLedger(small, "structural-compact");
  assert.equal(
    (historicalSmall.output as CompactedBreadthLedger).kind,
    "structural-compact",
  );
  assert.ok(historicalSmall.text.length > JSON.stringify(small).length);
});

test("compacted-ledger parsing rejects forged counts, sizes, and provider metadata", () => {
  const input = result();
  const compacted = serializeBreadthLedger(input, "structural-compact").output as CompactedBreadthLedger;

  const forgedCount = structuredClone(compacted);
  forgedCount.compaction.omittedCounts.candidates = 1;
  assert.throws(() => parseCompactedBreadthLedger(forgedCount), /cannot omit candidates/);

  const forgedGroup = structuredClone(compacted);
  forgedGroup.clearCounts[0]!.count -= 1;
  assert.throws(() => parseCompactedBreadthLedger(forgedGroup), /do not reconcile/);

  const forgedSize = structuredClone(compacted);
  forgedSize.compaction.transmittedCharacters += 1;
  assert.throws(() => parseCompactedBreadthLedger(forgedSize), /does not match serialized ledger length/);

  const forgedSampleGroup = structuredClone(compacted);
  forgedSampleGroup.clearExamples[0]!.file = "src/not-counted.ts";
  stabilizeTransmittedCharacters(forgedSampleGroup);
  assert.throws(
    () => parseCompactedBreadthLedger(forgedSampleGroup),
    /clearExamples are not supported by clearCounts/,
  );

  assert.throws(() => parseBreadthResult(compacted), /unexpected field/);
});

test("the compact provider schema bounds low-value volume and all parser-bounded strings", () => {
  const compact = JSON.parse(readFileSync("schemas/breadth-result-compact.schema.json", "utf8"));
  const legacy = JSON.parse(readFileSync("schemas/breadth-result.schema.json", "utf8"));
  assert.equal(compact.properties.model.maxLength, 200);
  assert.equal(compact.properties.clear.maxItems, MAX_COMPACT_CLEAR_ITEMS);
  assert.equal(compact.properties.clear.items.properties.reason.maxLength, 400);
  assert.equal(compact.properties.candidates.items.properties.invariant.maxLength, 2000);
  assert.equal(compact.properties.coverage.properties.coveredFiles.items.maxLength, 1024);
  assert.equal(compact.properties.candidates.maxItems, undefined);
  assert.equal(compact.properties.escalations.maxItems, undefined);
  assert.equal(compact.properties.coverage.properties.coveredFiles.maxItems, undefined);
  assert.equal(compact.properties.coverage.properties.unavailable.maxItems, undefined);
  assert.equal(legacy.properties.clear.maxItems, undefined);

  const tooMany = result(MAX_COMPACT_CLEAR_ITEMS + 1);
  assert.throws(
    () => parseBreadthResult(tooMany, "compact provider", "structural-compact"),
    /clear must contain at most 64 entries/,
  );
  assert.doesNotThrow(
    () => parseBreadthResult(tooMany, "adaptive provider", "adaptive-structural-compact"),
  );
  const verbose = result(1);
  verbose.clear[0]!.reason = "r".repeat(401);
  assert.throws(
    () => parseBreadthResult(verbose, "compact provider", "structural-compact"),
    /reason must contain at most 400 characters/,
  );
});

function stabilizeTransmittedCharacters(value: CompactedBreadthLedger): void {
  for (;;) {
    const length = JSON.stringify(value).length;
    if (value.compaction.transmittedCharacters === length) return;
    value.compaction.transmittedCharacters = length;
  }
}
