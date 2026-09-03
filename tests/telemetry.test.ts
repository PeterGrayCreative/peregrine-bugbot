import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { buildReport } from "../eval/report.js";
import { applyUsageCost, validatePricingCatalog } from "../src/core/pricing.js";
import {
  claudeUsageFromEnvelope,
  codexUsageFromEvents,
  combineUsage,
  parseUsage,
  promptBytes,
} from "../src/core/telemetry.js";
import type { PricingCatalog, Usage } from "../src/types.js";

const pricing: PricingCatalog = {
  schemaVersion: 1,
  version: "test-prices-v1",
  pricingAsOf: "2026-09-02",
  currency: "USD",
  contracts: [
    {
      provider: "anthropic",
      model: "claude-test",
      reasoningOutputBilling: "included-in-output",
      assumptions: ["Synthetic rates used only for deterministic tests."],
      tiers: [
        {
          id: "standard-context",
          upToInputTokens: 150,
          baseInputPerMillionUsd: 1,
          cacheWriteInputPerMillionUsd: 2,
          cacheReadInputPerMillionUsd: 0.5,
          outputPerMillionUsd: 4,
        },
        {
          id: "long-context",
          baseInputPerMillionUsd: 2,
          cacheWriteInputPerMillionUsd: 4,
          cacheReadInputPerMillionUsd: 1,
          outputPerMillionUsd: 8,
        },
      ],
    },
    {
      provider: "openai",
      model: "codex-test",
      serviceTier: "priority",
      reasoningOutputBilling: "included-in-output",
      assumptions: ["Input totals include cache reads.", "Reasoning is included in output pricing."],
      tiers: [{
        id: "priority",
        uncachedInputPerMillionUsd: 2,
        cacheReadInputPerMillionUsd: 0.5,
        outputPerMillionUsd: 10,
      }],
    },
  ],
};

test("Claude envelope preserves provider token classes and observed work", () => {
  const envelope = JSON.parse(
    readFileSync(resolve("tests/fixtures/providers/claude-result.json"), "utf8"),
  ) as Record<string, unknown>;
  const usage = claudeUsageFromEnvelope(envelope, "é");
  assert.equal(usage.provider, "anthropic");
  assert.equal(usage.aggregation, "single-envelope");
  assert.equal(usage.baseInputTokens, 100);
  assert.equal(usage.uncachedInputTokens, 100);
  assert.equal(usage.cacheWriteInputTokens, 50);
  assert.equal(usage.cacheReadInputTokens, 25);
  assert.equal(usage.inputTokens, 175);
  assert.equal(usage.cachedInputTokens, 75);
  assert.equal(usage.outputTokens, 20);
  assert.equal(usage.reasoningOutputTokens, 5);
  assert.equal(usage.turns, 3);
  assert.equal(usage.toolCalls, 1);
  assert.equal(usage.serviceTier, "standard");
  assert.deepEqual(usage.toolCallsByType, { read: 1 });
  assert.equal(usage.toolOutputBytes, 6);
  assert.equal(usage.promptBytes, 2);
  assert.equal(usage.costUsd, 0.0123);
  assert.equal(usage.costSource, "provider");
  assert.ok(!JSON.stringify(usage).includes("rg TODO"));
});

