import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { validateConfig } from "../src/config.js";
import { RunFailureError, runFailureKind } from "../src/core/run-failure.js";
import { getEngine } from "../src/engines/engine.js";
import { safeDiagnostic } from "../src/security/secrets.js";
import {
  assertOpaqueCaseId,
  assertRunnerMayUseCorpus,
  caseIdFromDirectory,
  corpusFromDirectory,
  leakagePolicyForCase,
  materializeCase,
  networkIsolationCapability,
  readSanitizedMetadata,
} from "./case-isolation.js";
import { CASE_CORPORA } from "../src/types.js";
import type {
  CaseCorpus,
  CaseSpec,
  MatrixConfig,
  MatrixRunManifest,
  ReviewContext,
  RunRecord,
  RunnerName,
} from "../src/types.js";
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
  validateMatrixCaseSelection(matrix);
  const baseConfig = loadConfig();

  const casesDir = resolve(options.casesDir ?? "eval/cases");
  const cases = discoverCases(casesDir, matrix.corpora);

  const outDir = resolve(
    runsRoot ?? process.env.PEREGRINE_EVAL_RUNS_DIR ?? "eval/runs",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  mkdirSync(outDir, { recursive: true });

  let sequence = 0;
  const expectedAttempts = matrix.configs.flatMap((modelConfig) =>
    cases.flatMap(({ caseName }) =>
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
    providerNetworkIsolation: Object.fromEntries(
      [...new Set(matrix.configs.map((config) => config.runner))].map((runner) => [
        runner,
        networkIsolationCapability(runner),
      ]),
    ),
  };
  writeFileSync(join(outDir, "matrix-manifest.json"), JSON.stringify(manifest, null, 2));

  const total = expectedAttempts.length;
  let done = 0;

  for (const modelConfig of matrix.configs) {
    for (const { caseName, caseDir } of cases) {
      let spec: CaseSpec | undefined;
      let policy: ReturnType<typeof leakagePolicyForCase> | undefined;
      let metadata: ReturnType<typeof readSanitizedMetadata> | undefined;
      let preparationError: unknown;
      try {
        spec = loadCaseSpec(caseDir);
        policy = leakagePolicyForCase(caseDir, spec);
        metadata = readSanitizedMetadata(caseDir, spec, policy);
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

        let materialized: Awaited<ReturnType<typeof materializeCase>> | undefined;
        try {
          if (!spec || !policy || !metadata) {
            throw new RunFailureError(
              "configuration",
              preparationError instanceof Error ? preparationError.message : "case preparation failed",
              { cause: preparationError },
            );
          }
          try {
            assertRunnerMayUseCorpus(spec.corpus, modelConfig.runner);
            materialized = await materializeCase(caseDir, spec, policy, {
              prepareProviderAssets: modelConfig.runner !== "mock",
            });
          } catch (error) {
            throw new RunFailureError(
              "configuration",
              `case ${spec.id} isolation failed: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
          }
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
            repoPath: materialized.repoPath,
            diffPath: join(caseDir, spec.diffFile),
            diffText: materialized.diffText,
            baseRef: materialized.baseRef,
            headRef: materialized.headRef,
            prTitle: metadata.title,
            prBody: metadata.body,
            evaluationIsolation: materialized.evaluationIsolation,
            config,
          };

          const result = await (options.engineFor ?? getEngine)(modelConfig.runner).review(ctx);
          const record: RunRecord = {
            schemaVersion: 1,
            attemptId,
            caseName,
            caseKind: spec.kind,
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
            caseKind: spec?.kind ?? "unknown",
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
        } finally {
          materialized?.cleanup();
        }
      }
    }
  }
  console.log(`\nRuns written to ${outDir}`);
  console.log(`Next: npm run eval:grade -- --runs ${outDir}`);
  return outDir;
}

export function loadCaseSpec(caseDir: string): CaseSpec {
  const caseId = caseIdFromDirectory(caseDir);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(caseDir, "case.json"), "utf8"));
  } catch (error) {
    throw new RunFailureError(
      "configuration",
      `case ${caseId}: could not load case.json: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RunFailureError("configuration", `case ${caseId}: case.json must be an object`);
  }
  const spec = value as Partial<CaseSpec>;
  if (typeof spec.id !== "string") {
    throw new RunFailureError("configuration", `case ${caseId}: needs id`);
  }
  assertOpaqueCaseId(spec.id, `case ${caseId} id`);
  if (spec.id !== caseId) {
    throw new RunFailureError("configuration", `case ${caseId}: id must match its directory basename`);
  }
  if (!CASE_CORPORA.includes(spec.corpus as CaseCorpus)) {
    throw new RunFailureError("configuration", `case ${caseId}: invalid corpus`);
  }
  const directoryCorpus = corpusFromDirectory(caseDir);
  if (directoryCorpus && spec.corpus !== directoryCorpus) {
    throw new RunFailureError(
      "configuration",
      `case ${caseId}: corpus must match its parent directory ${directoryCorpus}`,
    );
  }
  if (spec.kind !== "seeded" && spec.kind !== "historical" && spec.kind !== "clean") {
    throw new RunFailureError("configuration", `case ${caseId}: invalid kind`);
  }
  if (typeof spec.diffFile !== "string" || spec.diffFile.length === 0) {
    throw new RunFailureError("configuration", `case ${caseId}: needs diffFile`);
  }
  if (spec.metadataFile !== undefined && typeof spec.metadataFile !== "string") {
    throw new RunFailureError("configuration", `case ${caseId}: metadataFile must be a string`);
  }
  if (spec.kind === "historical") {
    const historical = spec as Partial<Extract<CaseSpec, { kind: "historical" }>>;
    if (
      typeof historical.repoSource !== "string" ||
      typeof historical.baseCommit !== "string" ||
      typeof historical.headCommit !== "string"
    ) {
      throw new RunFailureError(
        "configuration",
        `case ${caseId}: historical cases need repoSource, baseCommit, and headCommit`,
      );
    }
    rejectUnexpectedKeys(value as Record<string, unknown>, [
      "id", "corpus", "kind", "repoSource", "baseCommit", "headCommit", "diffFile", "metadataFile",
    ], caseId);
  } else {
    const fixture = spec as Partial<Extract<CaseSpec, { kind: "seeded" | "clean" }>>;
    if (typeof fixture.fixtureDir !== "string" || fixture.fixtureDir.length === 0) {
      throw new RunFailureError("configuration", `case ${caseId}: fixture cases need fixtureDir`);
    }
    rejectUnexpectedKeys(value as Record<string, unknown>, [
      "id", "corpus", "kind", "fixtureDir", "diffFile", "metadataFile",
    ], caseId);
  }
  return spec as CaseSpec;
}

function discoverCases(
  casesDir: string,
  corpora?: CaseCorpus[],
): Array<{ caseName: string; caseDir: string }> {
  const discovered: Array<{ caseName: string; caseDir: string }> = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(directory, entry.name);
      const entries = readdirSync(path, { withFileTypes: true });
      if (entries.some((candidate) => candidate.isFile() && candidate.name === "case.json")) {
        const corpus = corpusFromDirectory(path);
        if (!corpora || (corpus !== undefined && corpora.includes(corpus))) {
          discovered.push({ caseName: relative(casesDir, path), caseDir: path });
        }
      } else {
        visit(path);
      }
    }
  }
  visit(casesDir);
  if (discovered.length === 0) throw new Error(`no eval cases found under ${casesDir}`);
  discovered.sort((left, right) => left.caseName.localeCompare(right.caseName));
  const ids = new Set<string>();
  for (const item of discovered) {
    const id = basename(item.caseDir);
    if (ids.has(id)) throw new Error(`duplicate opaque case id ${id}`);
    ids.add(id);
  }
  return discovered;
}

function validateMatrixCaseSelection(matrix: MatrixConfig): void {
  if (matrix.corpora === undefined) return;
  if (
    !Array.isArray(matrix.corpora) ||
    matrix.corpora.length === 0 ||
    matrix.corpora.some((corpus) => !CASE_CORPORA.includes(corpus))
  ) {
    throw new Error(`matrix corpora must be a non-empty subset of: ${CASE_CORPORA.join(", ")}`);
  }
  if (new Set(matrix.corpora).size !== matrix.corpora.length) {
    throw new Error("matrix corpora must not contain duplicates");
  }
}

function rejectUnexpectedKeys(
  value: Record<string, unknown>,
  allowed: string[],
  caseId: string,
): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new RunFailureError(
      "configuration",
      `case ${caseId}: unsupported fields ${unexpected.join(", ")}; answer-bearing notes belong outside model inputs`,
    );
  }
}
