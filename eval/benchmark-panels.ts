import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { packageRoot } from "../src/core/paths.js";
import {
  BENCHMARK_CATEGORIES,
  CASE_CORPORA,
  type BenchmarkCategory,
  type CaseCorpus,
  type ExperimentMode,
  type MatrixConfig,
} from "../src/types.js";
import { assertOpaqueCaseId } from "./case-isolation.js";

export interface BenchmarkPanelDefinition {
  mode: "screening" | "visible-checkpoint";
  repeats: number;
  corpora: CaseCorpus[];
  caseIds: string[];
  roles: {
    highRiskSentinels: string[];
    variableCases: string[];
    cleanControls: string[];
    compatibilitySensitivity: string[];
    largeDiffCases: string[];
    diagnosticOnlyCases: string[];
  };
}

export interface BenchmarkPanelRegistry {
  schemaVersion: 1;
  excludedCases: Array<{
    caseId: string;
    reason: string;
    evidence: string;
    allowedUse?: "diagnostic-only";
  }>;
  panels: Record<BenchmarkCategory, BenchmarkPanelDefinition>;
}

export interface BenchmarkCategoryBinding {
  name: BenchmarkCategory;
  definitionSha256: string;
  evidenceUse: "paired-acceptance" | "treatment-only-diagnostic";
}

export function loadBenchmarkPanelRegistry(
  path = join(packageRoot(), "eval", "benchmark-panels.json"),
): BenchmarkPanelRegistry {
  return parseBenchmarkPanelRegistry(JSON.parse(readFileSync(resolve(path), "utf8")), path);
}

export function parseBenchmarkPanelRegistry(value: unknown, source = "benchmark panel registry"): BenchmarkPanelRegistry {
  const root = strictObject(value, source, ["schemaVersion", "excludedCases", "panels"]);
  if (root.schemaVersion !== 1) throw new Error(`${source}.schemaVersion must be 1`);
  if (!Array.isArray(root.excludedCases)) throw new Error(`${source}.excludedCases must be an array`);
  const excluded = new Map<string, "exclude" | "diagnostic-only">();
  const excludedCases = root.excludedCases.map((value, index) => {
    const item = strictObject(
      value,
      `${source}.excludedCases[${index}]`,
      ["caseId", "reason", "evidence"],
      ["allowedUse"],
    );
    const caseId = opaqueId(item.caseId, `${source}.excludedCases[${index}].caseId`);
    if (excluded.has(caseId)) throw new Error(`${source}.excludedCases contains duplicate ${caseId}`);
    const allowedUse = item.allowedUse === undefined
      ? undefined
      : exact(item.allowedUse, "diagnostic-only", `${source}.excludedCases[${index}].allowedUse`);
    excluded.set(caseId, allowedUse ?? "exclude");
    return {
      caseId,
      reason: nonEmpty(item.reason, `${source}.excludedCases[${index}].reason`),
      evidence: nonEmpty(item.evidence, `${source}.excludedCases[${index}].evidence`),
      ...(allowedUse ? { allowedUse } : {}),
    };
  });
  const panelsRoot = strictObject(root.panels, `${source}.panels`, [...BENCHMARK_CATEGORIES]);
  const panels = Object.fromEntries(BENCHMARK_CATEGORIES.map((name) => [
    name,
    parsePanel(panelsRoot[name], name, excluded, `${source}.panels.${name}`),
  ])) as unknown as Record<BenchmarkCategory, BenchmarkPanelDefinition>;
  assertNested(panels.smoke.caseIds, panels["fast-screen"].caseIds, "smoke", "fast-screen", source);
  assertNested(panels["fast-screen"].caseIds, panels.confirmation.caseIds, "fast-screen", "confirmation", source);
  assertNested(panels.confirmation.caseIds, panels["full-checkpoint"].caseIds, "confirmation", "full-checkpoint", source);
  return { schemaVersion: 1, excludedCases, panels };
}