test("Codex captured events preserve one final usage snapshot without double counting", () => {
  const events = readFileSync(resolve("tests/fixtures/providers/codex-events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
  const usage = codexUsageFromEvents(events, "é");
  assert.equal(usage.provider, "openai");
  assert.equal(usage.aggregation, "single-snapshot");
  assert.equal(usage.inputTokens, 110);
  assert.equal(usage.uncachedInputTokens, 80);
  assert.equal(usage.cacheReadInputTokens, 30);
  assert.equal(usage.cacheWriteInputTokens, undefined);
  assert.equal(usage.outputTokens, 20);
  assert.equal(usage.reasoningOutputTokens, 5);
  assert.equal(usage.turns, 1);
  assert.equal(usage.toolCalls, 1);
  assert.deepEqual(usage.toolCallsByType, { command_execution: 1 });
  assert.equal(usage.toolOutputBytes, 6);
  assert.equal(usage.promptBytes, 2);
  assert.ok(usage.unavailable?.includes("cacheWriteInputTokens"));
});

test("ambiguous multiple Codex usage snapshots remain unavailable", () => {
  const usage = codexUsageFromEvents([
    { type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 1 } },
    { type: "turn.completed", usage: { input_tokens: 20, cached_input_tokens: 4, output_tokens: 2 } },
  ], "prompt");
  assert.equal(usage.inputTokens, undefined);
  assert.equal(usage.aggregation, "ambiguous");
  assert.equal(usage.outputTokens, undefined);
  assert.equal(usage.turns, 2);
  assert.ok(usage.unavailable?.includes("inputTokens"));
});

test("aggregation preserves observed zero and refuses partial totals", () => {
  const complete: Usage = {
    provider: "openai",
    inputTokens: 0,
    outputTokens: 2,
    costUsd: 0,
    costSource: "provider",
    turns: 1,
    toolCalls: 0,
    toolCallsByType: {},
    toolOutputBytes: 0,
    promptBytes: 10,
  };
  const partial: Usage = {
    provider: "openai",
    inputTokens: 3,
    outputTokens: 4,
    turns: 1,
    toolCalls: 1,
    toolCallsByType: { command_execution: 1 },
    toolOutputBytes: 5,
    promptBytes: 20,
  };
  const total = combineUsage(complete, partial);
  assert.equal(total.inputTokens, 3);
  assert.equal(total.outputTokens, 6);
  assert.equal(total.turns, 2);
  assert.equal(total.toolCalls, 1);
  assert.equal(total.costUsd, undefined);
  assert.ok(total.unavailable?.includes("costUsd"));
});

test("aggregate estimated cost retains shared dated catalog provenance", () => {
  const first = applyUsageCost({
    provider: "openai",
    inputTokens: 10,
    uncachedInputTokens: 8,
    cacheReadInputTokens: 2,
    outputTokens: 3,
  }, "codex-test", pricing, "priority");
  const second = applyUsageCost({
    provider: "openai",
    inputTokens: 20,
    uncachedInputTokens: 15,
    cacheReadInputTokens: 5,
    outputTokens: 4,
  }, "codex-test", pricing, "priority");
  const aggregate = combineUsage(first, second);
  assert.equal(aggregate.costSource, "estimated");
  assert.equal(aggregate.pricing?.catalogVersion, "test-prices-v1");
  assert.equal(aggregate.pricing?.pricingAsOf, "2026-09-02");
});

test("dated pricing handles cache classes, context tiers, and provider precedence", () => {
  validatePricingCatalog(pricing);
  const claude = applyUsageCost({
    provider: "anthropic",
    inputTokens: 175,
    baseInputTokens: 100,
    cacheWriteInputTokens: 50,
    cacheReadInputTokens: 25,
    outputTokens: 20,
  }, "claude-test", pricing);
  assert.equal(claude.costUsd, (100 * 2 + 50 * 4 + 25 * 1 + 20 * 8) / 1_000_000);
  assert.equal(claude.costSource, "estimated");
  assert.equal(claude.pricing?.pricingAsOf, "2026-09-02");
  assert.equal(claude.pricing?.tier, "long-context");

  const codex = applyUsageCost({
    provider: "openai",
    inputTokens: 110,
    uncachedInputTokens: 80,
    cacheReadInputTokens: 30,
    outputTokens: 20,
    reasoningOutputTokens: 5,
  }, "codex-test", pricing, "priority");
  assert.equal(codex.costUsd, (80 * 2 + 30 * 0.5 + 20 * 10) / 1_000_000);
  assert.equal(codex.costSource, "estimated");

  const reported = applyUsageCost({ provider: "anthropic", costUsd: 0.25 }, "claude-test", pricing);
  assert.equal(reported.costUsd, 0.25);
  assert.equal(reported.costSource, "provider");
  assert.equal(reported.pricing, undefined);

  const unknown = applyUsageCost({ provider: "openai", inputTokens: 10 }, "unknown", pricing);
  assert.equal(unknown.costUsd, undefined);
  assert.ok(unknown.unavailable?.includes("costUsd"));
  const unknownTier = applyUsageCost({
    provider: "openai",
    inputTokens: 10,
    uncachedInputTokens: 8,
    cacheReadInputTokens: 2,
    outputTokens: 1,
  }, "codex-test", pricing, "batch");
  assert.equal(unknownTier.costUsd, undefined);
});

test("anonymous or incomplete tool event streams do not invent tool-call counts", () => {
  const anonymous = codexUsageFromEvents([
    { type: "item.started", item: { type: "command_execution" } },
    { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
  ], "prompt");
  assert.equal(anonymous.toolCalls, undefined);
  assert.ok(anonymous.unavailable?.includes("toolCalls"));
  const incomplete = codexUsageFromEvents([
    { type: "item.started", item: { id: "tool-1", type: "command_execution" } },
    { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
  ], "prompt", { completeEventStream: false });
  assert.equal(incomplete.toolCalls, undefined);
  assert.equal(incomplete.toolOutputBytes, undefined);
});

test("usage validation distinguishes unavailable fields from observed zero", () => {
  const parsed = parseUsage({
    provider: "openai",
    inputTokens: 0,
    costUsd: 0,
    costSource: "provider",
    unavailable: ["baseInputTokens"],
  }, "usage");
  assert.equal(parsed.inputTokens, 0);
  assert.deepEqual(parsed.unavailable, ["baseInputTokens"]);
  assert.equal(parseUsage({ costUsd: 0 }, "usage").costSource, undefined);
  assert.throws(() => parseUsage({ costSource: "provider" }, "usage"), /requires costUsd/);
  assert.throws(() => parseUsage({ inputTokens: null }, "usage"), /non-negative number/);
  assert.throws(() => parseUsage({ unavailable: ["costUsd", "costUsd"] }, "usage"), /duplicates/);
  assert.throws(() => parseUsage({ inputTokens: 1, unavailable: ["inputTokens"] }, "usage"), /cannot also/);
  assert.equal(promptBytes("é"), 2);
});

test("pricing validation rejects ambiguous or overlapping contracts", () => {
  const duplicate = structuredClone(pricing);
  duplicate.contracts.push(structuredClone(duplicate.contracts[0]!));
  assert.throws(() => validatePricingCatalog(duplicate), /duplicate/);
  const invalidTier = structuredClone(pricing);
  invalidTier.contracts[0]!.tiers[0]!.upToInputTokens = undefined;
  assert.throws(() => validatePricingCatalog(invalidTier), /only the final tier/);
});

test("reports aggregate provider cost, token classes, work, and stage duration", async () => {
  const root = mkdtempSync(join(tmpdir(), "peregrine-telemetry-report-"));
  const casesDir = join(root, "cases");
  const runsDir = join(root, "runs");
  mkdirSync(join(casesDir, "case"), { recursive: true });
  mkdirSync(runsDir);
  writeFileSync(join(casesDir, "case", "ground_truth.json"), JSON.stringify({ bugs: [{ id: "bug" }] }));
  const attempt = { id: "attempt-000001", caseName: "case", configName: "route", repeat: 1, file: "attempt-000001.json" };
  writeFileSync(join(runsDir, "matrix-manifest.json"), JSON.stringify({ schemaVersion: 1, createdAt: "2026-09-02T00:00:00.000Z", expectedAttempts: [attempt] }));
  const result = {
    engine: "claude",
    status: "completed",
    modelConfig: "fast->strong",
    findings: [{}],
    usage: {
      provider: "anthropic",
      inputTokens: 175,
      baseInputTokens: 100,
      uncachedInputTokens: 100,
      cachedInputTokens: 75,
      cacheWriteInputTokens: 50,
      cacheReadInputTokens: 25,
      outputTokens: 20,
      reasoningOutputTokens: 5,
      turns: 3,
      toolCalls: 1,
      toolCallsByType: { tool_use: 1 },
      toolOutputBytes: 6,
      promptBytes: 1000,
      costUsd: 0.0123,
      costSource: "provider",
      unavailable: [],
    },
    durationMs: 4000,
    raw: {
      breadth: { durationMs: 1000, usage: { inputTokens: 75 } },
      investigation: { durationMs: 3000, usage: { inputTokens: 100 } },
    },
  };
  const record = {
    schemaVersion: 1,
    attemptId: attempt.id,
    caseName: "case",
    caseKind: "seeded",
    configName: "route",
    repeat: 1,
    startedAt: "2026-09-02T00:00:00.000Z",
    finishedAt: "2026-09-02T00:00:04.000Z",
    outcome: { status: "completed", result },
  };
  writeFileSync(join(runsDir, attempt.file), JSON.stringify(record));
  writeFileSync(join(runsDir, "attempt-000001.graded.json"), JSON.stringify({
    ...record,
    matches: { bug: 0 },
    falsePositiveIndexes: [],
  }));
  try {
    const [stats] = await buildReport(runsDir, { casesDir });
    assert.equal(stats?.costSource, "provider");
    assert.equal(stats?.costPerCaseMean, 0.0123);
    assert.equal(stats?.durationSecMedian, 4);
    assert.equal(stats?.uncachedInputTokensMean, 100);
    assert.equal(stats?.cacheWriteInputTokensMean, 50);
    assert.equal(stats?.cacheReadInputTokensMean, 25);
    assert.equal(stats?.turnsMean, 3);
    assert.equal(stats?.toolCallsMean, 1);
    assert.equal(stats?.toolOutputBytesMean, 6);
    assert.equal(stats?.promptBytesMean, 1000);
    assert.equal(stats?.telemetryExpectedRuns, 1);
    assert.equal(stats?.telemetryObserved.costUsd, 1);
    assert.equal(stats?.telemetryObserved.cacheWriteInputTokens, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
