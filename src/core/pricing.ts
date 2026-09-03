import type {
  PricingCatalog,
  PricingRates,
  PricingTier,
  ProviderPriceContract,
  Usage,
} from "../types.js";
import { isCalendarDate, withUnavailable } from "./telemetry.js";

const CONTRACT_KEYS = new Set([
  "provider", "model", "serviceTier", "reasoningOutputBilling", "tiers", "assumptions",
]);
const TIER_KEYS = new Set([
  "id", "upToInputTokens", "baseInputPerMillionUsd", "uncachedInputPerMillionUsd",
  "cacheWriteInputPerMillionUsd", "cacheReadInputPerMillionUsd", "outputPerMillionUsd",
  "reasoningOutputPerMillionUsd",
]);

export function applyUsageCost(
  usage: Usage,
  model: string,
  catalog: PricingCatalog | undefined,
  serviceTier?: string,
): Usage {
  if (usage.malformed?.length) return withUnavailable(usage);
  if (usage.costUsd !== undefined) {
    return withUnavailable({
      ...usage,
      pricing: usage.costSource === "estimated" ? usage.pricing : undefined,
    });
  }
  if (!catalog || !usage.provider || usage.provider === "mock") return withUnavailable(usage);
  // Context tiers are per request. A sum across stages may straddle tiers and
  // cannot safely be repriced from the aggregate input count.
  if (usage.aggregation === "stage-sum" || usage.aggregation === "ambiguous") {
    return withUnavailable(usage);
  }
  if (serviceTier !== undefined && usage.serviceTier !== undefined && serviceTier !== usage.serviceTier) {
    return withUnavailable(usage);
  }
  const effectiveServiceTier = usage.serviceTier ?? serviceTier;
  const candidates = catalog.contracts.filter((candidate) =>
    candidate.provider === usage.provider && candidate.model === model);
  const contract = candidates.find((candidate) => candidate.serviceTier === effectiveServiceTier);
  if (!contract) return withUnavailable(usage);
  // A run-level envelope/snapshot can aggregate several billable requests even
  // when its observed turn count is zero, one, or unavailable. Context tiers
  // are therefore unsafe until the provider supplies per-request usage buckets.
  if (contract.tiers.length > 1) {
    return withUnavailable(usage);
  }
  const tier = selectTier(contract, usage.inputTokens);
  if (!tier) return withUnavailable(usage);
  const costUsd = estimateCost(usage, contract, tier);
  if (costUsd === undefined) return withUnavailable(usage);
  return withUnavailable({
    ...usage,
    costUsd,
    costSource: "estimated",
    pricing: {
      catalogVersion: catalog.version,
      pricingAsOf: catalog.pricingAsOf,
      contractModel: contract.model,
      serviceTier: contract.serviceTier,
      tier: tier.id,
      assumptions: contract.assumptions,
    },
  });
}

