import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  RUNNER_NAMES,
  type ClaudeEffort,
  type CodexEffort,
  type PeregrineConfig,
  type RunnerName,
} from "./types.js";

const CODEX_EFFORTS: CodexEffort[] = ["low", "medium", "high", "xhigh", "max", "ultra"];
const CLAUDE_EFFORTS: ClaudeEffort[] = ["low", "medium", "high", "xhigh", "max"];

export function loadConfig(path = "peregrine.config.json"): PeregrineConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const cfg = parsed as PeregrineConfig;
  applyEnvOverrides(cfg);
  validateConfig(cfg, path);
  return cfg;
}

function applyEnvOverrides(cfg: PeregrineConfig): void {
  if (process.env.PEREGRINE_RUNNER) cfg.runner = process.env.PEREGRINE_RUNNER as RunnerName;

  const overrides: Array<[string | undefined, () => void]> = [
    [process.env.PEREGRINE_CLAUDE_BREADTH_MODEL, () => {
      cfg.runners.claude.breadthModel = process.env.PEREGRINE_CLAUDE_BREADTH_MODEL!;
    }],
    [process.env.PEREGRINE_CLAUDE_INVESTIGATION_MODEL, () => {
      cfg.runners.claude.investigationModel = process.env.PEREGRINE_CLAUDE_INVESTIGATION_MODEL!;
    }],
    [process.env.PEREGRINE_CLAUDE_INVESTIGATION_EFFORT, () => {
      cfg.runners.claude.investigationEffort = process.env.PEREGRINE_CLAUDE_INVESTIGATION_EFFORT as ClaudeEffort;
    }],
    [process.env.PEREGRINE_CODEX_BREADTH_MODEL, () => {
      cfg.runners.codex.breadthModel = process.env.PEREGRINE_CODEX_BREADTH_MODEL!;
    }],
    [process.env.PEREGRINE_CODEX_INVESTIGATION_MODEL, () => {
      cfg.runners.codex.investigationModel = process.env.PEREGRINE_CODEX_INVESTIGATION_MODEL!;
    }],
    [process.env.PEREGRINE_CODEX_BREADTH_EFFORT, () => {
      cfg.runners.codex.breadthEffort = process.env.PEREGRINE_CODEX_BREADTH_EFFORT as CodexEffort;
    }],
    [process.env.PEREGRINE_CODEX_INVESTIGATION_EFFORT, () => {
      cfg.runners.codex.investigationEffort = process.env.PEREGRINE_CODEX_INVESTIGATION_EFFORT as CodexEffort;
    }],
  ];
  for (const [value, apply] of overrides) if (value) apply();
}

export function validateConfig(cfg: PeregrineConfig, path = "config"): void {
  const fail = (message: string): never => {
    throw new Error(`${path}: ${message}`);
  };
  const object = (value: unknown, field: string): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail(`"${field}" must be an object`);
    }
    return value as Record<string, unknown>;
  };
  const string = (value: unknown, field: string): void => {
    if (typeof value !== "string" || value.trim().length === 0 || value === "TODO") {
      fail(`"${field}" must be a non-empty configured string`);
    }
  };
  const positive = (value: unknown, field: string): void => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      fail(`"${field}" must be a positive number`);
    }
  };

  object(cfg, "root");
  if (cfg.schemaVersion !== 1) fail(`"schemaVersion" must be 1`);
  if (!RUNNER_NAMES.includes(cfg.runner)) {
    fail(`"runner" must be one of: ${RUNNER_NAMES.join(", ")}`);
  }
  object(cfg.runners, "runners");
  const claude = object(cfg.runners.claude, "runners.claude");
  for (const key of ["breadthModel", "investigationModel", "skillName"] as const) {
    string(claude[key], `runners.claude.${key}`);
  }
  if (!CLAUDE_EFFORTS.includes(claude.investigationEffort as ClaudeEffort)) {
    fail(`"runners.claude.investigationEffort" must be one of: ${CLAUDE_EFFORTS.join(", ")}`);
  }
  for (const key of ["maxTurns", "maxBudgetUsd", "timeoutMs"] as const) {
    positive(claude[key], `runners.claude.${key}`);
  }

  const codex = object(cfg.runners.codex, "runners.codex");
  for (const key of ["breadthModel", "investigationModel", "skillName"] as const) {
    string(codex[key], `runners.codex.${key}`);
  }
  for (const key of ["breadthEffort", "investigationEffort"] as const) {
    if (!CODEX_EFFORTS.includes(codex[key] as CodexEffort)) {
      fail(`"runners.codex.${key}" must be one of: ${CODEX_EFFORTS.join(", ")}`);
    }
  }
  positive(codex.timeoutMs, "runners.codex.timeoutMs");
  object(cfg.runners.mock, "runners.mock");

  const limits = object(cfg.limits, "limits");
  for (const key of ["maxEscalations", "maxDiffLines", "maxCommentsPerPr"] as const) {
    positive(limits[key], `limits.${key}`);
  }
  if (
    typeof limits.minConfidenceToPost !== "number" ||
    limits.minConfidenceToPost < 0 ||
    limits.minConfidenceToPost > 1
  ) {
    fail(`"limits.minConfidenceToPost" must be between 0 and 1`);
  }

  const filters = object(cfg.filters, "filters");
  if (
    !Array.isArray(filters.ignorePaths) ||
    filters.ignorePaths.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    fail(`"filters.ignorePaths" must be an array of non-empty strings`);
  }
}
