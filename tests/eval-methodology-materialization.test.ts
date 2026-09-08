import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { leakagePolicyForCase, materializeCase } from "../eval/case-isolation.js";
import { createMethodologyAssetPreparer } from "../eval/methodology-assets.js";
import { loadCaseSpec } from "../eval/run-matrix.js";

// This is explicitly an existing structural fixture, never a historical case
// admission or a provider experiment. No source code or model is executed.
const caseDir = resolve("eval/cases/structural-smoke/case-00000001");

test("four experimental mounts preserve identical raw review scope and exclude ambient method assets", async () => {
  const spec = loadCaseSpec(caseDir);
  const policy = leakagePolicyForCase(caseDir, spec);
  const scopes: Array<{ base: string; head: string; diff: string; tree: string }> = [];
  for (const armId of ["A", "B", "C", "D"] as const) {
    const materialized = await materializeCase(caseDir, spec, policy, {
      assetPreparer: createMethodologyAssetPreparer(armId),
    });
    try {
      const assets = materialized.evaluationIsolation.providerAssetsRoot;
      assert.ok(assets);
      const paths = files(assets!);
      const expected = ["schemas/methodology-review.schema.json"];
      if (armId === "C") expected.push("schemas/methodology-discovery.schema.json");
      if (armId === "D") expected.push("schemas/breadth-result.schema.json",
        "skills/invariant-first-pr-review/references/breadth-worker-packet.md");
      assert.deepEqual(paths, expected.sort());
      assert.equal(existsSync(join(assets!, ".claude-plugin")), false);
      assert.equal(existsSync(join(assets!, "skills/invariant-first-pr-review/SKILL.md")), false);
      assert.equal(existsSync(join(assets!, "schemas/review-result.schema.json")), false);
      for (const path of paths) {
        assert.deepEqual(readFileSync(join(assets!, path)), readFileSync(resolve(path)));
      }
      scopes.push({ base: materialized.baseRef, head: materialized.headRef,
        diff: materialized.diffText, tree: materialized.historyProvenance.headTree });
    } finally { materialized.cleanup(); }
  }
  for (const scope of scopes) assert.deepEqual(scope, scopes[0]);
});

test("default materialization retains its existing production-shaped asset package", async () => {
  const spec = loadCaseSpec(caseDir);
  const materialized = await materializeCase(caseDir, spec, leakagePolicyForCase(caseDir, spec));
  try {
    const root = materialized.evaluationIsolation.providerAssetsRoot!;
    assert.equal(existsSync(join(root, "skills/invariant-first-pr-review/SKILL.md")), true);
    assert.equal(existsSync(join(root, "schemas/review-result.schema.json")), true);
    assert.equal(existsSync(join(root, ".claude-plugin/plugin.json")), true);
  } finally { materialized.cleanup(); }
});

function files(root: string, prefix = ""): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    assert.equal(entry.isSymbolicLink(), false);
    return entry.isDirectory() ? files(root, path) : [path];
  }).sort();
}
