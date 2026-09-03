import { createHash } from "node:crypto";
import {
  USAGE_METRICS,
  type CostSource,
  type PricingReference,
  type Usage,
  type UsageMetric,
  type UsageProvider,
} from "../types.js";

const USAGE_KEYS = new Set([
  "provider",
  "serviceTier",
  "aggregation",
  ...USAGE_METRICS,
  "costSource",
  "pricing",
  "unavailable",
]);
const USAGE_AGGREGATIONS = ["single-envelope", "single-snapshot", "ambiguous", "stage-sum"] as const;
const WORK_ITEM_TYPES = new Set([
  "command_execution",
  "file_change",
  "function_call",
  "mcp_tool_call",
  "tool_call",
  "tool_use",
  "web_search",
]);

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function promptBytes(prompt: string): number {
  return Buffer.byteLength(prompt, "utf8");
}

export function claudeUsageFromEnvelope(
  envelope: Record<string, unknown>,
  prompt: string,
): Usage {
  const raw = record(envelope.usage);
  const base = numberFrom(raw, "input_tokens");
  const cacheWrite = numberFrom(raw, "cache_creation_input_tokens");
  const cacheRead = numberFrom(raw, "cache_read_input_tokens");
  const output = numberFrom(raw, "output_tokens");
  const reasoning = numberFrom(raw, "reasoning_output_tokens");
  const turns = integerFrom(envelope, "num_turns");
  const work = observedWork(
    envelope,
    Array.isArray(envelope.messages) || Array.isArray(envelope.events),
  );
  const totalInput = sumIfComplete(base, cacheWrite, cacheRead);
  const cachedInput = sumIfComplete(cacheWrite, cacheRead);
  const providerCost = numberFrom(envelope, "total_cost_usd");
  const serviceTier = firstString(raw.service_tier, envelope.service_tier);

  const usage: Usage = {
    provider: "anthropic",
    serviceTier,
    aggregation: "single-envelope",
    inputTokens: totalInput,
    baseInputTokens: base,
    uncachedInputTokens: base,
    cachedInputTokens: cachedInput,
    cacheWriteInputTokens: cacheWrite,
    cacheReadInputTokens: cacheRead,
    outputTokens: output,
    reasoningOutputTokens: reasoning,
    turns,
    toolCalls: work.toolCalls,
    toolCallsByType: work.toolCallsByType,
    toolOutputBytes: work.toolOutputBytes,
    promptBytes: promptBytes(prompt),
    costUsd: providerCost,
    costSource: providerCost === undefined ? undefined : "provider",
  };
  return withUnavailable(usage);
}

/**
 * Codex CLI token events are treated as a final snapshot, not increments.
 * A single captured snapshot is usable. Multiple snapshots are deliberately
 * left unavailable until the CLI declares whether they are cumulative.
 */
export function codexUsageFromEvents(
  events: unknown[],
  prompt: string,
  options: { completeEventStream?: boolean } = {},
): Usage {
  const completed = events
    .map((event) => record(event))
    .filter((event) => event.type === "turn.completed");
  const usageSnapshots = completed
    .map((event) => record(event.usage))
    .filter((usage) => Object.keys(usage).length > 0);
  const raw = usageSnapshots.length === 1 ? usageSnapshots[0]! : {};
  const input = numberFrom(raw, "input_tokens");
  const cacheRead = numberFrom(raw, "cached_input_tokens");
  const uncached = input !== undefined && cacheRead !== undefined && input >= cacheRead
    ? input - cacheRead
    : undefined;
  const output = numberFrom(raw, "output_tokens");
  const reasoning = numberFrom(raw, "reasoning_output_tokens");
  const serviceTier = firstString(raw.service_tier);
  const work = observedWork(events, options.completeEventStream !== false);

  return withUnavailable({
    provider: "openai",
    serviceTier,
    aggregation: usageSnapshots.length > 1 ? "ambiguous" : "single-snapshot",
    inputTokens: input,
    uncachedInputTokens: uncached,
    cachedInputTokens: cacheRead,
    cacheReadInputTokens: cacheRead,
    outputTokens: output,
    reasoningOutputTokens: reasoning,
    turns: completed.length > 0 ? completed.length : undefined,
    toolCalls: work.toolCalls,
    toolCallsByType: work.toolCallsByType,
    toolOutputBytes: work.toolOutputBytes,
    promptBytes: promptBytes(prompt),
  });
}

