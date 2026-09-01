import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config.js";
import { getEngine } from "../src/engines/engine.js";
import { exec } from "../src/util/exec.js";
import type { CaseSpec, MatrixConfig, ReviewContext, RunRecord } from "../src/types.js";

/**
 * Runs the model-comparison matrix: every model config x every case x N
 * repeats. Repeats matter — engine runs are stochastic and single-run
 * comparisons between models will mislead you. Results land in
 * eval/runs/<timestamp>/ as one JSON per run, cost captured from the engine.
 *
 * Runs are sequential on purpose: parallel agentic sessions chew through
 * rate limits and make cost attribution noisy.
 */
export async function runMatrix(configPath?: string, runsRoot?: string): Promise<string> {
  const matrix = JSON.parse(
    readFileSync(resolve(configPath ?? "eval/matrix.config.json"), "utf8"),
  ) as MatrixConfig;
  const baseConfig = loadConfig();

  const casesDir = resolve("eval/cases");
  const caseNames = readdirSync(casesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const outDir = resolve(
    runsRoot ?? process.env.PEREGRINE_EVAL_RUNS_DIR ?? "eval/runs",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  mkdirSync(outDir, { recursive: true });

  const total = matrix.configs.length * caseNames.length * matrix.repeats;
  let done = 0;

  for (const modelConfig of matrix.configs) {
    for (const caseName of caseNames) {
      const caseDir = join(casesDir, caseName);
      const spec = JSON.parse(readFileSync(join(caseDir, "case.json"), "utf8")) as CaseSpec;
      const repoPath = await materializeCase(caseDir, spec);

      for (let repeat = 1; repeat <= matrix.repeats; repeat++) {
        done++;
        process.stdout.write(
          `[${done}/${total}] ${modelConfig.name} × ${caseName} (run ${repeat}) ... `,
        );

        try {
          // Model overrides flow through the same config object the real bot
          // uses, so eval runs exercise the exact production path. Inside the
          // try: a typo'd engine name should fail THIS run, not kill the
          // remaining matrix.
          const config = structuredClone(baseConfig);
          config.runner = modelConfig.runner;
          const runnerConfig = config.runners[modelConfig.runner];
          if (!runnerConfig || typeof runnerConfig !== "object") {
            throw new Error(
              `matrix config "${modelConfig.name}": unknown runner "${modelConfig.runner}"`,
            );
          }
          Object.assign(runnerConfig as object, modelConfig.overrides ?? {});

          const ctx: ReviewContext = {
            repoPath,
            diffPath: join(caseDir, spec.diffFile),
            config,
          };

          const result = await getEngine(modelConfig.runner).review(ctx);
          const record: RunRecord = {
            caseName,
            caseKind: spec.kind,
            configName: modelConfig.name,
            repeat,
            result,
            startedAt: new Date().toISOString(),
          };
          const file = join(outDir, `${modelConfig.name}--${caseName}--${repeat}.json`);
          writeFileSync(file, JSON.stringify(record, null, 2));
          console.log(
            `${result.findings.length} finding(s), $${result.usage.costUsd?.toFixed(3) ?? "?"}`,
          );
        } catch (err) {
          console.log(`FAILED: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
  }
  console.log(`\nRuns written to ${outDir}`);
  console.log(`Next: npm run eval:grade -- --runs ${outDir}`);
  return outDir;
}

/** Copy a fixture (or clone repo@commit) into a temp dir for review. */
async function materializeCase(caseDir: string, spec: CaseSpec): Promise<string> {
  const target = join(tmpdir(), `peregrine-case-${spec.name}`);
  if (spec.fixtureDir) {
    cpSync(join(caseDir, spec.fixtureDir), target, { recursive: true, force: true });
    return target;
  }
  if (spec.repo && spec.commit) {
    if (!existsSync(target)) {
      const clone = await exec("git", ["clone", "--quiet", spec.repo, target]);
      if (clone.code !== 0) throw new Error(`clone failed: ${clone.stderr}`);
    }
    const checkout = await exec("git", ["checkout", "--quiet", spec.commit], { cwd: target });
    if (checkout.code !== 0) throw new Error(`checkout failed: ${checkout.stderr}`);
    return target;
  }
  throw new Error(`case ${spec.name}: needs fixtureDir or repo+commit`);
}
