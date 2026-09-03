import type {
  PricingCatalog,
  PricingRates,
  PricingTier,
  ProviderPriceContract,
  Usage,
} from "../types.js";
import { withUnavailable } from "./telemetry.js";

export function applyUsageCost(
  usage: Usage,
  model: string,
  catalog: PricingCatalog | undefined,
  serviceTier?: string,
): Usage {
  if (usage.costUsd !== undefined) {
    const costSource = usage.costSource ?? "provider";
    return withUnavailable({
      ...usage,
      costSource,
      pricing: costSource === "estimated" ? usage.pricing : undefined,
    });
  }
  if (!catalog || !usage.provider || usage.provider === "mock") return withUnavailable(usage);
  const effectiveServiceTier = serviceTier ?? usage.serviceTier;
  const candidates = catalog.contracts.filter((candidate) =>
    candidate.provider === usage.provider && candidate.model === model);
  const contract = candidates.find((candidate) => candidate.serviceTier === effectiveServiceTier) ??
    candidates.find((candidate) => candidate.serviceTier === undefined);
  if (!contract) return withUnavailable(usage);
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
  if (catalog.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  if (!catalog.version || typeof catalog.version !== "string") throw new Error(`${source}.version must be a non-empty string`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(catalog.pricingAsOf)) throw new Error(`${source}.pricingAsOf must be YYYY-MM-DD`);
  if (catalog.currency !== "USD") throw new Error(`${source}.currency must be USD`);
  if (!Array.isArray(catalog.contracts)) throw new Error(`${source}.contracts must be an array`);
  const identities = new Set<string>();
  catalog.contracts.forEach((contract, index) => {
    const at = `${source}.contracts[${index}]`;
    if (contract.provider !== "anthropic" && contract.provider !== "openai") {
      throw new Error(`${at}.provider must be anthropic or openai`);
    }
    if (!contract.model || typeof contract.model !== "string") throw new Error(`${at}.model must be a non-empty string`);
    if (contract.reasoningOutputBilling !== "included-in-output" && contract.reasoningOutputBilling !== "separate") {
      throw new Error(`${at}.reasoningOutputBilling is invalid`);
    }
    if (!Array.isArray(contract.assumptions) || contract.assumptions.some((item) => typeof item !== "string")) {
      throw new Error(`${at}.assumptions must be an array of strings`);
    }
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
  const components: Array<[number | undefined, number | undefined]> = contract.provider === "anthropic"
    ? [
        [usage.baseInputTokens, rates.baseInputPerMillionUsd],
        [usage.cacheWriteInputTokens, rates.cacheWriteInputPerMillionUsd],
        [usage.cacheReadInputTokens, rates.cacheReadInputPerMillionUsd],
        [usage.outputTokens, rates.outputPerMillionUsd],
      ]
    : [
        [usage.uncachedInputTokens, rates.uncachedInputPerMillionUsd],
        [usage.cacheReadInputTokens, rates.cacheReadInputPerMillionUsd],
        [usage.outputTokens, rates.outputPerMillionUsd],
      ];
  if (contract.reasoningOutputBilling === "separate") {
    components.push([usage.reasoningOutputTokens, rates.reasoningOutputPerMillionUsd]);
  }
  if (components.some(([tokens, rate]) => tokens === undefined || rate === undefined)) return undefined;
  return components.reduce((sum, [tokens, rate]) => sum + tokens! * rate! / 1_000_000, 0);
}

function selectTier(contract: ProviderPriceContract, totalInput: number | undefined): PricingTier | undefined {
  if (totalInput === undefined) return undefined;
  return contract.tiers.find((tier) => tier.upToInputTokens === undefined || totalInput <= tier.upToInputTokens);
}

function validateTiers(contract: ProviderPriceContract, source: string): void {
  if (!Array.isArray(contract.tiers) || contract.tiers.length === 0) {
    throw new Error(`${source}.tiers must contain at least one tier`);
  }
  let previous = -1;
  contract.tiers.forEach((tier, index) => {
    const at = `${source}.tiers[${index}]`;
    if (!tier.id || typeof tier.id !== "string") throw new Error(`${at}.id must be a non-empty string`);
    if (tier.upToInputTokens !== undefined) {
      if (!Number.isInteger(tier.upToInputTokens) || tier.upToInputTokens <= previous) {
        throw new Error(`${at}.upToInputTokens must be a strictly increasing positive integer`);
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
  });
}
