import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  applyBenchmarkCategory,
  applyTreatmentOnlyDiagnostic,
  bindBenchmarkCategory,
  loadBenchmarkPanelRegistry,
  parseBenchmarkPanelRegistry,
} from "../eval/benchmark-panels.js";
import type { MatrixConfig } from "../src/types.js";
import { packageRoot } from "../src/core/paths.js";

const matrix: MatrixConfig = {
  repeats: 1,
  configs: [
    { name: "control", runner: "codex" },
    { name: "treatment", runner: "codex" },
  ],
  experiment: {
    mode: "screening",
    seed: 1,
    cacheCondition: "uncontrolled",
    providerCalls: "deny",
    providerAccess: "cli-session",
    costAccounting: "best-effort",
    control: "control",
    treatment: "treatment",
    judge: {
      kind: "codex",
      model: "gpt-5.6-luna",
      effort: "medium",
      version: "semantic-v1",
      limits: limits(500),
    },
    limits: limits(500),
  },
};

test("shortened benchmark panels are nested, balanced, and exclude contaminated cases", () => {
  const registry = loadBenchmarkPanelRegistry();
  assert.deepEqual(Object.keys(registry.panels), ["smoke", "fast-screen", "confirmation", "full-checkpoint"]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(registry.panels).map(([name, panel]) => [name, panel.caseIds.length])),
    { smoke: 6, "fast-screen": 12, confirmation: 19, "full-checkpoint": 32 },
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(registry.panels).map(([name, panel]) => [name, panel.repeats])),
    { smoke: 1, "fast-screen": 2, confirmation: 3, "full-checkpoint": 3 },
  );
  const excluded = new Set(registry.excludedCases.map((item) => item.caseId));
  assert.deepEqual(excluded, new Set([
    "case-c39a25e8", "case-3ef9a502", "case-c95a81e4", "case-d3f8026e", "case-f9b30d26",
  ]));
  for (const panel of Object.values(registry.panels)) {
    assert.ok(panel.roles.highRiskSentinels.length > 0);
    assert.ok(panel.roles.variableCases.length > 0);
    assert.ok(panel.roles.cleanControls.length > 0);
    assert.ok(panel.roles.compatibilitySensitivity.length > 0);
    assert.ok(panel.caseIds.every((id) => !excluded.has(id) || panel.roles.diagnosticOnlyCases.includes(id)));
  }
  assert.deepEqual(registry.panels.confirmation.roles.largeDiffCases, ["case-d3f8026e"]);
  assert.deepEqual(registry.panels.confirmation.roles.diagnosticOnlyCases, ["case-d3f8026e"]);
});

test("panel roles stay bound to corpus facts and full lane coverage", () => {
  const registry = loadBenchmarkPanelRegistry();
  for (const panel of Object.values(registry.panels)) {
    for (const id of panel.roles.cleanControls) assert.equal(caseJson(id).kind, "clean");
    assert.ok(panel.roles.cleanControls.length / panel.caseIds.length >= 0.25);
    for (const id of panel.caseIds) {
      const spec = caseJson(id);
      assert.ok(panel.corpora.includes(spec.corpus));
    }
  }
  const large = curationJson("case-d3f8026e");
  assert.equal(large.strata.size, "large");
  assert.ok(large.strata.changeShapes.includes("large-diff"));
  assert.equal(allLanes(registry.panels.confirmation.caseIds).size, 12);
  assert.equal(allLanes(registry.panels["full-checkpoint"].caseIds).size, 12);
});

