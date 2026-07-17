import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PeregrineConfig } from "./types.js";

/**
 * Loads peregrine.config.json, then applies env overrides so CI and the eval
 * matrix can vary models without editing the file:
 *   PEREGRINE_ENGINE, PEREGRINE_TIER1_MODEL, PEREGRINE_TIER2_MODEL
 */
export function loadConfig(path = "peregrine.config.json"): PeregrineConfig {
  const cfg = JSON.parse(readFileSync(resolve(path), "utf8")) as PeregrineConfig;

  if (process.env.PEREGRINE_ENGINE) cfg.engine = process.env.PEREGRINE_ENGINE;
  if (process.env.PEREGRINE_TIER1_MODEL)
    cfg.engines.claude.tier1Model = process.env.PEREGRINE_TIER1_MODEL;
  if (process.env.PEREGRINE_TIER2_MODEL)
    cfg.engines.claude.tier2Model = process.env.PEREGRINE_TIER2_MODEL;

  return cfg;
}
