import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PeregrineConfig } from "./types.js";

/**
 * Loads peregrine.config.json, applies env overrides, and validates the
 * boundary explicitly — a malformed config should fail here with a field
 * name, not as an undefined-property crash deep inside an engine.
 *
 * Env overrides (so CI and the eval matrix can vary models without edits):
 *   PEREGRINE_ENGINE, PEREGRINE_TIER1_MODEL, PEREGRINE_TIER2_MODEL
 */
export function loadConfig(path = "peregrine.config.json"): PeregrineConfig {
  const cfg = JSON.parse(readFileSync(resolve(path), "utf8")) as PeregrineConfig;

  if (process.env.PEREGRINE_ENGINE) cfg.engine = process.env.PEREGRINE_ENGINE;
  if (process.env.PEREGRINE_TIER1_MODEL)
    cfg.engines.claude.tier1Model = process.env.PEREGRINE_TIER1_MODEL;
  if (process.env.PEREGRINE_TIER2_MODEL)
    cfg.engines.claude.tier2Model = process.env.PEREGRINE_TIER2_MODEL;

  validate(cfg, path);
  return cfg;
}

function validate(cfg: PeregrineConfig, path: string): void {
  const fail = (msg: string): never => {
    throw new Error(`${path}: ${msg}`);
  };

  if (!cfg.engine || typeof cfg.engine !== "string") fail(`"engine" must be a string`);
  if (!cfg.engines || typeof cfg.engines !== "object") fail(`"engines" must be an object`);
  if (!(cfg.engine in cfg.engines))
    fail(`engine "${cfg.engine}" has no block under "engines"`);

  const c = cfg.engines.claude;
  if (!c || typeof c !== "object") fail(`"engines.claude" must be an object`);
  for (const key of ["tier1Model", "tier2Model", "skillName"] as const) {
    if (typeof c[key] !== "string" || c[key].length === 0)
      fail(`"engines.claude.${key}" must be a non-empty string`);
  }
  for (const key of ["maxTurns", "timeoutMs"] as const) {
    if (typeof c[key] !== "number" || !(c[key] > 0))
      fail(`"engines.claude.${key}" must be a positive number`);
  }

  const l = cfg.limits;
  if (!l || typeof l !== "object") fail(`"limits" must be an object`);
  for (const key of ["maxEscalations", "maxDiffLines", "maxCommentsPerPr"] as const) {
    if (typeof l[key] !== "number" || !(l[key] > 0))
      fail(`"limits.${key}" must be a positive number`);
  }
  if (
    typeof l.minConfidenceToPost !== "number" ||
    l.minConfidenceToPost < 0 ||
    l.minConfidenceToPost > 1
  )
    fail(`"limits.minConfidenceToPost" must be a number between 0 and 1`);

  if (
    !cfg.filters ||
    !Array.isArray(cfg.filters.ignorePaths) ||
    cfg.filters.ignorePaths.some((p) => typeof p !== "string")
  )
    fail(`"filters.ignorePaths" must be an array of strings`);
}