export function mockUsage(prompt = ""): Usage {
  return withUnavailable({
    provider: "mock",
    aggregation: "single-envelope",
    inputTokens: 0,
    baseInputTokens: 0,
    uncachedInputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    turns: 0,
    toolCalls: 0,
    toolCallsByType: {},
    toolOutputBytes: 0,
    promptBytes: promptBytes(prompt),
    costUsd: 0,
    costSource: "provider",
  });
}

/** Aggregate only fields observed for every contributing stage. */
export function combineUsage(...stages: Usage[]): Usage {
  if (stages.length === 0) return { unavailable: [...USAGE_METRICS] };
  const provider = same(stages.map((stage) => stage.provider));
  const result: Usage = {
    provider,
    serviceTier: same(stages.map((stage) => stage.serviceTier)),
    aggregation: "stage-sum",
  };
  for (const metric of USAGE_METRICS) {
    if (metric === "toolCallsByType") continue;
    const values = stages.map((stage) => stage[metric]).filter(isNumber);
    if (values.length === stages.length) {
      (result as Record<string, unknown>)[metric] = values.reduce((sum, value) => sum + value, 0);
    }
  }
  if (stages.every((stage) => stage.toolCallsByType !== undefined)) {
    result.toolCallsByType = {};
    for (const stage of stages) {
      for (const [type, count] of Object.entries(stage.toolCallsByType!)) {
        result.toolCallsByType[type] = (result.toolCallsByType[type] ?? 0) + count;
      }
    }
  }
  if (result.costUsd !== undefined) {
    if (stages.every((stage) => stage.costSource === "provider")) {
      result.costSource = "provider";
    } else if (stages.every((stage) => stage.costSource !== undefined)) {
      result.costSource = "estimated";
    }
    const references = stages.map((stage) => stage.pricing);
    if (stages.every((stage) => stage.costSource === "estimated") && references.every(isPricingReference)) {
      const first = references[0]!;
      if (references.every((reference) =>
        reference!.catalogVersion === first.catalogVersion &&
        reference!.pricingAsOf === first.pricingAsOf)) {
        result.pricing = {
          catalogVersion: first.catalogVersion,
          pricingAsOf: first.pricingAsOf,
          contractModel: references.map((reference) => reference!.contractModel).join(" + "),
          serviceTier: same(references.map((reference) => reference!.serviceTier)),
          tier: references.map((reference) => reference!.tier).join(" + "),
          assumptions: [...new Set(references.flatMap((reference) => reference!.assumptions))],
        };
      }
    }
  }
  return withUnavailable(result);
}

