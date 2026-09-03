import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config.js";
import { validateConfig } from "../src/config.js";
import { RunFailureError, runFailureKind } from "../src/core/run-failure.js";
import { getEngine } from "../src/engines/engine.js";
import { safeDiagnostic } from "../src/security/secrets.js";
import { exec } from "../src/util/exec.js";
import type { CaseSpec, MatrixConfig, MatrixRunManifest, ReviewContext, RunRecord, RunnerName } from "../src/types.js";
import type { Engine } from "../src/engines/engine.js";

interface RunMatrixOptions {
  casesDir?: string;
  engineFor?: (runner: RunnerName) => Engine;
}

/**
 * Runs the model-comparison matrix: every model config x every case x N
 * repeats. Repeats matter — engine runs are stochastic and single-run
 * comparisons between models will mislead you. Results land in
 * eval/runs/<timestamp>/ as one JSON per run, cost captured from the engine.
 *
 * Runs are sequential on purpose: parallel agentic sessions chew through
 * rate limits and make cost attribution noisy.
 */
export async function runMatrix(
  configPath?: string,
  runsRoot?: string,
  options: RunMatrixOptions = {},
): Promise<string> {
  const matrix = JSON.parse(
    readFileSync(resolve(configPath ?? "eval/matrix.config.json"), "utf8"),
  ) as MatrixConfig;
  const baseConfig = loadConfig();

  const casesDir = resolve(options.casesDir ?? "eval/cases");
  const caseNames = readdirSync(casesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const outDir = resolve(
    runsRoot ?? process.env.PEREGRINE_EVAL_RUNS_DIR ?? "eval/runs",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  mkdirSync(outDir, { recursive: true });

  let sequence = 0;
  const expectedAttempts = matrix.configs.flatMap((modelConfig) =>
    caseNames.flatMap((caseName) =>
      Array.from({ length: matrix.repeats }, (_, index) => {
        const repeat = index + 1;
        const id = `attempt-${String(++sequence).padStart(6, "0")}`;
        return { id, caseName, configName: modelConfig.name, repeat, file: `${id}.json` };
      }),
    ),
  );
  const manifest: MatrixRunManifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    expectedAttempts,
  };
  writeFileSync(join(outDir, "matrix-manifest.json"), JSON.stringify(manifest, null, 2));

  const total = expectedAttempts.length;
  let done = 0;

  for (const modelConfig of matrix.configs) {
    for (const caseName of caseNames) {
      const caseDir = join(casesDir, caseName);
      let prepared: { spec: CaseSpec; repoPath: string } | undefined;
      let preparationError: unknown;
      try {
        const spec = loadCaseSpec(caseDir, caseName);
        prepared = { spec, repoPath: await materializeCase(caseDir, spec) };
      } catch (error) {
        preparationError = error;
      }

      for (let repeat = 1; repeat <= matrix.repeats; repeat++) {
        done++;
        const attempt = expectedAttempts[done - 1];
        if (!attempt) throw new Error(`internal error: missing matrix attempt ${done}`);
        const attemptId = attempt.id;
        const file = join(outDir, attempt.file);
        const startedAt = new Date().toISOString();
        const started = Date.now();
        process.stdout.write(
          `[${done}/${total}] ${modelConfig.name} × ${caseName} (run ${repeat}) ... `,
        );

        try {
          if (!prepared) throw preparationError;
          // Model overrides flow through the same config object the real bot
          // uses, so eval runs exercise the exact production path. Inside the
          // try: a typo'd engine name should fail THIS run, not kill the
          // remaining matrix.
          const config = structuredClone(baseConfig);
          config.runner = modelConfig.runner;
          const runnerConfig = config.runners[modelConfig.runner];
          if (!runnerConfig || typeof runnerConfig !== "object") {
            throw new RunFailureError(
              "configuration",
              `matrix config "${modelConfig.name}": unknown runner "${modelConfig.runner}"`,
            );
          }
          Object.assign(runnerConfig as object, modelConfig.overrides ?? {});
          try {
            validateConfig(config, `matrix config "${modelConfig.name}"`);
          } catch (error) {
            throw new RunFailureError(
              "configuration",
              error instanceof Error ? error.message : "invalid effective matrix configuration",
              { cause: error },
            );
          }

          const ctx: ReviewContext = {
            repoPath: prepared.repoPath,
            diffPath: join(caseDir, prepared.spec.diffFile),
            config,
          };

          const result = await (options.engineFor ?? getEngine)(modelConfig.runner).review(ctx);
          const record: RunRecord = {
            schemaVersion: 1,
            attemptId,
            caseName,
            caseKind: prepared.spec.kind,
            configName: modelConfig.name,
            repeat,
            startedAt,
            finishedAt: new Date().toISOString(),
            outcome: { status: "completed", result },
          };
          writeFileSync(file, JSON.stringify(record, null, 2));
          console.log(
            `${result.findings.length} finding(s), $${result.usage.costUsd?.toFixed(3) ?? "?"}`,
          );
        } catch (err) {
          const message = safeDiagnostic(err instanceof Error ? err.message : String(err));
          const failureKind = runFailureKind(err);
          const record: RunRecord = {
            schemaVersion: 1,
            attemptId,
            caseName,
            caseKind: prepared?.spec.kind ?? "unknown",
            configName: modelConfig.name,
            repeat,
            startedAt,
            finishedAt: new Date().toISOString(),
            outcome: {
              status: "failed",
              failureKind,
              message,
              durationMs: Date.now() - started,
            },
          };
          writeFileSync(file, JSON.stringify(record, null, 2));
          console.log(`FAILED [${failureKind}]: ${message}`);
        }
      }
    }
  }
  console.log(`\nRuns written to ${outDir}`);
  console.log(`Next: npm run eval:grade -- --runs ${outDir}`);
  return outDir;
}

function loadCaseSpec(caseDir: string, caseName: string): CaseSpec {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(caseDir, "case.json"), "utf8"));
  } catch (error) {
    throw new RunFailureError(
      "configuration",
      `case ${caseName}: could not load case.json: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RunFailureError("configuration", `case ${caseName}: case.json must be an object`);
  }
  const spec = value as Partial<CaseSpec>;
  if (spec.kind !== "seeded" && spec.kind !== "historical" && spec.kind !== "clean") {
    throw new RunFailureError("configuration", `case ${caseName}: invalid kind`);
  }
  if (typeof spec.diffFile !== "string" || spec.diffFile.length === 0) {
    throw new RunFailureError("configuration", `case ${caseName}: needs diffFile`);
  }
  if (!spec.fixtureDir && !(spec.repo && spec.commit)) {
    throw new RunFailureError(
      "configuration",
      `case ${caseName}: needs fixtureDir or repo+commit`,
    );
  }
  return spec as CaseSpec;
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
  throw new RunFailureError("configuration", `case ${spec.name}: needs fixtureDir or repo+commit`);
}
