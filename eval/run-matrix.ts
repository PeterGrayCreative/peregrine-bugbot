import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { loadConfig } from "../src/config.js";
import { validateConfig } from "../src/config.js";
import { RunFailureError, runFailureKind, runFailureTelemetry } from "../src/core/run-failure.js";
import { getEngine } from "../src/engines/engine.js";
import { assertNoSecrets, safeDiagnostic } from "../src/security/secrets.js";
import { formatUsageCost } from "../src/core/telemetry.js";
import {
  assertLiveProviderIsolationAvailable,
  assertLeakageFreeText,
  assertOpaqueCaseId,
  assertRunnerMayUseCorpus,
  caseIdFromDirectory,
  corpusFromDirectory,
  leakagePolicyForCase,
  materializeCase,
  networkIsolationCapability,
  readSanitizedMetadata,
} from "./case-isolation.js";
import { prepareEvaluationManifest } from "./case-manifest.js";
import type { EvaluationManifestPreparer } from "./case-manifest.js";
import { CASE_CORPORA } from "../src/types.js";
import type {
  CaseCorpus,
  CaseSpec,
  EvaluationAttemptProvenance,
  EngineResult,
  MatrixConfig,
  MatrixRunManifest,
  ReviewContext,
  RunFailureTelemetry,
  RunOutcome,
  RunRecord,
  RunnerName,
  StageTelemetry,
} from "../src/types.js";
import type { Engine } from "../src/engines/engine.js";
import { parseGroundTruth } from "./case-truth.js";

interface RunMatrixOptions {
  casesDir?: string;
  engineFor?: (runner: RunnerName) => Engine;
  /** Test seam; production and normal eval calls use prepareReviewManifest. */
  manifestPreparer?: EvaluationManifestPreparer;
  /** Test seam for verifying that attempt cleanup cannot erase incurred work. */
  materializeCaseFor?: typeof materializeCase;
}