export function bindBenchmarkCategory(
  matrix: MatrixConfig,
  registry: BenchmarkPanelRegistry,
): BenchmarkCategoryBinding | undefined {
  if (matrix.benchmarkCategory === undefined) return undefined;
  if (!BENCHMARK_CATEGORIES.includes(matrix.benchmarkCategory)) {
    throw new Error(`matrix benchmarkCategory is invalid`);
  }
  const definition = registry.panels[matrix.benchmarkCategory];
  if (matrix.experiment.mode !== definition.mode) {
    throw new Error(`${matrix.benchmarkCategory} requires experiment mode ${definition.mode}`);
  }
  if (matrix.repeats !== definition.repeats) {
    throw new Error(`${matrix.benchmarkCategory} requires ${definition.repeats} repeat(s)`);
  }
  if (!sameArray(matrix.corpora, definition.corpora)) {
    throw new Error(`${matrix.benchmarkCategory} corpora do not match the frozen panel`);
  }
  if (!sameArray(matrix.caseIds, definition.caseIds)) {
    throw new Error(`${matrix.benchmarkCategory} caseIds do not match the frozen panel`);
  }
  return {
    name: matrix.benchmarkCategory,
    definitionSha256: canonicalSha256({
      definition,
      restrictedCasePolicies: registry.excludedCases.filter((item) => definition.caseIds.includes(item.caseId)),
    }),
    evidenceUse: matrix.experiment.comparison === "treatment-only"
      ? "treatment-only-diagnostic"
      : "paired-acceptance",
  };
}

export function applyBenchmarkCategory(
  matrix: MatrixConfig,
  name: BenchmarkCategory,
  registry: BenchmarkPanelRegistry,
): MatrixConfig {
  if (!BENCHMARK_CATEGORIES.includes(name)) throw new Error("benchmark category is invalid");
  if (matrix.benchmarkCategory !== undefined && matrix.benchmarkCategory !== name) {
    throw new Error(`matrix benchmarkCategory ${matrix.benchmarkCategory} conflicts with requested ${name}`);
  }
  const definition = registry.panels[name];
  return {
    ...matrix,
    repeats: definition.repeats,
    corpora: [...definition.corpora],
    caseIds: [...definition.caseIds],
    benchmarkCategory: name,
    experiment: { ...matrix.experiment, mode: definition.mode },
  };
}

export function applyTreatmentOnlyDiagnostic(matrix: MatrixConfig): MatrixConfig {
  const category = matrix.benchmarkCategory;
  if (category !== "smoke" && category !== "fast-screen") {
    throw new Error("treatment-only diagnostics are supported only for smoke and fast-screen");
  }
  const treatment = matrix.experiment.treatment;
  if (!treatment) throw new Error("treatment-only diagnostics require a declared treatment");
  const config = matrix.configs.find((item) => item.name === treatment);
  if (!config) throw new Error(`declared treatment config ${treatment} is absent`);
  const { control: _control, ...experiment } = matrix.experiment;
  return {
    ...matrix,
    configs: [config],
    experiment: {
      ...experiment,
      comparison: "treatment-only",
    },
  };
}