test("category selection replaces arbitrary case settings and binds the exact definition", () => {
  const registry = loadBenchmarkPanelRegistry();
  const selected = applyBenchmarkCategory(matrix, "fast-screen", registry);
  assert.equal(selected.benchmarkCategory, "fast-screen");
  assert.equal(selected.experiment.mode, "screening");
  assert.equal(selected.repeats, 2);
  assert.deepEqual(selected.caseIds, registry.panels["fast-screen"].caseIds);
  const binding = bindBenchmarkCategory(selected, registry);
  assert.equal(binding?.name, "fast-screen");
  assert.match(binding?.definitionSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.equal(binding?.evidenceUse, "paired-acceptance");
  assert.throws(
    () => bindBenchmarkCategory({ ...selected, repeats: 1 }, registry),
    /requires 2 repeat/,
  );
  assert.throws(
    () => bindBenchmarkCategory({ ...selected, caseIds: selected.caseIds?.slice(1) }, registry),
    /caseIds do not match/,
  );
  const confirmation = applyBenchmarkCategory(matrix, "confirmation", registry);
  const originalHash = bindBenchmarkCategory(confirmation, registry)?.definitionSha256;
  const policyChanged = structuredClone(registry);
  policyChanged.excludedCases.find((item) => item.caseId === "case-d3f8026e")!.reason += " changed";
  assert.notEqual(bindBenchmarkCategory(confirmation, policyChanged)?.definitionSha256, originalHash);
});

test("treatment-only selection is bounded and explicitly diagnostic", () => {
  const registry = loadBenchmarkPanelRegistry();
  const selected = applyBenchmarkCategory(matrix, "fast-screen", registry);
  const diagnostic = applyTreatmentOnlyDiagnostic(selected);
  assert.deepEqual(diagnostic.configs.map((item) => item.name), ["treatment"]);
  assert.equal(diagnostic.experiment.control, undefined);
  assert.equal(diagnostic.experiment.comparison, "treatment-only");
  assert.equal(bindBenchmarkCategory(diagnostic, registry)?.evidenceUse, "treatment-only-diagnostic");
  assert.throws(
    () => applyTreatmentOnlyDiagnostic(applyBenchmarkCategory(matrix, "confirmation", registry)),
    /only for smoke and fast-screen/,
  );
});

test("registry parsing rejects excluded members and category drift", () => {
  const registry = loadBenchmarkPanelRegistry();
  const contaminated = structuredClone(registry) as unknown as Record<string, unknown>;
  const panels = contaminated.panels as Record<string, { caseIds: string[] }>;
  panels.smoke!.caseIds[0] = registry.excludedCases[0]!.caseId;
  assert.throws(
    () => parseBenchmarkPanelRegistry(contaminated),
    /references unselected|includes excluded case/,
  );

  const notNested = structuredClone(registry) as unknown as Record<string, unknown>;
  const nestedPanels = notNested.panels as Record<string, { caseIds: string[] }>;
  nestedPanels["fast-screen"]!.caseIds = nestedPanels["fast-screen"]!.caseIds.filter(
    (id) => id !== registry.panels.smoke.caseIds[0],
  );
  assert.throws(() => parseBenchmarkPanelRegistry(notNested), /references unselected|must contain every smoke case/);
});

function limits(maxProviderAttempts: number) {
  return {
    maxProviderCostUsd: null,
    maxProviderAttempts,
    maxWallTimeMs: 1_000_000,
    maxFailureRate: 0.2,
    minAttemptsForFailureRate: 4,
    maxConsecutiveFailures: 3,
  };
}

function findCase(id: string): string {
  for (const corpus of ["development", "validation"] as const) {
    const path = join(packageRoot(), "eval", "cases", corpus, id);
    try {
      readFileSync(join(path, "case.json"));
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error(`missing case ${id}`);
}

function caseJson(id: string): { kind: string; corpus: "development" | "validation" } {
  return JSON.parse(readFileSync(join(findCase(id), "case.json"), "utf8"));
}

function curationJson(id: string): { strata: { size: string; changeShapes: string[] } } {
  return JSON.parse(readFileSync(join(findCase(id), "curation.json"), "utf8"));
}

function allLanes(ids: string[]): Set<string> {
  const lanes = new Set<string>();
  for (const id of ids) {
    const truth = JSON.parse(readFileSync(join(findCase(id), "ground_truth.json"), "utf8")) as {
      bugs: Array<{ lane: string }>;
    };
    for (const bug of truth.bugs) lanes.add(bug.lane);
  }
  return lanes;
}
