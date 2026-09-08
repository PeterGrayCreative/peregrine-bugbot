import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import type { ReviewContext } from "../src/types.js";
import { leakagePolicyForCase, materializeCase } from "../eval/case-isolation.js";
import { createMethodologyAssetPreparer } from "../eval/methodology-assets.js";
import { prepareMethodologyLaneActivation } from "../eval/methodology-lane-activation.js";
import { loadCaseSpec } from "../eval/run-matrix.js";

test("B and D derive identical frozen lane activation from actual code, not curator labels", async () => {
  const caseDir = resolve("eval/cases/structural-smoke/case-00000001");
  const spec = loadCaseSpec(caseDir);
  const materialized = await materializeCase(caseDir, spec, leakagePolicyForCase(caseDir, spec), {
    assetPreparer: createMethodologyAssetPreparer("B"),
  });
  try {
    const context: ReviewContext = { repoPath: materialized.repoPath, diffPath: materialized.diffPath,
      diffText: materialized.diffText, baseRef: materialized.baseRef, headRef: materialized.headRef,
      evaluationIsolation: materialized.evaluationIsolation, config: await loadConfig() };
    const rawScope = { baseRef: materialized.baseRef, headRef: materialized.headRef,
      diff: materialized.diffText, taskSpecification: "Preserve behavior.", rawChangedPaths: ["src/load.ts"] };
    const b = await prepareMethodologyLaneActivation({ armId: "B", context, rawScope });
    const savedNodeOptions = process.env.NODE_OPTIONS;
    const savedBashEnv = process.env.BASH_ENV;
    let d;
    try {
      process.env.NODE_OPTIONS = "--require=/nonexistent/ambient-loader-must-not-run.cjs";
      process.env.BASH_ENV = "/nonexistent/ambient-shell-must-not-run.sh";
      d = await prepareMethodologyLaneActivation({ armId: "D", context, rawScope });
    } finally {
      if (savedNodeOptions === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = savedNodeOptions;
      if (savedBashEnv === undefined) delete process.env.BASH_ENV;
      else process.env.BASH_ENV = savedBashEnv;
    }
    assert.deepEqual(b, d);
    assert.equal(b.profilePolicy, "no-profile-or-custom-lanes");
    assert.ok(b.activatedLanes.length > 0);
    for (const value of [b.activationSha256, b.routingSourceSha256, b.manifestSha256]) assert.match(value, /^[a-f0-9]{64}$/);
    await assert.rejects(() => prepareMethodologyLaneActivation({ armId: "A" as "B", context, rawScope }), /generic/);
    await assert.rejects(() => prepareMethodologyLaneActivation({ armId: "B", context,
      rawScope: { ...rawScope, rawChangedPaths: ["src/curator-answer.ts"] } }), /changed paths/);
    await assert.rejects(() => prepareMethodologyLaneActivation({ armId: "B",
      context: { ...context, profilePath: "/tmp/curator-profile.md" }, rawScope }), /profile/);
    await assert.rejects(() => prepareMethodologyLaneActivation({ armId: "B", context, rawScope,
      truth: { bugs: [{ lane: "authorization" }] } } as never), /unsupported inputs/);
  } finally { materialized.cleanup(); }
});