function parsePanel(
  value: unknown,
  name: BenchmarkCategory,
  excluded: ReadonlyMap<string, "exclude" | "diagnostic-only">,
  source: string,
): BenchmarkPanelDefinition {
  const root = strictObject(value, source, ["mode", "repeats", "corpora", "caseIds", "roles"]);
  const expectedMode: ExperimentMode = name === "smoke" || name === "fast-screen"
    ? "screening"
    : "visible-checkpoint";
  if (root.mode !== expectedMode) throw new Error(`${source}.mode must be ${expectedMode}`);
  if (!Number.isSafeInteger(root.repeats) || (root.repeats as number) < 1) {
    throw new Error(`${source}.repeats must be a positive integer`);
  }
  if (!Array.isArray(root.corpora) || root.corpora.length === 0 ||
    root.corpora.some((item) => !CASE_CORPORA.includes(item as CaseCorpus))) {
    throw new Error(`${source}.corpora is invalid`);
  }
  const corpora = root.corpora as CaseCorpus[];
  if (new Set(corpora).size !== corpora.length || corpora.includes("structural-smoke")) {
    throw new Error(`${source}.corpora must be unique behavioral corpora`);
  }
  const caseIds = idArray(root.caseIds, `${source}.caseIds`);
  const rolesRoot = strictObject(root.roles, `${source}.roles`, [
    "highRiskSentinels", "variableCases", "cleanControls", "compatibilitySensitivity", "largeDiffCases",
    "diagnosticOnlyCases",
  ]);
  const roles = {
    highRiskSentinels: idArray(rolesRoot.highRiskSentinels, `${source}.roles.highRiskSentinels`),
    variableCases: idArray(rolesRoot.variableCases, `${source}.roles.variableCases`),
    cleanControls: idArray(rolesRoot.cleanControls, `${source}.roles.cleanControls`),
    compatibilitySensitivity: idArray(rolesRoot.compatibilitySensitivity, `${source}.roles.compatibilitySensitivity`),
    largeDiffCases: idArray(rolesRoot.largeDiffCases, `${source}.roles.largeDiffCases`, true),
    diagnosticOnlyCases: idArray(rolesRoot.diagnosticOnlyCases, `${source}.roles.diagnosticOnlyCases`, true),
  };
  const selected = new Set(caseIds);
  for (const [role, ids] of Object.entries(roles)) {
    for (const id of ids) if (!selected.has(id)) throw new Error(`${source}.roles.${role} references unselected ${id}`);
  }
  const diagnosticOnly = new Set(roles.diagnosticOnlyCases);
  for (const caseId of caseIds) {
    const policy = excluded.get(caseId);
    if (policy === "exclude") throw new Error(`${source} includes excluded case ${caseId}`);
    if (policy === "diagnostic-only" && !diagnosticOnly.has(caseId)) {
      throw new Error(`${source} must mark restricted case ${caseId} diagnostic-only`);
    }
    if (diagnosticOnly.has(caseId) && policy !== "diagnostic-only") {
      throw new Error(`${source} marks unrestricted case ${caseId} diagnostic-only`);
    }
  }
  if (roles.highRiskSentinels.length === 0 || roles.cleanControls.length === 0 ||
    roles.variableCases.length === 0 || roles.compatibilitySensitivity.length === 0) {
    throw new Error(`${source} must preserve high-risk, clean, variable, and compatibility signals`);
  }
  return { mode: expectedMode, repeats: root.repeats as number, corpora, caseIds, roles };
}

function assertNested(smaller: string[], larger: string[], smallerName: string, largerName: string, source: string): void {
  const superset = new Set(larger);
  for (const id of smaller) {
    if (!superset.has(id)) throw new Error(`${source}: ${largerName} must contain every ${smallerName} case`);
  }
}

function idArray(value: unknown, source: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`${source} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  }
  const values = value.map((item, index) => opaqueId(item, `${source}[${index}]`));
  if (new Set(values).size !== values.length) throw new Error(`${source} must not contain duplicates`);
  return values;
}

function opaqueId(value: unknown, source: string): string {
  if (typeof value !== "string") throw new Error(`${source} must be an opaque case id`);
  assertOpaqueCaseId(value, source);
  return value;
}

function nonEmpty(value: unknown, source: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${source} must be a non-empty string`);
  return value;
}

function exact<T extends string>(value: unknown, expected: T, source: string): T {
  if (value !== expected) throw new Error(`${source} must be ${expected}`);
  return expected;
}

function strictObject(
  value: unknown,
  source: string,
  keys: string[],
  optional: string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source} must be an object`);
  const root = value as Record<string, unknown>;
  const unexpected = Object.keys(root).filter((key) => !keys.includes(key) && !optional.includes(key));
  const missing = keys.filter((key) => !(key in root));
  if (unexpected.length > 0) throw new Error(`${source} contains unsupported field ${unexpected[0]}`);
  if (missing.length > 0) throw new Error(`${source} is missing ${missing[0]}`);
  return root;
}

function sameArray(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  return actual !== undefined && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonicalize(child)]));
}
