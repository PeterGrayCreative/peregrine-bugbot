import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  calculateStats,
  durationP95,
  P95_MIN_SAMPLES,
  renderBenchmarkHtml,
} from "../eval/report.js";
import { applyUsageCost, validatePricingCatalog } from "../src/core/pricing.js";
import {
  claudeUsageFromEnvelope,
  codexUsageFromEvents,
  combineUsage,
  parseUsage,
  promptBytes,
  formatUsageCost,
} from "../src/core/telemetry.js";
import type { EngineResult, PricingCatalog, Usage } from "../src/types.js";

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

test("provider tool names normalize to artifact-safe keys", () => {
  const usage = claudeUsageFromEnvelope({
    usage: {
      input_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 1,
    },
    messages: [
      { type: "tool_use", id: "call-1", name: "!!!" },
      { type: "tool_result", tool_use_id: "call-1", content: "" },
    ],
  }, "prompt");
  assert.deepEqual(usage.toolCallsByType, { unknown_tool: 1 });
  assert.doesNotThrow(() => parseUsage(usage, "normalized provider usage"));
});

test("tool output payloads cannot inject fake lifecycle events", () => {
  const usage = claudeUsageFromEnvelope({
    usage: {
      input_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 1,
    },
    messages: [
      { type: "tool_use", id: "call-1", name: "read" },
      {
        type: "tool_result",
        tool_use_id: "call-1",
        content: {
          type: "tool_use",
          id: "injected-call",
          name: "shell",
        },
      },
    ],
  }, "prompt");
  assert.equal(usage.toolCalls, 1);
  assert.deepEqual(usage.toolCallsByType, { read: 1 });
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

test("partial Codex snapshots preserve independently observed tokens and work", () => {
  const usage = codexUsageFromEvents([
    { type: "item.started", item: { id: "tool-1", type: "command_execution" } },
    {
      type: "item.completed",
      item: { id: "tool-1", type: "command_execution", aggregated_output: "ok" },
    },
    { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 2 } },
  ], "prompt");
  assert.equal(usage.aggregation, "single-snapshot");
  assert.equal(usage.inputTokens, 10);
  assert.equal(usage.outputTokens, 2);
  assert.equal(usage.cachedInputTokens, undefined);
  assert.equal(usage.cacheReadInputTokens, undefined);
  assert.equal(usage.uncachedInputTokens, undefined);
  assert.equal(usage.turns, 1);
  assert.equal(usage.toolCalls, 1);
  assert.equal(usage.toolOutputBytes, 2);
  assert.doesNotThrow(() => parseUsage(usage, "partial Codex usage"));
});

test("ambiguous multiple Codex usage snapshots remain unavailable", () => {
  const usage = codexUsageFromEvents([
    { type: "item.started", item: { id: "tool-1", type: "command_execution" } },
    { type: "item.completed", item: { id: "tool-1", type: "command_execution", aggregated_output: "ok" } },
    { type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 1 } },
    { type: "turn.completed", usage: { input_tokens: 20, cached_input_tokens: 4, output_tokens: 2 } },
  ], "prompt");
  assert.equal(usage.inputTokens, undefined);
  assert.equal(usage.aggregation, "ambiguous");
  assert.equal(usage.outputTokens, undefined);
  assert.equal(usage.turns, 2);
  assert.equal(usage.toolCalls, 1);
  assert.equal(usage.toolOutputBytes, 2);
  assert.ok(usage.unavailable?.includes("inputTokens"));
});