interface DiscoveredCase {
  caseName: string;
  caseDir: string;
  corpus: CaseCorpus | "unknown";
  expectedBugCount: number | null;
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
    cases.flatMap(({ caseName, corpus, expectedBugCount }) =>
      Array.from({ length: matrix.repeats }, (_, index) => {
        const repeat = index + 1;
        const id = `attempt-${String(++sequence).padStart(6, "0")}`;
        return {
          id,
          caseName,
          corpus,
          expectedBugCount,
          configName: modelConfig.name,
          repeat,
          file: `${id}.json`,
          runner: modelConfig.runner,
        };
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
  assertNoSecrets(manifest, "matrix manifest");
  writeFileSync(join(outDir, "matrix-manifest.json"), JSON.stringify(manifest, null, 2));

  const total = expectedAttempts.length;
  if (total === 0) {
    console.log(
      `No eval cases matched ${matrix.corpora?.join(", ") ?? "the configured corpus"}; no provider processes were started.`,
    );
    console.log(`Empty run manifest written to ${outDir}`);
    return outDir;
  }
  let done = 0;

  for (const modelConfig of matrix.configs) {
    for (const { caseName, caseDir, corpus } of cases) {
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
        const started = Date.now();
        const startedAt = new Date(started).toISOString();
        process.stdout.write(
          `[${done}/${total}] ${modelConfig.name} × ${caseName} (run ${repeat}) ... `,
        );

        let materialized: Awaited<ReturnType<typeof materializeCase>> | undefined;
        let evaluationProvenance: EvaluationAttemptProvenance | undefined;
        let record: RunRecord | undefined;
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
            materialized = await (options.materializeCaseFor ?? materializeCase)(caseDir, spec, policy, {
              prepareProviderAssets: modelConfig.runner !== "mock",
            });
            evaluationProvenance = { history: materialized.historyProvenance };
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
            diffPath: materialized.diffPath,
            diffText: materialized.diffText,
            baseRef: materialized.baseRef,
            headRef: materialized.headRef,
            prTitle: metadata.title,
            prBody: metadata.body,
            evaluationIsolation: materialized.evaluationIsolation,
            config,
          };

          try {
            const prepared = await prepareEvaluationManifest(
              ctx,
              productionManifestSkillName(config, modelConfig.runner),
              materialized.historyProvenance,
              options.manifestPreparer,
              (output) => assertLeakageFreeText(
                "production review manifest",
                output,
                policy,
                { allowDocumentedMarkers: true },
              ),
            );
            evaluationProvenance.manifest = prepared.provenance;
          } catch (error) {
            throw new RunFailureError(
              "configuration",
              `case ${spec.id} manifest preflight failed: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
          }
          try {
            assertLiveProviderIsolationAvailable(modelConfig.runner);
          } catch (error) {
            throw new RunFailureError(
              "configuration",
              `case ${spec.id} isolation failed: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
          }

          const result = await (options.engineFor ?? getEngine)(modelConfig.runner).review(ctx);
          record = {
            schemaVersion: 1,
            attemptId,
            caseName,
            caseCorpus: spec.corpus,
            caseKind: spec.kind,
            configName: modelConfig.name,
            repeat,
            runner: attempt.runner,
            startedAt,
            finishedAt: startedAt,
            attemptDurationMs: 0,
            evaluationProvenance,
            outcome: { status: "completed", result },
          };
          console.log(
            `${result.findings.length} finding(s), ${formatUsageCost(result.usage)}`,
          );
        } catch (err) {
          const outcome = failureOutcomeForArtifact(attempt.runner, err, 0);
          record = {
            schemaVersion: 1,
            attemptId,
            caseName,
            caseCorpus: spec?.corpus ?? corpus,
            caseKind: spec?.kind ?? "unknown",
            configName: modelConfig.name,
            repeat,
            runner: attempt.runner,
            startedAt,
            finishedAt: startedAt,
            attemptDurationMs: 0,
            ...(evaluationProvenance ? { evaluationProvenance } : {}),
            outcome,
          };
          console.log(`FAILED [${outcome.failureKind}]: ${outcome.message}`);
        } finally {
          let cleanupError: unknown;
          if (materialized) {
            try {
              materialized.cleanup();
            } catch (error) {
              cleanupError = error;
            }
          }
          if (!record) throw new Error(`internal error: attempt ${attemptId} produced no record`);
          const attemptDurationMs = Date.now() - started;
          record = {
            ...record,
            finishedAt: new Date(started + attemptDurationMs).toISOString(),
            attemptDurationMs,
            outcome: record.outcome.status === "failed"
              ? { ...record.outcome, durationMs: attemptDurationMs }
              : record.outcome,
          };
          if (cleanupError !== undefined) {
            const detail = safeDiagnostic(
              cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            );
            const message = safeDiagnostic(record.outcome.status === "failed"
              ? `${record.outcome.message}; cleanup also failed: ${detail}`
              : `isolated attempt cleanup failed after provider completion: ${detail}`);
            record = {
              ...record,
              outcome: record.outcome.status === "failed"
                ? { ...record.outcome, message, durationMs: attemptDurationMs }
                : {
                    status: "failed",
                    failureKind: "configuration",
                    message,
                    durationMs: attemptDurationMs,
                    telemetry: completedResultFailureTelemetry(record.outcome.result),
                  },
            };
            console.log(`CLEANUP FAILED: ${detail}`);
          }
          writeFileSync(file, JSON.stringify(record, null, 2));
        }
      }
    }
  }
  console.log(`\nRuns written to ${outDir}`);
  console.log(`Next: npm run eval:grade -- --runs ${outDir}`);
  return outDir;
}

export function failureOutcomeForArtifact(
  runner: RunnerName,
  error: unknown,
  durationMs: number,
): Extract<RunOutcome, { status: "failed" }> {
  const failureKind = runFailureKind(error);
  const message = safeDiagnostic(error instanceof Error ? error.message : String(error));
  const candidateTelemetry = runner === "mock" ? undefined : runFailureTelemetry(error);
  let telemetry = candidateTelemetry;
  let telemetryUnavailableReason: "not-observed" | "secret-redacted" | undefined;
  if (telemetry !== undefined) {
    try {
      assertNoSecrets(telemetry, "failure telemetry");
    } catch {
      telemetry = undefined;
      telemetryUnavailableReason = "secret-redacted";
    }
  } else if (runner !== "mock" &&
    (failureKind === "provider" || failureKind === "timeout" || failureKind === "parse")) {
    telemetryUnavailableReason = "not-observed";
  }
  return {
    status: "failed",
    failureKind,
    message,
    durationMs,
    ...(telemetry ? { telemetry } : {}),
    ...(telemetryUnavailableReason ? { telemetryUnavailableReason } : {}),
  };
}

function productionManifestSkillName(config: ReviewContext["config"], runner: RunnerName): string {
  if (runner === "claude") return config.runners.claude.skillName;
  if (runner === "codex") return config.runners.codex.skillName;
  if (config.runners.claude.skillName !== config.runners.codex.skillName) {
    throw new Error(
      "mock evaluation requires Claude and Codex to share one production manifest skill",
    );
  }
  return config.runners.claude.skillName;
}

/**
 * Cleanup is part of attempt validity, but it happens after provider work has
 * already been incurred. Convert the completed result to failure telemetry so
 * accounting retains known spend without persisting model output.
 */
function completedResultFailureTelemetry(result: EngineResult): RunFailureTelemetry | undefined {
  if (result.engine === "mock") return undefined;
  const stages = completedStages(result.raw);
  // An aggregate without its contributing requests cannot be reconciled during
  // strict artifact ingestion. Omit telemetry instead of inventing provenance.
  if (stages.length === 0) return undefined;
  return {
    engine: result.engine,
    modelConfig: result.modelConfig,
    usage: result.usage,
    durationMs: result.durationMs,
    stages,
  };
}

function completedStages(raw: unknown): StageTelemetry[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const record = raw as Record<string, unknown>;
  const breadth = completedStage("breadth", record.breadth);
  const investigation = completedStage("investigation", record.investigation);
  // Partial raw stage metadata cannot be reconciled with aggregate usage.
  return breadth && investigation ? [breadth, investigation] : [];
}

function completedStage(
  stage: StageTelemetry["stage"],
  value: unknown,
): StageTelemetry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.model !== "string" ||
    typeof record.promptSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.promptSha256) ||
    !record.usage || typeof record.usage !== "object" || Array.isArray(record.usage) ||
    !Number.isSafeInteger(record.durationMs) || Number(record.durationMs) < 0
  ) {
    return undefined;
  }
  return {
    stage,
    model: record.model,
    promptSha256: record.promptSha256,
    usage: record.usage as StageTelemetry["usage"],
    durationMs: Number(record.durationMs),
    completed: true,
  };
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
  if (
    spec.leakageExceptionsFile !== undefined &&
    typeof spec.leakageExceptionsFile !== "string"
  ) {
    throw new RunFailureError(
      "configuration",
      `case ${caseId}: leakageExceptionsFile must be a string`,
    );
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
      "id", "corpus", "kind", "repoSource", "baseCommit", "headCommit", "diffFile", "metadataFile", "leakageExceptionsFile",
    ], caseId);
  } else {
    const fixture = spec as Partial<Extract<CaseSpec, { kind: "seeded" | "clean" }>>;
    if (typeof fixture.fixtureDir !== "string" || fixture.fixtureDir.length === 0) {
      throw new RunFailureError("configuration", `case ${caseId}: fixture cases need fixtureDir`);
    }
    rejectUnexpectedKeys(value as Record<string, unknown>, [
      "id", "corpus", "kind", "fixtureDir", "diffFile", "metadataFile", "leakageExceptionsFile",
    ], caseId);
  }
  return spec as CaseSpec;
}