export function parseUsage(value: unknown, source: string): Usage {
  const raw = requiredRecord(value, source);
  const unexpected = Object.keys(raw).filter((key) => !USAGE_KEYS.has(key));
  if (unexpected.length > 0) throw new Error(`${source}: unexpected field(s): ${unexpected.join(", ")}`);

  const parsed: Usage = {};
  if (raw.provider !== undefined) {
    if (!(["anthropic", "openai", "mock"] as unknown[]).includes(raw.provider)) {
      throw new Error(`${source}.provider must be anthropic, openai, or mock`);
    }
    parsed.provider = raw.provider as UsageProvider;
  }
  if (raw.serviceTier !== undefined) {
    if (typeof raw.serviceTier !== "string" || raw.serviceTier.length === 0 || raw.serviceTier.length > 100) {
      throw new Error(`${source}.serviceTier must be a non-empty string of at most 100 characters`);
    }
    parsed.serviceTier = raw.serviceTier;
  }
  if (raw.aggregation !== undefined) {
    if (!USAGE_AGGREGATIONS.includes(raw.aggregation as (typeof USAGE_AGGREGATIONS)[number])) {
      throw new Error(`${source}.aggregation is invalid`);
    }
    parsed.aggregation = raw.aggregation as Usage["aggregation"];
  }
  for (const metric of USAGE_METRICS) {
    if (metric === "toolCallsByType") continue;
    const candidate = raw[metric];
    if (candidate === undefined) continue;
    if (!isNumber(candidate) || candidate < 0) {
      throw new Error(`${source}.${metric} must be a non-negative number`);
    }
    if (["turns", "toolCalls", "toolOutputBytes", "promptBytes"].includes(metric) && !Number.isInteger(candidate)) {
      throw new Error(`${source}.${metric} must be an integer`);
    }
    (parsed as Record<string, unknown>)[metric] = candidate;
  }
  if (raw.toolCallsByType !== undefined) {
    const byType = requiredRecord(raw.toolCallsByType, `${source}.toolCallsByType`);
    parsed.toolCallsByType = {};
    for (const [type, count] of Object.entries(byType)) {
      if (!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(type) || !Number.isInteger(count) || Number(count) < 0) {
        throw new Error(`${source}.toolCallsByType must contain safe names and non-negative integer counts`);
      }
      parsed.toolCallsByType[type] = Number(count);
    }
  }
  if (raw.costSource !== undefined) {
    if (raw.costSource !== "provider" && raw.costSource !== "estimated") {
      throw new Error(`${source}.costSource must be provider or estimated`);
    }
    parsed.costSource = raw.costSource as CostSource;
  }
  if (raw.pricing !== undefined) parsed.pricing = parsePricingReference(raw.pricing, `${source}.pricing`);
  if (raw.unavailable !== undefined) {
    if (!Array.isArray(raw.unavailable)) throw new Error(`${source}.unavailable must be an array`);
    const unavailable = raw.unavailable.map((metric, index) => {
      if (!(USAGE_METRICS as readonly unknown[]).includes(metric)) {
        throw new Error(`${source}.unavailable[${index}] is not a supported usage metric`);
      }
      return metric as UsageMetric;
    });
    if (new Set(unavailable).size !== unavailable.length) {
      throw new Error(`${source}.unavailable must not contain duplicates`);
    }
    parsed.unavailable = unavailable;
    for (const metric of unavailable) {
      if (parsed[metric] !== undefined) {
        throw new Error(`${source}.${metric} cannot also be listed as unavailable`);
      }
    }
  }
  // Pre-telemetry artifacts may contain a numeric cost without provenance.
  // Preserve the value for posting compatibility, but never invent a source.
  if (parsed.costSource !== undefined && parsed.costUsd === undefined) {
    throw new Error(`${source}.costSource requires costUsd`);
  }
  if (parsed.pricing !== undefined && parsed.costSource !== "estimated") {
    throw new Error(`${source}.pricing requires costSource estimated`);
  }
  return parsed;
}

export function withUnavailable(usage: Usage): Usage {
  const unavailable = USAGE_METRICS.filter((metric) => usage[metric] === undefined);
  return { ...usage, unavailable };
}