export function validatePricingCatalog(catalog: PricingCatalog, source = "pricing"): void {
  const root = requiredObject(catalog, source);
  onlyKeys(root, new Set(["schemaVersion", "version", "pricingAsOf", "currency", "contracts"]), source);
  if (catalog.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  strictString(catalog.version, `${source}.version`, 200);
  if (typeof catalog.pricingAsOf !== "string" || !isCalendarDate(catalog.pricingAsOf)) {
    throw new Error(`${source}.pricingAsOf must be a real YYYY-MM-DD calendar date`);
  }
  if (catalog.currency !== "USD") throw new Error(`${source}.currency must be USD`);
  if (!Array.isArray(catalog.contracts)) throw new Error(`${source}.contracts must be an array`);
  const identities = new Set<string>();
  catalog.contracts.forEach((contract, index) => {
    const at = `${source}.contracts[${index}]`;
    const rawContract = requiredObject(contract, at);
    onlyKeys(rawContract, CONTRACT_KEYS, at);
    if (contract.provider !== "anthropic" && contract.provider !== "openai") {
      throw new Error(`${at}.provider must be anthropic or openai`);
    }
    strictString(contract.model, `${at}.model`, 500);
    if (contract.serviceTier !== undefined) strictString(contract.serviceTier, `${at}.serviceTier`, 100);
    if (contract.reasoningOutputBilling !== "included-in-output" && contract.reasoningOutputBilling !== "separate") {
      throw new Error(`${at}.reasoningOutputBilling is invalid`);
    }
    if (!Array.isArray(contract.assumptions) || contract.assumptions.length > 100) {
      throw new Error(`${at}.assumptions must be an array of at most 100 strings`);
    }
    contract.assumptions.forEach((item, assumptionIndex) =>
      strictString(item, `${at}.assumptions[${assumptionIndex}]`, 1000));
    const identity = `${contract.provider}\0${contract.model}\0${contract.serviceTier ?? ""}`;
    if (identities.has(identity)) throw new Error(`${source} contains a duplicate provider/model/tier contract`);
    identities.add(identity);
    validateTiers(contract, at);
  });
}

function estimateCost(
  usage: Usage,
  contract: ProviderPriceContract,
  rates: PricingRates,
): number | undefined {
  let billableOutput = usage.outputTokens;
  if (contract.reasoningOutputBilling === "separate") {
    if (usage.outputTokens === undefined || usage.reasoningOutputTokens === undefined ||
      usage.outputTokens < usage.reasoningOutputTokens) return undefined;
    // Provider output totals include reasoning. Subtract it before applying the
    // regular output rate, then price the reasoning portion exactly once.
    billableOutput = usage.outputTokens - usage.reasoningOutputTokens;
  }
  const components: Array<[number | undefined, number | undefined]> = contract.provider === "anthropic"
    ? [
        [usage.baseInputTokens, rates.baseInputPerMillionUsd],
        [usage.cacheWriteInputTokens, rates.cacheWriteInputPerMillionUsd],
        [usage.cacheReadInputTokens, rates.cacheReadInputPerMillionUsd],
        [billableOutput, rates.outputPerMillionUsd],
      ]
    : [
        [usage.uncachedInputTokens, rates.uncachedInputPerMillionUsd],
        [usage.cacheReadInputTokens, rates.cacheReadInputPerMillionUsd],
        [billableOutput, rates.outputPerMillionUsd],
      ];
  if (contract.reasoningOutputBilling === "separate") {
    components.push([usage.reasoningOutputTokens, rates.reasoningOutputPerMillionUsd]);
  }
  if (components.some(([tokens, rate]) => tokens === undefined || rate === undefined)) return undefined;
  const total = components.reduce((sum, [tokens, rate]) => sum + tokens! * rate! / 1_000_000, 0);
  return Number.isFinite(total) && total >= 0 ? total : undefined;
}

function selectTier(contract: ProviderPriceContract, totalInput: number | undefined): PricingTier | undefined {
  if (totalInput === undefined) return undefined;
  return contract.tiers.find((tier) => tier.upToInputTokens === undefined || totalInput <= tier.upToInputTokens);
}

function validateTiers(contract: ProviderPriceContract, source: string): void {
  if (!Array.isArray(contract.tiers) || contract.tiers.length === 0) {
    throw new Error(`${source}.tiers must contain at least one tier`);
  }
  let previous = 0;
  const tierIds = new Set<string>();
  contract.tiers.forEach((tier, index) => {
    const at = `${source}.tiers[${index}]`;
    onlyKeys(requiredObject(tier, at), TIER_KEYS, at);
    strictString(tier.id, `${at}.id`, 200);
    if (tierIds.has(tier.id)) throw new Error(`${source} contains duplicate tier id ${tier.id}`);
    tierIds.add(tier.id);
    if (tier.upToInputTokens !== undefined) {
      if (!Number.isSafeInteger(tier.upToInputTokens) || tier.upToInputTokens <= previous) {
        throw new Error(`${at}.upToInputTokens must be a strictly increasing positive safe integer`);
      }
      if (index === contract.tiers.length - 1) throw new Error(`${source} final tier must omit upToInputTokens`);
      previous = tier.upToInputTokens;
    } else if (index !== contract.tiers.length - 1) {
      throw new Error(`${source} only the final tier may omit upToInputTokens`);
    }
    for (const [name, value] of Object.entries(tier)) {
      if (name === "id" || name === "upToInputTokens" || value === undefined) continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new Error(`${at}.${name} must be a non-negative number`);
      }
    }
    validateProviderRates(contract, tier, at);
  });
}

function validateProviderRates(contract: ProviderPriceContract, tier: PricingTier, source: string): void {
  const required = contract.provider === "anthropic"
    ? ["baseInputPerMillionUsd", "cacheWriteInputPerMillionUsd", "cacheReadInputPerMillionUsd", "outputPerMillionUsd"] as const
    : ["uncachedInputPerMillionUsd", "cacheReadInputPerMillionUsd", "outputPerMillionUsd"] as const;
  const forbidden = contract.provider === "anthropic"
    ? ["uncachedInputPerMillionUsd"] as const
    : ["baseInputPerMillionUsd", "cacheWriteInputPerMillionUsd"] as const;
  for (const field of required) {
    if (tier[field] === undefined) throw new Error(`${source}.${field} is required for ${contract.provider}`);
  }
  for (const field of forbidden) {
    if (tier[field] !== undefined) throw new Error(`${source}.${field} is not valid for ${contract.provider}`);
  }
  if (contract.reasoningOutputBilling === "separate") {
    if (tier.reasoningOutputPerMillionUsd === undefined) {
      throw new Error(`${source}.reasoningOutputPerMillionUsd is required for separate reasoning billing`);
    }
  } else if (tier.reasoningOutputPerMillionUsd !== undefined) {
    throw new Error(`${source}.reasoningOutputPerMillionUsd would be inert when reasoning is included in output`);
  }
}

function requiredObject(value: unknown, source: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${source} must be an object`);
  }
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: Set<string>, source: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) throw new Error(`${source}: unexpected field(s): ${unexpected.join(", ")}`);
}

function strictString(value: unknown, source: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > maxLength) {
    throw new Error(`${source} must be a trimmed non-empty string of at most ${maxLength} characters`);
  }
  return value;
}