function discoverCases(
  casesDir: string,
  corpora?: CaseCorpus[],
): DiscoveredCase[] {
  const discovered: DiscoveredCase[] = [];
  for (const corpusEntry of readdirSync(casesDir, { withFileTypes: true })) {
    if (!corpusEntry.isDirectory()) {
      if (corpusEntry.name === "README.md" || corpusEntry.name === "case-aliases.json") continue;
      throw new Error(
        "unexpected case-root entry; expected only corpus directories and curator metadata",
      );
    }
    if (!CASE_CORPORA.includes(corpusEntry.name as CaseCorpus)) {
      throw new Error(
        "unexpected case directory; expected <cases-root>/<corpus>/<opaque-id>",
      );
    }
    const corpus = corpusEntry.name as CaseCorpus;
    const corpusDir = join(casesDir, corpus);
    for (const entry of readdirSync(corpusDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        if (entry.name === "README.md") continue;
        throw new Error(`unexpected ${corpus} corpus entry; expected an opaque case directory`);
      }
      try {
        assertOpaqueCaseId(entry.name, "case directory id");
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}; expected <cases-root>/<corpus>/<opaque-id>`,
        );
      }
      const path = join(corpusDir, entry.name);
      const hasCaseSpec = readdirSync(path, { withFileTypes: true })
        .some((candidate) => candidate.isFile() && candidate.name === "case.json");
      if (!hasCaseSpec) {
        throw new Error(
          `case directory ${relative(casesDir, path)} is missing case.json; refusing to construct a partial manifest`,
        );
      }
      if (!corpora || corpora.includes(corpus)) {
        discovered.push({
          caseName: relative(casesDir, path),
          caseDir: path,
          corpus,
          expectedBugCount: readExpectedBugCount(path),
        });
      }
    }
  }
  discovered.sort((left, right) => left.caseName.localeCompare(right.caseName));
  const ids = new Set<string>();
  for (const item of discovered) {
    const id = basename(item.caseDir);
    if (ids.has(id)) throw new Error(`duplicate opaque case id ${id}`);
    ids.add(id);
  }
  return discovered;
}

function readExpectedBugCount(caseDir: string): number | null {
  try {
    const value = JSON.parse(readFileSync(join(caseDir, "ground_truth.json"), "utf8"));
    return parseGroundTruth(value).bugs.length;
  } catch {
    return null;
  }
}

function validateMatrixCaseSelection(matrix: MatrixConfig): void {
  if (!Array.isArray(matrix.configs)) throw new Error("matrix configs must be an array");
  const configNames = matrix.configs.map((config) => config.name);
  if (new Set(configNames).size !== configNames.length) {
    throw new Error("matrix config names must not contain duplicates");
  }
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
      `case ${caseId}: contains unsupported fields; answer-bearing notes belong outside model inputs`,
    );
  }
}