function observedWork(value: unknown, completeStream: boolean): {
  toolCalls?: number;
  toolCallsByType?: Record<string, number>;
  toolOutputBytes?: number;
} {
  const calls = new Map<string, string>();
  const outputCallIds = new Set<string>();
  let anonymousLifecycle = false;
  let outputBytes = 0;
  const visit = (entry: unknown, path: string): void => {
    if (Array.isArray(entry)) {
      entry.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    const object = record(entry);
    if (Object.keys(object).length === 0) return;
    const nested = record(object.item);
    const type = normalizedWorkType(nested.type ?? object.type);
    if (type) {
      const id = firstString(
        nested.id,
        nested.call_id,
        nested.tool_use_id,
        object.id,
        object.call_id,
        object.tool_use_id,
      );
      const callType = normalizedToolName(nested.name ?? object.name) ?? type;
      const phase = String(object.type ?? "").toLowerCase();
      const isResult = /result|output/.test(type) || /completed|result/.test(phase);
      if (!isResult) {
        if (id) calls.set(id, callType);
        else if (/started|created|requested|call|use/.test(phase)) anonymousLifecycle = true;
      } else if (id && type !== "tool_result" && type !== "function_result") {
        if (!calls.has(id)) calls.set(id, callType);
      }
      if (isResult && (!id || !outputCallIds.has(id))) {
        outputBytes += workOutputBytes(nested, object);
        if (id) outputCallIds.add(id);
      }
    }
    for (const [key, child] of Object.entries(object)) {
      if (key !== "item") visit(child, `${path}.${key}`);
    }
  };
  visit(value, "root");
  const byType: Record<string, number> = {};
  for (const type of calls.values()) byType[type] = (byType[type] ?? 0) + 1;
  if (!completeStream) return {};
  return anonymousLifecycle
    ? { toolOutputBytes: outputBytes }
    : { toolCalls: calls.size, toolCallsByType: byType, toolOutputBytes: outputBytes };
}

function normalizedWorkType(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
  if (WORK_ITEM_TYPES.has(normalized)) return normalized;
  if (normalized.includes("tool_call") || normalized.includes("function_call")) return normalized;
  if (normalized === "tool_result" || normalized === "function_result") return normalized;
  return undefined;
}

function normalizedToolName(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "_").slice(0, 100);
}

function workOutputBytes(...objects: Record<string, unknown>[]): number {
  for (const object of objects) {
    for (const key of ["aggregated_output", "output", "result", "content"]) {
      const value = object[key];
      if (typeof value === "string") return Buffer.byteLength(value, "utf8");
      if (value !== undefined) return Buffer.byteLength(JSON.stringify(value), "utf8");
    }
  }
  return 0;
}

function parsePricingReference(value: unknown, source: string): PricingReference {
  const raw = requiredRecord(value, source);
  const allowed = new Set(["catalogVersion", "pricingAsOf", "contractModel", "serviceTier", "tier", "assumptions"]);
  const unexpected = Object.keys(raw).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) throw new Error(`${source}: unexpected field(s): ${unexpected.join(", ")}`);
  const string = (key: string): string => {
    if (typeof raw[key] !== "string" || (raw[key] as string).length === 0) {
      throw new Error(`${source}.${key} must be a non-empty string`);
    }
    return raw[key] as string;
  };
  if (!Array.isArray(raw.assumptions) || raw.assumptions.some((item) => typeof item !== "string")) {
    throw new Error(`${source}.assumptions must be an array of strings`);
  }
  const pricingAsOf = string("pricingAsOf");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pricingAsOf)) {
    throw new Error(`${source}.pricingAsOf must be YYYY-MM-DD`);
  }
  return {
    catalogVersion: string("catalogVersion"),
    pricingAsOf,
    contractModel: string("contractModel"),
    serviceTier: raw.serviceTier === undefined ? undefined : string("serviceTier"),
    tier: string("tier"),
    assumptions: raw.assumptions as string[],
  };
}

function sumIfComplete(...values: Array<number | undefined>): number | undefined {
  return values.every(isNumber) ? (values as number[]).reduce((sum, value) => sum + value, 0) : undefined;
}

function same<T>(values: Array<T | undefined>): T | undefined {
  const first = values[0];
  return values.every((value) => value === first) ? first : undefined;
}

function numberFrom(value: Record<string, unknown>, key: string): number | undefined {
  const candidate = value[key];
  return isNumber(candidate) && candidate >= 0 ? candidate : undefined;
}

function integerFrom(value: Record<string, unknown>, key: string): number | undefined {
  const candidate = numberFrom(value, key);
  return candidate !== undefined && Number.isInteger(candidate) ? candidate : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredRecord(value: unknown, source: string): Record<string, unknown> {
  const parsed = record(value);
  if (Object.keys(parsed).length === 0 && !(value && typeof value === "object" && !Array.isArray(value))) {
    throw new Error(`${source}: expected an object`);
  }
  return parsed;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPricingReference(value: PricingReference | undefined): value is PricingReference {
  return value !== undefined;
}