test("Codex rejects malformed, non-object, and non-terminal usage streams", () => {
  const valid = { type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 1 } };
  const malformedStreams: unknown[][] = [
    [null, valid],
    ["event", valid],
    [[valid], valid],
    [{ type: "turn.completed", usage: { input_tokens: 1 } }, valid],
    [valid, { type: "item.completed", item: { id: "later", type: "command_execution" } }],
  ];
  for (const [index, events] of malformedStreams.entries()) {
    const usage = codexUsageFromEvents(events, "prompt");
    assert.equal(usage.aggregation, "ambiguous");
    assert.equal(usage.inputTokens, undefined);
    assert.equal(usage.outputTokens, undefined);
    assert.equal(usage.turns, index === 3 ? 2 : undefined);
    assert.equal(usage.costUsd, undefined);
  }
});

test("Codex streams without a completed usage event remain entirely unavailable", () => {
  const usage = codexUsageFromEvents([
    { type: "item.completed", item: { id: "tool-1", type: "command_execution", output: "done" } },
  ], "prompt");
  assert.equal(usage.inputTokens, undefined);
  assert.equal(usage.turns, undefined);
  assert.equal(usage.toolCalls, undefined);
  assert.equal(usage.aggregation, "ambiguous");
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

test("aggregation retains mixed cost provenance and refuses unsafe sums", () => {
  const aggregate = combineUsage(
    { costUsd: 1, costSource: "provider", inputTokens: Number.MAX_SAFE_INTEGER },
    { costUsd: 2, costSource: "estimated", inputTokens: 1 },
  );
  assert.equal(aggregate.costUsd, 3);
  assert.equal(aggregate.costSource, "mixed");
  assert.equal(aggregate.inputTokens, undefined);
  assert.equal(formatUsageCost(aggregate), "mixed-source $3.000");
  assert.equal(formatUsageCost({ provider: "openai", costUsd: 1, costSource: "provider" }), "provider-reported $1.000");
  assert.equal(formatUsageCost({ provider: "openai", costUsd: 0.0004, costSource: "provider" }), "provider-reported $0.000400");
  assert.equal(formatUsageCost({ provider: "openai", costUsd: 1e-9, costSource: "provider" }), "provider-reported $1.00e-9");
  assert.equal(formatUsageCost({ provider: "mock", costUsd: 0, costSource: "provider" }), "mock $0.000");
  assert.equal(combineUsage({ costUsd: Number.MAX_VALUE }, { costUsd: Number.MAX_VALUE }).costUsd, undefined);
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
  const claudeUsage = {
    provider: "anthropic",
    inputTokens: 175,
    baseInputTokens: 100,
    cacheWriteInputTokens: 50,
    cacheReadInputTokens: 25,
    outputTokens: 20,
  } as const;
  assert.equal(applyUsageCost(claudeUsage, "claude-test", pricing).costUsd, undefined);

  const linearPricing = structuredClone(pricing);
  linearPricing.contracts[0]!.tiers = [{
    ...linearPricing.contracts[0]!.tiers[1]!,
    id: "single-catch-all",
  }];
  validatePricingCatalog(linearPricing);
  const claude = applyUsageCost(claudeUsage, "claude-test", linearPricing);
  assert.equal(claude.costUsd, (100 * 2 + 50 * 4 + 25 * 1 + 20 * 8) / 1_000_000);
  assert.equal(claude.costSource, "estimated");
  assert.equal(claude.pricing?.pricingAsOf, "2026-09-02");
  assert.equal(claude.pricing?.tier, "single-catch-all");

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

  const reported = applyUsageCost({ provider: "anthropic", costUsd: 0.25, costSource: "provider" }, "claude-test", pricing);
  assert.equal(reported.costUsd, 0.25);
  assert.equal(reported.costSource, "provider");
  assert.equal(reported.pricing, undefined);
  const unattributed = applyUsageCost({ provider: "anthropic", costUsd: 0.25 }, "claude-test", pricing);
  assert.equal(unattributed.costSource, undefined);
  assert.equal(formatUsageCost(unattributed), "unattributed $0.250");

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

test("pricing requires exact service tiers and per-request provenance for context tiers", () => {
  const genericUsage = {
    provider: "anthropic" as const,
    serviceTier: "priority",
    inputTokens: 10,
    baseInputTokens: 10,
    cacheWriteInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 1,
  };
  assert.equal(applyUsageCost(genericUsage, "claude-test", pricing).costUsd, undefined);
  assert.equal(applyUsageCost({ ...genericUsage, serviceTier: undefined, aggregation: "stage-sum" }, "claude-test", pricing).costUsd, undefined);
  for (const turns of [undefined, 1, 2]) {
    for (const aggregation of ["single-envelope", "single-snapshot"] as const) {
      assert.equal(applyUsageCost({
        ...genericUsage,
        serviceTier: undefined,
        aggregation,
        turns,
      }, "claude-test", pricing).costUsd, undefined);
    }
  }
  const codexPriorityUsage = {
    provider: "openai" as const,
    serviceTier: "priority",
    inputTokens: 10,
    uncachedInputTokens: 10,
    cacheReadInputTokens: 0,
    outputTokens: 1,
  };
  assert.notEqual(applyUsageCost(codexPriorityUsage, "codex-test", pricing, "priority").costUsd, undefined);
  assert.equal(applyUsageCost(codexPriorityUsage, "codex-test", pricing, "batch").costUsd, undefined);

  const providerReported = applyUsageCost({
    ...genericUsage,
    turns: 2,
    costUsd: 0.004,
    costSource: "provider",
  }, "claude-test", pricing);
  assert.equal(providerReported.costUsd, 0.004);
  assert.equal(providerReported.costSource, "provider");
});

test("malformed provider cost and service tier fields block estimated fallback", () => {
  for (const totalCost of ["not-a-number", -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const invalidClaudeCost = claudeUsageFromEnvelope({
      total_cost_usd: totalCost,
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 1,
      },
    }, "prompt");
    assert.deepEqual(invalidClaudeCost.malformed, ["costUsd"]);
    assert.equal(applyUsageCost(invalidClaudeCost, "claude-test", pricing).costUsd, undefined);
  }

  const invalidClaudeTier = claudeUsageFromEnvelope({
    service_tier: " priority ",
    usage: {
      input_tokens: 10,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 1,
    },
  }, "prompt");
  assert.deepEqual(invalidClaudeTier.malformed, ["serviceTier"]);
  assert.equal(applyUsageCost(invalidClaudeTier, "claude-test", pricing).costUsd, undefined);

  const invalidCodexTier = codexUsageFromEvents([{
    type: "turn.completed",
    usage: {
      input_tokens: 10,
      cached_input_tokens: 0,
      output_tokens: 1,
      service_tier: -1,
    },
  }], "prompt");
  assert.deepEqual(invalidCodexTier.malformed, ["serviceTier"]);
  assert.equal(applyUsageCost(invalidCodexTier, "codex-test", pricing, "priority").costUsd, undefined);
});

test("reasoning tokens are billed once according to the provider contract", () => {
  const catalog = structuredClone(pricing);
  const included = catalog.contracts.find((contract) => contract.model === "codex-test")!;
  included.tiers[0]!.reasoningOutputPerMillionUsd = 1000;
  const usage = {
    provider: "openai" as const,
    serviceTier: "priority",
    inputTokens: 10,
    uncachedInputTokens: 10,
    cacheReadInputTokens: 0,
    outputTokens: 5,
    reasoningOutputTokens: 3,
  };
  const includedCost = applyUsageCost(usage, "codex-test", catalog).costUsd;
  assert.ok(Math.abs((includedCost ?? 0) - (10 * 2 + 5 * 10) / 1_000_000) < 1e-12);
  included.reasoningOutputBilling = "separate";
  const separateCost = applyUsageCost(usage, "codex-test", catalog).costUsd;
  assert.ok(Math.abs((separateCost ?? 0) - (10 * 2 + (5 - 3) * 10 + 3 * 1000) / 1_000_000) < 1e-12);
  assert.equal(applyUsageCost({ ...usage, outputTokens: 2 }, "codex-test", catalog).costUsd, undefined);
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
  assert.equal(incomplete.inputTokens, undefined);
  assert.equal(incomplete.outputTokens, undefined);
  assert.equal(incomplete.turns, undefined);
  assert.equal(incomplete.aggregation, "ambiguous");
});

test("anonymous result-only work keeps output bytes but not invented tool-call zeroes", () => {
  const claude = claudeUsageFromEnvelope({
    usage: {
      input_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 1,
    },
    messages: [{ type: "tool_result", content: "abc" }],
  }, "prompt");
  assert.equal(claude.toolCalls, undefined);
  assert.equal(claude.toolCallsByType, undefined);
  assert.equal(claude.toolOutputBytes, 3);

  const codex = codexUsageFromEvents([
    { type: "item.completed", item: { type: "command_execution", aggregated_output: "abcdef" } },
    { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
  ], "prompt");
  assert.equal(codex.toolCalls, undefined);
  assert.equal(codex.toolCallsByType, undefined);
  assert.equal(codex.toolOutputBytes, 6);

  const orphan = codexUsageFromEvents([
    { type: "item.completed", item: { id: "orphan-1", type: "tool_result", output: "abc" } },
    { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
  ], "prompt");
  assert.equal(orphan.toolCalls, undefined);
  assert.equal(orphan.toolCallsByType, undefined);
  assert.equal(orphan.toolOutputBytes, 3);
});

test("started calls without a terminal keep call count but not invented output bytes", () => {
  const usage = codexUsageFromEvents([
    { type: "item.started", item: { id: "tool-1", type: "command_execution" } },
    { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
  ], "prompt");
  assert.equal(usage.toolCalls, 1);
  assert.deepEqual(usage.toolCallsByType, { command_execution: 1 });
  assert.equal(usage.toolOutputBytes, undefined);
});

test("provider usage never accepts reasoning tokens above total output", () => {
  const claude = claudeUsageFromEnvelope({
    usage: {
      input_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 1,
      reasoning_output_tokens: 2,
    },
  }, "prompt");
  assert.equal(claude.reasoningOutputTokens, undefined);
  const codex = codexUsageFromEvents([{
    type: "turn.completed",
    usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 2 },
  }], "prompt");
  assert.equal(codex.aggregation, "single-snapshot");
  assert.equal(codex.outputTokens, 1);
  assert.equal(codex.reasoningOutputTokens, undefined);
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
  assert.equal(parseUsage({ costUsd: 1, costSource: "mixed", aggregation: "stage-sum" }, "usage").costSource, "mixed");
  assert.throws(() => parseUsage({ costSource: "provider" }, "usage"), /requires costUsd/);
  assert.throws(() => parseUsage({ costUsd: 1, costSource: "provider" }, "usage"), /provider provenance/);
  assert.throws(() => parseUsage({ provider: "openai", costUsd: 1, costSource: "estimated" }, "usage"), /pricing provenance/);
  assert.throws(() => parseUsage({
    provider: "openai",
    aggregation: "single-snapshot",
    costUsd: 1,
    costSource: "estimated",
    malformed: ["serviceTier"],
    pricing: {
      catalogVersion: "v1",
      pricingAsOf: "2026-09-02",
      contractModel: "model",
      serviceTier: "priority",
      tier: "default",
      assumptions: [],
    },
  }, "usage"), /cannot coexist with malformed/);
  assert.throws(() => parseUsage({ provider: "openai", costUsd: 1, costSource: "mixed", aggregation: "single-snapshot" }, "usage"), /stage-sum/);
  assert.throws(() => parseUsage({ provider: "openai", costUsd: 1, costSource: "mixed", aggregation: "stage-sum", pricing: {
    catalogVersion: "v1", pricingAsOf: "2026-09-02", contractModel: "model", tier: "default", assumptions: [],
  } }, "usage"), /pricing requires costSource estimated/);
  assert.throws(() => parseUsage({ inputTokens: null }, "usage"), /non-negative number/);
  assert.throws(() => parseUsage({ inputTokens: 1.5 }, "usage"), /safe integer/);
  assert.throws(() => parseUsage({ inputTokens: Number.MAX_SAFE_INTEGER + 1 }, "usage"), /safe integer/);
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
  const invalidDate = structuredClone(pricing);
  invalidDate.pricingAsOf = "2026-02-30";
  assert.throws(() => validatePricingCatalog(invalidDate), /real .* calendar date/);
  const unexpected = structuredClone(pricing) as PricingCatalog & { surprise: boolean };
  unexpected.surprise = true;
  assert.throws(() => validatePricingCatalog(unexpected), /unexpected field/);
  assert.throws(() => validatePricingCatalog(null as unknown as PricingCatalog), /must be an object/);
  const unsafeTier = structuredClone(pricing);
  unsafeTier.contracts[0]!.tiers[0]!.upToInputTokens = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => validatePricingCatalog(unsafeTier), /safe integer/);
  const blankModel = structuredClone(pricing);
  blankModel.contracts[0]!.model = "   ";
  assert.throws(() => validatePricingCatalog(blankModel), /non-empty string/);
  const duplicateTier = structuredClone(pricing);
  duplicateTier.contracts[0]!.tiers[1]!.id = duplicateTier.contracts[0]!.tiers[0]!.id;
  assert.throws(() => validatePricingCatalog(duplicateTier), /duplicate tier id/);
  const missingProviderRate = structuredClone(pricing);
  delete missingProviderRate.contracts[0]!.tiers[0]!.baseInputPerMillionUsd;
  assert.throws(() => validatePricingCatalog(missingProviderRate), /baseInputPerMillionUsd is required/);
  const forbiddenProviderRate = structuredClone(pricing);
  forbiddenProviderRate.contracts[1]!.tiers[0]!.baseInputPerMillionUsd = 1;
  assert.throws(() => validatePricingCatalog(forbiddenProviderRate), /not valid for openai/);
  const inertReasoning = structuredClone(pricing);
  inertReasoning.contracts[1]!.tiers[0]!.reasoningOutputPerMillionUsd = 1;
  assert.throws(() => validatePricingCatalog(inertReasoning), /would be inert/);
  const missingSeparateReasoning = structuredClone(pricing);
  missingSeparateReasoning.contracts[1]!.reasoningOutputBilling = "separate";
  assert.throws(() => validatePricingCatalog(missingSeparateReasoning), /required for separate/);
  const overflowing = structuredClone(pricing);
  overflowing.contracts[0]!.tiers[1]!.baseInputPerMillionUsd = Number.MAX_VALUE;
  assert.equal(applyUsageCost({
    provider: "anthropic",
    inputTokens: Number.MAX_SAFE_INTEGER,
    baseInputTokens: Number.MAX_SAFE_INTEGER,
    cacheWriteInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
  }, "claude-test", overflowing).costUsd, undefined);
});

test("duration p95 uses nearest-rank only with the documented minimum sample", () => {
  assert.equal(P95_MIN_SAMPLES, 20);
  assert.equal(durationP95(Array.from({ length: 19 }, (_, index) => index + 1)), null);
  assert.equal(durationP95(Array.from({ length: 20 }, (_, index) => index + 1)), 19);
});

test("pure report aggregation preserves provider cost, token classes, work, and stage duration", () => {
  const result: EngineResult = {
    engine: "claude",
    status: "completed",
    modelConfig: "fast/low->strong/high",
    reviewedBaseRef: "1111111111111111111111111111111111111111",
    reviewedHeadRef: "2222222222222222222222222222222222222222",
    findings: [{
      file: "src/value.ts",
      startLine: 1,
      endLine: 1,
      severity: "high",
      disposition: "fix-in-pr",
      category: "logic",
      invariant: "value-remains-valid",
      title: "Invalid value",
      explanation: "The changed value violates the invariant.",
      failurePath: "A caller observes the invalid value.",
      confidence: 0.99,
    }],
    usage: {
      provider: "anthropic",
      aggregation: "stage-sum",
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
      costUsd: 0.0004,
      costSource: "provider",
      unavailable: [],
    },
    durationMs: 4000,
    raw: {
      manifest: "base: 1111111111111111111111111111111111111111 (argument)\nhead: 2222222222222222222222222222222222222222\nmerge-base: 1111111111111111111111111111111111111111\nChanged files\n(none)\n",
      breadth: {
        output: {
          model: "fast",
          candidates: [],
          clear: [],
          escalations: [],
          coverage: { coveredFiles: ["src/value.ts"], unavailable: [] },
        },
        model: "fast",
        promptSha256: "a".repeat(64),
        durationMs: 1000,
        usage: {
          provider: "anthropic",
          aggregation: "single-envelope",
          inputTokens: 75,
          baseInputTokens: 40,
          uncachedInputTokens: 40,
          cachedInputTokens: 35,
          cacheWriteInputTokens: 25,
          cacheReadInputTokens: 10,
          outputTokens: 8,
          reasoningOutputTokens: 2,
          turns: 1,
          toolCalls: 0,
          toolCallsByType: {},
          toolOutputBytes: 0,
          promptBytes: 400,
          costUsd: 0.0002,
          costSource: "provider",
          unavailable: [],
        },
      },
      investigation: {
        model: "strong",
        promptSha256: "b".repeat(64),
        durationMs: 3000,
        usage: {
          provider: "anthropic",
          aggregation: "single-envelope",
          inputTokens: 100,
          baseInputTokens: 60,
          uncachedInputTokens: 60,
          cachedInputTokens: 40,
          cacheWriteInputTokens: 25,
          cacheReadInputTokens: 15,
          outputTokens: 12,
          reasoningOutputTokens: 3,
          turns: 2,
          toolCalls: 1,
          toolCallsByType: { tool_use: 1 },
          toolOutputBytes: 6,
          promptBytes: 600,
          costUsd: 0.0002,
          costSource: "provider",
          unavailable: [],
        },
      },
    },
  };
  const stats = calculateStats({
    config: "route",
    runner: "claude",
    corpus: "development",
    benchmarkKind: "behavioral",
    completeness: "tracked",
    expectedRuns: 1,
    completed: [{
      attemptDurationMs: 4000,
      outcome: { status: "completed", result },
      matches: { bug: 0 },
      falsePositiveIndexes: [],
    }],
    failed: [],
    missing: 0,
    failureInclusiveRecalls: [1],
    expectedRootCauseRuns: 1,
    structuralExpectedMarkers: null,
  });
  assert.equal(stats.costSource, "provider");
  assert.equal(stats.costPerCaseMean, 0.0004);
  assert.equal(stats.durationSecMedian, 4);
  assert.equal(stats.durationSecP95, null);
  assert.equal(stats.uncachedInputTokensMean, 100);
  assert.equal(stats.cacheWriteInputTokensMean, 50);
  assert.equal(stats.cacheReadInputTokensMean, 25);
  assert.equal(stats.turnsMean, 3);
  assert.equal(stats.toolCallsMean, 1);
  assert.equal(stats.toolOutputBytesMean, 6);
  assert.equal(stats.promptBytesMean, 1000);
  assert.equal(stats.telemetryExpectedRuns, 1);
  assert.equal(stats.telemetryObserved.costUsd, 1);
  assert.equal(stats.telemetryObserved.cacheWriteInputTokens, 1);
  assert.equal(stats.incurredCostUsdTotal, 0.0004);
  assert.match(renderBenchmarkHtml([stats]), /\$0\.000400/);
});
